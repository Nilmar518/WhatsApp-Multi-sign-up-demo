import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  DefensiveLoggerService,
  TokenExpiredError,
} from '../../common/logger/defensive-logger.service';
import { SecretManagerService } from '../../common/secrets/secret-manager.service';
import { FirebaseService } from '../../firebase/firebase.service';
import { InstagramSetupStatus } from './instagram-setup-status.enum';
import { SetupInstagramDto } from './dto/setup-instagram.dto';
import { ReplyToCommentDto } from './dto/reply-to-comment.dto';
import { SendInstagramMessageDto } from './dto/send-instagram-message.dto';

// ─── API base URLs ────────────────────────────────────────────────────────────
// All Instagram API with Instagram Login calls go through graph.instagram.com.
// api.instagram.com is used only for the initial auth-code → short-lived token
// exchange (OAuth 2.0 endpoint, distinct from the Graph API).
const IG_AUTH_BASE  = 'https://api.instagram.com';    // auth-code exchange only
const IG_GRAPH_BASE = 'https://graph.instagram.com';  // all other IG Graph calls
const INSTAGRAM_API_VERSION = 'v25.0';

// Webhook fields for Instagram API with Instagram Login:
//   messages  — DMs and Story Mentions
//   comments  — public comments on Posts and Reels
//   mentions  — @mentions in captions and Stories
const WEBHOOK_FIELDS = ['messages', 'comments', 'mentions'] as const;

// ─── API response shapes ──────────────────────────────────────────────────────

/** POST api.instagram.com/oauth/access_token → short-lived token */
interface IgShortTokenResponse {
  access_token: string;
  token_type:   string;
  user_id:      number;
}

/** GET graph.instagram.com/access_token → long-lived token (60-day) */
interface IgLongTokenResponse {
  access_token: string;
  token_type:   string;
  expires_in:   number;
}

/** GET graph.instagram.com/v25.0/me */
interface IgMeResponse {
  id:       string;
  user_id?: string;
  username?: string;
  account_type?: string;
}

interface FbMeResponse {
  id?: string;
}

interface FbInstagramBusinessAccountResponse {
  id?: string;
  username?: string;
}

interface FbAccountNode {
  instagram_business_account?: FbInstagramBusinessAccountResponse;
}

interface FbMeBusinessResponse {
  instagram_business_account?: FbInstagramBusinessAccountResponse;
  accounts?: { data?: FbAccountNode[] };
}

interface DebugTokenResponse {
  data?: {
    user_id?: string;
    is_valid?: boolean;
    type?: string;
  };
}

interface SubscribedAppsResponse {
  success: boolean;
}

// ─── Public result shape ──────────────────────────────────────────────────────

export interface SetupInstagramResult {
  integrationId: string;
  igAccountId:   string;
  igUsername:    string | null;
  setupStatus:   InstagramSetupStatus.WEBHOOKS_SUBSCRIBED;
}

interface ResolvedInstagramIdentity {
  igUserId: string;
  igAccountId: string;
  igUsername: string | null;
  accountType: string | null;
  idSource:
    | 'instagram_me'
    | 'instagram_me_user_id'
    | 'facebook_me'
    | 'facebook_instagram_business_account'
    | 'facebook_debug_token';
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class InstagramIntegrationService {
  private readonly logger = new Logger(InstagramIntegrationService.name);

  constructor(
    private readonly defLogger: DefensiveLoggerService,
    private readonly secrets: SecretManagerService,
    private readonly firebase: FirebaseService,
  ) {}

  // ─── OAuth 2.0 Callback (primary onboarding path) ────────────────────────

  /**
   * Handles the Instagram OAuth redirect callback.
   *
   * Called by GET /integrations/instagram/oauth-callback after the user
   * completes the Instagram authorization screen. Instagram redirects back
   * with `code` (one-time auth code) and `state` (businessId passed through).
   *
   * Three-step token pipeline:
   *   1. POST api.instagram.com/oauth/access_token (form-encoded)
   *        code → short-lived user token (valid ~1 hour)
   *   2. GET  graph.instagram.com/access_token (ig_exchange_token grant)
   *        short-lived → long-lived token (valid 60 days)
   *   3. GET  graph.instagram.com/v25.0/me?fields=id,username
   *        Resolve the native Instagram Business Account ID
   *
   * On success, calls finaliseSetup() to write Firestore and subscribe
   * the account to webhook fields, then returns the integration result so
   * the controller can issue a redirect to the frontend dashboard.
   */
  async handleOAuthCallback(
    code: string,
    businessId: string,
  ): Promise<SetupInstagramResult> {
    // The "Instagram API with Instagram Login" product uses its own set of
    // credentials — separate from the Facebook/WhatsApp META_APP_ID/SECRET.
    const appId      = this.secrets.get('INSTAGRAM_APP_ID');
    const appSecret  = this.secrets.get('INSTAGRAM_APP_SECRET');
    const redirectUri = process.env.IG_OAUTH_REDIRECT_URI ?? '';

    if (!appId || !appSecret) {
      throw new HttpException(
        'INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET must be set in .env.secrets. ' +
          'These are the credentials for the "Instagram API with Instagram Login" product, ' +
          'distinct from META_APP_ID / META_APP_SECRET.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    if (!redirectUri) {
      throw new HttpException(
        'IG_OAUTH_REDIRECT_URI must be set in .env (must match the URI registered in Meta App Dashboard).',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Instagram occasionally appends a '#_' fragment to the auth code in the
    // redirect URL. Strip it before sending to the token endpoint to avoid 400s.
    const cleanCode = code.replace(/#_$/, '');

    this.logger.log(
      `[INSTAGRAM_OAUTH] Callback received — businessId=${businessId}`,
    );

    try {
      // ── Step 1: Auth code → short-lived token (form-encoded POST) ───────────
      // api.instagram.com requires application/x-www-form-urlencoded, not JSON.
      const shortLivedRes = await this.defLogger.request<IgShortTokenResponse>({
        method: 'POST',
        url: `${IG_AUTH_BASE}/oauth/access_token`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: new URLSearchParams({
          client_id:     appId,
          client_secret: appSecret,
          grant_type:    'authorization_code',
          redirect_uri:  redirectUri,
          code:          cleanCode,
        }).toString(),
      });

      const shortLivedToken = shortLivedRes?.access_token;
      if (!shortLivedToken) {
        throw new HttpException(
          'Instagram did not return an access_token for the provided auth code. ' +
            'The code may have expired or already been consumed.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      this.logger.log('[INSTAGRAM_OAUTH] ✓ Short-lived token obtained');

      // ── Step 2: Short-lived → long-lived token (60-day) ─────────────────────
      const longLivedRes = await this.defLogger.request<IgLongTokenResponse>({
        method: 'GET',
        url: `${IG_GRAPH_BASE}/access_token`,
        params: {
          grant_type:    'ig_exchange_token',
          client_secret: appSecret,
          access_token:  shortLivedToken,
        },
      });

      const longLivedToken = longLivedRes?.access_token;
      if (!longLivedToken) {
        throw new HttpException(
          'Token exchange (ig_exchange_token) did not return an access_token.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      this.logger.log('[INSTAGRAM_OAUTH] ✓ Long-lived token obtained');

      // ── Step 3: Resolve Instagram Business Account ID ────────────────────────
      const resolvedIdentity = await this.resolveInstagramIdentity(
        longLivedToken,
        appId,
        appSecret,
      );

      if (!resolvedIdentity.igAccountId) {
        throw new HttpException(
          'Could not resolve the Instagram Professional Account ID from Graph APIs. ' +
            'Ensure the account is an Instagram Professional (Business or Creator) account.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      this.logger.log(
        `[INSTAGRAM_OAUTH] ✓ IG Account resolved — ` +
          `igUserId=${resolvedIdentity.igUserId} ` +
          `igAccountId=${resolvedIdentity.igAccountId} ` +
          `source=${resolvedIdentity.idSource} ` +
          `accountType=${resolvedIdentity.accountType ?? 'n/a'} ` +
          `username=${resolvedIdentity.igUsername ?? 'n/a'}`,
      );

      // ── Steps 4–5: Persist Firestore doc + subscribe webhooks ────────────────
      return await this.finaliseSetup(
        resolvedIdentity.igUserId,
        resolvedIdentity.igAccountId,
        resolvedIdentity.igUsername,
        longLivedToken,
        businessId,
      );
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        `Instagram OAuth callback failed: ${err.message as string}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  // ─── Legacy setup (token exchange done client-side) ──────────────────────

  /**
   * @deprecated Use handleOAuthCallback via GET /oauth-callback instead.
   * Kept for local testing: accepts a short-lived token pre-obtained by the
   * caller and exchanges it for a long-lived token.
   */
  async setupInstagram(dto: SetupInstagramDto): Promise<SetupInstagramResult> {
    const { shortLivedToken, businessId } = dto;

    const appSecret = this.secrets.get('META_APP_SECRET');
    if (!appSecret) {
      throw new HttpException(
        'META_APP_SECRET must be set in .env.secrets.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    this.logger.log(
      `[INSTAGRAM_SETUP] Starting legacy setup — businessId=${businessId}`,
    );

    try {
      const longLivedRes = await this.defLogger.request<IgLongTokenResponse>({
        method: 'GET',
        url: `${IG_GRAPH_BASE}/access_token`,
        params: {
          grant_type:    'ig_exchange_token',
          client_secret: appSecret,
          access_token:  shortLivedToken,
        },
      });

      const longLivedToken = longLivedRes?.access_token;
      if (!longLivedToken) {
        throw new HttpException(
          'Token exchange did not return an access_token.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      const appId = this.secrets.get('INSTAGRAM_APP_ID') ?? '';
      const resolvedIdentity = await this.resolveInstagramIdentity(
        longLivedToken,
        appId,
        appSecret,
      );

      if (!resolvedIdentity.igAccountId) {
        throw new HttpException(
          'Could not resolve the Instagram Professional Account ID from Graph APIs.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      return await this.finaliseSetup(
        resolvedIdentity.igUserId,
        resolvedIdentity.igAccountId,
        resolvedIdentity.igUsername,
        longLivedToken,
        businessId,
      );
    } catch (err: any) {
      if (err instanceof TokenExpiredError) {
        throw new HttpException(
          'The provided token is invalid or expired.',
          HttpStatus.GONE,
        );
      }
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        `Instagram setup failed: ${err.message as string}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  // ─── Manual DM ────────────────────────────────────────────────────────────

  /**
   * Sends a manual text DM to an Instagram user and persists it to Firestore.
   *
   * Enforces the 24-hour messaging window (throws 403 if closed).
   *
   * Outbound endpoint: POST graph.instagram.com/v25.0/me/messages
   *   Using /me resolves to the IG account whose token is supplied, which
   *   avoids hard-coding the igAccountId in the URL.
   */
  async sendInstagramMessage(
    integrationId: string,
    dto: SendInstagramMessageDto,
  ): Promise<{ success: true; messageId: string }> {
    const { recipientId, text } = dto;

    const db     = this.firebase.getFirestore();
    const docRef = db.collection('integrations').doc(integrationId);
    const snap   = await docRef.get();

    if (!snap.exists) {
      throw new NotFoundException(`Integration ${integrationId} not found`);
    }

    const data        = snap.data() as Record<string, any>;
    const igAccountId = data?.metaData?.igAccountId as string | undefined;
    const accessToken = data?.metaData?.accessToken as string | undefined;

    if (!igAccountId || !accessToken) {
      throw new HttpException(
        'Integration is missing metaData.igAccountId or metaData.accessToken.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // 24-hour window guard
    const convSnap = await docRef.collection('conversations').doc(recipientId).get();
    const lastTs   = convSnap.exists
      ? (convSnap.data()?.lastUserInteractionTimestamp as number | undefined)
      : undefined;

    if (!lastTs || Date.now() - lastTs > 24 * 60 * 60 * 1000) {
      throw new HttpException(
        'The 24-hour messaging window is closed for this contact. ' +
          'The user must send a message first to open the window.',
        HttpStatus.FORBIDDEN,
      );
    }

    // POST /me/messages — /me resolves to the owner of the supplied token
    const response = await this.defLogger.request<{ message_id?: string }>({
      method: 'POST',
      url: `${IG_GRAPH_BASE}/${INSTAGRAM_API_VERSION}/me/messages`,
      params: { access_token: accessToken },
      data: {
        recipient: { id: recipientId },
        message:   { text },
      },
    });

    const externalMessageId = response?.message_id ?? `manual_${Date.now()}`;

    const { v4: uuidv4Local } = await import('uuid');
    const localId   = uuidv4Local();
    const msgDocRef = docRef.collection('messages').doc(localId);
    const now       = new Date().toISOString();

    await this.firebase.set(msgDocRef, {
      id:              localId,
      externalId:      externalMessageId,
      direction:       'outbound',
      from:            igAccountId,
      to:              recipientId,
      text,
      timestamp:       now,
      channel:         'META_INSTAGRAM',
      interactionType: 'DIRECT_MESSAGE',
      createdAt:       now,
    });

    this.logger.log(
      `[IG_MANUAL_DM] ✓ Sent — integrationId=${integrationId} ` +
        `to=${recipientId} msgId=${externalMessageId}`,
    );

    return { success: true, messageId: localId };
  }

  // ─── Reply to comment ─────────────────────────────────────────────────────

  /**
   * Sends a Public or Private reply to an Instagram comment.
   *
   * PUBLIC  → POST graph.instagram.com/v25.0/{commentId}/replies
   * PRIVATE → POST graph.instagram.com/v25.0/me/messages
   *           with recipient.comment_id (Single Reply Rule + 7-day window)
   */
  async replyToComment(
    integrationId: string,
    dto: ReplyToCommentDto,
  ): Promise<{ success: true }> {
    const { type, commentId, text } = dto;

    const db     = this.firebase.getFirestore();
    const docRef = db.collection('integrations').doc(integrationId);
    const snap   = await docRef.get();

    if (!snap.exists) {
      throw new NotFoundException(`Integration ${integrationId} not found`);
    }

    const data        = snap.data() as Record<string, any>;
    const igAccountId = data?.metaData?.igAccountId as string | undefined;
    const accessToken = data?.metaData?.accessToken as string | undefined;

    if (!igAccountId || !accessToken) {
      throw new HttpException(
        'Integration is missing metaData.igAccountId or metaData.accessToken.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // ── PUBLIC reply ──────────────────────────────────────────────────────────
    if (type === 'PUBLIC') {
      await this.defLogger.request({
        method: 'POST',
        url: `${IG_GRAPH_BASE}/${INSTAGRAM_API_VERSION}/${commentId}/replies`,
        params: { access_token: accessToken },
        data: { message: text },
      });

      this.logger.log(
        `[IG_REPLY] ✓ Public reply sent — commentId=${commentId} integrationId=${integrationId}`,
      );
      return { success: true };
    }

    // ── PRIVATE reply — compliance checks ────────────────────────────────────

    const commentDocRef = docRef.collection('messages').doc(`comment_${commentId}`);
    const commentSnap   = await commentDocRef.get();

    if (!commentSnap.exists) {
      throw new HttpException(
        `Comment document not found for commentId=${commentId}. ` +
          'Ensure the webhook has delivered and stored this comment.',
        HttpStatus.NOT_FOUND,
      );
    }

    const commentData        = commentSnap.data() as Record<string, any>;
    const privateReplyStatus = commentData?.privateReplyStatus as string | undefined;
    const commentTimestamp   = commentData?.timestamp as string | undefined;

    // Single Reply Rule
    if (privateReplyStatus !== 'PENDING') {
      throw new HttpException(
        'A Private Reply has already been sent for this comment (Single Reply Rule). ' +
          'Only one Private Reply per comment is permitted by Meta policy.',
        HttpStatus.FORBIDDEN,
      );
    }

    // 7-day temporal limit
    if (commentTimestamp) {
      const commentAgeMs  = Date.now() - new Date(commentTimestamp).getTime();
      const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
      if (commentAgeMs > SEVEN_DAYS_MS) {
        throw new HttpException(
          'The 7-day window for sending a Private Reply to this comment has expired.',
          HttpStatus.FORBIDDEN,
        );
      }
    }

    // POST /me/messages with comment_id recipient
    await this.defLogger.request({
      method: 'POST',
      url: `${IG_GRAPH_BASE}/${INSTAGRAM_API_VERSION}/me/messages`,
      params: { access_token: accessToken },
      data: {
        recipient: { comment_id: commentId },
        message:   { text },
      },
    });

    await this.firebase.update(commentDocRef, {
      privateReplyStatus: 'PRIVATE_REPLY_SENT',
      privateReplySentAt: new Date().toISOString(),
    });

    this.logger.log(
      `[IG_REPLY] ✓ Private Reply sent — commentId=${commentId} integrationId=${integrationId}`,
    );
    return { success: true };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Shared finalisation logic called by both handleOAuthCallback and setupInstagram.
   *
   *   1. Write the Firestore integration document (provider=META_INSTAGRAM).
   *   2. Subscribe the IG account to webhook fields.
   *   3. Advance status to WEBHOOKS_SUBSCRIBED.
   *   4. Return the SetupInstagramResult for the caller to redirect with.
   */
  private async finaliseSetup(
    igUserId: string,
    igAccountId: string,
    igUsername:  string | null,
    accessToken: string,
    businessId:  string,
  ): Promise<SetupInstagramResult> {
    const integrationId = uuidv4();
    const db     = this.firebase.getFirestore();
    const docRef = db.collection('integrations').doc(integrationId);

    await this.firebase.set(
      docRef,
      {
        integrationId,
        provider:             'META_INSTAGRAM',
        connectedBusinessIds: [businessId],
        status:               InstagramSetupStatus.ACCOUNT_RESOLVED,
        setupStatus:          InstagramSetupStatus.ACCOUNT_RESOLVED,
        createdAt:            new Date().toISOString(),
        updatedAt:            new Date().toISOString(),
      },
      { merge: true },
    );

    await this.firebase.update(docRef, {
      // igUserId — native ID returned by graph.instagram.com /me.
      // igAccountId — webhook-routing ID (entry.id / recipient.id). When Graph
      // endpoints expose a webhook-compatible business ID, it is stored here.
      'metaData.igUserId':              igUserId,
      'metaData.igAccountId':           igAccountId,
      'metaData.igUsername':            igUsername ?? '',
      'metaData.accessToken':           accessToken,
      'metaData.webhookFields':         [...WEBHOOK_FIELDS],
      'metaData.accountIdResolution':   'oauth_callback_graph_resolution',
      'metaData.lastTokenValidationAt': new Date().toISOString(),
    });

    this.logger.log(
      `[INSTAGRAM_SETUP] ✓ Firestore document written — ` +
        `provider=META_INSTAGRAM igAccountId=${igAccountId} integrationId=${integrationId}`,
    );

    await this.subscribeIgAccountWebhooks(igUserId, accessToken, integrationId);

    this.logger.log(
      `[INSTAGRAM_SETUP] ✓ WEBHOOKS_SUBSCRIBED — integrationId=${integrationId}`,
    );

    return {
      integrationId,
      igAccountId,
      igUsername,
      setupStatus: InstagramSetupStatus.WEBHOOKS_SUBSCRIBED,
    };
  }

  /**
   * Resolves both native and webhook-compatible Instagram IDs from a token.
   *
   * Primary source:
  *   GET graph.instagram.com/v25.0/me?fields=id,user_id,username,account_type
   *
   * Additional probes (best-effort):
   *   GET graph.facebook.com/v25.0/me?fields=instagram_business_account{id,username},accounts{instagram_business_account{id,username}}
   *   GET graph.facebook.com/v25.0/me?fields=id
   *   GET graph.facebook.com/v25.0/debug_token
   */
  private async resolveInstagramIdentity(
    accessToken: string,
    appId: string,
    appSecret: string,
  ): Promise<ResolvedInstagramIdentity> {
    const igMe = await this.defLogger.request<IgMeResponse>({
      method: 'GET',
      url: `${IG_GRAPH_BASE}/${INSTAGRAM_API_VERSION}/me`,
      params: {
        fields: 'id,user_id,username,account_type',
        access_token: accessToken,
      },
    });

    const igUserId = igMe?.id;
    const igProfessionalId = igMe?.user_id?.trim();
    const igUsername = igMe?.username ?? null;
    const accountType = igMe?.account_type ?? null;

    if (!igUserId) {
      throw new HttpException(
        'Could not resolve Instagram user identity from graph.instagram.com /me.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    let igAccountId = igUserId;
    let idSource: ResolvedInstagramIdentity['idSource'] = 'instagram_me';

    // For Instagram Login, /me.user_id is often the global Professional Account ID
    // that matches webhook entry.id (typically starts with 1784...).
    if (igProfessionalId) {
      igAccountId = igProfessionalId;
      idSource = 'instagram_me_user_id';
    }

    try {
      const fbBusinessMe = await this.defLogger.request<FbMeBusinessResponse>({
        method: 'GET',
        url: `https://graph.facebook.com/${INSTAGRAM_API_VERSION}/me`,
        params: {
          fields:
            'instagram_business_account{id,username},accounts{instagram_business_account{id,username}}',
          access_token: accessToken,
        },
      });

      const directBusinessId = fbBusinessMe?.instagram_business_account?.id;
      const accountBusinessId = fbBusinessMe?.accounts?.data
        ?.find((a) => Boolean(a.instagram_business_account?.id))
        ?.instagram_business_account?.id;

      const resolvedBusinessId = directBusinessId ?? accountBusinessId;
      if (resolvedBusinessId) {
        igAccountId = resolvedBusinessId;
        idSource = 'facebook_instagram_business_account';
      }
    } catch (err: any) {
      this.logger.warn(
        `[INSTAGRAM_OAUTH] Could not resolve instagram_business_account via Facebook Graph: ` +
          `${err?.message as string}`,
      );
    }

    if (idSource === 'instagram_me') {
      try {
        const fbMe = await this.defLogger.request<FbMeResponse>({
          method: 'GET',
          url: `https://graph.facebook.com/${INSTAGRAM_API_VERSION}/me`,
          params: { fields: 'id', access_token: accessToken },
        });

        if (fbMe?.id) {
          igAccountId = fbMe.id;
          idSource = 'facebook_me';
        }
      } catch (err: any) {
        this.logger.warn(
          `[INSTAGRAM_OAUTH] Could not resolve /me id via Facebook Graph: ${err?.message as string}`,
        );
      }
    }

    if (idSource === 'instagram_me' && appId && appSecret) {
      try {
        const debug = await this.defLogger.request<DebugTokenResponse>({
          method: 'GET',
          url: `https://graph.facebook.com/${INSTAGRAM_API_VERSION}/debug_token`,
          params: {
            input_token: accessToken,
            access_token: `${appId}|${appSecret}`,
          },
        });

        if (debug?.data?.user_id) {
          igAccountId = debug.data.user_id;
          idSource = 'facebook_debug_token';
        }
      } catch (err: any) {
        this.logger.warn(
          `[INSTAGRAM_OAUTH] Could not resolve debug_token user_id: ${err?.message as string}`,
        );
      }
    }

    return {
      igUserId,
      igAccountId,
      igUsername,
      accountType,
      idSource,
    };
  }

  /**
   * Subscribes an Instagram Professional Account to webhook fields.
   * POST graph.instagram.com/v25.0/{igAccountId}/subscribed_apps
   * Idempotent — treats "already subscribed" as success.
   */
  private async subscribeIgAccountWebhooks(
    igAccountId: string,
    accessToken:  string,
    integrationId: string,
  ): Promise<void> {
    const subscribedFields = WEBHOOK_FIELDS.join(',');

    try {
      const result = await this.defLogger.request<SubscribedAppsResponse>({
        method: 'POST',
        url: `${IG_GRAPH_BASE}/${INSTAGRAM_API_VERSION}/${igAccountId}/subscribed_apps`,
        params: {
          subscribed_fields: subscribedFields,
          access_token:      accessToken,
        },
      });

      if (result?.success) {
        this.logger.log(
          `[INSTAGRAM_SETUP] ✓ IG account ${igAccountId} subscribed to: ${subscribedFields}`,
        );
      }
    } catch (subErr: any) {
      const errMsg: string =
        (subErr?.response?.data?.error?.message as string | undefined) ??
        subErr?.message ??
        'unknown error';

      if (errMsg.toLowerCase().includes('already subscribed')) {
        this.logger.log(
          `[INSTAGRAM_SETUP] ✓ IG account ${igAccountId} already subscribed — continuing`,
        );
      } else {
        throw new HttpException(
          `Failed to subscribe IG account to webhook fields: ${errMsg}`,
          HttpStatus.BAD_GATEWAY,
        );
      }
    }

    const db     = this.firebase.getFirestore();
    const docRef = db.collection('integrations').doc(integrationId);
    await this.firebase.update(docRef, {
      status:      InstagramSetupStatus.WEBHOOKS_SUBSCRIBED,
      setupStatus: InstagramSetupStatus.WEBHOOKS_SUBSCRIBED,
      updatedAt:   new Date().toISOString(),
    });
  }
}

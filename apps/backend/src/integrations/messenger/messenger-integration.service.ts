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
import { MessengerSetupStatus } from './messenger-setup-status.enum';
import { SetupMessengerDto } from './dto/setup-messenger.dto';

const GRAPH_BASE = 'https://graph.facebook.com';
const MESSENGER_API_VERSION = 'v25.0';

// Fields to subscribe on the Page webhook.
const WEBHOOK_FIELDS = [
  'messages',
  'messaging_postbacks',
  'messaging_optins',
  'messaging_handovers',
  'standby',
] as const;

// ─── Graph API response shapes ──────────────────────────────────────────────

interface GraphTokenResponse {
  access_token: string;
  token_type?: string;
}

interface PageEntry {
  access_token: string;
  id: string;
  name: string;
  category?: string;
  tasks?: string[];
}

interface AccountsResponse {
  data: PageEntry[];
}

interface SubscribedAppsResponse {
  success: boolean;
}

// ─── Public result shape ────────────────────────────────────────────────────

export interface SetupMessengerResult {
  integrationId: string;
  pageId: string;
  pageName: string;
  setupStatus: MessengerSetupStatus.PAGE_SUBSCRIBED;
}

// ─── Service ────────────────────────────────────────────────────────────────

@Injectable()
export class MessengerIntegrationService {
  private readonly logger = new Logger(MessengerIntegrationService.name);

  constructor(
    private readonly defLogger: DefensiveLoggerService,
    private readonly secrets: SecretManagerService,
    private readonly firebase: FirebaseService,
  ) {}

  // ─── Main entry point ────────────────────────────────────────────────────

  /**
   * One-shot Messenger onboarding:
   *   1. Exchange short-lived user token → long-lived user token (60-day).
   *   2. List manageable Pages via GET /me/accounts.
   *   3. Select the target Page (first page, or the one matching dto.pageId).
   *   4. Extract the long-lived Page Access Token from the accounts response.
   *      (A page token derived from a long-lived user token does not expire.)
  *   5. Persist the Page Access Token directly in Firestore metaData.
   *   6. Persist the integration document to Firestore (provider=META_MESSENGER).
   *   7. Subscribe the app to Page webhook fields.
   *
   * Meta API (v25.0):
   *   GET  /oauth/access_token  (fb_exchange_token grant)
   *   GET  /me/accounts
   *   POST /{pageId}/subscribed_apps
   */
  async setupMessenger(dto: SetupMessengerDto): Promise<SetupMessengerResult> {
    const { shortLivedToken, businessId } = dto;
    const requestedPageId = dto.pageId;
    const integrationId   = uuidv4();

    const appId     = this.secrets.get('META_APP_ID');
    const appSecret = this.secrets.get('META_APP_SECRET');

    if (!appId || !appSecret) {
      throw new HttpException(
        'META_APP_ID and META_APP_SECRET must be set in .env.secrets.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    this.logger.log(
      `[MESSENGER_SETUP] Starting — businessId=${businessId} integrationId=${integrationId}`,
    );

    try {
      // ── Step 1: Exchange short-lived user token → long-lived (60-day) ──────
      const longLived = await this.defLogger.request<GraphTokenResponse>({
        method: 'GET',
        url: `${GRAPH_BASE}/${MESSENGER_API_VERSION}/oauth/access_token`,
        params: {
          grant_type: 'fb_exchange_token',
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: shortLivedToken,
        },
      });
      this.logger.log('[MESSENGER_SETUP] ✓ Long-lived user token obtained');

      // ── Step 2: List manageable Pages ──────────────────────────────────────
      const accounts = await this.defLogger.request<AccountsResponse>({
        method: 'GET',
        url: `${GRAPH_BASE}/${MESSENGER_API_VERSION}/me/accounts`,
        params: {
          fields: 'id,name,access_token,tasks',
          access_token: longLived.access_token,
        },
      });

      const pages = accounts?.data ?? [];
      if (!pages.length) {
        throw new HttpException(
          'No manageable Facebook Pages found for this user. ' +
            'Ensure the user manages at least one Page with pages_messaging permission.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      this.logger.log(
        `[MESSENGER_SETUP] Found ${pages.length} page(s): ` +
          `[${pages.map((p) => `${p.id}(${p.name})`).join(', ')}]`,
      );

      // ── Step 3: Select the target Page ─────────────────────────────────────
      let selectedPage: PageEntry;

      if (requestedPageId) {
        const match = pages.find((p) => p.id === requestedPageId);
        if (!match) {
          throw new NotFoundException(
            `Requested pageId=${requestedPageId} not found among manageable pages. ` +
              `Available: [${pages.map((p) => p.id).join(', ')}]`,
          );
        }
        selectedPage = match;
      } else {
        // POC default: pick the first page.
        selectedPage = pages[0];
        this.logger.log(
          `[MESSENGER_SETUP] No pageId requested — using first page: ` +
            `${selectedPage.id} (${selectedPage.name})`,
        );
      }

      // ── Step 4: Extract the long-lived Page Access Token ───────────────────
      // When /me/accounts is called with a long-lived user token, the returned
      // page access tokens are also long-lived (no expiry unless revoked).
      const pageAccessToken = selectedPage.access_token;
      if (!pageAccessToken) {
        throw new HttpException(
          `No access_token returned for Page ${selectedPage.id}. ` +
            'Ensure pages_messaging scope was granted during Facebook Login.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      // ── Step 5: Persist Firestore integration document ─────────────────────
      const db     = this.firebase.getFirestore();
      const docRef = db.collection('integrations').doc(integrationId);

      await this.firebase.set(
        docRef,
        {
          integrationId,
          provider: 'META_MESSENGER',
          connectedBusinessIds: [businessId],
          status: MessengerSetupStatus.PAGE_SELECTED,
          setupStatus: MessengerSetupStatus.PAGE_SELECTED,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );

      await this.firebase.update(docRef, {
        'metaData.pageId': selectedPage.id,
        'metaData.pageName': selectedPage.name,
        'metaData.accessToken': pageAccessToken,
        'metaData.webhookObject': 'page',
        'metaData.webhookFields': [...WEBHOOK_FIELDS],
        'metaData.lastTokenValidationAt': new Date().toISOString(),
      });

      this.logger.log(
        `[MESSENGER_SETUP] ✓ Firestore document written — ` +
          `provider=META_MESSENGER pageId=${selectedPage.id}`,
      );

      // ── Step 6: Subscribe app to Page webhook fields ────────────────────────
      await this.subscribePageWebhooks(
        selectedPage.id,
        pageAccessToken,
        integrationId,
      );

      this.logger.log(
        `[MESSENGER_SETUP] ✓ PAGE_SUBSCRIBED — ` +
          `integrationId=${integrationId} pageId=${selectedPage.id}`,
      );

      return {
        integrationId,
        pageId: selectedPage.id,
        pageName: selectedPage.name,
        setupStatus: MessengerSetupStatus.PAGE_SUBSCRIBED,
      };
    } catch (err: any) {
      if (err instanceof TokenExpiredError) {
        throw new HttpException(
          'The provided token is invalid or expired. Restart the Facebook Login flow.',
          HttpStatus.GONE,
        );
      }
      if (err instanceof HttpException || err instanceof NotFoundException) throw err;
      throw new HttpException(
        `Messenger setup failed: ${err.message as string}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  /**
   * Subscribes the app to Page webhook events and advances Firestore status
   * to PAGE_SUBSCRIBED. Idempotent — safe to call more than once.
   *
   * Meta API: POST /{PAGE_ID}/subscribed_apps
   */
  private async subscribePageWebhooks(
    pageId: string,
    pageAccessToken: string,
    integrationId: string,
  ): Promise<void> {
    const subscribedFields = WEBHOOK_FIELDS.join(',');

    try {
      const result = await this.defLogger.request<SubscribedAppsResponse>({
        method: 'POST',
        url: `${GRAPH_BASE}/${MESSENGER_API_VERSION}/${pageId}/subscribed_apps`,
        params: {
          subscribed_fields: subscribedFields,
          access_token: pageAccessToken,
        },
      });

      if (result?.success) {
        this.logger.log(
          `[MESSENGER_SETUP] ✓ App subscribed to Page ${pageId} — fields: ${subscribedFields}`,
        );
      }
    } catch (subErr: any) {
      const errMsg: string =
        (subErr?.response?.data?.error?.message as string | undefined) ??
        subErr?.message ??
        'unknown error';

      if (errMsg.toLowerCase().includes('already subscribed')) {
        this.logger.log(
          `[MESSENGER_SETUP] ✓ App already subscribed to Page ${pageId} — continuing`,
        );
      } else {
        throw new HttpException(
          `Failed to subscribe app to Page webhooks: ${errMsg}`,
          HttpStatus.BAD_GATEWAY,
        );
      }
    }

    const db     = this.firebase.getFirestore();
    const docRef = db.collection('integrations').doc(integrationId);
    await this.firebase.update(docRef, {
      status: MessengerSetupStatus.PAGE_SUBSCRIBED,
      setupStatus: MessengerSetupStatus.PAGE_SUBSCRIBED,
      updatedAt: new Date().toISOString(),
    });
  }
}

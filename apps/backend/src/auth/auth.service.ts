import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import {
  DefensiveLoggerService,
  TokenExpiredError,
} from '../common/logger/defensive-logger.service';
import { SecretManagerService } from '../common/secrets/secret-manager.service';
import { FirebaseService } from '../firebase/firebase.service';
import { SystemUserService } from './system-user.service';
import { ExchangeTokenDto } from './dto/exchange-token.dto';

export enum IntegrationStatus {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  PENDING_TOKEN = 'PENDING_TOKEN',
  ACTIVE = 'ACTIVE',
  ERROR = 'ERROR',
}

interface GraphTokenResponse {
  access_token: string;
  token_type?: string;
}

interface WabaResponse {
  id: string;
  name?: string;
}

interface PhoneNumberEntry {
  id: string;
  verified_name?: string;
  display_phone_number?: string;
}

interface PhoneNumberListResponse {
  data: PhoneNumberEntry[];
}

interface MeResponse {
  id: string;
  name?: string;
}

interface RegisterResponse {
  success: boolean;
}

interface SubscribedAppsResponse {
  success: boolean;
}

const DEFAULT_BUSINESS_ID = 'demo-business-001';
const MAX_PHONE_NUMBERS_PER_WABA = 2;
const ACTIVE_CACHE_TTL_MS = 60_000; // return cached ACTIVE for 60 s after a successful write
const IN_PROGRESS_LOCK_MS = 10_000; // block duplicate requests for 10 s

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /**
   * In-memory lock that prevents two concurrent requests from both attempting
   * to exchange the same single-use OAuth code (double-trigger scenario).
   * Stores the epoch timestamp when the lock was acquired, keyed by businessId.
   * Cleared in the finally block whether the exchange succeeds or fails.
   */
  private readonly exchangeInProgress = new Map<string, number>();

  constructor(
    private readonly secrets: SecretManagerService,
    private readonly defLogger: DefensiveLoggerService,
    private readonly firebase: FirebaseService,
    private readonly systemUser: SystemUserService,
  ) {}

  /**
   * Token exchange flow — fully idempotent:
   *
   *  Guard 1  Recent ACTIVE cache (60 s) — return immediately, code was already used
   *  Guard 2  In-progress lock  (10 s) — block duplicate concurrent requests
   *  Step  1  code → short-lived token
   *  Step  2  short-lived → long-lived token (60-day)
   *  Step  3  Verify WABA via GET /{wabaId}?fields=id (direct node, no extra scope needed)
   *  Step  4  Fetch WABA phone list — limit check + phoneNumberId resolution
   *           (resolves the ID when the frontend omits it, e.g. webhook-only path)
   *  Step  5  POST /{phoneNumberId}/register — activate the number on the WhatsApp
   *           Cloud API network (without this, number stays "Pending" / shows "Invite")
   *  Step  5.5 POST /{wabaId}/subscribed_apps — subscribe app to receive `messages`
   *           webhook events from this WABA (without this, real user messages are dropped
   *           by Meta's routing layer before they reach our webhook)
   *  Step  6  Write ACTIVE to Firestore (upgrades PENDING_TOKEN stub if present)
   *  Step  7  System User token escalation (non-fatal)
   *
   * TokenExpiredError → 410 Gone  (frontend MUST NOT retry a dead code)
   * All other errors  → 502 Bad Gateway
   */
  async exchangeToken(dto: ExchangeTokenDto): Promise<{ status: string }> {
    const { code, wabaId } = dto;
    const phoneNumberId = dto.phoneNumberId ?? '';
    const businessId = dto.businessId || DEFAULT_BUSINESS_ID;

    // Log only the first 8 chars of the code for traceability without leaking it
    this.logger.log(
      `[TOKEN_EXCHANGE] Starting — businessId=${businessId} wabaId=${wabaId} code=${code.slice(0, 8)}...`,
    );

    const db = this.firebase.getFirestore();
    const docRef = db.collection('integrations').doc(businessId);

    // ── Guard 1: Recent ACTIVE cache ──────────────────────────────────────────
    const existingSnap = await docRef.get();
    if (existingSnap.exists) {
      const existing = existingSnap.data()!;
      const cachedToken = (existing.metaData as Record<string, string>)?.accessToken;
      const updatedAt = existing.updatedAt as string | undefined;
      const ageMs = updatedAt ? Date.now() - new Date(updatedAt).getTime() : Infinity;

      if (
        existing.status === IntegrationStatus.ACTIVE &&
        cachedToken &&
        ageMs < ACTIVE_CACHE_TTL_MS
      ) {
        this.logger.log(
          `[TOKEN_EXCHANGE] Recent ACTIVE token (${Math.round(ageMs / 1000)}s old) — returning cached result, skipping Meta API`,
        );
        return { status: IntegrationStatus.ACTIVE };
      }

      // Clear any stale error so the UI shows a clean state while we retry
      try {
        await this.firebase.update(docRef, {
          'metaData.error': null,
          updatedAt: new Date().toISOString(),
        });
        this.logger.log(`[TOKEN_EXCHANGE] Cleared previous error state for businessId=${businessId}`);
      } catch {
        // Non-fatal
      }
    }

    // ── Guard 2: In-progress lock ─────────────────────────────────────────────
    const lockTs = this.exchangeInProgress.get(businessId);
    if (lockTs !== undefined && Date.now() - lockTs < IN_PROGRESS_LOCK_MS) {
      // First request may have already written ACTIVE in the interim
      const recheckSnap = await docRef.get();
      if (recheckSnap.exists && recheckSnap.data()?.status === IntegrationStatus.ACTIVE) {
        this.logger.log(
          `[TOKEN_EXCHANGE] Duplicate blocked — first request already wrote ACTIVE`,
        );
        return { status: IntegrationStatus.ACTIVE };
      }
      this.logger.warn(
        `[TOKEN_EXCHANGE] Duplicate request for businessId=${businessId} within ${IN_PROGRESS_LOCK_MS}ms — rejecting to protect single-use code`,
      );
      throw new HttpException(
        'Token exchange already in progress. Please wait a moment.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.exchangeInProgress.set(businessId, Date.now());

    const appId = this.secrets.get('META_APP_ID');
    const appSecret = this.secrets.get('META_APP_SECRET');

    try {
      // ── Step 1: Exchange single-use code → short-lived token ────────────────
      this.logger.log('[AUTH FLOW] Step 1 — exchanging code for short-lived token');
      const shortLived = await this.defLogger.request<GraphTokenResponse>({
        method: 'GET',
        url: 'https://graph.facebook.com/v19.0/oauth/access_token',
        params: { client_id: appId, client_secret: appSecret, code },
      });
      this.logger.log('[AUTH FLOW] ✓ Short-lived token received');

      // ── Step 2: Extend → long-lived token (60-day) ──────────────────────────
      this.logger.log('[AUTH FLOW] Step 2 — extending to long-lived token');
      const longLived = await this.defLogger.request<GraphTokenResponse>({
        method: 'GET',
        url: 'https://graph.facebook.com/v19.0/oauth/access_token',
        params: {
          grant_type: 'fb_exchange_token',
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: shortLived.access_token,
        },
      });
      this.logger.log('[AUTH FLOW] ✓ Long-lived token received');

      // ── Step 2.5: Confirm the long-lived token resolves to a real user ────────
      // A quick /me call verifies the token is well-formed and accepted by Meta
      // before we make the more expensive WABA and phone-list calls.
      // The returned user ID is logged for traceability (no PII beyond the FB uid).
      this.logger.log('[AUTH FLOW] Step 2.5 — verifying token via GET /me');
      const meResult = await this.defLogger.request<MeResponse>({
        method: 'GET',
        url: 'https://graph.facebook.com/v19.0/me',
        params: { fields: 'id', access_token: longLived.access_token },
      });
      this.logger.log(`[AUTH FLOW] ✓ /me confirmed — fbUserId=${meResult.id}`);

      // ── Step 3: Verify token grants access to the claimed WABA ──────────────
      // Embedded signup tokens are scoped to the WABA that was just set up, not
      // to the broader `whatsapp_business_management` user permission — so we
      // query the WABA node directly rather than listing via /me/whatsapp_business_accounts
      // (which would fail with Error 100 "nonexisting field" if that scope is absent).
      // A successful response proves the token can read the WABA; a 403/error proves it cannot.
      this.logger.log(`[AUTH FLOW] Step 3 — verifying token access to WABA ${wabaId}`);
      const wabaResult = await this.defLogger.request<WabaResponse>({
        method: 'GET',
        url: `https://graph.facebook.com/v19.0/${wabaId}`,
        params: { fields: 'id', access_token: longLived.access_token },
      });

      if (wabaResult?.id !== wabaId) {
        throw new HttpException(
          `Token returned unexpected WABA id=${wabaResult?.id ?? 'none'} — expected ${wabaId}`,
          HttpStatus.FORBIDDEN,
        );
      }
      this.logger.log(`[AUTH FLOW] ✓ WABA ${wabaId} verified`);

      // ── Step 4: Fetch WABA phone list ────────────────────────────────────────
      // One API call handles three things:
      //   a) Registration limit guard (max 2 phones per WABA)
      //   b) phoneNumberId confirmation when provided by the frontend
      //   c) phoneNumberId auto-discovery when NOT provided (webhook-only path:
      //      PARTNER_APP_INSTALLED sends wabaId only, not phoneNumberId)
      this.logger.log(`[AUTH FLOW] Step 4 — fetching phone list for WABA ${wabaId}`);
      const phonesResult = await this.defLogger.request<PhoneNumberListResponse>({
        method: 'GET',
        url: `https://graph.facebook.com/v19.0/${wabaId}/phone_numbers`,
        params: {
          fields: 'id,verified_name,display_phone_number',
          access_token: longLived.access_token,
        },
      });

      const phoneList = phonesResult?.data ?? [];
      this.logger.log(
        `[AUTH FLOW] Phone list (${phoneList.length}): [${phoneList
          .map((p) => `${p.id}(${p.display_phone_number ?? '?'})`)
          .join(', ')}]`,
      );

      if (phoneList.length >= MAX_PHONE_NUMBERS_PER_WABA) {
        this.logger.warn(
          `[AUTH FLOW] ✗ Registration limit: ${phoneList.length}/${MAX_PHONE_NUMBERS_PER_WABA} phones on WABA`,
        );
        throw new HttpException('REGISTRATION_LIMIT_REACHED', HttpStatus.CONFLICT);
      }

      // Resolve the phoneNumberId to persist
      let resolvedPhoneNumberId = phoneNumberId;
      if (!resolvedPhoneNumberId) {
        if (!phoneList.length) {
          throw new HttpException(
            'No phone numbers found on WABA after signup — cannot complete registration',
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        resolvedPhoneNumberId = phoneList[0].id;
        const p = phoneList[0];
        this.logger.log(
          `[AUTH FLOW] phoneNumberId not in DTO — resolved from WABA list: ${p.id} (${p.display_phone_number ?? 'unknown'})`,
        );
      } else {
        const found = phoneList.find((p) => p.id === resolvedPhoneNumberId);
        this.logger.log(
          found
            ? `[AUTH FLOW] ✓ phoneNumberId ${resolvedPhoneNumberId} confirmed (${found.display_phone_number ?? 'unknown'})`
            : `[AUTH FLOW] ⚠ phoneNumberId ${resolvedPhoneNumberId} not in WABA phone list — using as provided`,
        );
      }

      // ── Step 5: Register phone number with WhatsApp Cloud API ────────────────
      // This call "activates" the number on the WhatsApp network. Without it,
      // the number remains in "Pending" state and consumers see "Invite to WhatsApp"
      // instead of a live business profile. The `pin` field sets the two-step
      // verification (2FA) PIN for the number.
      //
      // Set META_PHONE_2FA_PIN in .env.secrets for production.
      // Default '000000' is acceptable for dev/sandbox numbers only.
      const pin = this.secrets.get('META_PHONE_2FA_PIN') ?? '000000';
      if (pin === '000000') {
        this.logger.warn(
          '[AUTH FLOW] Using default 2FA PIN "000000". Set META_PHONE_2FA_PIN in .env.secrets for production.',
        );
      }
      this.logger.log(
        `[AUTH FLOW] Step 5 — registering phoneNumberId=${resolvedPhoneNumberId} with WhatsApp Cloud API`,
      );
      try {
        const registerResult = await this.defLogger.request<RegisterResponse>({
          method: 'POST',
          url: `https://graph.facebook.com/v19.0/${resolvedPhoneNumberId}/register`,
          headers: { Authorization: `Bearer ${longLived.access_token}` },
          data: { messaging_product: 'whatsapp', pin },
        });
        if (registerResult?.success) {
          this.logger.log(
            `[AUTH FLOW] ✓ phoneNumberId=${resolvedPhoneNumberId} registered on WhatsApp network`,
          );
        }
      } catch (registerErr: any) {
        // Axios errors from /register don't go through DefensiveLoggerService's
        // TokenExpiredError path (registration isn't an OAuth call), so extract
        // the raw Meta error message directly from the axios error response.
        const errMsg = (
          (registerErr?.response?.data?.error?.message as string | undefined) ??
          (registerErr?.message as string | undefined) ??
          'unknown error'
        );
        // If the number was already registered by a previous attempt, treat as success.
        if (errMsg.toLowerCase().includes('already registered')) {
          this.logger.log(
            `[AUTH FLOW] ✓ phoneNumberId=${resolvedPhoneNumberId} already registered — continuing`,
          );
        } else {
          throw new HttpException(
            `Failed to register phone number with WhatsApp: ${errMsg}`,
            HttpStatus.BAD_GATEWAY,
          );
        }
      }

      // ── Step 5.5: Subscribe app to WABA webhook messages ─────────────────────
      // POST /{wabaId}/subscribed_apps tells Meta's routing layer to forward all
      // `messages` events for this WABA to our app's webhook URL.
      // Without this, account_update events arrive but real user messages are
      // silently dropped by Meta before they ever reach ngrok / our backend.
      // Idempotent — re-subscribing an already-subscribed WABA is safe.
      this.logger.log(
        `[AUTH FLOW] Step 5.5 — subscribing app to WABA ${wabaId} webhook messages`,
      );
      try {
        const subResult = await this.defLogger.request<SubscribedAppsResponse>({
          method: 'POST',
          url: `https://graph.facebook.com/v19.0/${wabaId}/subscribed_apps`,
          headers: { Authorization: `Bearer ${longLived.access_token}` },
        });
        if (subResult?.success) {
          this.logger.log(
            `[AUTH FLOW] ✓ App subscribed to WABA ${wabaId} — messages will now route to webhook`,
          );
        }
      } catch (subErr: any) {
        const errMsg = (
          (subErr?.response?.data?.error?.message as string | undefined) ??
          (subErr?.message as string | undefined) ??
          'unknown error'
        );
        if (errMsg.toLowerCase().includes('already subscribed')) {
          this.logger.log(
            `[AUTH FLOW] ✓ App already subscribed to WABA ${wabaId} — continuing`,
          );
        } else {
          throw new HttpException(
            `Failed to subscribe app to WABA webhook: ${errMsg}`,
            HttpStatus.BAD_GATEWAY,
          );
        }
      }

      // ── Step 6: Write ACTIVE to Firestore ────────────────────────────────────
      const freshSnap = await docRef.get();
      const priorStatus = freshSnap.exists
        ? (freshSnap.data()?.status as string)
        : 'none';
      if (priorStatus === IntegrationStatus.PENDING_TOKEN) {
        this.logger.log(
          `[AUTH FLOW] ✓ Upgrading PENDING_TOKEN → ACTIVE for businessId=${businessId}`,
        );
      }

      const activePayload = {
        businessId,
        status: IntegrationStatus.ACTIVE,
        metaData: {
          wabaId,
          phoneNumberId: resolvedPhoneNumberId,
          accessToken: longLived.access_token,
          tokenType: 'LONG_LIVED',
        },
        updatedAt: new Date().toISOString(),
      };

      this.logger.log(`[FIRESTORE WRITE] integrations/${businessId} — ACTIVE`);
      console.dir(activePayload, { depth: null });

      await this.firebase.set(docRef, activePayload, { merge: true });

      this.logger.log(
        `[TOKEN_EXCHANGE] ✓ Completed — businessId=${businessId} phoneNumberId=${resolvedPhoneNumberId}`,
      );

      // ── Step 7: System User token escalation (non-fatal) ────────────────────
      await this.systemUser.tryEscalate(businessId, longLived.access_token);

      return { status: IntegrationStatus.ACTIVE };
    } catch (err: any) {
      // ── TokenExpiredError: single-use code was already consumed ──────────────
      // Return 410 Gone so the frontend stops retrying (retrying a dead code
      // just generates more "already used" errors and wastes the user's time).
      // Before surfacing the error, do a final Firestore check — a parallel
      // successful request might have already written ACTIVE.
      if (err instanceof TokenExpiredError) {
        this.logger.error(
          `[TOKEN_EXCHANGE] ✗ TokenExpiredError (Meta code ${err.metaErrorCode}) — ${err.message}`,
        );
        try {
          const recheckSnap = await docRef.get();
          const recheckData = recheckSnap.exists ? recheckSnap.data()! : null;
          const recheckAge = recheckData?.updatedAt
            ? Date.now() - new Date(recheckData.updatedAt as string).getTime()
            : Infinity;
          if (
            recheckData?.status === IntegrationStatus.ACTIVE &&
            recheckData.metaData?.accessToken &&
            recheckAge < ACTIVE_CACHE_TTL_MS
          ) {
            this.logger.log(
              `[TOKEN_EXCHANGE] Code already used BUT Firestore is ACTIVE — treating as success`,
            );
            return { status: IntegrationStatus.ACTIVE };
          }
        } catch {
          // Non-fatal recheck failure — fall through to 410
        }
        throw new HttpException(
          'Token is invalid or already used. Please restart the WhatsApp signup flow.',
          HttpStatus.GONE, // 410 — frontend must NOT retry with the same code
        );
      }

      // Re-throw controlled HttpExceptions (limit, WABA access, etc.) as-is
      if (err instanceof HttpException) {
        this.logger.error(`[TOKEN_EXCHANGE] ✗ ${err.message}`);
        throw err;
      }

      if (
        err?.code === 'permission-denied' ||
        err?.message?.includes('PERMISSION_DENIED')
      ) {
        this.logger.error(
          "CRITICAL: Service Account lacks 'Cloud Datastore User' role, or project does not match credentials.",
        );
      }

      this.logger.error(
        `[TOKEN_EXCHANGE] ✗ Unexpected error: ${err.message as string}`,
      );
      throw new HttpException(
        `Token exchange failed: ${err.message as string}`,
        HttpStatus.BAD_GATEWAY,
      );
    } finally {
      // Always release the lock so subsequent legitimate attempts can proceed
      this.exchangeInProgress.delete(businessId);
    }
  }
}

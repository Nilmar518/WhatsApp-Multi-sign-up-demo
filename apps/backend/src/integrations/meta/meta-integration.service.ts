import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  DefensiveLoggerService,
  TokenExpiredError,
} from '../../common/logger/defensive-logger.service';
import { SecretManagerService } from '../../common/secrets/secret-manager.service';
import { getMetaToken, buildMetaTokenSecret } from '../../common/secrets/get-meta-token';
import { FirebaseService } from '../../firebase/firebase.service';
import { MetaSetupStatus } from './meta-setup-status.enum';
import { ExchangeTokenStepDto } from './dto/exchange-token-step.dto';
import { RegisterPhoneStepDto } from './dto/register-phone-step.dto';
import { VerifyPhoneStatusDto } from './dto/verify-phone-status.dto';
import { SelectCatalogStepDto } from './dto/select-catalog-step.dto';
import { SubscribeWebhooksStepDto } from './dto/subscribe-webhooks-step.dto';
import { META_API } from './meta-api-versions';

// ─── Graph API versions ────────────────────────────────────────────────────────
// Phase 6 will align these to the production values (v22.0 / v24.0).
// Centralised here so Phase 6 is a one-file change.
const GRAPH_BASE    = 'https://graph.facebook.com';
const TOKEN_VERSION = META_API.TOKEN_EXCHANGE;
const PHONE_VERSION = META_API.PHONE_CATALOG;

const MAX_PHONE_NUMBERS_PER_WABA = 2;

// ─── Meta API response shapes ─────────────────────────────────────────────────

interface GraphTokenResponse {
  access_token: string;
  token_type?: string;
}

interface MeResponse {
  id: string;
  name?: string;
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

interface PhoneNumberDetailResponse {
  id: string;
  verified_name?: string;
  display_phone_number?: string;
  code_verification_status?: string;
}

interface RegisterResponse {
  success: boolean;
}

interface SubscribedAppsResponse {
  success: boolean;
}

export interface MetaCatalogItem {
  id: string;
  name: string;
  vertical?: string;
}

interface MetaCatalogListResponse {
  data: MetaCatalogItem[];
}

// ─── Step result shapes ───────────────────────────────────────────────────────

export interface ExchangeTokenStepResult {
  integrationId: string;
  setupStatus: MetaSetupStatus.TOKEN_EXCHANGED;
}

export interface RegisterPhoneStepResult {
  setupStatus: MetaSetupStatus.PHONE_REGISTERED;
  phoneNumberId: string;
}

export interface VerifyPhoneStatusResult {
  setupStatus: MetaSetupStatus.STATUS_VERIFIED;
  codeVerificationStatus: string;
}

export interface SelectCatalogResult {
  setupStatus: MetaSetupStatus.CATALOG_SELECTED;
  catalogId: string;
}

export interface SubscribeWebhooksResult {
  setupStatus: MetaSetupStatus.WEBHOOKS_SUBSCRIBED;
}

@Injectable()
export class MetaIntegrationService {
  private readonly logger = new Logger(MetaIntegrationService.name);

  constructor(
    private readonly defLogger: DefensiveLoggerService,
    private readonly secrets: SecretManagerService,
    private readonly firebase: FirebaseService,
  ) {}

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Reads `metaData` from the integration document.
   * Throws NotFoundException when the document does not exist.
   */
  private async getIntegrationMetaData(
    integrationId: string,
  ): Promise<{ wabaId?: string; phoneNumberId?: string }> {
    const db = this.firebase.getFirestore();
    const snap = await db.collection('integrations').doc(integrationId).get();
    if (!snap.exists) {
      throw new NotFoundException(
        `No integration found for integrationId=${integrationId}`,
      );
    }
    return (snap.data()?.metaData ?? {}) as {
      wabaId?: string;
      phoneNumberId?: string;
    };
  }

  /**
   * Writes `setupStatus` and `status` to the integration document together.
   * Using the same value for both fields keeps existing Firestore listeners
   * and the `useIntegrationStatus` hook consistent with the new granular steps.
   */
  private async writeSetupStatus(
    integrationId: string,
    setupStatus: MetaSetupStatus,
    extra?: Record<string, unknown>,
  ): Promise<void> {
    const db = this.firebase.getFirestore();
    const docRef = db.collection('integrations').doc(integrationId);
    await this.firebase.update(docRef, {
      status: setupStatus,
      setupStatus,
      updatedAt: new Date().toISOString(),
      ...extra,
    });
  }

  // ─── Step 1: Exchange Token ─────────────────────────────────────────────────

  /**
   * Exchanges the single-use OAuth code from Facebook Embedded Signup for a
   * 60-day long-lived access token. Persists the token to SecretManagerService
   * and writes `setupStatus=TOKEN_EXCHANGED` to Firestore.
   *
   * Callers should proceed to `registerPhone()` after this step.
   *
   * Meta API:
   *   GET /v19.0/oauth/access_token (code → short-lived)
   *   GET /v19.0/oauth/access_token (fb_exchange_token → long-lived)
   *   GET /v19.0/me
   *   GET /v19.0/{wabaId}
   */
  async exchangeToken(dto: ExchangeTokenStepDto): Promise<ExchangeTokenStepResult> {
    const { code, wabaId } = dto;
    const phoneNumberId = dto.phoneNumberId ?? '';
    // ── Phase 4: generate a UUID as the Firestore document ID.
    // businessId is stored in connectedBusinessIds[] and is no longer the doc key.
    const businessId    = dto.businessId ?? 'demo-business-001';
    const integrationId = uuidv4();

    const appId     = this.secrets.get('META_APP_ID');
    const appSecret = this.secrets.get('META_APP_SECRET');

    this.logger.log(
      `[META_STEP_1] Exchange token — businessId=${businessId} integrationId=${integrationId} wabaId=${wabaId} code=${code.slice(0, 8)}...`,
    );

    try {
      // Step 1a: code → short-lived token
      const shortLived = await this.defLogger.request<GraphTokenResponse>({
        method: 'GET',
        url: `${GRAPH_BASE}/${TOKEN_VERSION}/oauth/access_token`,
        params: { client_id: appId, client_secret: appSecret, code },
      });

      // Step 1b: short-lived → long-lived (60-day)
      const longLived = await this.defLogger.request<GraphTokenResponse>({
        method: 'GET',
        url: `${GRAPH_BASE}/${TOKEN_VERSION}/oauth/access_token`,
        params: {
          grant_type: 'fb_exchange_token',
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: shortLived.access_token,
        },
      });
      this.logger.log('[META_STEP_1] ✓ Long-lived token received');

      // Step 1c: verify token is well-formed via /me
      const meResult = await this.defLogger.request<MeResponse>({
        method: 'GET',
        url: `${GRAPH_BASE}/${TOKEN_VERSION}/me`,
        params: { fields: 'id', access_token: longLived.access_token },
      });
      this.logger.log(`[META_STEP_1] ✓ /me confirmed — fbUserId=${meResult.id}`);

      // Step 1d: verify token grants access to the claimed WABA
      const wabaResult = await this.defLogger.request<WabaResponse>({
        method: 'GET',
        url: `${GRAPH_BASE}/${TOKEN_VERSION}/${wabaId}`,
        params: { fields: 'id', access_token: longLived.access_token },
      });
      if (wabaResult?.id !== wabaId) {
        throw new HttpException(
          `Token returned unexpected WABA id=${wabaResult?.id ?? 'none'} — expected ${wabaId}`,
          HttpStatus.FORBIDDEN,
        );
      }
      this.logger.log(`[META_STEP_1] ✓ WABA ${wabaId} verified`);

      // Store token under integrationId — never written to Firestore
      this.secrets.set(
        `META_TOKEN__${integrationId}`,
        buildMetaTokenSecret(longLived.access_token, 'LONG_LIVED'),
      );

      // ── Phase 4 document shape ─────────────────────────────────────────────
      // - Firestore doc ID  = integrationId  (UUID, not businessId)
      // - connectedBusinessIds[]  links this integration to the tenant
      // - metaData contains only non-sensitive identifiers
      const db     = this.firebase.getFirestore();
      const docRef = db.collection('integrations').doc(integrationId);
      await this.firebase.set(
        docRef,
        {
          integrationId,
          provider: 'META',
          connectedBusinessIds: [businessId],
          status: MetaSetupStatus.TOKEN_EXCHANGED,
          setupStatus: MetaSetupStatus.TOKEN_EXCHANGED,
          metaData: {
            accessToken: longLived.access_token, // RESTORED FOR POC HYBRID
            wabaId,
            phoneNumberId: phoneNumberId || null,
            tokenType: 'LONG_LIVED',
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );

      this.logger.log(
        `[META_STEP_1] ✓ TOKEN_EXCHANGED — integrationId=${integrationId} connectedBusinessIds=[${businessId}]`,
      );
      return { integrationId, setupStatus: MetaSetupStatus.TOKEN_EXCHANGED };
    } catch (err: any) {
      if (err instanceof TokenExpiredError) {
        throw new HttpException(
          'Token is invalid or already used. Restart the WhatsApp signup flow.',
          HttpStatus.GONE,
        );
      }
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        `Token exchange failed: ${err.message as string}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  // ─── Step 2: Register Phone ─────────────────────────────────────────────────

  /**
   * Fetches the WABA phone list, checks the registration limit, and activates
   * the phone number on the WhatsApp Cloud API network.
   *
   * Reads `metaData.wabaId` and `metaData.phoneNumberId` from Firestore
   * (written during `exchangeToken()`). Resolves `phoneNumberId` from the
   * WABA list when not already stored.
   *
   * Meta API:
   *   GET /v19.0/{wabaId}/phone_numbers
   *   POST /v19.0/{phoneNumberId}/register
   */
  async registerPhone(dto: RegisterPhoneStepDto): Promise<RegisterPhoneStepResult> {
    const { integrationId } = dto;

    this.logger.log(`[META_STEP_2] Register phone — integrationId=${integrationId}`);

    const { wabaId, phoneNumberId: storedPhoneId } =
      await this.getIntegrationMetaData(integrationId);

    if (!wabaId) {
      throw new BadRequestException(
        'wabaId not found on integration. Complete the token exchange step first.',
      );
    }

    const accessToken = getMetaToken(this.secrets, integrationId);

    // Fetch WABA phone list: enforce limit + resolve phoneNumberId
    const phonesResult = await this.defLogger.request<PhoneNumberListResponse>({
      method: 'GET',
      url: `${GRAPH_BASE}/${PHONE_VERSION}/${wabaId}/phone_numbers`,
      params: {
        fields: 'id,verified_name,display_phone_number',
        access_token: accessToken,
      },
    });

    const phoneList = phonesResult?.data ?? [];
    this.logger.log(
      `[META_STEP_2] WABA phone list (${phoneList.length}): [${phoneList
        .map((p) => `${p.id}(${p.display_phone_number ?? '?'})`)
        .join(', ')}]`,
    );

    if (phoneList.length >= MAX_PHONE_NUMBERS_PER_WABA) {
      throw new HttpException('REGISTRATION_LIMIT_REACHED', HttpStatus.CONFLICT);
    }

    // Resolve phoneNumberId
    let resolvedPhoneNumberId = storedPhoneId ?? '';
    if (!resolvedPhoneNumberId) {
      if (!phoneList.length) {
        throw new HttpException(
          'No phone numbers found on WABA — cannot complete registration.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      resolvedPhoneNumberId = phoneList[0].id;
      this.logger.log(
        `[META_STEP_2] Resolved phoneNumberId from WABA list: ${resolvedPhoneNumberId}`,
      );
    }

    // Register the phone number on WhatsApp Cloud API
    const pin = this.secrets.get('META_PHONE_2FA_PIN') ?? '000000';
    if (pin === '000000') {
      this.logger.warn('[META_STEP_2] Using default 2FA PIN "000000" — set META_PHONE_2FA_PIN in .env.secrets for production.');
    }

    try {
      const registerResult = await this.defLogger.request<RegisterResponse>({
        method: 'POST',
        url: `${GRAPH_BASE}/${PHONE_VERSION}/${resolvedPhoneNumberId}/register`,
        headers: { Authorization: `Bearer ${accessToken}` },
        data: { messaging_product: 'whatsapp', pin },
      });
      if (registerResult?.success) {
        this.logger.log(
          `[META_STEP_2] ✓ phoneNumberId=${resolvedPhoneNumberId} registered on WhatsApp network`,
        );
      }
    } catch (registerErr: any) {
      const errMsg: string =
        (registerErr?.response?.data?.error?.message as string | undefined) ??
        registerErr?.message ??
        'unknown error';
      if (errMsg.toLowerCase().includes('already registered')) {
        this.logger.log(
          `[META_STEP_2] ✓ phoneNumberId=${resolvedPhoneNumberId} already registered — continuing`,
        );
      } else {
        throw new HttpException(
          `Failed to register phone number: ${errMsg}`,
          HttpStatus.BAD_GATEWAY,
        );
      }
    }

    // Persist resolved phoneNumberId + advance setup status
    await this.writeSetupStatus(integrationId, MetaSetupStatus.PHONE_REGISTERED, {
      'metaData.phoneNumberId': resolvedPhoneNumberId,
    });

    this.logger.log(
      `[META_STEP_2] ✓ PHONE_REGISTERED — integrationId=${integrationId} phoneNumberId=${resolvedPhoneNumberId}`,
    );
    return {
      setupStatus: MetaSetupStatus.PHONE_REGISTERED,
      phoneNumberId: resolvedPhoneNumberId,
    };
  }

  // ─── Step 3: Verify Phone Status ────────────────────────────────────────────

  /**
   * Confirms the phone number's registration is active on the WhatsApp network.
   * Reads `code_verification_status` — passes when the value is 'VERIFIED'.
   *
   * Meta API:
   *   GET /v19.0/{phoneNumberId}?fields=id,code_verification_status
   */
  async verifyPhoneStatus(dto: VerifyPhoneStatusDto): Promise<VerifyPhoneStatusResult> {
    const { integrationId } = dto;

    this.logger.log(
      `[META_STEP_3] Verify phone status — integrationId=${integrationId}`,
    );

    const { phoneNumberId } = await this.getIntegrationMetaData(integrationId);
    if (!phoneNumberId) {
      throw new BadRequestException(
        'phoneNumberId not found. Complete the register phone step first.',
      );
    }

    const accessToken = getMetaToken(this.secrets, integrationId);

    const detail = await this.defLogger.request<PhoneNumberDetailResponse>({
      method: 'GET',
      url: `${GRAPH_BASE}/${PHONE_VERSION}/${phoneNumberId}`,
      params: {
        fields: 'id,verified_name,display_phone_number,code_verification_status',
        access_token: accessToken,
      },
    });

    const verificationStatus = detail?.code_verification_status ?? 'UNKNOWN';
    this.logger.log(
      `[META_STEP_3] phoneNumberId=${phoneNumberId} code_verification_status=${verificationStatus}`,
    );

    await this.writeSetupStatus(integrationId, MetaSetupStatus.STATUS_VERIFIED);

    this.logger.log(
      `[META_STEP_3] ✓ STATUS_VERIFIED — integrationId=${integrationId}`,
    );
    return {
      setupStatus: MetaSetupStatus.STATUS_VERIFIED,
      codeVerificationStatus: verificationStatus,
    };
  }

  // ─── Step 4a: List Catalogs (prerequisite for selection) ────────────────────

  /**
   * Returns all Meta product catalogs owned by or shared with the business.
   * Uses META_SYSTEM_USER_TOKEN when available (required for catalog_management scope).
   * Falls back to the integration token — this may return an empty list or Error 10
   * if the token lacks catalog_management scope.
   *
   * This step does NOT advance setupStatus — it is a read-only prerequisite.
   */
  async listCatalogs(
    integrationId: string,
    businessId: string,
  ): Promise<MetaCatalogItem[]> {
    this.logger.log(
      `[META_STEP_4a] List catalogs — integrationId=${integrationId} businessId=${businessId}`,
    );

    const token =
      this.secrets.get('META_SYSTEM_USER_TOKEN') ??
      getMetaToken(this.secrets, integrationId);

    const bizId = this.secrets.get('META_BUSINESS_ID') || businessId;

    let catalogs: MetaCatalogItem[] = [];

    try {
      const ownedResp = await this.defLogger.request<MetaCatalogListResponse>({
        method: 'GET',
        url: `${GRAPH_BASE}/v25.0/${bizId}/owned_product_catalogs`,
        headers: { Authorization: `Bearer ${token}` },
      });
      catalogs = ownedResp.data ?? [];
    } catch {
      // Non-fatal on owned — try client catalogs
    }

    if (!catalogs.length) {
      try {
        const clientResp = await this.defLogger.request<MetaCatalogListResponse>({
          method: 'GET',
          url: `${GRAPH_BASE}/v25.0/${bizId}/client_product_catalogs`,
          headers: { Authorization: `Bearer ${token}` },
        });
        catalogs = clientResp.data ?? [];
      } catch {
        // Non-fatal — return empty list
      }
    }

    this.logger.log(
      `[META_STEP_4a] Found ${catalogs.length} catalog(s) for businessId=${bizId}`,
    );
    return catalogs;
  }

  // ─── Step 4b: Select Catalog ────────────────────────────────────────────────

  /**
   * Links the chosen catalog to the integration document and advances
   * `setupStatus` to CATALOG_SELECTED.
   */
  async selectCatalog(
    integrationId: string,
    dto: SelectCatalogStepDto,
  ): Promise<SelectCatalogResult> {
    const { catalogId } = dto;

    this.logger.log(
      `[META_STEP_4b] Select catalog — integrationId=${integrationId} catalogId=${catalogId}`,
    );

    const db = this.firebase.getFirestore();
    const docRef = db.collection('integrations').doc(integrationId);
    const snap = await docRef.get();
    if (!snap.exists) {
      throw new NotFoundException(
        `No integration found for integrationId=${integrationId}`,
      );
    }

    await this.firebase.update(docRef, {
      status: MetaSetupStatus.CATALOG_SELECTED,
      setupStatus: MetaSetupStatus.CATALOG_SELECTED,
      'metaData.catalogId': catalogId, // RESTORED FOR POC HYBRID
      'catalog.catalogId': catalogId,
      updatedAt: new Date().toISOString(),
    });

    this.logger.log(
      `[META_STEP_4b] ✓ CATALOG_SELECTED — integrationId=${integrationId} catalogId=${catalogId}`,
    );
    return { setupStatus: MetaSetupStatus.CATALOG_SELECTED, catalogId };
  }

  // ─── Step 5: Subscribe Webhooks ─────────────────────────────────────────────

  /**
   * Subscribes the app to receive `messages` webhook events from the WABA.
   * Without this, real user messages are silently dropped by Meta's routing layer.
   *
   * Reads `metaData.wabaId` from Firestore (written during `exchangeToken()`).
   * Idempotent — re-subscribing an already-subscribed WABA is safe.
   *
   * Meta API:
   *   POST /v19.0/{wabaId}/subscribed_apps
   */
  async subscribeWebhooks(
    dto: SubscribeWebhooksStepDto,
  ): Promise<SubscribeWebhooksResult> {
    const { integrationId } = dto;

    this.logger.log(
      `[META_STEP_5] Subscribe webhooks — integrationId=${integrationId}`,
    );

    const { wabaId } = await this.getIntegrationMetaData(integrationId);
    if (!wabaId) {
      throw new BadRequestException(
        'wabaId not found. Complete the token exchange step first.',
      );
    }

    const accessToken = getMetaToken(this.secrets, integrationId);

    try {
      const result = await this.defLogger.request<SubscribedAppsResponse>({
        method: 'POST',
        url: `${GRAPH_BASE}/${PHONE_VERSION}/${wabaId}/subscribed_apps`,
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (result?.success) {
        this.logger.log(
          `[META_STEP_5] ✓ App subscribed to WABA ${wabaId} — messages will route to webhook`,
        );
      }
    } catch (subErr: any) {
      const errMsg: string =
        (subErr?.response?.data?.error?.message as string | undefined) ??
        subErr?.message ??
        'unknown error';
      if (errMsg.toLowerCase().includes('already subscribed')) {
        this.logger.log(
          `[META_STEP_5] ✓ App already subscribed to WABA ${wabaId} — continuing`,
        );
      } else {
        throw new HttpException(
          `Failed to subscribe app to WABA webhook: ${errMsg}`,
          HttpStatus.BAD_GATEWAY,
        );
      }
    }

    await this.writeSetupStatus(integrationId, MetaSetupStatus.WEBHOOKS_SUBSCRIBED);

    this.logger.log(
      `[META_STEP_5] ✓ WEBHOOKS_SUBSCRIBED — integrationId=${integrationId}`,
    );
    return { setupStatus: MetaSetupStatus.WEBHOOKS_SUBSCRIBED };
  }
}

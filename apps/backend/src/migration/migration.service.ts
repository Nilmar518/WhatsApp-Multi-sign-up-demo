import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { DefensiveLoggerService } from '../common/logger/defensive-logger.service';
import { SecretManagerService } from '../common/secrets/secret-manager.service';
import { buildMetaTokenSecret } from '../common/secrets/get-meta-token';
import { FirebaseService } from '../firebase/firebase.service';
import { StartMigrationDto } from './dto/start-migration.dto';
import { ProvisionPhoneDto } from './dto/provision-phone.dto';
import { MigrationRequestCodeDto } from './dto/migration-request-code.dto';
import { MigrationVerifyCodeDto } from './dto/migration-verify-code.dto';
import { MigrationCompleteDto } from './dto/migration-complete.dto';
import { META_API } from '../integrations/meta/meta-api-versions';

/** Transient status that locks the businessId slot during an active migration. */
export const MIGRATING_STATUS = 'MIGRATING';

/** All v25.0 — isolated from the v19.0 calls in auth.service.ts */
const GRAPH_VERSION = META_API.WABA_ADMIN;

interface PhoneNumberProvisionResponse {
  id: string;
  verified_name?: string;
  display_phone_number?: string;
}

interface SimpleSuccessResponse {
  success: boolean;
}

/** Shape of a single WABA returned by the Business Manager discovery call. */
export interface WabaEntry {
  id: string;
  name?: string;
  currency?: string;
  timezone_id?: string;
}

interface OwnedWabaResponse {
  data: WabaEntry[];
}

interface PhoneListEntry {
  id: string;
  display_phone_number: string;
}

interface PhoneListResponse {
  data: PhoneListEntry[];
}

@Injectable()
export class MigrationService {
  private readonly logger = new Logger(MigrationService.name);

  constructor(
    private readonly defLogger: DefensiveLoggerService,
    private readonly secrets: SecretManagerService,
    private readonly firebase: FirebaseService,
  ) {}

  /**
   * Reads META_SYSTEM_USER_TOKEN from secrets.
   * Returns 503 with a clear message if not configured.
   */
  private getSystemUserToken(): string {
    const token = this.secrets.get('META_SYSTEM_USER_TOKEN');
    if (!token) {
      throw new HttpException(
        'META_SYSTEM_USER_TOKEN is not configured. Add it to .env.secrets to use Force Migration.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return token;
  }

  /**
   * Extracts the Meta error message from an Axios error response.
   * Falls back to err.message if the response envelope is absent.
   */
  private extractMetaError(err: any): string {
    return (
      (err?.response?.data?.error?.message as string | undefined) ??
      (err?.message as string | undefined) ??
      'Unknown error'
    );
  }

  // ── Step 0: Provision ──────────────────────────────────────────────────────

  /**
   * Adds a new phone number to the target WABA via the Meta API, returning the
   * Meta-assigned `phone_number_id` needed for the subsequent OTP steps.
   *
   * The businessId slot in Firestore is immediately written with MIGRATING
   * status so that no parallel request can start a conflicting signup flow.
   *
   * Meta endpoint: POST /v25.0/{wabaId}/phone_numbers
   *
   * Prerequisites:
   *   - META_SYSTEM_USER_TOKEN in .env.secrets with whatsapp_business_management scope
   *   - The target WABA must have capacity for another phone number
   */
  async provision(dto: ProvisionPhoneDto): Promise<{ phoneNumberId: string }> {
    const { businessId, wabaId, cc, phoneNumber, verifiedName } = dto;
    const token = this.getSystemUserToken();

    this.logger.log(
      `[MIGRATION] Provision — businessId=${businessId} wabaId=${wabaId} number=+${cc}${phoneNumber}`,
    );

    const db = this.firebase.getFirestore();
    const docRef = db.collection('integrations').doc(businessId);

    // Lock the slot immediately — prevents auth.service from racing on same businessId
    await this.firebase.set(
      docRef,
      {
        businessId,
        status: MIGRATING_STATUS,
        metaData: { wabaId },
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
    this.logger.log(`[MIGRATION] ✓ MIGRATING status written for businessId=${businessId}`);

    try {
      const result = await this.defLogger.request<PhoneNumberProvisionResponse>({
        method: 'POST',
        url: `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/phone_numbers`,
        headers: { Authorization: `Bearer ${token}` },
        data: {
          cc,
          phone_number: phoneNumber,
          verified_name: verifiedName,
          type: 'VOICE_OR_TEXT',
        },
      });

      const phoneNumberId = result?.id;
      if (!phoneNumberId) {
        throw new Error('Meta did not return a phone_number_id in the /phone_numbers response');
      }

      // Persist phoneNumberId into the MIGRATING document for observability
      await this.firebase.set(
        docRef,
        {
          metaData: { wabaId, phoneNumberId },
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );

      this.logger.log(
        `[MIGRATION] ✓ Provisioned phoneNumberId=${phoneNumberId} (${result?.display_phone_number ?? '+' + cc + phoneNumber})`,
      );
      return { phoneNumberId };
    } catch (err: any) {
      // Roll back MIGRATING → ERROR so the UI doesn't get stuck
      await this.firebase
        .set(
          docRef,
          {
            status: 'ERROR',
            'metaData.error': this.extractMetaError(err),
            updatedAt: new Date().toISOString(),
          },
          { merge: true },
        )
        .catch(() => {/* rollback is best-effort */});

      if (err instanceof HttpException) throw err;
      throw new HttpException(
        `Provision failed: ${this.extractMetaError(err)}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  // ── Step 1: Request OTP ────────────────────────────────────────────────────

  /**
   * Triggers Meta to send a 6-digit OTP to the phone's physical SIM via SMS
   * or a VOICE call. This is the first OTP step in the migration sequence.
   *
   * Meta endpoint: POST /v25.0/{phoneNumberId}/request_code
   */
  async requestCode(dto: MigrationRequestCodeDto): Promise<{ success: true; message: string }> {
    const { phoneNumberId, codeMethod } = dto;
    const token = this.getSystemUserToken();

    this.logger.log(
      `[MIGRATION] Step 1 — OTP via ${codeMethod} for phoneNumberId=${phoneNumberId}`,
    );

    try {
      const result = await this.defLogger.request<SimpleSuccessResponse>({
        method: 'POST',
        url: `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/request_code`,
        headers: { Authorization: `Bearer ${token}` },
        data: { code_method: codeMethod, language: 'en_US' },
      });

      if (!result?.success) {
        throw new Error('Meta returned success=false for /request_code');
      }

      this.logger.log(`[MIGRATION] ✓ OTP requested — method=${codeMethod}`);
      return {
        success: true,
        message: `Verification code sent via ${codeMethod}.`,
      };
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        `Failed to request OTP: ${this.extractMetaError(err)}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  // ── Step 2: Verify OTP ────────────────────────────────────────────────────

  /**
   * Submits the 6-digit OTP received on the physical SIM.
   *
   * A successful response from Meta confirms ownership of the number and
   * atomically disconnects it from any active consumer WhatsApp account —
   * bypassing the "Delete Account" requirement entirely. After this call
   * the number is held in a transitional state waiting for /register.
   *
   * Meta endpoint: POST /v25.0/{phoneNumberId}/verify_code
   */
  async verifyCode(dto: MigrationVerifyCodeDto): Promise<{ success: true; message: string }> {
    const { phoneNumberId, code } = dto;
    const token = this.getSystemUserToken();

    this.logger.log(`[MIGRATION] Step 2 — verifying OTP for phoneNumberId=${phoneNumberId}`);

    try {
      const result = await this.defLogger.request<SimpleSuccessResponse>({
        method: 'POST',
        url: `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/verify_code`,
        headers: { Authorization: `Bearer ${token}` },
        data: { code },
      });

      if (!result?.success) {
        throw new Error('Meta returned success=false for /verify_code');
      }

      this.logger.log(
        `[MIGRATION] ✓ OTP verified — phoneNumberId=${phoneNumberId} disconnected from consumer WhatsApp`,
      );
      return {
        success: true,
        message: 'Verified. Number disconnected from consumer WhatsApp.',
      };
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        `Failed to verify OTP: ${this.extractMetaError(err)}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  // ── Step 3: Complete ──────────────────────────────────────────────────────

  /**
   * Finalizes the migration:
   *   a) Registers the number on WhatsApp Cloud API (sets the 2FA PIN and
   *      activates the business profile — consumers see a business card
   *      instead of "Invite to WhatsApp")
   *   b) Subscribes the WABA to receive `messages` webhook events
   *   c) Writes ACTIVE to Firestore — identical schema to auth.service.ts so
   *      existing onSnapshot listeners, messaging, and catalog flows work
   *      immediately without any modification
   *
   * Meta endpoints:
   *   POST /v25.0/{phoneNumberId}/register
   *   POST /v25.0/{wabaId}/subscribed_apps
   *
   * tokenType is set to 'SYSTEM_USER' to distinguish from the OAuth
   * long-lived tokens created by auth.service.ts.
   */
  async complete(dto: MigrationCompleteDto): Promise<{ success: true; status: string }> {
    const { businessId, phoneNumberId, wabaId, pin } = dto;
    const token = this.getSystemUserToken();

    this.logger.log(
      `[MIGRATION] Step 3 — registering phoneNumberId=${phoneNumberId} for businessId=${businessId}`,
    );

    const db = this.firebase.getFirestore();
    const docRef = db.collection('integrations').doc(businessId);

    try {
      // 3a: Register the phone number
      const registerResult = await this.defLogger.request<SimpleSuccessResponse>({
        method: 'POST',
        url: `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/register`,
        headers: { Authorization: `Bearer ${token}` },
        data: { messaging_product: 'whatsapp', pin },
      });

      if (!registerResult?.success) {
        throw new Error('Meta returned success=false for /register');
      }
      this.logger.log(`[MIGRATION] ✓ phoneNumberId=${phoneNumberId} registered on Cloud API`);

      // 3b: Subscribe WABA to receive messages webhook events
      try {
        await this.defLogger.request<SimpleSuccessResponse>({
          method: 'POST',
          url: `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/subscribed_apps`,
          headers: { Authorization: `Bearer ${token}` },
        });
        this.logger.log(`[MIGRATION] ✓ WABA ${wabaId} subscribed to webhook messages`);
      } catch (subErr: any) {
        const subMsg = this.extractMetaError(subErr).toLowerCase();
        if (subMsg.includes('already subscribed')) {
          this.logger.log(`[MIGRATION] ✓ WABA ${wabaId} already subscribed`);
        } else {
          // Non-fatal: the register succeeded; subscribed_apps can be retried
          // independently (e.g. by reconnecting via the standard OAuth flow)
          this.logger.warn(
            `[MIGRATION] ⚠ subscribed_apps failed (non-fatal): ${this.extractMetaError(subErr)}`,
          );
        }
      }

      // 3c: Store token securely, then write ACTIVE to Firestore.
      // accessToken is NOT written to Firestore — stored in SecretManagerService.
      this.secrets.set(
        `META_TOKEN__${businessId}`,
        buildMetaTokenSecret(token, 'SYSTEM_USER'),
      );

      const activePayload = {
        businessId,
        status: 'ACTIVE',
        metaData: {
          wabaId,
          phoneNumberId,
          tokenType: 'SYSTEM_USER',
        },
        updatedAt: new Date().toISOString(),
      };
      this.logger.log(
        `[FIRESTORE WRITE] integrations/${businessId} — ACTIVE (force-migration)`,
      );
      await this.firebase.set(docRef, activePayload, { merge: true });

      this.logger.log(`[MIGRATION] ✓ Complete — businessId=${businessId} is ACTIVE`);
      return { success: true, status: 'ACTIVE' };
    } catch (err: any) {
      const detail = this.extractMetaError(err);

      // Already registered is an idempotent success
      if (detail.toLowerCase().includes('already registered')) {
        this.logger.log(
          `[MIGRATION] ✓ phoneNumberId=${phoneNumberId} already registered — writing ACTIVE`,
        );
        // Store token securely even on the idempotent path.
        this.secrets.set(
          `META_TOKEN__${businessId}`,
          buildMetaTokenSecret(token, 'SYSTEM_USER'),
        );
        await this.firebase
          .set(
            docRef,
            {
              businessId,
              status: 'ACTIVE',
              metaData: {
                wabaId,
                phoneNumberId,
                tokenType: 'SYSTEM_USER',
              },
              updatedAt: new Date().toISOString(),
            },
            { merge: true },
          )
          .catch(() => {});
        return { success: true, status: 'ACTIVE' };
      }

      // Write ERROR so the UI doesn't get stuck on MIGRATING
      await this.firebase
        .set(
          docRef,
          {
            status: 'ERROR',
            'metaData.error': detail,
            updatedAt: new Date().toISOString(),
          },
          { merge: true },
        )
        .catch(() => {});

      if (err instanceof HttpException) throw err;
      throw new HttpException(
        `Migration completion failed: ${detail}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  // ── Zero-input Start ─────────────────────────────────────────────────────

  /**
   * Parses an E.164 phone string into { cc, number }.
   *
   * Accepted formats: "+591 67025559" | "+59167025559" | "59167025559"
   *
   * Resolution order:
   *   1. META_DEFAULT_CC secret (explicit — fastest, most reliable)
   *   2. Heuristic: try 3-digit, 2-digit, 1-digit prefix — works for most
   *      countries when the number is ≥7 digits after stripping the prefix
   */
  private parseE164(phoneE164: string): { cc: string; number: string } {
    const digits = phoneE164.replace(/[\s\-\(\)]/g, '').replace(/^\+/, '');

    const defaultCC = this.secrets.get('META_DEFAULT_CC');
    if (defaultCC && digits.startsWith(defaultCC)) {
      const number = digits.slice(defaultCC.length);
      if (number.length >= 4) return { cc: defaultCC, number };
    }

    for (const ccLen of [3, 2, 1]) {
      const cc = digits.slice(0, ccLen);
      const number = digits.slice(ccLen);
      if (number.length >= 4) return { cc, number };
    }

    throw new HttpException(
      `Cannot parse "${phoneE164}". Use E.164 format: +591 67025559`,
      HttpStatus.BAD_REQUEST,
    );
  }

  /**
   * Resolves the WABA to use for migration.
   *
   * Resolution order:
   *   1. META_DEFAULT_WABA_ID secret (fastest — skip discovery)
   *   2. GET /owned_whatsapp_business_accounts using META_BUSINESS_ID
   *      (auto-selects the first WABA found)
   */
  private async resolveWabaId(): Promise<string> {
    const configured = this.secrets.get('META_DEFAULT_WABA_ID');
    if (configured) {
      this.logger.log(`[MIGRATION] WABA resolved from META_DEFAULT_WABA_ID: ${configured}`);
      return configured;
    }
    const { wabas } = await this.discoverWaba();
    if (wabas.length === 0) {
      throw new HttpException(
        'No WABAs found. Set META_DEFAULT_WABA_ID or META_BUSINESS_ID in .env.secrets.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    this.logger.log(`[MIGRATION] WABA resolved via discovery: ${wabas[0].id}`);
    return wabas[0].id;
  }

  /**
   * Checks whether a phone number already exists in the WABA's phone list.
   * Returns the existing phoneNumberId if found, null otherwise.
   *
   * This handles the "number already registered in a previous partial signup"
   * case — we reuse the existing ID and skip the provision call entirely.
   */
  private async findExistingPhoneId(
    wabaId: string,
    cc: string,
    number: string,
    token: string,
  ): Promise<string | null> {
    try {
      const result = await this.defLogger.request<PhoneListResponse>({
        method: 'GET',
        url: `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/phone_numbers`,
        headers: { Authorization: `Bearer ${token}` },
        params: { fields: 'id,display_phone_number' },
      });
      const targetDigits = (cc + number).replace(/\D/g, '');
      const match = result?.data?.find((p) => {
        const pDigits = p.display_phone_number.replace(/\D/g, '');
        return pDigits.endsWith(targetDigits) || targetDigits.endsWith(pDigits);
      });
      return match?.id ?? null;
    } catch {
      return null; // non-fatal — fall through to provisioning
    }
  }

  /**
   * Zero-input entry point for the Force Migration flow.
   *
   * The caller only provides a businessId and a phone number in E.164 format.
   * This method handles everything that previously required manual input from
   * the operator:
   *   1. Parse E.164 → cc + number (uses META_DEFAULT_CC secret if configured)
   *   2. Auto-resolve WABA (META_DEFAULT_WABA_ID → discovery via META_BUSINESS_ID)
   *   3. Check if number already exists in WABA → reuse phoneNumberId
   *   4. If not → provision via POST /{wabaId}/phone_numbers
   *   5. Write MIGRATING to Firestore and return { phoneNumberId, wabaId }
   *
   * The verified name for new provisioning falls back to META_DEFAULT_VERIFIED_NAME
   * secret, then to "Business" — the customer never sees or types this value.
   *
   * Meta endpoint (provisioning only): POST /v25.0/{wabaId}/phone_numbers
   */
  async start(dto: StartMigrationDto): Promise<{ phoneNumberId: string; wabaId: string }> {
    const { businessId, phoneE164 } = dto;
    const token = this.getSystemUserToken();

    const { cc, number } = this.parseE164(phoneE164);
    const wabaId = await this.resolveWabaId();
    const verifiedName =
      this.secrets.get('META_DEFAULT_VERIFIED_NAME') ?? 'Business';

    this.logger.log(
      `[MIGRATION] Start — businessId=${businessId} wabaId=${wabaId} +${cc}${number}`,
    );

    const db = this.firebase.getFirestore();
    const docRef = db.collection('integrations').doc(businessId);

    // Lock the slot immediately
    await this.firebase.set(
      docRef,
      {
        businessId,
        status: MIGRATING_STATUS,
        metaData: { wabaId },
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );

    try {
      // Reuse an existing number if one was partially created by a prior signup
      const existingId = await this.findExistingPhoneId(wabaId, cc, number, token);
      let phoneNumberId: string;

      if (existingId) {
        this.logger.log(
          `[MIGRATION] ✓ +${cc}${number} already in WABA — reusing phoneNumberId=${existingId}`,
        );
        phoneNumberId = existingId;
      } else {
        const result = await this.defLogger.request<PhoneNumberProvisionResponse>({
          method: 'POST',
          url: `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/phone_numbers`,
          headers: { Authorization: `Bearer ${token}` },
          data: { cc, phone_number: number, verified_name: verifiedName, type: 'VOICE_OR_TEXT' },
        });
        if (!result?.id) throw new Error('Meta did not return a phone_number_id');
        phoneNumberId = result.id;
        this.logger.log(`[MIGRATION] ✓ Provisioned phoneNumberId=${phoneNumberId}`);
      }

      await this.firebase.set(
        docRef,
        { metaData: { wabaId, phoneNumberId }, updatedAt: new Date().toISOString() },
        { merge: true },
      );

      return { phoneNumberId, wabaId };
    } catch (err: any) {
      await this.firebase
        .set(
          docRef,
          {
            status: 'ERROR',
            'metaData.error': this.extractMetaError(err),
            updatedAt: new Date().toISOString(),
          },
          { merge: true },
        )
        .catch(() => {});
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        `Failed to start migration: ${this.extractMetaError(err)}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  // ── WABA Discovery ────────────────────────────────────────────────────────

  /**
   * Fetches all WABAs owned by or shared with the Meta Business Manager
   * associated with the System User Token. Used as a recovery mechanism when
   * the Embedded Signup popup closes without returning a payload (e.g., due to
   * a "number already registered" error), allowing the system to resolve the
   * WABA_ID programmatically and pre-populate the Force Migration form.
   *
   * Meta endpoint: GET /v25.0/{businessManagerId}/owned_whatsapp_business_accounts
   *
   * businessManagerId falls back to META_BUSINESS_ID from .env.secrets when
   * not provided as a query parameter — satisfying both the automatic recovery
   * path and the manual fallback path.
   */
  async discoverWaba(businessManagerId?: string): Promise<{ wabas: WabaEntry[] }> {
    const token = this.getSystemUserToken();
    const bizId = businessManagerId ?? this.secrets.get('META_BUSINESS_ID');

    if (!bizId) {
      throw new HttpException(
        'No Business Manager ID available. Set META_BUSINESS_ID in .env.secrets or pass businessManagerId as a query param.',
        HttpStatus.BAD_REQUEST,
      );
    }

    this.logger.log(
      `[MIGRATION] Discovery — fetching WABAs for businessManagerId=${bizId}`,
    );

    try {
      const result = await this.defLogger.request<OwnedWabaResponse>({
        method: 'GET',
        url: `https://graph.facebook.com/${GRAPH_VERSION}/${bizId}/owned_whatsapp_business_accounts`,
        headers: { Authorization: `Bearer ${token}` },
        params: { fields: 'id,name,currency,timezone_id' },
      });

      const wabas = result?.data ?? [];
      this.logger.log(
        `[MIGRATION] ✓ Discovery found ${wabas.length} WABA(s) for businessManagerId=${bizId}`,
      );
      return { wabas };
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        `WABA discovery failed: ${this.extractMetaError(err)}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
}

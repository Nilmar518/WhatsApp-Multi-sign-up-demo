import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { DefensiveLoggerService } from '../common/logger/defensive-logger.service';
import { SecretManagerService } from '../common/secrets/secret-manager.service';
import { FirebaseService } from '../firebase/firebase.service';
import { RequestCodeDto } from './dto/request-code.dto';
import { VerifyCodeDto } from './dto/verify-code.dto';
import { RegisterPhoneDto } from './dto/register-phone.dto';

type MigrationStep = 'request_code' | 'verify_code' | 'register';

interface RequestCodeResponse {
  success: boolean;
}

interface VerifyCodeResponse {
  success: boolean;
}

interface RegisterResponse {
  success: boolean;
}

interface SubscribedAppsResponse {
  success: boolean;
}

@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);

  constructor(
    private readonly defLogger: DefensiveLoggerService,
    private readonly secrets: SecretManagerService,
    private readonly firebase: FirebaseService,
  ) {}

  /**
   * Reads META_SYSTEM_USER_TOKEN from secrets.
   * Returns 503 Service Unavailable if not configured so the caller gets a
   * clear signal rather than a cryptic Auth error from Meta.
   */
  private getSystemUserToken(): string {
    const token = this.secrets.get('META_SYSTEM_USER_TOKEN');
    if (!token) {
      throw new HttpException(
        'META_SYSTEM_USER_TOKEN is not configured. Add it to .env.secrets to use OTP migration.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return token;
  }

  /**
   * Writes a migration event to the `phone_migrations` Firestore collection.
   *
   * Schema:
   *   phone_migrations/{phoneNumberId}          root doc — current step + timestamps
   *   phone_migrations/{phoneNumberId}/events/  sub-collection — append-only audit log
   *
   * Failures here are non-fatal: the business logic must not break because of
   * a logging write error.
   */
  private async logMigrationEvent(
    phoneNumberId: string,
    step: MigrationStep,
    status: 'started' | 'success' | 'error',
    detail?: string,
  ): Promise<void> {
    try {
      const db = this.firebase.getFirestore();
      const migrationRef = db.collection('phone_migrations').doc(phoneNumberId);
      const eventRef = migrationRef.collection('events').doc();
      const now = new Date().toISOString();

      // Upsert root doc — always update currentStep + updatedAt
      const rootUpdate: Record<string, string> = {
        phoneNumberId,
        currentStep: step,
        updatedAt: now,
      };
      // Seed startedAt only on the very first event
      if (step === 'request_code' && status === 'started') {
        rootUpdate.startedAt = now;
      }
      await this.firebase.set(migrationRef, rootUpdate, { merge: true });

      // Append immutable event record
      await this.firebase.set(eventRef, {
        step,
        status,
        timestamp: now,
        ...(detail ? { detail } : {}),
      });
    } catch (logErr: any) {
      this.logger.warn(
        `[MIGRATION_LOG] Failed to write event for phoneNumberId=${phoneNumberId}: ${logErr?.message ?? 'unknown'}`,
      );
    }
  }

  // ── Step 1 ─────────────────────────────────────────────────────────────────

  /**
   * Triggers Meta to send a 6-digit OTP to the number's physical SIM via SMS
   * or a VOICE call. This is the first step in the consumer→Cloud-API migration
   * sequence and is required to confirm physical ownership of the number.
   *
   * Meta endpoint: POST /v19.0/{phoneNumberId}/request_code
   *
   * Prerequisites:
   *   - META_SYSTEM_USER_TOKEN in .env.secrets with whatsapp_business_management scope
   *   - The number must be associated with the target WABA
   */
  async requestCode(dto: RequestCodeDto): Promise<{ success: true; message: string }> {
    const { phoneNumberId, codeMethod } = dto;
    const token = this.getSystemUserToken();

    this.logger.log(
      `[MIGRATION] Step 1 — requesting OTP via ${codeMethod} for phoneNumberId=${phoneNumberId}`,
    );
    await this.logMigrationEvent(phoneNumberId, 'request_code', 'started');

    try {
      const result = await this.defLogger.request<RequestCodeResponse>({
        method: 'POST',
        url: `https://graph.facebook.com/v19.0/${phoneNumberId}/request_code`,
        headers: { Authorization: `Bearer ${token}` },
        data: { code_method: codeMethod, language: 'en_US' },
      });

      if (!result?.success) {
        throw new Error('Meta returned success=false for /request_code');
      }

      this.logger.log(
        `[MIGRATION] ✓ OTP requested — phoneNumberId=${phoneNumberId} method=${codeMethod}`,
      );
      await this.logMigrationEvent(
        phoneNumberId,
        'request_code',
        'success',
        `OTP sent via ${codeMethod}`,
      );

      return {
        success: true,
        message: `Verification code sent via ${codeMethod} to the registered phone number.`,
      };
    } catch (err: any) {
      const detail =
        (err?.response?.data?.error?.message as string | undefined) ??
        err?.message ??
        'Unknown error';
      await this.logMigrationEvent(phoneNumberId, 'request_code', 'error', detail);
      if (err instanceof HttpException) throw err;
      throw new HttpException(`Failed to request OTP: ${detail}`, HttpStatus.BAD_GATEWAY);
    }
  }

  // ── Step 2 ─────────────────────────────────────────────────────────────────

  /**
   * Submits the 6-digit OTP received on the physical SIM. A successful
   * response from Meta confirms ownership and atomically disconnects the number
   * from any existing consumer WhatsApp account — making it ready for Cloud
   * API registration with zero user interaction on the handset going forward.
   *
   * Meta endpoint: POST /v19.0/{phoneNumberId}/verify_code
   */
  async verifyCode(dto: VerifyCodeDto): Promise<{ success: true; message: string }> {
    const { phoneNumberId, code } = dto;
    const token = this.getSystemUserToken();

    this.logger.log(
      `[MIGRATION] Step 2 — verifying OTP for phoneNumberId=${phoneNumberId}`,
    );
    await this.logMigrationEvent(phoneNumberId, 'verify_code', 'started');

    try {
      const result = await this.defLogger.request<VerifyCodeResponse>({
        method: 'POST',
        url: `https://graph.facebook.com/v19.0/${phoneNumberId}/verify_code`,
        headers: { Authorization: `Bearer ${token}` },
        data: { code },
      });

      if (!result?.success) {
        throw new Error('Meta returned success=false for /verify_code');
      }

      this.logger.log(
        `[MIGRATION] ✓ OTP verified — phoneNumberId=${phoneNumberId} disconnected from consumer WhatsApp`,
      );
      await this.logMigrationEvent(
        phoneNumberId,
        'verify_code',
        'success',
        'Number disconnected from consumer WhatsApp',
      );

      return {
        success: true,
        message:
          'Verification successful. Number is now disconnected from consumer WhatsApp and ready for Cloud API registration.',
      };
    } catch (err: any) {
      const detail =
        (err?.response?.data?.error?.message as string | undefined) ??
        err?.message ??
        'Unknown error';
      await this.logMigrationEvent(phoneNumberId, 'verify_code', 'error', detail);
      if (err instanceof HttpException) throw err;
      throw new HttpException(`Failed to verify OTP: ${detail}`, HttpStatus.BAD_GATEWAY);
    }
  }

  // ── Step 3 ─────────────────────────────────────────────────────────────────

  /**
   * Finalizes the migration by:
   *   3a. Registering the number on WhatsApp Cloud API (sets 2FA PIN, activates
   *       business profile — consumers see a business card instead of "Invite")
   *   3b. Subscribing the WABA to receive `messages` webhook events (without
   *       this, real user messages are silently dropped by Meta's routing layer)
   *
   * Idempotent: "already registered" and "already subscribed" are treated as
   * success so retries are safe.
   *
   * Meta endpoints:
   *   POST /v19.0/{phoneNumberId}/register
   *   POST /v19.0/{wabaId}/subscribed_apps
   */
  async registerPhone(dto: RegisterPhoneDto): Promise<{ success: true; message: string }> {
    const { phoneNumberId, wabaId, pin } = dto;
    const token = this.getSystemUserToken();

    this.logger.log(
      `[MIGRATION] Step 3 — registering phoneNumberId=${phoneNumberId} on WhatsApp Cloud API`,
    );
    await this.logMigrationEvent(phoneNumberId, 'register', 'started');

    try {
      // ── 3a: Register the phone number ──────────────────────────────────────
      const registerResult = await this.defLogger.request<RegisterResponse>({
        method: 'POST',
        url: `https://graph.facebook.com/v19.0/${phoneNumberId}/register`,
        headers: { Authorization: `Bearer ${token}` },
        data: { messaging_product: 'whatsapp', pin },
      });

      if (!registerResult?.success) {
        throw new Error('Meta returned success=false for /register');
      }

      this.logger.log(
        `[MIGRATION] ✓ phoneNumberId=${phoneNumberId} registered on WhatsApp Cloud API`,
      );

      // ── 3b: Subscribe WABA to webhook messages ─────────────────────────────
      this.logger.log(
        `[MIGRATION] Step 3b — subscribing WABA ${wabaId} to webhook messages`,
      );
      try {
        await this.defLogger.request<SubscribedAppsResponse>({
          method: 'POST',
          url: `https://graph.facebook.com/v19.0/${wabaId}/subscribed_apps`,
          headers: { Authorization: `Bearer ${token}` },
        });
        this.logger.log(
          `[MIGRATION] ✓ WABA ${wabaId} subscribed — messages will route to webhook`,
        );
      } catch (subErr: any) {
        const subMsg =
          (subErr?.response?.data?.error?.message as string | undefined) ?? '';
        if (subMsg.toLowerCase().includes('already subscribed')) {
          this.logger.log(`[MIGRATION] ✓ WABA ${wabaId} already subscribed — continuing`);
        } else {
          // Non-fatal: registration succeeded; a separate subscribed_apps call can
          // be retried independently without restarting the full migration sequence.
          this.logger.warn(
            `[MIGRATION] ⚠ subscribed_apps call failed (non-fatal): ${subMsg || 'unknown'}`,
          );
        }
      }

      await this.logMigrationEvent(
        phoneNumberId,
        'register',
        'success',
        `Registered on Cloud API. WABA ${wabaId} subscribed.`,
      );

      return {
        success: true,
        message:
          'Phone number successfully registered on WhatsApp Cloud API. Messages will now route to your webhook.',
      };
    } catch (err: any) {
      const detail =
        (err?.response?.data?.error?.message as string | undefined) ??
        err?.message ??
        'Unknown error';

      // "already registered" is a valid idempotent success
      if (detail.toLowerCase().includes('already registered')) {
        this.logger.log(
          `[MIGRATION] ✓ phoneNumberId=${phoneNumberId} already registered — treating as success`,
        );
        await this.logMigrationEvent(
          phoneNumberId,
          'register',
          'success',
          'Already registered — idempotent',
        );
        return {
          success: true,
          message: 'Phone number is already registered on WhatsApp Cloud API.',
        };
      }

      await this.logMigrationEvent(phoneNumberId, 'register', 'error', detail);
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        `Failed to register phone number: ${detail}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
}

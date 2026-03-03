import { Controller, Post, Get, Body, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { MigrationService } from './migration.service';
import { ProvisionPhoneDto } from './dto/provision-phone.dto';
import { MigrationRequestCodeDto } from './dto/migration-request-code.dto';
import { MigrationVerifyCodeDto } from './dto/migration-verify-code.dto';
import { MigrationCompleteDto } from './dto/migration-complete.dto';
import { StartMigrationDto } from './dto/start-migration.dto';

/**
 * MigrationController — Force Migration (App-to-API) path
 *
 * Provides a four-step API sequence that migrates a phone number from a
 * consumer/business WhatsApp app to the WhatsApp Cloud API entirely
 * programmatically — bypassing the "Delete Account" step normally required
 * during Meta Embedded Signup.
 *
 * All endpoints use META_SYSTEM_USER_TOKEN from .env.secrets and graph v25.0.
 * The businessId slot is locked with MIGRATING status throughout; final ACTIVE
 * write uses the same schema as auth.service.ts so all existing listeners work.
 *
 *   POST /migration/provision      Step 0 — add number to WABA, returns phoneNumberId
 *   POST /migration/request-code   Step 1 — trigger OTP via SMS or VOICE
 *   POST /migration/verify-code    Step 2 — submit OTP, kills handset session
 *   POST /migration/complete       Step 3 — register on Cloud API, write ACTIVE
 */
@Controller('migration')
export class MigrationController {
  constructor(private readonly migrationService: MigrationService) {}

  /**
   * POST /migration/start
   *
   * Zero-input entry point. The caller provides only businessId + a phone
   * number in E.164 format (+591 67025559). The backend auto-discovers the
   * WABA, checks for an existing number in that WABA, provisions if needed,
   * and returns { phoneNumberId, wabaId } ready for the OTP sequence.
   *
   * Secrets used (no user input required):
   *   META_SYSTEM_USER_TOKEN — auth for all API calls
   *   META_DEFAULT_WABA_ID   — (optional) skip discovery if only one WABA
   *   META_BUSINESS_ID       — (fallback) used for WABA discovery
   *   META_DEFAULT_CC        — (optional) country code prefix e.g. "591"
   *   META_DEFAULT_VERIFIED_NAME — (optional) business name for provisioning
   */
  @Post('start')
  @HttpCode(HttpStatus.OK)
  start(@Body() dto: StartMigrationDto) {
    return this.migrationService.start(dto);
  }

  /**
   * POST /migration/provision
   *
   * Adds the phone number to the WABA and writes MIGRATING to Firestore.
   * Body: { businessId, wabaId, cc, phoneNumber, verifiedName }
   * Response: { phoneNumberId: string }
   */
  @Post('provision')
  @HttpCode(HttpStatus.OK)
  provision(@Body() dto: ProvisionPhoneDto) {
    return this.migrationService.provision(dto);
  }

  /**
   * POST /migration/request-code
   *
   * Triggers Meta to send a 6-digit OTP to the number's physical SIM.
   * Body: { businessId, phoneNumberId, codeMethod: 'SMS' | 'VOICE' }
   */
  @Post('request-code')
  @HttpCode(HttpStatus.OK)
  requestCode(@Body() dto: MigrationRequestCodeDto) {
    return this.migrationService.requestCode(dto);
  }

  /**
   * POST /migration/verify-code
   *
   * Submits the 6-digit OTP. Disconnects the number from consumer WhatsApp.
   * Body: { businessId, phoneNumberId, code: string (6 digits) }
   */
  @Post('verify-code')
  @HttpCode(HttpStatus.OK)
  verifyCode(@Body() dto: MigrationVerifyCodeDto) {
    return this.migrationService.verifyCode(dto);
  }

  /**
   * POST /migration/complete
   *
   * Registers the number on Cloud API, subscribes WABA webhook, writes ACTIVE.
   * Idempotent — safe to retry if partial failures occur.
   * Body: { businessId, phoneNumberId, wabaId, pin: string (6 digits) }
   */
  @Post('complete')
  @HttpCode(HttpStatus.OK)
  complete(@Body() dto: MigrationCompleteDto) {
    return this.migrationService.complete(dto);
  }

  /**
   * GET /migration/discover-waba?businessManagerId=<optional>
   *
   * Fetches all WABAs owned by the Meta Business Manager. Called automatically
   * by the frontend when the Embedded Signup popup returns without a payload
   * (failed registration). Falls back to META_BUSINESS_ID from .env.secrets
   * when businessManagerId is omitted.
   *
   * Response: { wabas: [{ id, name?, currency?, timezone_id? }] }
   */
  @Get('discover-waba')
  @HttpCode(HttpStatus.OK)
  discoverWaba(@Query('businessManagerId') businessManagerId?: string) {
    return this.migrationService.discoverWaba(businessManagerId);
  }
}

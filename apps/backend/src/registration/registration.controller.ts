import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { RegistrationService } from './registration.service';
import { RequestCodeDto } from './dto/request-code.dto';
import { VerifyCodeDto } from './dto/verify-code.dto';
import { RegisterPhoneDto } from './dto/register-phone.dto';

/**
 * RegistrationController
 *
 * Exposes the three-step WhatsApp number OTP migration sequence as REST
 * endpoints. Call them in order to migrate a number from a consumer WhatsApp
 * account to the WhatsApp Cloud API without requiring handset access beyond
 * the one-time OTP confirmation.
 *
 *   POST /registration/request-code   Step 1 — trigger OTP via SMS or VOICE
 *   POST /registration/verify-code    Step 2 — submit OTP, disconnect from handset
 *   POST /registration/register       Step 3 — activate on Cloud API + subscribe webhook
 *
 * All three endpoints read META_SYSTEM_USER_TOKEN from .env.secrets.
 * Migration state is persisted to Firestore: phone_migrations/{phoneNumberId}.
 */
@Controller('registration')
export class RegistrationController {
  constructor(private readonly registrationService: RegistrationService) {}

  /**
   * POST /registration/request-code
   *
   * Triggers Meta to send a 6-digit OTP to the number's SIM via SMS or VOICE.
   * Body: { phoneNumberId: string, codeMethod: 'SMS' | 'VOICE' }
   */
  @Post('request-code')
  @HttpCode(HttpStatus.OK)
  requestCode(@Body() dto: RequestCodeDto) {
    return this.registrationService.requestCode(dto);
  }

  /**
   * POST /registration/verify-code
   *
   * Submits the 6-digit OTP. Disconnects the number from consumer WhatsApp
   * on success, enabling Cloud API registration.
   * Body: { phoneNumberId: string, code: string (6 digits) }
   */
  @Post('verify-code')
  @HttpCode(HttpStatus.OK)
  verifyCode(@Body() dto: VerifyCodeDto) {
    return this.registrationService.verifyCode(dto);
  }

  /**
   * POST /registration/register
   *
   * Activates the number on WhatsApp Cloud API and subscribes the WABA to
   * receive webhook message events. Idempotent — safe to retry.
   * Body: { phoneNumberId: string, wabaId: string, pin: string (6 digits) }
   */
  @Post('register')
  @HttpCode(HttpStatus.OK)
  register(@Body() dto: RegisterPhoneDto) {
    return this.registrationService.registerPhone(dto);
  }
}

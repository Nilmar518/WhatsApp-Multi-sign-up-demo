import { IsString, IsNotEmpty, Matches } from 'class-validator';

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  businessId: string;

  /**
   * Full E.164 phone number without the leading '+'.
   * Example: 5491112345678 (Argentina +54 911 1234 5678)
   *
   * ⚠️ WhatsApp Cloud API requires the recipient to have sent a message
   * to your number within the last 24 hours before you can reply
   * with free-form text. Outside that window, use a pre-approved template.
   */
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{10,15}$/, {
    message:
      'recipientPhoneNumber must contain only digits with country code, no + or spaces (e.g. 5491112345678)',
  })
  recipientPhoneNumber: string;

  @IsString()
  @IsNotEmpty()
  text: string;
}

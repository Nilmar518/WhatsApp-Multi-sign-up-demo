import {
  IsString,
  IsNotEmpty,
  Matches,
  IsIn,
  IsOptional,
  IsObject,
} from 'class-validator';

export const OUTBOUND_PROVIDERS = [
  'META',
  'META_MESSENGER',
  'META_INSTAGRAM',
] as const;

export type OutboundProvider = (typeof OUTBOUND_PROVIDERS)[number];

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  businessId: string;

  /**
   * Channel/provider selector for outbound routing.
   */
  @IsString()
  @IsNotEmpty()
  @IsIn(OUTBOUND_PROVIDERS)
  provider: OutboundProvider;

  /**
   * Generic numeric recipient identifier:
   * - WhatsApp: phone number / wa_id
   * - Messenger: PSID
   * - Instagram: IGSID (future)
   */
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+$/, {
    message:
      'recipientId must contain only digits (e.g. WhatsApp wa_id, Messenger PSID, or Instagram IGSID)',
  })
  recipientId: string;

  @IsString()
  @IsNotEmpty()
  text: string;

  /**
   * Optional provider-specific message object.
   * Used for channels like Messenger that support structured templates.
   */
  @IsOptional()
  @IsObject()
  message?: Record<string, unknown>;
}

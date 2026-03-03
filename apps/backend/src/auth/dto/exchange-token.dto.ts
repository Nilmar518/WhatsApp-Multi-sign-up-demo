import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class ExchangeTokenDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  wabaId: string;

  // Optional: the Meta FINISH postMessage provides phone_number_id, but the
  // PARTNER_APP_INSTALLED webhook does not.  When absent the backend resolves
  // the ID from GET /v19.0/{wabaId}/phone_numbers after token exchange.
  @IsString()
  @IsOptional()
  phoneNumberId?: string;

  @IsString()
  @IsOptional()
  businessId?: string;
}

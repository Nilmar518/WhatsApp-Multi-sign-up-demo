import { IsString, IsNotEmpty } from 'class-validator';

export class ProvisionPhoneDto {
  @IsString()
  @IsNotEmpty()
  businessId: string;

  @IsString()
  @IsNotEmpty()
  wabaId: string;

  /** Country calling code without the '+', e.g. "591" for Bolivia */
  @IsString()
  @IsNotEmpty()
  cc: string;

  /** Phone number without the country code, e.g. "78915618" */
  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  /** Display name shown on WhatsApp business profile */
  @IsString()
  @IsNotEmpty()
  verifiedName: string;
}

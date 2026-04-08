import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class ExchangeTokenStepDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  wabaId: string;

  /** Provided by the Embedded Signup FINISH event. Optional — resolved from WABA phone list if absent. */
  @IsString()
  @IsOptional()
  phoneNumberId?: string;

  /** Tenant identifier. Defaults to 'demo-business-001' when absent. */
  @IsString()
  @IsOptional()
  businessId?: string;
}

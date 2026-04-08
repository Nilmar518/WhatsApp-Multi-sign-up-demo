import { IsString, IsNotEmpty } from 'class-validator';

export class RegisterPhoneStepDto {
  /** Integration document ID (same as businessId until Phase 4). */
  @IsString()
  @IsNotEmpty()
  integrationId: string;
}

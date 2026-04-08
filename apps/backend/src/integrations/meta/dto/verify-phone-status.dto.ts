import { IsString, IsNotEmpty } from 'class-validator';

export class VerifyPhoneStatusDto {
  @IsString()
  @IsNotEmpty()
  integrationId: string;
}

import { IsString, IsNotEmpty, IsEnum } from 'class-validator';

export type CodeMethod = 'SMS' | 'VOICE';

export class MigrationRequestCodeDto {
  @IsString()
  @IsNotEmpty()
  businessId: string;

  @IsString()
  @IsNotEmpty()
  phoneNumberId: string;

  @IsEnum(['SMS', 'VOICE'])
  codeMethod: CodeMethod;
}

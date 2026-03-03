import { IsString, IsNotEmpty, IsEnum } from 'class-validator';

export type CodeMethod = 'SMS' | 'VOICE';

export class RequestCodeDto {
  @IsString()
  @IsNotEmpty()
  phoneNumberId: string;

  @IsEnum(['SMS', 'VOICE'])
  codeMethod: CodeMethod;
}

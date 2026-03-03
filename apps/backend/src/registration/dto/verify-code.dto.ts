import { IsString, IsNotEmpty, Length } from 'class-validator';

export class VerifyCodeDto {
  @IsString()
  @IsNotEmpty()
  phoneNumberId: string;

  @IsString()
  @Length(6, 6)
  code: string;
}

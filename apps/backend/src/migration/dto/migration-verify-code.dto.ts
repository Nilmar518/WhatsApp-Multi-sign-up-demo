import { IsString, IsNotEmpty, Length } from 'class-validator';

export class MigrationVerifyCodeDto {
  @IsString()
  @IsNotEmpty()
  businessId: string;

  @IsString()
  @IsNotEmpty()
  phoneNumberId: string;

  @IsString()
  @Length(6, 6)
  code: string;
}

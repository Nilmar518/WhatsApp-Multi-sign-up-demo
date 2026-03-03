import { IsString, IsNotEmpty, Length } from 'class-validator';

export class RegisterPhoneDto {
  @IsString()
  @IsNotEmpty()
  phoneNumberId: string;

  @IsString()
  @IsNotEmpty()
  wabaId: string;

  @IsString()
  @Length(6, 6)
  pin: string;
}

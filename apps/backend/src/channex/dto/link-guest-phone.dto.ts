import { IsNotEmpty, IsPhoneNumber, IsString } from 'class-validator';

export class LinkGuestPhoneDto {
  @IsString()
  @IsNotEmpty()
  tenantId: string;

  @IsString()
  @IsNotEmpty()
  reservationCode: string;

  @IsPhoneNumber(undefined)
  @IsNotEmpty()
  phone: string;
}
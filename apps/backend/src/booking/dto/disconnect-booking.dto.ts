import { IsNotEmpty, IsString } from 'class-validator';

export class DisconnectBookingDto {
  @IsString()
  @IsNotEmpty()
  tenantId: string;
}

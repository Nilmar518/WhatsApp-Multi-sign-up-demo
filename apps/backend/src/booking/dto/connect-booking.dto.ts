import { IsNotEmpty, IsString } from 'class-validator';

export class ConnectBookingDto {
  @IsString()
  @IsNotEmpty()
  tenantId: string;

  @IsString()
  @IsNotEmpty()
  hotelId: string;
}

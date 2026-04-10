import { IsNotEmpty, IsString } from 'class-validator';

export class SendInstagramMessageDto {
  /** Instagram-Scoped User ID of the recipient */
  @IsString()
  @IsNotEmpty()
  recipientId: string;

  @IsString()
  @IsNotEmpty()
  text: string;
}

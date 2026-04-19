import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ReplyToThreadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  message: string;
}

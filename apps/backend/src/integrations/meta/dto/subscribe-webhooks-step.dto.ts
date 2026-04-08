import { IsString, IsNotEmpty } from 'class-validator';

export class SubscribeWebhooksStepDto {
  @IsString()
  @IsNotEmpty()
  integrationId: string;
}

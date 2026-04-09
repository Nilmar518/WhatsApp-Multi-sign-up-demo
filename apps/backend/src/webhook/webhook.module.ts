import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { CartModule } from '../cart/cart.module';
import { MessagingModule } from '../messaging/messaging.module';

@Module({
  imports: [CartModule, MessagingModule],
  controllers: [WebhookController],
  providers: [WebhookService],
})
export class WebhookModule {}

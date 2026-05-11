import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { CartModule } from '../cart/cart.module';
import { MessagingModule } from '../messaging/messaging.module';
import { ChannexModule } from '../channex/channex.module';

@Module({
  imports: [
    CartModule,
    MessagingModule,
    ChannexModule,
  ],
  controllers: [WebhookController],
  providers: [WebhookService],
})
export class WebhookModule {}

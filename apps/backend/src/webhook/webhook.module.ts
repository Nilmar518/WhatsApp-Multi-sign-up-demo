import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { CartModule } from '../cart/cart.module';
import { MessagingModule } from '../messaging/messaging.module';

@Module({
  imports: [
    CartModule,
    MessagingModule,
    BullModule.registerQueue({ name: 'booking-revisions' }),
    BullModule.registerQueue({ name: 'channex-messages' }),
  ],
  controllers: [WebhookController],
  providers: [WebhookService],
})
export class WebhookModule {}

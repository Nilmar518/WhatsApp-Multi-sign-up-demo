import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { CartModule } from '../cart/cart.module';

@Module({
  imports: [CartModule],
  controllers: [WebhookController],
  providers: [WebhookService],
})
export class WebhookModule {}

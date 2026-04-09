import { Module } from '@nestjs/common';
import { MessengerIntegrationController } from './messenger-integration.controller';
import { MessengerIntegrationService } from './messenger-integration.service';

@Module({
  controllers: [MessengerIntegrationController],
  providers: [MessengerIntegrationService],
  exports: [MessengerIntegrationService],
})
export class MessengerIntegrationModule {}

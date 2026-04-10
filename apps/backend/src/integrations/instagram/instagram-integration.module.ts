import { Module } from '@nestjs/common';
import { InstagramIntegrationController } from './instagram-integration.controller';
import { InstagramIntegrationService } from './instagram-integration.service';

@Module({
  controllers: [InstagramIntegrationController],
  providers: [InstagramIntegrationService],
  exports: [InstagramIntegrationService],
})
export class InstagramIntegrationModule {}

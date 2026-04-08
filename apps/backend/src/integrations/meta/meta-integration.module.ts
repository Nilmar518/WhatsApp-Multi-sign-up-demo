import { Module } from '@nestjs/common';
import { MetaIntegrationService } from './meta-integration.service';
import { MetaIntegrationController } from './meta-integration.controller';

@Module({
  controllers: [MetaIntegrationController],
  providers: [MetaIntegrationService],
  exports: [MetaIntegrationService],
})
export class MetaIntegrationModule {}

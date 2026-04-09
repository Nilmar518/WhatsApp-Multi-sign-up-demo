import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { MetaProvider } from './meta/meta.provider';
import { MetaIntegrationModule } from './meta/meta-integration.module';
import { MessengerProvider } from './messenger/messenger.provider';
import { MessengerIntegrationModule } from './messenger/messenger-integration.module';

/**
 * IntegrationsModule — aggregates all provider implementations under a single
 * module boundary.
 *
 * Provider registration pattern:
 *   - Each new provider (Google, BNB, …) adds its own sub-module (e.g.
 *     GoogleIntegrationModule) to the imports array, provides its Provider class
 *     (e.g. GoogleProvider) in the providers array, and is registered in
 *     IntegrationsService's constructor Map.
 *   - No changes to IntegrationsController or IntegrationsService signatures
 *     are required when adding a new provider.
 *
 * Exports IntegrationsService so other modules (e.g. WebhookModule) can
 * resolve integrations by provider resource ID in the future.
 */
@Module({
  imports: [
    // MetaIntegrationModule provides MetaIntegrationService (used by MetaProvider).
    MetaIntegrationModule,
    // MessengerIntegrationModule provides MessengerIntegrationService (used by MessengerProvider).
    MessengerIntegrationModule,
  ],
  controllers: [IntegrationsController],
  providers: [
    MetaProvider,
    MessengerProvider,
    IntegrationsService,
  ],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}

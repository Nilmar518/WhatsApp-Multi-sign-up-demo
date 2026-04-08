import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SecretManagerModule } from './common/secrets/secret-manager.module';
import { FirebaseModule } from './firebase/firebase.module';
import { DefensiveLoggerModule } from './common/logger/defensive-logger.module';
import { AuthModule } from './auth/auth.module';
import { WebhookModule } from './webhook/webhook.module';
import { MessagingModule } from './messaging/messaging.module';
import { CatalogModule } from './catalog/catalog.module';
import { IntegrationsModule } from './integrations/integrations.module';
// MetaIntegrationModule is imported transitively via IntegrationsModule — no direct import needed here.
import { RegistrationModule } from './registration/registration.module';
import { MigrationModule } from './migration/migration.module';
import { CatalogManagerModule } from './catalog-manager/catalog-manager.module';
import { AutoReplyModule } from './auto-reply/auto-reply.module';
import { CartModule } from './cart/cart.module';

@Module({
  imports: [
    // SecretManagerModule first — global, so all modules can inject it
    ConfigModule.forRoot({ isGlobal: true }),
    SecretManagerModule,
    FirebaseModule,
    DefensiveLoggerModule,
    // Feature modules
    AuthModule,
    WebhookModule,
    MessagingModule,
    CatalogModule,
    IntegrationsModule,
    RegistrationModule,
    MigrationModule,
    // Catalog ABM — isolated from the Multi Sign-Up demo logic
    CatalogManagerModule,
    // Rule Engine — keyword-based auto-reply CRUD
    AutoReplyModule,
    // Cart ABM — Firestore-backed cart with soft deletes and real-time sync
    CartModule,
  ],
})
export class AppModule {}

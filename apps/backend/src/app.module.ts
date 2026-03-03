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
import { RegistrationModule } from './registration/registration.module';
import { MigrationModule } from './migration/migration.module';

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
  ],
})
export class AppModule {}

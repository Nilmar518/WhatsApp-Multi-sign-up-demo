import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { EventEmitterModule } from '@nestjs/event-emitter';
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
import { ChannexModule } from './channex/channex.module';
import { BookingModule } from './booking/booking.module';

@Module({
  imports: [
    // SecretManagerModule first — global, so all modules can inject it
    ConfigModule.forRoot({ isGlobal: true }),
    SecretManagerModule,
    FirebaseModule,
    DefensiveLoggerModule,
    // Global EventEmitter2 — registered here so EventEmitter2 is injectable
    // in any module (ChannexPropertyService, ChannexBookingWorker, etc.) without
    // needing to import EventEmitterModule in each feature module individually.
    EventEmitterModule.forRoot({
      // Allow emitting to wildcard listeners — e.g. 'channex.*' in tests.
      wildcard: false,
      // Increase max listeners per event to accommodate concurrent SSE clients.
      maxListeners: 20,
    }),
    // Global BullMQ/Redis connection — shared by ChannexModule queues.
    // Requires: pnpm --filter @migo-uit/backend add @nestjs/bull bull ioredis
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST ?? '127.0.0.1',
        port: Number(process.env.REDIS_PORT ?? 6379),
      },
    }),
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
    // Channex.io × Airbnb — Property Management integration
    ChannexModule,
    // Channex.io × Booking.com — XML channel connection
    BookingModule,
  ],
})
export class AppModule {}

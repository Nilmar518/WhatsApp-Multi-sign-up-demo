import { Module } from '@nestjs/common';
import { ChannexService } from './channex.service';
import { ChannexPropertyService } from './channex-property.service';
import { ChannexOAuthService } from './channex-oauth.service';
import { ChannexARIService } from './channex-ari.service';
import { ChannexARIRateLimiter } from './channex-ari-rate-limiter.service';
import { ChannexARISnapshotService } from './channex-ari-snapshot.service';
import { ChannexMessagingBridgeService } from './channex-messaging-bridge.service';
import { ChannexGroupService } from './channex-group.service';
import { ChannexSyncService } from './channex-sync.service';
import { ChannexIndexCheckerService } from './channex-index-checker.service';
import { ChannexPropertyController } from './channex-property.controller';
import { ChannexWebhookController } from './channex-webhook.controller';
import { ChannexARIController } from './channex-ari.controller';
import { ChannexEventsController } from './channex-events.controller';
import { ChannexMessagingBridgeController } from './channex-messaging-bridge.controller';
import { ChannexHmacGuard } from './guards/channex-hmac.guard';
import { ChannexBookingWorker } from './workers/channex-booking.worker';
import { ChannexMessageWorker } from './workers/channex-message.worker';

/**
 * ChannexModule — NestJS module for the Channex.io × Airbnb integration.
 *
 * Infrastructure wiring:
 *   - FirebaseModule, DefensiveLoggerModule, and SecretManagerModule are declared
 *     @Global() in AppModule — available to every module without explicit listing.
 *
 *   - The `booking-revisions` BullMQ queue is registered here for resilient
 *     webhook ingestion. ChannexBookingWorker is now a plain @Injectable() service.
 *     Bull/Redis is retained exclusively for this webhook pipeline.
 *
 *   - The `ari-dlq` queue and ARIFlushCron / ARIRetryWorker have been removed.
 *     ARI pushes (availability, restrictions) are now fully synchronous — the
 *     controller awaits the Channex HTTP response before returning 200 OK.
 *     ScheduleModule is no longer imported.
 *
 * Phase completion tracker:
 *   [DONE] Phase 1: ChannexService (HTTP adapter to Channex REST API)
 *   [DONE] Phase 2: ChannexPropertyService, ChannexPropertyController
 *   [DONE] Phase 3: ChannexOAuthService (one-time token + copy-link)
 *   [DONE] Phase 4: ChannexWebhookController, ChannexHmacGuard, ChannexBookingWorker, ChannexMessageWorker
 *   [DONE] Phase 5: ChannexARIService, ChannexARIController (real-time push, no cron)
 *   [DONE] Phase 6: ChannexEventsController (SSE stream)
 *   [TODO] Phase 7: ChannexMessagingBridgeService, ChannexMessagingBridgeController
 *   [TODO] Phase 8: ChannexHealthCron
 */
@Module({
  imports: [],
  providers: [
    // ── Core services ────────────────────────────────────────────────────────
    ChannexService,
    ChannexGroupService,
    ChannexPropertyService,
    ChannexOAuthService,
    // ── ARI pipeline (real-time direct push, no cron/buffer) ─────────────────
    ChannexARIService,
    ChannexARIRateLimiter,
    ChannexARISnapshotService,
    ChannexMessagingBridgeService,
    // ── Auto-Mapping & Stage/Review pipeline ─────────────────────────────────
    ChannexSyncService,
    // ── Startup index health check ────────────────────────────────────────────
    ChannexIndexCheckerService,
    // ── Guards ───────────────────────────────────────────────────────────────
    // Registered as a provider so NestJS DI can inject SecretManagerService
    // when @UseGuards(ChannexHmacGuard) resolves the guard from the container.
    ChannexHmacGuard,
    // ── Webhook workers (injectable services — synchronous with retry) ────────
    ChannexBookingWorker,
    ChannexMessageWorker,
  ],
  controllers: [
    ChannexPropertyController,
    ChannexWebhookController,
    ChannexARIController,
    ChannexEventsController,
    ChannexMessagingBridgeController,
  ],
  exports: [
    ChannexService,
    ChannexGroupService,
    ChannexPropertyService,
    ChannexOAuthService,
    ChannexARIService,
    ChannexBookingWorker,
    ChannexMessageWorker,
  ],
})
export class ChannexModule {}

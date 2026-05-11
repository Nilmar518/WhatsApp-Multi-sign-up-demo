import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Res,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { WebhookService } from './webhook.service';
import type {
  ChannexWebhookEvent,
  ChannexWebhookFullPayload,
} from '../channex/channex.types';
import { Public } from '../auth-guard/public.decorator';
import { ChannexBookingWorker } from '../channex/workers/channex-booking.worker';
import { ChannexMessageWorker } from '../channex/workers/channex-message.worker';

const CHANNEX_BOOKING_EVENTS = new Set<ChannexWebhookEvent>([
  'booking_new',
  'booking_modification',
  'booking_cancellation',
  'booking_unmapped_room',
  'reservation_request',
  'alteration_request',
]);

@Public()
@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly webhookService: WebhookService,
    private readonly channexBookingWorker: ChannexBookingWorker,
    private readonly channexMessageWorker: ChannexMessageWorker,
  ) {}

  // GET /webhook — Meta hub challenge verification (one-time setup)
  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const verifyToken = this.config.get<string>('META_WEBHOOK_VERIFY_TOKEN');
    const ngrokUrl = this.config.get<string>('NGROK_URL');

    this.logger.log(`[WEBHOOK_VERIFY] mode=${mode} | active_url=${ngrokUrl}`);

    if (mode === 'subscribe' && token === verifyToken) {
      this.logger.log('[WEBHOOK_VERIFY] ✓ Verification successful');
      res.status(200).send(challenge);
    } else {
      this.logger.warn('[WEBHOOK_VERIFY] ✗ Token mismatch — request rejected');
      res.status(403).send('Forbidden');
    }
  }

  /**
   * POST /webhook — Inbound messages and delivery status events from Meta.
   *
   * ACK-FIRST PATTERN: We flush HTTP 200 to Meta immediately after receiving
   * the payload, then hand off all business logic to a background task via
   * setImmediate. This prevents Meta from retrying the webhook when downstream
   * operations (Firestore, Graph API) are slow, which was the root cause of
   * the duplicate-message bug (two identical product_list messages sent to the
   * end-user within the same second).
   *
   * Meta's retry policy: if it does not receive a 200 within 20 s it will
   * resend the same payload — potentially triggering a second auto-reply.
   */
  @Post()
  async receive(@Body() body: unknown, @Res() res: Response): Promise<void> {
    this.logger.log('[WEBHOOK_EVENT] Payload received');
    this.logger.debug(`[WEBHOOK_INBOUND_PAYLOAD] ${JSON.stringify(body)}`);

    const channexEvent = (body as { event?: ChannexWebhookEvent })?.event;

    if (channexEvent) {
      // Channex path — process synchronously then ACK.
      // Firestore writes are fast (~200ms); 3 retries with 1s backoff stays
      // well within Channex's 30s ACK timeout.
      const channexPayload = body as ChannexWebhookFullPayload;
      const propertyId = channexPayload?.property_id ?? 'unknown';

      this.logger.log(
        `[WEBHOOK_CHANNEX] Processing event=${channexEvent} propertyId=${propertyId}`,
      );

      if (channexEvent === 'message' || channexEvent === 'inquiry') {
        await this.channexMessageWorker.handleWithRetry(channexPayload);
      } else if (CHANNEX_BOOKING_EVENTS.has(channexEvent)) {
        await this.channexBookingWorker.handleWithRetry(channexPayload);
      } else {
        this.logger.warn(
          `[WEBHOOK_CHANNEX] Unsupported channex event="${channexEvent}"`,
        );
      }

      res.status(200).json({ received: true });
      return;
    }

    // Meta path — fire-and-forget so the HTTP response is flushed before
    // downstream calls (Firestore, Graph API) complete.
    res.status(200).json({ received: true });

    setImmediate(() => {
      const objectType = (body as { object?: string })?.object;

      const processor =
        objectType === 'page'
          ? this.webhookService.processMessengerInbound(body)
          : objectType === 'whatsapp_business_account'
            ? this.webhookService.processWhatsAppInbound(body)
            : objectType === 'instagram'
              ? this.webhookService.processInstagramInbound(body)
              : Promise.resolve(
                  this.logger.warn(
                    `[WEBHOOK_SKIP] Unsupported webhook object="${objectType ?? 'undefined'}"`,
                  ),
                );

      processor.catch((err: unknown) => {
        this.logger.error(
          `[WEBHOOK_BG_ERROR] Unhandled error in background processor: ${(err as Error).message ?? err}`,
        );
      });
    });
  }
}

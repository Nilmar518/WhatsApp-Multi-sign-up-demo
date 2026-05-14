import {
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ChannexHmacGuard } from './guards/channex-hmac.guard';
import type { ChannexWebhookFullPayload, ChannexWebhookEvent } from './channex.types';
import { Public } from '../auth-guard/public.decorator';
import { ChannexBookingWorker } from './workers/channex-booking.worker';
import { ChannexMessageWorker } from './workers/channex-message.worker';

const ACTIONABLE_EVENTS = new Set<ChannexWebhookEvent>([
  'booking_new',
  'booking_modification',
  'booking_cancellation',
  'booking_unmapped_room',
  'reservation_request',
  'alteration_request',
  'message',
  'inquiry',
]);

const MESSAGE_EVENTS = new Set<ChannexWebhookEvent>(['message', 'inquiry']);

@Public()
@UseGuards(ChannexHmacGuard)
@Controller('channex/webhook')
export class ChannexWebhookController {
  private readonly logger = new Logger(ChannexWebhookController.name);

  constructor(
    private readonly bookingWorker: ChannexBookingWorker,
    private readonly messageWorker: ChannexMessageWorker,
  ) {}

  /**
   * POST /channex/webhook
   *
   * Validates the HMAC signature (guard), processes the payload synchronously
   * with up to 3 retry attempts, writes the outcome to Firestore webhook_events,
   * then returns 200. Total latency is well within Channex's ACK timeout window.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Body() body: ChannexWebhookFullPayload,
  ): Promise<{ status: string }> {
    const event = body?.event;
    const propertyId = body?.property_id;
    const revisionId = body?.revision_id;

    this.logger.log(
      `[WEBHOOK] Received — event=${event} propertyId=${propertyId} revisionId=${revisionId}`,
    );

    if (!ACTIONABLE_EVENTS.has(event)) {
      this.logger.warn(
        `[WEBHOOK] Discarding non-actionable event="${event}".`,
      );
      return { status: 'received' };
    }

    if (MESSAGE_EVENTS.has(event)) {
      await this.messageWorker.handleWithRetry(body);
    } else {
      await this.bookingWorker.handleWithRetry(body);
    }

    return { status: 'received' };
  }
}

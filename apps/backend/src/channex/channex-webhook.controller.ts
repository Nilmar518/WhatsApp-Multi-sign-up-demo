import {
  Controller,
  Logger,
  Post,
  Body,
  Res,
  UseGuards,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import type { Response } from 'express';
import { ChannexHmacGuard } from './guards/channex-hmac.guard';
import type { ChannexWebhookFullPayload, ChannexWebhookEvent } from './channex.types';
import { Public } from '../auth-guard/public.decorator';

// ─── Event filter ─────────────────────────────────────────────────────────────

/**
 * Events that carry actionable data and must be processed by the worker.
 *
 * Booking lifecycle events:
 *   `booking_new`, `booking_modification`, `booking_cancellation`,
 *   `booking_unmapped_room` — standard booking pipeline.
 *
 * Airbnb LiveFeed events (P3):
 *   `reservation_request`  — guest requested a booking; requires host approval.
 *   `alteration_request`   — guest requested a date/guest-count change.
 *   Both carry `live_feed_id` in the payload; the worker calls
 *   POST /live_feed/{id}/resolve to accept or decline within Airbnb's window.
 *
 * Excluded:
 *   `non_acked_booking` — infrastructure alert; discard here, page via PagerDuty.
 *   `booking`           — generic catch-all; rely on specific lifecycle events instead.
 */
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

/** Events routed to the `channex-messages` queue instead of `booking-revisions`. */
const MESSAGE_EVENTS = new Set<ChannexWebhookEvent>(['message', 'inquiry']);

// ─── Controller ───────────────────────────────────────────────────────────────

/**
 * ChannexWebhookController — receives and queues inbound Channex booking events.
 *
 * Route: POST /channex/webhook
 *
 * ACK-FIRST CONTRACT:
 *   Channex requires a 200 OK within a strict timeout window. Any delay in
 *   responding will cause Channex to mark the delivery as failed and eventually
 *   fire `non_acked_booking` events. This controller honours the contract by:
 *     1. Validating the HMAC signature (guard — synchronous, < 1ms)
 *     2. Immediately flushing 200 OK to the HTTP socket
 *     3. Adding the full payload to BullMQ AFTER the response is sent
 *
 *   With `send_data=true` configured in the Channex webhook dashboard, the
 *   payload already contains the complete booking revision. The worker reads
 *   the job data directly from the queue without making a secondary Channex
 *   API call — eliminating the Pull step and reducing API quota consumption.
 *
 * HMAC validation:
 *   The `ChannexHmacGuard` inspects the `x-channex-signature` header before
 *   this handler executes. Requests with an invalid or missing signature are
 *   rejected with 401 before any data is touched.
 */
@Public()
@UseGuards(ChannexHmacGuard)
@Controller('channex/webhook')
export class ChannexWebhookController {
  private readonly logger = new Logger(ChannexWebhookController.name);

  constructor(
    @InjectQueue('booking-revisions')
    private readonly bookingQueue: Queue<ChannexWebhookFullPayload>,
    @InjectQueue('channex-messages')
    private readonly messageQueue: Queue<ChannexWebhookFullPayload>,
  ) {}

  /**
   * POST /channex/webhook
   *
   * Receives the Channex push event, validates the signature (via guard),
   * ACKs immediately, then enqueues actionable booking events for the worker.
   *
   * Non-booking events (e.g. `non_acked_booking`, `booking`) are discarded
   * with a log line — no queue entry is created.
   *
   * @param body   Full Channex webhook payload (send_data=true)
   * @param res    Express response — used for explicit ACK-before-enqueue ordering
   */
  @Post()
  async receive(
    @Body() body: ChannexWebhookFullPayload,
    @Res() res: Response,
  ): Promise<void> {
    const event = body?.event;
    const propertyId = body?.property_id;
    const revisionId = body?.revision_id;

    this.logger.log(
      `[WEBHOOK] Received — event=${event} propertyId=${propertyId} revisionId=${revisionId}`,
    );

    // ── Step 1: ACK immediately — do not await anything before this ──────
    // The response MUST be flushed before queue.add() so that even if Redis
    // is momentarily slow, Channex receives its 200 within the timeout window.
    res.status(200).json({ status: 'received' });

    // ── Step 2: Route or discard ──────────────────────────────────────────
    if (!ACTIONABLE_EVENTS.has(event)) {
      this.logger.warn(
        `[WEBHOOK] Discarding non-actionable event="${event}" — no job created.`,
      );
      return;
    }

    // ── Step 3: Enqueue the full payload ──────────────────────────────────
    // Message events go to the `channex-messages` queue (ChannexMessageWorker).
    // All other actionable events go to `booking-revisions` (ChannexBookingWorker).
    //
    // Job options:
    //   attempts: 3     — worker retries up to 3 times on transient failures
    //   backoff: 5000   — 5-second fixed delay between retries
    //   removeOnComplete: true — keep Redis lean after successful processing
    const isMessageEvent = MESSAGE_EVENTS.has(event);
    const queue = isMessageEvent ? this.messageQueue : this.bookingQueue;

    // For message events there is no revision_id — use the message's own id as the
    // idempotency key so duplicate Channex deliveries of the same message collapse.
    const messagePayload = body.payload as Record<string, unknown> | undefined;
    const rawMessageJobId =
      messagePayload?.ota_message_id ?? messagePayload?.message_thread_id;
    const messageJobId =
      typeof rawMessageJobId === 'string' ? rawMessageJobId : undefined;

    const jobId = isMessageEvent ? messageJobId : revisionId;

    try {
      await queue.add(body, {
        attempts: 3,
        backoff: { type: 'fixed', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false, // Keep failed jobs for post-mortem inspection
        jobId,              // Idempotency key — prevents duplicate processing for
                            // the same revision/message if Channex re-delivers.
      });

      this.logger.log(
        `[WEBHOOK] Job enqueued — event=${event} queue=${isMessageEvent ? 'channex-messages' : 'booking-revisions'} jobId=${jobId ?? 'auto'}`,
      );
    } catch (err: unknown) {
      // Queue failure is logged but not re-thrown — the 200 is already sent.
      // A persistent queue failure will eventually surface as non_acked_booking
      // events from Channex, which should trigger infrastructure alerts.
      this.logger.error(
        `[WEBHOOK] Failed to enqueue job — event=${event} jobId=${jobId ?? 'auto'}: ` +
          `${(err as Error).message ?? String(err)}`,
      );
    }
  }
}

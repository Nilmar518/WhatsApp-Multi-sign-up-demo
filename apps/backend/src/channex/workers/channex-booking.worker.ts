import { Logger } from '@nestjs/common';
import { Processor, Process } from '@nestjs/bull';
import type { Job } from 'bull';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ChannexService } from '../channex.service';
import { ChannexPropertyService } from '../channex-property.service';
import { FirebaseService } from '../../firebase/firebase.service';
import {
  BookingRevisionTransformer,
  type FirestoreReservationDoc,
} from '../transformers/booking-revision.transformer';
import {
  CHANNEX_EVENTS,
  type ChannexWebhookFullPayload,
  type ChannexBookingNewEvent,
  type ChannexUnmappedRoomEvent,
} from '../channex.types';

// ─── Firestore path constants ─────────────────────────────────────────────────
//
// Schema (1:1 Vacation Rental model):
//
//   channex_integrations/{integrationDocId}
//     └── properties/{channexPropertyId}
//           └── bookings/{booking_id}

const INTEGRATIONS_COLLECTION = 'channex_integrations';
const PROPERTIES_SUB_COLLECTION = 'properties';
const BOOKINGS_SUB_COLLECTION = 'bookings';

// ─── Worker ───────────────────────────────────────────────────────────────────

/**
 * ChannexBookingWorker — BullMQ consumer for the `booking-revisions` queue.
 *
 * Consumes jobs enqueued by ChannexWebhookController and persists reservation
 * data to Firestore under the correct tenant partition.
 *
 * Processing pipeline per job:
 *   1. Extract `property_id` from the full webhook payload (job.data)
 *   2. Resolve tenant context via indexed Firestore query (O log n)
 *   3. Route by event type — unmapped-room events are flagged and discarded;
 *      all other booking events are transformed and upserted
 *   4. Transform the Channex booking shape to the Migo UIT Firestore schema
 *   5. Upsert to channex_integrations/{docId}/properties/{propertyId}/bookings/{booking_id}
 *      with merge:true — guarantees idempotency on BullMQ retries
 *
 * ACK behaviour with send_data=true:
 *   Channex considers the webhook delivery ACK'd the moment the controller
 *   returns HTTP 200. There is NO separate ACK call required from the worker
 *   (unlike the send_data=false Pull architecture where acknowledgeBookingRevision
 *   must be called explicitly after the Pull fetch).
 *
 * Retry policy (set by controller's job options):
 *   - 3 attempts with 5s fixed backoff on transient failures (Firestore errors)
 *   - NOT-FOUND (unknown property_id): discarded without retry — throwing would
 *     retry, so we catch and return to mark the job as completed gracefully
 *   - booking_unmapped_room: logged + discarded — no reservation doc written
 */
@Processor('booking-revisions')
export class ChannexBookingWorker {
  private readonly logger = new Logger(ChannexBookingWorker.name);

  constructor(
    private readonly channex: ChannexService,
    private readonly propertyService: ChannexPropertyService,
    private readonly firebase: FirebaseService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Process()
  async process(job: Job<ChannexWebhookFullPayload>): Promise<void> {
    const payload = job.data;
    const { event, property_id: propertyId, revision_id: revisionId } = payload;

    this.logger.log(
      `[WORKER] Processing job=${job.id} event=${event} propertyId=${propertyId} revisionId=${revisionId}`,
    );

    // ── Step 1: Resolve tenant from Channex property UUID ─────────────────
    // Returns null when the property_id has no matching Firestore document.
    // This can happen if the property was provisioned externally or the
    // integration was hard-deleted from Firestore. Discard without retry.
    const integration = await this.propertyService.resolveIntegration(propertyId);

    if (!integration) {
      this.logger.error(
        `[WORKER] No integration found for propertyId=${propertyId}. ` +
          `Job=${job.id} discarded — will NOT be retried.`,
      );
      // Return (do not throw) — BullMQ marks the job as completed, not failed.
      // Retrying an unknown property_id will never succeed.
      return;
    }

    const { tenantId, firestoreDocId } = integration;

    this.logger.log(
      `[WORKER] Resolved — tenantId=${tenantId} firestoreDocId=${firestoreDocId}`,
    );

    // ── Step 2a: Handle Airbnb LiveFeed events (P3) ───────────────────────
    // reservation_request: a guest submitted a booking request needing host approval.
    // alteration_request:  a guest requested a date or guest-count change.
    //
    // Both require a resolution call within Airbnb's acceptance window.
    // Default PMS behaviour: auto-accept. The live_feed_id comes from the payload.
    if (event === 'reservation_request' || event === 'alteration_request') {
      const liveFeedId = payload.live_feed_id;

      if (!liveFeedId) {
        this.logger.warn(
          `[WORKER] ${event} received without live_feed_id — ` +
            `propertyId=${propertyId} revisionId=${revisionId}. ` +
            `Cannot resolve. Job=${job.id} discarded.`,
        );
        return;
      }

      this.logger.log(
        `[WORKER] Resolving ${event} — liveFeedId=${liveFeedId} propertyId=${propertyId}`,
      );

      // Auto-accept: standard PMS behaviour. A future enhancement can check
      // calendar availability before resolving.
      await this.channex.resolveLiveFeedEvent(liveFeedId, true);

      this.logger.log(
        `[WORKER] ✓ ${event} resolved (accepted) — liveFeedId=${liveFeedId}`,
      );
      return;
    }

    // ── Step 2b: Handle booking_unmapped_room ────────────────────────────
    // An Airbnb listing with no matching Channex Room Type mapping.
    // Migo UIT cannot decrement inventory or create a reservation record —
    // the admin must resolve the mapping via the Channel IFrame or re-run sync.
    if (event === 'booking_unmapped_room') {
      this.logger.warn(
        `[WORKER] booking_unmapped_room detected — ` +
          `propertyId=${propertyId} firestoreDocId=${firestoreDocId}. ` +
          `Admin must re-map the Airbnb listing via the Channel IFrame.`,
      );

      // Emit SSE event — the frontend UnmappedRoomModal listens for this and
      // blocks the admin UI until the mapping discrepancy is resolved.
      const unmappedPayload: ChannexUnmappedRoomEvent = {
        tenantId,
        propertyId,
        revisionId,
        timestamp: new Date().toISOString(),
      };
      this.eventEmitter.emit(CHANNEX_EVENTS.BOOKING_UNMAPPED_ROOM, unmappedPayload);

      // Discard gracefully — returning marks the job completed without throwing.
      return;
    }

    // ── Step 3: Validate booking data presence (booking_* lifecycle events) ─
    // Channex booking details are nested directly under `payload`.
    const data = payload.payload as
      | (Record<string, unknown> & {
          booking_id?: string;
          booking_unique_id?: string;
        })
      | undefined;

    if (!data) {
      this.logger.warn(
        `[WORKER] payload is absent for event=${event} revisionId=${revisionId}. ` +
          `Cannot transform. Job=${job.id} discarded.`,
      );
      return;
    }

    const bookingId = typeof data.booking_id === 'string' ? data.booking_id : null;
    if (!bookingId) {
      this.logger.error(
        `[WORKER] booking_id is missing in payload for revisionId=${revisionId}. ` +
          `Cannot construct Firestore document path. Job=${job.id} discarded.`,
      );
      return;
    }

    const bookingUniqueId =
      typeof data.booking_unique_id === 'string' ? data.booking_unique_id : null;

    const normalizedPayload = {
      ...payload,
      booking: data,
    } as ChannexWebhookFullPayload;

    // ── Step 4: Transform Channex payload → Firestore schema ──────────────
    let reservationDoc;
    try {
      reservationDoc = BookingRevisionTransformer.toFirestoreReservation(
        normalizedPayload,
        tenantId,
      );
    } catch (transformErr: unknown) {
      this.logger.error(
        `[WORKER] Transform failed for revisionId=${revisionId}: ` +
          `${(transformErr as Error).message}. Job=${job.id} discarded.`,
      );
      // Transformation errors are deterministic — retrying will not fix them.
      return;
    }

    // ── Step 5: Upsert to Firestore ───────────────────────────────────────
    // Path: channex_integrations/{integrationDocId}
    //         /properties/{propertyId}
    //           /bookings/{booking_id}
    //
    // In the 1:1 Vacation Rental model `propertyId` == the isolated Channex
    // property UUID, which maps 1:1 to a single Airbnb listing. The
    // `properties/{propertyId}` document stores `airbnb_listing_id`, so there
    // is no need for the old `room_types` array lookup.
    //
    // merge:true guarantees idempotency on BullMQ retries.
    const db = this.firebase.getFirestore();

    // Resolve ota_listing_id from the isolated property doc (1:1 model).
    // Falls back to null gracefully if the doc is not yet present.
    const propertyDocRef = db
      .collection(INTEGRATIONS_COLLECTION)
      .doc(firestoreDocId)
      .collection(PROPERTIES_SUB_COLLECTION)
      .doc(propertyId);

    const propertyDocSnap = await propertyDocRef.get();
    reservationDoc.ota_listing_id =
      (propertyDocSnap.data()?.airbnb_listing_id as string | undefined) ?? null;

    const bookingRef = db
      .collection(INTEGRATIONS_COLLECTION)
      .doc(firestoreDocId)
      .collection(PROPERTIES_SUB_COLLECTION)
      .doc(propertyId)
      .collection(BOOKINGS_SUB_COLLECTION)
      .doc(bookingId);

    // Keep a human-readable reservation reference when Channex provides one.
    if (bookingUniqueId) {
      reservationDoc.reservation_id = bookingUniqueId;
    }

    await this.firebase.set(bookingRef, reservationDoc, { merge: true });

    this.logger.log(
      `[WORKER] ✓ Reservation upserted — ` +
        `event=${event} bookingId=${bookingId} bookingRef=${bookingUniqueId ?? bookingId} ` +
        `status=${reservationDoc.booking_status} tenantId=${tenantId}`,
    );

    // Emit SSE booking_new so the frontend ReservationInbox (Phase 7) can
    // surface a real-time toast without polling Firestore.
    // Only fire for booking_new — modifications and cancellations are Phase 7+.
    if (event === 'booking_new') {
      const bookingPayload: ChannexBookingNewEvent & {
        reservation: FirestoreReservationDoc;
      } = {
        tenantId,
        propertyId,
        revisionId,
        otaReservationCode: bookingUniqueId ?? bookingId,
        timestamp: new Date().toISOString(),
        reservation: reservationDoc as FirestoreReservationDoc,
      };
      this.eventEmitter.emit(CHANNEX_EVENTS.BOOKING_NEW, bookingPayload);
    }
  }
}

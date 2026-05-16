import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ChannexService } from '../channex.service';
import { ChannexPropertyService } from '../channex-property.service';
import { FirebaseService } from '../../firebase/firebase.service';
import { MigoPropertyService } from '../../migo-property/migo-property.service';
import { ChannexARIService } from '../channex-ari.service';
import { expandDateRange } from '../utils/date-range';
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

const INTEGRATIONS_COLLECTION = 'channex_integrations';
const PROPERTIES_SUB_COLLECTION = 'properties';
const BOOKINGS_SUB_COLLECTION = 'bookings';
const WEBHOOK_ERRORS_COLLECTION = 'channex_webhook_errors';

type ProcessResult = { firestoreDocId?: string; discarded: boolean };

type AuditStatus = 'success' | 'discarded' | 'failed';

@Injectable()
export class ChannexBookingWorker {
  private readonly logger = new Logger(ChannexBookingWorker.name);

  constructor(
    private readonly channex: ChannexService,
    private readonly propertyService: ChannexPropertyService,
    private readonly firebase: FirebaseService,
    private readonly eventEmitter: EventEmitter2,
    private readonly migoPropertyService: MigoPropertyService,
    private readonly ariService: ChannexARIService,
  ) {}

  async handleWithRetry(payload: ChannexWebhookFullPayload): Promise<void> {
    const revisionId = payload.revision_id ?? `noid-${Date.now()}`;
    const propertyId = payload.property_id;
    const event = payload.event;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const result = await this.processInternal(payload);
        await this.writeAudit({
          firestoreDocId: result.firestoreDocId,
          revisionId,
          event,
          propertyId,
          status: result.discarded ? 'discarded' : 'success',
          attempts: attempt,
        });
        return;
      } catch (err) {
        lastError = err as Error;
        this.logger.warn(
          `[BOOKING-WORKER] Attempt ${attempt}/3 failed — revisionId=${revisionId}: ${lastError.message}`,
        );
        if (attempt < 3) await new Promise<void>((r) => setTimeout(r, 1000));
      }
    }

    await this.writeAudit({
      revisionId,
      event,
      propertyId,
      status: 'failed',
      attempts: 3,
      error: lastError?.message,
    });
  }

  private async processInternal(
    payload: ChannexWebhookFullPayload,
  ): Promise<ProcessResult> {
    const { event, property_id: propertyId } = payload;
    // revision_id may be absent at root — Channex also delivers it as
    // payload.payload.booking_revision_id (nested) or payload.revision_id (root).
    // We resolve the definitive value after extracting booking data below.
    let revisionId: string | undefined = payload.revision_id ?? undefined;

    this.logger.log(
      `[BOOKING-WORKER] Processing event=${event} propertyId=${propertyId} revisionId=${revisionId}`,
    );

    const integration = await this.propertyService.resolveIntegration(propertyId);

    if (!integration) {
      this.logger.error(
        `[BOOKING-WORKER] No integration found for propertyId=${propertyId}. Discarded.`,
      );
      return { discarded: true };
    }

    const { tenantId, firestoreDocId } = integration;

    this.logger.log(
      `[BOOKING-WORKER] Resolved — tenantId=${tenantId} firestoreDocId=${firestoreDocId}`,
    );

    if (event === 'reservation_request' || event === 'alteration_request') {
      const liveFeedId = payload.live_feed_id;

      if (!liveFeedId) {
        this.logger.warn(
          `[BOOKING-WORKER] ${event} received without live_feed_id — ` +
            `propertyId=${propertyId} revisionId=${revisionId}. Discarded.`,
        );
        return { firestoreDocId, discarded: true };
      }

      this.logger.log(
        `[BOOKING-WORKER] Resolving ${event} — liveFeedId=${liveFeedId} propertyId=${propertyId}`,
      );

      await this.channex.resolveLiveFeedEvent(liveFeedId, true);

      this.logger.log(
        `[BOOKING-WORKER] ✓ ${event} resolved (accepted) — liveFeedId=${liveFeedId}`,
      );
      return { firestoreDocId, discarded: false };
    }

    if (event === 'booking_unmapped_room') {
      this.logger.warn(
        `[BOOKING-WORKER] booking_unmapped_room detected — ` +
          `propertyId=${propertyId} firestoreDocId=${firestoreDocId}. ` +
          `Admin must re-map the Airbnb listing via the Channel IFrame.`,
      );

      const unmappedPayload: ChannexUnmappedRoomEvent = {
        tenantId,
        propertyId,
        revisionId,
        timestamp: new Date().toISOString(),
      };
      this.eventEmitter.emit(CHANNEX_EVENTS.BOOKING_UNMAPPED_ROOM, unmappedPayload);
      return { firestoreDocId, discarded: true };
    }

    const rawRoot = payload as unknown as Record<string, unknown>;

    type BookingData = Record<string, unknown> & {
      booking_id?: string;
      booking_unique_id?: string;
    };

    const data: BookingData | undefined =
      (payload.payload as BookingData | undefined) ??
      (payload.booking as BookingData | undefined) ??
      (typeof rawRoot.booking_id === 'string' ? (rawRoot as BookingData) : undefined);

    if (!data) {
      this.logger.warn(
        `[BOOKING-WORKER] Booking data absent in all known locations for event=${event} revisionId=${revisionId}. ` +
          `payload.payload=${!!payload.payload} payload.booking=${!!payload.booking} ` +
          `root.booking_id=${rawRoot.booking_id ?? 'missing'}. Discarded.`,
      );
      return { firestoreDocId, discarded: true };
    }

    // Resolve definitive revisionId — Channex delivers it as booking_revision_id
    // inside the nested booking data object when revision_id is absent at root.
    if (!revisionId) {
      revisionId =
        (typeof data.booking_revision_id === 'string' && data.booking_revision_id) ||
        undefined;
    }

    const bookingId =
      (typeof data.booking_id === 'string' && data.booking_id) ||
      (typeof rawRoot.id === 'string' && rawRoot.id) ||
      null;

    if (!bookingId) {
      this.logger.error(
        `[BOOKING-WORKER] booking_id missing everywhere for revisionId=${revisionId}. ` +
          `data.booking_id=${data.booking_id} root.id=${rawRoot.id}. Discarded.`,
      );
      return { firestoreDocId, discarded: true };
    }

    const bookingUniqueId =
      typeof data.booking_unique_id === 'string' ? data.booking_unique_id : null;

    const normalizedPayload = {
      ...payload,
      booking: data,
    } as ChannexWebhookFullPayload;

    let reservationDoc;
    try {
      reservationDoc = BookingRevisionTransformer.toFirestoreReservation(
        normalizedPayload,
        tenantId,
      );
    } catch (transformErr: unknown) {
      this.logger.error(
        `[BOOKING-WORKER] Transform failed for revisionId=${revisionId}: ` +
          `${(transformErr as Error).message}. Discarded.`,
      );
      return { firestoreDocId, discarded: true };
    }

    const db = this.firebase.getFirestore();

    // Still read the property doc for the ota_listing_id (airbnb_listing_id).
    // The nested properties sub-collection is read-only here — no longer written.
    const propertyDocRef = db
      .collection(INTEGRATIONS_COLLECTION)
      .doc(firestoreDocId)
      .collection(PROPERTIES_SUB_COLLECTION)
      .doc(propertyId);

    const propertyDocSnap = await propertyDocRef.get();
    reservationDoc.ota_listing_id =
      (propertyDocSnap.data()?.airbnb_listing_id as string | undefined) ?? null;

    if (bookingUniqueId) {
      reservationDoc.reservation_id = bookingUniqueId;
    }

    // ── Flat bookings collection with idempotency ─────────────────────────────
    // New path: channex_integrations/{tenantId}/bookings/{firestoreAutoId}
    // Idempotency key: channex_booking_id (= bookingId, the Channex booking UUID).
    // Webhook retries for the same booking merge into the existing doc rather than
    // creating a duplicate. New bookings get a Firestore auto-ID as pms_booking_id.
    //
    // Old path (commented out, kept for reference):
    //   .collection(PROPERTIES_SUB_COLLECTION).doc(propertyId)
    //   .collection(BOOKINGS_SUB_COLLECTION).doc(bookingId)
    const bookingsRef = db
      .collection(INTEGRATIONS_COLLECTION)
      .doc(firestoreDocId)
      .collection(BOOKINGS_SUB_COLLECTION);

    const existing = await bookingsRef
      .where('channex_booking_id', '==', bookingId)
      .where('propertyId', '==', propertyId)
      .limit(1)
      .get();

    // Capture pre-merge dates for booking_modification night union
    let previousCheckIn: string | null = null;
    let previousCheckOut: string | null = null;
    if (!existing.empty) {
      const prevData = existing.docs[0].data() as {
        check_in?: string;
        check_out?: string;
      };
      previousCheckIn = prevData.check_in ?? null;
      previousCheckOut = prevData.check_out ?? null;
    }

    if (!existing.empty) {
      // Booking already exists — merge update (modification or cancellation).
      // Do NOT overwrite pms_booking_id; preserve the original auto-ID.
      reservationDoc.propertyId = propertyId;
      await this.firebase.set(existing.docs[0].ref, reservationDoc, { merge: true });
    } else {
      // First time we see this booking — create with Firestore auto-ID.
      const newRef = bookingsRef.doc();
      reservationDoc.pms_booking_id = newRef.id;
      reservationDoc.propertyId = propertyId;
      await this.firebase.set(newRef, reservationDoc);
    }

    this.logger.log(
      `[BOOKING-WORKER] ✓ Reservation upserted — ` +
        `event=${event} bookingId=${bookingId} bookingRef=${bookingUniqueId ?? bookingId} ` +
        `status=${reservationDoc.booking_status} tenantId=${tenantId}`,
    );

    // ── Cross-channel ARI fan-out ─────────────────────────────────────────────
    if (
      (event === 'booking_new' ||
        event === 'booking_cancellation' ||
        event === 'booking_modification') &&
      reservationDoc.room_type_id &&
      reservationDoc.check_in &&
      reservationDoc.check_out
    ) {
      const newNights = expandDateRange(reservationDoc.check_in, reservationDoc.check_out);

      const affectedNights =
        event === 'booking_modification' && previousCheckIn && previousCheckOut
          ? [...new Set([...expandDateRange(previousCheckIn, previousCheckOut), ...newNights])]
          : newNights;

      this.ariService
        .syncAriForAffectedNights(
          firestoreDocId,
          propertyId,
          reservationDoc.room_type_id,
          affectedNights,
        )
        .catch((err) =>
          this.logger.error(
            `[BOOKING-WORKER] syncAriForAffectedNights failed — ` +
              `event=${event} propertyId=${propertyId}: ${(err as Error).message}`,
          ),
        );
    }

    // ── Pool availability update (MigoProperty) ──────────────────────────────
    const migoPropertyId =
      (propertyDocSnap.data()?.migo_property_id as string | null) ?? null;

    if (migoPropertyId) {
      if (event === 'booking_new') {
        this.migoPropertyService.decrementAvailability(migoPropertyId).catch((err) => {
          this.logger.error(
            `[BOOKING-WORKER] decrementAvailability failed — ` +
              `migoPropertyId=${migoPropertyId}: ${(err as Error).message}`,
          );
        });
      } else if (event === 'booking_cancellation') {
        this.migoPropertyService.incrementAvailability(migoPropertyId).catch((err) => {
          this.logger.error(
            `[BOOKING-WORKER] incrementAvailability failed — ` +
              `migoPropertyId=${migoPropertyId}: ${(err as Error).message}`,
          );
        });
      }
    }

    if (revisionId) {
      await this.channex.acknowledgeBookingRevision(revisionId);
    }

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

    return { firestoreDocId, discarded: false };
  }

  private async writeAudit(opts: {
    firestoreDocId?: string;
    revisionId: string;
    event: string;
    propertyId: string;
    status: AuditStatus;
    attempts: number;
    error?: string;
  }): Promise<void> {
    const { firestoreDocId, revisionId, event, propertyId, status, attempts, error } = opts;
    const db = this.firebase.getFirestore();
    const doc: Record<string, unknown> = {
      event,
      propertyId,
      revisionId,
      status,
      attempts,
      processedAt: new Date().toISOString(),
      ...(error ? { error } : {}),
    };

    try {
      if (firestoreDocId) {
        await db
          .collection(INTEGRATIONS_COLLECTION)
          .doc(firestoreDocId)
          .collection('webhook_events')
          .doc(revisionId)
          .set(doc);
      } else {
        await db
          .collection(WEBHOOK_ERRORS_COLLECTION)
          .doc(revisionId)
          .set(doc);
      }
    } catch (auditErr) {
      this.logger.error(
        `[BOOKING-WORKER] Audit write failed for revisionId=${revisionId}: ` +
          `${(auditErr as Error).message}`,
      );
    }
  }
}

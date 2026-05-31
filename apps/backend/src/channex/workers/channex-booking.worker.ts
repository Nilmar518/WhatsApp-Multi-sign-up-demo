import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ChannexService } from '../channex.service';
import { ChannexPropertyService } from '../channex-property.service';
import { FirebaseService } from '../../firebase/firebase.service';
import { MigoPropertyService } from '../../migo-property/migo-property.service';
import { ChannexARIService, type StoredRoomType } from '../channex-ari.service';
import { expandDateRange } from '../utils/date-range';
import type { AvailabilityEntryDto } from '../channex.types';
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

    const dataSource = payload.payload ? 'payload.payload' : payload.booking ? 'payload.booking' : 'root';
    const rawRooms = Array.isArray(data.rooms) ? (data.rooms as Array<Record<string, unknown>>) : null;
    this.logger.log(
      `[BOOKING-WORKER] Booking data resolved — ` +
        `source=${dataSource} ` +
        `booking_id=${(data as Record<string, unknown>).booking_id ?? 'null'} ` +
        `ota_name=${(data as Record<string, unknown>).ota_name ?? 'null'} ` +
        `has_rooms=${rawRooms !== null} ` +
        `rooms_count=${rawRooms?.length ?? 0} ` +
        `lead_room_type_id=${rawRooms?.[0]?.room_type_id ?? 'null'} ` +
        `arrival_date=${(data as Record<string, unknown>).arrival_date ?? 'null'} ` +
        `departure_date=${(data as Record<string, unknown>).departure_date ?? 'null'}`,
    );

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

    const connectedChannels =
      (propertyDocSnap.data()?.connected_channels as string[] | undefined) ?? [];
    const channelBefore = reservationDoc.channel;
    if (connectedChannels.includes('booking')) {
      reservationDoc.channel = 'booking_com';
    } else if (connectedChannels.includes('airbnb')) {
      reservationDoc.channel = 'airbnb';
    }
    this.logger.log(
      `[BOOKING-WORKER] Channel resolution — propertyId=${propertyId} ` +
        `connected_channels=${JSON.stringify(connectedChannels)} ` +
        `transformer_channel="${channelBefore}" → final_channel="${reservationDoc.channel}"`,
    );

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

    // ── Fetch full booking details from Channex API (fire-and-forget) ───────────
    // Webhook payloads only contain a summary. The full GET returns rooms[],
    // customer contact, arrival_hour, and Genius status — all persisted via merge.
    if (event === 'booking_new' || event === 'booking_modification') {
      this.channex.fetchBookingById(bookingId).then(async (fullBooking) => {
        if (!fullBooking) {
          this.logger.warn(`[BOOKING-WORKER] fetchBookingById returned null — bookingId=${bookingId}`);
          return;
        }

        const customer = typeof fullBooking.customer === 'object' && fullBooking.customer !== null
          ? (fullBooking.customer as Record<string, unknown>)
          : null;
        const meta = typeof fullBooking.meta === 'object' && fullBooking.meta !== null
          ? (fullBooking.meta as Record<string, unknown>)
          : null;
        const rooms = Array.isArray(fullBooking.rooms)
          ? (fullBooking.rooms as Array<Record<string, unknown>>)
          : [];

        this.logger.log(
          `[BOOKING-WORKER] Full booking fetched — bookingId=${bookingId} ` +
            `rooms_count=${rooms.length} arrival_hour=${fullBooking.arrival_hour ?? 'null'} ` +
            `is_genius=${(meta as Record<string, unknown> | null)?.is_genius ?? false} ` +
            `phone=${customer?.phone ?? 'null'} email=${customer?.mail ?? 'null'} ` +
            `rooms=${JSON.stringify(rooms.map((r) => ({ room_type_id: r.room_type_id, rate_plan_id: r.rate_plan_id, amount: r.amount })))}`,
        );

        // Build enrichment patch — merge into existing Firestore doc
        const enrichment: Record<string, unknown> = {
          updated_at: new Date().toISOString(),
        };

        if (typeof customer?.phone === 'string' && customer.phone) enrichment.customer_phone = customer.phone;
        if (typeof customer?.mail === 'string' && customer.mail) enrichment.customer_email = customer.mail;
        if (typeof customer?.country === 'string' && customer.country) enrichment.customer_country = customer.country;
        if (typeof fullBooking.arrival_hour === 'string') enrichment.arrival_hour = fullBooking.arrival_hour;
        if (typeof (meta as Record<string, unknown> | null)?.is_genius === 'boolean') {
          enrichment.is_genius = (meta as Record<string, unknown>).is_genius;
        }

        if (rooms.length > 0) {
          enrichment.rooms_detail = rooms.map((r) => {
            const rm = typeof r.meta === 'object' && r.meta !== null ? (r.meta as Record<string, unknown>) : null;
            return {
              room_type_id: typeof r.room_type_id === 'string' ? r.room_type_id : null,
              rate_plan_id: typeof r.rate_plan_id === 'string' ? r.rate_plan_id : null,
              amount: r.amount ?? null,
              guests: Array.isArray(r.guests) ? r.guests : [],
              room_type_code: typeof rm?.room_type_code === 'string' ? rm.room_type_code : null,
              booking_com_room_index: typeof rm?.booking_com_room_index === 'number' ? rm.booking_com_room_index : null,
              meal_plan: typeof rm?.meal_plan === 'string' ? rm.meal_plan : null,
              smoking_preferences: typeof rm?.smoking_preferences === 'string' ? rm.smoking_preferences : null,
            };
          });

          // Backfill room_type_id on the reservation if the webhook summary had null
          if (!reservationDoc.room_type_id && rooms[0]?.room_type_id) {
            enrichment.room_type_id = rooms[0].room_type_id;
          }
        }

        const snap = await bookingsRef.where('channex_booking_id', '==', bookingId).limit(1).get();
        if (!snap.empty) {
          await this.firebase.set(snap.docs[0].ref, enrichment, { merge: true });
          this.logger.log(
            `[BOOKING-WORKER] ✓ Reservation enriched — bookingId=${bookingId} ` +
              `rooms=${rooms.length} phone=${enrichment.customer_phone ?? '-'} ` +
              `room_type_id=${enrichment.room_type_id ?? 'unchanged'}`,
          );
        }

        // ── ARI batch push — single Channex call for all affected room types ──────
        // Recalculates availability per room_type per night from Firestore bookings,
        // then pushes ONE batch to Channex covering all room types in this booking.
        const enrichedNights = reservationDoc.check_in && reservationDoc.check_out
          ? expandDateRange(reservationDoc.check_in, reservationDoc.check_out)
          : [];

        const affectedRoomTypeIds = [
          ...new Set(
            rooms
              .map((r) => (typeof r.room_type_id === 'string' ? r.room_type_id : null))
              .filter((id): id is string => id !== null),
          ),
        ];

        if (affectedRoomTypeIds.length > 0 && enrichedNights.length > 0) {
          // Fetch all active bookings for this property to compute real availability
          const allActiveSnap = await bookingsRef
            .where('propertyId', '==', propertyId)
            .get();

          const activeBookings = allActiveSnap.docs
            .map((d) => d.data() as {
              booking_status: string;
              check_in: string;
              check_out: string;
              room_type_id: string | null;
              count_of_rooms?: number;
            })
            .filter((b) => b.booking_status !== 'cancelled');

          const availabilityUpdates: AvailabilityEntryDto[] = [];

          for (const rtId of affectedRoomTypeIds) {
            const storedRt = roomTypes.find((rt) => rt.room_type_id === rtId);
            const capacity = storedRt?.count_of_rooms ?? 1;

            for (const night of enrichedNights) {
              const taken = activeBookings
                .filter((b) => b.room_type_id === rtId && b.check_in <= night && b.check_out > night)
                .reduce((sum, b) => sum + (b.count_of_rooms ?? 1), 0);

              availabilityUpdates.push({
                property_id: propertyId,
                room_type_id: rtId,
                date_from: night,
                date_to: night,
                availability: Math.max(0, capacity - taken),
              });
            }

            // MigoProperty decrement per room booked (one call per room of this type)
            if (event === 'booking_new') {
              const matchingRt = storedRt;
              const enrichedMigoId: string | null =
                matchingRt?.migo_property_id ??
                (propertyDocSnap.data()?.migo_property_id as string | null | undefined) ??
                null;
              const roomsOfThisType = rooms.filter((r) => r.room_type_id === rtId).length;

              this.logger.log(
                `[BOOKING-WORKER] MigoProperty decrement — room_type_id=${rtId} ` +
                  `capacity=${capacity} migo_id=${enrichedMigoId ?? 'null'} rooms_booked=${roomsOfThisType}`,
              );

              if (enrichedMigoId) {
                for (let i = 0; i < roomsOfThisType; i++) {
                  this.migoPropertyService.decrementAvailability(enrichedMigoId).catch((err: unknown) =>
                    this.logger.error(
                      `[BOOKING-WORKER] decrementAvailability failed — ` +
                        `room_type_id=${rtId} migo_id=${enrichedMigoId}: ${(err as Error).message}`,
                    ),
                  );
                }
              }
            }
          }

          this.logger.log(
            `[BOOKING-WORKER] Pushing ARI batch — ` +
              `${affectedRoomTypeIds.length} room type(s) × ${enrichedNights.length} night(s) = ${availabilityUpdates.length} entries`,
          );

          this.ariService.pushAvailability(availabilityUpdates)
            .then((taskId) => {
              this.logger.log(
                `[BOOKING-WORKER] ✓ ARI batch pushed — taskId=${taskId} ` +
                  `room_types=[${affectedRoomTypeIds.join(',')}]`,
              );
            })
            .catch((err: unknown) => {
              this.logger.error(
                `[BOOKING-WORKER] pushAvailability batch failed — ` +
                  `room_types=[${affectedRoomTypeIds.join(',')}]: ${(err as Error).message}`,
              );
            });

          // Cross-channel ARI sync (other connected properties via MigoProperty)
          for (const rtId of affectedRoomTypeIds) {
            this.ariService
              .syncAriForAffectedNights(firestoreDocId, propertyId, rtId, enrichedNights)
              .catch((err: unknown) =>
                this.logger.error(
                  `[BOOKING-WORKER] syncAriForAffectedNights failed — ` +
                    `room_type_id=${rtId}: ${(err as Error).message}`,
                ),
              );
          }
        }
      }).catch((err: unknown) => {
        this.logger.error(
          `[BOOKING-WORKER] fetchBookingById enrichment failed — bookingId=${bookingId}: ${(err as Error).message}`,
        );
      });
    }

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
    // Two-level migo_property_id lookup:
    // 1. Check room-level migo_property_id (new BDC single-property model)
    // 2. Fall back to property-level (existing Airbnb / old BDC model)
    const roomTypes =
      (propertyDocSnap.data()?.room_types as StoredRoomType[] | undefined) ?? [];
    const matchingRoom = reservationDoc.room_type_id
      ? roomTypes.find((rt) => rt.room_type_id === reservationDoc.room_type_id)
      : undefined;
    const migoPropertyId =
      matchingRoom?.migo_property_id ??
      (propertyDocSnap.data()?.migo_property_id as string | null | undefined) ??
      null;

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

import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ChannexService } from './channex.service';
import { ChannexPropertyService } from './channex-property.service';
import { ChannexARIRateLimiter } from './channex-ari-rate-limiter.service';
import { ChannexARISnapshotService } from './channex-ari-snapshot.service';
import { FirebaseService } from '../firebase/firebase.service';
import { CreateRoomTypeDto } from './dto/create-room-type.dto';
import { UpdateRoomTypeDto } from './dto/update-room-type.dto';
import { CreateRatePlanDto } from './dto/create-rate-plan.dto';
import { CreateManualBookingDto } from './dto/create-manual-booking.dto';
import type {
  AvailabilityEntryDto,
  RestrictionEntryDto,
  ChannexRoomTypeResponse,
  ChannexRatePlanResponse,
  ChannexWebhookFullPayload,
  FullSyncOptions,
  FullSyncResult,
} from './channex.types';
import {
  BookingRevisionTransformer,
  type FirestoreReservationDoc,
} from './transformers/booking-revision.transformer';
import { MigoPropertyAriDto } from '../migo-property/dto/migo-property-ari.dto';
import {
  MigoPropertyService,
  type PlatformConnection,
} from '../migo-property/migo-property.service';
import { expandDateRange } from './utils/date-range';

// ─── Firestore constants ──────────────────────────────────────────────────────

const INTEGRATIONS_COLLECTION = 'channex_integrations';

// ─── Stored shapes ────────────────────────────────────────────────────────────

export interface StoredRatePlan {
  rate_plan_id: string;
  title: string;
  currency: string;
  rate: number;
  occupancy: number;
  is_primary: boolean;
  min_stay?: number;
  ota_rate_id?: string;
  channel_rate_plan_id?: string;
}

export interface StoredRoomType {
  room_type_id: string;
  title: string;
  default_occupancy: number;
  occ_adults: number;
  occ_children: number;
  occ_infants: number;
  count_of_rooms: number;
  source: 'manual' | 'airbnb' | 'booking';
  ota_listing_id?: string;
  ota_room_id?: string;
  rate_plans: StoredRatePlan[];
}

// ─── Merge helper (used by OTA sync services to preserve manual rooms) ────────

export function mergeRoomTypes(
  existing: StoredRoomType[],
  incoming: StoredRoomType[],
  source: 'manual' | 'airbnb' | 'booking',
): StoredRoomType[] {
  return [
    ...existing.filter((rt) => rt.source !== source),
    ...incoming,
  ];
}

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * ChannexARIService — Room Type management and real-time ARI push to Channex.
 *
 * Architecture note:
 *   ARI pushes (availability / restrictions) go directly to Channex over HTTP
 *   synchronously from the controller request. Each push accepts an array of
 *   updates and dispatches them in a single Channex API call, satisfying
 *   certification batch requirements (Tests #2–#8).
 *
 *   Rate limiting is enforced by ChannexARIRateLimiter (10 calls/min per
 *   property per endpoint type) — a slot is acquired before each HTTP call,
 *   not per item in the values[] array.
 *
 *   Bull/Redis is intentionally retained for the webhook ingestion pipeline
 *   (booking-revisions queue) — that resilience requirement is unaffected.
 *
 *   Agnostic to OTA: operates on property_id, room_type_id, rate_plan_id.
 *   Works for Airbnb, Booking.com, or any future channel without modification.
 */
@Injectable()
export class ChannexARIService {
  private readonly logger = new Logger(ChannexARIService.name);

  constructor(
    private readonly channex: ChannexService,
    private readonly propertyService: ChannexPropertyService,
    private readonly firebase: FirebaseService,
    private readonly rateLimiter: ChannexARIRateLimiter,
    private readonly snapshotService: ChannexARISnapshotService,
    private readonly migoPropertyService: MigoPropertyService,
  ) {}

  // ─── Room Type CRUD ───────────────────────────────────────────────────────

  /**
   * Creates a Room Type in Channex and appends it to the `room_types` array
   * in the Firestore integration document using a transaction (atomic read-modify-write).
   *
   * Newly created Room Types have `availability = 0` by default — the property
   * remains hidden on Airbnb until `pushAvailability` sets a positive value.
   */
  async createRoomType(
    propertyId: string,
    dto: CreateRoomTypeDto,
  ): Promise<ChannexRoomTypeResponse> {
    this.logger.log(
      `[ARI] Creating room type "${dto.title}" — propertyId=${propertyId}`,
    );

    const response = await this.channex.createRoomType({
      property_id: propertyId,
      title: dto.title,
      count_of_rooms: dto.countOfRooms ?? 1,
      default_occupancy: dto.defaultOccupancy,
      occ_adults: dto.occAdults,
      occ_children: dto.occChildren ?? 0,
      occ_infants: dto.occInfants ?? 0,
    });

    const roomTypeId = response.data.id;

    this.logger.log(`[ARI] ✓ Room type created — roomTypeId=${roomTypeId}`);

    const integration = await this.propertyService.resolveIntegration(propertyId);

    if (!integration) {
      this.logger.error(
        `[ARI] Room type ${roomTypeId} created in Channex but no Firestore ` +
          `document found for propertyId=${propertyId}. Manual reconciliation required.`,
      );
      return response;
    }

    const db = this.firebase.getFirestore();
    const docRef = db
      .collection(INTEGRATIONS_COLLECTION)
      .doc(integration.firestoreDocId)
      .collection('properties')
      .doc(propertyId);

    const storedRoomType: StoredRoomType = {
      room_type_id: roomTypeId,
      title: dto.title,
      default_occupancy: dto.defaultOccupancy,
      occ_adults: dto.occAdults,
      occ_children: dto.occChildren ?? 0,
      occ_infants: dto.occInfants ?? 0,
      count_of_rooms: dto.countOfRooms ?? 1,
      source: 'manual',
      rate_plans: [],
    };

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      const existing: StoredRoomType[] = (snap.data()?.room_types ?? []) as StoredRoomType[];
      const alreadyExists = existing.some((rt) => rt.room_type_id === roomTypeId);
      if (!alreadyExists) {
        tx.update(docRef, {
          room_types: [...existing, storedRoomType],
          updated_at: new Date().toISOString(),
        });
      }
    });

    this.logger.log(
      `[ARI] ✓ room_types[] updated in Firestore — firestoreDocId=${integration.firestoreDocId}`,
    );

    return response;
  }

  async updateRoomType(
    propertyId: string,
    roomTypeId: string,
    dto: UpdateRoomTypeDto,
  ): Promise<ChannexRoomTypeResponse> {
    this.logger.log(`[ARI] Updating room type — roomTypeId=${roomTypeId}`);

    const channexPayload: Partial<Omit<import('./channex.types').ChannexRoomTypePayload, 'property_id'>> = {};
    if (dto.title !== undefined) channexPayload.title = dto.title;
    if (dto.countOfRooms !== undefined) channexPayload.count_of_rooms = dto.countOfRooms;
    if (dto.defaultOccupancy !== undefined) channexPayload.default_occupancy = dto.defaultOccupancy;
    if (dto.occAdults !== undefined) channexPayload.occ_adults = dto.occAdults;
    if (dto.occChildren !== undefined) channexPayload.occ_children = dto.occChildren;
    if (dto.occInfants !== undefined) channexPayload.occ_infants = dto.occInfants;

    const response = await this.channex.updateRoomType(roomTypeId, channexPayload);

    this.logger.log(`[ARI] ✓ Room type updated in Channex — roomTypeId=${roomTypeId}`);

    // Mirror changes to the Firestore cache
    const integration = await this.propertyService.resolveIntegration(propertyId);
    if (integration) {
      const db = this.firebase.getFirestore();
      const docRef = db
        .collection(INTEGRATIONS_COLLECTION)
        .doc(integration.firestoreDocId)
        .collection('properties')
        .doc(propertyId);

      await db.runTransaction(async (tx) => {
        const snap = await tx.get(docRef);
        const existing: StoredRoomType[] = (snap.data()?.room_types ?? []) as StoredRoomType[];
        const updated = existing.map((rt) => {
          if (rt.room_type_id !== roomTypeId) return rt;
          return {
            ...rt,
            ...(dto.title !== undefined ? { title: dto.title } : {}),
            ...(dto.countOfRooms !== undefined ? { count_of_rooms: dto.countOfRooms } : {}),
            ...(dto.defaultOccupancy !== undefined ? { default_occupancy: dto.defaultOccupancy } : {}),
            ...(dto.occAdults !== undefined ? { occ_adults: dto.occAdults } : {}),
            ...(dto.occChildren !== undefined ? { occ_children: dto.occChildren } : {}),
            ...(dto.occInfants !== undefined ? { occ_infants: dto.occInfants } : {}),
          };
        });
        tx.update(docRef, { room_types: updated, updated_at: new Date().toISOString() });
      });

      this.logger.log(`[ARI] ✓ Room type Firestore cache updated — roomTypeId=${roomTypeId}`);
    }

    return response;
  }

  async createRatePlan(
    propertyId: string,
    roomTypeId: string,
    dto: CreateRatePlanDto,
  ): Promise<ChannexRatePlanResponse> {
    this.logger.log(
      `[ARI] Creating rate plan "${dto.title}" — propertyId=${propertyId} roomTypeId=${roomTypeId}`,
    );

    const response = await this.channex.createRatePlan({
      property_id: propertyId,
      room_type_id: roomTypeId,
      title: dto.title,
      currency: dto.currency ?? 'USD',
      options: [{
        occupancy: dto.occupancy ?? 2,
        is_primary: true,
        rate: dto.rate ?? 0,
      }],
    });

    const ratePlanId = response.data.id;
    this.logger.log(`[ARI] ✓ Rate plan created — ratePlanId=${ratePlanId}`);

    const integration = await this.propertyService.resolveIntegration(propertyId);

    if (!integration) {
      this.logger.error(
        `[ARI] Rate plan ${ratePlanId} created in Channex but no Firestore ` +
          `document found for propertyId=${propertyId}. Manual reconciliation required.`,
      );
      return response;
    }

    const db = this.firebase.getFirestore();
    const docRef = db
      .collection(INTEGRATIONS_COLLECTION)
      .doc(integration.firestoreDocId)
      .collection('properties')
      .doc(propertyId);

    const newRatePlan: StoredRatePlan = {
      rate_plan_id: ratePlanId,
      title: dto.title,
      currency: dto.currency ?? 'USD',
      rate: dto.rate ?? 0,
      occupancy: dto.occupancy ?? 2,
      is_primary: true,
    };

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      const existing: StoredRoomType[] = (snap.data()?.room_types ?? []) as StoredRoomType[];

      const updated = existing.map((rt) => {
        if (rt.room_type_id !== roomTypeId) return rt;
        const alreadyHas = rt.rate_plans.some((rp) => rp.rate_plan_id === ratePlanId);
        if (alreadyHas) return rt;
        return { ...rt, rate_plans: [...rt.rate_plans, newRatePlan] };
      });

      tx.update(docRef, {
        room_types: updated,
        updated_at: new Date().toISOString(),
      });
    });

    this.logger.log(
      `[ARI] ✓ room_types[] updated in Firestore with rate_plan_id=${ratePlanId}`,
    );

    return response;
  }

  /**
   * Returns the `room_types` array cached in the Firestore integration document.
   * Reads from Firestore — no Channex API call required.
   */
  async getRoomTypes(propertyId: string): Promise<StoredRoomType[]> {
    const integration = await this.propertyService.resolveIntegration(propertyId);

    if (!integration) {
      throw new HttpException(
        `No integration found for propertyId=${propertyId}`,
        HttpStatus.NOT_FOUND,
      );
    }

    const db = this.firebase.getFirestore();
    const doc = await db
      .collection(INTEGRATIONS_COLLECTION)
      .doc(integration.firestoreDocId)
      .collection('properties')
      .doc(propertyId)
      .get();

    if (!doc.exists) return [];

    return (doc.data()?.room_types as StoredRoomType[]) ?? [];
  }

  // ─── Real-time ARI push ───────────────────────────────────────────────────

  /**
   * Pushes one or more availability updates to Channex in a single HTTP call.
   *
   * POST /api/v1/availability
   *
   * Accepts an array so callers can batch multiple room type / date range updates
   * into one request, satisfying Channex certification batch requirements.
   * For single-update operations, pass a one-element array.
   *
   * Rate limited: 10 calls/min per property via ChannexARIRateLimiter.
   * Returns the Channex task ID — needed for certification form answers.
   *
   * Throws ChannexRateLimitError (429) or ChannexAuthError (401/403) if Channex
   * rejects the request.
   */
  async pushAvailability(updates: AvailabilityEntryDto[]): Promise<string> {
    if (!updates.length) return '';

    const propertyId = updates[0].property_id;

    this.logger.log(
      `[ARI] Pushing availability — propertyId=${propertyId} ${updates.length} entry(s)`,
    );

    await this.rateLimiter.acquire(propertyId, 'availability');
    const taskId = await this.channex.pushAvailability(updates);

    this.logger.log(`[ARI] ✓ Availability pushed — taskId=${taskId}`);

    // Fire-and-forget: persist to Firestore snapshot so the calendar can render without extra API calls
    void this.resolveAndSaveAvailabilitySnapshot(propertyId, updates);

    return taskId;
  }

  private resolveAndSaveAvailabilitySnapshot(
    propertyId: string,
    updates: AvailabilityEntryDto[],
  ): Promise<void> {
    return this.propertyService.resolveIntegration(propertyId).then((integration) => {
      if (!integration) return;
      return this.snapshotService.saveFromAvailabilityEntries(
        integration.firestoreDocId,
        propertyId,
        updates,
      );
    }).catch((err) =>
      this.logger.error('[ARI] Availability snapshot save failed', err),
    );
  }

  /**
   * Pushes one or more restriction/rate updates to Channex in a single HTTP call.
   *
   * POST /api/v1/restrictions
   *
   * The `rate_plan_id` field must be present in each entry — restrictions
   * operate on Rate Plans, not Room Types.
   *
   * Rate limited: 10 calls/min per property via ChannexARIRateLimiter.
   * Returns the Channex task ID — needed for certification form answers.
   */
  async pushRestrictions(updates: RestrictionEntryDto[]): Promise<string> {
    if (!updates.length) return '';

    const propertyId = updates[0].property_id;

    this.logger.log(
      `[ARI] Pushing restrictions — propertyId=${propertyId} ${updates.length} entry(s)`,
    );

    await this.rateLimiter.acquire(propertyId, 'restrictions');
    const taskId = await this.channex.pushRestrictions(updates);

    this.logger.log(`[ARI] ✓ Restrictions pushed — taskId=${taskId}`);

    // Fire-and-forget: persist to Firestore snapshot
    void this.resolveAndSaveRestrictionsSnapshot(propertyId, updates);

    return taskId;
  }

  private resolveAndSaveRestrictionsSnapshot(
    propertyId: string,
    updates: RestrictionEntryDto[],
  ): Promise<void> {
    return this.propertyService.resolveIntegration(propertyId).then((integration) => {
      if (!integration) return;
      return this.snapshotService.saveFromRestrictionEntries(
        integration.firestoreDocId,
        propertyId,
        updates,
      );
    }).catch((err) =>
      this.logger.error('[ARI] Restrictions snapshot save failed', err),
    );
  }

  // ─── Firestore ARI Snapshot ───────────────────────────────────────────────

  /**
   * Pulls availability + restrictions from Channex for the given month and
   * writes them to the Firestore ARI snapshot. Called from the ari-refresh endpoint.
   */
  async refreshARISnapshot(
    tenantId: string,
    propertyId: string,
    month: string, // YYYY-MM
  ): Promise<void> {
    const dateFrom = `${month}-01`;
    const lastDay = new Date(
      Number(month.slice(0, 4)),
      Number(month.slice(5, 7)),
      0,
    );
    const dateTo = lastDay.toISOString().split('T')[0];

    this.logger.log(
      `[ARI] refreshARISnapshot — propertyId=${propertyId} month=${month} (${dateFrom}→${dateTo})`,
    );

    await this.rateLimiter.acquire(propertyId, 'availability');
    const availabilityEntries = await this.channex.fetchAvailability(propertyId, dateFrom, dateTo);

    await this.rateLimiter.acquire(propertyId, 'restrictions');
    const restrictionEntries = await this.channex.fetchRestrictions(propertyId, dateFrom, dateTo);

    await Promise.all([
      this.snapshotService.saveAvailabilitySnapshot(tenantId, propertyId, availabilityEntries),
      this.snapshotService.saveRestrictionsSnapshot(tenantId, propertyId, restrictionEntries),
    ]);

    this.logger.log(
      `[ARI] ✓ refreshARISnapshot complete — propertyId=${propertyId} month=${month} ` +
        `availability=${availabilityEntries.length} restrictions=${restrictionEntries.length}`,
    );
  }

  // ─── Full Sync ────────────────────────────────────────────────────────────

  /**
   * Sends N days of ARI for all room types and rate plans of a property.
   *
   * Channex certification Test #1 requires exactly 2 HTTP calls:
   *   1 × POST /availability  — all room types, 500 days
   *   1 × POST /restrictions  — all rate plans, 500 days
   *
   * Reads room_types[] from the Firestore integration document (already mirrored
   * from Channex during the channel connection flow). Does NOT modify any Channex
   * configuration — only pushes ARI values for existing entities.
   *
   * Agnostic to OTA — works for Airbnb, Booking.com, or any future channel.
   *
   * @param propertyId  Channex property UUID
   * @param options     defaultAvailability, defaultRate, days (default 500)
   */
  async fullSync(propertyId: string, options: FullSyncOptions): Promise<FullSyncResult> {
    const days = options.days ?? 500;

    this.logger.log(
      `[ARI] Starting fullSync — propertyId=${propertyId} days=${days}`,
    );

    // ── Read entity IDs from Firestore ──────────────────────────────────────
    const integration = await this.propertyService.resolveIntegration(propertyId);

    if (!integration) {
      throw new HttpException(
        `fullSync failed — no integration found for propertyId=${propertyId}`,
        HttpStatus.NOT_FOUND,
      );
    }

    const db = this.firebase.getFirestore();
    const doc = await db
      .collection(INTEGRATIONS_COLLECTION)
      .doc(integration.firestoreDocId)
      .collection('properties')
      .doc(propertyId)
      .get();

    const roomTypes: StoredRoomType[] = (doc.data()?.room_types as StoredRoomType[]) ?? [];

    if (!roomTypes.length) {
      throw new HttpException(
        `fullSync failed — no room_types in Firestore for propertyId=${propertyId}`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // ── Build date range ────────────────────────────────────────────────────
    const today = new Date();
    const dateFrom = today.toISOString().split('T')[0];

    const end = new Date(today);
    end.setDate(end.getDate() + days);
    const dateTo = end.toISOString().split('T')[0];

    // ── Call 1: Availability — one entry per room type ──────────────────────
    const availabilityUpdates: AvailabilityEntryDto[] = roomTypes.map((rt) => ({
      property_id: propertyId,
      room_type_id: rt.room_type_id,
      date_from: dateFrom,
      date_to: dateTo,
      availability: options.defaultAvailability,
    }));

    const availabilityTaskId = await this.pushAvailability(availabilityUpdates);

    // ── Call 2: Restrictions — one entry per rate plan ──────────────────────
    const ratePlanIds = roomTypes
      .flatMap((rt) => rt.rate_plans.map((rp) => rp.rate_plan_id))
      .filter((id): id is string => Boolean(id));

    if (!ratePlanIds.length) {
      throw new HttpException(
        `fullSync failed — no rate_plan_ids found in room_types for propertyId=${propertyId}`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const restrictionUpdates: RestrictionEntryDto[] = ratePlanIds.map((ratePlanId) => ({
      property_id: propertyId,
      rate_plan_id: ratePlanId,
      date_from: dateFrom,
      date_to: dateTo,
      rate: options.defaultRate,
      min_stay_arrival: options.defaultMinStayArrival,
      max_stay: options.defaultMaxStay,
      closed_to_arrival: options.defaultClosedToArrival,
      closed_to_departure: options.defaultClosedToDeparture,
      stop_sell: options.defaultStopSell,
    }));

    const restrictionsTaskId = await this.pushRestrictions(restrictionUpdates);

    this.logger.log(
      `[ARI] ✓ fullSync complete — propertyId=${propertyId} ` +
        `availabilityTaskId=${availabilityTaskId} restrictionsTaskId=${restrictionsTaskId}`,
    );

    return { availabilityTaskId, restrictionsTaskId };
  }

  // ─── Reservations ─────────────────────────────────────────────────────────

  /**
   * Returns bookings for a tenant (all properties), ordered newest-first by check_in.
   *
   * Prefers the flat tenant-level collection (newer) but falls back to nested
   * per-property collections for historical data. Callers can filter by propertyId
   * client-side if needed. Covers all channels (airbnb, booking.com, …).
   */
  async getPropertyBookings(
    propertyId: string,
    tenantId: string,
    limit = 50,
  ): Promise<FirestoreReservationDoc[]> {
    this.logger.log(
      `[ARI] getPropertyBookings — propertyId=${propertyId} tenantId=${tenantId} limit=${limit}`,
    );

    const db = this.firebase.getFirestore();

    // 1. Try the new flat collection first
    const newSnap = await db
      .collection(INTEGRATIONS_COLLECTION)
      .doc(tenantId)
      .collection('bookings')
      .orderBy('check_in', 'desc')
      .limit(limit)
      .get();

    if (!newSnap.empty) {
      const results: FirestoreReservationDoc[] = newSnap.docs.map(
        (d) => ({ ...d.data(), id: d.id }) as unknown as FirestoreReservationDoc,
      );

      this.logger.log(
        `[ARI] ✓ getPropertyBookings (flat collection) — found ${results.length} bookings`,
      );

      return results;
    }

    // 2. Fallback: old nested collection (historical data before migration)
    const oldSnap = await db
      .collection(INTEGRATIONS_COLLECTION)
      .doc(tenantId)
      .collection('properties')
      .doc(propertyId)
      .collection('bookings')
      .orderBy('check_in', 'desc')
      .limit(limit)
      .get();

    const results: FirestoreReservationDoc[] = oldSnap.docs.map(
      (d) => ({ ...d.data(), id: d.id }) as unknown as FirestoreReservationDoc,
    );

    this.logger.log(
      `[ARI] ✓ getPropertyBookings (nested fallback) — found ${results.length} bookings`,
    );

    return results;
  }

  /**
   * Pulls bookings directly from the Channex REST API and upserts them to Firestore.
   *
   * Use this as a manual recovery mechanism when webhook delivery failed or
   * the push payload was not processed correctly.
   *
   * Flow:
   *   1. Resolve tenantId + groupId from Firestore
   *   2. GET /api/v1/bookings?filter[property_id]=...
   *   3. Transform each booking via BookingRevisionTransformer
   *   4. Upsert to channex_integrations/{tenantId}/properties/{propertyId}/bookings/{id}
   *
   * Returns the number of bookings upserted.
   */
  async pullBookingsFromChannex(
    propertyId: string,
    tenantId: string,
  ): Promise<{ synced: number }> {
    this.logger.log(
      `[ARI] pullBookingsFromChannex (feed) — propertyId=${propertyId} tenantId=${tenantId}`,
    );

    // ── Fetch unacknowledged revisions from Channex feed ─────────────────
    const revisions = await this.channex.fetchBookingRevisionsFeed(propertyId);

    if (!revisions.length) {
      this.logger.log(`[ARI] pullBookingsFromChannex — feed is empty (all acked)`);
      return { synced: 0 };
    }

    // ── Transform + upsert + ACK each revision ────────────────────────────
    const db = this.firebase.getFirestore();
    const bookingsRef = db
      .collection(INTEGRATIONS_COLLECTION)
      .doc(tenantId)
      .collection('properties')
      .doc(propertyId)
      .collection('bookings');

    let synced = 0;

    for (const { revisionId, bookingId, status, bookingData } of revisions) {
      try {
        const payload = {
          event: status,
          property_id: propertyId,
          revision_id: revisionId,
          booking: bookingData,
        } as ChannexWebhookFullPayload;

        const doc = BookingRevisionTransformer.toFirestoreReservation(payload, tenantId);

        const docId = (bookingData.booking_id as string) ?? bookingId ?? revisionId;
        await this.firebase.set(bookingsRef.doc(docId), doc, { merge: true });
        synced++;

        // ACK — mark the revision as received so Channex removes it from the feed
        await this.channex.acknowledgeBookingRevision(revisionId);
      } catch (err: unknown) {
        this.logger.error(
          `[ARI] pullBookings — failed for revisionId=${revisionId}: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `[ARI] ✓ pullBookingsFromChannex — synced=${synced} of ${revisions.length} revisions`,
    );

    return { synced };
  }

  // ─── Manual Bookings ──────────────────────────────────────────────────────

  /**
   * Creates a manual booking (walk-in, maintenance block, owner stay, direct)
   * in the flat Firestore bookings collection and pushes availability=0 to Channex
   * for the booked date range.
   *
   * Flow:
   *   1. Allocate a Firestore doc ref (auto-ID = pms_booking_id)
   *   2. Write the reservation doc with channex_booking_id=null
   *   3. Push availability=0 to Channex for [checkIn, checkOut)
   *   4. Update ari_synced=true + ari_task_id on the doc
   *   5. Return the final doc
   */
  async createManualBooking(
    propertyId: string,
    dto: CreateManualBookingDto,
  ): Promise<FirestoreReservationDoc> {
    this.logger.log(
      `[ARI] createManualBooking — propertyId=${propertyId} tenantId=${dto.tenantId} ` +
        `type=${dto.bookingType} checkIn=${dto.checkIn} checkOut=${dto.checkOut}`,
    );

    if (dto.checkIn >= dto.checkOut) {
      throw new HttpException(
        `checkOut must be after checkIn (got checkIn=${dto.checkIn} checkOut=${dto.checkOut})`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const db = this.firebase.getFirestore();
    const bookingsRef = db
      .collection(INTEGRATIONS_COLLECTION)
      .doc(dto.tenantId)
      .collection('bookings');

    // ── Static capacity from Firestore room types cache (count_of_rooms) ────────
    // Never use the ARI snapshot for capacity: the snapshot stores *remaining*
    // availability (already decremented by prior pushes), which causes
    // double-counting when combined with a per-booking Firestore query.
    const propDoc = await db
      .collection(INTEGRATIONS_COLLECTION)
      .doc(dto.tenantId)
      .collection('properties')
      .doc(propertyId)
      .get();

    const cachedRoomTypes = (propDoc.data()?.room_types ?? []) as StoredRoomType[];
    const matchingRt = cachedRoomTypes.find((rt) => rt.room_type_id === dto.roomTypeId);
    const roomTypeCapacity = matchingRt?.count_of_rooms ?? 1;

    const nights = expandDateRange(dto.checkIn, dto.checkOut);
    const countOfRooms = dto.countOfRooms ?? 1;

    // ── Count existing active bookings per night ──────────────────────────────
    const conflictSnap = await bookingsRef
      .where('propertyId', '==', propertyId)
      .where('room_type_id', '==', dto.roomTypeId)
      .get();

    const activeOverlapping = conflictSnap.docs.filter((d) => {
      const b = d.data() as { check_in: string; check_out: string; booking_status: string };
      if (b.booking_status === 'cancelled') return false;
      return b.check_in < dto.checkOut && b.check_out > dto.checkIn;
    });

    for (const night of nights) {
      const takenForNight = activeOverlapping
        .map((d) => {
          const b = d.data() as { check_in: string; check_out: string; count_of_rooms?: number };
          if (b.check_in > night || b.check_out <= night) return 0;
          return b.count_of_rooms ?? 1;
        })
        .reduce((sum, n) => sum + n, 0);

      if (takenForNight + countOfRooms > roomTypeCapacity) {
        throw new HttpException(
          `Booking conflict: only ${roomTypeCapacity - takenForNight} slot(s) available for ` +
            `room_type_id=${dto.roomTypeId} on ${night} ` +
            `(requested ${countOfRooms}, taken ${takenForNight}/${roomTypeCapacity}).`,
          HttpStatus.CONFLICT,
        );
      }
    }

    const newRef = bookingsRef.doc();
    const now = new Date().toISOString();

    const unitPrice = dto.grossAmount ?? 0;

    const doc: FirestoreReservationDoc = {
      pms_booking_id: newRef.id,
      channex_booking_id: null,
      propertyId,
      reservation_id: null,
      booking_status: 'new',
      channel: dto.bookingType,
      channex_property_id: propertyId,
      room_type_id: dto.roomTypeId,
      check_in: dto.checkIn,
      check_out: dto.checkOut,
      gross_amount: unitPrice,        // unit price — total = gross_amount × count_of_rooms
      currency: dto.currency ?? 'USD',
      ota_fee: 0,
      net_payout: unitPrice,
      additional_taxes: 0,
      payment_collect: 'property',
      payment_type: 'cash',
      guest_first_name: dto.guestName ?? null,
      guest_last_name: null,
      whatsapp_number: null,
      created_at: now,
      updated_at: now,
      count_of_rooms: countOfRooms,
      ari_synced: false,
      ari_task_id: null,
      ...(dto.ratePlanId ? { ota_rate_id: dto.ratePlanId } : {}),
    };

    await this.firebase.set(newRef, doc as unknown as Record<string, unknown>);

    this.logger.log(
      `[ARI] ✓ Manual booking written — pms_booking_id=${newRef.id}`,
    );

    // Push per-night: capacity minus total occupied after this booking is added.
    const availabilityUpdates: AvailabilityEntryDto[] = nights.map((night) => {
      const takenAfterBooking = activeOverlapping
        .map((d) => {
          const b = d.data() as { check_in: string; check_out: string; count_of_rooms?: number };
          if (b.check_in > night || b.check_out <= night) return 0;
          return b.count_of_rooms ?? 1;
        })
        .reduce((sum, n) => sum + n, 0) + countOfRooms;

      return {
        property_id: propertyId,
        room_type_id: dto.roomTypeId,
        date_from: night,
        date_to: night,
        availability: Math.max(0, roomTypeCapacity - takenAfterBooking),
      };
    });

    try {
      const taskId = await this.pushAvailability(availabilityUpdates);

      // Update sync fields on the Firestore doc
      await this.firebase.set(
        newRef,
        { ari_synced: true, ari_task_id: taskId, updated_at: new Date().toISOString() },
        { merge: true },
      );

      this.logger.log(
        `[ARI] ✓ createManualBooking complete — pms_booking_id=${newRef.id} ari_task_id=${taskId}`,
      );

      const manualBookingMigoId =
        (propDoc.data()?.migo_property_id as string | null) ?? null;
      if (manualBookingMigoId) {
        this.migoPropertyService.decrementAvailability(manualBookingMigoId).catch((err) =>
          this.logger.error(
            `[MANUAL-BOOKING] decrementAvailability failed — ` +
              `migoPropertyId=${manualBookingMigoId}: ${(err as Error).message}`,
          ),
        );
      }

      return { ...doc, ari_synced: true, ari_task_id: taskId };
    } catch (e) {
      this.logger.warn(
        `[MANUAL-BOOKING] ARI push failed for pms_booking_id=${newRef.id}. ` +
        `Booking saved but availability NOT blocked in Channex. Fix manually.`,
      );
      return doc;  // ari_synced: false
    }
  }

  /**
   * Cancels a manual booking: updates booking_status to 'cancelled' in Firestore
   * and restores availability=1 in Channex for the original date range.
   *
   * Only manual bookings (channex_booking_id === null) can be cancelled here.
   * OTA bookings are cancelled via the Channex / OTA platforms directly.
   */
  async cancelManualBooking(
    propertyId: string,
    pmsBookingId: string,
    tenantId: string,
  ): Promise<FirestoreReservationDoc> {
    if (!tenantId) {
      throw new HttpException('tenantId is required', HttpStatus.BAD_REQUEST);
    }

    this.logger.log(
      `[ARI] cancelManualBooking — propertyId=${propertyId} pmsBookingId=${pmsBookingId} tenantId=${tenantId}`,
    );

    const db = this.firebase.getFirestore();
    const bookingsRef = db
      .collection(INTEGRATIONS_COLLECTION)
      .doc(tenantId)
      .collection('bookings');

    // 1. Query for the doc with matching pms_booking_id
    const snap = await bookingsRef
      .where('pms_booking_id', '==', pmsBookingId)
      .limit(1)
      .get();

    if (snap.empty) {
      throw new HttpException(
        `Manual booking not found: pms_booking_id=${pmsBookingId}`,
        HttpStatus.NOT_FOUND,
      );
    }

    const docSnap = snap.docs[0];
    const existingDoc = docSnap.data() as FirestoreReservationDoc;

    // 2a. Verify the booking belongs to this property (cross-tenant safety check)
    if (existingDoc.propertyId !== propertyId) {
      throw new HttpException('Booking does not belong to this property', HttpStatus.FORBIDDEN);
    }

    // 2. Verify it's a manual booking (channex_booking_id must be null)
    if (existingDoc.channex_booking_id !== null) {
      throw new HttpException(
        `Booking pms_booking_id=${pmsBookingId} is an OTA booking and cannot be cancelled here`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // 3. Avoid double-cancel
    if (existingDoc.booking_status === 'cancelled') {
      throw new HttpException(
        `Booking pms_booking_id=${pmsBookingId} is already cancelled`,
        HttpStatus.CONFLICT,
      );
    }

    const now = new Date().toISOString();

    // 4. Update booking_status to 'cancelled'
    await this.firebase.set(
      docSnap.ref,
      { booking_status: 'cancelled', updated_at: now },
      { merge: true },
    );

    this.logger.log(
      `[ARI] ✓ cancelManualBooking — pms_booking_id=${pmsBookingId} marked cancelled`,
    );

    // 5. Restore availability for the original date range — snapshot + 1 per night.
    if (!existingDoc.room_type_id) {
      throw new HttpException(
        'Cannot restore availability: booking has no room_type_id',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const cancelNights = expandDateRange(existingDoc.check_in, existingDoc.check_out);

    // ── Static capacity from Firestore room types cache ───────────────────────
    const cancelPropDoc = await db
      .collection(INTEGRATIONS_COLLECTION)
      .doc(tenantId)
      .collection('properties')
      .doc(propertyId)
      .get();
    const cancelCachedRoomTypes = (cancelPropDoc.data()?.room_types ?? []) as StoredRoomType[];
    const cancelMatchingRt = cancelCachedRoomTypes.find(
      (rt) => rt.room_type_id === existingDoc.room_type_id,
    );
    const cancelRoomTypeCapacity = cancelMatchingRt?.count_of_rooms ?? 1;

    // ── Remaining active bookings (excluding the one just cancelled) ──────────
    const cancelConflictSnap = await bookingsRef
      .where('propertyId', '==', propertyId)
      .where('room_type_id', '==', existingDoc.room_type_id)
      .get();

    const remainingActive = cancelConflictSnap.docs.filter((d) => {
      if (d.id === docSnap.id) return false;
      const b = d.data() as { booking_status: string; check_in: string; check_out: string };
      if (b.booking_status === 'cancelled') return false;
      return b.check_in < existingDoc.check_out && b.check_out > existingDoc.check_in;
    });

    const availabilityUpdates: AvailabilityEntryDto[] = cancelNights.map((night) => {
      const takenForNight = remainingActive
        .map((d) => {
          const b = d.data() as { check_in: string; check_out: string; count_of_rooms?: number };
          if (b.check_in > night || b.check_out <= night) return 0;
          return b.count_of_rooms ?? 1;
        })
        .reduce((sum, n) => sum + n, 0);

      return {
        property_id: propertyId,
        room_type_id: existingDoc.room_type_id as string,
        date_from: night,
        date_to: night,
        availability: Math.max(0, cancelRoomTypeCapacity - takenForNight),
      };
    });

    const docRef = docSnap.ref;

    try {
      const taskId = await this.pushAvailability(availabilityUpdates);
      await this.firebase.set(docRef, { ari_task_id: taskId, updated_at: now }, { merge: true });
    } catch (e) {
      this.logger.warn(
        `[MANUAL-BOOKING] ARI restore failed for pms_booking_id=${pmsBookingId}. ` +
        `Booking cancelled but availability NOT restored in Channex. Fix manually.`,
      );
    }

    const cancelMigoId =
      (cancelPropDoc.data()?.migo_property_id as string | null) ?? null;
    if (cancelMigoId) {
      this.migoPropertyService.incrementAvailability(cancelMigoId).catch((err) =>
        this.logger.error(
          `[MANUAL-BOOKING] incrementAvailability failed — ` +
            `migoPropertyId=${cancelMigoId}: ${(err as Error).message}`,
        ),
      );
    }

    this.logger.log(
      `[ARI] ✓ cancelManualBooking complete — availability restored for pms_booking_id=${pmsBookingId}`,
    );

    return { ...existingDoc, booking_status: 'cancelled', updated_at: now };
  }

  /**
   * Returns the ISO date string for the day before the given date.
   * Used to convert an exclusive checkOut date to an inclusive Channex date_to.
   *
   * Example: '2025-06-15' → '2025-06-14'
   */
  private subtractOneDay(dateIso: string): string {
    const d = new Date(`${dateIso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  // ─── MigoProperty ARI fan-out ─────────────────────────────────────────────

  async pushAriToMigoProperty(
    migoPropertyId: string,
    dto: MigoPropertyAriDto,
  ): Promise<{
    succeeded: string[];
    failed: Array<{ channexPropertyId: string; error: string }>;
  }> {
    const db = this.firebase.getFirestore();
    const snap = await db.collection('migo_properties').doc(migoPropertyId).get();

    if (!snap.exists) {
      throw new HttpException(
        `MigoProperty not found: ${migoPropertyId}`,
        HttpStatus.NOT_FOUND,
      );
    }

    const migoDoc = snap.data() as {
      platform_connections: Array<{
        channex_property_id: string;
        is_sync_enabled: boolean;
      }>;
    };

    const enabledConnections = migoDoc.platform_connections.filter(
      (c) => c.is_sync_enabled,
    );

    if (!enabledConnections.length) {
      this.logger.log(
        `[ARI] pushAriToMigoProperty — no enabled connections for migoPropertyId=${migoPropertyId}`,
      );
      return { succeeded: [], failed: [] };
    }

    const hasRestrictionFields =
      dto.rate !== undefined ||
      dto.stopSell !== undefined ||
      dto.minStayArrival !== undefined ||
      dto.closedToArrival !== undefined ||
      dto.closedToDeparture !== undefined;

    const results = await Promise.allSettled(
      enabledConnections.map(async (conn) => {
        const { channex_property_id } = conn;

        const integration = await this.propertyService.resolveIntegration(channex_property_id);
        if (!integration) {
          throw new Error(
            `No integration found for channex_property_id=${channex_property_id}`,
          );
        }

        const propDoc = await db
          .collection(INTEGRATIONS_COLLECTION)
          .doc(integration.firestoreDocId)
          .collection('properties')
          .doc(channex_property_id)
          .get();

        const roomTypes: StoredRoomType[] =
          (propDoc.data()?.room_types as StoredRoomType[]) ?? [];

        if (hasRestrictionFields) {
          const ratePlanIds = roomTypes.flatMap((rt) =>
            rt.rate_plans.map((rp) => rp.rate_plan_id),
          );

          if (ratePlanIds.length) {
            const restrictionUpdates: RestrictionEntryDto[] = ratePlanIds.map(
              (rpId) => ({
                property_id: channex_property_id,
                rate_plan_id: rpId,
                date_from: dto.dateFrom,
                date_to: dto.dateTo,
                ...(dto.rate !== undefined ? { rate: dto.rate } : {}),
                ...(dto.stopSell !== undefined ? { stop_sell: dto.stopSell } : {}),
                ...(dto.minStayArrival !== undefined
                  ? { min_stay_arrival: dto.minStayArrival }
                  : {}),
                ...(dto.closedToArrival !== undefined
                  ? { closed_to_arrival: dto.closedToArrival }
                  : {}),
                ...(dto.closedToDeparture !== undefined
                  ? { closed_to_departure: dto.closedToDeparture }
                  : {}),
              }),
            );
            await this.pushRestrictions(restrictionUpdates);
          }
        }

        if (dto.availability !== undefined && roomTypes.length) {
          const availabilityUpdates: AvailabilityEntryDto[] = roomTypes.map((rt) => ({
            property_id: channex_property_id,
            room_type_id: rt.room_type_id,
            date_from: dto.dateFrom,
            date_to: dto.dateTo,
            availability: dto.availability!,
          }));
          await this.pushAvailability(availabilityUpdates);
        }
      }),
    );

    const succeeded: string[] = [];
    const failed: Array<{ channexPropertyId: string; error: string }> = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        succeeded.push(enabledConnections[index].channex_property_id);
      } else {
        failed.push({
          channexPropertyId: enabledConnections[index].channex_property_id,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    });

    this.logger.log(
      `[ARI] pushAriToMigoProperty complete — migoPropertyId=${migoPropertyId} ` +
        `succeeded=${succeeded.length} failed=${failed.length}`,
    );

    return { succeeded, failed };
  }

  /**
   * Recalculates per-night availability for affected nights and pushes to all
   * MigoProperty-connected channels except the originating one.
   *
   * No-op when: the property has no migo_property_id, there are no other enabled
   * connections, roomTypeId is falsy, or nights is empty.
   *
   * Always call fire-and-forget (.catch) at the call site — never block the
   * booking upsert or revision ACK on this.
   */
  async syncAriForAffectedNights(
    tenantId: string,
    originatingPropertyId: string,
    roomTypeId: string | null | undefined,
    nights: string[],
  ): Promise<void> {
    if (!roomTypeId || !nights.length) {
      this.logger.warn(
        `[ARI-SYNC] Skipped — roomTypeId=${roomTypeId ?? 'null'} nights=${nights.length}`,
      );
      return;
    }

    const db = this.firebase.getFirestore();

    // 1. Resolve migo_property_id from the originating property doc
    const propSnap = await db
      .collection(INTEGRATIONS_COLLECTION)
      .doc(tenantId)
      .collection('properties')
      .doc(originatingPropertyId)
      .get();

    const migoPropertyId =
      (propSnap.data()?.migo_property_id as string | null) ?? null;

    if (!migoPropertyId) {
      this.logger.log(
        `[ARI-SYNC] No migo_property_id for propertyId=${originatingPropertyId} — skipping`,
      );
      return;
    }

    // 2. Get enabled connections from MigoProperty, excluding the originator
    const migoSnap = await db.collection('migo_properties').doc(migoPropertyId).get();

    if (!migoSnap.exists) {
      this.logger.warn(`[ARI-SYNC] MigoProperty not found: ${migoPropertyId}`);
      return;
    }

    const connections: PlatformConnection[] =
      (migoSnap.data()?.platform_connections as PlatformConnection[]) ?? [];

    const targets = connections.filter(
      (c) => c.is_sync_enabled && c.channex_property_id !== originatingPropertyId,
    );

    if (!targets.length) {
      this.logger.log(
        `[ARI-SYNC] No other enabled connections for migoPropertyId=${migoPropertyId}`,
      );
      return;
    }

    // 3. Fan-out: per-night recalculation for each connected property
    const bookingsRef = db
      .collection(INTEGRATIONS_COLLECTION)
      .doc(tenantId)
      .collection('bookings');

    const results = await Promise.allSettled(
      targets.map(async (conn) => {
        const { channex_property_id } = conn;

        const connPropSnap = await db
          .collection(INTEGRATIONS_COLLECTION)
          .doc(tenantId)
          .collection('properties')
          .doc(channex_property_id)
          .get();

        const connRoomTypes: StoredRoomType[] =
          (connPropSnap.data()?.room_types as StoredRoomType[]) ?? [];

        if (!connRoomTypes.length) {
          this.logger.warn(
            `[ARI-SYNC] No room_types cached for channex_property_id=${channex_property_id} — skipping`,
          );
          return;
        }

        // Fetch all active bookings for this connected property that overlap nights
        const bookingsSnap = await bookingsRef
          .where('propertyId', '==', channex_property_id)
          .get();

        const activeOverlapping = bookingsSnap.docs.filter((d) => {
          const b = d.data() as {
            booking_status: string;
            check_in: string;
            check_out: string;
          };
          if (b.booking_status === 'cancelled') return false;
          return nights.some((night) => b.check_in <= night && b.check_out > night);
        });

        // Build per-room-type per-night availability entries
        const availabilityUpdates: AvailabilityEntryDto[] = [];

        for (const rt of connRoomTypes) {
          for (const night of nights) {
            const taken = activeOverlapping
              .filter((d) => {
                const b = d.data() as { room_type_id?: string };
                return b.room_type_id === rt.room_type_id;
              })
              .map((d) => {
                const b = d.data() as {
                  check_in: string;
                  check_out: string;
                  count_of_rooms?: number;
                };
                if (b.check_in > night || b.check_out <= night) return 0;
                return b.count_of_rooms ?? 1;
              })
              .reduce((sum, n) => sum + n, 0);

            availabilityUpdates.push({
              property_id: channex_property_id,
              room_type_id: rt.room_type_id,
              date_from: night,
              date_to: night,
              availability: Math.max(0, rt.count_of_rooms - taken),
            });
          }
        }

        await this.pushAvailability(availabilityUpdates);

        this.logger.log(
          `[ARI-SYNC] ✓ Pushed ${availabilityUpdates.length} entries ` +
            `to channex_property_id=${channex_property_id}`,
        );
      }),
    );

    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        this.logger.error(
          `[ARI-SYNC] Fan-out failed for channex_property_id=${targets[i].channex_property_id}: ` +
            `${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
        );
      }
    });
  }
}

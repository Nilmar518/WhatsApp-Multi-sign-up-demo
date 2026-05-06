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
import { CreateRatePlanDto } from './dto/create-rate-plan.dto';
import type {
  AvailabilityEntryDto,
  RestrictionEntryDto,
  ChannexRoomTypeResponse,
  ChannexRatePlanResponse,
  FullSyncOptions,
  FullSyncResult,
} from './channex.types';

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
      count_of_rooms: 1,
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
      count_of_rooms: 1,
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
    }));

    const restrictionsTaskId = await this.pushRestrictions(restrictionUpdates);

    this.logger.log(
      `[ARI] ✓ fullSync complete — propertyId=${propertyId} ` +
        `availabilityTaskId=${availabilityTaskId} restrictionsTaskId=${restrictionsTaskId}`,
    );

    return { availabilityTaskId, restrictionsTaskId };
  }
}

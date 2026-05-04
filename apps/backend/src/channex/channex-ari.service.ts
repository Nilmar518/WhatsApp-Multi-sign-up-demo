import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { FieldValue } from 'firebase-admin/firestore';
import { ChannexService } from './channex.service';
import { ChannexPropertyService } from './channex-property.service';
import { ChannexARIRateLimiter } from './channex-ari-rate-limiter.service';
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

// ─── Room type stored shape ───────────────────────────────────────────────────

export interface StoredRoomType {
  room_type_id: string;
  title: string;
  default_occupancy: number;
  rate_plan_id: string | null;
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
  ) {}

  // ─── Room Type CRUD ───────────────────────────────────────────────────────

  /**
   * Creates a Room Type in Channex and appends it to the `room_types` array
   * in the Firestore integration document.
   *
   * Newly created Room Types have `availability = 0` by default — the property
   * remains hidden on Airbnb until `pushAvailability` sets a positive value.
   *
   * Uses `FieldValue.arrayUnion()` so concurrent admin sessions don't clobber
   * each other's writes to the same document.
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
      rate_plan_id: null,
    };

    await this.firebase.update(docRef, {
      room_types: FieldValue.arrayUnion(storedRoomType),
      updated_at: new Date().toISOString(),
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

    // Read existing room_types to get title and default_occupancy for this roomTypeId
    const doc = await docRef.get();
    const existingRoomTypes: StoredRoomType[] = (doc.data()?.room_types as StoredRoomType[]) ?? [];
    const existingRoomType = existingRoomTypes.find((rt) => rt.room_type_id === roomTypeId);

    const newEntry: StoredRoomType = {
      room_type_id: roomTypeId,
      title: existingRoomType?.title ?? dto.title,
      default_occupancy: existingRoomType?.default_occupancy ?? (dto.occupancy ?? 2),
      rate_plan_id: ratePlanId,
    };

    await this.firebase.update(docRef, {
      room_types: FieldValue.arrayUnion(newEntry),
      updated_at: new Date().toISOString(),
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
    return taskId;
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
    return taskId;
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
      .map((rt) => rt.rate_plan_id)
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

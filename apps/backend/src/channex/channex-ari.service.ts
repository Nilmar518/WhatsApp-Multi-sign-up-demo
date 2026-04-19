import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { FieldValue } from 'firebase-admin/firestore';
import { ChannexService } from './channex.service';
import { ChannexPropertyService } from './channex-property.service';
import { FirebaseService } from '../firebase/firebase.service';
import { CreateRoomTypeDto } from './dto/create-room-type.dto';
import type {
  AvailabilityEntryDto,
  RestrictionEntryDto,
  ChannexRoomTypeResponse,
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
 * Architecture note (simplified from the batched/Redis version):
 *   Migo UIT is a primarily informational PMS. We receive webhooks and respond
 *   to messages — we do NOT push bulk calendar blocks or offline reservations.
 *   The previous ARIFlushCron + Redis buffer pattern was over-engineered for
 *   this use case and has been removed.
 *
 *   ARI pushes (availability / restrictions) now go directly to Channex over
 *   HTTP synchronously from the controller request. The controller returns a
 *   200 OK only after Channex confirms receipt, giving the frontend an accurate
 *   loading state rather than a misleading "buffered" response.
 *
 *   Bull/Redis is intentionally retained for the webhook ingestion pipeline
 *   (booking-revisions queue) — that resilience requirement is unaffected.
 */
@Injectable()
export class ChannexARIService {
  private readonly logger = new Logger(ChannexARIService.name);

  constructor(
    private readonly channex: ChannexService,
    private readonly propertyService: ChannexPropertyService,
    private readonly firebase: FirebaseService,
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

    // Persist to Firestore integration document
    const integration = await this.propertyService.resolveIntegration(propertyId);

    if (!integration) {
      this.logger.error(
        `[ARI] Room type ${roomTypeId} created in Channex but no Firestore ` +
          `document found for propertyId=${propertyId}. Manual reconciliation required.`,
      );
      return response;
    }

    const db = this.firebase.getFirestore();
    const docRef = db.collection(INTEGRATIONS_COLLECTION).doc(integration.firestoreDocId);

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
      .get();

    if (!doc.exists) return [];

    return (doc.data()?.room_types as StoredRoomType[]) ?? [];
  }

  // ─── Real-time ARI push ───────────────────────────────────────────────────

  /**
   * Pushes an availability update directly to Channex (synchronous, no buffer).
   *
   * POST /api/v1/availability
   *
   * The controller awaits this call before returning 200 to the frontend — the
   * UI loading state is held open for the ~1-2 s Channex round-trip, giving the
   * admin accurate feedback about whether the change was accepted.
   *
   * Throws ChannexRateLimitError (429) or ChannexAuthError (401/403) if Channex
   * rejects the request — the controller converts these to the appropriate HTTP
   * status for the frontend error boundary.
   */
  async pushAvailability(update: AvailabilityEntryDto): Promise<void> {
    this.logger.log(
      `[ARI] Pushing availability — propertyId=${update.property_id} ` +
        `room=${update.room_type_id} ${update.date_from}→${update.date_to} value=${update.availability}`,
    );

    await this.channex.pushAvailability([update]);

    this.logger.log(
      `[ARI] ✓ Availability pushed — propertyId=${update.property_id}`,
    );
  }

  /**
   * Pushes a rate/restriction update directly to Channex (synchronous, no buffer).
   *
   * POST /api/v1/restrictions
   *
   * Same synchronous contract as `pushAvailability`. The `rate_plan_id` field
   * must be provided — restrictions operate on Rate Plans, not Room Types.
   */
  async pushRestrictions(update: RestrictionEntryDto): Promise<void> {
    this.logger.log(
      `[ARI] Pushing restrictions — propertyId=${update.property_id} ` +
        `plan=${update.rate_plan_id} ${update.date_from}→${update.date_to}`,
    );

    await this.channex.pushRestrictions([update]);

    this.logger.log(
      `[ARI] ✓ Restrictions pushed — propertyId=${update.property_id}`,
    );
  }
}

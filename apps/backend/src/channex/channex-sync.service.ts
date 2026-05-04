import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { FieldValue } from 'firebase-admin/firestore';
import { FirebaseService } from '../firebase/firebase.service';
import { SecretManagerService } from '../common/secrets/secret-manager.service';
import { ChannexService } from './channex.service';
import {
  ChannexConnectionStatus,
  ChannexUpdatePropertyPayload,
  ChannexWebhookPayload,
} from './channex.types';

// ─── Firestore collection (mirrors ChannexPropertyService) ───────────────────

const COLLECTION = 'channex_integrations';

// ─── Result shapes ────────────────────────────────────────────────────────────

export interface SyncedRoomType {
  roomTypeId: string;
  ratePlanId: string;
  title: string;
  otaListingId: string;
  channelRatePlanId?: string;
  capacity?: number;
  defaultPrice?: number;
  currency?: string | null;
}

export interface AutoSyncResult {
  channelId: string;
  roomTypesSynced: number;
  roomTypes: SyncedRoomType[];
}

// ─── Stage & Review shapes ─────────────────────────────────────────────────

/** A raw Airbnb listing from /action/listings + /action/listing_details */
export interface StagedAirbnbListing {
  airbnbId: string;
  title: string;
  basePrice: number;
  currency: string | null;
  capacity: number;
}

/** A Channex Room Type + Rate Plan pair created during staging */
export interface StagedChannexEntity {
  roomTypeId: string;
  ratePlanId: string;
  title: string;
}

/** One row in the Review UI — Airbnb listing paired with its suggested Channex entity */
export interface StagedMappingRow {
  airbnb: StagedAirbnbListing;
  channex: StagedChannexEntity;
}

/**
 * Returned by POST /channex/properties/:id/sync_stage.
 * Contains everything the frontend needs to render the MappingReviewModal.
 */
export interface StageSyncResult {
  channelId: string;
  propertyId: string;
  staged: StagedMappingRow[];
}

/** One confirmed pairing sent by the frontend during commit */
export interface CommitMappingInput {
  ratePlanId: string;
  otaListingId: string;
}

/** Returned by POST /channex/properties/:id/commit_mapping */
export interface CommitMappingResult {
  channelId: string;
  mapped: number;
  alreadyMapped: number;
}

// ─── 1:1 Isolated Provisioning shapes ─────────────────────────────────────

/**
 * One successfully provisioned listing in the 1:1 isolated sync pipeline.
 * Each listing gets its own dedicated Channex property, room type, rate plan,
 * channel mapping, webhook subscription, and Messages App installation.
 */
export interface IsolatedListingResult {
  listingId: string;
  listingTitle: string;
  channexPropertyId: string;
  roomTypeId: string;
  ratePlanId: string;
  channelId: string;
  channelRatePlanId: string;
  defaultPrice: number;
  currency: string | null;
  capacity: number;
}

/**
 * One listing that failed provisioning in the 1:1 isolated sync pipeline.
 * `step` identifies which step (A–F) threw the error so engineers can
 * diagnose partial-completion rollback scenarios without reading logs.
 */
export interface IsolatedListingFailure {
  listingId: string;
  listingTitle: string;
  reason: string;
  step: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
}

/**
 * Returned by POST /channex/properties/:id/sync (1:1 isolated pipeline).
 * Replaces `AutoSyncResult` — all listings are attempted regardless of
 * individual failures; the caller inspects `failed[]` to surface partial
 * errors in the frontend.
 */
export interface IsolatedSyncResult {
  succeeded: IsolatedListingResult[];
  failed: IsolatedListingFailure[];
}

interface ValidatedListingSeed {
  listingId: string;
  listingTitle: string;
  capacity: number;
  price: number;
  currency: string | null;
}

interface CalendarSeed {
  roomTypeId: string;
  ratePlanId: string;
  price: number;
  channelRatePlanId?: string;
}

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * ChannexSyncService — Auto-Mapping orchestrator driven by the Airbnb Connection API.
 *
 * Pipeline (strictly ordered):
 *
 *   P0-A  GET /channels/{id}/action/listings
 *         → canonical Airbnb listing IDs + titles (no prior state required)
 *         → 422 guard: empty = OAuth not complete
 *
 *   P0-B  GET /channels/{id}/action/listing_details?listing_id={id}  (per listing, parallel)
 *         → person_capacity   → Room Type default_occupancy / occ_adults
 *         → pricing_settings  → Rate Plan initial rate + currency (zero guessing)
 *         → images[]          → seeded into Firestore for UI display
 *
 *   P1    Idempotency prefetch: GET /room_types, GET /rate_plans
 *         → skip create if a matching entity (by title) already exists
 *
 *   per listing:
 *     CREATE/REUSE Room Type  POST /room_types
 *     CREATE/REUSE Rate Plan  POST /rate_plans  (real price/currency from P0-B)
 *     INJECT mapping          POST /channels/{id}/mappings
 *                             { mapping: { rate_plan_id, settings: { listing_id } } }
 *                             422 = already mapped → log + continue (idempotent)
 *
 *   P2-A  POST /channels/{id}/activate      (action endpoint)
 *   P2-B  POST /channels/{id}/action/load_future_reservations  (historical sync)
 *
 *   Step 6  Firestore: connection_status → 'active', room_types[], last_sync_timestamp
 *
 * Error contracts:
 *   422 Unprocessable Entity  — /action/listings returned empty (OAuth incomplete)
 *   404 Not Found             — property doc missing from Firestore
 *   502 Bad Gateway           — Channex API error during Room Type / Rate Plan creation
 */
@Injectable()
export class ChannexSyncService {
  private readonly logger = new Logger(ChannexSyncService.name);

  constructor(
    private readonly channex: ChannexService,
    private readonly firebase: FirebaseService,
    private readonly secrets: SecretManagerService,
  ) {}

  // ─── Public entry point ───────────────────────────────────────────────────

  /**
   * 1:1 Isolated Provisioning Pipeline — Vacation Rental Model.
   *
   * Creates one dedicated Channex property per Airbnb listing, providing full
   * isolation for webhook routing, ARI pushes, and Channex Messages App
   * installation. This replaces the Hotel Model (one property → many room types).
   *
   * Pipeline per listing (strictly sequential, A → F):
   *
   *   A  POST /api/v1/properties
   *      → isolated Channex property seeded with listing title, currency, timezone
   *
   *   B  POST /api/v1/room_types
   *      → room type under the NEW property (count_of_rooms: 1, vacation rental model)
   *
   *   C  POST /api/v1/rate_plans
   *      → rate plan linked to B, seeded with Airbnb default_daily_price + currency
   *
   *   D  POST /api/v1/channels/{channelId}/mappings
   *      → binds rate plan C to the Airbnb listing on the parent OAuth channel
   *      → 422 treated as already-mapped (idempotent)
   *
   *   E  POST /api/v1/webhooks  (per new property)
   *      → per-property webhook subscription with message_new, inquiry_new, booking_inquiry
   *      → non-fatal (see registerPropertyWebhook)
   *
   *   F  POST /api/v1/applications/install  (per new property)
   *      → installs Channex Messages App so guest messages are forwarded as webhooks
   *      → 422 treated as already-installed (idempotent)
   *
   * Rollback: if ANY step A–F throws, `deleteProperty(newPropertyId)` is called
   * immediately. The listing is appended to `failed[]` and the loop continues
   * with the next listing — partial success is preserved.
   *
   * After the per-listing loop:
   *   - Activate the parent Airbnb channel (non-fatal)
   *   - Trigger load_future_reservations (non-fatal)
   *   - Seed 2-year ARI window for each succeeded listing
   *   - Persist `provisioned_properties[]` + connection_status to Firestore
   *
   * @param propertyId  Parent Channex property UUID (OAuth was completed here)
   * @param tenantId    Migo tenant ID (logging only)
   */
  async autoSyncProperty(
    propertyId: string,
    tenantId: string,
  ): Promise<IsolatedSyncResult> {
    this.logger.log(
      `[SYNC:1:1] Starting — parentPropertyId=${propertyId} tenantId=${tenantId}`,
    );

    // ── Step 0: Resolve Airbnb channel + validated listing seeds ─────────
    const channelId = await this.resolveAirbnbChannelId(propertyId);
    const validatedSeeds = await this.preflightValidateListings(channelId);

    // Read parent doc for timezone / groupId / currency fallback
    const parentDoc = await this.resolveParentIntegrationDoc(propertyId);

    const succeeded: IsolatedListingResult[] = [];
    const failed: IsolatedListingFailure[] = [];

    // ── Per-listing isolated provisioning ─────────────────────────────────
    for (const seed of validatedSeeds) {
      let newPropertyId: string | null = null;
      let currentStep: IsolatedListingFailure['step'] = 'A';

      try {
        // ── Step A: Create isolated Channex property ─────────────────────
        currentStep = 'A';
        const propResp = await this.channex.createProperty({
          title: seed.listingTitle,
          currency: seed.currency ?? parentDoc.currency,
          timezone: parentDoc.timezone,
          property_type: 'apartment',
          ...(parentDoc.channex_group_id ? { group_id: parentDoc.channex_group_id } : {}),
          settings: {
            min_stay_type: 'arrival',
            allow_availability_autoupdate_on_confirmation: true,
          },
        });
        newPropertyId = propResp.data.id;
        this.logger.log(
          `[SYNC:1:1] ✓ A — Property created — listingId=${seed.listingId} newPropertyId=${newPropertyId}`,
        );

        // ── Step B: Create Room Type under new property ───────────────────
        currentStep = 'B';
        const rtResp = await this.channex.createRoomType({
          property_id: newPropertyId,
          title: seed.listingTitle,
          count_of_rooms: 1,
          default_occupancy: seed.capacity,
          occ_adults: seed.capacity,
          occ_children: 0,
          occ_infants: 0,
        });
        const roomTypeId = rtResp.data.id;
        this.logger.log(
          `[SYNC:1:1] ✓ B — Room Type created — roomTypeId=${roomTypeId} capacity=${seed.capacity}`,
        );

        // ── Step C: Create Rate Plan under new property ───────────────────
        currentStep = 'C';
        const rpResp = await this.channex.createRatePlan({
          property_id: newPropertyId,
          room_type_id: roomTypeId,
          title: `${seed.listingTitle} — Standard`,
          currency: seed.currency,
          options: [
            {
              occupancy: seed.capacity,
              is_primary: true,
              rate: this.toMinorCurrencyAmount(seed.price),
            },
          ],
        });
        const ratePlanId = rpResp.data.id;
        this.logger.log(
          `[SYNC:1:1] ✓ C — Rate Plan created — ratePlanId=${ratePlanId} rate=${seed.price} currency=${seed.currency ?? 'inherited'}`,
        );

        // ── Step D: Inject Channel Mapping on the parent Airbnb channel ───
        currentStep = 'D';
        const { alreadyMapped, channelRatePlanId } =
          await this.channex.createChannelMapping(channelId, {
            rate_plan_id: ratePlanId,
            settings: { listing_id: seed.listingId },
          });
        this.logger.log(
          `[SYNC:1:1] ✓ D — Channel Mapping${alreadyMapped ? ' (already existed)' : ''} — listingId=${seed.listingId} channelRatePlanId=${channelRatePlanId ?? '?'}`,
        );

        // ── Step E: Register per-property webhook subscription ────────────
        currentStep = 'E';
        await this.registerPropertyWebhook(newPropertyId);
        this.logger.log(
          `[SYNC:1:1] ✓ E — Webhook registered — newPropertyId=${newPropertyId}`,
        );

        // ── Step F: Install Channex Messages App ──────────────────────────
        currentStep = 'F';
        await this.channex.installMessagesApp(newPropertyId);
        this.logger.log(
          `[SYNC:1:1] ✓ F — Messages App installed — newPropertyId=${newPropertyId}`,
        );

        succeeded.push({
          listingId: seed.listingId,
          listingTitle: seed.listingTitle,
          channexPropertyId: newPropertyId,
          roomTypeId,
          ratePlanId,
          channelId,
          channelRatePlanId: channelRatePlanId ?? ratePlanId,
          defaultPrice: seed.price,
          currency: seed.currency,
          capacity: seed.capacity,
        });
      } catch (err) {
        const reason = (err as Error).message ?? String(err);
        this.logger.error(
          `[SYNC:1:1] Step ${currentStep} failed — listingId=${seed.listingId} title="${seed.listingTitle}": ${reason}`,
        );

        // Rollback: delete the new property if Step A completed
        if (newPropertyId) {
          try {
            await this.channex.deleteProperty(newPropertyId);
            this.logger.log(
              `[SYNC:1:1] ✓ Rollback — deleted orphan propertyId=${newPropertyId}`,
            );
          } catch (rollbackErr) {
            this.logger.error(
              `[SYNC:1:1] Rollback failed — propertyId=${newPropertyId}: ${(rollbackErr as Error).message}`,
            );
          }
        }

        // Dead-letter the failure and continue with the next listing
        failed.push({
          listingId: seed.listingId,
          listingTitle: seed.listingTitle,
          reason,
          step: currentStep,
        });
      }
    }

    // ── Post-loop: activate channel, load reservations, seed ARI ─────────
    if (succeeded.length > 0) {
      // Activate the parent Airbnb channel (non-fatal — at least one listing provisioned)
      try {
        await this.channex.activateChannelAction(channelId);
        this.logger.log(`[SYNC:1:1] ✓ Channel activated — channelId=${channelId}`);
      } catch (err) {
        this.logger.warn(
          `[SYNC:1:1] Channel activation failed (non-fatal): ${(err as Error).message}`,
        );
      }

      // Pull historical Airbnb reservations (non-fatal)
      await this.channex.loadFutureReservations(channelId);

      // Seed 2-year ARI window for each successfully provisioned property
      for (const listing of succeeded) {
        await this.unlockCalendarAndSeedAri(channelId, listing.channexPropertyId, [
          {
            roomTypeId: listing.roomTypeId,
            ratePlanId: listing.ratePlanId,
            price: listing.defaultPrice,
            channelRatePlanId: listing.channelRatePlanId,
          },
        ]);
      }
    }

    // ── Persist results to Firestore ─────────────────────────────────────
    await this.persistIsolatedSyncResults(propertyId, channelId, succeeded, failed);

    this.logger.log(
      `[SYNC:1:1] ✓ Complete — parentPropertyId=${propertyId} succeeded=${succeeded.length} failed=${failed.length}`,
    );

    return { succeeded, failed };
  }

  // ─── Phase 1: Stage Sync ──────────────────────────────────────────────────

  /**
   * POST /channex/properties/:id/sync_stage
   *
   * Discovers raw Airbnb listings + auto-creates Channex Room Types / Rate Plans,
   * but **does not** inject any mappings or activate the channel.
   *
   * The caller (frontend MappingReviewModal) receives the staged rows and lets
   * the user verify the auto-pairs before committing via `commitMapping`.
   *
   * Firestore side-effect: writes `staged_channel_id`, `staged_listings`, and
   * `staged_channex_entities` so the review state survives a page refresh.
   *
   * @param propertyId  Channex property UUID
   * @param tenantId    Migo tenant ID (logging only)
   */
  async stageSync(propertyId: string, tenantId: string): Promise<StageSyncResult> {
    this.logger.log(
      `[STAGE] Starting stage-sync — propertyId=${propertyId} tenantId=${tenantId}`,
    );

    // Step 0: Resolve Airbnb channel
    const channelId = await this.resolveAirbnbChannelId(propertyId);

    const validatedSeeds = await this.preflightValidateListings(channelId);

    // Enrich Channex property + Firestore with real Airbnb data (non-fatal).
    await this.enrichPropertyFromAirbnbData(
      propertyId,
      validatedSeeds[0].listingTitle,
      validatedSeeds[0].currency,
    );

    // P1 idempotency: prefetch existing Room Types + Rate Plans
    const [existingRTs, existingRPs] = await Promise.all([
      this.channex.getRoomTypes(propertyId),
      this.channex.getRatePlans(propertyId),
    ]);

    const rtByTitle = new Map(existingRTs.map((rt) => [this.normaliseTitle(rt.attributes.title), rt]));
    const rpByRoomTypeId = new Map(
      existingRPs
        .map((rp) => {
          const rtId = this.resolveRatePlanRoomTypeId(rp);
          return rtId ? ([rtId, rp] as const) : null;
        })
        .filter((e): e is readonly [string, (typeof existingRPs)[number]] => e !== null),
    );

    const staged: StagedMappingRow[] = [];

    for (const seed of validatedSeeds) {
      const capacity = seed.capacity;
      const listingRate = seed.price;
      const listingCurrency = seed.currency;
      const title = seed.listingTitle;
      const normTitle = this.normaliseTitle(title);

      // Create or reuse Room Type
      let roomTypeId: string;
      const existingRT = rtByTitle.get(normTitle);
      if (existingRT) {
        roomTypeId = existingRT.id;
      } else {
        const rtResp = await this.channex.createRoomType({
          property_id: propertyId,
          title,
          count_of_rooms: 1,
          default_occupancy: capacity,
          occ_adults: capacity,
          occ_children: 0,
          occ_infants: 0,
        });
        roomTypeId = rtResp.data.id;
        rtByTitle.set(normTitle, rtResp.data);
        this.logger.log(`[STAGE] ✓ Room type created — "${title}" id=${roomTypeId}`);
      }

      // Create or reuse Rate Plan
      let ratePlanId: string;
      const existingRP =
        rpByRoomTypeId.get(roomTypeId) ??
        existingRPs.find((rp) => this.resolveRatePlanRoomTypeId(rp) === roomTypeId);

      if (existingRP) {
        ratePlanId = existingRP.id;
      } else {
        const rpResp = await this.channex.createRatePlan({
          property_id: propertyId,
          room_type_id: roomTypeId,
          title: `${title} — Standard`,
          currency: listingCurrency,
          options: [{ occupancy: capacity, is_primary: true, rate: this.toMinorCurrencyAmount(listingRate) }],
        });
        ratePlanId = rpResp.data.id;
        rpByRoomTypeId.set(roomTypeId, rpResp.data);
        this.logger.log(`[STAGE] ✓ Rate plan created — id=${ratePlanId} rate=${listingRate}`);
      }

      staged.push({
        airbnb: { airbnbId: seed.listingId, title, basePrice: listingRate, currency: listingCurrency, capacity },
        channex: { roomTypeId, ratePlanId, title },
      });
    }

    // Persist staged state to Firestore so review survives a page refresh
    await this.saveStageToFirestore(propertyId, channelId, staged);

    this.logger.log(
      `[STAGE] ✓ Complete — propertyId=${propertyId} channelId=${channelId} rows=${staged.length}`,
    );

    return { channelId, propertyId, staged };
  }

  // ─── Phase 3: Commit Mapping ───────────────────────────────────────────────

  /**
   * POST /channex/properties/:id/commit_mapping
   *
   * Executes the confirmed user mappings:
   *   1. POST /channels/{id}/mappings for each pair (422 = already mapped, continue)
   *   2. POST /channels/{id}/activate
   *   3. POST /channels/{id}/action/load_future_reservations
   *   4. Update Firestore: connection_status → 'active', room_types persisted
   *
   * @param channelId  Channex channel UUID (returned from stageSync)
   * @param propertyId Channex property UUID
   * @param mappings   User-confirmed { ratePlanId, otaListingId } pairs
   */
  async commitMapping(
    channelId: string,
    propertyId: string,
    mappings: CommitMappingInput[],
  ): Promise<CommitMappingResult> {
    this.logger.log(
      `[COMMIT] Starting — channelId=${channelId} propertyId=${propertyId} pairs=${mappings.length}`,
    );

    const commitSeeds = await this.resolveCommitCalendarSeeds(propertyId, mappings);

    let mapped = 0;
    let alreadyMapped = 0;

    for (const { ratePlanId, otaListingId } of mappings) {
      const { alreadyMapped: was, channelRatePlanId } = await this.channex.createChannelMapping(channelId, {
        rate_plan_id: ratePlanId,
        settings: { listing_id: otaListingId },
      });

      const targetSeed = commitSeeds.find((seed) => seed.ratePlanId === ratePlanId);
      if (targetSeed) {
        targetSeed.channelRatePlanId = channelRatePlanId;
      }

      if (was) {
        alreadyMapped++;
        this.logger.log(`[COMMIT] Already mapped — listingId=${otaListingId}`);
      } else {
        mapped++;
        this.logger.log(`[COMMIT] ✓ Mapped — listingId=${otaListingId} ratePlanId=${ratePlanId}`);
      }
    }

    // Activate channel
    await this.channex.activateChannelAction(channelId);
    this.logger.log(`[COMMIT] ✓ Channel activated — channelId=${channelId}`);

    // Register per-property webhook subscription (non-fatal).
    await this.registerPropertyWebhook(propertyId);

    // Pull historical Airbnb reservations (non-fatal)
    await this.channex.loadFutureReservations(channelId);

    await this.backfillChannelRatePlanIds(channelId, mappings, commitSeeds);

    await this.unlockCalendarAndSeedAri(channelId, propertyId, commitSeeds);

    // Build the room_types array for Firestore from the confirmed mappings
    const roomTypes: SyncedRoomType[] = mappings.map((m) => ({
      roomTypeId: '',        // resolved from staged data if available
      ratePlanId: m.ratePlanId,
      title: m.otaListingId, // fallback; Firestore already has full titles from staging
      otaListingId: m.otaListingId,
    }));

    await this.finalizeFirestoreDocument(propertyId, channelId, roomTypes);

    this.logger.log(
      `[COMMIT] ✓ Complete — mapped=${mapped} alreadyMapped=${alreadyMapped}`,
    );

    return { channelId, mapped, alreadyMapped };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private normaliseTitle(title: string): string {
    return title.trim().toLowerCase();
  }

  private toMinorCurrencyAmount(majorAmount: number): number {
    return Math.round(majorAmount * 100);
  }

  /**
   * Resolves the room_type_id from a rate plan response, handling both the
   * flat `attributes.room_type_id` field and the JSON:API `relationships` shape.
   */
  private resolveRatePlanRoomTypeId(
    ratePlan: { attributes?: { room_type_id?: string }; id: string },
  ): string | undefined {
    const fromAttributes = ratePlan.attributes?.room_type_id;
    if (fromAttributes) return fromAttributes;

    const fromRelationships = (
      ratePlan as unknown as {
        relationships?: { room_type?: { data?: { id?: string } } };
      }
    ).relationships?.room_type?.data?.id;

    return fromRelationships;
  }

  // ─── Private pipeline steps ───────────────────────────────────────────────

  /**
   * Persists staged data to Firestore so the MappingReviewModal state survives
   * a page refresh. Does NOT change connection_status.
   */
  private async saveStageToFirestore(
    propertyId: string,
    channelId: string,
    staged: StagedMappingRow[],
  ): Promise<void> {
    const db = this.firebase.getFirestore();
    const snapshot = await db.collection(COLLECTION).where('channex_property_id', '==', propertyId).limit(1).get();

    if (snapshot.empty) return; // Non-fatal — staged data is also returned in memory

    await this.firebase.update(snapshot.docs[0].ref, {
      staged_channel_id: channelId,
      staged_listings: staged.map((row) => row.airbnb),
      staged_channex_entities: staged.map((row) => row.channex),
      staged_at: new Date().toISOString(),
    });
  }

  /**
   * Finalizes the Firestore document after all mappings are committed.
   * Sets connection_status → 'active' and clears staged data.
   */
  private async finalizeFirestoreDocument(
    propertyId: string,
    channelId: string,
    roomTypes: SyncedRoomType[],
  ): Promise<void> {
    const db = this.firebase.getFirestore();
    const snapshot = await db.collection(COLLECTION).where('channex_property_id', '==', propertyId).limit(1).get();

    if (snapshot.empty) {
      throw new NotFoundException(`No integration document found for Channex property ID: ${propertyId}`);
    }

    await this.firebase.update(snapshot.docs[0].ref, {
      connection_status: ChannexConnectionStatus.Active,
      channex_channel_id: channelId,
      oauth_refresh_required: false,
      room_types: roomTypes,
      connected_channels: FieldValue.arrayUnion('airbnb'),
      // Clear staged data — the pipeline is complete
      staged_channel_id: null,
      staged_listings: null,
      staged_channex_entities: null,
      staged_at: null,
      last_sync_timestamp: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    this.logger.log(`[COMMIT] ✓ Firestore finalized — propertyId=${propertyId} status=active`);
  }

  /**
   * Step 0 — Resolve the Airbnb channel UUID for a property.
   *
   * Identifies the Airbnb channel by checking:
   *   1. `attributes.channel` normalised to uppercase matches 'ABB' or 'AIRBNB'
   *   2. `attributes.title` includes 'airbnb' (case-insensitive fallback)
   *
   * 422 if no Airbnb channel is found — OAuth popup was never completed.
   */
  private async resolveAirbnbChannelId(propertyId: string): Promise<string> {
    const channels = await this.channex.getChannels(propertyId);

    const airbnbChannel = channels.find((ch) => {
      const attrs = ch.attributes as { title?: string; channel?: string };
      const code = (attrs.channel ?? '').trim().toUpperCase();
      const title = (attrs.title ?? '').trim().toLowerCase();
      return code === 'AIRBNB' || code === 'ABB' || title.includes('airbnb');
    });

    if (!airbnbChannel) {
      this.logger.warn(
        `[SYNC] No Airbnb channel — propertyId=${propertyId}. OAuth may not be complete.`,
      );
      throw new HttpException(
        'No Airbnb channel is connected to this property. ' +
          'Please open the authorization popup and complete the Airbnb login first.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    this.logger.log(`[SYNC] ✓ Airbnb channelId=${airbnbChannel.id}`);
    return airbnbChannel.id;
  }

  /**
   * Step 6 — Persist the final sync state to Firestore.
   *
   * Sets connection_status → 'active', stores the channel ID + room type array,
   * and clears the oauth_refresh_required flag.
   */
  private async updateFirestoreDocument(
    propertyId: string,
    channelId: string,
    roomTypes: SyncedRoomType[],
  ): Promise<void> {
    const db = this.firebase.getFirestore();

    const snapshot = await db
      .collection(COLLECTION)
      .where('channex_property_id', '==', propertyId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      throw new NotFoundException(
        `No integration document found for Channex property ID: ${propertyId}`,
      );
    }

    const docRef = snapshot.docs[0].ref;

    await this.firebase.update(docRef, {
      connection_status: ChannexConnectionStatus.Active,
      channex_channel_id: channelId,
      oauth_refresh_required: false,
      room_types: roomTypes,
      connected_channels: FieldValue.arrayUnion('airbnb'),
      last_sync_timestamp: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    this.logger.log(
      `[SYNC] ✓ Firestore updated — propertyId=${propertyId} status=active roomTypes=${roomTypes.length}`,
    );
  }

  /**
   * Strict all-or-nothing extraction for listings + listing_details.
   * Any invalid listing data aborts the whole sync before write-side effects.
   */
  private async preflightValidateListings(channelId: string): Promise<ValidatedListingSeed[]> {
    const listings = await this.channex.getAirbnbListingsAction(channelId);

    if (!listings.length) {
      this.logger.warn(
        `[SYNC] /action/listings returned empty — channelId=${channelId}. Airbnb OAuth popup was not completed.`,
      );
      throw new HttpException(
        'No Airbnb listings found. Please complete the Airbnb authorization popup first.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    this.logger.log(
      `[SYNC] Preflight listing discovery complete — channelId=${channelId} count=${listings.length}`,
    );

    const detailsResults = await Promise.all(
      listings.map(async (listing) => ({
        listing,
        details: await this.channex.getAirbnbListingDetails(channelId, listing.id),
      })),
    );

    const invalidReasons: string[] = [];
    const seeds: ValidatedListingSeed[] = [];

    for (const result of detailsResults) {
      const listingId = result.listing.id;
      const listingTitle = result.listing.title?.trim() || `Listing ${listingId}`;
      const details = result.details as Record<string, any>;

      const capacityCandidate =
        details?.listing?.person_capacity ??
        details?.person_capacity ??
        details?.listing?.capacity;

      const resolvedCapacity = Number(capacityCandidate);
      const capacityValid = Number.isFinite(resolvedCapacity) && resolvedCapacity > 0;

      const rawPrice =
        details?.listing?.pricing_settings?.default_daily_price ??
        details?.pricing_settings?.default_daily_price ??
        details?.listing?.listing_price ??
        details?.listing_price;

      const resolvedPrice = Number(rawPrice);
      const priceValid = Number.isFinite(resolvedPrice) && resolvedPrice > 0;

      const currency =
        details?.listing?.pricing_settings?.listing_currency ??
        details?.pricing_settings?.listing_currency ??
        null;

      if (!capacityValid || !priceValid) {
        invalidReasons.push(
          `listingId=${listingId} capacity=${String(capacityCandidate)} price=${String(rawPrice)}`,
        );
        continue;
      }

      seeds.push({
        listingId,
        listingTitle,
        capacity: resolvedCapacity,
        price: resolvedPrice,
        currency,
      });
    }

    if (invalidReasons.length > 0) {
      this.logger.error(
        `[SYNC] Preflight failed — invalid listing details: ${invalidReasons.join(' | ')}`,
      );

      throw new UnprocessableEntityException(
        'Failed to extract valid pricing from Airbnb. Sync aborted to prevent data corruption.',
      );
    }

    return seeds;
  }

  private async unlockCalendarAndSeedAri(
    channelId: string,
    propertyId: string,
    seeds: CalendarSeed[],
  ): Promise<void> {
    if (!seeds.length) return;

    const hasInvalidRate = seeds.some((seed) => !Number.isFinite(seed.price) || seed.price <= 0);
    if (hasInvalidRate) {
      throw new UnprocessableEntityException(
        'Failed to extract valid pricing from Airbnb. Sync aborted to prevent data corruption.',
      );
    }

    const dateFrom = new Date();
    const dateTo = new Date(dateFrom);
    dateTo.setUTCDate(dateTo.getUTCDate() + 730);

    const from = dateFrom.toISOString().slice(0, 10);
    const to = dateTo.toISOString().slice(0, 10);

    for (const seed of seeds) {
      await this.channex.updateAvailabilityRule(
        channelId,
        seed.channelRatePlanId ?? seed.ratePlanId,
        -1,
      );
    }

    await this.channex.pushAvailability(
      seeds.map((seed) => ({
        property_id: propertyId,
        room_type_id: seed.roomTypeId,
        date_from: from,
        date_to: to,
        availability: 1,
      })),
    );

    await this.channex.pushRestrictions(
      seeds.map((seed) => ({
        property_id: propertyId,
        rate_plan_id: seed.ratePlanId,
        date_from: from,
        date_to: to,
        rate: seed.price.toFixed(2),
        min_stay_arrival: 1,
        stop_sell: false,
      })),
    );
  }

  private async resolveCommitCalendarSeeds(
    propertyId: string,
    mappings: CommitMappingInput[],
  ): Promise<CalendarSeed[]> {
    const db = this.firebase.getFirestore();
    const snapshot = await db
      .collection(COLLECTION)
      .where('channex_property_id', '==', propertyId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      throw new NotFoundException(`No integration document found for Channex property ID: ${propertyId}`);
    }

    const data = snapshot.docs[0].data() as {
      staged_listings?: Array<{ airbnbId?: string; basePrice?: number }>;
      staged_channex_entities?: Array<{ roomTypeId?: string; ratePlanId?: string }>;
    };

    const stagedPriceByListing = new Map(
      (data.staged_listings ?? [])
        .filter((row) => row.airbnbId)
        .map((row) => [row.airbnbId as string, Number(row.basePrice)]),
    );

    const roomTypeByRatePlan = new Map(
      (data.staged_channex_entities ?? [])
        .filter((row) => row.ratePlanId && row.roomTypeId)
        .map((row) => [row.ratePlanId as string, row.roomTypeId as string]),
    );

    const seeds: CalendarSeed[] = mappings.map((mapping) => {
      const roomTypeId = roomTypeByRatePlan.get(mapping.ratePlanId);
      const price = stagedPriceByListing.get(mapping.otaListingId);

      if (!roomTypeId || !price || price <= 0) {
        throw new UnprocessableEntityException(
          'Failed to extract valid pricing from Airbnb. Sync aborted to prevent data corruption.',
        );
      }

      return {
        roomTypeId,
        ratePlanId: mapping.ratePlanId,
        price,
      };
    });

    return seeds;
  }

  // ─── Property Enrichment ──────────────────────────────────────────────────

  /**
   * Enriches the Channex property and Firestore integration doc with real
   * Airbnb listing data discovered post-OAuth.
   *
   * DESIGN NOTE — OAuth Chicken-and-Egg Constraint:
   *   The Channex property must exist BEFORE Airbnb OAuth can be initiated,
   *   because the OAuth IFrame is scoped to a specific property_id. This means
   *   createProperty() during provisioning uses placeholder title/currency from
   *   the admin form. The actual listing title and currency are only available
   *   after OAuth completes. This method closes that data gap.
   *
   *   Timezone is NOT updated: it was set from the host's form input (IANA tz)
   *   and is not reliably extractable from Airbnb listing metadata.
   *
   * Non-fatal: a failure logs a warning and does not abort the pipeline.
   */
  private async enrichPropertyFromAirbnbData(
    channexPropertyId: string,
    title: string,
    currency: string | null,
  ): Promise<void> {
    try {
      const updatePayload: ChannexUpdatePropertyPayload = {};
      if (title?.trim()) updatePayload.title = title.trim();
      if (currency) updatePayload.currency = currency;

      if (!Object.keys(updatePayload).length) {
        this.logger.warn(
          `[STAGE] Property enrichment skipped — no valid title/currency from Airbnb data. propertyId=${channexPropertyId}`,
        );
        return;
      }

      await this.channex.updateProperty(channexPropertyId, updatePayload);
      this.logger.log(
        `[STAGE] ✓ Channex property enriched — propertyId=${channexPropertyId} title="${updatePayload.title ?? '(unchanged)'}" currency="${updatePayload.currency ?? '(unchanged)'}"`,
      );

      // Mirror enriched values to Firestore
      const db = this.firebase.getFirestore();
      const snapshot = await db
        .collection(COLLECTION)
        .where('channex_property_id', '==', channexPropertyId)
        .limit(1)
        .get();

      if (!snapshot.empty) {
        const firestoreUpdate: Record<string, string> = { updated_at: new Date().toISOString() };
        if (updatePayload.title) firestoreUpdate.title = updatePayload.title;
        if (updatePayload.currency) firestoreUpdate.currency = updatePayload.currency;
        await snapshot.docs[0].ref.update(firestoreUpdate);
        this.logger.log(
          `[STAGE] ✓ Firestore enriched — propertyId=${channexPropertyId}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `[STAGE] Property enrichment failed (non-fatal) — propertyId=${channexPropertyId}: ${(err as Error).message}`,
      );
    }
  }

  // ─── Webhook Registration ──────────────────────────────────────────────────

  /**
   * Registers a per-property webhook subscription with Channex after channel activation.
   *
   * Idempotency — two layers:
   *   1. GET /webhooks?filter[property_id]={id}: if callback_url already registered → skip POST.
   *   2. POST returning 422 → treated as already-exists (same contract as createChannelMapping).
   *
   * On success: persists the returned `webhookId` to Firestore as `channex_webhook_id`.
   *
   * Non-fatal: any failure logs a warning and does NOT abort the pipeline.
   * The integration remains operational; per-property webhook routing will not
   * be active until a subsequent run succeeds.
   *
   * Env vars consumed:
   *   CHANNEX_WEBHOOK_CALLBACK_URL (.env) — base public URL of this server
   *   CHANNEX_WEBHOOK_SECRET (.env.secrets) — HMAC secret validated by ChannexHmacGuard
   */
  private async registerPropertyWebhook(channexPropertyId: string): Promise<void> {
    try {
      const baseCallbackUrl = process.env.CHANNEX_WEBHOOK_CALLBACK_URL;
      if (!baseCallbackUrl) {
        this.logger.warn(
          `[COMMIT] Webhook registration skipped — CHANNEX_WEBHOOK_CALLBACK_URL not set. propertyId=${channexPropertyId}`,
        );
        return;
      }

      const webhookSecret = this.secrets.get('CHANNEX_WEBHOOK_SECRET');
      if (!webhookSecret) {
        this.logger.warn(
          `[COMMIT] Webhook registration skipped — CHANNEX_WEBHOOK_SECRET not set in .env.secrets. propertyId=${channexPropertyId}`,
        );
        return;
      }

      const callbackUrl = `${baseCallbackUrl}/webhook`;

      // Idempotency preflight — skip POST if already registered
      const existing = await this.channex.listPropertyWebhooks(channexPropertyId);
      const alreadyRegistered = existing.some(
        (wh) => wh.attributes.callback_url === callbackUrl,
      );

      if (alreadyRegistered) {
        this.logger.log(
          `[COMMIT] Webhook already registered — propertyId=${channexPropertyId} callbackUrl=${callbackUrl}`,
        );
        return;
      }

      const payload: ChannexWebhookPayload = {
        property_id: channexPropertyId,
        callback_url: callbackUrl,
        is_active: true,
        send_data: true,
        headers: { 'x-channex-signature': webhookSecret },
        // Channex requires a semicolon-separated string, not an array.
        event_mask: 'booking_new;booking_modification;booking_cancellation;message_new;inquiry_new;booking_inquiry',
      };

      const result = await this.channex.createWebhookSubscription(payload);

      // Persist webhookId to Firestore
      if (result.webhookId) {
        const db = this.firebase.getFirestore();
        const snapshot = await db
          .collection(COLLECTION)
          .where('channex_property_id', '==', channexPropertyId)
          .limit(1)
          .get();

        if (!snapshot.empty) {
          await snapshot.docs[0].ref.update({
            channex_webhook_id: result.webhookId,
            updated_at: new Date().toISOString(),
          });
          this.logger.log(
            `[COMMIT] ✓ Webhook registered and persisted — propertyId=${channexPropertyId} webhookId=${result.webhookId}`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        `[COMMIT] Webhook registration failed (non-fatal) — propertyId=${channexPropertyId}: ${(err as Error).message}`,
      );
    }
  }

  private async backfillChannelRatePlanIds(
    channelId: string,
    mappings: CommitMappingInput[],
    seeds: CalendarSeed[],
  ): Promise<void> {
    const unresolved = seeds.filter((seed) => !seed.channelRatePlanId);
    if (!unresolved.length) return;

    const mappingRecords = await this.channex.getMappingRecords(channelId);
    const idByListing = new Map(
      mappingRecords
        .filter((record) => record.attributes.listing_id)
        .map((record) => [record.attributes.listing_id as string, record.id]),
    );

    for (const mapping of mappings) {
      const seed = seeds.find((item) => item.ratePlanId === mapping.ratePlanId);
      if (!seed || seed.channelRatePlanId) continue;

      const recoveredId = idByListing.get(mapping.otaListingId);
      if (recoveredId) {
        seed.channelRatePlanId = recoveredId;
      }
    }
  }

  // ─── 1:1 Pipeline helpers ─────────────────────────────────────────────────

  /**
   * Reads the parent integration document from Firestore to extract config
   * fields required for creating isolated per-listing properties.
   *
   * Called once at the start of `autoSyncProperty` to avoid repeated Firestore
   * reads inside the per-listing loop.
   */
  private async resolveParentIntegrationDoc(propertyId: string): Promise<{
    timezone: string;
    channex_group_id: string | null;
    currency: string;
    tenant_id: string;
  }> {
    const db = this.firebase.getFirestore();
    const snapshot = await db
      .collection(COLLECTION)
      .where('channex_property_id', '==', propertyId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      throw new NotFoundException(
        `No integration document found for Channex property ID: ${propertyId}`,
      );
    }

    const data = snapshot.docs[0].data();

    return {
      timezone: (data.timezone as string | undefined) || 'UTC',
      channex_group_id: (data.channex_group_id as string | null | undefined) ?? null,
      currency: (data.currency as string | undefined) || 'USD',
      tenant_id: (data.tenant_id as string | undefined) || '',
    };
  }

  /**
   * Persists the 1:1 isolated provisioning results to the parent integration
   * document in Firestore.
   *
   * Sets connection_status to:
   *   - 'active' — at least one listing was provisioned successfully
   *   - 'error'  — all listings failed
   *
   * Stores `provisioned_properties[]` so the frontend can enumerate the new
   * per-listing Channex properties for ARI management and inbox routing.
   *
   * Stores `failed_listings[]` (only when failures exist) so engineers can
   * diagnose partial-completion scenarios without reading server logs.
   */
  /**
   * Persists the 1:1 isolated provisioning results to Firestore.
   *
   * Two writes per succeeded listing:
   *   1. `channex_integrations/{integrationDocId}/properties/{channexPropertyId}`
   *      — canonical per-listing document consumed by webhook workers and the
   *        frontend inventory/inbox views.
   *   2. Parent integration document update — sets connection_status, channel ID,
   *      and records failed listings for diagnostic purposes.
   *
   * Property doc includes `integrationDocId` + `tenantId` so the collectionGroup
   * lookup in `resolveIntegration` can resolve tenant context from a webhook's
   * property_id without traversing the document hierarchy.
   */
  private async persistIsolatedSyncResults(
    parentPropertyId: string,
    channelId: string,
    succeeded: IsolatedListingResult[],
    failed: IsolatedListingFailure[],
  ): Promise<void> {
    const db = this.firebase.getFirestore();
    const snapshot = await db
      .collection(COLLECTION)
      .where('channex_property_id', '==', parentPropertyId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      this.logger.warn(
        `[SYNC:1:1] Parent doc not found for Firestore update — parentPropertyId=${parentPropertyId}`,
      );
      return;
    }

    const integrationDocId = snapshot.docs[0].id;
    const parentData = snapshot.docs[0].data();
    const tenantId = parentData.tenant_id as string;
    const now = new Date().toISOString();

    // ── Write one properties subcollection doc per succeeded listing ─────
    for (const s of succeeded) {
      const propertyRef = db
        .collection(COLLECTION)
        .doc(integrationDocId)
        .collection('properties')
        .doc(s.channexPropertyId);

      await this.firebase.set(propertyRef, {
        // Identity fields for Channex API calls
        channex_property_id: s.channexPropertyId,
        channex_channel_id: channelId,
        channex_room_type_id: s.roomTypeId,
        channex_rate_plan_id: s.ratePlanId,
        channex_channel_rate_plan_id: s.channelRatePlanId,
        // Airbnb listing linkage
        airbnb_listing_id: s.listingId,
        title: s.listingTitle,
        // Pricing snapshot (from Airbnb listing_details)
        default_price: s.defaultPrice,
        currency: s.currency,
        capacity: s.capacity,
        // Integration routing fields — required by resolveIntegration fallback
        integrationDocId,
        tenantId,
        // Status
        status: 'active',
        updatedAt: now,
      });

      this.logger.log(
        `[SYNC:1:1] ✓ Property doc written — integrationDocId=${integrationDocId} channexPropertyId=${s.channexPropertyId} listing="${s.listingTitle}"`,
      );
    }

    // ── Update parent integration document ───────────────────────────────
    const newStatus =
      succeeded.length > 0
        ? ChannexConnectionStatus.Active
        : ChannexConnectionStatus.Error;

    const update: Record<string, unknown> = {
      connection_status: newStatus,
      channex_channel_id: channelId,
      oauth_refresh_required: false,
      last_sync_timestamp: now,
      updated_at: now,
    };

    if (failed.length > 0) {
      update.failed_listings = failed.map((f) => ({
        listingId: f.listingId,
        listingTitle: f.listingTitle,
        reason: f.reason,
        step: f.step,
      }));
    }

    await this.firebase.update(snapshot.docs[0].ref, update);

    this.logger.log(
      `[SYNC:1:1] ✓ Firestore updated — integrationDocId=${integrationDocId} status=${newStatus} succeeded=${succeeded.length} failed=${failed.length}`,
    );
  }
}

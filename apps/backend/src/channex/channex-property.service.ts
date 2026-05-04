import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FirebaseService } from '../firebase/firebase.service';
import { ChannexService } from './channex.service';
import { CreateChannexPropertyDto } from './dto/create-channex-property.dto';
import {
  ChannexConnectionStatus,
  CHANNEX_EVENTS,
  AirbnbListingCalendarDay,
  type ChannexStatusChangeEvent,
} from './channex.types';

// ─── Result shapes ────────────────────────────────────────────────────────────

export interface ProvisionPropertyResult {
  /** The UUID assigned by Channex — pivot for all subsequent ARI/webhook operations. */
  channexPropertyId: string;
  /** The Firestore document ID: `{tenantId}__{channexPropertyId}`. */
  firestoreDocId: string;
}

export interface ConnectionStatusResult {
  channexPropertyId: string;
  connectionStatus: ChannexConnectionStatus;
  oauthRefreshRequired: boolean;
  lastSyncTimestamp: string | null;
  title: string;
}

// ─── Firestore collection name (single source of truth) ──────────────────────

const COLLECTION = 'channex_integrations';

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * ChannexPropertyService — orchestrates the lifecycle of a Channex property.
 *
 * Responsibilities:
 *   - Provision new properties in Channex and write the dual-ID mapping to Firestore.
 *   - Expose connection status reads used by the frontend dashboard and health cron.
 *   - Provide the `updateConnectionStatus` mutation consumed by the webhook worker
 *     (Phase 4) and the health-check cron (Phase 8).
 *
 * This service does NOT own HTTP calls to Channex — all outbound requests are
 * delegated to ChannexService (the I/O boundary). This service owns the
 * Firestore state machine and the business rules around it.
 */
@Injectable()
export class ChannexPropertyService {
  private readonly logger = new Logger(ChannexPropertyService.name);

  constructor(
    private readonly channex: ChannexService,
    private readonly firebase: FirebaseService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ─── Provisioning ─────────────────────────────────────────────────────────

  /**
   * Creates a new Property entity in Channex and persists the dual-ID mapping
   * in Firestore `channex_integrations`.
   *
   * Called when a Migo UIT admin registers a new property for Airbnb management.
   * After this succeeds, the frontend advances to Step 2: the ChannexIFrame OAuth
   * flow where the tenant connects their Airbnb account.
   *
   * Firestore document ID format: `{tenantId}__{channexPropertyId}`
   * Deterministic IDs allow direct lookups without a collection query in contexts
   * where both tenantId and channexPropertyId are known (e.g. delete endpoint).
   *
   * Channex settings hardcoded for Airbnb compatibility:
   *   - min_stay_type: 'arrival' — Airbnb evaluates min-stay on the arrival day.
   *   - allow_availability_autoupdate_on_confirmation: true — decrements inventory
   *     automatically on booking confirmation, preventing overbooking race conditions
   *     before the BullMQ worker has finished processing the full payload.
   */
  async provisionProperty(
    dto: CreateChannexPropertyDto,
  ): Promise<ProvisionPropertyResult> {
    this.logger.log(
      `[PROVISION] Starting — tenantId=${dto.tenantId} title="${dto.title}"`,
    );

    // ── Step 1: Create the property in Channex ───────────────────────────────
    const channexResponse = await this.channex.createProperty({
      title: dto.title,
      currency: dto.currency,
      timezone: dto.timezone,
      property_type: dto.propertyType ?? 'apartment',
      ...(dto.groupId ? { group_id: dto.groupId } : {}),
      settings: {
        min_stay_type: 'arrival',
        allow_availability_autoupdate_on_confirmation: true,
      },
    });

    const channexPropertyId = channexResponse.data.id;
    const firestoreDocId = `${dto.tenantId}__${channexPropertyId}`;

    this.logger.log(
      `[PROVISION] ✓ Channex property created — channexPropertyId=${channexPropertyId}`,
    );

    // ── Step 2: Persist dual-ID mapping to Firestore ─────────────────────────
    const db = this.firebase.getFirestore();
    const docRef = db.collection(COLLECTION).doc(firestoreDocId);

    await this.firebase.set(docRef, {
      // Identity
      tenant_id: dto.tenantId,
      migo_property_id: dto.migoPropertyId,
      channex_property_id: channexPropertyId,
      channex_channel_id: null,          // Populated after Airbnb OAuth (Phase 3)
      channex_webhook_id: null,          // Set by registerPropertyWebhook after commitMapping
      channex_group_id: dto.groupId ?? null,

      // Connection state — starts as 'pending' until Airbnb OAuth completes
      connection_status: ChannexConnectionStatus.Pending,
      oauth_refresh_required: false,
      last_sync_timestamp: null,

      // Property config (cached locally to avoid repeated Channex GET calls)
      title: dto.title,
      currency: dto.currency,
      timezone: dto.timezone,
      property_type: dto.propertyType ?? 'apartment',

      // Room types — populated by Phase 5 (ChannexARIService.createRoomType)
      room_types: [],
      connected_channels: [],

      // Timestamps
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    this.logger.log(
      `[PROVISION] ✓ Firestore document written — docId=${firestoreDocId}`,
    );

    return { channexPropertyId, firestoreDocId };
  }

  // ─── Status reads ─────────────────────────────────────────────────────────

  /**
   * Returns the current connection status for a given Channex property.
   *
   * Queries the `channex_integrations` collection by `channex_property_id`
   * (indexed field) rather than by document ID, since the caller (controller)
   * only has the Channex UUID — not the full `{tenantId}__{channexPropertyId}`
   * document key.
   *
   * This is also the query used by the BullMQ webhook worker in Phase 4 to
   * resolve tenant_id from an inbound webhook's property_id field in O(log n).
   */
  async getConnectionStatus(
    channexPropertyId: string,
  ): Promise<ConnectionStatusResult> {
    const doc = await this.findDocByChannexPropertyId(channexPropertyId);

    return {
      channexPropertyId,
      connectionStatus: doc.connection_status as ChannexConnectionStatus,
      oauthRefreshRequired: doc.oauth_refresh_required as boolean,
      lastSyncTimestamp: (doc.last_sync_timestamp as string | null) ?? null,
      title: doc.title as string,
    };
  }

  /**
   * Returns day-level ARI data for one listing and a bounded date range.
   */
  async getListingCalendar(
    channexPropertyId: string,
    channelId: string,
    listingId: string,
    dateFrom: string,
    dateTo: string,
  ): Promise<AirbnbListingCalendarDay[]> {
    await this.findDocByChannexPropertyId(channexPropertyId);

    return this.channex.getAirbnbListingCalendar(
      channelId,
      listingId,
      dateFrom,
      dateTo,
    );
  }

  // ─── Status mutations ─────────────────────────────────────────────────────

  /**
   * Updates `connection_status` (and `updated_at`) for a given Channex property.
   *
   * Called by:
   *   - ChannexWebhookController (Phase 4): non_acked_booking → sets 'error'
   *   - ChannexHealthCron (Phase 8): sets 'token_expired' when Channex returns
   *     an error_type field on the channel health check response
   *   - ChannexOAuthService (Phase 3): sets 'active' after successful OAuth
   *   - DELETE /channex/properties/:id: sets 'error' (soft-delete)
   *
   * When status becomes 'token_expired', also sets `oauth_refresh_required=true`
   * so the frontend ConnectionStatusBadge renders the "Re-connect" prompt.
   */
  async updateConnectionStatus(
    channexPropertyId: string,
    status: ChannexConnectionStatus,
  ): Promise<void> {
    const integration = await this.resolveIntegration(channexPropertyId);
    if (!integration) {
      this.logger.error(
        `[STATUS_UPDATE] Document not found for channexPropertyId=${channexPropertyId}`,
      );
      throw new NotFoundException(
        `No integration found for Channex property ID: ${channexPropertyId}`,
      );
    }

    const db = this.firebase.getFirestore();
    const docRef = db.collection(COLLECTION).doc(integration.firestoreDocId);
    const tenantId = integration.tenantId;

    const patch: Record<string, unknown> = {
      connection_status: status,
      updated_at: new Date().toISOString(),
    };

    // Automatically flag for re-auth when token has expired
    if (status === ChannexConnectionStatus.TokenExpired) {
      patch.oauth_refresh_required = true;
    }

    // Clear the re-auth flag when reconnection succeeds
    if (status === ChannexConnectionStatus.Active) {
      patch.oauth_refresh_required = false;
    }

    await this.firebase.update(docRef, patch);

    this.logger.log(
      `[STATUS_UPDATE] ✓ channexPropertyId=${channexPropertyId} → ${status}`,
    );

    // Emit SSE event so the frontend status chip updates in real time.
    const ssePayload: ChannexStatusChangeEvent = {
      tenantId,
      propertyId: channexPropertyId,
      status,
      timestamp: new Date().toISOString(),
    };
    this.eventEmitter.emit(CHANNEX_EVENTS.CONNECTION_STATUS_CHANGE, ssePayload);
  }

  // ─── Worker-facing resolution API ────────────────────────────────────────

  /**
   * Resolves the tenant identity and Firestore document ID for a given Channex
   * property UUID. This is the primary lookup used by the BullMQ webhook worker
   * to route an inbound booking event to the correct tenant partition.
   *
   * Returns `null` (instead of throwing) when no matching document is found —
   * the worker treats an unknown property_id as a discard-without-retry case.
   *
   * Uses the indexed `channex_property_id` field for O(log n) lookup.
   * The `firestoreDocId` is the actual Firestore document ID (`doc.id`) rather
   * than a reconstructed composite — safer against future ID format changes.
   */
  async resolveIntegration(
    channexPropertyId: string,
  ): Promise<{ tenantId: string; firestoreDocId: string } | null> {
    const db = this.firebase.getFirestore();

    // ── Primary lookup: parent integration doc (Hotel model / initial provision) ─
    const parentSnapshot = await db
      .collection(COLLECTION)
      .where('channex_property_id', '==', channexPropertyId)
      .limit(1)
      .get();

    if (!parentSnapshot.empty) {
      const doc = parentSnapshot.docs[0];
      return {
        tenantId: doc.data().tenant_id as string,
        firestoreDocId: doc.id,
      };
    }

    // ── Fallback: properties subcollection (1:1 Vacation Rental model) ──────────
    // Avoid collectionGroup indexing requirements by scanning parent integration
    // docs and querying each nested `properties` subcollection.
    const integrationsSnapshot = await db.collection(COLLECTION).get();

    for (const integrationDoc of integrationsSnapshot.docs) {
      const propertySnapshot = await integrationDoc.ref
        .collection('properties')
        .where('channex_property_id', '==', channexPropertyId)
        .limit(1)
        .get();

      if (propertySnapshot.empty) {
        continue;
      }

      const integrationData = integrationDoc.data() as Record<string, unknown>;
      const propertyData = propertySnapshot.docs[0].data() as Record<string, unknown>;
      const tenantId =
        (integrationData.tenant_id as string | undefined) ??
        (propertyData.tenantId as string | undefined) ??
        '';

      if (!tenantId) {
        throw new NotFoundException(
          `Integration resolved for Channex property ID ${channexPropertyId}, but tenant_id is missing.`,
        );
      }

      return {
        tenantId,
        firestoreDocId: integrationDoc.id,
      };
    }

    return null;
  }

  // ─── Soft delete ──────────────────────────────────────────────────────────

  /**
   * Soft-deletes a Channex integration by setting `connection_status = 'error'`.
   *
   * Does NOT call the Channex DELETE /properties endpoint — that operation is
   * irreversible on the OTA side and must be performed manually via the Channex
   * dashboard by the tenant if they wish to fully decommission the listing.
   *
   * After this, the frontend hides the property from active management views
   * (the 'error' status triggers the disabled/read-only panel state).
   */
  async softDelete(channexPropertyId: string): Promise<void> {
    this.logger.log(
      `[SOFT_DELETE] Deactivating property — channexPropertyId=${channexPropertyId}`,
    );

    await this.updateConnectionStatus(
      channexPropertyId,
      ChannexConnectionStatus.Error,
    );

    this.logger.log(
      `[SOFT_DELETE] ✓ channexPropertyId=${channexPropertyId} marked as error`,
    );
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Queries Firestore for a `channex_integrations` document by the indexed
   * `channex_property_id` field. Throws NotFoundException if no match.
   *
   * Uses `.limit(1)` — channex_property_id is globally unique (UUID assigned
   * by Channex), so there will never be more than one matching document.
   */
  private async findDocByChannexPropertyId(
    channexPropertyId: string,
  ): Promise<Record<string, unknown>> {
    const integration = await this.resolveIntegration(channexPropertyId);
    if (!integration) {
      throw new NotFoundException(
        `No integration found for Channex property ID: ${channexPropertyId}`,
      );
    }

    const db = this.firebase.getFirestore();
    const doc = await db.collection(COLLECTION).doc(integration.firestoreDocId).get();
    if (!doc.exists) {
      throw new NotFoundException(
        `No integration found for Channex property ID: ${channexPropertyId}`,
      );
    }

    return doc.data() as Record<string, unknown>;
  }
}

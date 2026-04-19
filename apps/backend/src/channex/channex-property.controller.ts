import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ChannexPropertyService,
  ConnectionStatusResult,
  ProvisionPropertyResult,
} from './channex-property.service';
import { ChannexOAuthService } from './channex-oauth.service';
import {
  ChannexSyncService,
  IsolatedSyncResult,
  StageSyncResult,
  CommitMappingInput,
  CommitMappingResult,
} from './channex-sync.service';
import { CreateChannexPropertyDto } from './dto/create-channex-property.dto';
import { GetListingCalendarQueryDto } from './dto/get-listing-calendar.query.dto';
import { ReplyToThreadDto } from './dto/reply-to-thread.dto';
import { ChannexService } from './channex.service';
import { AirbnbListingCalendarDay } from './channex.types';

/**
 * ChannexPropertyController — HTTP surface for Channex property lifecycle.
 *
 * Route prefix: channex/properties
 *
 * Endpoints:
 *   POST   /channex/properties                    → Provision new property (Step 1 of onboarding wizard)
 *   GET    /channex/properties/:id/status          → Poll connection status (frontend badge)
 *   GET    /channex/properties/:id/one-time-token  → Issue IFrame session token (Step 2)
 *   GET    /channex/properties/:id/copy-link       → CSP fallback: direct Airbnb auth URL
 *   DELETE /channex/properties/:id                 → Soft-delete (sets connection_status='error')
 *
 * The `:id` path parameter is always the `channex_property_id` UUID returned
 * by Channex during provisioning — not the Firestore document ID.
 *
 * NestJS route precedence note: static sub-path segments ('/status', '/one-time-token',
 * '/copy-link') must be declared BEFORE any route that could match a sub-path as a
 * parameter (there are none here — all sub-paths are on fixed segments, so no conflict).
 */
@Controller('channex/properties')
export class ChannexPropertyController {
  private readonly logger = new Logger(ChannexPropertyController.name);

  constructor(
    private readonly propertyService: ChannexPropertyService,
    private readonly oauthService: ChannexOAuthService,
    private readonly syncService: ChannexSyncService,
    private readonly channexService: ChannexService,
  ) {}

  /**
   * POST /channex/properties
   *
   * Step 1 of the Airbnb onboarding wizard.
   * Creates the property entity in Channex and writes the dual-ID mapping to
   * Firestore `channex_integrations`. On success, the frontend stores the
   * returned `channexPropertyId` in component state and advances to Step 2
   * (the ChannexIFrame OAuth flow).
   *
   * Body:    CreateChannexPropertyDto
   * Returns: { channexPropertyId: string, firestoreDocId: string }
   * Status:  201 Created
   *
   * Possible errors:
   *   502 Bad Gateway  — Channex API returned an unexpected error
   *   500 Internal     — CHANNEX_API_KEY not set in .env.secrets
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async provisionProperty(
    @Body() dto: CreateChannexPropertyDto,
  ): Promise<ProvisionPropertyResult> {
    this.logger.log(
      `[CTRL] POST /channex/properties — tenantId=${dto.tenantId} title="${dto.title}"`,
    );

    const result = await this.propertyService.provisionProperty(dto);

    this.logger.log(
      `[CTRL] ✓ Provisioned — channexPropertyId=${result.channexPropertyId} docId=${result.firestoreDocId}`,
    );

    return result;
  }

  /**
   * GET /channex/properties/:propertyId/status
   *
   * Returns the current Firestore connection state for a property.
   * Polled every 30 seconds by the frontend `ConnectionStatusBadge` component
   * to drive the status chip (pending / active / token_expired / error) and
   * the "Re-connect" CTA visibility.
   *
   * Param:   propertyId — the `channex_property_id` UUID
   * Returns: ConnectionStatusResult
   * Status:  200 OK
   *
   * Possible errors:
   *   404 Not Found — no Firestore document for this channex_property_id
   */
  @Get(':propertyId/status')
  async getConnectionStatus(
    @Param('propertyId') propertyId: string,
  ): Promise<ConnectionStatusResult> {
    this.logger.log(
      `[CTRL] GET /channex/properties/${propertyId}/status`,
    );

    return this.propertyService.getConnectionStatus(propertyId);
  }

  /**
   * GET /channex/properties/:propertyId/channels/:channelId/listings/:listingId/calendar
   *
   * Returns the listing calendar day snapshot from Channex for the requested
   * date window. The frontend uses this to render the Inventory & Rates grid.
   */
  @Get(':propertyId/channels/:channelId/listings/:listingId/calendar')
  async getListingCalendar(
    @Param('propertyId') propertyId: string,
    @Param('channelId') channelId: string,
    @Param('listingId') listingId: string,
    @Query() query: GetListingCalendarQueryDto,
  ): Promise<AirbnbListingCalendarDay[]> {
    this.logger.log(
      `[CTRL] GET /channex/properties/${propertyId}/channels/${channelId}/listings/${listingId}/calendar — dateFrom=${query.date_from} dateTo=${query.date_to}`,
    );

    const days = await this.propertyService.getListingCalendar(
      propertyId,
      channelId,
      listingId,
      query.date_from,
      query.date_to,
    );

    this.logger.log(
      `[CTRL] ✓ Calendar response — propertyId=${propertyId} listingId=${listingId} days=${days.length}`,
    );

    return days;
  }

  /**
   * POST /channex/properties/:propertyId/availability
   *
   * Availability update endpoint used by the Inventory/ARI panel to block or
   * unblock date ranges for a single room type.
   */
  @Post(':propertyId/availability')
  @HttpCode(HttpStatus.OK)
  async updateAvailability(
    @Param('propertyId') propertyId: string,
    @Body()
    body: {
      roomTypeId?: string;
      dateFrom?: string;
      dateTo?: string;
      availability?: number;
      room_type_id?: string;
      date_from?: string;
      date_to?: string;
    },
  ): Promise<{ status: 'ok' }> {
    const roomTypeId = body.roomTypeId ?? body.room_type_id;
    const dateFrom = body.dateFrom ?? body.date_from;
    const dateTo = body.dateTo ?? body.date_to;
    const availability = body.availability;

    if (!roomTypeId || !dateFrom || !dateTo || (availability !== 0 && availability !== 1)) {
      throw new BadRequestException(
        'Invalid availability payload. Expected roomTypeId/dateFrom/dateTo and availability 0|1.',
      );
    }

    this.logger.log(
      `[CTRL] POST /channex/properties/${propertyId}/availability — roomTypeId=${roomTypeId} ${dateFrom}→${dateTo} availability=${availability}`,
    );

    await this.channexService.pushAvailabilityFromPropertyController(propertyId, {
      roomTypeId,
      dateFrom,
      dateTo,
      availability,
    });

    this.logger.log(
      `[CTRL] ✓ Availability update accepted — propertyId=${propertyId} roomTypeId=${roomTypeId}`,
    );

    return { status: 'ok' };
  }

  /**
   * GET /channex/properties/:propertyId/one-time-token
   *
   * Step 2 of the Airbnb onboarding wizard (and re-connect flow).
   * Issues a single-use, 15-minute session token scoped to the given property.
   * The frontend ChannexIFrame component calls this on mount, then constructs the
   * IFrame src URL:
   *   {CHANNEX_IFRAME_BASE_URL}/auth/exchange
   *     ?oauth_session_key={token}
   *     &app_mode=headless
   *     &redirect_to=/channels
   *     &property_id={propertyId}
   *     &channels=ABB
   *
   * The token is invalidated after first use — a new request is required for
   * each IFrame mount (e.g. after close/reopen, error retry, or token expiry).
   *
   * Param:   propertyId — the `channex_property_id` UUID
   * Returns: { token: string }
   * Status:  200 OK
   *
   * Possible errors:
   *   502 Bad Gateway  — Channex API returned an unexpected error
   *   401 / 403        — CHANNEX_API_KEY is invalid or lacks privileges
   */
  @Get(':propertyId/one-time-token')
  async getOneTimeToken(
    @Param('propertyId') propertyId: string,
  ): Promise<{ token: string }> {
    this.logger.log(
      `[CTRL] GET /channex/properties/${propertyId}/one-time-token`,
    );

    const token = await this.oauthService.generateOneTimeToken(propertyId);
    return { token };
  }

  /**
   * GET /channex/properties/:propertyId/copy-link
   *
   * CSP fallback endpoint — used when the tenant's browser blocks IFrames from
   * staging.channex.io (Content Security Policy restrictions).
   *
   * The ChannexIFrame React component requests this URL after detecting an IFrame
   * load error. The frontend renders an "Open in New Tab" button pointing to the
   * returned URL, allowing the Airbnb OAuth flow to complete in a separate tab
   * without losing the Migo UIT session context.
   *
   * Param:   propertyId — the `channex_property_id` UUID
   * Returns: { url: string }
   * Status:  200 OK
   *
   * Possible errors:
   *   502 Bad Gateway  — Channex API returned an unexpected error
   */
  @Get(':propertyId/copy-link')
  async getCopyLink(
    @Param('propertyId') propertyId: string,
  ): Promise<{ url: string }> {
    this.logger.log(
      `[CTRL] GET /channex/properties/${propertyId}/copy-link`,
    );

    const url = await this.oauthService.generateCopyLink(propertyId);
    return { url };
  }

  /**
   * POST /channex/properties/:propertyId/sync
   *
   * Phase 9 — Auto-Mapping trigger.
   * Called by the frontend "Sync Listings & Complete" button after the user has
   * completed the Airbnb OAuth popup.
   *
   * Sequence:
   *   1. Resolves the Airbnb channel ID for the property via Channex channels API.
   *   2. Fetches OTA room listings — empty list means OAuth not yet complete (422).
   *   3. For each listing: creates Room Type → Rate Plan → Channel Mapping.
   *   4. Updates Firestore: connection_status='active', room_types array persisted.
   *
   * Body:    { tenantId: string }
   * Returns: AutoSyncResult — { channelId, roomTypesSynced, roomTypes[] }
   * Status:  201 Created
   *
   * Possible errors:
   *   422 Unprocessable Entity — OAuth not complete / no Airbnb listings found
   *   404 Not Found            — property was never provisioned (no Firestore doc)
   *   502 Bad Gateway          — Channex API error during room type / mapping creation
   */
  @Post(':propertyId/sync')
  @HttpCode(HttpStatus.CREATED)
  async syncProperty(
    @Param('propertyId') propertyId: string,
    @Body('tenantId') tenantId: string,
  ): Promise<IsolatedSyncResult> {
    this.logger.log(
      `[CTRL] POST /channex/properties/${propertyId}/sync — tenantId=${tenantId}`,
    );

    const result = await this.syncService.autoSyncProperty(propertyId, tenantId);

    this.logger.log(
      `[CTRL] ✓ Sync complete — succeeded=${result.succeeded.length} failed=${result.failed.length}`,
    );

    return result;
  }

  /**
   * POST /channex/properties/:propertyId/sync_stage
   *
   * Phase 1 of the Stage & Review pipeline.
   * Discovers raw Airbnb listings and auto-creates Channex Room Types + Rate Plans
   * seeded with actual Airbnb data (capacity, price, currency).
   *
   * Does NOT inject any channel mappings or activate the channel.
   * Returns the staged rows so the frontend MappingReviewModal can display them
   * for user review before committing.
   *
   * Body:    { tenantId: string }
   * Returns: StageSyncResult — { channelId, propertyId, staged[] }
   * Status:  201 Created
   *
   * Possible errors:
   *   422 — Airbnb OAuth not complete (no listings found)
   *   404 — property not provisioned in Firestore
   *   502 — Channex API error during Room Type / Rate Plan creation
   */
  @Post(':propertyId/sync_stage')
  @HttpCode(HttpStatus.CREATED)
  async stageSyncProperty(
    @Param('propertyId') propertyId: string,
    @Body('tenantId') tenantId: string,
  ): Promise<StageSyncResult> {
    this.logger.log(
      `[CTRL] POST /channex/properties/${propertyId}/sync_stage — tenantId=${tenantId}`,
    );

    const result = await this.syncService.stageSync(propertyId, tenantId ?? '');

    this.logger.log(
      `[CTRL] ✓ Stage complete — channelId=${result.channelId} rows=${result.staged.length}`,
    );

    return result;
  }

  /**
   * POST /channex/properties/:propertyId/commit_mapping
   *
   * Phase 3 of the Stage & Review pipeline.
   * Commits the user-confirmed Airbnb ↔ Channex Rate Plan pairings, activates
   * the channel, pulls historical reservations, and finalizes Firestore state.
   *
   * Body:    { channelId: string, mappings: Array<{ ratePlanId, otaListingId }> }
   * Returns: CommitMappingResult — { channelId, mapped, alreadyMapped }
   * Status:  201 Created
   *
   * Possible errors:
   *   400 — missing channelId or empty mappings array
   *   502 — Channex API error during mapping / activation
   */
  @Post(':propertyId/commit_mapping')
  @HttpCode(HttpStatus.CREATED)
  async commitMapping(
    @Param('propertyId') propertyId: string,
    @Body('channelId') channelId: string,
    @Body('mappings') mappings: CommitMappingInput[],
  ): Promise<CommitMappingResult> {
    this.logger.log(
      `[CTRL] POST /channex/properties/${propertyId}/commit_mapping — channelId=${channelId} pairs=${mappings?.length ?? 0}`,
    );

    if (!channelId) {
      throw new BadRequestException('channelId is required in the request body.');
    }

    const result = await this.syncService.commitMapping(channelId, propertyId, mappings ?? []);

    this.logger.log(
      `[CTRL] ✓ Commit complete — mapped=${result.mapped} alreadyMapped=${result.alreadyMapped}`,
    );

    return result;
  }

  /**
   * POST /channex/properties/:propertyId/threads/:threadId/reply
   *
   * Sends an outbound host reply to a Channex message thread. The Channex
   * Messages App forwards the reply to the appropriate OTA (Airbnb) on behalf
   * of the host.
   *
   * The frontend performs an optimistic Firestore write before calling this
   * endpoint so the host sees the message immediately. If this call fails, the
   * frontend marks the optimistic document with `sendStatus: 'failed'`.
   *
   * Params:
   *   propertyId — the `channex_property_id` UUID (routes to the correct account)
   *   threadId   — the `message_thread_id` from the inbound Channex webhook
   *
   * Body:    { message: string }
   * Returns: { channexMessageId: string }
   * Status:  201 Created
   *
   * Possible errors:
   *   400 Bad Request  — message is empty or exceeds 4096 chars
   *   502 Bad Gateway  — Channex API returned an unexpected error
   *   401 / 403        — CHANNEX_API_KEY invalid or lacks messaging privileges
   */
  @Post(':propertyId/threads/:threadId/reply')
  @HttpCode(HttpStatus.CREATED)
  async replyToThread(
    @Param('propertyId') propertyId: string,
    @Param('threadId') threadId: string,
    @Body() dto: ReplyToThreadDto,
  ): Promise<{ channexMessageId: string }> {
    this.logger.log(
      `[CTRL] POST /channex/properties/${propertyId}/threads/${threadId}/reply`,
    );

    const response = await this.channexService.replyToThread(threadId, propertyId, dto.message);

    this.logger.log(
      `[CTRL] ✓ Reply dispatched — channexMessageId=${response.data?.id ?? '?'}`,
    );

    return { channexMessageId: response.data?.id ?? '' };
  }

  /**
   * DELETE /channex/properties/:propertyId
   *
   * Soft-deletes the integration by setting `connection_status = 'error'` in
   * Firestore. Does NOT call the Channex DELETE /properties endpoint — that
   * is irreversible on the OTA side and requires manual action in the Channex
   * dashboard if the tenant wants to fully decommission the listing.
   *
   * After this call, the frontend hides the property from active management
   * views; the 'error' status keeps the panel in read-only mode.
   *
   * Param:  propertyId — the `channex_property_id` UUID
   * Status: 204 No Content
   *
   * Possible errors:
   *   404 Not Found — no Firestore document for this channex_property_id
   */
  @Delete(':propertyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async softDelete(@Param('propertyId') propertyId: string): Promise<void> {
    this.logger.log(
      `[CTRL] DELETE /channex/properties/${propertyId} — initiating soft-delete`,
    );

    await this.propertyService.softDelete(propertyId);

    this.logger.log(
      `[CTRL] ✓ Soft-deleted — channexPropertyId=${propertyId}`,
    );
  }
}

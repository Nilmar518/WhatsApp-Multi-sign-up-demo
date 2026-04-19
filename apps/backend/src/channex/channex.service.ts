import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { DefensiveLoggerService } from '../common/logger/defensive-logger.service';
import { SecretManagerService } from '../common/secrets/secret-manager.service';
import {
  AirbnbActionListingEntry,
  AirbnbListingCalendarDay,
  AirbnbListingCalendarResponse,
  AirbnbActionListingsResponse,
  AirbnbListingDetails,
  AirbnbListingDetailsResponse,
  AvailabilityEntryDto,
  ChannexARIResponse,
  ChannexChannelItem,
  ChannexChannelListResponse,
  ChannexCreateMappingPayload,
  ChannexMappingRecord,
  ChannexMappingRecordsResponse,
  ChannexOneTimeTokenResponse,
  ChannexPropertyPayload,
  ChannexPropertyResponse,
  ChannexRatePlanPayload,
  ChannexRatePlanResponse,
  ChannexRoomTypePayload,
  ChannexRoomTypeResponse,
  ChannexUpdateMappingPayload,
  ChannexUpdatePropertyPayload,
  ChannexWebhookPayload,
  ChannexWebhookResponse,
  ChannexWebhookListResponse,
  BookingRevisionDto,
  RestrictionEntryDto,
  ChannexSendMessagePayload,
  ChannexSendMessageResponse,
  ChannexInstallApplicationPayload,
  ChannexInstallApplicationResponse,
} from './channex.types';

// ─── Channex-specific error ──────────────────────────────────────────────────

/**
 * Thrown when the Channex API returns HTTP 429 Too Many Requests.
 * The ARI flush worker catches this to route the failed job into the Dead Letter
 * Queue with a 60-second back-off delay, per the Channex rate-limit SOP.
 */
export class ChannexRateLimitError extends Error {
  constructor() {
    super('Channex API rate limit exceeded (429). Job will be retried after 60s.');
    this.name = 'ChannexRateLimitError';
  }
}

/**
 * Thrown for Channex auth failures (401 / 403).
 * Triggers `connection_status = token_expired` in Firestore and an SSE alert.
 */
export class ChannexAuthError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: 401 | 403,
  ) {
    super(message);
    this.name = 'ChannexAuthError';
  }
}

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * ChannexService — thin HTTP adapter to the Channex REST API.
 *
 * Responsibilities:
 *   - Prepend the correct base URL (staging vs production via CHANNEX_BASE_URL).
 *   - Inject `user-api-key` header on every request from SecretManagerService.
 *   - Delegate all HTTP calls to DefensiveLoggerService.request<T>() for
 *     consistent structured logging and latency tracking.
 *   - Translate Channex-specific HTTP errors (401, 403, 429) into typed
 *     exceptions that callers can act on without parsing raw Axios errors.
 *
 * This service has NO business logic — it is a pure I/O boundary.
 * All orchestration (Firestore writes, queue jobs, status updates) lives in the
 * feature services (ChannexPropertyService, ChannexARIService, etc.).
 */
@Injectable()
export class ChannexService {
  private readonly logger = new Logger(ChannexService.name);
  private readonly baseUrl: string;

  constructor(
    private readonly defLogger: DefensiveLoggerService,
    private readonly secrets: SecretManagerService,
  ) {
    // Resolved once at construction time — value never changes at runtime.
    // Staging: https://staging.channex.io/api/v1
    // Production: https://api.channex.io/v1
    this.baseUrl =
      process.env.CHANNEX_BASE_URL ?? 'https://staging.channex.io/api/v1';

    this.logger.log(`[CHANNEX] Base URL: ${this.baseUrl}`);
  }

  // ─── Auth header ──────────────────────────────────────────────────────────

  /**
   * Builds the `user-api-key` header required by every Channex API call.
   * The key is stored in `.env.secrets` as CHANNEX_API_KEY and managed by
   * SecretManagerService (same pattern as META_APP_ID, META_APP_SECRET).
   */
  private buildAuthHeaders(): Record<string, string> {
    const apiKey = this.secrets.get('CHANNEX_API_KEY');

    if (!apiKey) {
      throw new HttpException(
        'CHANNEX_API_KEY is not set. Add it to apps/backend/.env.secrets.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return {
      'user-api-key': apiKey,
      'Content-Type': 'application/json',
    };
  }

  // ─── Error normalisation ──────────────────────────────────────────────────

  /**
   * Maps Channex HTTP error responses to typed exceptions.
   *
   * Channex error body shape: { error_code: string, message: string }
   * Distinct from Meta's shape ({ error: { code, message } }) — DefensiveLoggerService
   * will NOT incorrectly throw TokenExpiredError for these responses because Channex
   * never uses Meta's numeric codes (190 / 100).
   */
  private normaliseError(err: any): never {
    const status: number | undefined = err?.response?.status;
    const errorCode: string | undefined = err?.response?.data?.error_code;
    const message: string =
      (err?.response?.data?.message as string | undefined) ?? err?.message ?? 'Unknown Channex error';

    if (status === 429 || errorCode === 'http_too_many_requests') {
      this.logger.warn(`[CHANNEX] 429 — Rate limit hit. Surfacing ChannexRateLimitError.`);
      throw new ChannexRateLimitError();
    }

    if (status === 401) {
      this.logger.error(`[CHANNEX] 401 — API key invalid or missing.`);
      throw new ChannexAuthError(`Channex 401: ${message}`, 401);
    }

    if (status === 403) {
      this.logger.error(`[CHANNEX] 403 — Insufficient privileges for this operation.`);
      throw new ChannexAuthError(`Channex 403: ${message}`, 403);
    }

    // Re-throw anything else as a generic bad gateway so callers get a clean error.
    throw new HttpException(
      `Channex API error (${status ?? 'unknown'}): ${message}`,
      HttpStatus.BAD_GATEWAY,
    );
  }

  // ─── Property API ─────────────────────────────────────────────────────────

  /**
   * Creates a new Property entity in Channex.
   *
   * POST /api/v1/properties
   * Returns the `channex_property_id` (UUID) which becomes the pivot for all
   * subsequent operations: room types, ARI pushes, channel mapping, webhooks.
   *
   * Called by ChannexPropertyService.provisionProperty() as part of the
   * one-shot onboarding flow when an admin registers a new property in Migo UIT.
   */
  async createProperty(
    payload: ChannexPropertyPayload,
  ): Promise<ChannexPropertyResponse> {
    this.logger.log(`[CHANNEX] Creating property: "${payload.title}"`);

    try {
      return await this.defLogger.request<ChannexPropertyResponse>({
        method: 'POST',
        url: `${this.baseUrl}/properties`,
        headers: this.buildAuthHeaders(),
        data: { property: payload },
      });
    } catch (err) {
      this.normaliseError(err);
    }
  }

  /**
   * Updates an existing Channex Property entity with new attributes (partial update).
   *
   * PUT /api/v1/properties/{propertyId}
   *
   * Called by ChannexSyncService.enrichPropertyFromAirbnbData() to overwrite the
   * placeholder title and currency set during provisioning (before OAuth) with the
   * real values sourced from the Airbnb listing after OAuth completes.
   *
   * Only the fields included in `payload` are overwritten — Channex accepts
   * partial updates. Timezone is never sent here (see ChannexUpdatePropertyPayload).
   *
   * @param propertyId  Channex property UUID
   * @param payload     Partial attributes to overwrite (title, currency)
   */
  async updateProperty(
    propertyId: string,
    payload: ChannexUpdatePropertyPayload,
  ): Promise<ChannexPropertyResponse> {
    this.logger.log(
      `[CHANNEX] Updating property — propertyId=${propertyId} title="${payload.title ?? '(unchanged)'}" currency="${payload.currency ?? '(unchanged)'}"`,
    );

    try {
      const response = await this.defLogger.request<ChannexPropertyResponse>({
        method: 'PUT',
        url: `${this.baseUrl}/properties/${propertyId}`,
        headers: this.buildAuthHeaders(),
        data: { property: payload },
      });

      this.logger.log(
        `[CHANNEX] ✓ Property updated — propertyId=${propertyId}`,
      );

      return response;
    } catch (err) {
      this.normaliseError(err);
    }
  }

  // ─── OAuth / IFrame API ───────────────────────────────────────────────────

  /**
   * Generates a one-time session token scoped to a specific property.
   *
   * POST /api/v1/auth/one_time_token
   * Token TTL: 15 minutes, single-use (invalidated after first IFrame exchange).
   * The token is returned to the frontend via GET /channex/properties/:id/one-time-token
   * and embedded in the IFrame src URL — it is never persisted.
   */
  async getOneTimeToken(propertyId: string): Promise<string> {
    this.logger.log(
      `[CHANNEX] Requesting one-time token — propertyId=${propertyId}`,
    );

    try {
      const response = await this.defLogger.request<ChannexOneTimeTokenResponse>({
        method: 'POST',
        url: `${this.baseUrl}/auth/one_time_token`,
        headers: this.buildAuthHeaders(),
        data: { property_id: propertyId },
      });

      const token = response?.data?.token;

      if (!token) {
        throw new HttpException(
          'Channex one_time_token response did not contain data.token.',
          HttpStatus.BAD_GATEWAY,
        );
      }

      this.logger.log(
        `[CHANNEX] ✓ One-time token issued — propertyId=${propertyId}`,
      );

      return token;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.normaliseError(err);
    }
  }

  // ─── Booking Revision API ─────────────────────────────────────────────────

  /**
   * Pulls the full booking revision document for a given revision ID.
   *
   * GET /api/v1/booking_revisions/:id
   * This is the "Pull" step in the Push/Pull webhook architecture:
   *   1. Channex pushes a thin ping (revision_id only, no PII) to our webhook endpoint.
   *   2. The BullMQ worker calls this method to retrieve the complete booking data
   *      from a secure, authenticated context — PII never transits the webhook pipe.
   *
   * After processing, the worker must acknowledge the revision via the Channex ACK
   * endpoint to prevent non_acked_booking retry storms.
   */
  async getBookingRevision(revisionId: string): Promise<BookingRevisionDto> {
    this.logger.log(
      `[CHANNEX] Pulling booking revision — revisionId=${revisionId}`,
    );

    try {
      return await this.defLogger.request<BookingRevisionDto>({
        method: 'GET',
        url: `${this.baseUrl}/booking_revisions/${revisionId}`,
        headers: this.buildAuthHeaders(),
      });
    } catch (err) {
      this.normaliseError(err);
    }
  }

  /**
   * Acknowledges a booking revision, signalling to Channex that Migo UIT has
   * fully processed the event and persisted the reservation data.
   *
   * POST /api/v1/booking_revisions/:id/acknowledge
   * Omitting this step after processing will cause Channex to fire
   * `non_acked_booking` events repeatedly until the 30-minute timeout window
   * expires, triggering infrastructure alerts.
   */
  async acknowledgeBookingRevision(revisionId: string): Promise<void> {
    this.logger.log(
      `[CHANNEX] Acknowledging booking revision — revisionId=${revisionId}`,
    );

    try {
      await this.defLogger.request<void>({
        method: 'POST',
        url: `${this.baseUrl}/booking_revisions/${revisionId}/acknowledge`,
        headers: this.buildAuthHeaders(),
      });

      this.logger.log(
        `[CHANNEX] ✓ Booking revision acknowledged — revisionId=${revisionId}`,
      );
    } catch (err) {
      // Log but do not re-throw — a failed ACK should not roll back an already
      // persisted reservation. The non_acked_booking event will surface the issue.
      this.logger.error(
        `[CHANNEX] Failed to acknowledge revisionId=${revisionId}: ${(err as Error).message}`,
      );
    }
  }

  // ─── Room Type API ────────────────────────────────────────────────────────

  /**
   * Creates a Room Type entity under a specific Property.
   *
   * POST /api/v1/room_types
   * A Property is only a container — it cannot receive bookings until it has at
   * least one Room Type. For Airbnb vacation rentals, one Room Type (the full
   * listing) is typically sufficient.
   *
   * IMPORTANT: `availability` defaults to 0 on creation. The property will NOT
   * be visible on Airbnb until ChannexARIService pushes availability > 0.
   */
  async createRoomType(
    payload: ChannexRoomTypePayload,
  ): Promise<ChannexRoomTypeResponse> {
    this.logger.log(
      `[CHANNEX] Creating room type: "${payload.title}" — propertyId=${payload.property_id}`,
    );

    try {
      return await this.defLogger.request<ChannexRoomTypeResponse>({
        method: 'POST',
        url: `${this.baseUrl}/room_types`,
        headers: this.buildAuthHeaders(),
        data: { room_type: payload },
      });
    } catch (err) {
      this.normaliseError(err);
    }
  }

  /**
   * Lists room types for a property.
   *
   * GET /api/v1/room_types?filter[property_id]={propertyId}
   *
   * Used by ChannexSyncService to make room-type creation idempotent.
   */
  async getRoomTypes(propertyId: string): Promise<Array<ChannexRoomTypeResponse['data']>> {
    this.logger.log(`[CHANNEX] Listing room types — propertyId=${propertyId}`);

    interface RoomTypeListResponse {
      data: Array<ChannexRoomTypeResponse['data']>;
    }

    try {
      const response = await this.defLogger.request<RoomTypeListResponse>({
        method: 'GET',
        url: `${this.baseUrl}/room_types?filter[property_id]=${encodeURIComponent(propertyId)}`,
        headers: this.buildAuthHeaders(),
      });

      const roomTypes = response?.data ?? [];
      this.logger.log(`[CHANNEX] ✓ Room types fetched — count=${roomTypes.length}`);
      return roomTypes;
    } catch (err) {
      this.normaliseError(err);
    }
  }

  // ─── Channel Connection URL (Copy-Link CSP fallback) ─────────────────────

  /**
   * Generates a shareable direct connection URL for a specific OTA channel.
   *
   * GET /api/v1/properties/:propertyId/channels/:channel/connect_url
   *
   * Used as a fallback when the tenant's browser enforces a strict Content
   * Security Policy that blocks third-party IFrames (staging.channex.io origin).
   * The returned URL opens the Airbnb OAuth flow in a new browser tab instead
   * of inside the embedded IFrame.
   *
   * Called by ChannexOAuthService.generateCopyLink() which is exposed via
   * GET /channex/properties/:propertyId/copy-link on the controller.
   *
   * @param propertyId  The Channex property UUID
   * @param channel     OTA channel code — 'ABB' for Airbnb, 'BDC' for Booking.com
   */
  async getChannelConnectionUrl(
    propertyId: string,
    channel: string,
  ): Promise<string> {
    this.logger.log(
      `[CHANNEX] Requesting copy-link — propertyId=${propertyId} channel=${channel}`,
    );

    interface ConnectionUrlResponse {
      data: { url: string };
    }

    try {
      const response = await this.defLogger.request<ConnectionUrlResponse>({
        method: 'GET',
        url: `${this.baseUrl}/properties/${propertyId}/channels/${channel}/connect_url`,
        headers: this.buildAuthHeaders(),
      });

      const url = response?.data?.url;

      if (!url) {
        throw new HttpException(
          'Channex connect_url response did not contain data.url.',
          HttpStatus.BAD_GATEWAY,
        );
      }

      this.logger.log(
        `[CHANNEX] ✓ Copy-link issued — propertyId=${propertyId} channel=${channel}`,
      );

      return url;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.normaliseError(err);
    }
  }

  // ─── Channel & OTA Room API (Auto-Mapping) ───────────────────────────────

  /**
   * Fetches full channel details for a given channel UUID.
   *
   * GET /api/v1/channels/{channelId}
   *
   * Returns the complete channel object including `attributes.settings` (which
   * holds the OTA credentials stored during the IFrame connection — OAuth tokens
   * for Airbnb, hotel_id/credentials for Booking.com) and `attributes.channel`
   * (the OTA channel code, e.g. "AirBNB", "BookingCom").
   *
   * Used by BookingPipelineService as the preflight for POST /channels/mapping_details:
   * the `settings` extracted here are forwarded verbatim to that endpoint.
   *
   * Documented in Airbnb Connection API PDF (page 7).
   */
  async getChannelDetails(channelId: string): Promise<{
    id: string;
    channel: string;
    settings: Record<string, unknown>;
    isActive: boolean;
    properties: string[];
  }> {
    this.logger.log(`[CHANNEX] Fetching channel details — channelId=${channelId}`);

    interface FullChannelDetailsResponse {
      data: {
        id: string;
        attributes: {
          channel: string;
          is_active: boolean;
          settings: Record<string, unknown>;
          properties?: string[];
        };
        relationships?: {
          properties?: { data?: Array<{ id: string }> };
        };
      };
    }

    try {
      const response = await this.defLogger.request<FullChannelDetailsResponse>({
        method: 'GET',
        url: `${this.baseUrl}/channels/${channelId}`,
        headers: this.buildAuthHeaders(),
      });

      const attrs = response?.data?.attributes;
      const fromAttributes = attrs?.properties ?? [];
      const fromRelationships =
        response?.data?.relationships?.properties?.data
          ?.map((e) => e.id)
          .filter(Boolean) ?? [];

      this.logger.log(
        `[CHANNEX] ✓ Channel details — channelId=${channelId} channel=${attrs?.channel} isActive=${attrs?.is_active}`,
      );

      return {
        id: response.data.id,
        channel: attrs?.channel ?? '',
        settings: attrs?.settings ?? {},
        isActive: attrs?.is_active ?? false,
        properties: Array.from(new Set([...fromAttributes, ...fromRelationships])),
      };
    } catch (err) {
      this.normaliseError(err);
    }
  }

  /**
   * Fetches OTA rooms/listings for a given channel using stored credentials.
   *
   * POST /api/v1/channels/mapping_details
   *
   * IMPORTANT: The `settings` argument must come verbatim from
   * `getChannelDetails(channelId).settings` — Channex documentation states:
   * "tokens should be used from existed Channel" (Airbnb Connection API PDF, p.7).
   *
   * The `channel` code is the OTA identifier (e.g. "AirBNB", "BookingCom").
   * Both values are extracted from the live channel object so this method has
   * zero hardcoded credentials.
   *
   * Response shape (confirmed for Airbnb; assumed similar for Booking.com):
   * { data: { listing_id_dictionary: { values: [{ id, title, type }] } } }
   *
   * For Booking.com, the response structure has NOT been confirmed from official
   * documentation — callers must validate the returned shape before processing.
   *
   * @param channelCode  OTA channel identifier (from channel.attributes.channel)
   * @param settings     OTA credentials object (from channel.attributes.settings)
   */
  async getMappingDetails(
    channelCode: string,
    settings: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    this.logger.log(
      `[CHANNEX] Fetching mapping details — channel=${channelCode}`,
    );

    try {
      const response = await this.defLogger.request<Record<string, unknown>>({
        method: 'POST',
        url: `${this.baseUrl}/channels/mapping_details`,
        headers: this.buildAuthHeaders(),
        data: { channel: channelCode, settings },
      });

      this.logger.log(
        `[CHANNEX] ✓ Mapping details fetched — channel=${channelCode}`,
      );

      return response ?? {};
    } catch (err) {
      this.normaliseError(err);
    }
  }

  /**
   * Lists all OTA channel connections for a given property.
   *
   * GET /api/v1/channels?filter[property_id]={propertyId}
   *
   * Used by ChannexSyncService to discover the Airbnb channel ID immediately
   * after the user has completed the OAuth popup flow. The Airbnb channel is
   * identified by its title containing "Airbnb" (case-insensitive).
   */
  async getChannels(propertyId: string): Promise<ChannexChannelItem[]> {
    this.logger.log(`[CHANNEX] Listing channels — propertyId=${propertyId}`);

    try {
      const response = await this.defLogger.request<ChannexChannelListResponse>({
        method: 'GET',
        url: `${this.baseUrl}/channels?filter[property_id]=${encodeURIComponent(propertyId)}`,
        headers: this.buildAuthHeaders(),
      });

      return response?.data ?? [];
    } catch (err) {
      this.normaliseError(err);
    }
  }

  /**
   * Resolves all property IDs attached to a channel.
   *
   * GET /api/v1/channels/{channelId}
   *
   * Channex response shape varies by environment/version. Property IDs can be
   * present either in `attributes.properties` or in
   * `relationships.properties.data[].id`.
   */
  async getChannelPropertyIds(channelId: string): Promise<string[]> {
    this.logger.log(`[CHANNEX] Fetching channel details — channelId=${channelId}`);

    interface ChannelDetailsResponse {
      data?: {
        id?: string;
        attributes?: { properties?: string[] };
        relationships?: {
          properties?: {
            data?: Array<{ id?: string }>;
          };
        };
      };
    }

    try {
      const response = await this.defLogger.request<ChannelDetailsResponse>({
        method: 'GET',
        url: `${this.baseUrl}/channels/${channelId}`,
        headers: this.buildAuthHeaders(),
      });

      const fromAttributes = response?.data?.attributes?.properties ?? [];
      const fromRelationships =
        response?.data?.relationships?.properties?.data
          ?.map((entry) => entry.id)
          .filter((id): id is string => Boolean(id)) ?? [];

      const unique = Array.from(new Set([...fromAttributes, ...fromRelationships]));

      this.logger.log(
        `[CHANNEX] ✓ Channel properties resolved — channelId=${channelId} count=${unique.length}`,
      );

      return unique;
    } catch (err) {
      this.normaliseError(err);
    }
  }

  /**
   * Fetches the pre-existing mapping records for a channel (Step 2 of auto-mapping).
   *
   * GET /api/v1/channels/{channelId}/mappings
   *
   * ARCHITECTURE NOTE: Channex creates one mapping record per Airbnb listing
   * automatically the moment OAuth completes. These records start empty
   * (room_type_id = null, rate_plan_id = null, is_mapped = false).
   * The auto-mapping flow fills them in via updateMappingRecord() — it does NOT
   * create new records. POSTing to /mappings is the wrong verb.
   *
   * If this returns an empty array immediately after a non-empty listings response,
   * Channex has not yet materialised the records (known eventual-consistency on
   * staging). ChannexSyncService will retry once after 1.5 s.
   */
  async getMappingRecords(channelId: string): Promise<ChannexMappingRecord[]> {
    this.logger.log(`[CHANNEX] Fetching mapping records — channelId=${channelId}`);

    try {
      const response = await this.defLogger.request<ChannexMappingRecordsResponse>({
        method: 'GET',
        url: `${this.baseUrl}/channels/${channelId}/mappings`,
        headers: this.buildAuthHeaders(),
      });

      const records = response?.data ?? [];
      this.logger.log(`[CHANNEX] ✓ Mapping records fetched — count=${records.length}`);
      return records;
    } catch (err) {
      this.normaliseError(err);
    }
  }

  /**
   * Creates a Rate Plan linked to a Room Type under a given Property (Step 4).
   *
   * POST /api/v1/rate_plans
   *
    * The sync pipeline seeds `options[0].rate` from validated Airbnb listing
    * details and then reinforces it with ARI pushes after channel activation.
   */
  async createRatePlan(payload: ChannexRatePlanPayload): Promise<ChannexRatePlanResponse> {
    this.logger.log(
      `[CHANNEX] Creating rate plan: "${payload.title}" — roomTypeId=${payload.room_type_id}`,
    );

    try {
      return await this.defLogger.request<ChannexRatePlanResponse>({
        method: 'POST',
        url: `${this.baseUrl}/rate_plans`,
        headers: this.buildAuthHeaders(),
        data: { rate_plan: payload },
      });
    } catch (err) {
      this.normaliseError(err);
    }
  }

  /**
   * Lists rate plans for a property.
   *
   * GET /api/v1/rate_plans?filter[property_id]={propertyId}
   *
   * Used by ChannexSyncService to make rate-plan creation idempotent.
   */
  async getRatePlans(propertyId: string): Promise<Array<ChannexRatePlanResponse['data']>> {
    this.logger.log(`[CHANNEX] Listing rate plans — propertyId=${propertyId}`);

    interface RatePlanListResponse {
      data: Array<ChannexRatePlanResponse['data']>;
    }

    try {
      const response = await this.defLogger.request<RatePlanListResponse>({
        method: 'GET',
        url: `${this.baseUrl}/rate_plans?filter[property_id]=${encodeURIComponent(propertyId)}`,
        headers: this.buildAuthHeaders(),
      });

      const ratePlans = response?.data ?? [];
      this.logger.log(`[CHANNEX] ✓ Rate plans fetched — count=${ratePlans.length}`);
      return ratePlans;
    } catch (err) {
      this.normaliseError(err);
    }
  }

  /**
   * Patches an existing mapping record with a Channex Room Type + Rate Plan (Step 5).
   *
   * PUT /api/v1/channels/{channelId}/mappings/{mappingId}
   *
   * This is the correct verb for the Channex mapping flow. The mapping record
   * was pre-created by Channex when the Airbnb OAuth completed — we are filling
   * in the Channex-side IDs (room_type_id, rate_plan_id) and setting is_mapped=true.
   * POSTing to /mappings to create a new record is incorrect and will fail.
   *
   * @param channelId  The Channex channel UUID
   * @param mappingId  The UUID of the pre-existing mapping record (from getMappingRecords)
   * @param payload    room_type_id + rate_plan_id + is_mapped: true
   */
  async updateMappingRecord(
    channelId: string,
    mappingId: string,
    payload: ChannexUpdateMappingPayload,
  ): Promise<void> {
    this.logger.log(
      `[CHANNEX] Patching mapping record — channelId=${channelId} mappingId=${mappingId} roomTypeId=${payload.room_type_id}`,
    );

    try {
      await this.defLogger.request<unknown>({
        method: 'PUT',
        url: `${this.baseUrl}/channels/${channelId}/mappings/${mappingId}`,
        headers: this.buildAuthHeaders(),
        data: { mapping: payload },
      });

      this.logger.log(
        `[CHANNEX] ✓ Mapping record patched — mappingId=${mappingId} ratePlanId=${payload.rate_plan_id}`,
      );
    } catch (err) {
      this.normaliseError(err);
    }
  }

  /**
   * Activates the channel after all mapping records have been filled in (Step 6).
   *
   * PUT /api/v1/channels/{channelId}  { channel: { is_active: true } }
   *
   * Channel activation does NOT happen automatically when the last mapping is
   * completed — it requires an explicit call. Without this step, ARI pushes are
   * accepted but Airbnb will not receive availability or rate updates and bookings
   * will not flow through.
   */
  async activateChannel(channelId: string): Promise<void> {
    this.logger.log(`[CHANNEX] Activating channel — channelId=${channelId}`);

    try {
      await this.defLogger.request<unknown>({
        method: 'PUT',
        url: `${this.baseUrl}/channels/${channelId}`,
        headers: this.buildAuthHeaders(),
        data: { channel: { is_active: true } },
      });

      this.logger.log(`[CHANNEX] ✓ Channel activated — channelId=${channelId}`);
    } catch (err) {
      this.normaliseError(err);
    }
  }

  /**
   * Performs a partial update on a channel via PUT /api/v1/channels/{channelId}.
   *
   * Used by BookingPipelineService to persist BDC room+rate mappings in a single
   * atomic write. The Channex UI uses this same endpoint — it embeds mapping data
   * directly inside `channel.settings.mappingSettings.rooms` and `channel.rate_plans`
   * rather than creating individual mapping records via POST /channels/{id}/mappings.
   *
   * @param channelId  Channex channel UUID
   * @param payload    Partial channel attributes to overwrite (merged by Channex server-side)
   */
  async updateChannel(
    channelId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    this.logger.log(`[CHANNEX] Updating channel — channelId=${channelId}`);

    try {
      await this.defLogger.request<unknown>({
        method: 'PUT',
        url: `${this.baseUrl}/channels/${channelId}`,
        headers: this.buildAuthHeaders(),
        data: { channel: payload },
      });

      this.logger.log(`[CHANNEX] ✓ Channel updated — channelId=${channelId}`);
    } catch (err) {
      this.normaliseError(err);
    }
  }

  /**
   * Resets channel-level availability rules to remove advance-booking blockers.
   *
   * PUT /api/v1/channels/{channelId}/execute/update_availability_rule
    * Body: {
    *   channel_rate_plan_id: string,
   *   data: {
   *     day_of_week_min_nights: [-1, -1, -1, -1, -1, -1, -1],
   *     day_of_week_check_out: [true, true, true, true, true, true, true],
   *     day_of_week_check_in: [true, true, true, true, true, true, true],
   *     booking_lead_time: 0,
   *     default_max_nights: 1125,
   *     default_min_nights: 1,
   *     max_days_notice: -1,
   *     turnover_days: 0
   *   }
    * }
   */
  async updateAvailabilityRule(
    channelId: string,
    channelRatePlanId: string,
    maxDaysNotice: number,
  ): Promise<void> {
    this.logger.log(
      `[CHANNEX] Updating availability rule — channelId=${channelId} channelRatePlanId=${channelRatePlanId} maxDaysNotice=${maxDaysNotice}`,
    );

    try {
      const unlockPayload = {
        channel_rate_plan_id: channelRatePlanId,
        data: {
          day_of_week_min_nights: [-1, -1, -1, -1, -1, -1, -1],
          day_of_week_check_out: [true, true, true, true, true, true, true],
          day_of_week_check_in: [true, true, true, true, true, true, true],
          booking_lead_time: 0,
          default_max_nights: 1125,
          default_min_nights: 1,
          max_days_notice: maxDaysNotice,
          turnover_days: 0,
        },
      };

      await this.defLogger.request<unknown>({
        method: 'PUT',
        url: `${this.baseUrl}/channels/${channelId}/execute/update_availability_rule`,
        headers: this.buildAuthHeaders(),
        data: unlockPayload,
      });

      this.logger.log(
        `[CHANNEX] ✓ Availability rule updated — channelId=${channelId}`,
      );
    } catch (err) {
      this.normaliseError(err);
    }
  }

  // ─── ARI Push API ─────────────────────────────────────────────────────────

  /**
   * Pushes availability (inventory) updates to Channex.
   *
   * POST /api/v1/availability
   * Rate limit: 10 req/min per property (shared with restrictions).
   * Always called by the ARI cron flush job — never called directly from a
   * controller. Updates are buffered in Redis and batched every 6 seconds.
   *
   * For vacation rentals (Airbnb): availability is binary (0 or 1).
   * Use date_from/date_to ranges to cover wide windows in one API call.
   *
   * Throws ChannexRateLimitError on HTTP 429 — the ARI worker catches this to
   * route the job to the Dead Letter Queue with a 60-second back-off delay.
   */
  async pushAvailability(values: AvailabilityEntryDto[]): Promise<void> {
    this.logger.log(
      `[CHANNEX] Pushing availability — ${values.length} entry(s)`,
    );

    try {
      await this.defLogger.request<ChannexARIResponse>({
        method: 'POST',
        url: `${this.baseUrl}/availability`,
        headers: this.buildAuthHeaders(),
        data: { values },
      });

      this.logger.log(`[CHANNEX] ✓ Availability push successful`);
    } catch (err) {
      this.normaliseError(err);
    }
  }

  /**
   * Convenience wrapper used by ChannexPropertyController.
   * Accepts a single range update and transforms it into Channex `values[]`.
   */
  async pushAvailabilityFromPropertyController(
    propertyId: string,
    input: {
      roomTypeId: string;
      dateFrom: string;
      dateTo: string;
      availability: 0 | 1;
    },
  ): Promise<void> {
    const values: AvailabilityEntryDto[] = [
      {
        property_id: propertyId,
        room_type_id: input.roomTypeId,
        date_from: input.dateFrom,
        date_to: input.dateTo,
        availability: input.availability,
      },
    ];

    this.logger.log(
      `[CHANNEX] Outbound availability payload — propertyId=${propertyId} roomTypeId=${input.roomTypeId} dateFrom=${input.dateFrom} dateTo=${input.dateTo} availability=${input.availability}`,
    );

    await this.pushAvailability(values);
  }

  /**
   * Pushes rate plan restrictions (rates, min/max stay, CTA/CTD) to Channex.
   *
   * POST /api/v1/restrictions
   * Note: payload key is `rate_plan_id`, NOT `room_type_id` — restrictions are
   * applied to Rate Plans (logical pricing rules), not physical Room Types.
   *
   * Conflict resolution: Channex applies Last-Write-Wins (FIFO) — use this
   * intentionally by consolidating multiple rule updates into a single `values[]`
   * array in the correct priority order.
   *
   * Throws ChannexRateLimitError on HTTP 429 (same back-off policy as availability).
   */
  async pushRestrictions(values: RestrictionEntryDto[]): Promise<void> {
    this.logger.log(
      `[CHANNEX] Pushing restrictions — ${values.length} entry(s)`,
    );

    try {
      await this.defLogger.request<ChannexARIResponse>({
        method: 'POST',
        url: `${this.baseUrl}/restrictions`,
        headers: this.buildAuthHeaders(),
        data: { values },
      });

      this.logger.log(`[CHANNEX] ✓ Restrictions push successful`);
    } catch (err) {
      this.normaliseError(err);
    }
  }

  // ─── Airbnb Action API (P0 — Raw Inventory Discovery) ─────────────────────

  /**
   * Fetches the canonical Airbnb listing inventory via the internal action endpoint.
   *
   * GET /api/v1/channels/{channelId}/action/listings
   *
   * Unlike the standard /listings endpoint (which returns 404 on staging for new
   * channels), this action endpoint queries Airbnb directly through the stored
   * OAuth tokens and returns the authoritative listing dictionary.
   *
   * Response shape: data.listing_id_dictionary.values — each entry carries
   * `id` (Airbnb listing ID) and `title` (listing name from Airbnb).
   *
   * Empty array: OAuth was not completed — surface a 422 to the client.
   */
  async getAirbnbListingsAction(channelId: string): Promise<AirbnbActionListingEntry[]> {
    this.logger.log(
      `[CHANNEX] Fetching Airbnb listings (action) — channelId=${channelId}`,
    );

    try {
      const response = await this.defLogger.request<AirbnbActionListingsResponse>({
        method: 'GET',
        url: `${this.baseUrl}/channels/${channelId}/action/listings`,
        headers: this.buildAuthHeaders(),
      });

      const entries = response?.data?.listing_id_dictionary?.values ?? [];
      this.logger.log(
        `[CHANNEX] ✓ Airbnb listings (action) fetched — channelId=${channelId} count=${entries.length}`,
      );
      return entries;
    } catch (err) {
      this.normaliseError(err);
    }
  }

  /**
   * Fetches detailed metadata for a single Airbnb listing.
   *
   * GET /api/v1/channels/{channelId}/action/listing_details?listing_id={listingId}
   *
   * Returns the canonical Airbnb-side values for:
   *   - `person_capacity`  → used as default_occupancy and occ_adults on the Room Type
   *   - `pricing_settings.default_daily_price` → seeds the Rate Plan initial rate
   *   - `pricing_settings.listing_currency`    → seeds the Rate Plan currency
   *   - `images[]`                             → optional image seeding for our own DB
   *
   * Called once per listing during the P0 discovery phase — results are batched
   * with Promise.all to parallelize the HTTP calls.
   */
  async getAirbnbListingDetails(
    channelId: string,
    listingId: string,
  ): Promise<AirbnbListingDetails> {
    this.logger.log(
      `[CHANNEX] Fetching listing details — channelId=${channelId} listingId=${listingId}`,
    );

    try {
      const response = await this.defLogger.request<AirbnbListingDetailsResponse>({
        method: 'GET',
        url: `${this.baseUrl}/channels/${channelId}/action/listing_details?listing_id=${encodeURIComponent(listingId)}`,
        headers: this.buildAuthHeaders(),
      });

      const details = response?.data;
      if (!details) {
        throw new HttpException(
          `Channex listing_details returned no data for listingId=${listingId}`,
          HttpStatus.BAD_GATEWAY,
        );
      }

      this.logger.log(
        `[CHANNEX] ✓ Listing details fetched — listingId=${listingId} capacity=${details.person_capacity}`,
      );
      return details;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.normaliseError(err);
    }
  }

  /**
   * Fetches Airbnb listing day-level ARI snapshot for a bounded date range.
   *
   * GET /api/v1/channels/{channelId}/action/get_listing_calendar
   *   ?listing_id={listingId}
   *   &date_from={YYYY-MM-DD}
   *   &date_to={YYYY-MM-DD}
   */
  async getAirbnbListingCalendar(
    channelId: string,
    listingId: string,
    dateFrom: string,
    dateTo: string,
  ): Promise<AirbnbListingCalendarDay[]> {
    this.logger.log(
      `[CHANNEX] Fetching listing calendar — channelId=${channelId} listingId=${listingId} dateFrom=${dateFrom} dateTo=${dateTo}`,
    );

    try {
      const response = await this.defLogger.request<AirbnbListingCalendarResponse>({
        method: 'GET',
        url:
          `${this.baseUrl}/channels/${channelId}/action/get_listing_calendar` +
          `?listing_id=${encodeURIComponent(listingId)}` +
          `&date_from=${encodeURIComponent(dateFrom)}` +
          `&date_to=${encodeURIComponent(dateTo)}`,
        headers: this.buildAuthHeaders(),
      });

      const days = response?.data?.calendar?.days ?? [];
      this.logger.log(
        `[CHANNEX] ✓ Listing calendar fetched — channelId=${channelId} listingId=${listingId} days=${days.length}`,
      );
      return days;
    } catch (err) {
      this.normaliseError(err);
    }
  }

  // ─── Channel Mapping API (P1 — Automated Mapping Injection) ───────────────

  /**
   * Creates a new channel mapping record binding a Channex Rate Plan to an
   * Airbnb listing.
   *
   * POST /api/v1/channels/{channelId}/mappings
   * Body: { mapping: { rate_plan_id, settings: { listing_id } } }
   *
   * This is a CREATE operation — it differs from the legacy `updateMappingRecord`
   * (PUT) which patches pre-existing records. The action-API flow creates the
   * mapping directly without requiring a prior GET to find an existing record.
   *
   * Returns `{ alreadyMapped: false }` on success (201).
   * Returns `{ alreadyMapped: true }` on 422 — the mapping already exists for this
   * listing; the sync pipeline should log and continue without aborting.
   */
  async createChannelMapping(
    channelId: string,
    payload: ChannexCreateMappingPayload,
  ): Promise<{ alreadyMapped: boolean; channelRatePlanId?: string }> {
    this.logger.log(
      `[CHANNEX] Creating channel mapping — channelId=${channelId} ratePlanId=${payload.rate_plan_id}${payload.settings.listing_id ? ` listingId=${payload.settings.listing_id}` : ''}${payload.settings.room_id ? ` roomId=${payload.settings.room_id} rateId=${payload.settings.rate_id ?? '?'}` : ''}`,
    );

    try {
      const response = await this.defLogger.request<any>({
        method: 'POST',
        url: `${this.baseUrl}/channels/${channelId}/mappings`,
        headers: this.buildAuthHeaders(),
        data: { mapping: payload },
      });

      const channelRatePlanId: string | undefined =
        response?.data?.id ??
        response?.data?.channel_rate_plan_id ??
        response?.id;

      this.logger.log(
        `[CHANNEX] ✓ Channel mapping created — channelId=${channelId}${payload.settings.listing_id ? ` listingId=${payload.settings.listing_id}` : ''}${payload.settings.room_id ? ` roomId=${payload.settings.room_id} rateId=${payload.settings.rate_id ?? '?'}` : ''} channelRatePlanId=${channelRatePlanId ?? 'unknown'}`,
      );
      return { alreadyMapped: false, channelRatePlanId };
    } catch (err) {
      // 422 = mapping already exists for this listing — idempotent, not an error.
      const status: number | undefined = (err as any)?.response?.status;
      if (status === 422) {
        const channelRatePlanId: string | undefined =
          (err as any)?.response?.data?.data?.id ??
          (err as any)?.response?.data?.channel_rate_plan_id ??
          (err as any)?.response?.data?.id;

        this.logger.warn(
          `[CHANNEX] Mapping already exists (422) — channelId=${channelId}${payload.settings.listing_id ? ` listingId=${payload.settings.listing_id}` : ''}. Treating as idempotent.`,
        );
        return { alreadyMapped: true, channelRatePlanId };
      }
      this.normaliseError(err);
    }
  }

  // ─── Channel Activation Action (P2) ───────────────────────────────────────

  /**
   * Activates the channel via the dedicated action endpoint.
   *
   * POST /api/v1/channels/{channelId}/activate
   *
   * This replaces the legacy PUT /channels/{id} { is_active: true } approach.
   * The action endpoint triggers Channex's full activation sequence — it
   * validates all mappings and flips the channel state atomically.
   *
   * Called after all mapping injections are complete (P1). Without this step,
   * ARI pushes are accepted but Airbnb will not receive availability or rate
   * updates and bookings will not flow through the channel.
   */
  async activateChannelAction(channelId: string): Promise<void> {
    this.logger.log(
      `[CHANNEX] Activating channel (action) — channelId=${channelId}`,
    );

    try {
      await this.defLogger.request<unknown>({
        method: 'POST',
        url: `${this.baseUrl}/channels/${channelId}/activate`,
        headers: this.buildAuthHeaders(),
        data: {},
      });

      this.logger.log(`[CHANNEX] ✓ Channel activated (action) — channelId=${channelId}`);
    } catch (err) {
      this.normaliseError(err);
    }
  }

  /**
   * Triggers ingestion of historical (future) Airbnb reservations into Channex.
   *
   * POST /api/v1/channels/{channelId}/action/load_future_reservations
   *
   * Calling with an empty body pulls all reservations for the entire channel.
   * Passing `listing_id` scopes the pull to a single Airbnb listing — useful
   * for targeted re-syncs after a mapping correction.
   *
   * Must be called after channel activation (P2-A). If called before activation
   * the Channex side may not yet have the routing context to process the data.
   */
  async loadFutureReservations(channelId: string, listingId?: string): Promise<void> {
    this.logger.log(
      `[CHANNEX] Loading future reservations — channelId=${channelId}${listingId ? ` listingId=${listingId}` : ' (whole channel)'}`,
    );

    const body = listingId ? { listing_id: listingId } : {};

    try {
      await this.defLogger.request<unknown>({
        method: 'POST',
        url: `${this.baseUrl}/channels/${channelId}/action/load_future_reservations`,
        headers: this.buildAuthHeaders(),
        data: body,
      });

      this.logger.log(
        `[CHANNEX] ✓ Future reservations load triggered — channelId=${channelId}`,
      );
    } catch (err) {
      // Non-fatal: log and continue — a failed historical sync does not block
      // the channel from operating. Future bookings will still flow via webhook.
      this.logger.error(
        `[CHANNEX] Failed to load future reservations — channelId=${channelId}: ${(err as Error).message}`,
      );
    }
  }

  // ─── Webhook Subscription API ─────────────────────────────────────────────

  /**
   * Lists all webhook subscriptions registered for a specific Channex property.
   *
   * GET /api/v1/webhooks?filter[property_id]={propertyId}
   *
   * Called by ChannexSyncService.registerPropertyWebhook() as the idempotency
   * preflight check before POST /webhooks. If a subscription with the same
   * callback_url is already registered, the POST is skipped.
   *
   * Returns an empty array (not an error) when no webhooks are registered.
   *
   * @param propertyId  Channex property UUID
   */
  async listPropertyWebhooks(
    propertyId: string,
  ): Promise<ChannexWebhookListResponse['data']> {
    this.logger.log(
      `[CHANNEX] Listing webhooks — propertyId=${propertyId}`,
    );

    try {
      const response = await this.defLogger.request<ChannexWebhookListResponse>({
        method: 'GET',
        url: `${this.baseUrl}/webhooks?filter[property_id]=${encodeURIComponent(propertyId)}`,
        headers: this.buildAuthHeaders(),
      });

      const webhooks = response?.data ?? [];
      this.logger.log(
        `[CHANNEX] ✓ Webhooks listed — propertyId=${propertyId} count=${webhooks.length}`,
      );
      return webhooks;
    } catch (err) {
      this.normaliseError(err);
    }
  }

  /**
   * Registers a per-property webhook subscription with Channex.
   *
   * POST /api/v1/webhooks
   *
   * Returns `{ alreadyExists: false, webhookId }` on HTTP 201 (created).
   * Returns `{ alreadyExists: true }` on HTTP 422 — treated as idempotent
   * (same contract as createChannelMapping). The caller should skip the
   * Firestore write in the alreadyExists case.
   *
   * send_data: true in the payload is critical — enables full booking payload
   * delivery so ChannexBookingWorker can process events without a secondary
   * GET /booking_revisions pull.
   *
   * @param payload  Webhook configuration: property_id, callback_url, events, etc.
   */
  async createWebhookSubscription(
    payload: ChannexWebhookPayload,
  ): Promise<{ webhookId?: string }> {
    this.logger.log(
      `[CHANNEX] Creating webhook subscription — propertyId=${payload.property_id} callbackUrl=${payload.callback_url}`,
    );

    try {
      const response = await this.defLogger.request<ChannexWebhookResponse>({
        method: 'POST',
        url: `${this.baseUrl}/webhooks`,
        headers: this.buildAuthHeaders(),
        data: { webhook: payload },
      });

      const webhookId: string | undefined = response?.data?.id;

      this.logger.log(
        `[CHANNEX] ✓ Webhook subscription created — propertyId=${payload.property_id} webhookId=${webhookId ?? 'unknown'}`,
      );

      return { webhookId };
    } catch (err) {
      const status: number | undefined = (err as any)?.response?.status;
      const responseBody = (err as any)?.response?.data;
      this.logger.error(
        `[CHANNEX] Webhook creation failed (${status ?? 'unknown'}) — propertyId=${payload.property_id}: ${
          responseBody ? JSON.stringify(responseBody) : (err as Error).message
        }`,
      );
      throw err;
    }
  }

  // ─── LiveFeed Resolution API (P3) ─────────────────────────────────────────

  /**
   * Resolves a LiveFeed event (reservation_request or alteration_request).
   *
   * POST /api/v1/live_feed/{liveFeedEventId}/resolve
   * Body: { resolution: { accept: true|false } }
   *
   * Airbnb has a narrow acceptance window for reservation and alteration requests.
   * This method must be called promptly after receiving the webhook — the BullMQ
   * worker calls it with `accept: true` as the default PMS behaviour.
   *
   * For alteration_request, setting `accept: false` rejects the guest's proposed
   * date/guest-count change and the original booking remains in force.
   *
   * @param liveFeedEventId  The ID from `payload.live_feed_id` in the webhook
   * @param accept           true = accept, false = decline
   */
  async resolveLiveFeedEvent(liveFeedEventId: string, accept: boolean): Promise<void> {
    this.logger.log(
      `[CHANNEX] Resolving live_feed event — id=${liveFeedEventId} accept=${accept}`,
    );

    try {
      await this.defLogger.request<unknown>({
        method: 'POST',
        url: `${this.baseUrl}/live_feed/${liveFeedEventId}/resolve`,
        headers: this.buildAuthHeaders(),
        data: { resolution: { accept } },
      });

      this.logger.log(
        `[CHANNEX] ✓ LiveFeed event resolved — id=${liveFeedEventId} accept=${accept}`,
      );
    } catch (err) {
      // Log and re-throw — a failed resolution means the Airbnb request remains
      // pending. The worker retry logic will attempt resolution again.
      this.logger.error(
        `[CHANNEX] Failed to resolve live_feed event id=${liveFeedEventId}: ${(err as Error).message}`,
      );
      this.normaliseError(err);
    }
  }

  // ─── Messaging API ────────────────────────────────────────────────────────

  /**
   * Sends an outbound host reply to a Channex message thread.
   *
   * POST /api/v1/message_threads/{threadId}/messages
   *
   * The Channex Messages App routes the reply to the appropriate OTA (Airbnb)
   * messaging platform. The `sender` field must be 'host' — Channex uses this
   * to determine the delivery direction on the OTA side.
   *
   * Called by ChannexPropertyController after an optimistic Firestore write so
   * the host sees the message immediately regardless of OTA delivery latency.
   *
   * @param threadId   The Channex message_thread_id from the inbound webhook
   * @param propertyId The Channex property UUID (routes the message to the right account)
   * @param text       The reply text entered by the host
   */
  async replyToThread(
    threadId: string,
    propertyId: string,
    text: string,
  ): Promise<ChannexSendMessageResponse> {
    this.logger.log(
      `[CHANNEX] Sending reply — threadId=${threadId} propertyId=${propertyId}`,
    );

    const payload: ChannexSendMessagePayload = {
      message: text,
      sender: 'host',
      property_id: propertyId,
    };

    try {
      const response = await this.defLogger.request<ChannexSendMessageResponse>({
        method: 'POST',
        url: `${this.baseUrl}/message_threads/${threadId}/messages`,
        headers: this.buildAuthHeaders(),
        data: { message: payload },
      });

      this.logger.log(
        `[CHANNEX] ✓ Reply sent — threadId=${threadId} channexMessageId=${response.data?.id ?? '?'}`,
      );

      return response;
    } catch (err) {
      this.logger.error(
        `[CHANNEX] Failed to send reply — threadId=${threadId}: ${(err as Error).message}`,
      );
      this.normaliseError(err);
    }
  }

  // ─── Property Lifecycle ───────────────────────────────────────────────────

  /**
   * Hard-deletes a Channex property.
   *
   * DELETE /api/v1/properties/{propertyId}
   *
   * Used exclusively as the rollback step in the 1:1 isolated provisioning
   * pipeline. If any step in the A→F sequence fails, the newly created property
   * is deleted to avoid orphaned entities accumulating in Channex.
   *
   * WARNING: This is irreversible on the Channex side. The Channex dashboard
   * may also require manual clean-up if the property had OTA OAuth tokens
   * attached to it before the delete.
   *
   * @param propertyId  Channex property UUID to delete
   */
  async deleteProperty(propertyId: string): Promise<void> {
    this.logger.log(`[CHANNEX] Deleting property — propertyId=${propertyId}`);

    try {
      await this.defLogger.request<void>({
        method: 'DELETE',
        url: `${this.baseUrl}/properties/${propertyId}`,
        headers: this.buildAuthHeaders(),
      });

      this.logger.log(`[CHANNEX] ✓ Property deleted — propertyId=${propertyId}`);
    } catch (err) {
      this.normaliseError(err);
    }
  }

  // ─── Application Installation API ────────────────────────────────────────

  /**
   * Installs the Channex Messages App on a specific property.
   *
   * Convenience wrapper over installApplication() using the confirmed UUID.
   * Required to enable inbound guest messaging via the Channex webhook bridge.
   */
  async installMessagesApp(propertyId: string): Promise<void> {
    return this.installApplication(propertyId, ChannexService.APP_IDS.channex_messages);
  }

  /**
   * Installs a Channex Application on a specific property by application UUID.
   *
   * POST /api/v1/applications/install
   * Wrapper key: `application_installation` (confirmed via network trace).
   * Field: `application_id` UUID (not `application_code` string).
   *
   * Known UUIDs are stored in ChannexService.APP_IDS.
   * 422 = app already installed — idempotent.
   *
   * @param propertyId     Channex property UUID
   * @param applicationId  Channex application UUID from APP_IDS
   */
  async installApplication(
    propertyId: string,
    applicationId: string,
  ): Promise<void> {
    this.logger.log(
      `[CHANNEX] Installing application="${applicationId}" — propertyId=${propertyId}`,
    );

    const payload: ChannexInstallApplicationPayload = {
      property_id: propertyId,
      application_id: applicationId,
    };

    try {
      await this.defLogger.request<ChannexInstallApplicationResponse>({
        method: 'POST',
        url: `${this.baseUrl}/applications/install`,
        headers: this.buildAuthHeaders(),
        data: { application_installation: payload },
      });

      this.logger.log(
        `[CHANNEX] ✓ Application installed — id="${applicationId}" propertyId=${propertyId}`,
      );
    } catch (err) {
      const status: number | undefined = (err as any)?.response?.status;
      if (status === 422) {
        this.logger.log(
          `[CHANNEX] Application already installed (422) — id="${applicationId}" propertyId=${propertyId}. Treating as idempotent.`,
        );
        return;
      }
      this.normaliseError(err);
    }
  }

  /**
   * Known Channex application UUIDs.
   * These are stable identifiers assigned by Channex — use instead of application_code.
   */
  static readonly APP_IDS = {
    channex_messages: '8587fbf6-a6d1-46f8-8c12-074273284917',
  } as const;
}

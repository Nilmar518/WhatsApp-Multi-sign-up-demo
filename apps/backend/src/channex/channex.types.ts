// ─── Enums ──────────────────────────────────────────────────────────────────

/**
 * Lifecycle state of a Channex Booking Revision.
 * Maps directly to the `status` field returned by GET /booking_revisions/:id.
 */
export enum BookingRevisionStatus {
  New = 'new',
  Modified = 'modified',
  Cancelled = 'cancelled',
}

/**
 * Connection health of a Channex integration document in Firestore.
 * Drives UI state in the /airbnb frontend (badge color, blocked panels, alerts).
 */
export enum ChannexConnectionStatus {
  Pending = 'pending',
  Active = 'active',
  TokenExpired = 'token_expired',
  Error = 'error',
}

// ─── Channex API — Property ──────────────────────────────────────────────────

/**
 * Attributes sent to POST /api/v1/properties (wrapped under `property` key).
 */
export interface ChannexPropertyPayload {
  title: string;
  currency: string;                   // ISO 4217 (e.g. 'USD', 'PEN')
  timezone: string;                   // IANA tz (e.g. 'America/Lima')
  property_type?: 'apartment' | 'hotel' | string;
  group_id?: string;                  // UUID — groups all properties of one tenant
  settings?: {
    min_stay_type?: 'arrival' | 'both' | 'through';
    // Decrements inventory automatically on booking confirmation —
    // prevents race conditions before the NestJS worker processes the webhook.
    allow_availability_autoupdate_on_confirmation?: boolean;
    // Prevents automatic reopening when OTA sends modification/cancellation events.
    // Set to false to ensure the PMS (our system) remains the source of truth for availability.
    allow_availability_autoupdate_on_modification?: boolean;
    allow_availability_autoupdate_on_cancellation?: boolean;
  };
}

/**
 * The `data` envelope returned by a successful POST /api/v1/properties (HTTP 201).
 */
export interface ChannexPropertyResponse {
  data: {
    id: string;             // UUID — the channex_property_id; used as the pivot for all subsequent calls
    type: 'property';
    attributes: {
      title: string;
      currency: string;
      timezone: string;
      property_type: string;
      group_id: string | null;
      status: string;
    };
  };
}

// ─── Channex API — Group ─────────────────────────────────────────────────────

/** Attributes sent to POST /api/v1/groups (wrapped under `group` key). */
export interface ChannexGroupPayload {
  title: string;
}

/** The `data` envelope returned by a successful POST /api/v1/groups (HTTP 201). */
export interface ChannexGroupResponse {
  data: {
    id: string;
    type: 'group';
    attributes: {
      title: string;
      status: string;
    };
  };
}

/** The `data` array returned by GET /api/v1/groups. */
export interface ChannexGroupListResponse {
  data: Array<{
    id: string;
    type: 'group';
    attributes: {
      title: string;
      status: string;
    };
  }>;
}

// ─── Channex API — Property Update ──────────────────────────────────────────

/**
 * Partial update payload for PUT /api/v1/properties/{propertyId}.
 * Used by ChannexSyncService.enrichPropertyFromAirbnbData() to overwrite
 * placeholder title/currency (set during manual provisioning) with real
 * Airbnb listing values discovered post-OAuth.
 *
 * Timezone is intentionally excluded: it was provided by the admin form as an
 * IANA tz string and cannot be reliably derived from Airbnb listing metadata.
 */
export interface ChannexUpdatePropertyPayload {
  title?: string;    // From first listing's title via getAirbnbListingsAction
  currency?: string; // From listing_currency via getAirbnbListingDetails
}

// ─── Channex API — Webhook Subscriptions ─────────────────────────────────────

/**
 * Channex event codes Migo UIT subscribes to per property.
 * Aligned with the event handlers in ChannexBookingWorker and ChannexMessagingBridgeService.
 */
export type ChannexSubscribedEvent =
  | 'booking_new'
  | 'booking_modification'
  | 'booking_cancellation'
  | 'message_new'
  | 'inquiry_new'
  | 'booking_inquiry';

/**
 * Attributes sent to POST /api/v1/webhooks (nested under `webhook` key).
 *
 * send_data: true — delivers the full booking payload on every ping so the
 * ChannexBookingWorker processes events without a secondary GET /booking_revisions
 * pull. Without this flag, every webhook ping carries only a revision_id,
 * doubling Channex API quota consumption per booking event.
 *
 * headers.x-channex-signature — verbatim HMAC secret validated by ChannexHmacGuard
 * on every inbound POST. Must match CHANNEX_WEBHOOK_SECRET in .env.secrets.
 */
export interface ChannexWebhookPayload {
  property_id: string;
  callback_url: string;
  is_active: boolean;
  send_data: boolean;
  headers: { 'x-channex-signature': string };
  /**
   * Semicolon-separated list of event triggers.
   * The Channex API requires `event_mask` (a string), NOT `events` (an array).
   * Using an array silently fails with 422 from the Channex validation layer.
   */
  event_mask: string;
}

/**
 * The `attributes` shape inside each webhook data envelope from the Channex API.
 */
export interface ChannexWebhookAttributes {
  property_id: string;
  callback_url: string;
  is_active: boolean;
  send_data: boolean;
  events: string[];
  headers: Record<string, string>;
}

/**
 * Response envelope from POST /api/v1/webhooks (HTTP 201).
 * `data.id` is persisted as `channex_webhook_id` in Firestore after registration.
 */
export interface ChannexWebhookResponse {
  data: {
    id: string;
    type: 'webhook';
    attributes: ChannexWebhookAttributes;
  };
}

/**
 * Response envelope from GET /api/v1/webhooks?filter[property_id]={id}.
 * Used as the idempotency preflight before attempting POST /webhooks.
 */
export interface ChannexWebhookListResponse {
  data: Array<{
    id: string;
    type: 'webhook';
    attributes: ChannexWebhookAttributes;
  }>;
}

// ─── Channex API — One-Time Token ────────────────────────────────────────────

/**
 * Response from POST /api/v1/auth/one_time_token.
 * The token is ephemeral: 15-minute TTL, invalidated on first use.
 * Never persist this value — generate a fresh one per IFrame render.
 */
export interface ChannexOneTimeTokenResponse {
  data: {
    token: string;
  };
}

// ─── Channex API — Room Types ────────────────────────────────────────────────

/**
 * Attributes sent to POST /api/v1/room_types.
 *
 * `count_of_rooms` is required by the Channex API (confirmed from official docs).
 * For vacation rentals (Airbnb) this is always 1 — one unique listing per room type.
 */
export interface ChannexRoomTypePayload {
  property_id: string;
  title: string;
  count_of_rooms: number;   // required; 1 for vacation rentals
  default_occupancy: number;
  occ_adults: number;
  occ_children: number;     // required; 0 for standard vacation rental
  occ_infants: number;      // required; 0 for standard vacation rental
}

/**
 * The `data` envelope returned by a successful POST /api/v1/room_types (HTTP 201).
 * Note: `availability` defaults to 0 on creation — the property remains hidden from
 * OTAs until the first ARI push explicitly sets availability > 0.
 */
export interface ChannexRoomTypeResponse {
  data: {
    id: string;             // UUID — room_type_id used in ARI pushes
    type: 'room_type';
    attributes: {
      title: string;
      property_id: string;
      default_occupancy: number;
      occ_adults: number;
      occ_children: number;
      occ_infants: number;
      availability: number; // Always 0 at creation
    };
  };
}

// ─── Channex API — Channels ──────────────────────────────────────────────────

/** A single OTA channel entry returned by GET /api/v1/channels */
export interface ChannexChannelItem {
  id: string;
  type: 'channel';
  attributes: {
    title: string;    // e.g. "Airbnb", "Booking.com"
    channel: string;  // OTA code — "ABB" for Airbnb, "BDC" for Booking.com
    channel_design_id?: string;  // e.g. "booking_com" — alternate BDC identifier from Channex API
    status: string;   // e.g. "active", "not_connected"
    is_active: boolean;
  };
}

export interface ChannexChannelListResponse {
  data: ChannexChannelItem[];
}

// ─── Channex API — Airbnb Listings  (Step 1 of auto-mapping) ─────────────────

/**
 * A single Airbnb listing returned by GET /api/v1/channels/{channelId}/listings.
 *
 * Endpoint history — all prior attempts returned 404 on staging:
 *   /ota_rooms  — does not exist
 *   /mapping    — inconsistent for new channels
 *   /ota_options — does not exist
 *   /listings   — ✓ confirmed in channex-mcp resource layer
 *
 * `listing_id` is the Airbnb-side listing identifier.
 * It is the join key used to correlate listings with the mapping records
 * returned by GET /channels/{channelId}/mappings (Step 2).
 */
export interface ChannexAirbnbListing {
  id: string;
  type: 'listing';
  attributes: {
    listing_id: string;  // Airbnb listing ID — join key for the mapping lookup map
    title: string;       // Listing title — used as the Channex Room Type name
    status: string;
  };
}

export interface ChannexListingsResponse {
  data: ChannexAirbnbListing[];
}

// ─── Channex API — Mapping Records (Step 2 of auto-mapping) ──────────────────

/**
 * A single pre-existing mapping record returned by GET /api/v1/channels/{channelId}/mappings.
 *
 * Channex creates one record per Airbnb listing the moment OAuth completes.
 * These records are EMPTY on creation (room_type_id = null, rate_plan_id = null).
 * The auto-mapping flow fills them in via PUT /channels/{channelId}/mappings/{id}.
 *
 * Key insight: this is an UPDATE flow, not a CREATE flow. Do NOT POST to
 * /mappings — those records already exist and must be patched.
 */
export interface ChannexMappingRecord {
  id: string;             // Channex mapping UUID — used as the path param in PUT step
  type: 'channel_mapping';
  attributes: {
    listing_id: string | null;   // Airbnb listing ID — null before Channex materialises the record
    room_type_id: string | null;
    rate_plan_id: string | null;
    is_mapped: boolean;
  };
}

export interface ChannexMappingRecordsResponse {
  data: ChannexMappingRecord[];
}

// ─── Channex API — Update Mapping Record (Step 5 of auto-mapping) ────────────

/**
 * Body sent to PUT /api/v1/channels/{channelId}/mappings/{mappingId}.
 * Fills in the room_type_id + rate_plan_id and marks the record as mapped.
 */
export interface ChannexUpdateMappingPayload {
  room_type_id: string;
  rate_plan_id: string;
  is_mapped: true;
}

// ─── Channex API — Rate Plans ─────────────────────────────────────────────────

/**
 * A single occupancy-rate option within a Rate Plan.
 *
 * `rate: 0` is intentional for the initial auto-mapping creation.
 * The actual nightly rate is pushed later via POST /restrictions (ARI flow).
 * Channex does not validate a minimum rate value at creation time.
 */
export interface ChannexRatePlanOption {
  occupancy: number;
  is_primary: boolean;
  rate: number;
}

/**
 * Attributes sent to POST /api/v1/rate_plans (confirmed from official docs).
 *
 * The `options` array is required — it defines occupancy/rate combinations.
 * For vacation rentals (Airbnb), one primary option at default_occupancy is sufficient.
 */
export interface ChannexRatePlanPayload {
  property_id: string;
  room_type_id: string;
  title: string;
  currency?: string | null;
  options: ChannexRatePlanOption[];
}

export interface ChannexRatePlanResponse {
  data: {
    id: string;
    type: 'rate_plan';
    attributes: {
      title: string;
      room_type_id: string;
      property_id: string;
    };
  };
}

// ─── Channex API — Booking Revision ─────────────────────────────────────────

/**
 * A single guest within a Booking Room.
 * Availability of `surname` is OTA-gated — Airbnb may omit it until 48h pre-checkin.
 */
export interface GuestDto {
  name: string;
  surname: string | null;
}

/**
 * Tax or fee line item associated with a booking.
 * `is_inclusive` determines whether `total_price` is already embedded in
 * the root `amount` or must be added on top to compute the final guest charge.
 */
export interface TaxDto {
  type: string;             // e.g. 'fee' (cleaning), 'city_tax'
  total_price: number;
  is_inclusive: boolean;
  currency: string;
}

/**
 * A single room (or listing unit) within a booking.
 * Contains the guest PII array — always iterate rooms[0].guests[0] for the lead guest.
 */
export interface BookingRoomDto {
  id: string;
  room_type_id: string;
  guests: GuestDto[];
  taxes: TaxDto[];
  checkin_date: string;     // ISO 8601 date
  checkout_date: string;
}

/**
 * Payment guarantee data attached to the booking.
 * When `payment_collect === 'ota'` (always the case for Airbnb), card data is never
 * transmitted — Airbnb retains funds and disperses net payout via bank transfer.
 * The fields here only appear for Booking.com-style direct-charge flows; in that case,
 * values are masked (last-4 digits only) unless the system is PCI-certified.
 */
export interface GuaranteeDto {
  card_type: string | null;
  expiration_date: string | null;   // MM/YY
  cardholder_name: string | null;
  last_four_digits: string | null;
}

/**
 * Full Booking Revision document returned by GET /api/v1/booking_revisions/:id.
 *
 * This is the "Pull" half of the Push/Pull webhook architecture:
 * - Channex pushes a thin ping (revision_id only, no PII) to POST /channex/webhook
 * - The BullMQ worker then GETs this full document from a secure context
 *
 * Financial processing notes:
 *   net_payout  = amount - ota_commission
 *   final_charge = amount + SUM(taxes where is_inclusive === false)
 *
 * Idempotency key: `ota_reservation_code` — always use as the Firestore document ID
 * for the reservations sub-collection to prevent duplicate records on worker retries.
 */
export interface BookingRevisionDto {
  data: {
    id: string;                         // revision UUID
    type: 'booking_revision';
    attributes: {
      // Core state
      status: BookingRevisionStatus;
      ota_reservation_code: string;     // Airbnb confirmation code — idempotency key

      // Dates
      arrival_date: string;             // ISO 8601 (YYYY-MM-DD)
      departure_date: string;

      // Financial
      amount: number;                   // Gross total (including OTA fees if applicable)
      currency: string;                 // ISO 4217
      ota_commission: number;           // Fee extracted by the OTA (Airbnb/Booking)

      // Payment model — Airbnb always: payment_collect='ota', payment_type='bank_transfer'
      // This means Migo UIT is PCI-out-of-scope for Airbnb bookings.
      payment_collect: 'ota' | 'property';
      payment_type: 'bank_transfer' | 'credit_card' | string;

      // Channex routing fields
      property_id: string;              // channex_property_id — used for tenant lookup
      channel_id: string;

      // Nested collections
      rooms: BookingRoomDto[];
      taxes: TaxDto[];
      guarantee: GuaranteeDto | null;
    };
  };
}

// ─── Channex API — ARI (Availability, Rates & Inventory) ────────────────────

/**
 * Per-date data returned inside GET /api/v1/restrictions.
 * Keyed as: data[ratePlanId][YYYY-MM-DD]
 */
export interface ChannexRestrictionsDayData {
  availability: number;
  availability_offset: number;
  closed_to_arrival: boolean;
  closed_to_departure: boolean;
  max_availability: number | null;
  max_stay: number;
  min_stay_arrival: number;
  min_stay_through: number;
  rate: string;
  stop_sell: boolean;
  stop_sell_manual: boolean;
  unavailable_reasons: string[];
}

/**
 * Response shape for GET /api/v1/restrictions.
 * Params: filter[date][gte], filter[date][lte], filter[property_id], filter[restrictions]
 * Shape:  data[ratePlanId][YYYY-MM-DD] = ChannexRestrictionsDayData
 */
export interface ChannexRestrictionsReadResponse {
  data: Record<string, Record<string, ChannexRestrictionsDayData>>;
}

/**
 * Response shape for GET /api/v1/availability.
 * Params: filter[date][gte], filter[date][lte], filter[property_id]
 * Shape:  data[roomTypeId][YYYY-MM-DD] = availabilityCount (integer)
 */
export interface ChannexAvailabilityReadResponse {
  data: Record<string, Record<string, number>>;
}

/**
 * A single entry in the `values` array sent to POST /api/v1/availability.
 *
 * For vacation rentals (Airbnb model), availability is typically 0 or 1 (binary).
 * For multi-unit properties (Booking.com, certification tests), use the actual
 * unit count (e.g. 7). Use `date_from`/`date_to` range format to update broad
 * date windows in a single API call, reducing payload weight and API call count.
 */
export interface AvailabilityEntryDto {
  property_id: string;
  room_type_id: string;
  date_from: string;       // ISO 8601 (YYYY-MM-DD)
  date_to: string;
  availability: number;    // non-negative integer; 0 = no units, 1+ = available
}

/**
 * A single entry in the `values` array sent to POST /api/v1/restrictions.
 *
 * Key: `rate_plan_id` (not room_type_id) — restrictions operate on Rate Plans.
 *
 * Airbnb ARI notes:
 *   - Always use `min_stay_arrival` (Airbnb evaluates stay restrictions on the
 *     arrival day). Ignore `min_stay_through` to prevent sync discrepancies.
 *   - `rate` is accepted as a decimal string ("150.00") or as the minor currency
 *     unit integer (15000 for $150.00 USD). Prefer the string form for readability.
 *
 * Last-write-wins (FIFO): conflicting updates for the same date will be resolved
 * by Channex in arrival order — this is intentional; use it for batch consolidation.
 */
export interface RestrictionEntryDto {
  property_id: string;
  rate_plan_id: string;
  date_from: string;        // ISO 8601
  date_to: string;
  rate?: string;            // e.g. "150.00"
  min_stay_arrival?: number;
  max_stay?: number | null;
  stop_sell?: boolean;
  closed_to_arrival?: boolean;   // CTA — blocks check-in on this date
  closed_to_departure?: boolean; // CTD — blocks check-out on this date
}

/**
 * Success envelope for ARI push endpoints.
 * Both POST /api/v1/availability and POST /api/v1/restrictions return this shape.
 * `data[0].id` is the Channex task ID — used for certification form answers.
 */
export interface ChannexARIResponse {
  data: Array<{ id: string; type: string }>;
  meta: {
    message: string;
    warnings?: string[];
  };
}

// ─── ARI Full Sync ────────────────────────────────────────────────────────────

export interface FullSyncOptions {
  defaultAvailability: number;  // units to set on all room types
  defaultRate: string;          // base rate for all rate plans, e.g. "100.00"
  defaultMinStayArrival: number; // minimum nights required per stay (1 = open)
  defaultMaxStay: number;       // max nights allowed per stay (required — Channex rejects null)
  defaultStopSell: boolean;     // block all new bookings
  defaultClosedToArrival: boolean;  // block check-in on every date
  defaultClosedToDeparture: boolean; // block check-out on every date
  days?: number;                // days forward from today; default 500
}

export interface FullSyncResult {
  availabilityTaskId: string;
  restrictionsTaskId: string;
}

// ─── Channex API — Webhook Payload ──────────────────────────────────────────

export type ChannexWebhookEvent =
  | 'booking'
  | 'booking_new'
  | 'booking_modification'
  | 'booking_cancellation'
  | 'booking_unmapped_room'
  | 'non_acked_booking'
  | 'reservation_request'    // Airbnb: new booking request pending host approval
  | 'alteration_request'     // Airbnb: guest-initiated date / guest-count change request
  | 'inquiry'               // Airbnb pre-booking inquiry thread event
  | 'message';               // Airbnb guest ↔ host message via Channex Messages App

/**
 * Full webhook payload pushed by Channex when `send_data=true` is configured
 * on the global webhook (our chosen architecture).
 *
 * With send_data=true the complete booking revision attributes are embedded
 * directly in the push — eliminating the need for a Pull call to
 * GET /booking_revisions/:id and reducing Channex API quota consumption.
 *
 * Flow:
 *   POST /channex/webhook (receives this) → validate HMAC signature →
 *   return 200 OK immediately → enqueue entire payload into BullMQ →
 *   worker processes data directly from queue (no secondary HTTP call).
 *
 * HMAC validation: X-Channex-Signature header, secret = CHANNEX_WEBHOOK_SECRET
 * in .env.secrets. See ChannexWebhookController (Phase 4) for implementation.
 */
export interface ChannexWebhookFullPayload {
  event: ChannexWebhookEvent;

  /**
   * The Channex Property UUID — pivot for tenant lookup in Firestore.
   * Query `channex_integrations` where `channex_property_id == property_id`
   * to resolve tenant_id in O(log n).
   */
  property_id: string;

  /** UUID of this specific booking revision. Used as correlation ID in logs. */
  revision_id: string;

  /** UUID of the OTA channel that originated the booking (Airbnb = ABB). */
  channel_id?: string;

  /**
   * Present on `reservation_request` and `alteration_request` events.
   * This is the ID passed to POST /api/v1/live_feed/{live_feed_id}/resolve.
   * Airbnb has a narrow acceptance window — the worker must call resolve promptly.
   */
  live_feed_id?: string;

  /**
   * Event payload object sent by Channex.
   *
   * For `message`/`inquiry` events this is `ChannexInboundMessagePayload`.
   * For booking lifecycle events Channex may also send booking details directly
   * in this root `payload` object.
   */
  payload?: ChannexInboundMessagePayload | Record<string, unknown>;

  /**
   * Full booking revision data (present for all booking_* events when send_data=true).
   * Absent for non_acked_booking events (those are meta-signals, not booking data).
   *
   * The `ota_reservation_code` field must be used as the Firestore document ID
   * for the reservations sub-collection — it is the idempotency key that prevents
   * duplicate records when the worker retries a failed job.
   */
  booking?: {
    id: string;                          // revision UUID (same as revision_id)
    status: BookingRevisionStatus;
    ota_reservation_code: string;        // Airbnb confirmation code — idempotency key
    arrival_date: string;                // ISO 8601 (YYYY-MM-DD)
    departure_date: string;
    amount: number | string;             // Gross total (can arrive as string in push webhook)
    currency: string;                    // ISO 4217
    ota_commission: number;
    // Airbnb always: payment_collect='ota', payment_type='bank_transfer'
    // → Migo UIT is PCI-out-of-scope for Airbnb bookings
    payment_collect: 'ota' | 'property';
    payment_type: 'bank_transfer' | 'credit_card' | string;
    rooms: BookingRoomDto[];
    taxes: TaxDto[];
    guarantee: GuaranteeDto | null;
  };
}

// ─── Channex API — Airbnb Action: Listings ───────────────────────────────────

/**
 * A single entry from the `listing_id_dictionary.values` array returned by
 * GET /api/v1/channels/{channelId}/action/listings.
 *
 * This is the P0 discovery endpoint — it returns the canonical Airbnb listing
 * IDs and titles without requiring any prior state on the Channex side.
 */
export interface AirbnbActionListingEntry {
  id: string;      // Airbnb listing ID — used as settings.listing_id in mapping POST
  title: string;   // Listing title — used as the Channex Room Type name
}

export interface AirbnbActionListingsResponse {
  data: {
    listing_id_dictionary: {
      values: AirbnbActionListingEntry[];
    };
  };
}

// ─── Channex API — Airbnb Action: Listing Details ────────────────────────────

export interface AirbnbListingImage {
  url: string;
  caption?: string | null;
}

export interface AirbnbListingPricingSettings {
  default_daily_price: number | string | null;
  listing_currency: string | null;
}

/**
 * Metadata returned by GET /api/v1/channels/{channelId}/action/listing_details.
 * Used to seed the Channex Room Type occupancy and Rate Plan price/currency
 * with values sourced directly from the Airbnb listing — zero guessing.
 */
export interface AirbnbListingDetails {
  person_capacity: number;
  pricing_settings: AirbnbListingPricingSettings;
  images: AirbnbListingImage[];
}

export interface AirbnbListingDetailsResponse {
  data: AirbnbListingDetails;
}

// ─── Channex API — Airbnb Action: Listing Calendar ──────────────────────────

export interface AirbnbListingCalendarDay {
  date: string;
  availability: string | null;
  daily_price: number | string | null;
  stop_sell?: boolean | null;
  min_stay_arrival?: number | null;
}

export interface AirbnbListingCalendarResponse {
  data?: {
    calendar?: {
      days?: AirbnbListingCalendarDay[];
    };
  };
}

// ─── Channex API — Create Mapping (POST) ─────────────────────────────────────

/**
 * Body sent to POST /api/v1/channels/{channelId}/mappings.
 *
 * IMPORTANT: This is a CREATE operation, not an update of a pre-existing record.
 * The `rate_plan_id` links to a Channex Rate Plan (which already knows its Room Type).
 * `settings.listing_id` is the Airbnb listing ID to bind — this is what Channex
 * uses to route inbound bookings from that listing to the correct Room Type.
 *
 * Idempotency: a 422 response means the mapping already exists for this listing.
 * Log as "already mapped" and continue — do not abort the pipeline.
 */
export interface ChannexCreateMappingPayload {
  room_type_id?: string;  // BDC tier-1: map the room type first
  rate_plan_id?: string;  // BDC tier-2 / Airbnb: map the rate plan
  settings: {
    listing_id?: string;  // Airbnb: OTA listing ID
    room_id?: string;     // Booking.com: OTA room type ID (cast to string)
    rate_id?: string;     // Booking.com: OTA rate plan ID (cast to string)
  };
}

// ─── Channex API — Messaging ─────────────────────────────────────────────────

/**
 * Payload sent to POST /api/v1/message_threads/{threadId}/messages.
 * Wrapped under the `message` key as required by Channex.
 */
export interface ChannexSendMessagePayload {
  message: string;    // The text body of the reply
  sender: 'host';     // Always 'host' for outbound messages from Migo UIT
  property_id: string;
}

/**
 * Response envelope from POST /api/v1/message_threads/{threadId}/messages.
 * `data.id` is the Channex-side message UUID; useful for correlation logging.
 */
export interface ChannexSendMessageResponse {
  data: {
    id: string;
    type: 'message';
    attributes: {
      message: string;
      sender: string;
      property_id: string;
      created_at: string;
    };
  };
}

// ─── Channex API — Generic Error Shape ──────────────────────────────────────

/**
 * Channex API error response body (HTTP 4xx/5xx).
 * Used in ChannexService to distinguish 429 rate-limit errors from auth errors.
 */
export interface ChannexErrorResponse {
  error_code?: 'http_too_many_requests' | 'unauthorized' | 'forbidden' | string;
  message?: string;
}

// ─── Channex Messages App — Inbound Message Payload ─────────────────────────

/**
 * Nested `payload` object inside a Channex `message` webhook event.
 *
 * Confirmed from live payload inspection: the Channex Messages App wraps all
 * message-specific fields under a `payload` key on the webhook root:
 *
 *   {
 *     event: 'message',
 *     property_id: '...',   ← root envelope (used for tenant routing)
 *     payload: {            ← this interface
 *       property_id: '...',
 *       message_thread_id: '...',
 *       ota_message_id: '...',
 *       message: '...',
 *       sender: 'guest',
 *       booking_id: null,
 *       meta: { name: '...' },
 *       timestamp: '...'
 *     }
 *   }
 *
 * Pre-booking inquiries arrive with `booking_id: null` but always carry a
 * distinct `message_thread_id` and `meta` block with guest information.
 */
export interface ChannexInboundMessagePayload {
  property_id?: string;            // Redundant with the root envelope field
  message_thread_id: string;       // Thread identifier — Firestore document ID for the thread
  message: string;                 // The message text body
  id?: string;                     // Canonical message id in some webhook payloads
  ota_message_id: string;          // OTA-side message UUID — idempotency key for the message doc
  sender: string;                  // Role string, e.g. 'guest' | 'host'
  booking_id: string | null;       // Null for pre-booking inquiries
  timestamp?: string;              // ISO 8601 — may be absent; fall back to server timestamp
  meta?: {
    name?: string;                 // Guest display name
    role?: string;                 // Redundant with `sender` but present on some OTAs
    [key: string]: unknown;
  };
}

// ─── Channex API — Application Installation ──────────────────────────────────

/**
 * Body sent to POST /api/v1/applications/install.
 * Wrapped under the `application_installation` key (intercepted from Channex UI).
 *
 * `application_id` is the Channex-internal UUID of the application to install.
 * Known IDs are kept as constants in ChannexService.APP_IDS.
 */
export interface ChannexInstallApplicationPayload {
  property_id: string;
  application_id: string;
}

/**
 * Response envelope from POST /api/v1/applications/install.
 * `data.id` is the installation UUID — useful for correlation logging.
 * A 422 response means the app is already installed; treat as idempotent.
 */
export interface ChannexInstallApplicationResponse {
  data: {
    id: string;
    type: 'application_installation';
    attributes: {
      property_id: string;
      application_code: string;
      status: string;
    };
  };
}

// ─── SSE — Internal event bus constants & payload types ─────────────────────

/**
 * Internal EventEmitter2 channel names used by ChannexEventsController to
 * stream Channex integration events to the frontend over Server-Sent Events.
 *
 * Naming convention: `channex.<domain>_<action>` — mirrors the Channex webhook
 * event names where applicable to reduce cognitive mapping overhead.
 *
 * Producers:
 *   - ChannexPropertyService.updateConnectionStatus → CONNECTION_STATUS_CHANGE
 *   - ChannexBookingWorker.process                 → BOOKING_NEW
 *   - ChannexBookingWorker.process                 → BOOKING_UNMAPPED_ROOM
 */
export const CHANNEX_EVENTS = {
  CONNECTION_STATUS_CHANGE: 'channex.connection_status_change',
  BOOKING_NEW: 'channex.booking_new',
  BOOKING_UNMAPPED_ROOM: 'channex.booking_unmapped_room',
  MESSAGE_RECEIVED: 'channex.message_received',
} as const;

/** Base fields present on every SSE event payload. */
export interface ChannexBaseEvent {
  tenantId: string;
  propertyId: string;
  timestamp: string;
}

/** Emitted when `connection_status` changes in Firestore (Phase 6+). */
export interface ChannexStatusChangeEvent extends ChannexBaseEvent {
  status: ChannexConnectionStatus;
}

/** Emitted when a booking_new webhook is successfully persisted (Phase 6+). */
export interface ChannexBookingNewEvent extends ChannexBaseEvent {
  revisionId: string;
  otaReservationCode: string;
}

/**
 * Emitted when a booking_unmapped_room webhook is received (Phase 6+).
 * Triggers the frontend UnmappedRoomModal — a blocking alert that forces
 * the admin to re-map the Airbnb listing via the Channel IFrame.
 */
export interface ChannexUnmappedRoomEvent extends ChannexBaseEvent {
  revisionId: string;
}

// ─── MigoProperty Pool — SSE Events ──────────────────────────────────────────

export const MIGO_PROPERTY_EVENTS = {
  AVAILABILITY_ALERT: 'migo_property.availability_alert',
} as const;

/**
 * Emitted when `current_availability` drops to or below `alert_threshold`.
 * Forwarded to the frontend via the existing /channex/events/:tenantId SSE stream.
 * The frontend uses this to show an alert prompting the admin to close dates.
 */
export interface MigoPropertyAvailabilityAlertEvent {
  tenantId: string;
  migoPropertyId: string;
  title: string;
  current_availability: number;
  timestamp: string;
}

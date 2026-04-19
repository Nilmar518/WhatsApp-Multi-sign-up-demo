// All requests go through the Vite proxy: /api/* → http://localhost:3001/*
// The proxy strips the /api prefix, so /api/channex/... → /channex/... on the backend.
const BASE = '/api/channex';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProvisionPropertyPayload {
  tenantId: string;
  migoPropertyId: string;
  title: string;
  currency: string;    // ISO 4217 (e.g. 'USD', 'PEN')
  timezone: string;    // IANA tz (e.g. 'America/Lima')
  propertyType?: string;
  groupId?: string;
}

export interface ProvisionPropertyResult {
  channexPropertyId: string;
  firestoreDocId: string;
}

export type ChannexConnectionStatus =
  | 'pending'
  | 'active'
  | 'token_expired'
  | 'error';

export interface ConnectionStatusResult {
  channexPropertyId: string;
  connectionStatus: ChannexConnectionStatus;
  oauthRefreshRequired: boolean;
  lastSyncTimestamp: string | null;
  title: string;
}

export interface ListingCalendarDay {
  date: string;
  availability: string | null;
  daily_price: number | string | null;
  stop_sell?: boolean | null;
  min_stay_arrival?: number | null;
}

export interface ListingCalendarResult {
  days: ListingCalendarDay[];
}

export interface ARIAvailabilityPayload {
  room_type_id: string;
  date_from: string;
  date_to: string;
  availability: 0 | 1;
}

export interface ARIRestrictionPayload {
  rate_plan_id: string;
  date_from: string;
  date_to: string;
  rate?: string;
  min_stay_arrival?: number;
  stop_sell?: boolean;
}

// ─── Shared fetch helper ──────────────────────────────────────────────────────

/**
 * Thin fetch wrapper — mirrors the pattern in catalogManagerApi.ts.
 * Handles 204 No Content, JSON parse errors, and NestJS error body shapes
 * ({ message: string | string[], statusCode: number }).
 */
async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (res.status === 204) return undefined as unknown as T;

  const body = await res
    .json()
    .catch(() => ({})) as { message?: string | string[]; statusCode?: number };

  if (!res.ok) {
    throw new Error(
      Array.isArray(body.message)
        ? body.message.join('; ')
        : (body.message ?? `HTTP ${res.status}`),
    );
  }

  return body as T;
}

// ─── Property provisioning ────────────────────────────────────────────────────

/**
 * POST /api/channex/properties
 * Step 1 of the onboarding wizard — creates the Channex property and writes
 * the dual-ID mapping to Firestore `channex_integrations`.
 */
export async function provisionProperty(
  payload: ProvisionPropertyPayload,
): Promise<ProvisionPropertyResult> {
  return apiFetch(`${BASE}/properties`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ─── Connection status ────────────────────────────────────────────────────────

/**
 * GET /api/channex/properties/:propertyId/status
 * Returns current Firestore connection state. Polled by ConnectionStatusBadge
 * every 30 seconds to drive the status chip and re-connect CTA.
 */
export async function getConnectionStatus(
  propertyId: string,
): Promise<ConnectionStatusResult> {
  return apiFetch(`${BASE}/properties/${encodeURIComponent(propertyId)}/status`);
}

export async function getListingCalendar(
  propertyId: string,
  channelId: string,
  listingId: string,
  dateFrom: string,
  dateTo: string,
): Promise<ListingCalendarResult> {
  const search = new URLSearchParams({
    date_from: dateFrom,
    date_to: dateTo,
  });

  const days = await apiFetch<ListingCalendarDay[]>(
    `${BASE}/properties/${encodeURIComponent(propertyId)}` +
      `/channels/${encodeURIComponent(channelId)}` +
      `/listings/${encodeURIComponent(listingId)}/calendar?${search.toString()}`,
  );

  return { days };
}

// ─── OAuth / IFrame ───────────────────────────────────────────────────────────

/**
 * GET /api/channex/properties/:propertyId/one-time-token
 * Issues a single-use, 15-minute session token for embedding the Channex IFrame.
 * Called by ChannexIFrame on mount (and on retry after error).
 * A new call is required for each IFrame render — tokens are invalidated on use.
 */
export async function getOneTimeToken(
  propertyId: string,
): Promise<string> {
  const res = await apiFetch<{ token: string }>(
    `${BASE}/properties/${encodeURIComponent(propertyId)}/one-time-token`,
  );
  return res.token;
}

/**
 * GET /api/channex/properties/:propertyId/copy-link
 * Fallback for strict CSP environments that block third-party IFrames.
 * Returns a direct Airbnb OAuth URL the user can open in a new tab.
 */
export async function getCopyLink(propertyId: string): Promise<string> {
  const res = await apiFetch<{ url: string }>(
    `${BASE}/properties/${encodeURIComponent(propertyId)}/copy-link`,
  );
  return res.url;
}

// ─── ARI push ────────────────────────────────────────────────────────────────

/**
 * POST /api/channex/properties/:propertyId/availability
 *
 * Pushes an availability update synchronously to Channex.
 * Awaits Channex confirmation before resolving — hold a loading state in the UI
 * for the ~1-2 s duration of this call.
 */
export async function pushAvailability(
  propertyId: string,
  payload: ARIAvailabilityPayload,
): Promise<{ status: 'ok' }> {
  return apiFetch(`${BASE}/properties/${encodeURIComponent(propertyId)}/availability`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * POST /api/channex/properties/:propertyId/restrictions
 *
 * Pushes a rate/restriction update synchronously to Channex.
 * Same synchronous contract as pushAvailability — show a loading state.
 */
export async function pushRestrictions(
  propertyId: string,
  payload: ARIRestrictionPayload,
): Promise<{ status: 'ok' }> {
  return apiFetch(`${BASE}/properties/${encodeURIComponent(propertyId)}/restrictions`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ─── Soft delete ──────────────────────────────────────────────────────────────

/**
 * DELETE /api/channex/properties/:propertyId
 * Soft-deletes the integration (sets connection_status='error' in Firestore).
 * Does not call the Channex DELETE endpoint — irreversible on the OTA side.
 */
export async function deleteProperty(propertyId: string): Promise<void> {
  return apiFetch(
    `${BASE}/properties/${encodeURIComponent(propertyId)}`,
    { method: 'DELETE' },
  );
}

// ─── Auto-Mapping (Phase 9) ───────────────────────────────────────────────────

export interface SyncedRoomType {
  id: string;
  title: string;
  ratePlanId: string;
  otaRoomId: string;
}

export interface AutoSyncResult {
  channelId: string;
  roomTypesSynced: number;
  roomTypes: SyncedRoomType[];
}

/**
 * POST /api/channex/properties/:propertyId/sync
 *
 * Triggers Phase 9 auto-mapping on the backend:
 *   1. Resolves the Airbnb channel for the property.
 *   2. Fetches OTA listings — throws if Airbnb OAuth is not yet complete.
 *   3. Creates Room Type → Rate Plan → Channel Mapping for each listing.
 *   4. Updates Firestore: connection_status='active', room_types persisted.
 *
 * @throws Error with a user-friendly message if OAuth was not completed first.
 */
export async function syncProperty(
  propertyId: string,
  tenantId: string,
): Promise<AutoSyncResult> {
  return apiFetch(`${BASE}/properties/${encodeURIComponent(propertyId)}/sync`, {
    method: 'POST',
    body: JSON.stringify({ tenantId }),
  });
}

// ─── Stage & Review pipeline ──────────────────────────────────────────────────

export interface StagedAirbnbListing {
  airbnbId: string;
  title: string;
  basePrice: number;
  currency: string | null;
  capacity: number;
}

export interface StagedChannexEntity {
  roomTypeId: string;
  ratePlanId: string;
  title: string;
}

export interface StagedMappingRow {
  airbnb: StagedAirbnbListing;
  channex: StagedChannexEntity;
}

export interface StageSyncResult {
  channelId: string;
  propertyId: string;
  staged: StagedMappingRow[];
}

export interface CommitMappingInput {
  ratePlanId: string;
  otaListingId: string;
}

export interface CommitMappingResult {
  channelId: string;
  mapped: number;
  alreadyMapped: number;
}

/**
 * POST /api/channex/properties/:propertyId/sync_stage
 *
 * Phase 1 — discovers Airbnb listings, creates Channex Room Types + Rate Plans
 * (idempotent), but does NOT inject mappings or activate the channel.
 * Returns staged rows for the MappingReviewModal.
 */
export async function syncStage(
  propertyId: string,
  tenantId: string,
): Promise<StageSyncResult> {
  return apiFetch(`${BASE}/properties/${encodeURIComponent(propertyId)}/sync_stage`, {
    method: 'POST',
    body: JSON.stringify({ tenantId }),
  });
}

/**
 * POST /api/channex/properties/:propertyId/commit_mapping
 *
 * Phase 3 — commits user-confirmed mappings, activates the Airbnb channel,
 * pulls historical reservations, and sets connection_status='active' in Firestore.
 */
export async function commitMapping(
  propertyId: string,
  channelId: string,
  mappings: CommitMappingInput[],
): Promise<CommitMappingResult> {
  return apiFetch(`${BASE}/properties/${encodeURIComponent(propertyId)}/commit_mapping`, {
    method: 'POST',
    body: JSON.stringify({ channelId, mappings }),
  });
}

// ─── Messaging bridge ────────────────────────────────────────────────────────

export async function linkGuestPhone(
  reservationCode: string,
  phone: string,
  tenantId?: string,
): Promise<void> {
  const resolvedTenantId =
    tenantId ?? new URLSearchParams(window.location.search).get('tenantId') ?? 'demo-business-001';

  await apiFetch(
    `${BASE}/guests/${encodeURIComponent(reservationCode)}/phone`,
    {
      method: 'POST',
      body: JSON.stringify({
        tenantId: resolvedTenantId,
        reservationCode,
        phone,
      }),
    },
  );
}

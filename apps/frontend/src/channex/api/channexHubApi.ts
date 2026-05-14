const BASE = '/api/channex';

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface StoredRatePlan {
  rate_plan_id: string;
  title: string;
  currency: string;
  rate: number;
  occupancy: number;
  is_primary?: boolean;
}

export interface StoredRoomType {
  room_type_id: string;
  title: string;
  default_occupancy: number;
  occ_adults: number;
  occ_children: number;
  occ_infants: number;
  count_of_rooms: number;
  source?: string;
  rate_plans: StoredRatePlan[];
}

export interface ARIAvailabilityUpdate {
  room_type_id: string;
  date_from: string;
  date_to: string;
  availability: number;
}

export interface ARIRestrictionUpdate {
  rate_plan_id: string;
  date_from: string;
  date_to: string;
  rate?: string;
  min_stay_arrival?: number;
  max_stay?: number | null;
  stop_sell?: boolean;
  closed_to_arrival?: boolean;
  closed_to_departure?: boolean;
}

// ─── Shared fetch helper ──────────────────────────────────────────────────────

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  const body = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
  if (!res.ok) {
    const msg = Array.isArray(body?.message) ? body.message.join('; ') : (body?.message ?? `HTTP ${res.status}`);
    throw new Error(msg);
  }
  return body as T;
}

// ─── Property ─────────────────────────────────────────────────────────────────

export interface ProvisionPropertyPayload {
  tenantId: string;
  migoPropertyId: string;
  title: string;
  currency: string;
  timezone: string;
  propertyType?: string;
}

export interface ProvisionPropertyResult {
  channexPropertyId: string;
  firestoreDocId: string;
}

export async function provisionProperty(
  payload: ProvisionPropertyPayload,
): Promise<ProvisionPropertyResult> {
  return apiFetch(`${BASE}/properties`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ─── Room Types ───────────────────────────────────────────────────────────────

export interface CreateRoomTypePayload {
  title: string;
  countOfRooms?: number;
  defaultOccupancy: number;
  occAdults: number;
  occChildren?: number;
  occInfants?: number;
}

export interface UpdateRoomTypePayload {
  title?: string;
  countOfRooms?: number;
  defaultOccupancy?: number;
  occAdults?: number;
  occChildren?: number;
  occInfants?: number;
}

export async function createRoomType(
  propertyId: string,
  payload: CreateRoomTypePayload,
): Promise<{ id: string }> {
  const res = await apiFetch<{ data: { id: string } }>(
    `${BASE}/properties/${encodeURIComponent(propertyId)}/room-types`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
  return { id: res.data.id };
}

export async function updateRoomType(
  propertyId: string,
  roomTypeId: string,
  payload: UpdateRoomTypePayload,
): Promise<void> {
  await apiFetch(
    `${BASE}/properties/${encodeURIComponent(propertyId)}/room-types/${encodeURIComponent(roomTypeId)}`,
    { method: 'PUT', body: JSON.stringify(payload) },
  );
}

export async function listRoomTypes(propertyId: string): Promise<StoredRoomType[]> {
  return apiFetch(`${BASE}/properties/${encodeURIComponent(propertyId)}/room-types`);
}

// ─── Rate Plans ───────────────────────────────────────────────────────────────

export interface CreateRatePlanPayload {
  title: string;
  currency?: string;
  rate?: number;
  occupancy?: number;
}

export async function createRatePlan(
  propertyId: string,
  roomTypeId: string,
  payload: CreateRatePlanPayload,
): Promise<{ id: string }> {
  const res = await apiFetch<{ data: { id: string } }>(
    `${BASE}/properties/${encodeURIComponent(propertyId)}/room-types/${encodeURIComponent(roomTypeId)}/rate-plans`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
  return { id: res.data.id };
}

// ─── ARI — Availability ───────────────────────────────────────────────────────

export async function pushAvailabilityBatch(
  propertyId: string,
  updates: ARIAvailabilityUpdate[],
): Promise<{ status: 'ok'; taskId: string }> {
  return apiFetch(`${BASE}/properties/${encodeURIComponent(propertyId)}/availability`, {
    method: 'POST',
    body: JSON.stringify({ updates }),
  });
}

// ─── ARI — Restrictions & Rates ──────────────────────────────────────────────

export async function pushRestrictionsBatch(
  propertyId: string,
  updates: ARIRestrictionUpdate[],
): Promise<{ status: 'ok'; taskId: string }> {
  return apiFetch(`${BASE}/properties/${encodeURIComponent(propertyId)}/restrictions`, {
    method: 'POST',
    body: JSON.stringify({ updates }),
  });
}

// ─── ARI — Full Sync ──────────────────────────────────────────────────────────

export interface FullSyncResult {
  availabilityTaskId: string;
  restrictionsTaskId: string;
}

export async function triggerFullSync(
  propertyId: string,
  options: {
    defaultAvailability: number;
    defaultRate: string;
    defaultMinStayArrival: number;
    defaultMaxStay: number;
    defaultStopSell: boolean;
    defaultClosedToArrival: boolean;
    defaultClosedToDeparture: boolean;
    days?: number;
  },
): Promise<FullSyncResult> {
  return apiFetch(`${BASE}/properties/${encodeURIComponent(propertyId)}/full-sync`, {
    method: 'POST',
    body: JSON.stringify(options),
  });
}

// ─── ARI — Snapshot (Firestore cache) ────────────────────────────────────────

/** Availability for one room type on a given day. */
export interface DayRoomTypeSnapshot {
  availability: number;
}

/** Rate and restrictions for one rate plan on a given day. */
export interface DayRatePlanSnapshot {
  rate: string | null;
  stopSell: boolean;
  closedToArrival: boolean;
  closedToDeparture: boolean;
  minStayArrival: number | null;
  maxStay: number | null;
}

/**
 * One calendar day.
 * roomTypes — keyed by Channex room_type_id
 * ratePlans — keyed by Channex rate_plan_id
 */
export interface DaySnapshot {
  roomTypes?: Record<string, DayRoomTypeSnapshot>;
  ratePlans?: Record<string, DayRatePlanSnapshot>;
}

/** Keys are ISO dates (YYYY-MM-DD). */
export type ARIMonthSnapshot = Record<string, DaySnapshot>;

export async function getARISnapshot(
  propertyId: string,
  tenantId: string,
  month: string, // YYYY-MM
): Promise<ARIMonthSnapshot> {
  const params = new URLSearchParams({ tenantId, month });
  return apiFetch(
    `${BASE}/properties/${encodeURIComponent(propertyId)}/ari-snapshot?${params}`,
  );
}

export async function refreshARISnapshot(
  propertyId: string,
  tenantId: string,
  month: string, // YYYY-MM
): Promise<{ status: 'ok' }> {
  const params = new URLSearchParams({ tenantId, month });
  return apiFetch(
    `${BASE}/properties/${encodeURIComponent(propertyId)}/ari-refresh?${params}`,
    { method: 'POST' },
  );
}

// ─── Reservations ─────────────────────────────────────────────────────────────

export interface Reservation {
  id?: string;
  reservation_id: string | null;
  pms_booking_id?: string;
  channex_booking_id: string | null;
  booking_status: string;
  /** OTA source — 'airbnb' | 'booking_com' | … */
  channel: string;
  channex_property_id: string;
  room_type_id: string | null;
  ota_listing_id?: string | null;
  check_in: string;
  check_out: string;
  gross_amount: number;
  currency: string;
  ota_fee: number;
  net_payout: number;
  additional_taxes: number;
  payment_collect: string;
  payment_type: string;
  guest_first_name: string | null;
  guest_last_name: string | null;
  whatsapp_number: null;
  created_at: string;
  updated_at: string;
  count_of_nights?: number | null;
  customer_name?: string | null;
}

export async function getPropertyBookings(
  propertyId: string,
  tenantId: string,
  limit = 50,
): Promise<Reservation[]> {
  const params = new URLSearchParams({ tenantId, limit: String(limit) });
  return apiFetch(
    `${BASE}/properties/${encodeURIComponent(propertyId)}/bookings?${params}`,
  );
}

export async function pullPropertyBookings(
  propertyId: string,
  tenantId: string,
  limit = 50,
): Promise<{ synced: number }> {
  const params = new URLSearchParams({ tenantId, limit: String(limit) });
  return apiFetch(
    `${BASE}/properties/${encodeURIComponent(propertyId)}/bookings/pull?${params}`,
    { method: 'POST' },
  );
}

// ─── Manual Bookings ──────────────────────────────────────────────────────────

export interface CreateManualBookingPayload {
  tenantId: string;
  roomTypeId: string;
  ratePlanId?: string | null;
  checkIn: string;
  checkOut: string;
  bookingType: 'walkin' | 'maintenance' | 'owner_stay' | 'direct';
  countOfRooms?: number;     // units booked; defaults to 1
  guestName?: string;
  guestPhone?: string;
  notes?: string;
  grossAmount?: number;      // unit price per room
  currency?: string;
}

export async function createManualBooking(
  propertyId: string,
  body: CreateManualBookingPayload,
): Promise<Reservation> {
  return apiFetch(
    `${BASE}/properties/${encodeURIComponent(propertyId)}/bookings/manual`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

export async function cancelManualBooking(
  propertyId: string,
  pmsBookingId: string,
  tenantId: string,
): Promise<Reservation> {
  const params = new URLSearchParams({ tenantId });
  return apiFetch(
    `${BASE}/properties/${encodeURIComponent(propertyId)}/bookings/manual/${encodeURIComponent(pmsBookingId)}/cancel?${params}`,
    { method: 'PATCH' },
  );
}

// ─── Connection Health ────────────────────────────────────────────────────────

export interface ConnectionHealthResult {
  propertyExists: boolean;
  roomsCount: number;
  inTenantGroup: boolean;
  webhookSubscribed: boolean;
  webhookReregistered: boolean;
  webhookId: string | null;
  messagesAppInstalled: boolean;
  errors: string[];
}

export async function checkConnectionHealth(
  propertyId: string,
  tenantId: string,
): Promise<ConnectionHealthResult> {
  const params = new URLSearchParams({ tenantId });
  return apiFetch(
    `${BASE}/properties/${encodeURIComponent(propertyId)}/connection-health?${params}`,
    { method: 'POST' },
  );
}

// ─── Messaging ───────────────────────────────────────────────────────────────

export async function replyToThread(
  propertyId: string,
  threadId: string,
  message: string,
): Promise<{ channexMessageId: string }> {
  return apiFetch(
    `${BASE}/properties/${encodeURIComponent(propertyId)}/threads/${encodeURIComponent(threadId)}/reply`,
    { method: 'POST', body: JSON.stringify({ message }) },
  );
}

// ─── OTA — Airbnb ─────────────────────────────────────────────────────────────

export async function getAirbnbSessionToken(propertyId: string): Promise<string> {
  const res = await apiFetch<{ token: string }>(
    `${BASE}/properties/${encodeURIComponent(propertyId)}/one-time-token`,
  );
  return res.token;
}

export async function getAirbnbCopyLink(propertyId: string): Promise<string> {
  const res = await apiFetch<{ url: string }>(
    `${BASE}/properties/${encodeURIComponent(propertyId)}/copy-link`,
  );
  return res.url;
}

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
  webhookId: string | null;
}

export interface IsolatedListingFailure {
  listingId: string;
  listingTitle: string;
  reason: string;
  step: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
}

export interface IsolatedSyncResult {
  succeeded: IsolatedListingResult[];
  failed: IsolatedListingFailure[];
}

export async function syncAirbnbListings(
  propertyId: string,
  tenantId: string,
): Promise<IsolatedSyncResult> {
  return apiFetch(`${BASE}/properties/${encodeURIComponent(propertyId)}/sync`, {
    method: 'POST',
    body: JSON.stringify({ tenantId }),
  });
}

// ─── OTA — Booking.com ────────────────────────────────────────────────────────

export async function getBookingSessionToken(
  tenantId: string,
): Promise<{ token: string; propertyId: string }> {
  return apiFetch(`/api/booking/session?tenantId=${encodeURIComponent(tenantId)}`);
}

export async function syncBookingListings(
  tenantId: string,
): Promise<{ rooms: { id: string; title: string }[]; rates: { id: string; title: string; room_id: string }[] }> {
  return apiFetch('/api/booking/sync', {
    method: 'POST',
    body: JSON.stringify({ tenantId }),
  });
}

export async function disconnectBookingChannel(tenantId: string): Promise<void> {
  return apiFetch('/api/booking/disconnect', {
    method: 'POST',
    body: JSON.stringify({ tenantId }),
  });
}

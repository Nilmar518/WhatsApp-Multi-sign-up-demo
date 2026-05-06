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
  defaultOccupancy: number;
  occAdults: number;
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
  options: { defaultAvailability: number; defaultRate: string; days?: number },
): Promise<FullSyncResult> {
  return apiFetch(`${BASE}/properties/${encodeURIComponent(propertyId)}/full-sync`, {
    method: 'POST',
    body: JSON.stringify(options),
  });
}

// ─── ARI — Snapshot (Firestore cache) ────────────────────────────────────────

export interface DayAvailability {
  availability: number;
  booked: number | null;
  roomTypeId: string;
}

export interface DayRestrictions {
  rate: string | null;
  minStayArrival: number | null;
  maxStay: number | null;
  stopSell: boolean;
  closedToArrival: boolean;
  closedToDeparture: boolean;
  ratePlanId: string;
}

export interface DaySnapshot {
  availability?: DayAvailability;
  restrictions?: DayRestrictions;
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

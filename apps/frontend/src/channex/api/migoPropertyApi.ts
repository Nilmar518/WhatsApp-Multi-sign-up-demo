const BASE = '/api/migo-properties';
const ARI_BASE = '/api/channex/ari';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PlatformConnection {
  platform: string;
  channex_property_id: string;
  listing_title: string;
  is_sync_enabled: boolean;
}

export interface MigoProperty {
  id: string;
  tenant_id: string;
  title: string;
  total_units: number;
  current_availability: number;
  alert_threshold: number;
  platform_connections: PlatformConnection[];
  created_at: string;
  updated_at: string;
}

export interface CreateMigoPropertyPayload {
  tenantId: string;
  title: string;
  total_units: number;
  alert_threshold?: number;
}

export interface UpdateMigoPropertyPayload {
  title?: string;
  total_units?: number;
  alert_threshold?: number;
}

export interface AssignConnectionPayload {
  channexPropertyId: string;
  platform: string;
  listingTitle: string;
  isSyncEnabled?: boolean;
}

export interface MigoPropertyAriPayload {
  dateFrom: string;
  dateTo: string;
  availability?: number;
  rate?: string;
  stopSell?: boolean;
  minStayArrival?: number;
  closedToArrival?: boolean;
  closedToDeparture?: boolean;
}

export interface AriPushResult {
  status: number;
  succeeded: string[];
  failed: Array<{ channexPropertyId: string; error: string }>;
}

// ─── Fetch helper ─────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  const body = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
  if (!res.ok) {
    const msg = Array.isArray(body?.message)
      ? body.message.join('; ')
      : (body?.message ?? `HTTP ${res.status}`);
    throw new Error(msg);
  }
  return body as T;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export function listMigoProperties(tenantId: string): Promise<MigoProperty[]> {
  return apiFetch(`${BASE}?tenantId=${encodeURIComponent(tenantId)}`);
}

export function createMigoProperty(payload: CreateMigoPropertyPayload): Promise<MigoProperty> {
  return apiFetch(BASE, { method: 'POST', body: JSON.stringify(payload) });
}

export function updateMigoProperty(
  id: string,
  payload: UpdateMigoPropertyPayload,
): Promise<MigoProperty> {
  return apiFetch(`${BASE}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteMigoProperty(id: string): Promise<void> {
  return apiFetch(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ─── Connections ──────────────────────────────────────────────────────────────

export function assignConnection(
  id: string,
  payload: AssignConnectionPayload,
): Promise<MigoProperty> {
  return apiFetch(`${BASE}/${encodeURIComponent(id)}/connections`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function removeConnection(id: string, channexId: string): Promise<MigoProperty> {
  return apiFetch(
    `${BASE}/${encodeURIComponent(id)}/connections/${encodeURIComponent(channexId)}`,
    { method: 'DELETE' },
  );
}

export function toggleSync(
  id: string,
  channexId: string,
  isSyncEnabled: boolean,
): Promise<MigoProperty> {
  return apiFetch(
    `${BASE}/${encodeURIComponent(id)}/connections/${encodeURIComponent(channexId)}`,
    { method: 'PATCH', body: JSON.stringify({ isSyncEnabled }) },
  );
}

// ─── Availability ─────────────────────────────────────────────────────────────

export function resetAvailability(id: string): Promise<MigoProperty> {
  return apiFetch(`${BASE}/${encodeURIComponent(id)}/availability/reset`, { method: 'POST' });
}

// ─── ARI fan-out ──────────────────────────────────────────────────────────────

export function pushAriToPool(
  migoPropertyId: string,
  payload: MigoPropertyAriPayload,
): Promise<AriPushResult> {
  return apiFetch(`${ARI_BASE}/migo-property/${encodeURIComponent(migoPropertyId)}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

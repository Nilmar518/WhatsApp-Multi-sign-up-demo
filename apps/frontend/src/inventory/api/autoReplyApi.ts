const BASE = '/api/auto-replies';

// ─── Types ────────────────────────────────────────────────────────────────────

export type MatchType = 'EXACT' | 'CONTAINS';

export interface AutoReply {
  id: string;
  triggerWord: string;
  matchType: MatchType;
  collectionTitle: string;
  retailerIds: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAutoReplyPayload {
  businessId: string;
  triggerWord: string;
  matchType: MatchType;
  collectionTitle: string;
  retailerIds: string[];
  isActive: boolean;
}

export interface UpdateAutoReplyPayload {
  businessId: string;
  triggerWord?: string;
  matchType?: MatchType;
  collectionTitle?: string;
  retailerIds?: string[];
  isActive?: boolean;
}

// ─── Fetch helper (mirrors catalogManagerApi pattern) ─────────────────────────

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });

  if (res.status === 204) return undefined as unknown as T;

  const body = (await res.json().catch(() => ({}))) as {
    message?: string | string[];
    statusCode?: number;
  };

  if (!res.ok) {
    throw new Error(
      Array.isArray(body.message)
        ? body.message.join('; ')
        : (body.message ?? `HTTP ${res.status}`),
    );
  }

  return body as T;
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

export function listRules(businessId: string): Promise<AutoReply[]> {
  return apiFetch(`${BASE}?businessId=${encodeURIComponent(businessId)}`);
}

export function createRule(payload: CreateAutoReplyPayload): Promise<AutoReply> {
  return apiFetch(BASE, { method: 'POST', body: JSON.stringify(payload) });
}

export function updateRule(
  ruleId: string,
  payload: UpdateAutoReplyPayload,
): Promise<AutoReply> {
  return apiFetch(`${BASE}/${ruleId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function deleteRule(businessId: string, ruleId: string): Promise<void> {
  return apiFetch(
    `${BASE}/${ruleId}?businessId=${encodeURIComponent(businessId)}`,
    { method: 'DELETE' },
  );
}

const BASE = '/api/booking';

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (res.status === 204) return undefined as unknown as T;

  const body = await res.json().catch(() => ({})) as {
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

export interface BookingRoom {
  id: string;
  title: string;
}

export interface BookingRate {
  id: string;
  title: string;
  room_id: string;
}

export interface RatePlan {
  id: string;
  title: string;
}

export interface RoomType {
  id: string;
  title: string;
  rate_plans: RatePlan[];
}

export interface SyncBookingResult {
  rooms: BookingRoom[];
  rates: BookingRate[];
}

/** Fetches (or creates) the Channex group+property for the tenant and returns a
 *  one-time session token + propertyId for the Channex popup URL. */
export async function getSessionToken(
  tenantId: string,
): Promise<{ token: string; propertyId: string }> {
  return apiFetch(`${BASE}/session?tenantId=${encodeURIComponent(tenantId)}`);
}

/** After the user completes the Channex popup, fetches the BookingCom channel
 *  for the tenant's group, calls get_rooms, and persists to Firestore. */
export async function syncBooking(tenantId: string): Promise<SyncBookingResult> {
  return apiFetch(`${BASE}/sync`, {
    method: 'POST',
    body: JSON.stringify({ tenantId }),
  });
}

/** Deletes the Channex channel (sends XML drop to Booking.com) and removes
 *  the Firestore integration record. */
export async function disconnectBooking(tenantId: string): Promise<void> {
  return apiFetch(`${BASE}/disconnect`, {
    method: 'POST',
    body: JSON.stringify({ tenantId }),
  });
}

/** Sends an outbound message to a Booking.com guest thread via Channex. */
export async function sendBookingMessage(
  tenantId: string,
  threadId: string,
  message: string,
): Promise<void> {
  return apiFetch(`${BASE}/messages`, {
    method: 'POST',
    body: JSON.stringify({ tenantId, threadId, message }),
  });
}

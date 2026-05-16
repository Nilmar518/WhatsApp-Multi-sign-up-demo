# Design Spec: BDC Channel Selector — Multi-Hotel Sync for Booking.com

**Date:** 2026-05-16
**Status:** Approved
**Scope:** Booking.com (BDC) channel selection before Rooms & Rates sync

---

## Problem

`BookingConnectionPanel` always passes `allProperties[0]` to `syncBdcListings`, and
`ChannexBdcSyncService.syncBdc` discovers the BDC channel with `.find()` — stopping
at the first `BookingCom` channel found on that property.

When a tenant has **multiple hotels** on Booking.com (each represented by a separate
BDC channel in Channex), only the first channel is ever synced. The others are
permanently unreachable through the UI.

---

## Solution Overview

Before executing Rooms & Rates sync, show the user a modal listing **all BDC channels
that belong to their Channex group** (one group = one tenant). The user picks one and
the sync runs against that specific channel.

Two deliverables:

**A. New backend endpoint** — `GET /channex/channels/bdc?tenantId=X`
Resolves the tenant's Channex group from Firestore and returns all BDC channels in
that group. Used exclusively by the modal to populate the list.

**B. `syncBdc` accepts `channelId` directly** — `channelId?` added as optional field
in the existing request body of `POST /channex/properties/:propertyId/sync-bdc`.
When present the Step 0 discovery is skipped; when absent the current discovery
behavior is preserved (backwards compatibility).

**C. Frontend modal** — `BdcChannelSelectModal` opens when the user clicks
"Sync Rooms & Rates", lists available channels as radio buttons, and on confirmation
calls the existing sync endpoint with the chosen `channelId` in the body.

---

## Architecture

All backend changes stay inside the `/channex` module. The Booking.com isolated
provisioning pipeline (`ChannexBdcSyncService`) is modified minimally — one optional
parameter and one conditional branch.

### Tenant isolation

Every tenant has exactly one Channex Group, created by `ChannexGroupService.ensureGroup`
and cached in `channex_groups/{tenantId}`. Properties and channels created for a tenant
carry that `group_id`. `GET /channels?filter[group_id]={groupId}` returns only that
tenant's channels — cross-tenant leakage is impossible at the API level.

---

## Backend

### A. `ChannexService.getChannelsByGroup(groupId)`

New method mirroring the existing `getChannels(propertyId)`:

```
GET /api/v1/channels?filter[group_id]={groupId}
```

Returns `ChannexChannelItem[]`. Caller is responsible for filtering by OTA type.

### B. New endpoint — `GET /channex/channels/bdc?tenantId=X`

Added to `ChannexPropertyController`.

**Handler logic:**

1. Read `groupId` from `channex_groups/{tenantId}` Firestore doc (same doc written by
   `ChannexGroupService.cacheGroup`). If doc missing → `404 Not Found`.
2. Call `getChannelsByGroup(groupId)`.
3. Filter: `attributes.channel === 'BookingCom'` **or**
   `attributes.channel_design_id === 'booking_com'` (same predicate as `syncBdc` Step 0).
4. Map to `{ id: string; title: string }[]` and return.

**Response shape:**

```json
[
  { "id": "abc-123", "title": "Hotel Playa Norte" },
  { "id": "def-456", "title": "Hotel Centro" }
]
```

**Error cases:**

| Case | HTTP |
|---|---|
| `channex_groups/{tenantId}` doc missing | 404 |
| Channex API error | 502 (propagated by `normaliseError`) |

### C. `syncBdc` — add optional `channelId` parameter

**File:** `apps/backend/src/channex/channex-bdc-sync.service.ts`

Signature change:

```typescript
async syncBdc(
  propertyId: string,
  tenantId: string,
  channelId?: string,     // ← new optional param
): Promise<BdcSyncResult>
```

Step 0 becomes conditional:

```typescript
// Step 0: Resolve BDC channel
const bdcChannel = channelId
  ? { id: channelId }                          // provided directly — skip discovery
  : channels.find(c =>
      c.attributes?.channel === 'BookingCom' ||
      c.attributes?.channel_design_id === 'booking_com',
    );
```

When `channelId` is provided, `getChannels(propertyId)` is not called.
`getChannelDetails(channexChannelId)` is still called (Step 1 — needed for
`mapping_details` and to derive `properties[0]` for `resolveParentDoc`).

**Controller DTO** (`POST /channex/properties/:propertyId/sync-bdc`):

```typescript
class SyncBdcDto {
  tenantId: string;
  channelId?: string;   // ← new optional field
}
```

No URL change. Backwards compatible — existing calls without `channelId` continue to work.

---

## Frontend

### `channexHubApi.ts` — new function

```typescript
export interface BdcChannel {
  id: string;
  title: string;
}

export async function getBdcChannels(tenantId: string): Promise<BdcChannel[]> {
  const params = new URLSearchParams({ tenantId });
  return apiFetch(`${BASE}/channels/bdc?${params}`);
}
```

`syncBdcListings` gains an optional `channelId` param passed in the body:

```typescript
export async function syncBdcListings(
  propertyId: string,
  tenantId: string,
  channelId?: string,
): Promise<BdcSyncResult> {
  return apiFetch(`${BASE}/properties/${encodeURIComponent(propertyId)}/sync-bdc`, {
    method: 'POST',
    body: JSON.stringify({ tenantId, ...(channelId ? { channelId } : {}) }),
  });
}
```

### New component — `BdcChannelSelectModal.tsx`

**Location:** `apps/frontend/src/channex/components/connection/BdcChannelSelectModal.tsx`

**Props:**

```typescript
interface Props {
  tenantId: string;
  onConfirm: (channelId: string) => void;
  onClose: () => void;
}
```

**States:**

| State | UI |
|---|---|
| `loading` | Spinner + "Loading channels…" |
| `error` | Red notice + retry button |
| `ready` (0 channels) | "No Booking.com channels found." + close button |
| `ready` (≥1 channel) | Radio list + "Sync" button (disabled until selection) |
| `ready` (1 channel) | That channel pre-selected |

On mount: calls `getBdcChannels(tenantId)`. If exactly one channel is returned, it is
pre-selected so the user can confirm immediately without extra interaction.

On "Sync" button click: calls `onConfirm(selectedChannelId)` and the modal closes.
The parent component owns the actual sync call and its loading/error/result state.

### `BookingConnectionPanel.tsx` — wire modal

Replace direct `handleSync()` invocation on button click with opening the modal:

```typescript
const [showChannelModal, setShowChannelModal] = useState(false);
```

"Sync Rooms & Rates" button → `setShowChannelModal(true)`.

`onConfirm(channelId)` callback:

```typescript
async function handleSyncConfirmed(channelId: string) {
  setShowChannelModal(false);
  setSyncing(true);
  setError(null);
  setSyncResult(null);
  try {
    const result = await syncBdcListings(
      baseProperty.channex_property_id,
      tenantId,
      channelId,
    );
    setSyncResult(result);
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Sync failed.');
  } finally {
    setSyncing(false);
  }
}
```

`BdcChannelSelectModal` is rendered conditionally when `showChannelModal === true`.

---

## Error handling

| Scenario | Behavior |
|---|---|
| `GET /channels/bdc` returns empty list | Modal shows "No Booking.com channels found" — user can only close |
| `GET /channels/bdc` fails | Modal shows error + retry button |
| Sync fails after channel selected | Existing error banner in `BookingConnectionPanel` |
| Single channel available | Auto-selected; user just clicks "Sync" to confirm |

---

## Out of scope

- Syncing multiple channels in a single operation.
- Persisting the last-used `channelId` per tenant.
- Changing the Airbnb sync flow — unrelated.
- Pagination of channel list (tenants with >50 hotels are not a current concern).

# BDC Single-Property Sync — Design Spec

**Date:** 2026-05-26  
**Status:** Approved  
**Scope:** Booking.com channel integration only — Airbnb is untouched

---

## 1. Problem Statement

The current Booking.com sync (`channex-bdc-sync.service.ts`) copies the Airbnb model: it creates one isolated Channex **property** per BDC room type. After all rooms are created it performs a destructive step (Step E.5) that re-assigns the BDC channel's `property_id` to `succeeded[0].channexPropertyId`.

Result: **all** BDC booking webhooks arrive with the first room's `property_id`, regardless of which room was actually booked. This means:

- ARI fan-out in `channex-booking.worker.ts` targets the wrong property.
- `migo_property_id` resolution always reads from the first room's doc, not the booked room's.
- A hotel with 100 rooms/rates cannot be correctly served.

**Root cause:** Booking.com uses a **one-hotel → one-Channex-property** model (documented by Channex: "Booking.com supports only one-to-one connections"). The 1:1 isolated model is architecturally wrong for BDC.

---

## 2. Solution Overview

Replace the isolated model for BDC with a **single-property model**:

- One **base Channex property** per hotel, created by the operator during the connection flow.
- All room types and rate plans created under that base property.
- The BDC channel remains assigned to the base property permanently (no re-assignment).
- One webhook registered on the base property (not per room).
- `migo_property_id` stored **per room type** in the base property's Firestore doc, in addition to the existing hotel-level `migo_property_id`.

Existing (old) isolated-property BDC integrations are **not touched** — backward compatibility is preserved through the existing `resolveIntegration()` path.

---

## 3. New Firestore Data Model

### Base property document

```
channex_integrations/{tenantId}/properties/{parentPropertyId}
{
  channex_property_id: "base-property-uuid",   // = parentPropertyId
  tenant_id: "...",
  channex_channel_id: "bdc-channel-uuid",
  channex_webhook_id: "webhook-uuid",
  connection_status: "active",
  connected_channels: ["booking"],
  migo_property_id: "hotel-migo-id",           // hotel level (from provisionProperty params)
  room_types: [
    {
      room_type_id: "channex-rt-uuid-1",
      title: "Double Room",                    // user-provided name from SyncNamingModal
      ota_room_id: "586818903",                // BDC room ID (for ARI mapping)
      migo_property_id: "migo-room-001",       // per-room MigoProperty ID (new field)
      source: "booking",
      rate_plans: [
        {
          rate_plan_id: "channex-rp-uuid-a",
          title: "Standard Rate",
          ota_rate_id: "16385046",             // BDC rate plan ID
        },
        {
          rate_plan_id: "channex-rp-uuid-b",
          title: "Non-refundable",
          ota_rate_id: "16385048",
        }
      ]
    },
    // ... more rooms
  ]
}
```

### `StoredRoomType` interface change

Add `migo_property_id?: string` to the existing interface in `channex-ari.service.ts`:

```typescript
export interface StoredRoomType {
  room_type_id: string;
  title: string;
  count_of_rooms: number;
  default_occupancy: number;
  occ_adults: number;
  occ_children: number;
  occ_infants: number;
  source?: 'airbnb' | 'booking' | 'manual';
  ota_listing_id?: string;
  ota_room_id?: string;
  migo_property_id?: string;   // NEW — per room (BDC)
  rate_plans: StoredRatePlan[];
}
```

---

## 4. Backend Changes

### 4.1 `channex-bdc-sync.service.ts` — Full pipeline rewrite

**Current broken pipeline (per room):**
```
A) Create isolated Channex property
B) Create room type under isolated property
C) Create rate plans under isolated property
D) Register webhook on isolated property
E) Install Messages App on isolated property
E.5) Re-assign channel property_id → succeeded[0].channexPropertyId  ← THE BUG
```

**New pipeline:**

Phase 1 — Rooms (loop over each BDC room):
```
A) Create room type under parentPropertyId   (no new property)
B) Create rate plans under parentPropertyId
```

Phase 2 — After all rooms succeed:
```
C) PUT /channels/:channelId  with body { room_types: [ { id: channexRoomTypeId, children: [ { id: channexRatePlanId } ] } ], ... }
   This applies the full room/rate mapping for BDC (channexRoomTypeId ↔ otaRoomId, channexRatePlanId ↔ otaRateId)
D) POST /activate channel
E) POST /webhooks on parentPropertyId        (ONCE)
F) POST /applications/install Messages App on parentPropertyId  (ONCE)
G) persistToFirestore() → update/merge base property doc with room_types[]
```

Step E.5 (channel re-assignment) is **eliminated entirely**.

**`getBdcListingPreview()`** currently returns `ListingPreviewProperty[]` (N items, one per BDC room). It must return `ListingPreviewProperty[]` with exactly **1 item** — the base property — with all rooms nested inside `property.rooms[]`.

```typescript
// Returns 1 item with N rooms
async getBdcListingPreview(
  parentPropertyId: string,
  tenantId: string,
  channelId: string,
): Promise<ListingPreviewProperty[]>
```

**`syncBdcListings()`** return type changes from `BdcSyncResult` (with `succeeded` = per-room isolated results) to:

```typescript
export interface BdcSyncResult {
  channexChannelId: string;
  channexPropertyId: string;    // base property (single)
  webhookId: string | null;
  succeeded: BdcRoomResult[];
  failed: BdcRoomFailure[];
}

export interface BdcRoomResult {
  otaRoomId: string;
  otaRoomTitle: string;
  channexRoomTitle: string;     // user-provided name
  roomTypeId: string;
  ratePlanIds: string[];
}
```

### 4.2 `channex-sync.service.ts` — Interface changes

Add `migoPropertyId` to `SyncNameOverride` and `ListingPreviewRoom`:

```typescript
export interface SyncNameOverride {
  propertyName?: string;
  roomName?: string;
  rates?: Record<string, string>;
  migoPropertyId?: string;   // NEW — per room (BDC)
}

export interface ListingPreviewRoom {
  id: string;
  roomName: string;
  rates: ListingPreviewRate[];
  migoPropertyId?: string;   // NEW — for pre-population in modal
}
```

`SyncNameOverrides` key semantics change for BDC: key = `otaRoomId` (was `otaPropertyId` in old isolated model). This is consistent — the naming modal iterates rooms, not properties.

### 4.3 `channex-ari.service.ts` — `StoredRoomType` interface

Add `migo_property_id?: string` field as described in §3.

### 4.4 `workers/channex-booking.worker.ts` — `migo_property_id` lookup

Change to two-level lookup (room-level preferred, property-level fallback):

```typescript
// BEFORE (property-level only):
const migoPropertyId =
  (propertyDocSnap.data()?.migo_property_id as string | null) ?? null;

// AFTER (backward compatible):
const roomTypes = (propertyDocSnap.data()?.room_types as StoredRoomType[] | undefined) ?? [];
const matchingRoom = roomTypes.find(
  (rt) => rt.room_type_id === reservationDoc.room_type_id,
);
const migoPropertyId =
  matchingRoom?.migo_property_id                                           // 1. room-level (BDC new)
  ?? (propertyDocSnap.data()?.migo_property_id as string | null)          // 2. property-level (Airbnb / old BDC)
  ?? null;
```

The `reservationDoc.room_type_id` field is the Channex room type ID present in all booking webhook payloads. No new webhook data is required.

### 4.5 `channex-property.controller.ts` — No changes

Existing endpoints are sufficient:
- `POST /channex/properties` → `provisionProperty()` — creates the base property
- `GET /channex/properties/:id/bdc-preview` → `getBdcListingPreview()`
- `POST /channex/properties/:id/sync-bdc` → `syncBdcListings()`

---

## 5. Frontend Changes

### 5.1 `channexHubApi.ts` — Type updates

```typescript
// Add migoPropertyId to SyncNameOverride
export interface SyncNameOverride {
  propertyName?: string;
  roomName?: string;
  rates?: Record<string, string>;
  migoPropertyId?: string;   // NEW
}

// Add migoPropertyId to ListingPreviewRoom
export interface ListingPreviewRoom {
  id: string;
  roomName: string;
  rates: ListingPreviewRate[];
  migoPropertyId?: string;   // NEW
}

// New BdcSyncResult shape
export interface BdcRoomResult {
  otaRoomId: string;
  otaRoomTitle: string;
  channexRoomTitle: string;
  roomTypeId: string;
  ratePlanIds: string[];
}

export interface BdcSyncResult {
  channexChannelId: string;
  channexPropertyId: string;   // single base property
  webhookId: string | null;
  succeeded: BdcRoomResult[];
  failed: BdcRoomFailure[];     // BdcRoomFailure replaces IsolatedBdcFailure (same shape, renamed)
}
```

Remove `IsolatedBdcResult` (replaced by `BdcRoomResult`).

### 5.2 `BookingConnectionPanel.tsx` — Connection flow refactor

**Current problem:** uses `baseProperty = allProperties[0]` as the IFrame target and sync origin. This requires a pre-existing property, which is incorrect for new connections.

**New flow:**

The panel gains a **provisioning step** before the IFrame opens:

```
Step 1 — No hotel created yet:
  Show "Connect Booking.com hotel" form with fields:
    - Hotel name (text input, required)
    - Currency (select, e.g. USD/EUR/GBP)
    - Timezone (select)
    - Migo Property ID (text input, optional — hotel level)
  "Create & Connect" button → calls provisionProperty() → stores createdPropertyId in local state
  
Step 2 — createdPropertyId set:
  Open ChannexOAuthIFrame with createdPropertyId
  "Sync Rooms" button (same as current flow) → leads to channel-select → preview → naming → sync
```

State changes:
```typescript
const [createdPropertyId, setCreatedPropertyId] = useState<string | null>(null);
// replaces: const baseProperty = allProperties[0] ?? null;
```

The `allProperties` hook remains for the "Connected Hotels" list rendered below the accordion. The `bookingProperties` hook (source: 'booking') continues to determine the auto-collapse behaviour.

The "Sync Rooms" button is only enabled once `createdPropertyId` is set (IFrame has been opened and OAuth completed by the operator).

### 5.3 `SyncNamingModal.tsx` — BDC multi-room layout

**Current behaviour:** iterates `preview` treating each item as one property (one room per property). Works correctly for Airbnb.

**BDC new behaviour:** `preview` contains exactly 1 item with N rooms. The modal must:

1. **Property name row** — read-only display (not an input — already set during provisioning).
2. **Room rows** — for each `room` in `prop.rooms[]`:
   - Room name input (pre-populated from `room.roomName`)
   - Rate name inputs per rate (pre-populated)
   - `migo_property_id` input (text, optional, labelled "Migo Room ID")
3. `SyncNameOverrides` keys = `room.id` (= `otaRoomId`).

State initialization for BDC:
```typescript
const initial: SyncNameOverrides = {};
const prop = preview[0];           // single property for BDC
for (const room of prop.rooms) {
  initial[room.id] = {
    roomName: room.roomName,
    rates: Object.fromEntries(room.rates.map((r) => [r.id, r.rateName])),
    migoPropertyId: room.migoPropertyId ?? '',
  };
}
```

The modal must receive an explicit `channel` prop (`'airbnb' | 'booking'`) to choose the layout — using `preview.length` as the discriminator is ambiguous (a BDC hotel with only 1 room would incorrectly render in Airbnb layout):
- `channel === 'airbnb'` → current Airbnb layout (one card per property, each card = one listing)
- `channel === 'booking'` → new BDC multi-room layout (one property header, N room rows)

`BookingConnectionPanel` passes `channel="booking"` when rendering `SyncNamingModal`. Airbnb's connection panel (if it renders a `SyncNamingModal`) passes `channel="airbnb"` — no change to that panel.

---

## 6. Backward Compatibility

Old BDC integrations (isolated-property model) are preserved without any migration:

1. Old isolated property docs remain in Firestore at `channex_integrations/{tenantId}/properties/{isolatedPropertyId}`.
2. Channex continues to send webhooks to the old isolated `property_id` — Channex's assignment was permanent for those integrations.
3. `resolveIntegration(isolated_property_id)` still finds those docs → returns `{ tenantId, firestoreDocId }` correctly.
4. The booking worker's two-level `migo_property_id` lookup: `matchingRoom?.migo_property_id` is `undefined` for old docs (no `room_types[]` array) → falls through to `propertyDocSnap.data()?.migo_property_id` → same behaviour as before.

No migration script required. No feature flag required. No re-sync button needed.

---

## 7. Out of Scope

- **Airbnb:** completely untouched. The 1:1 isolated model is architecturally correct for Airbnb.
- **Re-sync / migration of old BDC integrations:** explicitly deferred. Old integrations keep working as-is.
- **ARI push UI:** existing `syncAriForAffectedNights()` is unchanged; room-level routing is fixed by the new `migo_property_id` lookup, not by changing the ARI service.
- **Auth/guard on endpoints:** out of scope (tracked in backend CLAUDE.md as future TODO).
- **Channex channel disconnection / cleanup:** not addressed here.

---

## 8. File Change Summary

| File | Change |
|------|--------|
| `apps/backend/src/channex/channex-bdc-sync.service.ts` | Full pipeline rewrite (single-property model) |
| `apps/backend/src/channex/channex-sync.service.ts` | Add `migoPropertyId` to `SyncNameOverride`, `ListingPreviewRoom` |
| `apps/backend/src/channex/channex-ari.service.ts` | Add `migo_property_id?: string` to `StoredRoomType` |
| `apps/backend/src/channex/workers/channex-booking.worker.ts` | Two-level `migo_property_id` lookup |
| `apps/frontend/src/channex/api/channexHubApi.ts` | Update types: `SyncNameOverride`, `ListingPreviewRoom`, `BdcSyncResult` |
| `apps/frontend/src/channex/components/connection/BookingConnectionPanel.tsx` | Provisioning step, remove `allProperties[0]` dependency |
| `apps/frontend/src/channex/components/connection/SyncNamingModal.tsx` | BDC multi-room layout, `migo_property_id` input per room |

No new files. No new NestJS modules. No new API endpoints.

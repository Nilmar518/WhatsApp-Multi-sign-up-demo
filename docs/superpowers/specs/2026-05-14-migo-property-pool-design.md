# MigoProperty Pool — Design Spec
**Date:** 2026-05-14  
**Status:** Approved for implementation

---

## Problem

The system currently models one Channex property per OTA listing (Airbnb or Booking.com),
with `count_of_rooms = 1`. In practice, the admin manages pools of physical units — e.g.,
"Studio Full" has 5 interchangeable physical units that are offered across multiple platforms
simultaneously. There is no entity in the system that represents this pool, so:

- Availability is tracked per-channel, not per unit type
- A booking on Airbnb does not automatically decrement availability visible to Booking.com
- The admin has no central view of how many units remain across all platforms
- ARI pushes must be repeated manually per platform

---

## Mental Model

```
MigoProperty "Studio Full"  (5 units)
├── platform_connection: Airbnb    → channex_property_id: abc-123  (is_sync_enabled: true)
└── platform_connection: Booking   → channex_property_id: def-456  (is_sync_enabled: true)

Booking arrives (Airbnb) → current_availability: 5 → 4
Admin toggles Booking.com sync off → is_sync_enabled: false (Booking stays independent)
current_availability hits 0 → SSE alert to admin → admin decides to push stop_sell
```

---

## Scope

This spec covers:

1. Firestore data model for `migo_properties`
2. `MigoPropertyService` — CRUD + availability mutations
3. `MigoPropertyController` — REST API
4. Updates to `ChannexBookingWorker` — decrement on booking/cancellation
5. Updates to `ChannexARIService` — fan-out push to all connected platforms
6. New SSE event for availability alerts
7. `firestore.indexes.json` update

Out of scope: frontend UI for property type management (separate spec).

---

## Firestore Data Model

### New collection: `migo_properties/{migoPropertyId}`

```typescript
{
  id: string;                    // Firestore auto-ID
  tenant_id: string;             // tenant this type belongs to
  title: string;                 // "Studio Full"
  total_units: number;           // total physical units of this type (e.g. 5)
  current_availability: number;  // live count, 0–N; mutated atomically
  alert_threshold: number;       // emit alert when availability <= this (default: 0)
  platform_connections: Array<{
    platform: string;                // 'airbnb' | 'booking' | future OTAs
    channex_property_id: string;     // Channex property UUID
    listing_title: string;           // OTA display name ("Studio Full ventana grande")
    is_sync_enabled: boolean;        // admin toggle per platform
  }>;
  created_at: string;            // ISO 8601
  updated_at: string;
}
```

`current_availability` is always mutated via `FieldValue.increment(±1)` to prevent
race conditions when multiple bookings arrive simultaneously.

### Field added to: `channex_integrations/{tenantId}/properties/{channexPropertyId}`

```
migo_property_id: string | null
```

Backref written on `assignConnection`, cleared on `removeConnection`.
Stored here so the booking worker can decrement availability without an extra collection lookup.

### Field added to: `channex_integrations/{tenantId}/properties/{channexPropertyId}/bookings/{ota_reservation_code}`

```
migo_property_id: string | null
```

Enables cross-platform booking reports grouped by unit type.

### Firestore index

```json
{
  "collectionGroup": "migo_properties",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "tenant_id", "order": "ASCENDING" },
    { "fieldPath": "created_at", "order": "DESCENDING" }
  ]
}
```

---

## MigoPropertyService

File: `apps/backend/src/migo-property/migo-property.service.ts`

### Methods

| Method | Description |
|--------|-------------|
| `createPropertyType(tenantId, dto)` | Creates a new `migo_properties` doc. Sets `current_availability = total_units`. |
| `listPropertyTypes(tenantId)` | Returns all types for the tenant ordered by `created_at DESC`. |
| `getPropertyType(migoPropertyId)` | Returns one type doc. Throws `NotFoundException` if absent. |
| `updatePropertyType(migoPropertyId, dto)` | Partial update: `title`, `total_units`, `alert_threshold`. Never touches `current_availability` directly. |
| `deletePropertyType(migoPropertyId)` | Guards: throws `BadRequestException` if `platform_connections` is non-empty. |
| `assignConnection(migoPropertyId, dto)` | Appends to `platform_connections` array. Writes `migo_property_id` backref on the Channex property doc. Validates that `channex_property_id` exists. |
| `removeConnection(migoPropertyId, channexPropertyId)` | Removes entry from array. Clears backref. |
| `toggleSync(migoPropertyId, channexPropertyId, enabled)` | Flips `is_sync_enabled` for one connection. |
| `decrementAvailability(migoPropertyId)` | `FieldValue.increment(-1)` via `update()`. Then calls `get()` to read the new value. If `current_availability <= alert_threshold` emits `MIGO_PROPERTY_EVENTS.AVAILABILITY_ALERT`. |
| `incrementAvailability(migoPropertyId)` | `FieldValue.increment(+1)`. Used on `booking_cancellation`. |
| `resetAvailability(migoPropertyId)` | Writes `current_availability = total_units`. Admin manual reset. |

### Dependency chain

```
MigoPropertyService
  ├── FirebaseService          (Firestore reads/writes)
  └── EventEmitter2            (SSE alert emission)
```

No dependency on `ChannexService` — HTTP calls to Channex remain in `ChannexARIService`.

---

## MigoPropertyController

File: `apps/backend/src/migo-property/migo-property.controller.ts`  
Prefix: `/migo-properties`

```
POST   /migo-properties                              createPropertyType
GET    /migo-properties?tenantId=X                   listPropertyTypes
GET    /migo-properties/:id                          getPropertyType
PATCH  /migo-properties/:id                          updatePropertyType
DELETE /migo-properties/:id                          deletePropertyType

POST   /migo-properties/:id/connections              assignConnection
DELETE /migo-properties/:id/connections/:channexId   removeConnection
PATCH  /migo-properties/:id/connections/:channexId   toggleSync

POST   /migo-properties/:id/availability/reset       resetAvailability
```

### DTOs

**CreateMigoPropertyDto**
```typescript
{ tenantId: string; title: string; total_units: number; alert_threshold?: number; }
```

**UpdateMigoPropertyDto** — all fields optional
```typescript
{ title?: string; total_units?: number; alert_threshold?: number; }
```

**AssignConnectionDto**
```typescript
{ channexPropertyId: string; platform: string; listingTitle: string; isSyncEnabled?: boolean; }
```

**ToggleSyncDto**
```typescript
{ isSyncEnabled: boolean; }
```

**MigoPropertyAriDto** — subset of existing `FullSyncOptions` + date range
```typescript
{
  dateFrom: string;
  dateTo: string;
  availability?: number;
  rate?: string;
  stopSell?: boolean;
  minStayArrival?: number;
  closedToArrival?: boolean;
  closedToDeparture?: boolean;
}
```

---

## ChannexARIService — fan-out method

File: `apps/backend/src/channex/channex-ari.service.ts`

New method added alongside existing ones:

```typescript
async pushAriToMigoProperty(
  migoPropertyId: string,
  dto: MigoPropertyAriDto,
): Promise<{ succeeded: string[]; failed: string[] }>
```

Behavior:
1. Fetch `migo_properties/{migoPropertyId}` via `FirebaseService` directly (no `MigoPropertyService` dependency)
2. Filter `platform_connections` where `is_sync_enabled === true`
3. For each connection, call `pushRestrictions()` (if any restriction field is set) and/or `pushAvailability()` (if `availability` is set) in **parallel** (`Promise.allSettled`)
4. Collect results: `succeeded[]` (channex_property_id) and `failed[]` with error messages
5. Return summary — partial failure is allowed; the controller returns `207 Multi-Status` if any failed

This method reads `migo_properties` directly via `FirebaseService` — it does NOT inject
`MigoPropertyService`. This avoids a circular module dependency:
`ChannexModule` imports `MigoPropertyModule` (for the booking worker); if `MigoPropertyModule`
also imported `ChannexModule` (for the ARI service), there would be a cycle.

### ARI fan-out endpoint location

The fan-out endpoint lives in `ChannexARIController` (not `MigoPropertyController`) for the same reason:

```
POST /channex/ari/migo-property/:migoPropertyId   — fan-out ARI to all connected platforms
```

`ChannexARIController` already owns all ARI-related routes. This keeps `MigoPropertyModule`
dependency-free from `ChannexModule`.

---

## ChannexBookingWorker — updates

File: `apps/backend/src/channex/workers/channex-booking.worker.ts`

After the existing booking persistence step, add:

```
// Step N+1: decrement pool availability
const propertyDoc = await readChannexPropertyDoc(tenantId, channexPropertyId);
const migoPropertyId = propertyDoc.migo_property_id ?? null;

if (migoPropertyId) {
  await migoPropertyService.decrementAvailability(migoPropertyId);
  // decrementAvailability internally emits the alert SSE if threshold is reached
}
```

On `booking_cancellation` event:
```
if (migoPropertyId) {
  await migoPropertyService.incrementAvailability(migoPropertyId);
}
```

The `migo_property_id` is stored in the property doc (not fetched from `migo_properties`),
so this adds **one Firestore read** to the booking path — acceptable given it's already
making several reads in `processInternal`.

---

## SSE — Availability Alert Event

Added to `channex.types.ts`:

```typescript
export const MIGO_PROPERTY_EVENTS = {
  AVAILABILITY_ALERT: 'migo_property.availability_alert',
} as const;

export interface MigoPropertyAvailabilityAlertEvent {
  tenantId: string;
  migoPropertyId: string;
  title: string;
  current_availability: number;
  timestamp: string;
}
```

The existing `ChannexEventsController` (`/channex/events` SSE endpoint) subscribes to this
event and forwards it to the frontend. No new SSE controller needed.

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Booking arrives, `migo_property_id` is null | Log info, skip decrement — no error |
| `decrementAvailability` doc not found | Log warning, do NOT fail the booking job — booking is already persisted |
| `assignConnection` with unknown `channex_property_id` | `NotFoundException` 404 |
| `deletePropertyType` with active connections | `BadRequestException` 400 with message listing active connections |
| ARI fan-out partial failure | `207 Multi-Status` with `{ succeeded[], failed[] }` body |
| `current_availability` goes negative (edge: duplicate webhook) | Permitted by increment — treated as 0 in the UI layer |

---

## Module Registration

New module: `apps/backend/src/migo-property/migo-property.module.ts`

Exports `MigoPropertyService` so `ChannexModule` can inject it into `ChannexBookingWorker`.
Imports `FirebaseModule` and `EventEmitterModule` (already global).

`AppModule` imports `MigoPropertyModule`.
`ChannexModule` imports `MigoPropertyModule`.

---

## File Inventory

New files:
```
apps/backend/src/migo-property/
  migo-property.module.ts
  migo-property.service.ts
  migo-property.controller.ts
  dto/
    create-migo-property.dto.ts
    update-migo-property.dto.ts
    assign-connection.dto.ts
    toggle-sync.dto.ts
    migo-property-ari.dto.ts
```

Modified files:
```
apps/backend/src/channex/channex.types.ts              (+ MIGO_PROPERTY_EVENTS, alert event type)
apps/backend/src/channex/channex-ari.service.ts        (+ pushAriToMigoProperty)
apps/backend/src/channex/channex-ari.controller.ts     (+ POST /channex/ari/migo-property/:id)
apps/backend/src/channex/workers/channex-booking.worker.ts  (+ decrement/increment calls)
apps/backend/src/channex/channex-events.controller.ts  (+ subscribe to AVAILABILITY_ALERT)
apps/backend/src/app.module.ts                         (+ MigoPropertyModule)
apps/backend/src/channex/channex.module.ts             (+ MigoPropertyModule import)
firestore.indexes.json                                 (+ migo_properties index)
```

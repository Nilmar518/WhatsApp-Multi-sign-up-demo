# Pool Capacity Auto-Calculation — Design Spec

**Date:** 2026-05-14
**Branch:** feat/messaging-inbox
**Status:** Approved for implementation

---

## Problem

`MigoPropertyDoc.total_units` is set **manually** by the user when creating a pool. It has no link to the actual room counts of connected Channex properties. This causes two failures:

1. **Wrong max**: A pool with `total_units = 5` can have 3 Airbnb properties (each 1 unit) + 3 Booking.com properties (3 + 5 + 4 = 12 units) connected, but the pool still shows `X / 5` — not `X / 15`.
2. **Wrong reset**: `Reset to full` resets `current_availability` to `total_units`, which is the stale manual value, not the real capacity.

The root cause: `assignConnection()` and `removeConnection()` never touch `total_units` or `current_availability`.

---

## Goal

`total_units` is computed automatically from the connected properties:

```
total_units = SUM(count_of_rooms for all connected properties)
```

Where each property's contribution = `SUM(rt.count_of_rooms for rt in room_types)`.

For Airbnb 1:1 properties: contribution = 1.
For Booking.com multi-room properties: contribution = sum of all room type counts.

---

## Architecture

### Data model change: `PlatformConnection`

Add `count_of_rooms` to store each connection's capacity contribution at assignment time:

```typescript
export interface PlatformConnection {
  platform: string;
  channex_property_id: string;
  listing_title: string;
  is_sync_enabled: boolean;
  count_of_rooms: number; // sum of room_types[].count_of_rooms at the time of assignment
}
```

Existing connections in Firestore without `count_of_rooms` are treated as `0` (legacy) — `removeConnection()` silently skips the capacity adjustment for those.

### Pool creation: `total_units` starts at 0

Pools are created empty. Capacity builds up as connections are assigned. The `total_units` field in `CreateMigoPropertyDto` is removed — the user no longer enters it manually.

### `assignConnection()` — validate + increment capacity

After resolving the Channex property doc (already done via `collectionGroup` query):

1. Read `room_types` from the property Firestore doc
2. Compute `countOfRooms = SUM(rt.count_of_rooms ?? 0)`
3. If `countOfRooms === 0` → throw `BadRequestException` with a message instructing the user to configure Rooms & Rates first
4. Set `count_of_rooms: countOfRooms` on the new `PlatformConnection`
5. Use `FieldValue.increment(countOfRooms)` to update both `total_units` and `current_availability` on the pool doc atomically

### `removeConnection()` — decrement capacity (backward compatible)

1. Find the connection being removed; read its `count_of_rooms` (may be `undefined` for legacy)
2. If `count_of_rooms` is defined and `> 0`:
   - `newTotal = Math.max(0, doc.total_units - count_of_rooms)`
   - `newAvail = Math.max(0, doc.current_availability - count_of_rooms)`
   - Write both to Firestore
3. If `count_of_rooms` is `undefined` or `0` → skip capacity update (legacy connection)

### `createPropertyType()` — no longer uses `total_units` from DTO

```typescript
const doc: MigoPropertyDoc = {
  ...
  total_units: 0,
  current_availability: 0,
  ...
};
```

### `resetAvailability()` — unchanged

`reset` already sets `current_availability = total_units`. Once `total_units` is correctly maintained, reset is correct by definition.

---

## Files Changed

| File | Change |
|---|---|
| `migo-property/migo-property.service.ts` | `PlatformConnection` + `count_of_rooms`; `createPropertyType` starts at 0; `assignConnection` validates + increments; `removeConnection` decrements |
| `migo-property/dto/create-migo-property.dto.ts` | Remove `total_units` field |
| `migo-property/dto/update-migo-property.dto.ts` | Keep `total_units` optional (manual override safety valve, not exposed in UI) |
| `channex/api/migoPropertyApi.ts` | Add `count_of_rooms` to `PlatformConnection`; remove `total_units` from `CreateMigoPropertyPayload` |
| `channex/components/pools/PoolCreateForm.tsx` | Remove "Total Physical Units" input |
| `channex/components/pools/AssignConnectionModal.tsx` | Show rooms-contributed preview; disable submit when 0 |
| `channex/components/pools/PoolDetail.tsx` | Show `count_of_rooms` per connection row |

---

## Validation Gate

If `SUM(rt.count_of_rooms)` for the selected property equals 0 when the user tries to assign a connection:

**Backend error (400):**
```
Property "<channexPropertyId>" has no room types with a room count configured.
Go to Properties → Rooms & Rates and set the room count before adding to a pool.
```

**Frontend (AssignConnectionModal):** When the user selects a property with 0 rooms, show an inline warning and disable the Assign button. The `useChannexProperties` hook already provides `room_types: StoredRoomType[]` for the selected property.

---

## Unified End State

| Scenario | total_units | current_availability | Reset to full |
|---|---|---|---|
| New pool, no connections | 0 | 0 | no-op |
| Add 3 Airbnb (1 room each) | 3 | 3 | resets to 3 |
| Add BDC prop (3 rooms) | 6 | 6 | resets to 6 |
| Add BDC prop (5 rooms) | 11 | 11 | resets to 11 |
| Add BDC prop (4 rooms) | 15 | 15 | resets to 15 |
| 1 booking arrives | 15 | 14 | resets to 15 |
| Remove a BDC prop (4 rooms) | 11 | 10 (or max(0, 14-4)) | resets to 11 |

---

## Out of Scope

- Re-syncing `total_units` when a property's `count_of_rooms` changes after assignment (user must remove and re-add the connection)
- Migrating existing legacy connections to populate `count_of_rooms` retroactively
- Room-type-level pool connections (pool is still property-level)

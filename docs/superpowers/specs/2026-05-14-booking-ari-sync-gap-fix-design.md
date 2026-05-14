# Booking ARI Sync Gap Fix — Design Spec

**Date:** 2026-05-14  
**Branch:** feat/messaging-inbox  
**Status:** Approved for implementation

---

## Problem

Two booking flows exist in the system — webhook (OTA bookings from Airbnb/Booking.com via Channex) and manual (walk-in, owner stay, maintenance block). They produce different end states, leaving functional gaps:

| Action | Booking in Firestore | MigoProperty pool counter | ARI push to other channels | Firestore ARI snapshot |
|---|---|---|---|---|
| Webhook today | ✅ | ✅ | ❌ missing | ❌ missing (side-effect of ARI push) |
| Manual today | ✅ | ❌ missing | ✅ | ✅ |

When an Airbnb booking arrives via webhook, availability on other connected channels (e.g. Booking.com) is never updated. When a manual booking is created, the MigoProperty pool counter is never decremented. Both flows should produce identical end state.

---

## Goal

Unify both flows so all four actions are performed on every booking event:

1. Booking upserted in Firestore
2. MigoProperty `current_availability` counter updated
3. ARI pushed to all connected channels (excluding the originating channel for webhook bookings)
4. Firestore ARI snapshot updated (automatic side-effect of step 3)

---

## Scope

**In scope:**
- `booking_new`, `booking_cancellation`, `booking_modification` webhook events
- Manual booking create and cancel
- Cross-channel ARI fan-out via MigoProperty pool

**Out of scope:**
- Properties not linked to a MigoProperty (no pool = no cross-channel sync needed)
- ARI push back to the originating OTA channel on webhook events (redundant — the OTA already knows)
- `reservation_request` / `alteration_request` / `booking_unmapped_room` events (different flow, no dates to sync)

---

## Architecture

### Approach: Extend `ChannexARIService` with `syncAriForAffectedNights()`

All ARI logic already lives in `ChannexARIService`. Adding one new method there gives a single source of truth for the cross-channel sync logic. No new files needed. No circular dependencies — `ChannexBookingWorker` injecting `ChannexARIService` is straightforward since both are in `ChannexModule`.

### Files changed

| File | Change |
|---|---|
| `channex-ari.service.ts` | New `syncAriForAffectedNights()` method + inject `MigoPropertyService` + call `decrementAvailability`/`incrementAvailability` in manual flows |
| `channex-booking.worker.ts` | Inject `ChannexARIService` + call `syncAriForAffectedNights()` after upsert for `booking_new`, `booking_cancellation`, `booking_modification` |
| `channex.module.ts` | Verify `MigoPropertyModule` is imported (likely already is) |

Files not changed: transformer, webhook controller, snapshot service, rate limiter, DTOs.

---

## New Method: `syncAriForAffectedNights()`

**Location:** `ChannexARIService`

**Signature:**
```typescript
async syncAriForAffectedNights(
  tenantId: string,              // Firestore integration doc ID (= firestoreDocId)
  originatingPropertyId: string, // excluded from fan-out
  roomTypeId: string,            // the room type that was booked
  nights: string[],              // ISO dates ['2025-06-01', ...] — check_out exclusive
): Promise<void>
```

**Internal flow:**

1. Read `migo_property_id` from `channex_integrations/{tenantId}/properties/{originatingPropertyId}`
2. If `migo_property_id` is null → return early (no pool, no cross-channel sync)
3. Read `migo_properties/{migoPropertyId}` → get `platform_connections` where `is_sync_enabled === true`
4. Filter out the connection where `channex_property_id === originatingPropertyId`
5. For each remaining connection, **in parallel**:
   a. Read its `count_of_rooms` from `channex_integrations/{tenantId}/properties/{channex_property_id}.room_types`
   b. Query its active (non-cancelled) bookings overlapping with `nights`
   c. Build `AvailabilityEntryDto[]` — one entry per night, value = `count_of_rooms - occupied_that_night`
   d. Call `this.pushAvailability()` (triggers Channex push + Firestore snapshot update automatically)
6. Per-channel errors are caught and logged individually — they do not abort other channels (same pattern as `pushAriToMigoProperty`)

**Fire-and-forget at call site:** callers use `.catch()` to log errors without blocking the booking upsert or revision ACK.

---

## Changes to `ChannexBookingWorker`

**New injection:** `ChannexARIService`

**Affected nights calculation:**

```
booking_new        → expandDateRange(check_in, check_out)
booking_cancellation → expandDateRange(check_in, check_out)
booking_modification → union of expandDateRange(old.check_in, old.check_out)
                       and expandDateRange(new.check_in, new.check_out)
```

For `booking_modification`, the worker already queries the existing Firestore doc before the merge (`existing.docs[0]`). Old dates are extracted from that snapshot before it is overwritten.

**Call site (after Firestore upsert, before `acknowledgeBookingRevision`):**

```typescript
if (['booking_new', 'booking_cancellation', 'booking_modification'].includes(event)) {
  this.ariService.syncAriForAffectedNights(
    firestoreDocId,
    propertyId,
    reservationDoc.room_type_id,
    affectedNights,
  ).catch((err) =>
    this.logger.error(`[BOOKING-WORKER] syncAriForAffectedNights failed: ${err.message}`)
  );
}
```

`expandDateRange` is currently a private method on `ChannexARIService`. It will be extracted to a standalone utility function in a shared utils file (e.g., `channex/utils/date-range.ts`) so the worker can use it without importing the full service just for the utility.

---

## Changes to Manual Booking Flow (`ChannexARIService`)

**New injection:** `MigoPropertyService`

### `createManualBooking()` — after successful ARI push

```typescript
const migoPropertyId = (propDoc.data()?.migo_property_id as string | null) ?? null;
if (migoPropertyId) {
  this.migoPropertyService.decrementAvailability(migoPropertyId).catch((err) =>
    this.logger.error(`[MANUAL-BOOKING] decrementAvailability failed: ${err.message}`)
  );
}
```

`migo_property_id` is read from the `propDoc` already fetched at the start of the method — no extra Firestore query.

### `cancelManualBooking()` — after successful ARI restore

```typescript
const migoPropertyId = (cancelPropDoc.data()?.migo_property_id as string | null) ?? null;
if (migoPropertyId) {
  this.migoPropertyService.incrementAvailability(migoPropertyId).catch((err) =>
    this.logger.error(`[MANUAL-BOOKING] incrementAvailability failed: ${err.message}`)
  );
}
```

`cancelPropDoc` is already fetched for the room type capacity calculation.

---

## Error Handling

All new calls follow the established fire-and-forget pattern: `.catch()` logs the error without rethrowing. This ensures:
- A failed ARI sync never rolls back a booking save
- A failed pool counter update never blocks booking confirmation
- Each channel in the fan-out fails independently

If an ARI push fails for a specific channel, the doc's `ari_synced` flag will remain `false` (for manual bookings) or won't be set (for webhook bookings — webhook bookings do not currently track `ari_synced`, and this spec does not add it). Manual reconciliation via the existing `pullBookingsFromChannex` mechanism covers recovery.

---

## Unified End State (after fix)

| Action | Booking in Firestore | MigoProperty pool counter | ARI push to other channels | Firestore ARI snapshot |
|---|---|---|---|---|
| Webhook booking_new | ✅ | ✅ | ✅ | ✅ (auto) |
| Webhook booking_cancellation | ✅ | ✅ | ✅ | ✅ (auto) |
| Webhook booking_modification | ✅ | ✅ (net no change) | ✅ | ✅ (auto) |
| Manual create | ✅ | ✅ | ✅ | ✅ (auto) |
| Manual cancel | ✅ | ✅ | ✅ | ✅ (auto) |

Note: `booking_modification` does not change the pool counter (one booking in, one booking out — net zero).

---

## Open Questions / Assumptions

- `room_type_id` is populated on all webhook reservation docs by the transformer. If it is null for any reason, `syncAriForAffectedNights()` returns early with a warning log.
- The `expandDateRange` utility will be extracted. If a circular dependency arises, it can instead be inlined in the worker.
- `MigoPropertyModule` is assumed to already be imported in `ChannexModule`. If not, it is added as part of this work.

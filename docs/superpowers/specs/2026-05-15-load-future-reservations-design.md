# Design Spec: Load Future Reservations — Channex Integration

**Date:** 2026-05-15  
**Status:** Approved  
**Scope:** Airbnb + Booking.com via Channex

---

## Problem

When a host connects their OTA channel (Airbnb or Booking.com) through Channex, existing future reservations are not automatically imported into the Migo app under two conditions:

1. **Booking.com (BDC) — bug:** `BookingPipelineService.commitPipeline` activates the channel but never calls `load_future_reservations`. BDC reservations made before the connection are permanently invisible until a new booking event arrives.

2. **Both channels — operational gap:** If the initial `load_future_reservations` call fails (network error, Railway downtime, ngrok URL stale), there is no in-app way to re-trigger it. Support must use manual tooling or ask the host to reconnect.

---

## Solution Overview

Two deliverables:

**A. Bug fix** — Add `loadFutureReservations` to the Booking.com commit pipeline, mirroring the Airbnb pipeline.

**B. Manual re-trigger endpoint** — `POST /channex/properties/:propertyId/load-reservations` allows in-app re-sync for any property (Airbnb or BDC). Surfaced in the empty state of both reservation views.

---

## Architecture

All changes live inside the `/channex` module — consistent with the DDD boundary that owns all Channex API interactions and both OTA integrations. The legacy `/booking` module is not extended.

### Firestore data path (unchanged)

```
channex_integrations/{tenantId}/properties/{channexPropertyId}/bookings/{bookingId}
```

Webhooks from Channex → `ChannexWebhookController` → `ChannexBookingWorker` → writes to this path. Both Airbnb and BDC reservations land here. `load_future_reservations` triggers Channex to replay existing reservations as `booking_new` webhook events, which follow the same path.

---

## Backend

### A. Bug fix — `booking-pipeline.service.ts`

In `BookingPipelineService.commitPipeline`, after Step 6 (channel activation), add:

```typescript
// Step 6.5: Pull existing BDC future reservations (mirrors Airbnb pipeline, non-fatal)
await this.channex.loadFutureReservations(channexChannelId);
```

`ChannexService.loadFutureReservations` is already non-fatal (wrapped in try/catch with a warning log). No changes needed to that method — calling with `channelId` and no `listingId` pulls all reservations for the channel.

### B. New endpoint — `ChannexPropertyController`

```
POST /channex/properties/:propertyId/load-reservations
```

**Request:** no body required — the property ID carries all routing context.  
**Response:** `{ status: 'triggered' }` — HTTP 200 always (Channex errors are non-fatal and logged server-side).  
**Error cases:**
- `404` — no Firestore doc found for `propertyId`, or no `channex_channel_id` set yet

**Handler logic** (new method on `ChannexSyncService`):

```typescript
async triggerLoadReservations(propertyId: string): Promise<{ status: string }> {
  // 1. Resolve channelId from Firestore
  const db = this.firebase.getFirestore();
  const snap = await db
    .collectionGroup('properties')
    .where('channex_property_id', '==', propertyId)
    .limit(1)
    .get();

  if (snap.empty) throw new NotFoundException(...);

  const channelId = snap.docs[0].data().channex_channel_id as string;
  if (!channelId) throw new NotFoundException('No channel connected to this property.');

  // 2. Trigger pull — non-fatal, errors are logged inside loadFutureReservations
  await this.channex.loadFutureReservations(channelId);

  return { status: 'triggered' };
}
```

**Why `ChannexSyncService` (not `ChannexPropertyService`):** `ChannexSyncService` already owns all `loadFutureReservations` call sites. Keeping them together makes future audits straightforward.

---

## Frontend

### `channexApi.ts` — new function

```typescript
export async function loadReservations(propertyId: string): Promise<void> {
  await apiFetch(
    `${BASE}/properties/${encodeURIComponent(propertyId)}/load-reservations`,
    { method: 'POST' },
  );
}
```

Added to `apps/frontend/src/airbnb/api/channexApi.ts` — the canonical Channex API file re-exported by the Airbnb integration.

### `BookingReservations.tsx` — empty state button

When `reservations.length === 0` and loading is complete, the empty state gains:

```
┌─────────────────────────────────────────┐
│  📅  No reservations yet                │
│                                         │
│  Already have reservations on           │
│  Booking.com? Import them now.          │
│                                         │
│  [ Import Past Reservations ]           │
└─────────────────────────────────────────┘
```

Component adds local state: `syncState: 'idle' | 'loading' | 'success' | 'error'`

- **idle:** button is enabled, normal label
- **loading:** spinner + "Importing…", button disabled
- **success:** green notice "Import started — reservations will appear in a few seconds." Button re-enabled (idempotent re-trigger is safe)
- **error:** red notice with error message, button re-enabled for retry

The `propertyId` prop already exists on `BookingReservations` — no prop drilling needed.

### `DetailedReservationsView.tsx` — empty state button (Airbnb parity)

Same UX pattern. Uses `activeProperty.channex_property_id` (already available) to call `loadReservations`. Provides the same safety net if Airbnb's initial pull failed during `autoSyncProperty`.

---

## Error handling

| Scenario | Behavior |
|---|---|
| `channelId` not yet set in Firestore | 404 from backend; frontend shows red notice |
| Channex API returns error | `loadFutureReservations` logs and swallows; backend returns `{ status: 'triggered' }` — reservations may not arrive but the call doesn't crash the UI |
| Duplicate trigger | Idempotent — Channex deduplicates reservation events by `booking_id` via the `ChannexBookingWorker` upsert (`firebase.set(bookingRef, doc, { merge: true })`) |

---

## Out of scope

- Migrating `BookingIntegrationView` off `/api/booking/*` — separate initiative.
- Per-listing scoped pull (`listingId` param) — `loadFutureReservations` already supports it but the UI does not need it for this feature.
- Airbnb calendar sync (ARI) — unrelated to reservation import.

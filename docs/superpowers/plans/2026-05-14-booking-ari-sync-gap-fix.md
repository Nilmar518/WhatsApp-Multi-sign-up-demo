# Booking ARI Sync Gap Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify webhook and manual booking flows so both always produce: Firestore booking upsert + MigoProperty pool counter update + Channex ARI push to all other connected channels + Firestore ARI snapshot update.

**Architecture:** Extract `expandDateRange` to a shared utility; add `syncAriForAffectedNights()` to `ChannexARIService` for per-night recalculation + cross-channel fan-out (excluding the originating channel); wire it into `ChannexBookingWorker` for `booking_new`, `booking_cancellation`, and `booking_modification`; add `decrementAvailability`/`incrementAvailability` calls to manual booking create/cancel. `MigoPropertyModule` is already imported in `ChannexModule` — no module changes needed.

**Tech Stack:** NestJS, TypeScript, Firestore (firebase-admin), Channex REST API. No automated test runner is configured — verification uses dev-server logs and curl.

**Spec:** `docs/superpowers/specs/2026-05-14-booking-ari-sync-gap-fix-design.md`

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `apps/backend/src/channex/utils/date-range.ts` | **Create** | Shared `expandDateRange` utility |
| `apps/backend/src/channex/channex-ari.service.ts` | **Modify** | Remove private `expandDateRange`, inject `MigoPropertyService`, add `syncAriForAffectedNights()`, add pool counter calls to manual flows |
| `apps/backend/src/channex/workers/channex-booking.worker.ts` | **Modify** | Inject `ChannexARIService`, compute affected nights, call `syncAriForAffectedNights()` after upsert |

---

## Task 1: Extract `expandDateRange` to a shared utility

**Files:**
- Create: `apps/backend/src/channex/utils/date-range.ts`
- Modify: `apps/backend/src/channex/channex-ari.service.ts` — remove private method, add import

- [ ] **Step 1.1 — Create the utility file**

Create `apps/backend/src/channex/utils/date-range.ts`:

```typescript
/** Expands [dateFrom, dateTo) to an array of ISO date strings. dateTo is exclusive. */
export function expandDateRange(dateFrom: string, dateTo: string): string[] {
  const dates: string[] = [];
  const cur = new Date(`${dateFrom}T00:00:00Z`);
  const end = new Date(`${dateTo}T00:00:00Z`);
  while (cur < end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}
```

- [ ] **Step 1.2 — Import the utility in `channex-ari.service.ts`**

Add this import after the existing import block at the top of `channex-ari.service.ts`:

```typescript
import { expandDateRange } from './utils/date-range';
```

- [ ] **Step 1.3 — Remove the private `expandDateRange` method from `channex-ari.service.ts`**

Delete the private method at lines 1041–1050 (the full block):

```typescript
// DELETE this entire method:
private expandDateRange(dateFrom: string, dateTo: string): string[] {
  const dates: string[] = [];
  const cur = new Date(`${dateFrom}T00:00:00Z`);
  const end = new Date(`${dateTo}T00:00:00Z`);
  while (cur < end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}
```

Then update every call to `this.expandDateRange(...)` inside the file to `expandDateRange(...)` (drop the `this.`). There are two call sites: inside `createManualBooking` and inside `cancelManualBooking`. The `subtractOneDay` private method (lines 1058–1063) is NOT extracted — leave it in place.

- [ ] **Step 1.4 — Verify the server compiles**

```bash
pnpm --filter @migo-uit/backend dev
```

Expected: NestJS starts on port 3001 with no TypeScript compilation errors in the terminal.

- [ ] **Step 1.5 — Commit**

```bash
git add apps/backend/src/channex/utils/date-range.ts apps/backend/src/channex/channex-ari.service.ts
git commit -m "refactor(channex): extract expandDateRange to shared utility"
```

---

## Task 2: Add `syncAriForAffectedNights()` to `ChannexARIService`

**Files:**
- Modify: `apps/backend/src/channex/channex-ari.service.ts`

- [ ] **Step 2.1 — Add `MigoPropertyService` to the imports**

Add to the import block at the top of `channex-ari.service.ts`:

```typescript
import {
  MigoPropertyService,
  type PlatformConnection,
} from '../migo-property/migo-property.service';
```

- [ ] **Step 2.2 — Inject `MigoPropertyService` in the constructor**

Replace the existing constructor with:

```typescript
constructor(
  private readonly channex: ChannexService,
  private readonly propertyService: ChannexPropertyService,
  private readonly firebase: FirebaseService,
  private readonly rateLimiter: ChannexARIRateLimiter,
  private readonly snapshotService: ChannexARISnapshotService,
  private readonly migoPropertyService: MigoPropertyService,
) {}
```

- [ ] **Step 2.3 — Add the `syncAriForAffectedNights()` method**

Add the following method at the end of the class body, after `pushAriToMigoProperty` and before the closing `}` of the class:

```typescript
/**
 * Recalculates per-night availability for affected nights and pushes to all
 * MigoProperty-connected channels except the originating one.
 *
 * No-op when: the property has no migo_property_id, there are no other enabled
 * connections, roomTypeId is falsy, or nights is empty.
 *
 * Always call fire-and-forget (.catch) at the call site — never block the
 * booking upsert or revision ACK on this.
 */
async syncAriForAffectedNights(
  tenantId: string,
  originatingPropertyId: string,
  roomTypeId: string | null | undefined,
  nights: string[],
): Promise<void> {
  if (!roomTypeId || !nights.length) {
    this.logger.warn(
      `[ARI-SYNC] Skipped — roomTypeId=${roomTypeId ?? 'null'} nights=${nights.length}`,
    );
    return;
  }

  const db = this.firebase.getFirestore();

  // 1. Resolve migo_property_id from the originating property doc
  const propSnap = await db
    .collection(INTEGRATIONS_COLLECTION)
    .doc(tenantId)
    .collection('properties')
    .doc(originatingPropertyId)
    .get();

  const migoPropertyId =
    (propSnap.data()?.migo_property_id as string | null) ?? null;

  if (!migoPropertyId) {
    this.logger.log(
      `[ARI-SYNC] No migo_property_id for propertyId=${originatingPropertyId} — skipping`,
    );
    return;
  }

  // 2. Get enabled connections from MigoProperty, excluding the originator
  const migoSnap = await db.collection('migo_properties').doc(migoPropertyId).get();

  if (!migoSnap.exists) {
    this.logger.warn(`[ARI-SYNC] MigoProperty not found: ${migoPropertyId}`);
    return;
  }

  const connections: PlatformConnection[] =
    (migoSnap.data()?.platform_connections as PlatformConnection[]) ?? [];

  const targets = connections.filter(
    (c) => c.is_sync_enabled && c.channex_property_id !== originatingPropertyId,
  );

  if (!targets.length) {
    this.logger.log(
      `[ARI-SYNC] No other enabled connections for migoPropertyId=${migoPropertyId}`,
    );
    return;
  }

  // 3. Fan-out: per-night recalculation for each connected property
  const bookingsRef = db
    .collection(INTEGRATIONS_COLLECTION)
    .doc(tenantId)
    .collection('bookings');

  const results = await Promise.allSettled(
    targets.map(async (conn) => {
      const { channex_property_id } = conn;

      const connPropSnap = await db
        .collection(INTEGRATIONS_COLLECTION)
        .doc(tenantId)
        .collection('properties')
        .doc(channex_property_id)
        .get();

      const connRoomTypes: StoredRoomType[] =
        (connPropSnap.data()?.room_types as StoredRoomType[]) ?? [];

      if (!connRoomTypes.length) {
        this.logger.warn(
          `[ARI-SYNC] No room_types cached for channex_property_id=${channex_property_id} — skipping`,
        );
        return;
      }

      // Fetch all active bookings for this connected property that overlap nights
      const bookingsSnap = await bookingsRef
        .where('propertyId', '==', channex_property_id)
        .get();

      const activeOverlapping = bookingsSnap.docs.filter((d) => {
        const b = d.data() as {
          booking_status: string;
          check_in: string;
          check_out: string;
        };
        if (b.booking_status === 'cancelled') return false;
        return nights.some((night) => b.check_in <= night && b.check_out > night);
      });

      // Build per-room-type per-night availability entries
      const availabilityUpdates: AvailabilityEntryDto[] = [];

      for (const rt of connRoomTypes) {
        for (const night of nights) {
          const taken = activeOverlapping
            .filter((d) => {
              const b = d.data() as { room_type_id?: string };
              return !b.room_type_id || b.room_type_id === rt.room_type_id;
            })
            .map((d) => {
              const b = d.data() as {
                check_in: string;
                check_out: string;
                count_of_rooms?: number;
              };
              if (b.check_in > night || b.check_out <= night) return 0;
              return b.count_of_rooms ?? 1;
            })
            .reduce((sum, n) => sum + n, 0);

          availabilityUpdates.push({
            property_id: channex_property_id,
            room_type_id: rt.room_type_id,
            date_from: night,
            date_to: night,
            availability: Math.max(0, rt.count_of_rooms - taken),
          });
        }
      }

      await this.pushAvailability(availabilityUpdates);

      this.logger.log(
        `[ARI-SYNC] ✓ Pushed ${availabilityUpdates.length} entries ` +
          `to channex_property_id=${channex_property_id}`,
      );
    }),
  );

  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      this.logger.error(
        `[ARI-SYNC] Fan-out failed for channex_property_id=${targets[i].channex_property_id}: ` +
          `${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
      );
    }
  });
}
```

- [ ] **Step 2.4 — Verify the server compiles**

```bash
pnpm --filter @migo-uit/backend dev
```

Expected: starts on port 3001 with no TypeScript errors.

- [ ] **Step 2.5 — Commit**

```bash
git add apps/backend/src/channex/channex-ari.service.ts
git commit -m "feat(channex-ari): add syncAriForAffectedNights for cross-channel ARI fan-out"
```

---

## Task 3: Wire `ChannexBookingWorker` to call `syncAriForAffectedNights()`

**Files:**
- Modify: `apps/backend/src/channex/workers/channex-booking.worker.ts`

- [ ] **Step 3.1 — Add imports**

Add to the import block at the top of the file:

```typescript
import { ChannexARIService } from '../channex-ari.service';
import { expandDateRange } from '../utils/date-range';
```

- [ ] **Step 3.2 — Inject `ChannexARIService` in the constructor**

Replace the existing constructor:

```typescript
constructor(
  private readonly channex: ChannexService,
  private readonly propertyService: ChannexPropertyService,
  private readonly firebase: FirebaseService,
  private readonly eventEmitter: EventEmitter2,
  private readonly migoPropertyService: MigoPropertyService,
  private readonly ariService: ChannexARIService,
) {}
```

- [ ] **Step 3.3 — Capture old dates before the Firestore upsert**

In `processInternal()`, locate the `const existing = await bookingsRef...get()` query (around line 240). Immediately after that query and before the `if (!existing.empty)` upsert block, add:

```typescript
// Capture pre-merge dates — used to compute the union of nights for booking_modification
let previousCheckIn: string | null = null;
let previousCheckOut: string | null = null;
if (!existing.empty) {
  const prevData = existing.docs[0].data() as {
    check_in?: string;
    check_out?: string;
  };
  previousCheckIn = prevData.check_in ?? null;
  previousCheckOut = prevData.check_out ?? null;
}
```

- [ ] **Step 3.4 — Add the `syncAriForAffectedNights` call after the Firestore upsert**

After the upsert `if/else` block (the block that ends with either `await this.firebase.set(newRef, reservationDoc)` or `await this.firebase.set(existing.docs[0].ref, reservationDoc, { merge: true })`), and before the existing MigoProperty counter block, add:

```typescript
// ── Cross-channel ARI fan-out ─────────────────────────────────────────────
if (
  (event === 'booking_new' ||
    event === 'booking_cancellation' ||
    event === 'booking_modification') &&
  reservationDoc.room_type_id &&
  reservationDoc.check_in &&
  reservationDoc.check_out
) {
  const newNights = expandDateRange(reservationDoc.check_in, reservationDoc.check_out);

  const affectedNights =
    event === 'booking_modification' && previousCheckIn && previousCheckOut
      ? [...new Set([...expandDateRange(previousCheckIn, previousCheckOut), ...newNights])]
      : newNights;

  this.ariService
    .syncAriForAffectedNights(
      firestoreDocId,
      propertyId,
      reservationDoc.room_type_id,
      affectedNights,
    )
    .catch((err) =>
      this.logger.error(
        `[BOOKING-WORKER] syncAriForAffectedNights failed — ` +
          `event=${event} propertyId=${propertyId}: ${(err as Error).message}`,
      ),
    );
}
```

- [ ] **Step 3.5 — Verify the server compiles**

```bash
pnpm --filter @migo-uit/backend dev
```

Expected: starts on port 3001 with no TypeScript errors.

- [ ] **Step 3.6 — Commit**

```bash
git add apps/backend/src/channex/workers/channex-booking.worker.ts
git commit -m "feat(channex-booking): fan-out ARI to connected channels on webhook booking events"
```

---

## Task 4: Add MigoProperty pool counter to manual booking create and cancel

**Files:**
- Modify: `apps/backend/src/channex/channex-ari.service.ts`

`MigoPropertyService` is already injected after Task 2. `propDoc` and `cancelPropDoc` are already fetched in both methods. No new Firestore reads needed.

- [ ] **Step 4.1 — Decrement counter in `createManualBooking`**

Locate the `try` block near the end of `createManualBooking` — the one that calls `this.pushAvailability(availabilityUpdates)` and sets `ari_synced: true`. Find the `return` statement inside this block:

```typescript
return { ...doc, ari_synced: true, ari_task_id: taskId };
```

Insert the following lines **before** that return:

```typescript
const manualBookingMigoId =
  (propDoc.data()?.migo_property_id as string | null) ?? null;
if (manualBookingMigoId) {
  this.migoPropertyService.decrementAvailability(manualBookingMigoId).catch((err) =>
    this.logger.error(
      `[MANUAL-BOOKING] decrementAvailability failed — ` +
        `migoPropertyId=${manualBookingMigoId}: ${(err as Error).message}`,
    ),
  );
}
```

- [ ] **Step 4.2 — Increment counter in `cancelManualBooking`**

Locate the `try/catch` block near the end of `cancelManualBooking` — the one that calls `this.pushAvailability(availabilityUpdates)` and sets `ari_task_id`. The block looks like:

```typescript
try {
  const taskId = await this.pushAvailability(availabilityUpdates);
  await this.firebase.set(docRef, { ari_task_id: taskId, updated_at: now }, { merge: true });
} catch (e) {
  this.logger.warn(...);
}
```

After that entire `try/catch` block and before the final `return` statement of `cancelManualBooking`, add:

```typescript
const cancelMigoId =
  (cancelPropDoc.data()?.migo_property_id as string | null) ?? null;
if (cancelMigoId) {
  this.migoPropertyService.incrementAvailability(cancelMigoId).catch((err) =>
    this.logger.error(
      `[MANUAL-BOOKING] incrementAvailability failed — ` +
        `migoPropertyId=${cancelMigoId}: ${(err as Error).message}`,
    ),
  );
}
```

- [ ] **Step 4.3 — Verify the server compiles**

```bash
pnpm --filter @migo-uit/backend dev
```

Expected: starts on port 3001 with no TypeScript errors.

- [ ] **Step 4.4 — Commit**

```bash
git add apps/backend/src/channex/channex-ari.service.ts
git commit -m "feat(channex-ari): update MigoProperty pool counter on manual booking create and cancel"
```

---

## Task 5: End-to-end verification

No automated test runner is configured. Verification uses the running dev server and log inspection.

**Prerequisites:**
- Dev server running (`pnpm --filter @migo-uit/backend dev`)
- At least one `migo_properties` doc in Firestore with two `platform_connections` both having `is_sync_enabled: true`
- Both connections must have `channex_integrations/{tenantId}/properties/{channex_property_id}` docs with a populated `room_types` array

- [ ] **Step 5.1 — Verify webhook `booking_new` triggers ARI fan-out**

The Channex HMAC guard validates the `x-channex-signature` header. For local testing, send the request directly to localhost (no ngrok needed). Compute a valid HMAC or temporarily observe existing webhook traffic in ngrok's inspector at `http://localhost:4040`.

To test with a real webhook, trigger a booking from Airbnb in the Channex sandbox. Then check the backend terminal for this sequence of log lines:

```
[BOOKING-WORKER] Processing event=booking_new propertyId=<id>
[BOOKING-WORKER] ✓ Reservation upserted — event=booking_new ...
[ARI-SYNC] ✓ Pushed N entries to channex_property_id=<other-property-id>
```

If the property has no `migo_property_id`, you will see `[ARI-SYNC] No migo_property_id` instead — that is also correct behavior.

- [ ] **Step 5.2 — Verify `booking_cancellation` triggers ARI fan-out**

Cancel the same booking via Airbnb or Channex sandbox. Check logs for:

```
[BOOKING-WORKER] Processing event=booking_cancellation propertyId=<id>
[BOOKING-WORKER] ✓ Reservation upserted — event=booking_cancellation ...
[ARI-SYNC] ✓ Pushed N entries to channex_property_id=<other-property-id>
```

- [ ] **Step 5.3 — Verify manual booking decrements MigoProperty counter**

Note the `current_availability` value of the MigoProperty doc in Firestore before this call. Then:

```bash
curl -X POST http://localhost:3001/channex/ari/<channex_property_id>/manual-bookings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <jwt>" \
  -d '{
    "tenantId": "<tenantId>",
    "roomTypeId": "<room_type_id>",
    "checkIn": "2025-08-01",
    "checkOut": "2025-08-03",
    "bookingType": "direct",
    "currency": "USD"
  }'
```

Expected logs:

```
[ARI] createManualBooking — propertyId=<id>
[ARI] ✓ Manual booking written — pms_booking_id=<id>
[ARI] ✓ createManualBooking complete — pms_booking_id=<id> ari_task_id=<id>
[MIGO-PROPERTY] Availability decremented — id=<migoPropertyId> availability=N
```

Confirm in Firestore that `migo_properties/<migoPropertyId>.current_availability` decreased by 1.

- [ ] **Step 5.4 — Verify manual cancel restores MigoProperty counter**

Using the `pms_booking_id` returned from Step 5.3:

```bash
curl -X DELETE \
  "http://localhost:3001/channex/ari/<channex_property_id>/manual-bookings/<pms_booking_id>?tenantId=<tenantId>" \
  -H "Authorization: Bearer <jwt>"
```

Expected logs:

```
[ARI] cancelManualBooking — propertyId=<id> pmsBookingId=<id>
[ARI] ✓ cancelManualBooking — pms_booking_id=<id> marked cancelled
[ARI] ✓ cancelManualBooking complete — availability restored for pms_booking_id=<id>
[MIGO-PROPERTY] Availability incremented — id=<migoPropertyId>
```

Confirm in Firestore that `current_availability` returned to its prior value.

- [ ] **Step 5.5 — Push branch**

```bash
git push origin feat/messaging-inbox
```

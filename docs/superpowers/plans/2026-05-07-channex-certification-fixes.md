# Channex Certification Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the two issues blocking Channex PMS certification: (1) Full Sync must include all 5 declared restriction fields, and (2) Booking receiving must use `GET /api/v1/booking_revisions/feed` + send `POST /acknowledge` after processing.

**Architecture:** Two surgical edits. Fix 1 adds 5 missing fields to the `restrictionUpdates` array in `fullSync()`. Fix 2 has three sub-parts: add a `fetchBookingRevisionsFeed()` method to `ChannexService`, replace the `pullBookingsFromChannex()` logic in `ChannexARIService` to use the feed, and call `acknowledgeBookingRevision()` in `ChannexBookingWorker` after every successful Firestore upsert.

**Tech Stack:** NestJS (TypeScript), Channex REST API, Firestore (Firebase Admin SDK), Bull queues.

---

## File Map

| File | Change |
|---|---|
| `apps/backend/src/channex/channex-ari.service.ts` | Fix `fullSync()` restriction payload + replace `pullBookingsFromChannex()` |
| `apps/backend/src/channex/channex.service.ts` | Add `fetchBookingRevisionsFeed()` |
| `apps/backend/src/channex/workers/channex-booking.worker.ts` | Call `acknowledgeBookingRevision()` after Firestore upsert |

---

## Task 1: Fix `fullSync()` — Include All Declared Restriction Fields

**Files:**
- Modify: `apps/backend/src/channex/channex-ari.service.ts`

**Context:** `fullSync()` builds two batch arrays: `availabilityUpdates` and `restrictionUpdates`. The restriction array currently only sets `rate`. According to the ARI endpoint schema and our certification declaration, we must also set `min_stay_arrival`, `max_stay`, `closed_to_arrival`, `closed_to_departure`, and `stop_sell` with their "open" defaults.

- [ ] **Step 1: Locate the `fullSync()` method and find the restriction array construction**

Open `apps/backend/src/channex/channex-ari.service.ts` and find the block that builds `restrictionUpdates` (around where `ratePlanIds.map(...)` is called for restrictions). It currently looks like this:

```typescript
const restrictionUpdates: RestrictionEntryDto[] = ratePlanIds.map((ratePlanId) => ({
  property_id: propertyId,
  rate_plan_id: ratePlanId,
  date_from: dateFrom,
  date_to: dateTo,
  rate: options.defaultRate,
}));
```

- [ ] **Step 2: Replace with all 7 fields**

Replace the block above with:

```typescript
const restrictionUpdates: RestrictionEntryDto[] = ratePlanIds.map((ratePlanId) => ({
  property_id: propertyId,
  rate_plan_id: ratePlanId,
  date_from: dateFrom,
  date_to: dateTo,
  rate: options.defaultRate,
  min_stay_arrival: 1,
  max_stay: null,
  closed_to_arrival: false,
  closed_to_departure: false,
  stop_sell: false,
}));
```

- [ ] **Step 3: Verify `RestrictionEntryDto` accepts these fields**

Open `apps/backend/src/channex/dto/create-rate-plan.dto.ts` (or wherever `RestrictionEntryDto` is defined — grep for `RestrictionEntryDto`). Confirm it has optional or required fields for all five additions. If any are missing, add them:

```typescript
// Add to RestrictionEntryDto:
@IsOptional() @IsInt() min_stay_arrival?: number;
@IsOptional() @IsInt() @IsNull() max_stay?: number | null;
@IsOptional() @IsBoolean() closed_to_arrival?: boolean;
@IsOptional() @IsBoolean() closed_to_departure?: boolean;
@IsOptional() @IsBoolean() stop_sell?: boolean;
```

- [ ] **Step 4: Check that the restriction push endpoint accepts null for max_stay**

In `channex-ari.service.ts`, find where `restrictionUpdates` is passed to the Channex API call. Confirm the HTTP body serialization doesn't strip `null` values. If using `JSON.stringify`, `null` is preserved correctly. No change needed.

- [ ] **Step 5: Run TypeScript compiler to verify no type errors**

```bash
cd apps/backend && pnpm tsc --noEmit
```

Expected: no errors related to `RestrictionEntryDto`.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/channex/channex-ari.service.ts apps/backend/src/channex/dto/
git commit -m "fix(channex): include all 5 declared restriction fields in fullSync open-defaults"
```

---

## Task 2: Add `fetchBookingRevisionsFeed()` to `ChannexService`

**Files:**
- Modify: `apps/backend/src/channex/channex.service.ts`

**Context:** The current `fetchBookings()` method calls `GET /api/v1/bookings`, which is the administrative booking history endpoint — not for PMS integration. Andrew requires using `GET /api/v1/booking_revisions/feed` which returns only non-acknowledged revisions. We add a new method and keep `fetchBookings()` intact (it may be used elsewhere).

- [ ] **Step 1: Understand the Channex feed endpoint response shape**

The `GET /api/v1/booking_revisions/feed` endpoint accepts query params:
- `property_id` — filter to one property (required for our use case)

Response shape:
```json
{
  "data": [
    {
      "id": "<revision_uuid>",
      "type": "booking_revision",
      "attributes": {
        "booking_id": "...",
        "status": "new|modified|cancelled",
        ...
      },
      "relationships": {
        "booking": { "data": { "id": "...", "type": "booking" } }
      }
    }
  ],
  "included": [
    {
      "id": "<booking_uuid>",
      "type": "booking",
      "attributes": { ... full booking data ... }
    }
  ]
}
```

The `included` array contains the full booking objects. To get the full booking data for each revision, you must match `relationships.booking.data.id` against `included[].id`.

- [ ] **Step 2: Add `fetchBookingRevisionsFeed()` method to `ChannexService`**

In `apps/backend/src/channex/channex.service.ts`, find the class body and add after `fetchBookings()`:

```typescript
async fetchBookingRevisionsFeed(propertyId: string): Promise<Array<{
  revisionId: string;
  bookingId: string | null;
  bookingData: Record<string, unknown>;
}>> {
  const params = new URLSearchParams({ property_id: propertyId });
  const url = `${this.baseUrl}/api/v1/booking_revisions/feed?${params}`;

  const response = await this.defensiveLogger.request<{
    data: Array<{
      id: string;
      attributes: Record<string, unknown>;
      relationships?: { booking?: { data?: { id?: string } } };
    }>;
    included?: Array<{ id: string; type: string; attributes: Record<string, unknown> }>;
  }>('GET', url, undefined, { headers: this.buildHeaders() });

  const included = response.included ?? [];
  const bookingMap = new Map(
    included
      .filter((item) => item.type === 'booking')
      .map((item) => [item.id, item.attributes]),
  );

  return (response.data ?? []).map((revision) => {
    const bookingId = revision.relationships?.booking?.data?.id ?? null;
    const bookingData = (bookingId ? bookingMap.get(bookingId) : null) ?? revision.attributes;
    return {
      revisionId: revision.id,
      bookingId,
      bookingData: bookingData as Record<string, unknown>,
    };
  });
}
```

- [ ] **Step 3: Verify `buildHeaders()` and `this.baseUrl` exist in `ChannexService`**

Grep for `buildHeaders` and `baseUrl` in `channex.service.ts`. If the method is named differently (e.g., `getHeaders()`, `authHeaders()`), use that name. The Channex API token header is typically `X-Api-Key` or `Authorization: Bearer <token>`. Confirm by looking at how existing methods like `fetchBookings()` set their headers.

- [ ] **Step 4: Run TypeScript check**

```bash
cd apps/backend && pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/channex/channex.service.ts
git commit -m "feat(channex): add fetchBookingRevisionsFeed using /booking_revisions/feed endpoint"
```

---

## Task 3: Replace `pullBookingsFromChannex()` to Use Feed + ACK

**Files:**
- Modify: `apps/backend/src/channex/channex-ari.service.ts`

**Context:** `pullBookingsFromChannex()` currently calls `fetchBookings()` (wrong endpoint). It must now call `fetchBookingRevisionsFeed()`, transform each booking via `BookingRevisionTransformer`, upsert to Firestore, then call `acknowledgeBookingRevision()` for each revision processed successfully. If ACK fails, we log a warning but do not throw — the booking is already in Firestore, and we don't want to rollback.

- [ ] **Step 1: Locate `pullBookingsFromChannex()` in `channex-ari.service.ts`**

Find the method (approximately):

```typescript
async pullBookingsFromChannex(propertyId: string, tenantId: string, limit = 50): Promise<{ synced: number }> {
  const bookings = await this.channexService.fetchBookings(propertyId, ...);
  // ...
}
```

- [ ] **Step 2: Rewrite `pullBookingsFromChannex()` to use feed + ACK**

Replace the full method body with:

```typescript
async pullBookingsFromChannex(
  propertyId: string,
  tenantId: string,
): Promise<{ synced: number }> {
  const revisions = await this.channexService.fetchBookingRevisionsFeed(propertyId);

  let synced = 0;

  for (const { revisionId, bookingData } of revisions) {
    try {
      // Build a minimal payload shape the transformer expects
      const payload = {
        event: (bookingData.status as string) ?? 'booking_new',
        revision_id: revisionId,
        property_id: propertyId,
        booking: bookingData,
      } as import('./channex.types').ChannexWebhookFullPayload;

      const doc = BookingRevisionTransformer.toFirestoreReservation(payload, tenantId);

      const docId = doc.reservation_id ?? revisionId;
      const docRef = this.firebaseService
        .getFirestore()
        .collection('channex_integrations')
        .doc(tenantId)
        .collection('properties')
        .doc(propertyId)
        .collection('bookings')
        .doc(docId);

      await docRef.set(doc, { merge: true });
      synced++;

      // ACK — tell Channex we successfully received this revision
      try {
        await this.channexService.acknowledgeBookingRevision(revisionId);
      } catch (ackErr) {
        this.logger.warn(
          `pullBookingsFromChannex: ACK failed for revision ${revisionId}: ${(ackErr as Error).message}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `pullBookingsFromChannex: failed to process revision ${revisionId}: ${(err as Error).message}`,
      );
    }
  }

  return { synced };
}
```

- [ ] **Step 3: Verify imports at top of `channex-ari.service.ts`**

Confirm these imports exist (add if missing):

```typescript
import { BookingRevisionTransformer } from './transformers/booking-revision.transformer';
```

`acknowledgeBookingRevision` is on `this.channexService` which is already injected.

- [ ] **Step 4: Run TypeScript check**

```bash
cd apps/backend && pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/channex/channex-ari.service.ts
git commit -m "fix(channex): use booking_revisions/feed for pullBookings and ACK each processed revision"
```

---

## Task 4: ACK Webhook Bookings in `ChannexBookingWorker`

**Files:**
- Modify: `apps/backend/src/channex/workers/channex-booking.worker.ts`

**Context:** When a booking arrives via webhook and is processed by the worker, we must call `acknowledgeBookingRevision()` after the successful Firestore write. The `revisionId` is available in the webhook payload as `payload.revision_id` (or from the booking data). `ChannexService` is injected into the worker.

- [ ] **Step 1: Locate the Firestore write in the worker and identify `revisionId`**

In `channex-booking.worker.ts`, find the `process()` method. The Firestore write (Step 5 in the original code) saves the document. Above or around the write, `payload.revision_id` should be accessible. Confirm the field name — it may be `payload.revision_id` or `revisionId` from the `BookingRevisionTransformer` output.

- [ ] **Step 2: Add ACK call immediately after the Firestore write succeeds**

Find the `await docRef.set(doc, { merge: true })` call. After it, add:

```typescript
// Acknowledge receipt to Channex so it stops re-delivering this revision
const revisionId = payload.revision_id ?? doc.booking_revision_id ?? null;
if (revisionId) {
  try {
    await this.channexService.acknowledgeBookingRevision(revisionId);
    this.logger.log(`[ChannexBookingWorker] ACK sent for revision ${revisionId}`);
  } catch (ackErr) {
    this.logger.warn(
      `[ChannexBookingWorker] ACK failed for revision ${revisionId}: ${(ackErr as Error).message}`,
    );
  }
}
```

- [ ] **Step 3: Confirm `this.channexService` is injected in the worker**

Look at the constructor of `ChannexBookingWorker`. If `ChannexService` is not injected, add it:

```typescript
constructor(
  // existing params...
  private readonly channexService: ChannexService,
) {}
```

And add the import at the top if missing:
```typescript
import { ChannexService } from '../channex.service';
```

- [ ] **Step 4: Run TypeScript check**

```bash
cd apps/backend && pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/channex/workers/channex-booking.worker.ts
git commit -m "fix(channex): acknowledge booking revision after successful Firestore write in worker"
```

---

## Task 5: Verify `acknowledgeBookingRevision()` Endpoint in `ChannexService`

**Files:**
- Read/verify: `apps/backend/src/channex/channex.service.ts`

**Context:** The method already exists but may not have been tested. Verify the endpoint URL matches Channex documentation: `POST /api/v1/booking_revisions/{id}/acknowledge`.

- [ ] **Step 1: Find and read `acknowledgeBookingRevision()` in `channex.service.ts`**

Confirm it calls `POST /api/v1/booking_revisions/{revisionId}/acknowledge` with the correct auth headers. It should look approximately like:

```typescript
async acknowledgeBookingRevision(revisionId: string): Promise<void> {
  const url = `${this.baseUrl}/api/v1/booking_revisions/${encodeURIComponent(revisionId)}/acknowledge`;
  await this.defensiveLogger.request('POST', url, undefined, { headers: this.buildHeaders() });
}
```

If the URL format is wrong (e.g., using `/bookings/` instead of `/booking_revisions/`), correct it.

- [ ] **Step 2: If corrected, commit**

```bash
git add apps/backend/src/channex/channex.service.ts
git commit -m "fix(channex): correct acknowledgeBookingRevision endpoint URL"
```

If no change was needed, skip this commit.

---

## Task 6: End-to-End Smoke Test

- [ ] **Step 1: Ensure Redis is running**

```bash
docker ps | findstr redis
```

If not running:
```bash
docker run -d --name redis-migo -p 6379:6379 redis:alpine
```

- [ ] **Step 2: Start the backend**

```bash
pnpm --filter @migo-uit/backend dev
```

Watch logs for successful startup (no Redis connection errors).

- [ ] **Step 3: Trigger a test Full Sync from the UI**

Open `https://localhost:5173`, navigate to the Channex property, click Full Sync. In the backend logs, verify the restrictions payload includes all 7 fields:

```
rate, min_stay_arrival, max_stay, closed_to_arrival, closed_to_departure, stop_sell
```

- [ ] **Step 4: Trigger manual booking pull from the UI**

In the PropertyDetail Reservations tab, click "Sync from Channex". Verify in backend logs:
1. `fetchBookingRevisionsFeed` is called
2. Each revision is processed and upserted to Firestore
3. `ACK sent for revision <id>` appears in logs for each

- [ ] **Step 5: Verify ACK on incoming webhook**

Send a test webhook (or wait for Channex to send one). In the backend logs, verify `[ChannexBookingWorker] ACK sent for revision <id>` appears after the Firestore write.

- [ ] **Step 6: Final commit summary if all green**

```bash
git log --oneline -5
```

Confirm all 4-5 fix commits are in place.

---

## Re-submission Checklist

Before re-submitting to Andrew:

- [ ] Test #1 (Full Sync): Run a fresh full sync, confirm the task ID. The Channex log should show restrictions with `min_stay_arrival`, `max_stay`, `cta`, `ctd`, `stop_sell` entries alongside `rate`.
- [ ] Test #11 (Booking Receiving): During the next live session with Andrew, confirm that after his test webhook arrives:
  1. Firestore shows the booking document
  2. Backend logs show `ACK sent for revision <id>`
  3. A second call to the feed returns an empty array (revision was acked)
- [ ] Update `docs/channex/11-certification-form-answers.md` with new Test #1 task ID once re-run.

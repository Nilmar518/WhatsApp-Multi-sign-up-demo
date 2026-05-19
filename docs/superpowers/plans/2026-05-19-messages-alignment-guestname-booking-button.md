# Messages Inbox — Alignment Fix, Guest Name Repair & Booking Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix message alignment (all host messages appear on the right), repair "Unknown Guest" labels in thread list, and add a "Ver Reserva" button in the chat header that opens the existing reservation detail modal.

**Architecture:** Introduce a `normalizeSender` util (backend) imported by the worker and the one-time migration service. Worker changes are forward-only; historical Firestore data is repaired via a single `POST /admin/migrate-messages?tenantId=X` endpoint. Frontend adds `getBookingById` to the API client and wires it to a button + `ReservationDetailModal` in `ConversationPane`.

**Tech Stack:** NestJS (backend), Firestore Admin SDK, React + TypeScript (frontend), existing `ReservationDetailModal` component.

---

## File Map

| Action | Path |
|--------|------|
| **Create** | `apps/backend/src/channex/utils/normalize-sender.ts` |
| **Modify** | `apps/backend/src/channex/workers/channex-message.worker.ts` |
| **Modify** | `apps/backend/src/channex/channex-property.service.ts` |
| **Modify** | `apps/backend/src/channex/channex-property.controller.ts` |
| **Modify** | `apps/backend/src/channex/channex-ari.service.ts` |
| **Modify** | `apps/backend/src/channex/channex-ari.controller.ts` |
| **Modify** | `apps/frontend/src/channex/api/channexHubApi.ts` |
| **Modify** | `apps/frontend/src/channex/components/shared/MessagesInbox.tsx` |

---

## Task 1 — Create `normalize-sender.ts` util

**File:** `apps/backend/src/channex/utils/normalize-sender.ts` (new)

- [ ] Create the file with the following content:

```typescript
const HOST_SENDER_VALUES = new Set([
  'host',
  'property_manager',
  'host_user',
  'owner',
  'property',
]);

/**
 * Maps any Channex/OTA sender string to the canonical two-value set used
 * throughout the system. Anything not explicitly in the host list is treated
 * as 'guest' (conservative default).
 */
export function normalizeSender(raw: string): 'host' | 'guest' {
  return HOST_SENDER_VALUES.has(raw.toLowerCase().trim()) ? 'host' : 'guest';
}
```

---

## Task 2 — Apply `normalizeSender` in the message worker

**File:** `apps/backend/src/channex/workers/channex-message.worker.ts`

This task makes two changes: (a) normalize `sender` before storing the message doc, (b) stop overwriting `guestName` on the thread when `meta.name` is absent.

- [ ] **Step 1: Add the import** at the top of the file (after existing imports):

```typescript
import { normalizeSender } from '../utils/normalize-sender';
```

- [ ] **Step 2: Replace the `sender` extraction line** (currently around line 90):

Find:
```typescript
const sender = typeof msg.sender === 'string' ? msg.sender : 'unknown';
```

Replace with:
```typescript
const rawSender = typeof msg.sender === 'string' ? msg.sender : 'guest';
const sender = normalizeSender(rawSender);
```

- [ ] **Step 3: Make the thread batch update conditional on `guestName`**

Find the `batch.set(threadRef, { ... }, { merge: true })` call in `processInternal` (the one that sets `guestName`, `lastMessage`, `updatedAt`, etc.):

```typescript
batch.set(
  threadRef,
  {
    propertyId,
    tenantId,
    bookingId,
    guestName,
    lastMessage: messageText,
    updatedAt: serverNow,
  },
  { merge: true },
);
```

Replace with:
```typescript
const threadPatch: Record<string, unknown> = {
  propertyId,
  tenantId,
  bookingId,
  lastMessage: messageText,
  updatedAt: serverNow,
};
if (guestName !== 'Unknown Guest') {
  threadPatch.guestName = guestName;
}
batch.set(threadRef, threadPatch, { merge: true });
```

---

## Task 3 — Add `migrateMessagesData` to `ChannexPropertyService`

**File:** `apps/backend/src/channex/channex-property.service.ts`

- [ ] **Step 1: Add the import** for `normalizeSender` at the top of the file:

```typescript
import { normalizeSender } from './utils/normalize-sender';
```

- [ ] **Step 2: Add the method** at the end of the `ChannexPropertyService` class (before the closing `}`):

```typescript
/**
 * One-time migration: repairs existing Firestore data for a given tenant.
 *
 * Phase 1 — guestName: for every thread with guestName === 'Unknown Guest',
 * attempts to recover the name from bookingDetails.guest_name or from any
 * message document in the thread that carries a real name.
 *
 * Phase 2 — sender: for every message document whose sender value is not
 * already canonical ('host' | 'guest'), normalizes it using normalizeSender().
 *
 * Scoped to one tenantId (= firestoreDocId) to limit blast radius.
 * Safe to run multiple times — only writes when a change is needed.
 */
async migrateMessagesData(
  tenantId: string,
): Promise<{ threadsRepaired: number; messagesNormalized: number }> {
  const db = this.firebase.getFirestore();
  let threadsRepaired = 0;
  let messagesNormalized = 0;

  const propertiesSnap = await db
    .collection('channex_integrations')
    .doc(tenantId)
    .collection('properties')
    .get();

  this.logger.log(
    `[MIGRATE] Starting — tenantId=${tenantId} properties=${propertiesSnap.size}`,
  );

  for (const propertyDoc of propertiesSnap.docs) {
    const threadsSnap = await propertyDoc.ref.collection('threads').get();

    for (const threadDoc of threadsSnap.docs) {
      const threadData = threadDoc.data() as Record<string, unknown>;

      // Fetch all messages once — used for both phases.
      const msgsSnap = await threadDoc.ref.collection('messages').get();

      // ── Phase 1: repair guestName ─────────────────────────────────────
      if ((threadData.guestName as string | undefined) === 'Unknown Guest') {
        let repairedName: string | null = null;

        // Prefer bookingDetails.guest_name if present on the thread doc.
        const bd = threadData.bookingDetails as Record<string, unknown> | undefined;
        if (typeof bd?.guest_name === 'string' && bd.guest_name !== 'Unknown Guest') {
          repairedName = bd.guest_name;
        }

        // Fall back to the first message with a real guestName.
        if (!repairedName) {
          for (const msgDoc of msgsSnap.docs) {
            const name = msgDoc.data().guestName as string | undefined;
            if (name && name !== 'Unknown Guest') {
              repairedName = name;
              break;
            }
          }
        }

        if (repairedName) {
          await threadDoc.ref.update({ guestName: repairedName });
          threadsRepaired++;
          this.logger.log(
            `[MIGRATE] Thread ${threadDoc.id} — guestName repaired to "${repairedName}"`,
          );
        }
      }

      // ── Phase 2: normalize sender ─────────────────────────────────────
      for (const msgDoc of msgsSnap.docs) {
        const currentSender = msgDoc.data().sender as string | undefined;
        if (!currentSender) continue;
        const normalized = normalizeSender(currentSender);
        if (normalized !== currentSender) {
          await msgDoc.ref.update({ sender: normalized });
          messagesNormalized++;
          this.logger.log(
            `[MIGRATE] Msg ${msgDoc.id} — sender "${currentSender}" → "${normalized}"`,
          );
        }
      }
    }
  }

  this.logger.log(
    `[MIGRATE] Done — threadsRepaired=${threadsRepaired} messagesNormalized=${messagesNormalized}`,
  );
  return { threadsRepaired, messagesNormalized };
}
```

Note: `this.firebase` and `this.logger` are already available in `ChannexPropertyService` — no new injection needed.

---

## Task 4 — Add migration endpoint to `ChannexPropertyController`

**File:** `apps/backend/src/channex/channex-property.controller.ts`

- [ ] **Add the route** immediately before the first `@Post(':propertyId/...')` or `@Get(':id/...')` dynamic-param route (static segments must precede wildcard params in NestJS):

```typescript
/**
 * POST /channex/properties/admin/migrate-messages?tenantId=X
 *
 * One-time admin endpoint: normalizes historical sender values and repairs
 * Unknown Guest names in Firestore for the given tenant.
 * Safe to call multiple times — idempotent per document.
 */
@Post('admin/migrate-messages')
@HttpCode(HttpStatus.OK)
async migrateMessages(
  @Query('tenantId') tenantId: string,
): Promise<{ threadsRepaired: number; messagesNormalized: number }> {
  if (!tenantId) {
    throw new BadRequestException('tenantId query parameter is required');
  }
  this.logger.log(`[CTRL] POST /admin/migrate-messages — tenantId=${tenantId}`);
  return this.propertyService.migrateMessagesData(tenantId);
}
```

`HttpCode`, `HttpStatus`, `BadRequestException`, `Post`, `Query` are already imported in this controller.

---

## Task 5 — Add `getBookingById` to `ChannexARIService`

**File:** `apps/backend/src/channex/channex-ari.service.ts`

- [ ] **Add the method** after `getPropertyBookings` (do not change any existing code):

```typescript
/**
 * Fetches a single reservation by its Channex booking ID.
 *
 * Uses the same two-path lookup as getPropertyBookings:
 *   1. Flat collection: channex_integrations/{tenantId}/bookings
 *      filtered by channex_booking_id == bookingId
 *   2. Nested fallback: .../properties/{propertyId}/bookings
 *      (historical data path)
 *
 * Returns null when no document is found in either path.
 */
async getBookingById(
  propertyId: string,
  bookingId: string,
  tenantId: string,
): Promise<{ reservation: FirestoreReservationDoc; propertyChannelCode: string | null } | null> {
  const db = this.firebase.getFirestore();

  // ── Resolve property channel code (same pattern as getPropertyBookings) ──
  const propertyDocSnap = await db
    .collection(INTEGRATIONS_COLLECTION)
    .doc(tenantId)
    .collection('properties')
    .doc(propertyId)
    .get();

  const channexChannelId =
    (propertyDocSnap.data()?.channex_channel_id as string | null) ?? null;

  let propertyChannelCode: string | null = null;

  if (channexChannelId) {
    const channelDocSnap = await db
      .collection(INTEGRATIONS_COLLECTION)
      .doc(tenantId)
      .collection('channels')
      .doc(channexChannelId)
      .get();

    propertyChannelCode =
      (channelDocSnap.data()?.channel_code as string | null) ?? null;
  }

  // ── 1. Flat collection ────────────────────────────────────────────────────
  const flatSnap = await db
    .collection(INTEGRATIONS_COLLECTION)
    .doc(tenantId)
    .collection('bookings')
    .where('channex_booking_id', '==', bookingId)
    .limit(1)
    .get();

  if (!flatSnap.empty) {
    const reservation = {
      ...flatSnap.docs[0].data(),
      id: flatSnap.docs[0].id,
    } as unknown as FirestoreReservationDoc;

    this.logger.log(
      `[ARI] getBookingById (flat) — bookingId=${bookingId} found`,
    );
    return { reservation, propertyChannelCode };
  }

  // ── 2. Nested fallback ────────────────────────────────────────────────────
  const nestedSnap = await db
    .collection(INTEGRATIONS_COLLECTION)
    .doc(tenantId)
    .collection('properties')
    .doc(propertyId)
    .collection('bookings')
    .where('channex_booking_id', '==', bookingId)
    .limit(1)
    .get();

  if (!nestedSnap.empty) {
    const reservation = {
      ...nestedSnap.docs[0].data(),
      id: nestedSnap.docs[0].id,
    } as unknown as FirestoreReservationDoc;

    this.logger.log(
      `[ARI] getBookingById (nested) — bookingId=${bookingId} found`,
    );
    return { reservation, propertyChannelCode };
  }

  this.logger.log(`[ARI] getBookingById — bookingId=${bookingId} not found`);
  return null;
}
```

`INTEGRATIONS_COLLECTION` and `FirestoreReservationDoc` are already defined in this file.

---

## Task 6 — Add `GET bookings/:bookingId` route to `ChannexARIController`

**File:** `apps/backend/src/channex/channex-ari.controller.ts`

- [ ] **Step 1: Add `NotFoundException` to the `@nestjs/common` import** (if not already present):

Find the `@nestjs/common` import and add `NotFoundException`:
```typescript
import {
  // ... existing imports ...
  NotFoundException,
} from '@nestjs/common';
```

- [ ] **Step 2: Add the route** immediately after the `getPropertyBookings` method:

```typescript
/**
 * GET /channex/properties/:propertyId/bookings/:bookingId?tenantId=X
 *
 * Returns a single reservation by its Channex booking ID, plus the OTA
 * channel code for the property. Used by the Messages inbox to open the
 * ReservationDetailModal from the chat header.
 *
 * Returns 404 if no booking is found in flat or nested Firestore paths.
 */
@Get('bookings/:bookingId')
async getBookingById(
  @Param('propertyId') propertyId: string,
  @Param('bookingId') bookingId: string,
  @Query('tenantId') tenantId: string,
): Promise<{ reservation: FirestoreReservationDoc; propertyChannelCode: string | null }> {
  this.logger.log(
    `[CTRL] GET /bookings/${bookingId} — propertyId=${propertyId} tenantId=${tenantId}`,
  );

  const result = await this.ariService.getBookingById(propertyId, bookingId, tenantId);

  if (!result) {
    throw new NotFoundException(`Booking ${bookingId} not found for propertyId=${propertyId}`);
  }

  return result;
}
```

Note: `@Get('bookings/:bookingId')` must be placed AFTER `@Get('bookings')` and before any more-specific `bookings/` sub-routes to avoid NestJS route shadowing issues. `this.ariService` is already injected.

---

## Task 7 — Add `getBookingById` to the frontend API client

**File:** `apps/frontend/src/channex/api/channexHubApi.ts`

- [ ] **Add the function** immediately after `getPropertyBookings`:

```typescript
export async function getBookingById(
  propertyId: string,
  bookingId: string,
  tenantId: string,
): Promise<{ reservation: Reservation; propertyChannelCode: string | null }> {
  const params = new URLSearchParams({ tenantId });
  return apiFetch(
    `${BASE}/properties/${encodeURIComponent(propertyId)}/bookings/${encodeURIComponent(bookingId)}?${params}`,
  );
}
```

`Reservation` and `apiFetch` are already defined in this file. `BASE = '/api/channex'` is already declared.

---

## Task 8 — Update `MessagesInbox.tsx` with booking button and modal

**File:** `apps/frontend/src/channex/components/shared/MessagesInbox.tsx`

- [ ] **Step 1: Add imports** at the top of the file (after the existing imports):

```typescript
import ReservationDetailModal from './ReservationDetailModal';
import { getBookingById } from '../../api/channexHubApi';
import type { Reservation } from '../../api/channexHubApi';
```

- [ ] **Step 2: Add state and handler inside `ConversationPane`**, after the existing `useState`/`useRef` declarations:

```typescript
const [reservationStatus, setReservationStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
const [reservation, setReservation] = useState<Reservation | null>(null);
const [propertyChannelCode, setPropertyChannelCode] = useState<string | null>(null);
const [reservationError, setReservationError] = useState<string | null>(null);

const handleOpenBooking = useCallback(async () => {
  if (!thread.bookingId) return;
  setReservationStatus('loading');
  setReservationError(null);
  try {
    const result = await getBookingById(thread.propertyId, thread.bookingId, tenantId);
    setReservation(result.reservation);
    setPropertyChannelCode(result.propertyChannelCode);
    setReservationStatus('loaded');
  } catch (err) {
    setReservationError(err instanceof Error ? err.message : t('channex.messages.err.send'));
    setReservationStatus('error');
  }
}, [thread.bookingId, thread.propertyId, tenantId, t]);
```

- [ ] **Step 3: Replace the thread header JSX** inside `ConversationPane`. Find:

```tsx
{/* Thread header */}
<div className="shrink-0 border-b border-edge px-4 py-3">
  <p className="text-sm font-semibold text-content">{thread.guestName}</p>
  {thread.isInquiry ? (
    <p className="text-xs text-notice-text mt-0.5">
      {t('channex.messages.inquiry')} · {thread.checkinDate ?? '—'} → {thread.checkoutDate ?? '—'}
    </p>
  ) : null}
  {thread.listingName && (
    <p className="text-xs text-content-3 mt-0.5">{thread.listingName}</p>
  )}
</div>
```

Replace with:
```tsx
{/* Thread header */}
<div className="shrink-0 border-b border-edge px-4 py-3">
  <div className="flex items-start justify-between gap-3">
    <div className="min-w-0">
      <p className="text-sm font-semibold text-content truncate">{thread.guestName}</p>
      {thread.isInquiry ? (
        <p className="text-xs text-notice-text mt-0.5">
          {t('channex.messages.inquiry')} · {thread.checkinDate ?? '—'} → {thread.checkoutDate ?? '—'}
        </p>
      ) : null}
      {thread.listingName && (
        <p className="text-xs text-content-3 mt-0.5 truncate">{thread.listingName}</p>
      )}
    </div>
    {thread.bookingId && (
      <button
        type="button"
        disabled={reservationStatus === 'loading'}
        onClick={() => void handleOpenBooking()}
        className="shrink-0 rounded-lg border border-edge bg-surface px-3 py-1.5 text-xs font-medium text-content-2 hover:border-brand-light hover:text-brand transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {reservationStatus === 'loading' ? '…' : 'Ver Reserva'}
      </button>
    )}
  </div>
  {reservationStatus === 'error' && reservationError && (
    <p className="mt-1 text-xs text-danger-text">{reservationError}</p>
  )}
</div>
```

- [ ] **Step 4: Add the modal render** at the very end of the `ConversationPane` return, just before the closing `</div>` of the outer `flex flex-col` container:

```tsx
{reservationStatus === 'loaded' && reservation && (
  <ReservationDetailModal
    reservation={reservation}
    tenantId={tenantId}
    propertyChannelCode={propertyChannelCode}
    onClose={() => {
      setReservationStatus('idle');
      setReservation(null);
    }}
  />
)}
```

The full return of `ConversationPane` should look like:
```tsx
return (
  <div className="flex flex-col h-full min-h-0">
    {/* Thread header — now with Ver Reserva button */}
    ...
    {/* Message list */}
    ...
    {/* Reply composer */}
    ...
    {/* Reservation detail modal (portal-style, rendered inside this tree) */}
    {reservationStatus === 'loaded' && reservation && (
      <ReservationDetailModal
        reservation={reservation}
        tenantId={tenantId}
        propertyChannelCode={propertyChannelCode}
        onClose={() => {
          setReservationStatus('idle');
          setReservation(null);
        }}
      />
    )}
  </div>
);
```

---

## Task 9 — Run the historical data migration (one-time)

After the backend is running with the new code deployed, trigger the migration once for each tenant with existing data.

- [ ] Call the migration endpoint (replace `YOUR_TENANT_ID` with the actual Firestore document ID):

```bash
curl -X POST "http://localhost:3001/api/channex/properties/admin/migrate-messages?tenantId=YOUR_TENANT_ID"
```

Expected response:
```json
{ "threadsRepaired": 3, "messagesNormalized": 5 }
```

Check the backend logs for `[MIGRATE]` lines confirming which threads and messages were updated. The endpoint is idempotent — running it again after a successful run should return `{ "threadsRepaired": 0, "messagesNormalized": 0 }`.

---

## Self-Review Checklist

- **Spec §2-A (sender normalization):** Task 1 creates the util; Task 2 applies it in the worker. ✓
- **Spec §2-B (guestName conditional):** Task 2 Step 3 makes the thread patch conditional. ✓
- **Spec §3 (migration):** Tasks 3–4 implement and expose the migration endpoint. ✓
- **Spec §4 (getBookingById endpoint):** Tasks 5–6 add the service method and controller route. ✓
- **Spec §4 (404 on not found):** Task 6 throws `NotFoundException` when result is null. ✓
- **Spec feature (booking button):** Tasks 7–8 add the API client function and wire the UI. ✓
- **Spec edge case (no bookingId → button hidden):** Task 8 Step 3 wraps button in `{thread.bookingId && ...}`. ✓
- **Spec edge case (error state):** Task 8 Step 3 renders `reservationError` below the header. ✓
- **Spec §7 (dark mode):** Button uses `border-edge`, `bg-surface`, `text-content-2` tokens. ✓
- **Route ordering:** `admin/migrate-messages` must be placed before `:propertyId` dynamic routes — Task 4 instructs this explicitly. ✓
- **`normalizeSender` consistency:** same function imported from same util path in Tasks 2 and 3. ✓
- **No placeholders:** All code blocks are complete and directly usable. ✓

# Design Spec: Messages Inbox — Alignment Fix, Guest Name Repair & Booking Details Button

**Date:** 2026-05-19  
**Status:** Approved  
**Scope:** `MessagesInbox` (Channex tab), `channex-message.worker.ts`, `channex-ari.service.ts`, `channex-property.controller.ts`

---

## 1. Context

The **Mensajes** tab inside PropertyDetail shows a two-column inbox: thread list on the left,
conversation pane on the right. Three problems were confirmed from a live screenshot:

| # | Symptom | Root cause |
|---|---------|------------|
| 1 | All messages appear on the **left** regardless of who sent them | `sender` values from Channex webhooks are not always `'host'` — OTA-specific variants (`'property_manager'`, `'traveller'`, etc.) are stored verbatim and the frontend only checks `=== 'host'` |
| 2 | Thread list shows **"Unknown Guest"** for all conversations | The message worker overwrites `guestName` on the thread doc for every message event, including cases where `meta.name` is absent (host echoes). The correct name written by a prior inquiry event is wiped |
| 3 | No way to see **booking details** from the chat panel | Not yet built |

Both bugs 1 and 2 affect **existing data** in Firestore and require a one-time migration in
addition to the forward-looking fix in the worker.

---

## 2. Decisions

### 2-A  Sender normalization — backend worker (Bug 1)

A `normalizeSender(raw: string): 'host' | 'guest'` helper is introduced inside
`channex-message.worker.ts`. It maps every known host-side value to `'host'` and
defaults everything else to `'guest'`.

```
HOST_SENDER_VALUES = { 'host', 'property_manager', 'host_user', 'owner', 'property' }
```

The raw `sender` from the Channex payload is replaced with the canonical value before the
Firestore `batch.set()` for the message document. Historical message documents are repaired
by the migration endpoint (§3).

**Why backend, not frontend:** data already in Firestore would not benefit from a frontend
change. Normalising at write time is the single-source fix and prevents drift.

### 2-B  guestName conditional update — backend worker (Bug 2)

The thread batch update currently always includes `guestName`, even when the resolved value
is `'Unknown Guest'`. The fix: only include `guestName` in the thread `batch.set()` when
the extracted `meta.name` is a non-empty string that is not the fallback literal.

```typescript
// Before (always overwrites)
batch.set(threadRef, { guestName, ... }, { merge: true });

// After (only writes when a real name is available)
const threadPatch: Record<string, unknown> = { ... /* all other fields */ };
if (guestName !== 'Unknown Guest') threadPatch.guestName = guestName;
batch.set(threadRef, threadPatch, { merge: true });
```

**Historical repair:** threads with `guestName === 'Unknown Guest'` are repaired by the
migration endpoint, which uses whichever of these sources is first available:
1. `thread.bookingDetails.guest_name` (stored for inquiry events)
2. The first `guestName` value found across the thread's message sub-documents that is not
   `'Unknown Guest'`

### 2-C  Booking details button — fetch on click (Bug 3 / new feature)

A "Ver Reserva" button appears in the `ConversationPane` header **only when
`thread.bookingId !== null`**. On click:

1. A loading spinner replaces the button label.
2. `GET /api/channex/properties/:propertyId/bookings/:bookingId?tenantId=X` is called.
3. On success, the existing `ReservationDetailModal` opens with the full `Reservation`
   object and `propertyChannelCode`.
4. On error, an inline error message appears below the header; the button remains clickable
   for retry.

`ReservationDetailModal` is already used in `ReservationsPanel` and is reused as-is with
no changes to its interface.

---

## 3. Migration endpoint

**Route:** `POST /api/channex/admin/migrate-messages?tenantId=X`

Scoped to one tenant at a time to limit blast radius. No body required.

### Algorithm

```
For each property in channex_integrations/{tenantId}/properties:
  For each thread in .../threads:
    // Phase 1 — repair guestName
    if thread.guestName === 'Unknown Guest':
      name = thread.bookingDetails?.guest_name
            ?? first message.guestName !== 'Unknown Guest'
            ?? null
      if name: update thread { guestName: name }

    // Phase 2 — normalize sender in messages
    For each message in .../threads/{threadId}/messages:
      normalized = normalizeSender(message.sender)
      if normalized !== message.sender:
        update message { sender: normalized }
```

Returns: `{ threadsRepaired: number, messagesNormalized: number }`

The same `normalizeSender` function from the worker is extracted to a shared util so both
the worker and the migration use identical logic.

**Access control:** The endpoint is prefixed `/admin/` and guarded by the existing
`FirebaseAuthGuard`. It is intended to be called once from Postman / curl after deployment.

---

## 4. New backend endpoint — getBookingById

**Route:** `GET /api/channex/properties/:propertyId/bookings/:bookingId?tenantId=X`

Implemented in `ChannexAriService.getBookingById()`. Uses the same two-path lookup
already present in `getPropertyBookings`:

1. Flat collection: `channex_integrations/{tenantId}/bookings` where
   `channex_booking_id == bookingId`
2. Nested fallback: `.../properties/{propertyId}/bookings` where
   `channex_booking_id == bookingId`

Returns: `{ reservation: Reservation; propertyChannelCode: string | null }`  
Returns 404 if no document is found in either path.

`propertyChannelCode` is resolved via the same channel-code logic already in
`getPropertyBookings` (property doc → channex_channel_id → channels collection).

---

## 5. Architecture — data flow

```
Channex webhook (any sender value)
  │
  ▼
channex-message.worker.ts
  ├─ normalizeSender(raw) → 'host' | 'guest'         ← Bug 1 fix
  ├─ batch.set(messageRef, { sender: normalized })
  └─ conditional guestName in threadPatch             ← Bug 2 fix

Frontend MessagesInbox
  ├─ ConversationPane
  │   ├─ msg.sender === 'host' → justify-end (right, green)
  │   ├─ msg.sender === 'guest' → justify-start (left, grey)
  │   └─ "Ver Reserva" button (when thread.bookingId != null)
  │       ├─ onClick → GET /bookings/:bookingId
  │       └─ onSuccess → <ReservationDetailModal reservation={...} />
  └─ thread.guestName (never 'Unknown Guest' after fix + migration)
```

---

## 6. File-by-file changes

### Backend

| File | Change |
|------|--------|
| `channex-message.worker.ts` | Extract `normalizeSender()` util; apply to `sender`; make `guestName` conditional in thread batch |
| `channex-ari.service.ts` | Add `getBookingById(propertyId, bookingId, tenantId)` |
| `channex-ari.controller.ts` | Add `GET :propertyId/bookings/:bookingId` route |
| `channex-property.controller.ts` | Add `POST admin/migrate-messages` route |
| `channex-property.service.ts` | Add `migrateMessagesData(tenantId)` using `normalizeSender` shared util |

### Frontend

| File | Change |
|------|--------|
| `channexHubApi.ts` | Add `getBookingById(propertyId, bookingId, tenantId)` |
| `MessagesInbox.tsx` | `ConversationPane`: add booking button + `useState` for reservation + modal render |

---

## 7. Constraints & edge cases

- **Thread with `bookingId: null`**: button is not rendered; no API call is made.
- **Booking not found (404)**: button shows inline error "Reserva no encontrada" and remains
  clickable.
- **Inquiry-only thread** (`isInquiry: true`, no booking yet): `bookingId` is null so
  button is hidden; all inquiry-level info is already in the thread header.
- **Migration concurrency**: the migration runs read → conditional write per document.
  It is not transactional, so a concurrent webhook delivering a new `'Unknown Guest'` name
  could race. Acceptable for a one-time migration; the forward-looking worker fix prevents
  any recurrence.
- **Dark mode**: `ConversationPane` uses existing design tokens (`bg-brand`, `bg-surface-subtle`,
  `text-content`, `border-edge`) already compatible with light/dark theme. The new button
  uses `Button` component from the shared UI library, inheriting the same token compliance.
- **normalizeSender shared util location**: `apps/backend/src/channex/utils/normalize-sender.ts`
  — imported by both the worker and the migration service.

---

## 8. Out of scope

- Optimistic Firestore write when the host sends a reply (separate concern; the controller
  JSDoc mentions it as future work).
- Changing the `ChannexThread` type to store a pre-resolved `isHost` boolean in Firestore
  — the normalized `sender: 'host' | 'guest'` field already serves this purpose.
- Any UI changes to `ReservationDetailModal` itself.

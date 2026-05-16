# Load Future Reservations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /channex/properties/:propertyId/load-reservations` so hosts can manually pull existing OTA reservations into the app, and surface an "Import Past Reservations" button in both the Airbnb and Booking.com empty reservation states.

**Architecture:** A new `triggerLoadReservations` method on `ChannexSyncService` resolves the channel ID from Firestore and delegates to the already-existing `ChannexService.loadFutureReservations`. The controller exposes this as a single endpoint. Both frontend reservation components import `loadReservations` from the canonical `channexApi.ts` and render the button only in their empty states.

**Tech Stack:** NestJS (backend), React + Tailwind (frontend), Firestore collectionGroup query, existing `ChannexService.loadFutureReservations`.

---

## File Map

| Action | File |
|--------|------|
| Modify | `apps/backend/src/channex/channex-sync.service.ts` |
| Modify | `apps/backend/src/channex/channex-property.controller.ts` |
| Modify | `apps/frontend/src/airbnb/api/channexApi.ts` |
| Modify | `apps/frontend/src/integrations/booking/components/BookingReservations.tsx` |
| Modify | `apps/frontend/src/integrations/airbnb/components/DetailedReservationsView.tsx` |

---

## Task 1: Backend — `triggerLoadReservations` on `ChannexSyncService`

**Files:**
- Modify: `apps/backend/src/channex/channex-sync.service.ts`

- [ ] **Step 1: Locate the insertion point**

Open `apps/backend/src/channex/channex-sync.service.ts`. Find the `checkConnectionHealth` method (around line 676). The new public method goes directly **above** it, inside the `ChannexSyncService` class, after the existing public methods.

- [ ] **Step 2: Add the `triggerLoadReservations` method**

Insert this block between the closing brace of `commitMapping` (around line 659) and `checkConnectionHealth`:

```typescript
  /**
   * POST /channex/properties/:propertyId/load-reservations
   *
   * Triggers Channex to replay all future OTA reservations for the channel
   * linked to this property as booking_new webhook events.
   *
   * Resolves the channel_id from Firestore — works for both Airbnb and BDC
   * properties since both are stored under channex_integrations/.../properties/.
   *
   * Non-fatal: if Channex rejects the request, loadFutureReservations logs the
   * error internally and this method still returns { status: 'triggered' }.
   * A 404 is thrown only when the Firestore doc or channel_id is missing.
   */
  async triggerLoadReservations(propertyId: string): Promise<{ status: string }> {
    this.logger.log(
      `[LOAD-RESERVATIONS] Triggered — propertyId=${propertyId}`,
    );

    const db = this.firebase.getFirestore();
    const snap = await db
      .collectionGroup('properties')
      .where('channex_property_id', '==', propertyId)
      .limit(1)
      .get();

    if (snap.empty) {
      throw new NotFoundException(
        `No integration document found for Channex property ID: ${propertyId}`,
      );
    }

    const channelId = snap.docs[0].data().channex_channel_id as string | undefined;

    if (!channelId) {
      throw new NotFoundException(
        `No OTA channel connected yet for property: ${propertyId}. Complete the OAuth flow first.`,
      );
    }

    await this.channex.loadFutureReservations(channelId);

    this.logger.log(
      `[LOAD-RESERVATIONS] ✓ Pull triggered — propertyId=${propertyId} channelId=${channelId}`,
    );

    return { status: 'triggered' };
  }
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/backend && pnpm exec tsc --noEmit
```

Expected: no errors. If `NotFoundException` is not imported, add it to the existing NestJS import at the top of the file — it is already imported (used in `checkConnectionHealth`).

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/channex/channex-sync.service.ts
git commit -m "feat(channex): add triggerLoadReservations to ChannexSyncService"
```

---

## Task 2: Backend — `POST /:propertyId/load-reservations` endpoint

**Files:**
- Modify: `apps/backend/src/channex/channex-property.controller.ts`

- [ ] **Step 1: Add the endpoint**

Open `apps/backend/src/channex/channex-property.controller.ts`. Find the `softDelete` handler (last method in the class). Insert this new handler **before** `softDelete`:

```typescript
  /**
   * POST /channex/properties/:propertyId/load-reservations
   *
   * Triggers Channex to replay existing future OTA reservations for this
   * property as booking_new webhook events. Idempotent — safe to call multiple
   * times. Always returns 200 { status: 'triggered' } unless the property is
   * not found in Firestore.
   *
   * Body:    none
   * Returns: { status: 'triggered' }
   * Status:  200 OK
   *
   * Possible errors:
   *   404 Not Found — property has no Firestore doc or no channel connected yet
   */
  @Post(':propertyId/load-reservations')
  @HttpCode(HttpStatus.OK)
  async loadReservations(
    @Param('propertyId') propertyId: string,
  ): Promise<{ status: string }> {
    this.logger.log(
      `[CTRL] POST /channex/properties/${propertyId}/load-reservations`,
    );

    return this.syncService.triggerLoadReservations(propertyId);
  }
```

`HttpStatus` and `HttpCode` are already imported. `@Post` and `@Param` are already imported. `this.syncService` is already injected (`ChannexSyncService`).

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/backend && pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Start the backend and smoke-test the endpoint**

```bash
# Terminal 1 — start backend
pnpm --filter @migo-uit/backend dev

# Terminal 2 — happy path (replace with a real propertyId from Firestore)
curl -s -X POST http://localhost:3001/channex/properties/REAL_PROPERTY_ID/load-reservations | jq .
# Expected: { "status": "triggered" }

# 404 path — non-existent propertyId
curl -s -X POST http://localhost:3001/channex/properties/does-not-exist/load-reservations | jq .
# Expected: { "statusCode": 404, "message": "No integration document found..." }
```

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/channex/channex-property.controller.ts
git commit -m "feat(channex): expose POST /channex/properties/:id/load-reservations"
```

---

## Task 3: Frontend — `loadReservations` in `channexApi.ts`

**Files:**
- Modify: `apps/frontend/src/airbnb/api/channexApi.ts`

- [ ] **Step 1: Add the function**

Open `apps/frontend/src/airbnb/api/channexApi.ts`. Find the `// ─── Soft delete` section (near the bottom). Add the following block **after the `deleteProperty` function** and before the `// ─── Auto-Mapping` section:

```typescript
// ─── Reservation sync ─────────────────────────────────────────────────────────

/**
 * POST /api/channex/properties/:propertyId/load-reservations
 *
 * Triggers Channex to replay existing future OTA reservations as booking_new
 * webhook events. Works for both Airbnb and Booking.com properties.
 * Always resolves (non-fatal on the server side) — a resolved promise means
 * the pull was triggered, not necessarily that reservations arrived yet.
 */
export async function loadReservations(propertyId: string): Promise<void> {
  await apiFetch(
    `${BASE}/properties/${encodeURIComponent(propertyId)}/load-reservations`,
    { method: 'POST' },
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/frontend && pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/airbnb/api/channexApi.ts
git commit -m "feat(channex): add loadReservations API function to channexApi"
```

---

## Task 4: Frontend — "Import Past Reservations" button in `BookingReservations.tsx`

**Files:**
- Modify: `apps/frontend/src/integrations/booking/components/BookingReservations.tsx`

- [ ] **Step 1: Add the import**

At the top of `apps/frontend/src/integrations/booking/components/BookingReservations.tsx`, add `loadReservations` to the imports. Currently there are no cross-feature imports, so add a new import line after the existing imports:

```typescript
import { loadReservations } from '../../../airbnb/api/channexApi';
```

- [ ] **Step 2: Add `syncState` local state**

Inside the `BookingReservations` component, after the existing state declarations (`reservations`, `loading`, `error`), add:

```typescript
  const [syncState, setSyncState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);
```

- [ ] **Step 3: Add the handler**

After the `useEffect` block and before the loading/error render guards, add:

```typescript
  const handleLoadReservations = async () => {
    if (!propertyId) return;
    setSyncState('loading');
    setSyncError(null);
    try {
      await loadReservations(propertyId);
      setSyncState('success');
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Import failed. Please try again.');
      setSyncState('error');
    }
  };
```

- [ ] **Step 4: Replace the empty state JSX**

Find the current empty state block (inside the `reservations.length === 0` branch of the table conditional):

```tsx
        <div className="px-6 py-12 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50">
            <svg className="h-6 w-6 text-blue-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 9v7.5" />
            </svg>
          </div>
          <p className="text-sm font-medium text-slate-500">No reservations yet</p>
          <p className="mt-1 text-xs text-slate-400">
            Booking.com reservations will appear here when webhooks are received.
          </p>
        </div>
```

Replace it with:

```tsx
        <div className="px-6 py-12 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50">
            <svg className="h-6 w-6 text-blue-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 9v7.5" />
            </svg>
          </div>
          <p className="text-sm font-medium text-slate-500">No reservations yet</p>
          <p className="mt-1 text-xs text-slate-400">
            Booking.com reservations will appear here when webhooks are received.
          </p>
          {propertyId && (
            <div className="mt-5">
              <p className="mb-3 text-xs text-slate-500">
                Already have reservations on Booking.com? Import them now.
              </p>
              <button
                type="button"
                onClick={() => void handleLoadReservations()}
                disabled={syncState === 'loading'}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {syncState === 'loading' ? (
                  <>
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-blue-500" />
                    Importing…
                  </>
                ) : (
                  'Import Past Reservations'
                )}
              </button>
              {syncState === 'success' && (
                <p className="mt-3 text-xs font-medium text-emerald-600">
                  Import started — reservations will appear here in a few seconds.
                </p>
              )}
              {syncState === 'error' && (
                <p className="mt-3 text-xs font-medium text-red-600">{syncError}</p>
              )}
            </div>
          )}
        </div>
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd apps/frontend && pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/integrations/booking/components/BookingReservations.tsx
git commit -m "feat(booking): add Import Past Reservations button to empty state"
```

---

## Task 5: Frontend — "Import Past Reservations" button in `DetailedReservationsView.tsx`

**Files:**
- Modify: `apps/frontend/src/integrations/airbnb/components/DetailedReservationsView.tsx`

- [ ] **Step 1: Add the import**

At the top of `apps/frontend/src/integrations/airbnb/components/DetailedReservationsView.tsx`, add after the existing imports:

```typescript
import { loadReservations } from '../api/channexApi';
```

(`../api/channexApi` resolves to `apps/frontend/src/integrations/airbnb/api/channexApi.ts`, which re-exports everything from the canonical `apps/frontend/src/airbnb/api/channexApi.ts`.)

- [ ] **Step 2: Add `syncState` local state**

Inside `DetailedReservationsView`, after the existing state declarations (`bookings`, `loading`, `error`), add:

```typescript
  const [syncState, setSyncState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);
```

- [ ] **Step 3: Add the handler**

After the `useEffect` block and before the first conditional return, add:

```typescript
  const handleLoadReservations = async () => {
    if (!activeProperty?.channex_property_id) return;
    setSyncState('loading');
    setSyncError(null);
    try {
      await loadReservations(activeProperty.channex_property_id);
      setSyncState('success');
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Import failed. Please try again.');
      setSyncState('error');
    }
  };
```

- [ ] **Step 4: Replace the empty state early return**

Find the current empty state block (lines ~176–182):

```tsx
  if (bookings.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center text-sm text-slate-500">
        No reservations found for this listing.
      </div>
    );
  }
```

Replace it with:

```tsx
  if (bookings.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center text-sm text-slate-500">
        <p className="font-medium">No reservations found for this listing.</p>
        <p className="mt-1 text-xs text-slate-400">
          Reservations will appear automatically when Channex delivers webhook events.
        </p>
        <div className="mt-5">
          <p className="mb-3 text-xs text-slate-500">
            Already have reservations on Airbnb? Import them now.
          </p>
          <button
            type="button"
            onClick={() => void handleLoadReservations()}
            disabled={syncState === 'loading'}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {syncState === 'loading' ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-rose-500" />
                Importing…
              </>
            ) : (
              'Import Past Reservations'
            )}
          </button>
          {syncState === 'success' && (
            <p className="mt-3 text-xs font-medium text-emerald-600">
              Import started — reservations will appear here in a few seconds.
            </p>
          )}
          {syncState === 'error' && (
            <p className="mt-3 text-xs font-medium text-red-600">{syncError}</p>
          )}
        </div>
      </div>
    );
  }
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd apps/frontend && pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/integrations/airbnb/components/DetailedReservationsView.tsx
git commit -m "feat(airbnb): add Import Past Reservations button to empty state"
```

---

## Task 6: End-to-end verification

- [ ] **Step 1: Start the full stack**

```bash
# From repo root
pnpm dev
```

Backend: `http://localhost:3001`  
Frontend: `https://localhost:5173`

- [ ] **Step 2: Verify backend endpoint**

```bash
# Happy path — use a real channex_property_id from Firestore
curl -s -X POST http://localhost:3001/channex/properties/REAL_PROPERTY_ID/load-reservations | jq .
# Expected: { "status": "triggered" }

# 404 path
curl -s -X POST http://localhost:3001/channex/properties/fake-id-000/load-reservations | jq .
# Expected: { "statusCode": 404, "message": "No integration document found..." }
```

- [ ] **Step 3: Verify Booking.com UI**

1. Navigate to `https://localhost:5173` → Booking.com integration tab → Reservations tab
2. If there are no reservations, verify "Import Past Reservations" button is visible
3. Click the button — verify spinner appears, then success message
4. Verify backend logs show: `[LOAD-RESERVATIONS] ✓ Pull triggered`
5. If there are reservations, temporarily check with browser devtools that `propertyId` is not null (the button renders only when `propertyId` is truthy)

- [ ] **Step 4: Verify Airbnb UI**

1. Navigate to Airbnb integration → select a listing → Reservations tab
2. If there are no reservations, verify "Import Past Reservations" button is visible
3. Click the button — verify spinner and success message
4. Verify backend logs show: `[LOAD-RESERVATIONS] ✓ Pull triggered`

- [ ] **Step 5: Final commit (update plan doc)**

```bash
git add docs/superpowers/plans/2026-05-15-load-future-reservations.md
git commit -m "docs: mark load-future-reservations plan as complete"
```

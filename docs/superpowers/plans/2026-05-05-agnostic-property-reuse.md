# Agnostic Property Reuse — Integration Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before creating a provisional Channex property during Airbnb or Booking.com onboarding, check if one already exists in `channex_integrations/{tenantId}/properties/` — if it does, show the existing property info and skip creation entirely.

**Architecture:** Purely frontend/visual change. `useChannexProperties(tenantId)` already subscribes to the Firestore subcol — if it returns any entries, the wizard shows an `ExistingPropertyCard` (Airbnb) or an info banner (Booking.com) instead of triggering property creation. The backend remains unchanged; group resolution and property reuse are already correct at that layer.

**Tech Stack:** React, TypeScript, Tailwind CSS, `useChannexProperties` hook (already in codebase). No new packages.

---

## File Map

| File | Change |
|------|--------|
| `apps/frontend/src/airbnb/components/ExistingPropertyCard.tsx` | **Create** — card shown when a property already exists, replaces `PropertyProvisioningForm` in PROVISION step |
| `apps/frontend/src/airbnb/AirbnbPage.tsx` | **Modify** — add `useChannexProperties` hook, conditionally render `ExistingPropertyCard` vs `PropertyProvisioningForm` in PROVISION step |
| `apps/frontend/src/integrations/booking/BookingIntegrationView.tsx` | **Modify** — add `useChannexProperties` hook, render existing-property info banner in connection panel when a property exists |

---

## Task 1 — Create `ExistingPropertyCard` component

**Files:**
- Create: `apps/frontend/src/airbnb/components/ExistingPropertyCard.tsx`

- [ ] **Step 1.1: Create the component file**

Create `apps/frontend/src/airbnb/components/ExistingPropertyCard.tsx` with this exact content:

```tsx
import type { ChannexProperty } from '../../channex/hooks/useChannexProperties';

interface Props {
  property: ChannexProperty;
  onContinue: (propertyId: string) => void;
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  pending: 'Pending',
  token_expired: 'Token expired',
  error: 'Error',
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  pending: 'bg-amber-50 border-amber-200 text-amber-700',
  token_expired: 'bg-orange-50 border-orange-200 text-orange-700',
  error: 'bg-red-50 border-red-200 text-red-700',
};

export default function ExistingPropertyCard({ property, onContinue }: Props) {
  const statusColor = STATUS_COLORS[property.connection_status] ?? STATUS_COLORS['pending'];
  const statusLabel = STATUS_LABELS[property.connection_status] ?? property.connection_status;

  return (
    <div className="rounded-2xl border border-emerald-100 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-emerald-50 bg-gradient-to-r from-emerald-50 to-teal-50 px-6 py-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">
          Step 1
        </p>
        <h2 className="mt-1 text-xl font-semibold text-slate-900">Property Setup</h2>
        <p className="mt-1 text-sm text-slate-600">
          Your business already has a Channex property registered.
        </p>
      </div>

      <div className="px-6 py-6 space-y-5">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-800">{property.title}</p>
              <p className="text-xs font-mono text-slate-500 break-all">
                {property.channex_property_id}
              </p>
            </div>
            <span
              className={[
                'shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium',
                statusColor,
              ].join(' ')}
            >
              {statusLabel}
            </span>
          </div>

          <div className="flex flex-wrap gap-4 text-xs text-slate-600">
            <span>
              <span className="font-medium">Currency:</span> {property.currency}
            </span>
            <span>
              <span className="font-medium">Timezone:</span> {property.timezone}
            </span>
            {property.connected_channels.length > 0 && (
              <span>
                <span className="font-medium">Channels:</span>{' '}
                {property.connected_channels.join(', ')}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={() => onContinue(property.channex_property_id)}
            className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-rose-700"
          >
            Continue with this property
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 1.2: Verify TypeScript is happy**

```powershell
cd apps/frontend && pnpm tsc --noEmit 2>&1 | Select-String "ExistingPropertyCard" | Select-Object -First 10
```

Expected: no errors referencing `ExistingPropertyCard`.

- [ ] **Step 1.3: Commit**

```bash
git add apps/frontend/src/airbnb/components/ExistingPropertyCard.tsx
git commit -m "feat(airbnb): add ExistingPropertyCard component for property reuse"
```

---

## Task 2 — Wire `ExistingPropertyCard` into `AirbnbPage` PROVISION step

**Files:**
- Modify: `apps/frontend/src/airbnb/AirbnbPage.tsx`

Context: `AirbnbPage` already has `tenantId` resolved at line 111 via `useRef(resolveTenantId()).current`. The PROVISION step is at line 333–335. We add `useChannexProperties(tenantId)` and render `ExistingPropertyCard` when properties exist, otherwise the original form.

- [ ] **Step 2.1: Add imports to `AirbnbPage.tsx`**

At the top of `apps/frontend/src/airbnb/AirbnbPage.tsx`, after the existing imports (currently ending at line 9), add:

```typescript
import { useChannexProperties } from '../channex/hooks/useChannexProperties';
import ExistingPropertyCard from './components/ExistingPropertyCard';
```

The full import block should now be:

```typescript
import { useState, useEffect, useRef, useCallback } from 'react';
import PropertyProvisioningForm from './components/PropertyProvisioningForm';
import ChannexIFrame from './components/ChannexIFrame';
import ConnectionStatusBadge from './components/ConnectionStatusBadge';
import ReservationInbox from './components/ReservationInbox';
import UnmappedRoomModal, { type UnmappedRoomEventData } from './components/UnmappedRoomModal';
import MappingReviewModal from './components/MappingReviewModal';
import MultiCalendarView from './components/MultiCalendarView';
import { syncStage, type StageSyncResult } from './api/channexApi';
import { useChannexProperties } from '../channex/hooks/useChannexProperties';
import ExistingPropertyCard from './components/ExistingPropertyCard';
```

- [ ] **Step 2.2: Call `useChannexProperties` inside `AirbnbPage`**

In `AirbnbPage`, after line 115 (`const [channexPropertyId, setChannexPropertyId] = useState<string | null>(null);`), add:

```typescript
  // ── Existing properties check ────────────────────────────────────────────────
  const { properties: existingProperties, loading: propertiesLoading } =
    useChannexProperties(tenantId);
```

- [ ] **Step 2.3: Replace the PROVISION step render**

Find this block at line 332–335 in `AirbnbPage.tsx`:

```tsx
        {/* STEP 1: PROVISION */}
        {step === 'PROVISION' && (
          <PropertyProvisioningForm onProvisioned={handleProvisioned} />
        )}
```

Replace it with:

```tsx
        {/* STEP 1: PROVISION */}
        {step === 'PROVISION' && (
          propertiesLoading ? (
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-6 py-8 text-sm text-slate-500">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-rose-500" />
              Loading property information…
            </div>
          ) : existingProperties.length > 0 ? (
            <ExistingPropertyCard
              property={existingProperties[0]}
              onContinue={handleProvisioned}
            />
          ) : (
            <PropertyProvisioningForm onProvisioned={handleProvisioned} />
          )
        )}
```

- [ ] **Step 2.4: Verify frontend compiles**

```powershell
cd apps/frontend && pnpm build 2>&1 | Select-String "error TS" | Select-Object -First 20
```

Expected: no new TypeScript errors (only the pre-existing `BookingIntegrationView.tsx:230` error if still present).

- [ ] **Step 2.5: Commit**

```bash
git add apps/frontend/src/airbnb/AirbnbPage.tsx
git commit -m "feat(airbnb): skip property creation when an existing property is found"
```

---

## Task 3 — Show existing property info in Booking.com connection panel

**Files:**
- Modify: `apps/frontend/src/integrations/booking/BookingIntegrationView.tsx`

Context: The connection panel renders when `viewState` is `idle | opening | popup_open | error` (lines 184–248). We add `useChannexProperties(tenantId)` and if properties exist, show an info banner above the numbered steps. The banner communicates which property will be used — purely informational; the backend already handles reuse.

- [ ] **Step 3.1: Add `useChannexProperties` import**

In `apps/frontend/src/integrations/booking/BookingIntegrationView.tsx`, add to the existing imports after line 11 (`import BookingInbox from './components/BookingInbox';`):

```typescript
import { useChannexProperties } from '../../channex/hooks/useChannexProperties';
```

- [ ] **Step 3.2: Call the hook inside `BookingIntegrationView`**

After line 68 (`const isLocked = viewState === 'opening' || viewState === 'syncing' || isDisconnecting;`), add:

```typescript
  const { properties: existingProperties } = useChannexProperties(tenantId);
  const baseProperty = existingProperties[0] ?? null;
```

- [ ] **Step 3.3: Add existing-property banner inside the connection panel**

Find this block in the connection panel (starts at line 193):

```tsx
          <ol className="mt-4 space-y-2 text-sm leading-6 text-slate-600">
```

Insert the existing-property banner immediately **before** that `<ol>`:

```tsx
          {baseProperty && (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
              <p className="font-semibold text-emerald-800">
                Existing property detected
              </p>
              <p className="mt-0.5 text-emerald-700">
                We'll connect Booking.com to:{' '}
                <span className="font-medium">{baseProperty.title}</span>
              </p>
              <p className="mt-0.5 font-mono text-xs text-emerald-600 break-all">
                {baseProperty.channex_property_id}
              </p>
            </div>
          )}

          <ol className="mt-4 space-y-2 text-sm leading-6 text-slate-600">
```

- [ ] **Step 3.4: Verify frontend compiles**

```powershell
cd apps/frontend && pnpm build 2>&1 | Select-String "error TS" | Select-Object -First 20
```

Expected: no new TypeScript errors.

- [ ] **Step 3.5: Commit**

```bash
git add apps/frontend/src/integrations/booking/BookingIntegrationView.tsx
git commit -m "feat(booking): show existing property info in connection panel before onboarding"
```

---

## Task 4 — Final build verification

- [ ] **Step 4.1: Full build — both apps**

```powershell
cd "D:\migo\repos\WhatsApp Multi sign up demo"
pnpm --filter @migo-uit/backend build 2>&1 | Select-String "error TS|error:" | Select-Object -First 20
pnpm --filter @migo-uit/frontend build 2>&1 | Select-String "error TS" | Select-Object -First 20
```

Expected: backend clean; frontend no new errors.

- [ ] **Step 4.2: Smoke-test checklist (dev server)**

```powershell
pnpm dev
```

Open the browser and verify:

1. **Airbnb wizard — no existing property**: Navigate to `/airbnb?tenantId=fresh-tenant`. PROVISION step shows the `PropertyProvisioningForm` (creation form with Title, Currency, Timezone, Property Type fields).

2. **Airbnb wizard — existing property**: Navigate to `/airbnb?tenantId=<tenantId with a property in Firestore>`. PROVISION step shows `ExistingPropertyCard` with the property title, ID, and currency/timezone. Clicking "Continue with this property →" advances to CONNECT step without calling `provisionProperty`.

3. **Booking.com — existing property**: Open the Booking.com integration panel for a tenant that already has a property. In the connection panel, the emerald "Existing property detected" banner appears above the numbered steps, showing the property name and ID.

4. **Booking.com — no existing property**: For a fresh tenant, the connection panel shows no banner — only the numbered steps as before.

- [ ] **Step 4.3: Verify git log**

```bash
git log --oneline -5
```

Expected:
```
feat(booking): show existing property info in connection panel before onboarding
feat(airbnb): skip property creation when an existing property is found
feat(airbnb): add ExistingPropertyCard component for property reuse
```

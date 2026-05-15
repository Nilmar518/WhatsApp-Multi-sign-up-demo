# Pool Calibration & Edit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a recalibrate endpoint, a sync-mismatch suggestion modal, an "Adjust capacity" button, and full pool editing (from list and detail views).

**Architecture:** New backend `recalibrate` method + endpoint; two new frontend components (`PoolSyncModal`, `PoolEditModal`); wire both into `PoolDetail` and `PoolsList`.

**Tech Stack:** NestJS backend, React + TypeScript frontend, localStorage for modal dismiss state.

**Do NOT make any git commits.**

---

## Context for the implementer

Monorepo at `D:\migo\repos\WhatsApp Multi sign up demo`. Backend at `apps/backend`, frontend at `apps/frontend`.

**Key existing files:**
- `apps/backend/src/migo-property/migo-property.service.ts` — `MigoPropertyDoc`, `PlatformConnection` (has `count_of_rooms?: number`), `resetAvailability()` method as reference
- `apps/backend/src/migo-property/migo-property.controller.ts` — existing endpoints, `POST :id/availability/reset` as reference
- `apps/frontend/src/channex/api/migoPropertyApi.ts` — fetch wrappers, `resetAvailability()` function as reference
- `apps/frontend/src/channex/components/pools/PoolDetail.tsx` — header has AvailabilityBadge + "Reset to full" button
- `apps/frontend/src/channex/components/pools/PoolsList.tsx` — pool cards rendered as `<button>` elements
- `apps/frontend/src/channex/components/ui/Button` — button component at `apps/frontend/src/components/ui/Button`
- `apps/frontend/src/channex/components/ui/Input` — input component at `apps/frontend/src/components/ui/Input`

**`MigoPropertyDoc` shape (relevant fields):**
```typescript
interface MigoPropertyDoc {
  id: string;
  tenant_id: string;
  title: string;
  total_units: number;
  current_availability: number;
  alert_threshold: number;
  platform_connections: PlatformConnection[];
}
interface PlatformConnection {
  platform: string;
  channex_property_id: string;
  listing_title: string;
  is_sync_enabled: boolean;
  count_of_rooms?: number;
}
```

**Recalibrate formula:**
```
new_total = SUM(conn.count_of_rooms ?? 0 for all platform_connections)
occupied  = Math.max(0, doc.total_units - doc.current_availability)
new_avail = Math.max(0, new_total - occupied)
```
If `new_total === 0` → return doc unchanged (no write).

---

### Task 1: Backend — `recalibrateAvailability()` + endpoint

**Files:**
- Modify: `apps/backend/src/migo-property/migo-property.service.ts`
- Modify: `apps/backend/src/migo-property/migo-property.controller.ts`

---

- [ ] **Step 1: Read both files**

Read `migo-property.service.ts` and `migo-property.controller.ts` in full.

---

- [ ] **Step 2: Add `recalibrateAvailability()` to service**

Add this method after `resetAvailability()`:

```typescript
async recalibrateAvailability(migoPropertyId: string): Promise<MigoPropertyDoc> {
  const doc = await this.getPropertyType(migoPropertyId);

  const newTotal = doc.platform_connections.reduce(
    (sum, c) => sum + (c.count_of_rooms ?? 0),
    0,
  );

  if (newTotal === 0) {
    this.logger.warn(
      `[MIGO-PROPERTY] recalibrateAvailability — no room count on connections, skipping write: ${migoPropertyId}`,
    );
    return doc;
  }

  const occupied = Math.max(0, doc.total_units - doc.current_availability);
  const newAvail = Math.max(0, newTotal - occupied);
  const now = new Date().toISOString();

  const db = this.firebase.getFirestore();
  await this.firebase.update(db.collection(COLLECTION).doc(migoPropertyId), {
    total_units: newTotal,
    current_availability: newAvail,
    updated_at: now,
  });

  this.logger.log(
    `[MIGO-PROPERTY] recalibrateAvailability — id=${migoPropertyId} ` +
      `total_units=${newTotal} current_availability=${newAvail} occupied=${occupied}`,
  );

  return { ...doc, total_units: newTotal, current_availability: newAvail, updated_at: now };
}
```

---

- [ ] **Step 3: Add endpoint to controller**

After the `POST ':id/availability/reset'` endpoint, add:

```typescript
@Post(':id/availability/recalibrate')
@HttpCode(HttpStatus.OK)
async recalibrate(@Param('id') id: string): Promise<MigoPropertyDoc> {
  this.logger.log(`[CTRL] POST /migo-properties/${id}/availability/recalibrate`);
  return this.migoPropertyService.recalibrateAvailability(id);
}
```

---

- [ ] **Step 4: Build verification**

```bash
pnpm --filter @migo-uit/backend build
```

Expected: exit code 0.

---

### Task 2: Frontend — API function + `PoolEditModal`

**Files:**
- Modify: `apps/frontend/src/channex/api/migoPropertyApi.ts`
- Create: `apps/frontend/src/channex/components/pools/PoolEditModal.tsx`

---

- [ ] **Step 1: Read migoPropertyApi.ts**

Read the file to understand the fetch pattern before adding.

---

- [ ] **Step 2: Add `recalibrateAvailability()` to migoPropertyApi.ts**

After `resetAvailability()`, add:

```typescript
export function recalibrateAvailability(id: string): Promise<MigoProperty> {
  return apiFetch(`${BASE}/${encodeURIComponent(id)}/availability/recalibrate`, {
    method: 'POST',
  });
}
```

---

- [ ] **Step 3: Create `PoolEditModal.tsx`**

Create `apps/frontend/src/channex/components/pools/PoolEditModal.tsx`:

```tsx
import { useState } from 'react';
import Button from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { updateMigoProperty, type MigoProperty } from '../../api/migoPropertyApi';

interface Props {
  pool: MigoProperty;
  onSaved: (updated: MigoProperty) => void;
  onClose: () => void;
}

export default function PoolEditModal({ pool, onSaved, onClose }: Props) {
  const [title, setTitle] = useState(pool.title);
  const [alertThreshold, setAlertThreshold] = useState(String(pool.alert_threshold));
  const [totalUnits, setTotalUnits] = useState(String(pool.total_units));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('Pool name is required.');
      return;
    }
    const units = parseInt(totalUnits, 10);
    const threshold = parseInt(alertThreshold, 10);
    if (isNaN(units) || units < 0) {
      setError('Total units must be 0 or greater.');
      return;
    }
    if (isNaN(threshold) || threshold < 0) {
      setError('Alert threshold must be 0 or greater.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateMigoProperty(pool.id, {
        title: title.trim(),
        alert_threshold: threshold,
        total_units: units,
      });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl border border-edge bg-surface-raised px-6 py-6 shadow-xl">
        <h3 className="mb-5 text-base font-semibold text-content">Edit Pool</h3>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-content-2">
              Pool Name
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-content-2">
              Alert Threshold
            </label>
            <Input
              type="number"
              min={0}
              value={alertThreshold}
              onChange={(e) => setAlertThreshold(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-content-2">
              Total Units (capacity)
            </label>
            <Input
              type="number"
              min={0}
              value={totalUnits}
              onChange={(e) => setTotalUnits(e.target.value)}
            />
            <p className="mt-1 text-xs text-notice-text">
              Editing this overrides the auto-calculated capacity from connections.
            </p>
          </div>

          {error && <p className="text-sm text-danger-text">{error}</p>}

          <div className="flex gap-3 pt-2">
            <Button type="submit" variant="primary" size="sm" disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

---

- [ ] **Step 4: Build verification**

```bash
pnpm --filter @migo-uit/frontend build
```

Expected: exit code 0.

---

### Task 3: Frontend — `PoolSyncModal`

**Files:**
- Create: `apps/frontend/src/channex/components/pools/PoolSyncModal.tsx`

---

- [ ] **Step 1: Create `PoolSyncModal.tsx`**

Create `apps/frontend/src/channex/components/pools/PoolSyncModal.tsx`:

```tsx
import { useState } from 'react';
import Button from '../../../components/ui/Button';
import { recalibrateAvailability, type MigoProperty } from '../../api/migoPropertyApi';

const DISMISSED_KEY = 'migo-pool-sync-dismissed';

export function isPoolSyncDismissed(): boolean {
  return localStorage.getItem(DISMISSED_KEY) === 'true';
}

interface Props {
  pool: MigoProperty;
  computedTotal: number;
  onCalibrated: (updated: MigoProperty) => void;
  onClose: () => void;
}

export default function PoolSyncModal({ pool, computedTotal, onCalibrated, onClose }: Props) {
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const occupied = Math.max(0, pool.total_units - pool.current_availability);
  const newAvail = Math.max(0, computedTotal - occupied);

  function handleDismiss() {
    if (dontShowAgain) {
      localStorage.setItem(DISMISSED_KEY, 'true');
    }
    onClose();
  }

  async function handleAdjust() {
    setAdjusting(true);
    setError(null);
    try {
      const updated = await recalibrateAvailability(pool.id);
      if (dontShowAgain) {
        localStorage.setItem(DISMISSED_KEY, 'true');
      }
      onCalibrated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Adjustment failed');
    } finally {
      setAdjusting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-edge bg-surface-raised px-6 py-6 shadow-xl">
        <h3 className="mb-2 text-base font-semibold text-content">Pool capacity mismatch</h3>
        <p className="text-sm text-content-2 mb-4">
          Your connected properties sum to{' '}
          <strong className="text-content">{computedTotal} unit{computedTotal !== 1 ? 's' : ''}</strong>,
          but the pool is set to{' '}
          <strong className="text-content">{pool.total_units}</strong>.
        </p>

        <div className="rounded-lg bg-surface px-4 py-3 text-sm mb-4">
          <div className="flex justify-between text-content-2 mb-1">
            <span>Current</span>
            <span className="font-semibold text-content">
              {pool.current_availability} / {pool.total_units}
            </span>
          </div>
          <div className="flex justify-between text-content-2">
            <span>After adjustment</span>
            <span className="font-semibold text-ok-text">
              {newAvail} / {computedTotal}
            </span>
          </div>
        </div>

        {error && <p className="mb-3 text-sm text-danger-text">{error}</p>}

        <div className="flex gap-3 mb-4">
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleAdjust}
            disabled={adjusting}
          >
            {adjusting ? 'Adjusting…' : `Adjust to ${computedTotal} units`}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={handleDismiss}>
            Dismiss
          </Button>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-content-2">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
            className="h-4 w-4 rounded border-edge accent-brand"
          />
          Don't show this suggestion again
        </label>
      </div>
    </div>
  );
}
```

---

- [ ] **Step 2: Build verification**

```bash
pnpm --filter @migo-uit/frontend build
```

Expected: exit code 0.

---

### Task 4: Frontend — Wire everything into `PoolDetail`

**Files:**
- Modify: `apps/frontend/src/channex/components/pools/PoolDetail.tsx`

---

- [ ] **Step 1: Read the file in full**

Read `apps/frontend/src/channex/components/pools/PoolDetail.tsx`.

---

- [ ] **Step 2: Add imports**

At the top of the file, add these imports alongside the existing ones:

```tsx
import { recalibrateAvailability } from '../../api/migoPropertyApi';
import PoolSyncModal, { isPoolSyncDismissed } from './PoolSyncModal';
import PoolEditModal from './PoolEditModal';
```

---

- [ ] **Step 3: Add state for new features**

In the component body, after the existing `useState` declarations, add:

```tsx
const [calibrating, setCalibrating] = useState(false);
const [calibrateError, setCalibrateError] = useState<string | null>(null);
const [showEdit, setShowEdit] = useState(false);

// Sync modal: compute mismatch and check dismiss state
const computedTotal = pool.platform_connections.reduce(
  (sum, c) => sum + (c.count_of_rooms ?? 0),
  0,
);
const hasMismatch = computedTotal > 0 && pool.total_units !== computedTotal;
const [showSyncModal, setShowSyncModal] = useState(
  hasMismatch && !isPoolSyncDismissed(),
);
```

---

- [ ] **Step 4: Add `handleCalibrate` function**

After `handleReset`, add:

```tsx
async function handleCalibrate() {
  setCalibrating(true);
  setCalibrateError(null);
  try {
    const updated = await recalibrateAvailability(pool.id);
    handleUpdated(updated);
  } catch (err) {
    setCalibrateError(err instanceof Error ? err.message : 'Calibration failed');
  } finally {
    setCalibrating(false);
  }
}
```

---

- [ ] **Step 5: Update the header section**

Replace the current header `<div>` (the one with the pool title, AvailabilityBadge, and "Reset to full" button) with:

```tsx
{/* Header */}
<div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-edge bg-surface-raised px-5 py-4">
  <div>
    <h2 className="text-lg font-semibold text-content">{pool.title}</h2>
    <p className="mt-0.5 text-xs text-content-2 font-mono">{pool.id}</p>
  </div>
  <div className="flex flex-wrap items-center gap-2">
    <AvailabilityBadge pool={pool} />
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleCalibrate}
      disabled={calibrating}
    >
      {calibrating ? 'Adjusting…' : 'Adjust capacity'}
    </Button>
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleReset}
      disabled={resetting}
    >
      {resetting ? 'Resetting…' : 'Reset to full'}
    </Button>
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => setShowEdit(true)}
    >
      Edit
    </Button>
  </div>
  {(resetError || calibrateError) && (
    <p className="w-full text-xs text-danger-text">{resetError ?? calibrateError}</p>
  )}
</div>
```

---

- [ ] **Step 6: Add modals at the bottom of the JSX**

At the end of the return statement, alongside the existing `{showAssign && <AssignConnectionModal ...>}`, add:

```tsx
{showSyncModal && (
  <PoolSyncModal
    pool={pool}
    computedTotal={computedTotal}
    onCalibrated={(updated) => {
      handleUpdated(updated);
      setShowSyncModal(false);
    }}
    onClose={() => setShowSyncModal(false)}
  />
)}

{showEdit && (
  <PoolEditModal
    pool={pool}
    onSaved={(updated) => {
      handleUpdated(updated);
      setShowEdit(false);
    }}
    onClose={() => setShowEdit(false)}
  />
)}
```

---

- [ ] **Step 7: Build verification**

```bash
pnpm --filter @migo-uit/frontend build
```

Expected: exit code 0.

---

### Task 5: Frontend — `PoolsList` edit button per pool card

**Files:**
- Modify: `apps/frontend/src/channex/components/pools/PoolsList.tsx`

---

- [ ] **Step 1: Read the file in full**

Read `apps/frontend/src/channex/components/pools/PoolsList.tsx`.

---

- [ ] **Step 2: Update Props interface to accept `onEdit`**

The current `Props` interface:

```typescript
interface Props {
  pools: MigoProperty[];
  onSelect: (pool: MigoProperty) => void;
  onNew: () => void;
}
```

Change to:

```typescript
interface Props {
  pools: MigoProperty[];
  onSelect: (pool: MigoProperty) => void;
  onNew: () => void;
  onEdit: (pool: MigoProperty) => void;
}
```

---

- [ ] **Step 3: Add edit button to each pool card**

The current pool card is a `<button>` element that calls `onSelect`. We need to add an edit button **inside** the card without making the outer button trigger edit. Use `e.stopPropagation()` on the edit button click.

Replace the pool card mapping:

```tsx
{pools.map((pool) => (
  <div key={pool.id} className="relative group">
    <button
      type="button"
      onClick={() => onSelect(pool)}
      className="w-full rounded-2xl border border-edge bg-surface-raised p-4 text-left transition hover:border-brand-light hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-content group-hover:text-brand">{pool.title}</p>
        <AvailabilityChip pool={pool} />
      </div>

      <p className="mt-1 text-xs text-content-2">
        {pool.platform_connections.length} connection
        {pool.platform_connections.length !== 1 ? 's' : ''}
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {platforms(pool).length === 0 ? (
          <span className="inline-flex items-center rounded-full bg-surface-subtle px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-content-2">
            No platforms
          </span>
        ) : (
          platforms(pool).map((p) => <PlatformBadge key={p} platform={p} />)
        )}
      </div>
    </button>
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onEdit(pool); }}
      className="absolute right-3 top-3 rounded-lg px-2 py-1 text-xs text-content-2 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-surface-subtle hover:text-content"
    >
      Edit
    </button>
  </div>
))}
```

Note: the outer card changes from `<button>` to a `<div className="relative group">` wrapping a `<button>`. The pool card `<button>` loses the `key` prop (it moves to the `<div>`). The edit button is absolutely positioned top-right and only visible on hover.

---

- [ ] **Step 4: Find where `PoolsList` is used and add `onEdit` prop**

Search for `<PoolsList` in the codebase:

```bash
grep -r "PoolsList" apps/frontend/src --include="*.tsx" -l
```

Read the file that uses `PoolsList` and add the `onEdit` prop. The handler should open `PoolEditModal` with the selected pool. The parent likely manages the pool list state, so `onEdit` should open a modal and refresh the pool after save.

In the parent component:
- Add `useState<MigoProperty | null>(null)` for the pool being edited (e.g., `editingPool`)
- Pass `onEdit={(pool) => setEditingPool(pool)}` to `PoolsList`
- Render `{editingPool && <PoolEditModal pool={editingPool} onSaved={(updated) => { /* update pools list */ setEditingPool(null); }} onClose={() => setEditingPool(null)} />}`

---

- [ ] **Step 5: Build verification**

```bash
pnpm --filter @migo-uit/frontend build
```

Expected: exit code 0, no TypeScript errors about missing `onEdit` prop.

---

## End State Verification

After all 5 tasks:

1. `POST /migo-properties/:id/availability/recalibrate` returns the updated pool with `total_units = SUM(count_of_rooms)` and `current_availability = max(0, new_total - occupied)`. If all connections have 0 rooms, returns doc unchanged.
2. `PoolDetail` header has three buttons: **"Adjust capacity"** (calls recalibrate), **"Reset to full"** (existing), **"Edit"** (opens edit modal).
3. On entering any `PoolDetail` where `total_units !== SUM(count_of_rooms)` and the user hasn't globally dismissed — a sync modal appears with the current vs. adjusted values. Clicking "Adjust" calls recalibrate and updates the display. "Don't show again" checkbox on dismiss sets `localStorage['migo-pool-sync-dismissed'] = 'true'`.
4. `PoolEditModal` pre-fills title, alert_threshold, total_units. Saving calls `PATCH /migo-properties/:id`. Shows a warning next to total_units field.
5. Each pool card in `PoolsList` shows an "Edit" button on hover that opens `PoolEditModal` without navigating into the pool.

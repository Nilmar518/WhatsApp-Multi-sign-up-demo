# Pool Calibration & Edit — Design Spec

**Date:** 2026-05-14
**Branch:** feat/messaging-inbox
**Status:** Approved for implementation

---

## Problem

Three gaps remain in pool management after the auto-calculation fix:

1. **Legacy pools** were created with manually-entered `total_units` that doesn't match the actual sum of connected properties' room counts. There is no way to fix this without deleting and recreating the pool.
2. **No recalibration button**: even for correctly-structured pools, there is no UI action to sync `total_units` and `current_availability` to the ground truth derived from connections.
3. **No pool edit**: title and alert threshold cannot be changed after creation.

---

## Features

### Feature 1 — Sync Mismatch Modal

When a user opens any PoolDetail view, the frontend computes:

```
computedTotal = SUM(conn.count_of_rooms ?? 0 for all platform_connections)
```

If `pool.total_units !== computedTotal && computedTotal > 0` **and** the user has not globally dismissed this suggestion → show a modal.

**Modal content:**
- Shows the discrepancy: "Your pool shows X total units, but your connected properties sum to Y."
- Shows the resulting new availability: "Adjusting will change availability from A/X to B/Y." where `B = max(0, Y - (X - A))`.
- **"Adjust to Y units"** button → calls recalibrate endpoint → updates pool → closes modal
- **"Dismiss"** button → closes without adjusting
- **"Don't show this again" checkbox** — when checked at dismiss time, writes `localStorage.setItem('migo-pool-sync-dismissed', 'true')` and never shows again (global, not per-pool)

**Trigger logic (frontend, no API call):**
```typescript
const computedTotal = pool.platform_connections.reduce(
  (sum, c) => sum + (c.count_of_rooms ?? 0), 0
);
const hasMismatch = computedTotal > 0 && pool.total_units !== computedTotal;
const isDismissed = localStorage.getItem('migo-pool-sync-dismissed') === 'true';
const showModal = hasMismatch && !isDismissed;
```

---

### Feature 2 — "Adjust Capacity" Button

In `PoolDetail` header, alongside the existing "Reset to full" button, add an **"Adjust capacity"** button. It always shows (not conditional on mismatch).

Clicking it calls `POST /migo-properties/:id/availability/recalibrate`.

**Recalibrate formula (backend):**
```
new_total  = SUM(conn.count_of_rooms ?? 0 for all platform_connections)
occupied   = Math.max(0, doc.total_units - doc.current_availability)
new_avail  = Math.max(0, new_total - occupied)
```

Example: pool is 4/6 (2 occupied). Connected properties sum to 3.
→ `new_total = 3`, `occupied = 2`, `new_avail = 1` → result: **1/3**.

If `new_total === 0` (no connections, or all have no rooms) → no-op, return current doc unchanged with a log warning.

---

### Feature 3 — Pool Edit

**Editable fields:** `title`, `alert_threshold`, `total_units` (manual override).

**Access points:**
- `PoolsList`: each pool card has an edit button (small, top-right of card). Clicking opens `PoolEditModal` overlaid on the list.
- `PoolDetail` header: "Edit" button next to the pool title. Clicking opens `PoolEditModal`.

Both use the existing `PATCH /migo-properties/:id` endpoint (no backend changes needed — `UpdateMigoPropertyDto` already has all three fields optional).

**`PoolEditModal` behavior:**
- Pre-fills with current pool values.
- Shows warning next to `total_units` field: "Editing this overrides auto-calculated capacity."
- On save: calls `updateMigoProperty()`, updates parent state, closes modal.
- Validation: `title` required, `alert_threshold >= 0`, `total_units >= 0` if provided.

---

## Architecture

### New backend: `recalibrate` endpoint

**Service method** in `migo-property.service.ts`:
```typescript
async recalibrateAvailability(migoPropertyId: string): Promise<MigoPropertyDoc>
```

**Controller** in `migo-property.controller.ts`:
```typescript
@Post(':id/availability/recalibrate')
@HttpCode(HttpStatus.OK)
async recalibrate(@Param('id') id: string): Promise<MigoPropertyDoc>
```

### New frontend components

| Component | File | Purpose |
|---|---|---|
| `PoolSyncModal` | `pools/PoolSyncModal.tsx` | Sync mismatch suggestion modal |
| `PoolEditModal` | `pools/PoolEditModal.tsx` | Edit pool title / threshold / units |

### Files changed

| File | Change |
|---|---|
| `migo-property.service.ts` | Add `recalibrateAvailability()` |
| `migo-property.controller.ts` | Add `POST :id/availability/recalibrate` endpoint |
| `channex/api/migoPropertyApi.ts` | Add `recalibrateAvailability()` fetch function |
| `pools/PoolSyncModal.tsx` | New component |
| `pools/PoolEditModal.tsx` | New component |
| `pools/PoolDetail.tsx` | Add recalibrate button, edit button, sync modal integration |
| `pools/PoolsList.tsx` | Add edit button per pool card |

---

## Error Handling

- If `new_total === 0` in recalibrate: return doc unchanged (no write). Log a warning.
- All errors surface as HTTP exceptions (existing pattern).
- Frontend shows error inline (same pattern as `handleReset`).

---

## localStorage Key

```
Key:   'migo-pool-sync-dismissed'
Value: 'true'
Scope: global (not per-pool)
Set:   when user checks "Don't show this again" and dismisses
Read:  on every PoolDetail mount
```

---

## Out of Scope

- Recalibrating bookings by reading actual Firestore booking docs (we use the pool counter delta instead)
- Per-pool dismiss state
- Undo / history for recalibrate

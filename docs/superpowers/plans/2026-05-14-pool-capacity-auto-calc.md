# Pool Capacity Auto-Calculation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `total_units` on a MigoProperty pool is auto-computed from the `count_of_rooms` of its connected Channex properties — no longer entered manually by the user.

**Architecture:** Add `count_of_rooms` to `PlatformConnection`, computed at assignment time. `assignConnection()` validates the property has rooms and increments pool capacity; `removeConnection()` decrements it. Pool creation starts at 0. Frontend removes the manual input and shows a rooms-contributed preview in the assignment modal.

**Tech Stack:** NestJS (backend service + DTO), React + TypeScript (frontend components + API types), Firestore (`FieldValue.increment`).

**Do NOT make any git commits.** The parent session will handle committing all changes together.

---

## Context for the implementer

This codebase is a NestJS + React monorepo at `apps/backend` and `apps/frontend`.

Key files you will modify:

**Backend:**
- `apps/backend/src/migo-property/migo-property.service.ts` — the service you will change the most. Already imports `FieldValue` from `firebase-admin/firestore`.
- `apps/backend/src/migo-property/dto/create-migo-property.dto.ts` — currently has `total_units: @IsInt() @Min(1)`. Remove it.
- `apps/backend/src/migo-property/dto/update-migo-property.dto.ts` — keep `total_units` optional (no UI exposes it; it's a manual override safety valve).

**Frontend:**
- `apps/frontend/src/channex/api/migoPropertyApi.ts` — types for `PlatformConnection` and `CreateMigoPropertyPayload`.
- `apps/frontend/src/channex/components/pools/PoolCreateForm.tsx` — currently has a "Total Physical Units" input. Remove it.
- `apps/frontend/src/channex/components/pools/AssignConnectionModal.tsx` — modal that calls `assignConnection()`. Uses `useChannexProperties` hook which already returns `room_types: StoredRoomType[]` on each property. `StoredRoomType` has `count_of_rooms: number` (defined in `channex/api/channexHubApi.ts`).
- `apps/frontend/src/channex/components/pools/PoolDetail.tsx` — connection list rows. Add a `count_of_rooms` display.

There are **no test files** in this project. Verification is done by running the backend and checking behavior manually.

---

### Task 1: Backend — `PlatformConnection`, service changes, DTO

**Files:**
- Modify: `apps/backend/src/migo-property/migo-property.service.ts`
- Modify: `apps/backend/src/migo-property/dto/create-migo-property.dto.ts`

---

- [ ] **Step 1: Read the files**

Read `apps/backend/src/migo-property/migo-property.service.ts` and `apps/backend/src/migo-property/dto/create-migo-property.dto.ts` in full before editing.

---

- [ ] **Step 2: Add `count_of_rooms` to `PlatformConnection` interface**

In `migo-property.service.ts`, change:

```typescript
export interface PlatformConnection {
  platform: string;
  channex_property_id: string;
  listing_title: string;
  is_sync_enabled: boolean;
}
```

To:

```typescript
export interface PlatformConnection {
  platform: string;
  channex_property_id: string;
  listing_title: string;
  is_sync_enabled: boolean;
  count_of_rooms: number;
}
```

---

- [ ] **Step 3: Update `createPropertyType()` to start at 0**

In `createPropertyType()`, the doc creation block currently reads:
```typescript
total_units: dto.total_units,
current_availability: dto.total_units,
```

Change both lines to:
```typescript
total_units: 0,
current_availability: 0,
```

The `total_units` field will be built up as connections are added.

---

- [ ] **Step 4: Update `assignConnection()` — validate rooms, compute count, increment capacity**

The current `assignConnection()` method already fetches the Channex property doc via:
```typescript
const propSnap = await db
  .collectionGroup('properties')
  .where('channex_property_id', '==', dto.channexPropertyId)
  .limit(1)
  .get();
if (propSnap.empty) {
  throw new NotFoundException(`Channex property not found: ${dto.channexPropertyId}`);
}
```

After the `if (propSnap.empty)` check, add the room count computation and validation:

```typescript
const propData = propSnap.docs[0].data();
const roomTypes = (propData?.room_types as Array<{ count_of_rooms?: number }>) ?? [];
const countOfRooms = roomTypes.reduce((sum, rt) => sum + (rt.count_of_rooms ?? 0), 0);

if (countOfRooms === 0) {
  throw new BadRequestException(
    `Property "${dto.channexPropertyId}" has no room types with a room count configured. ` +
      `Go to Properties → Rooms & Rates and set the room count before adding to a pool.`,
  );
}
```

Make sure `BadRequestException` is imported from `@nestjs/common` — check the existing imports at the top of the file, it should already be there since `deletePropertyType()` uses it.

Then update `newConnection` to include `count_of_rooms`:

```typescript
const newConnection: PlatformConnection = {
  platform: dto.platform,
  channex_property_id: dto.channexPropertyId,
  listing_title: dto.listingTitle,
  is_sync_enabled: dto.isSyncEnabled ?? true,
  count_of_rooms: countOfRooms,
};
```

Then update the Firestore write to increment pool capacity. Replace the current `firebase.update` call:

```typescript
await this.firebase.update(db.collection(COLLECTION).doc(migoPropertyId), {
  platform_connections: updatedConnections,
  updated_at: now,
});
```

With:

```typescript
await this.firebase.update(db.collection(COLLECTION).doc(migoPropertyId), {
  platform_connections: updatedConnections,
  total_units: FieldValue.increment(countOfRooms),
  current_availability: FieldValue.increment(countOfRooms),
  updated_at: now,
});
```

Also update the return statement — after the write, the returned doc object should reflect the new values. The `doc` variable was fetched before the increment, so compute the new values explicitly:

```typescript
return {
  ...doc,
  platform_connections: updatedConnections,
  total_units: doc.total_units + countOfRooms,
  current_availability: doc.current_availability + countOfRooms,
  updated_at: now,
};
```

---

- [ ] **Step 5: Update `removeConnection()` — decrement capacity**

The current `removeConnection()` method reads `doc` via `getPropertyType()` at the top, then filters connections, then writes. Add capacity decrement logic.

After `const updatedConnections = doc.platform_connections.filter(...)`, add:

```typescript
const removedConn = doc.platform_connections.find(
  (c) => c.channex_property_id === channexPropertyId,
);
const countOfRooms = removedConn?.count_of_rooms ?? 0;
```

Then update the write patch. Replace:

```typescript
await this.firebase.update(db.collection(COLLECTION).doc(migoPropertyId), {
  platform_connections: updatedConnections,
  updated_at: now,
});
```

With:

```typescript
const capacityPatch: Record<string, unknown> = {};
if (countOfRooms > 0) {
  capacityPatch.total_units = Math.max(0, doc.total_units - countOfRooms);
  capacityPatch.current_availability = Math.max(0, doc.current_availability - countOfRooms);
}

await this.firebase.update(db.collection(COLLECTION).doc(migoPropertyId), {
  platform_connections: updatedConnections,
  ...capacityPatch,
  updated_at: now,
});
```

Also update the return statement to reflect the decremented values:

```typescript
return {
  ...doc,
  platform_connections: updatedConnections,
  total_units: countOfRooms > 0 ? Math.max(0, doc.total_units - countOfRooms) : doc.total_units,
  current_availability: countOfRooms > 0 ? Math.max(0, doc.current_availability - countOfRooms) : doc.current_availability,
  updated_at: now,
};
```

---

- [ ] **Step 6: Update `create-migo-property.dto.ts` — remove `total_units`**

Replace the entire file with:

```typescript
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class CreateMigoPropertyDto {
  @IsString()
  @IsNotEmpty()
  tenantId: string;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  alert_threshold?: number;
}
```

---

- [ ] **Step 7: Verify the backend compiles**

Run from the repo root:
```bash
pnpm --filter @migo-uit/backend build
```

Expected: exits with code 0, no TypeScript errors. If there are errors related to `dto.total_units` being referenced somewhere that wasn't updated, fix them.

---

### Task 2: Frontend — types and `PoolCreateForm`

**Files:**
- Modify: `apps/frontend/src/channex/api/migoPropertyApi.ts`
- Modify: `apps/frontend/src/channex/components/pools/PoolCreateForm.tsx`

---

- [ ] **Step 1: Read both files in full**

Read `apps/frontend/src/channex/api/migoPropertyApi.ts` and `apps/frontend/src/channex/components/pools/PoolCreateForm.tsx`.

---

- [ ] **Step 2: Update `migoPropertyApi.ts` — add `count_of_rooms`, remove `total_units` from create payload**

In `PlatformConnection`, add `count_of_rooms`:

```typescript
export interface PlatformConnection {
  platform: string;
  channex_property_id: string;
  listing_title: string;
  is_sync_enabled: boolean;
  count_of_rooms: number;
}
```

In `CreateMigoPropertyPayload`, remove `total_units`:

```typescript
export interface CreateMigoPropertyPayload {
  tenantId: string;
  title: string;
  alert_threshold?: number;
}
```

---

- [ ] **Step 3: Update `PoolCreateForm.tsx` — remove Total Physical Units field**

Remove the `totalUnits` state and the corresponding form field. The form should only have Pool Name and Alert Threshold.

The full updated component:

```typescript
import { useState } from 'react';
import Button from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { createMigoProperty, type MigoProperty } from '../../api/migoPropertyApi';

interface Props {
  tenantId: string;
  onCreated: (pool: MigoProperty) => void;
  onCancel: () => void;
}

export default function PoolCreateForm({ tenantId, onCreated, onCancel }: Props) {
  const [title, setTitle] = useState('');
  const [alertThreshold, setAlertThreshold] = useState('0');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('Pool name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const pool = await createMigoProperty({
        tenantId,
        title: title.trim(),
        alert_threshold: parseInt(alertThreshold, 10) || 0,
      });
      onCreated(pool);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create pool');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-edge bg-surface-raised px-6 py-6 max-w-md">
      <h2 className="text-lg font-semibold text-content mb-5">New Property Pool</h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-content-2 uppercase tracking-wide">
            Pool Name
          </label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Studio Full"
            required
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-content-2 uppercase tracking-wide">
            Alert Threshold
          </label>
          <Input
            type="number"
            min={0}
            value={alertThreshold}
            onChange={(e) => setAlertThreshold(e.target.value)}
          />
          <p className="mt-1 text-xs text-content-3">
            Show alert when availability drops to or below this number. Default: 0.
          </p>
        </div>

        <p className="text-xs text-content-3">
          Pool capacity is calculated automatically when you add platform connections.
        </p>

        {error && <p className="text-sm text-danger-text">{error}</p>}

        <div className="flex gap-3 pt-2">
          <Button type="submit" variant="primary" size="sm" disabled={saving}>
            {saving ? 'Creating…' : 'Create Pool'}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
```

---

- [ ] **Step 4: Verify frontend TypeScript compiles**

Run from the repo root:
```bash
pnpm --filter @migo-uit/frontend build
```

Expected: exits with code 0. If there are type errors about `total_units` being required somewhere, fix them.

---

### Task 3: Frontend — `AssignConnectionModal` room preview + gate

**Files:**
- Modify: `apps/frontend/src/channex/components/pools/AssignConnectionModal.tsx`

---

- [ ] **Step 1: Read the file in full**

Read `apps/frontend/src/channex/components/pools/AssignConnectionModal.tsx`.

The hook `useChannexProperties` already returns `room_types: StoredRoomType[]` on each property, and `StoredRoomType` has `count_of_rooms: number` (defined in `channex/api/channexHubApi.ts`). No new data fetching needed.

---

- [ ] **Step 2: Add rooms calculation derived from selected property**

After the existing `const available = ...` line, add:

```typescript
const selectedProp = selectedChannexId
  ? properties.find((p) => p.channex_property_id === selectedChannexId)
  : null;

const selectedRoomCount = selectedProp
  ? selectedProp.room_types.reduce((sum, rt) => sum + (rt.count_of_rooms ?? 0), 0)
  : null;

const hasNoRooms = selectedRoomCount !== null && selectedRoomCount === 0;
```

---

- [ ] **Step 3: Add room preview below the property selector**

Inside the `<form>`, after the Channex Property `<Select>` block's closing `</div>`, add:

```tsx
{selectedChannexId && selectedRoomCount !== null && (
  <div className={`rounded-lg px-3 py-2 text-sm ${
    hasNoRooms
      ? 'bg-danger-bg text-danger-text'
      : 'bg-ok-bg text-ok-text'
  }`}>
    {hasNoRooms ? (
      <>
        <strong>No rooms configured.</strong> Go to Properties → Rooms &amp; Rates and
        set the room count for this property before adding it to a pool.
      </>
    ) : (
      <>
        This connection will add <strong>{selectedRoomCount} room{selectedRoomCount !== 1 ? 's' : ''}</strong> to the pool capacity.
      </>
    )}
  </div>
)}
```

---

- [ ] **Step 4: Disable the Assign button when rooms = 0**

Find the submit `<Button>` in the form footer:

```tsx
<Button type="submit" variant="primary" size="sm" disabled={saving}>
  {saving ? 'Assigning…' : 'Assign'}
</Button>
```

Change to:

```tsx
<Button type="submit" variant="primary" size="sm" disabled={saving || hasNoRooms}>
  {saving ? 'Assigning…' : 'Assign'}
</Button>
```

---

- [ ] **Step 5: Verify frontend compiles**

```bash
pnpm --filter @migo-uit/frontend build
```

Expected: exits with code 0, no TypeScript errors.

---

### Task 4: Frontend — `PoolDetail` show rooms per connection

**Files:**
- Modify: `apps/frontend/src/channex/components/pools/PoolDetail.tsx`

---

- [ ] **Step 1: Read the file in full**

Read `apps/frontend/src/channex/components/pools/PoolDetail.tsx`.

---

- [ ] **Step 2: Add `count_of_rooms` display to each connection row**

In the connections list, each row currently shows:

```tsx
<div className="flex-1 min-w-0">
  <p className="truncate text-sm font-medium text-content">{conn.listing_title}</p>
  <p className="truncate font-mono text-xs text-content-3">{conn.channex_property_id}</p>
</div>
```

Change to:

```tsx
<div className="flex-1 min-w-0">
  <p className="truncate text-sm font-medium text-content">{conn.listing_title}</p>
  <p className="truncate font-mono text-xs text-content-3">{conn.channex_property_id}</p>
  {(conn.count_of_rooms ?? 0) > 0 && (
    <p className="text-xs text-content-2">
      {conn.count_of_rooms} room{conn.count_of_rooms !== 1 ? 's' : ''}
    </p>
  )}
</div>
```

---

- [ ] **Step 3: Final build verification**

```bash
pnpm --filter @migo-uit/frontend build
```

Expected: exits with code 0.

---

## End State Verification

After all 4 tasks:

1. `POST /migo-properties` body no longer requires `total_units`. Sending `{ tenantId, title }` creates a pool with `total_units: 0, current_availability: 0`.
2. `POST /migo-properties/:id/connections` with a property that has `count_of_rooms > 0` increments `total_units` and `current_availability` by that amount. Returns the updated pool doc.
3. `POST /migo-properties/:id/connections` with a property that has no room types (all `count_of_rooms = 0`) returns HTTP 400 with a descriptive message.
4. `DELETE /migo-properties/:id/connections/:channexId` decrements `total_units` and `current_availability` by the removed connection's `count_of_rooms`. For legacy connections (no `count_of_rooms`), capacity is unchanged.
5. Pool create form shows only Pool Name + Alert Threshold. Includes note: "Pool capacity is calculated automatically when you add platform connections."
6. AssignConnectionModal shows a green preview ("This connection will add N rooms to the pool capacity.") for valid properties, and a red warning + disabled Assign button for properties with 0 rooms.
7. PoolDetail connection rows show the rooms count per connection (e.g., "3 rooms") for new-style connections.

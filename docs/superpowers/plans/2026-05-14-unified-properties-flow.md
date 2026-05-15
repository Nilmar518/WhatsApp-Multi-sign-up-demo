# Unified Channex Properties Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the separate Airbnb and Booking.com integration UIs into a single shared component layer, eliminating duplicated ARI calendar, reservations, and room/rate manager components across `airbnb/` and `integrations/`.

**Architecture:** All three flows (manual, Airbnb, Booking.com) use the same `channex/components/shared/` components for property detail, ARI, and reservations. The Airbnb and Booking.com tabs in `ChannexHub` are reduced to `connection/` panels that handle OAuth and sync only. `useChannexProperties` gains an optional `source` filter so each tab shows only its OTA-connected properties.

**Tech Stack:** React 18, TypeScript, Firestore (onSnapshot), Vite proxy, Tailwind CSS

---

## File Map

| Action | Path |
|--------|------|
| Modify | `apps/frontend/src/channex/api/channexHubApi.ts` |
| Modify | `apps/frontend/src/channex/hooks/useChannexProperties.ts` |
| Create | `apps/frontend/src/channex/components/shared/ARICalendar.tsx` |
| Create | `apps/frontend/src/channex/components/shared/ReservationsPanel.tsx` |
| Create | `apps/frontend/src/channex/components/shared/RoomRateManager.tsx` |
| Create | `apps/frontend/src/channex/components/shared/PropertyCard.tsx` |
| Create | `apps/frontend/src/channex/components/shared/PropertyDetail.tsx` |
| Modify | `apps/frontend/src/channex/components/PropertiesList.tsx` |
| Create | `apps/frontend/src/channex/components/connection/ChannexOAuthIFrame.tsx` |
| Create | `apps/frontend/src/channex/components/connection/AirbnbMappingReview.tsx` |
| Create | `apps/frontend/src/channex/components/connection/AirbnbConnectionPanel.tsx` |
| Create | `apps/frontend/src/channex/components/connection/BookingConnectionPanel.tsx` |
| Modify | `apps/frontend/src/channex/ChannexHub.tsx` |
| Delete | `apps/frontend/src/channex/components/ARICalendarFull.tsx` |
| Delete | `apps/frontend/src/channex/components/ReservationsPanel.tsx` |
| Delete | `apps/frontend/src/channex/components/RoomRateManager.tsx` |
| Delete | `apps/frontend/src/channex/components/PropertyDetail.tsx` |
| Delete | `apps/frontend/src/airbnb/` (entire directory) |
| Delete | `apps/frontend/src/integrations/` (entire directory) |

---

### Task 1: Add OTA methods to `channexHubApi.ts`

**Files:**
- Modify: `apps/frontend/src/channex/api/channexHubApi.ts`

- [ ] **Step 1: Append OTA types and methods at the end of the file (after line 371)**

```typescript
// ─── OTA — Airbnb ─────────────────────────────────────────────────────────────

export async function getAirbnbSessionToken(propertyId: string): Promise<string> {
  const res = await apiFetch<{ token: string }>(
    `${BASE}/properties/${encodeURIComponent(propertyId)}/one-time-token`,
  );
  return res.token;
}

export async function getAirbnbCopyLink(propertyId: string): Promise<string> {
  const res = await apiFetch<{ url: string }>(
    `${BASE}/properties/${encodeURIComponent(propertyId)}/copy-link`,
  );
  return res.url;
}

export interface StagedAirbnbListing {
  airbnbId: string;
  title: string;
  basePrice: number;
  currency: string | null;
  capacity: number;
}

export interface StagedChannexEntity {
  roomTypeId: string;
  ratePlanId: string;
  title: string;
}

export interface StagedMappingRow {
  airbnb: StagedAirbnbListing;
  channex: StagedChannexEntity;
}

export interface StageSyncResult {
  channelId: string;
  propertyId: string;
  staged: StagedMappingRow[];
}

export interface CommitMappingInput {
  ratePlanId: string;
  otaListingId: string;
}

export interface CommitMappingResult {
  channelId: string;
  mapped: number;
  alreadyMapped: number;
}

export async function syncAirbnbListings(
  propertyId: string,
  tenantId: string,
): Promise<StageSyncResult> {
  return apiFetch(`${BASE}/properties/${encodeURIComponent(propertyId)}/sync_stage`, {
    method: 'POST',
    body: JSON.stringify({ tenantId }),
  });
}

export async function commitAirbnbMapping(
  propertyId: string,
  channelId: string,
  mappings: CommitMappingInput[],
): Promise<CommitMappingResult> {
  return apiFetch(`${BASE}/properties/${encodeURIComponent(propertyId)}/commit_mapping`, {
    method: 'POST',
    body: JSON.stringify({ channelId, mappings }),
  });
}

// ─── OTA — Booking.com ────────────────────────────────────────────────────────

export async function getBookingSessionToken(
  tenantId: string,
): Promise<{ token: string; propertyId: string }> {
  return apiFetch(`/api/booking/session?tenantId=${encodeURIComponent(tenantId)}`);
}

export async function syncBookingListings(
  tenantId: string,
): Promise<{ rooms: { id: string; title: string }[]; rates: { id: string; title: string; room_id: string }[] }> {
  return apiFetch('/api/booking/sync', {
    method: 'POST',
    body: JSON.stringify({ tenantId }),
  });
}

export async function disconnectBookingChannel(tenantId: string): Promise<void> {
  return apiFetch('/api/booking/disconnect', {
    method: 'POST',
    body: JSON.stringify({ tenantId }),
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```
cd apps/frontend && npx tsc --noEmit
```
Expected: 0 errors.

---

### Task 2: Add source filter to `useChannexProperties`

**Files:**
- Modify: `apps/frontend/src/channex/hooks/useChannexProperties.ts`

- [ ] **Step 1: Replace the full file content**

```typescript
import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import type { StoredRoomType } from '../api/channexHubApi';

export type ConnectionStatus = 'pending' | 'active' | 'token_expired' | 'error';

export interface ChannexProperty {
  firestoreDocId: string;
  channex_property_id: string;
  title: string;
  currency: string;
  timezone: string;
  connection_status: ConnectionStatus;
  connected_channels: string[];
  room_types: StoredRoomType[];
}

interface Result {
  properties: ChannexProperty[];
  loading: boolean;
  error: string | null;
}

export interface UseChannexPropertiesOptions {
  source?: 'airbnb' | 'booking';
}

export function useChannexProperties(
  tenantId: string,
  options?: UseChannexPropertiesOptions,
): Result {
  const [properties, setProperties] = useState<ChannexProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) {
      setProperties([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const propertiesCol = collection(db, 'channex_integrations', tenantId, 'properties');

    const unsubscribe = onSnapshot(
      propertiesCol,
      (snapshot) => {
        let next: ChannexProperty[] = snapshot.docs.map((doc) => {
          const d = doc.data();
          return {
            firestoreDocId: doc.id,
            channex_property_id: (d.channex_property_id as string) ?? '',
            title: (d.title as string) ?? 'Untitled Property',
            currency: (d.currency as string) ?? 'USD',
            timezone: (d.timezone as string) ?? 'America/New_York',
            connection_status: (d.connection_status as ConnectionStatus) ?? 'pending',
            connected_channels: (d.connected_channels as string[]) ?? [],
            room_types: (d.room_types as StoredRoomType[]) ?? [],
          };
        });

        if (options?.source) {
          const src = options.source;
          next = next.filter((p) => p.connected_channels.includes(src));
        }

        setProperties(next);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [tenantId, options?.source]);

  return { properties, loading, error };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```
cd apps/frontend && npx tsc --noEmit
```
Expected: 0 errors.

---

### Task 3: Create `shared/ARICalendar.tsx`

**Files:**
- Create: `apps/frontend/src/channex/components/shared/ARICalendar.tsx`
- Delete: `apps/frontend/src/channex/components/ARICalendarFull.tsx`

- [ ] **Step 1: Copy `ARICalendarFull.tsx` to `shared/ARICalendar.tsx` with updated imports**

Copy the full content of `apps/frontend/src/channex/components/ARICalendarFull.tsx` into the new file, then apply these two changes:

**a) Update the 5 import paths** (each path gains one `../` level):

```typescript
// Before:
import ARIGlossaryButton from './ARIGlossaryButton';
import { ... } from '../api/channexHubApi';
import Button from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Input';
import { db } from '../../firebase/firebase';

// After:
import ARIGlossaryButton from '../ARIGlossaryButton';
import { ... } from '../../api/channexHubApi';
import Button from '../../../components/ui/Button';
import { Input, Select } from '../../../components/ui/Input';
import { db } from '../../../firebase/firebase';
```

**b) Rename the exported function**:
```typescript
// Before:
export default function ARICalendarFull({ propertyId, currency, tenantId }: Props) {

// After:
export default function ARICalendar({ propertyId, currency, tenantId }: Props) {
```

Also remove the `console.log` debug line if present in the file.

- [ ] **Step 2: Delete the original file**

Delete `apps/frontend/src/channex/components/ARICalendarFull.tsx`.

- [ ] **Step 3: Verify TypeScript**

```
cd apps/frontend && npx tsc --noEmit
```
Expected: error in `components/PropertyDetail.tsx` importing `ARICalendarFull` — expected, fixed in Task 7.

---

### Task 4: Create `shared/ReservationsPanel.tsx`

**Files:**
- Create: `apps/frontend/src/channex/components/shared/ReservationsPanel.tsx`
- Delete: `apps/frontend/src/channex/components/ReservationsPanel.tsx`

- [ ] **Step 1: Copy `ReservationsPanel.tsx` to `shared/ReservationsPanel.tsx` with updated imports**

Copy the full content of `apps/frontend/src/channex/components/ReservationsPanel.tsx`, then update:

```typescript
// Before:
import { getPropertyBookings, pullPropertyBookings, cancelManualBooking, type Reservation } from '../api/channexHubApi';
import Button from '../../components/ui/Button';

// After:
import { getPropertyBookings, pullPropertyBookings, cancelManualBooking, type Reservation } from '../../api/channexHubApi';
import Button from '../../../components/ui/Button';
```

- [ ] **Step 2: Delete the original file**

Delete `apps/frontend/src/channex/components/ReservationsPanel.tsx`.

---

### Task 5: Create `shared/RoomRateManager.tsx`

**Files:**
- Create: `apps/frontend/src/channex/components/shared/RoomRateManager.tsx`
- Delete: `apps/frontend/src/channex/components/RoomRateManager.tsx`

- [ ] **Step 1: Copy `RoomRateManager.tsx` to `shared/RoomRateManager.tsx` with updated imports**

Copy the full content of `apps/frontend/src/channex/components/RoomRateManager.tsx`, then update:

```typescript
// Before:
import {
  listRoomTypes, createRoomType, updateRoomType, createRatePlan,
  type StoredRoomType, type StoredRatePlan,
} from '../api/channexHubApi';
import Button from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';

// After:
import {
  listRoomTypes, createRoomType, updateRoomType, createRatePlan,
  type StoredRoomType, type StoredRatePlan,
} from '../../api/channexHubApi';
import Button from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
```

- [ ] **Step 2: Delete the original file**

Delete `apps/frontend/src/channex/components/RoomRateManager.tsx`.

---

### Task 6: Create `shared/PropertyCard.tsx`

**Files:**
- Create: `apps/frontend/src/channex/components/shared/PropertyCard.tsx`

- [ ] **Step 1: Create the file**

```tsx
import type { ChannexProperty } from '../../hooks/useChannexProperties';

function OTABadge({ channel }: { channel: string }) {
  const styles: Record<string, string> = {
    airbnb: 'bg-danger-bg text-danger-text',
    booking: 'bg-notice-bg text-notice-text',
  };
  const labels: Record<string, string> = {
    airbnb: 'Airbnb',
    booking: 'Booking.com',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] ${styles[channel] ?? 'bg-surface-subtle text-content-2'}`}
    >
      {labels[channel] ?? channel}
    </span>
  );
}

function StatusDot({ status }: { status: ChannexProperty['connection_status'] }) {
  const color =
    status === 'active'
      ? 'bg-emerald-500'
      : status === 'pending'
        ? 'bg-caution-bg'
        : 'bg-danger-bg';
  return <span className={`h-2 w-2 rounded-full ${color}`} />;
}

interface Props {
  property: ChannexProperty;
  onClick: (property: ChannexProperty) => void;
}

export default function PropertyCard({ property, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={() => onClick(property)}
      className="group w-full rounded-2xl border border-edge bg-surface-raised p-4 text-left transition hover:border-brand-light hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-content group-hover:text-brand">{property.title}</p>
        <StatusDot status={property.connection_status} />
      </div>

      <p className="mt-1 text-xs text-content-2">
        {property.currency} · {property.timezone}
      </p>

      <p className="mt-1 text-xs text-content-2">
        {property.room_types.length} room type{property.room_types.length !== 1 ? 's' : ''}
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {property.connected_channels.length === 0 ? (
          <span className="inline-flex items-center rounded-full bg-surface-subtle px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-content-2">
            Channex
          </span>
        ) : (
          property.connected_channels.map((ch) => <OTABadge key={ch} channel={ch} />)
        )}
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```
cd apps/frontend && npx tsc --noEmit
```

---

### Task 7: Create `shared/PropertyDetail.tsx`

**Files:**
- Create: `apps/frontend/src/channex/components/shared/PropertyDetail.tsx`
- Delete: `apps/frontend/src/channex/components/PropertyDetail.tsx`

- [ ] **Step 1: Copy `PropertyDetail.tsx` to `shared/PropertyDetail.tsx` with updated imports**

Copy the full content of `apps/frontend/src/channex/components/PropertyDetail.tsx`, then update:

```typescript
// Before:
import type { ChannexProperty } from '../hooks/useChannexProperties';
import RoomRateManager from './RoomRateManager';
import ARICalendarFull from './ARICalendarFull';
import ReservationsPanel from './ReservationsPanel';
import { checkConnectionHealth, type ConnectionHealthResult } from '../api/channexHubApi';
import Button from '../../components/ui/Button';

// After:
import type { ChannexProperty } from '../../hooks/useChannexProperties';
import RoomRateManager from './RoomRateManager';
import ARICalendar from './ARICalendar';
import ReservationsPanel from './ReservationsPanel';
import { checkConnectionHealth, type ConnectionHealthResult } from '../../api/channexHubApi';
import Button from '../../../components/ui/Button';
```

Also update the JSX where `ARICalendarFull` is rendered:
```tsx
// Before:
<ARICalendarFull propertyId={...} currency={...} tenantId={...} />

// After:
<ARICalendar propertyId={...} currency={...} tenantId={...} />
```

- [ ] **Step 2: Delete the original file**

Delete `apps/frontend/src/channex/components/PropertyDetail.tsx`.

- [ ] **Step 3: Verify TypeScript compiles**

```
cd apps/frontend && npx tsc --noEmit
```
Expected: error in `ChannexHub.tsx` importing old `PropertyDetail` path — expected, fixed in Task 13.

---

### Task 8: Update `PropertiesList.tsx` to use `shared/PropertyCard`

**Files:**
- Modify: `apps/frontend/src/channex/components/PropertiesList.tsx`

- [ ] **Step 1: Replace full file content**

```tsx
import type { ChannexProperty } from '../hooks/useChannexProperties';
import Button from '../../components/ui/Button';
import PropertyCard from './shared/PropertyCard';

interface Props {
  properties: ChannexProperty[];
  onSelect: (property: ChannexProperty) => void;
  onNew: () => void;
}

export default function PropertiesList({ properties, onSelect, onNew }: Props) {
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-content">Properties</h2>
          <p className="text-sm text-content-2">
            Manage Channex properties, room types, rate plans, and ARI.
          </p>
        </div>
        <Button type="button" onClick={onNew} variant="primary" size="sm">
          + New Property
        </Button>
      </div>

      {properties.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-edge px-8 py-12 text-center">
          <p className="text-sm font-medium text-content">No properties yet</p>
          <p className="mt-1 text-sm text-content-2">
            Create a property to start managing ARI and connecting OTA channels.
          </p>
          <Button type="button" onClick={onNew} variant="primary" size="sm" className="mt-4">
            Create first property
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {properties.map((property) => (
            <PropertyCard
              key={property.firestoreDocId}
              property={property}
              onClick={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```
cd apps/frontend && npx tsc --noEmit
```

---

### Task 9: Create `connection/ChannexOAuthIFrame.tsx`

**Files:**
- Create: `apps/frontend/src/channex/components/connection/ChannexOAuthIFrame.tsx`

- [ ] **Step 1: Copy `airbnb/components/ChannexIFrame.tsx` to the new path and update**

Copy the full content of `apps/frontend/src/airbnb/components/ChannexIFrame.tsx`, then apply:

**a) Update the import:**
```typescript
// Before:
import { getOneTimeToken, getCopyLink } from '../api/channexApi';

// After:
import { getAirbnbSessionToken, getAirbnbCopyLink } from '../../api/channexHubApi';
```

**b) Update the two call sites inside the component:**
```typescript
// Before:
const t = await getOneTimeToken(propertyId);
// ...
const url = await getCopyLink(propertyId);

// After:
const t = await getAirbnbSessionToken(propertyId);
// ...
const url = await getAirbnbCopyLink(propertyId);
```

**c) Rename the exported function:**
```typescript
// Before:
export default function ChannexIFrame({ propertyId, onConnected }: Props) {

// After:
export default function ChannexOAuthIFrame({ propertyId, onConnected }: Props) {
```

**d) Remove the debug console.log line:**
```typescript
// Remove this line:
console.log('IFrame URL:', iframeUrl);
```

- [ ] **Step 2: Verify TypeScript compiles**

```
cd apps/frontend && npx tsc --noEmit
```

---

### Task 10: Create `connection/AirbnbMappingReview.tsx`

**Files:**
- Create: `apps/frontend/src/channex/components/connection/AirbnbMappingReview.tsx`

- [ ] **Step 1: Copy `airbnb/components/MappingReviewModal.tsx` and update**

Copy the full content of `apps/frontend/src/airbnb/components/MappingReviewModal.tsx`, then apply:

**a) Update the import:**
```typescript
// Before:
import {
  commitMapping,
  type StageSyncResult,
  type StagedMappingRow,
  type CommitMappingInput,
} from '../api/channexApi';

// After:
import {
  commitAirbnbMapping,
  type StageSyncResult,
  type StagedMappingRow,
  type CommitMappingInput,
} from '../../api/channexHubApi';
```

**b) Update the two `commitMapping` call sites:**
```typescript
// Before (both occurrences):
await commitMapping(propertyId, channelId, [...]);

// After:
await commitAirbnbMapping(propertyId, channelId, [...]);
```

**c) Rename the exported component:**
```typescript
// Before:
export default function MappingReviewModal({ staged, onComplete }: Props) {

// After:
export default function AirbnbMappingReview({ staged, onComplete }: Props) {
```

- [ ] **Step 2: Verify TypeScript compiles**

```
cd apps/frontend && npx tsc --noEmit
```

---

### Task 11: Create `connection/AirbnbConnectionPanel.tsx`

**Files:**
- Create: `apps/frontend/src/channex/components/connection/AirbnbConnectionPanel.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { useState, useCallback } from 'react';
import { useChannexProperties } from '../../hooks/useChannexProperties';
import { syncAirbnbListings, type StageSyncResult } from '../../api/channexHubApi';
import ChannexOAuthIFrame from './ChannexOAuthIFrame';
import AirbnbMappingReview from './AirbnbMappingReview';
import PropertyCard from '../shared/PropertyCard';
import PropertyDetail from '../shared/PropertyDetail';
import type { ChannexProperty } from '../../hooks/useChannexProperties';

interface Props {
  tenantId: string;
}

type PanelView = 'connect' | 'review';

export default function AirbnbConnectionPanel({ tenantId }: Props) {
  const { properties: allProperties, loading } = useChannexProperties(tenantId);
  const { properties: airbnbProperties } = useChannexProperties(tenantId, { source: 'airbnb' });

  const [panelView, setPanelView] = useState<PanelView>('connect');
  const [stagedResult, setStagedResult] = useState<StageSyncResult | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [iframeReloadToken, setIframeReloadToken] = useState(0);
  const [selectedProperty, setSelectedProperty] = useState<ChannexProperty | null>(null);

  const baseProperty = allProperties[0] ?? null;

  const handleSync = useCallback(async () => {
    if (!baseProperty) return;
    setSyncing(true);
    setSyncError(null);
    try {
      const result = await syncAirbnbListings(baseProperty.channex_property_id, tenantId);
      setStagedResult(result);
      setPanelView('review');
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Sync failed. Please try again.');
    } finally {
      setSyncing(false);
    }
  }, [baseProperty, tenantId]);

  const handleMappingComplete = useCallback(() => {
    setStagedResult(null);
    setPanelView('connect');
  }, []);

  const handleReconnect = useCallback(() => {
    setStagedResult(null);
    setSyncError(null);
    setPanelView('connect');
    setIframeReloadToken((t) => t + 1);
  }, []);

  if (selectedProperty) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setSelectedProperty(null)}
          className="mb-4 text-sm text-content-2 hover:text-content"
        >
          ← Back to Airbnb
        </button>
        <PropertyDetail property={selectedProperty} tenantId={tenantId} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-edge bg-surface-raised p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500">
            <span className="text-xs font-bold text-white">A</span>
          </div>
          <div>
            <h2 className="text-base font-semibold text-content">Airbnb Connection</h2>
            <p className="text-xs text-content-2">
              Connect your Airbnb account and sync listings to Channex.
            </p>
          </div>
        </div>

        {loading && <p className="text-sm text-content-2">Loading properties…</p>}

        {!loading && !baseProperty && (
          <div className="rounded-xl border border-edge bg-surface-subtle px-4 py-3 text-sm text-content-2">
            No Channex property found. Create one in the <strong>Properties</strong> tab first.
          </div>
        )}

        {!loading && baseProperty && panelView === 'connect' && (
          <>
            <ChannexOAuthIFrame
              key={`${baseProperty.channex_property_id}-${iframeReloadToken}`}
              propertyId={baseProperty.channex_property_id}
            />

            {syncError && (
              <div className="mt-3 rounded-xl border border-danger-text/20 bg-danger-bg px-4 py-3 text-sm text-danger-text">
                <span className="font-semibold">Error: </span>{syncError}
              </div>
            )}

            <div className="mt-4 flex justify-end border-t border-edge pt-4">
              <button
                type="button"
                disabled={syncing}
                onClick={() => void handleSync()}
                className={[
                  'inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors',
                  syncing
                    ? 'cursor-not-allowed bg-surface-subtle text-content-3'
                    : 'bg-rose-600 text-white hover:bg-rose-700',
                ].join(' ')}
              >
                {syncing ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-rose-200 border-t-white" />
                    Syncing listings…
                  </>
                ) : (
                  'Sync Listings & Review'
                )}
              </button>
            </div>
          </>
        )}

        {!loading && baseProperty && panelView === 'review' && stagedResult && (
          <div className="space-y-4">
            <AirbnbMappingReview staged={stagedResult} onComplete={handleMappingComplete} />
            <button
              type="button"
              onClick={handleReconnect}
              className="text-sm text-content-3 underline hover:no-underline"
            >
              ← Back to Airbnb connection
            </button>
          </div>
        )}
      </div>

      {airbnbProperties.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-content">Connected Airbnb Properties</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {airbnbProperties.map((property) => (
              <PropertyCard
                key={property.firestoreDocId}
                property={property}
                onClick={setSelectedProperty}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```
cd apps/frontend && npx tsc --noEmit
```

---

### Task 12: Create `connection/BookingConnectionPanel.tsx`

**Files:**
- Create: `apps/frontend/src/channex/components/connection/BookingConnectionPanel.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { useState, useCallback } from 'react';
import { useChannexProperties } from '../../hooks/useChannexProperties';
import {
  getBookingSessionToken,
  syncBookingListings,
  disconnectBookingChannel,
} from '../../api/channexHubApi';
import PropertyCard from '../shared/PropertyCard';
import PropertyDetail from '../shared/PropertyDetail';
import type { ChannexProperty } from '../../hooks/useChannexProperties';

interface Props {
  tenantId: string;
}

function buildPopupUrl(token: string, propertyId: string): string {
  const base =
    (import.meta as any).env?.VITE_CHANNEX_IFRAME_BASE_URL ?? 'https://staging.channex.io';
  const params = new URLSearchParams({
    oauth_session_key: token,
    app_mode: 'headless',
    redirect_to: '/channels',
    property_id: propertyId,
    channels: 'BDC',
  });
  return `${base}/auth/exchange?${params.toString()}`;
}

function openCenteredPopup(url: string) {
  const width = 800;
  const height = 700;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
  window.open(
    url,
    'ChannexBookingAuth',
    `popup=yes,width=${width},height=${height},left=${left},top=${top},noopener,noreferrer`,
  );
}

export default function BookingConnectionPanel({ tenantId }: Props) {
  const { properties: bookingProperties } = useChannexProperties(tenantId, { source: 'booking' });
  const [selectedProperty, setSelectedProperty] = useState<ChannexProperty | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [synced, setSynced] = useState(false);

  const isLocked = connecting || syncing || disconnecting;

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const { token, propertyId } = await getBookingSessionToken(tenantId);
      openCenteredPopup(buildPopupUrl(token, propertyId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed.');
    } finally {
      setConnecting(false);
    }
  }, [tenantId]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    setSynced(false);
    try {
      await syncBookingListings(tenantId);
      setSynced(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  }, [tenantId]);

  const handleDisconnect = useCallback(async () => {
    if (!window.confirm('Disconnect Booking.com? This will remove the channel from Channex.')) return;
    setDisconnecting(true);
    setError(null);
    try {
      await disconnectBookingChannel(tenantId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Disconnect failed.');
    } finally {
      setDisconnecting(false);
    }
  }, [tenantId]);

  if (selectedProperty) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setSelectedProperty(null)}
          className="mb-4 text-sm text-content-2 hover:text-content"
        >
          ← Back to Booking.com
        </button>
        <PropertyDetail property={selectedProperty} tenantId={tenantId} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-edge bg-surface-raised p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-notice-bg">
            <span className="text-xs font-bold text-notice-text">B</span>
          </div>
          <div>
            <h2 className="text-base font-semibold text-content">Booking.com Connection</h2>
            <p className="text-xs text-content-2">
              Connect your Booking.com account and sync rooms via Channex.
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-danger-text/20 bg-danger-bg px-4 py-3 text-sm text-danger-text">
            <span className="font-semibold">Error: </span>{error}
          </div>
        )}

        {synced && (
          <div className="mb-4 rounded-xl border border-ok-text/20 bg-ok-bg px-4 py-3 text-sm font-medium text-ok-text">
            Sync complete — rooms and rates imported from Booking.com.
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={isLocked}
            onClick={() => void handleConnect()}
            className={[
              'inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors',
              isLocked
                ? 'cursor-not-allowed bg-surface-subtle text-content-3'
                : 'bg-notice-bg text-notice-text hover:opacity-80',
            ].join(' ')}
          >
            {connecting ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-notice-text/30 border-t-notice-text" />
                Opening…
              </>
            ) : (
              'Connect via Channex'
            )}
          </button>

          <button
            type="button"
            disabled={isLocked}
            onClick={() => void handleSync()}
            className={[
              'inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors',
              isLocked
                ? 'cursor-not-allowed bg-surface-subtle text-content-3'
                : 'bg-brand text-white hover:opacity-80',
            ].join(' ')}
          >
            {syncing ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Syncing…
              </>
            ) : (
              'Sync Rooms & Rates'
            )}
          </button>

          <button
            type="button"
            disabled={isLocked}
            onClick={() => void handleDisconnect()}
            className={[
              'inline-flex items-center rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors',
              isLocked
                ? 'cursor-not-allowed bg-surface-subtle text-content-3'
                : 'bg-danger-bg text-danger-text hover:opacity-80',
            ].join(' ')}
          >
            {disconnecting ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </div>
      </div>

      {bookingProperties.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-content">
            Connected Booking.com Properties
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {bookingProperties.map((property) => (
              <PropertyCard
                key={property.firestoreDocId}
                property={property}
                onClick={setSelectedProperty}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```
cd apps/frontend && npx tsc --noEmit
```

---

### Task 13: Update `ChannexHub.tsx`

**Files:**
- Modify: `apps/frontend/src/channex/ChannexHub.tsx`

- [ ] **Step 1: Update the import block at the top of the file**

```typescript
// Remove these two lines:
import AirbnbIntegration from '../integrations/airbnb/AirbnbIntegration';
import BookingIntegrationView from '../integrations/booking/BookingIntegrationView';

// Remove this line:
import PropertyDetail from './components/PropertyDetail';

// Add these three lines in their place:
import AirbnbConnectionPanel from './components/connection/AirbnbConnectionPanel';
import BookingConnectionPanel from './components/connection/BookingConnectionPanel';
import PropertyDetail from './components/shared/PropertyDetail';
```

- [ ] **Step 2: Replace Airbnb tab content (around line 124–128)**

```tsx
// Remove:
{activeSubTab === 'airbnb' && (
  <div className="h-full">
    <AirbnbIntegration businessId={businessId} />
  </div>
)}

// Replace with:
{activeSubTab === 'airbnb' && (
  <div className="px-6 py-6">
    <AirbnbConnectionPanel tenantId={businessId} />
  </div>
)}
```

- [ ] **Step 3: Replace Booking tab content (around line 130–134)**

```tsx
// Remove:
{activeSubTab === 'booking' && (
  <div className="h-full">
    <BookingIntegrationView businessId={businessId} />
  </div>
)}

// Replace with:
{activeSubTab === 'booking' && (
  <div className="px-6 py-6">
    <BookingConnectionPanel tenantId={businessId} />
  </div>
)}
```

- [ ] **Step 4: Verify TypeScript compiles with zero errors**

```
cd apps/frontend && npx tsc --noEmit
```
Expected: 0 errors.

---

### Task 14: Delete old OTA directories and final verification

**Files:**
- Delete: `apps/frontend/src/airbnb/` (entire directory)
- Delete: `apps/frontend/src/integrations/` (entire directory)

- [ ] **Step 1: Delete the old directories**

```powershell
Remove-Item -Recurse -Force "apps/frontend/src/airbnb"
Remove-Item -Recurse -Force "apps/frontend/src/integrations"
```

- [ ] **Step 2: Final TypeScript verification — must be zero errors**

```
cd apps/frontend && npx tsc --noEmit
```
Expected: 0 errors. If errors remain, they point to an import that still references the deleted directories — fix the import path.

- [ ] **Step 3: Run the dev server and manually verify all tabs**

```
pnpm dev
```

Navigate to the Channex section and verify:
1. **Properties tab** — property list renders, click opens PropertyDetail showing Rooms & Rates / ARI Calendar / Reservations tabs. Creating a new property via wizard still works.
2. **Airbnb tab** — shows Channex OAuth iframe + "Sync Listings & Review" button. If Airbnb properties exist in Firestore with `connected_channels: ['airbnb']`, they appear below the connection panel.
3. **Booking tab** — shows "Connect via Channex", "Sync Rooms & Rates", and "Disconnect" buttons. If Booking properties exist with `connected_channels: ['booking']`, they appear below.
4. **Pools tab** — unchanged, continues to work exactly as before.

---

## Self-Review

**Spec coverage:**
- ✅ `shared/ARICalendar` — absorbs `ARICalendarFull` and `MultiCalendarView`
- ✅ `shared/ReservationsPanel` — absorbs `ReservationInbox` and `BookingReservations`
- ✅ `shared/RoomRateManager` — canonical, unchanged logic
- ✅ `shared/PropertyCard` — extracted from `PropertiesList`
- ✅ `shared/PropertyDetail` — uses all shared sub-components
- ✅ `connection/AirbnbConnectionPanel` — OAuth iframe + sync + filtered list
- ✅ `connection/BookingConnectionPanel` — popup + sync + disconnect + filtered list
- ✅ `useChannexProperties` source filter — client-side on `connected_channels`
- ✅ `channexHubApi.ts` absorbs all OTA API methods
- ✅ `ChannexHub.tsx` wired to new panels
- ✅ `airbnb/` and `integrations/` directories deleted
- ✅ Backend scope: no backend changes (verification-only per spec)

**Placeholder scan:** No TBDs, incomplete steps, or vague requirements found.

**Type consistency:**
- `StageSyncResult`, `StagedMappingRow`, `CommitMappingInput`, `CommitMappingResult` defined in Task 1, consumed in Tasks 10 and 11 ✅
- `commitAirbnbMapping` defined in Task 1, called in `AirbnbMappingReview` (Task 10) ✅
- `getAirbnbSessionToken`, `getAirbnbCopyLink` defined in Task 1, used in `ChannexOAuthIFrame` (Task 9) ✅
- `disconnectBookingChannel` defined in Task 1, called in `BookingConnectionPanel` (Task 12) ✅
- `ChannexProperty` exported from `useChannexProperties`, consumed by PropertyCard, PropertyDetail, and both connection panels ✅

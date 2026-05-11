# Channex Hub UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace standalone Airbnb/Booking.com top-level tabs with a unified Channex Hub that centralizes property management, room/rate CRUD, and a full ARI calendar — enabling Channex PMS certification directly from the UI.

**Architecture:** A new `channex` tab is added to `ChannelTabs`. It renders `ChannexHub`, which has three sub-tabs: Properties (channel-agnostic — always visible), Airbnb (existing `AirbnbIntegration`, rendered as a sub-tab), and Booking.com (existing `BookingIntegrationView`, rendered as a sub-tab). The Properties sub-tab adds a setup wizard and an expanded ARI calendar supporting rates, restrictions, and numeric availability — the real PMS path verified by Channex evaluators. The old `airbnb` and `booking` top-level tabs are removed from `ChannelTabs`.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Firebase Firestore `onSnapshot`, NestJS backend (existing ARI endpoints at `/channex/properties/:propertyId/...`), Vite proxy `/api/* → localhost:3001`

**No test runner in this repo.** Verification steps use TypeScript compilation (`pnpm --filter @migo-uit/backend build` and `pnpm --filter @migo-uit/frontend build`) and manual browser checks.

---

## File Map

### Backend — modified files
| File | Change |
|------|--------|
| `apps/backend/src/channex/channex-property.service.ts` | Add `connected_channels: []` to `provisionProperty()` Firestore write (line ~116) |
| `apps/backend/src/channex/channex-property.controller.ts` | Remove `updateAvailability()` method (lines ~162–203) — route conflicts with `ChannexARIController` |

### Frontend — new files
| File | Responsibility |
|------|----------------|
| `apps/frontend/src/channex/api/channexHubApi.ts` | `createProperty`, `createRoomType`, `createRatePlan`, `listRoomTypes`, `pushAvailabilityBatch`, `pushRestrictionsBatch`, `triggerFullSync` |
| `apps/frontend/src/channex/hooks/useChannexProperties.ts` | Firestore `onSnapshot` subscription to all `channex_integrations` docs for a tenant |
| `apps/frontend/src/channex/ChannexHub.tsx` | Top-level hub with sub-tab state: Properties / Airbnb / Booking.com |
| `apps/frontend/src/channex/components/PropertiesList.tsx` | Property grid with OTA badge chips and "New Property" button |
| `apps/frontend/src/channex/components/PropertySetupWizard.tsx` | 4-step wizard: details → rooms → rate plans → confirm |
| `apps/frontend/src/channex/components/RoomRateManager.tsx` | Table of room types and rate plans for a property; add-row forms |
| `apps/frontend/src/channex/components/ARICalendarFull.tsx` | Month calendar for date-range selection + expanded ARI control panel |
| `apps/frontend/src/channex/components/PropertyDetail.tsx` | Two inner tabs: "Rooms & Rates" (RoomRateManager) and "ARI Calendar" (ARICalendarFull) |

### Frontend — modified files
| File | Change |
|------|--------|
| `apps/frontend/src/components/ChannelTabs/index.tsx` | Add `'channex'` to `Channel` union and `TABS` array; remove `'airbnb'` and `'booking'` |
| `apps/frontend/src/App.tsx` | Replace `airbnb`/`booking` render branches with `<ChannexHub businessId={businessId} />` |

---

## Task 1 — Fix backend route conflict + add `connected_channels` field

**Files:**
- Modify: `apps/backend/src/channex/channex-property.controller.ts`
- Modify: `apps/backend/src/channex/channex-property.service.ts`

**Context:** `ChannexPropertyController` declares `@Post(':propertyId/availability')` which resolves to the same URL as `ChannexARIController`'s `@Post('availability')` under `@Controller('channex/properties/:propertyId')`. Because `ChannexPropertyController` is registered first in `channex.module.ts`, it shadows the batch endpoint. The PropertyController version only accepts `availability: 0|1`, which breaks `ARICalendar.tsx` (which sends the batch format `{ updates: [...] }`). Removing the duplicate from PropertyController fixes this.

- [ ] **Step 1.1: Remove `updateAvailability` from `ChannexPropertyController`**

Open `apps/backend/src/channex/channex-property.controller.ts`. Delete the entire `updateAvailability` method and its JSDoc comment (approximately lines 157–204). The method signature is:

```typescript
@Post(':propertyId/availability')
@HttpCode(HttpStatus.OK)
async updateAvailability(
  @Param('propertyId') propertyId: string,
  @Body() body: { ... },
): Promise<{ status: 'ok' }> {
```

After deletion, the `ChannexARIController` endpoint (in `channex-ari.controller.ts`) will handle `POST /channex/properties/:propertyId/availability` with the batch `{ updates: [...] }` format.

Also remove any imports that become unused after the deletion (`BadRequestException` if it was only used there — check that it isn't used elsewhere in the file first).

- [ ] **Step 1.2: Add `connected_channels` to `provisionProperty()`**

Open `apps/backend/src/channex/channex-property.service.ts`. In the `provisionProperty()` method, find the `await this.firebase.set(docRef, { ... })` call (around line 116). Add `connected_channels: []` after the `room_types: []` line:

```typescript
await this.firebase.set(docRef, {
  // Identity
  tenant_id: dto.tenantId,
  migo_property_id: dto.migoPropertyId,
  channex_property_id: channexPropertyId,
  channex_channel_id: null,
  channex_webhook_id: null,
  channex_group_id: dto.groupId ?? null,

  // Connection state
  connection_status: ChannexConnectionStatus.Pending,
  oauth_refresh_required: false,
  last_sync_timestamp: null,

  // Property config
  title: dto.title,
  currency: dto.currency,
  timezone: dto.timezone,
  property_type: dto.propertyType ?? 'apartment',

  // ARI entities
  room_types: [],
  connected_channels: [],      // ← ADD THIS LINE

  // Timestamps
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});
```

- [ ] **Step 1.3: Verify backend compiles**

```bash
cd apps/backend && pnpm build
```

Expected: no TypeScript errors. The one pre-existing error in `BookingIntegrationView.tsx:230` is frontend-only — ignore it here.

- [ ] **Step 1.4: Commit**

```bash
git add apps/backend/src/channex/channex-property.service.ts apps/backend/src/channex/channex-property.controller.ts
git commit -m "fix(channex): remove duplicate availability route + add connected_channels field"
```

---

## Task 2 — Frontend API layer: `channexHubApi.ts`

**Files:**
- Create: `apps/frontend/src/channex/api/channexHubApi.ts`

All requests go through Vite proxy `/api/* → http://localhost:3001`. The backend strips `/api`, so `/api/channex/...` hits `/channex/...` on NestJS.

- [ ] **Step 2.1: Create the file**

Create `apps/frontend/src/channex/api/channexHubApi.ts` with this content:

```typescript
const BASE = '/api/channex';

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface StoredRoomType {
  room_type_id: string;
  title: string;
  default_occupancy: number;
  rate_plan_id: string | null;
}

export interface ARIAvailabilityUpdate {
  room_type_id: string;
  date_from: string;
  date_to: string;
  availability: number;
}

export interface ARIRestrictionUpdate {
  rate_plan_id: string;
  date_from: string;
  date_to: string;
  rate?: string;
  min_stay_arrival?: number;
  max_stay?: number | null;
  stop_sell?: boolean;
  closed_to_arrival?: boolean;
  closed_to_departure?: boolean;
}

// ─── Shared fetch helper ──────────────────────────────────────────────────────

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  const body = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
  if (!res.ok) {
    const msg = Array.isArray(body?.message) ? body.message.join('; ') : (body?.message ?? `HTTP ${res.status}`);
    throw new Error(msg);
  }
  return body as T;
}

// ─── Property ─────────────────────────────────────────────────────────────────

export interface ProvisionPropertyPayload {
  tenantId: string;
  migoPropertyId: string;
  title: string;
  currency: string;
  timezone: string;
  propertyType?: string;
}

export interface ProvisionPropertyResult {
  channexPropertyId: string;
  firestoreDocId: string;
}

export async function provisionProperty(
  payload: ProvisionPropertyPayload,
): Promise<ProvisionPropertyResult> {
  return apiFetch(`${BASE}/properties`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ─── Room Types ───────────────────────────────────────────────────────────────

export interface CreateRoomTypePayload {
  title: string;
  defaultOccupancy: number;
  occAdults: number;
  occChildren?: number;
  occInfants?: number;
}

export async function createRoomType(
  propertyId: string,
  payload: CreateRoomTypePayload,
): Promise<{ id: string }> {
  const res = await apiFetch<{ data: { id: string } }>(
    `${BASE}/properties/${encodeURIComponent(propertyId)}/room-types`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
  return { id: res.data.id };
}

export async function listRoomTypes(propertyId: string): Promise<StoredRoomType[]> {
  return apiFetch(`${BASE}/properties/${encodeURIComponent(propertyId)}/room-types`);
}

// ─── Rate Plans ───────────────────────────────────────────────────────────────

export interface CreateRatePlanPayload {
  title: string;
  currency?: string;
  rate?: number;
  occupancy?: number;
}

export async function createRatePlan(
  propertyId: string,
  roomTypeId: string,
  payload: CreateRatePlanPayload,
): Promise<{ id: string }> {
  const res = await apiFetch<{ data: { id: string } }>(
    `${BASE}/properties/${encodeURIComponent(propertyId)}/room-types/${encodeURIComponent(roomTypeId)}/rate-plans`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
  return { id: res.data.id };
}

// ─── ARI — Availability ───────────────────────────────────────────────────────

export async function pushAvailabilityBatch(
  propertyId: string,
  updates: ARIAvailabilityUpdate[],
): Promise<{ status: 'ok'; taskId: string }> {
  return apiFetch(`${BASE}/properties/${encodeURIComponent(propertyId)}/availability`, {
    method: 'POST',
    body: JSON.stringify({ updates }),
  });
}

// ─── ARI — Restrictions & Rates ──────────────────────────────────────────────

export async function pushRestrictionsBatch(
  propertyId: string,
  updates: ARIRestrictionUpdate[],
): Promise<{ status: 'ok'; taskId: string }> {
  return apiFetch(`${BASE}/properties/${encodeURIComponent(propertyId)}/restrictions`, {
    method: 'POST',
    body: JSON.stringify({ updates }),
  });
}

// ─── ARI — Full Sync ──────────────────────────────────────────────────────────

export interface FullSyncResult {
  availabilityTaskId: string;
  restrictionsTaskId: string;
}

export async function triggerFullSync(
  propertyId: string,
  options: { defaultAvailability: number; defaultRate: string; days?: number },
): Promise<FullSyncResult> {
  return apiFetch(`${BASE}/properties/${encodeURIComponent(propertyId)}/full-sync`, {
    method: 'POST',
    body: JSON.stringify(options),
  });
}
```

- [ ] **Step 2.2: Verify frontend compiles**

```bash
cd apps/frontend && pnpm build 2>&1 | grep -E "error|ERROR" | head -20
```

Expected: no new errors from `channexHubApi.ts`.

- [ ] **Step 2.3: Commit**

```bash
git add apps/frontend/src/channex/api/channexHubApi.ts
git commit -m "feat(channex-hub): add channexHubApi.ts — property/room/rate/ARI API layer"
```

---

## Task 3 — `useChannexProperties` hook

**Files:**
- Create: `apps/frontend/src/channex/hooks/useChannexProperties.ts`

This hook subscribes to ALL `channex_integrations` Firestore docs for a tenant (no `limit(1)`) and derives per-property metadata including which OTA channels are active.

- [ ] **Step 3.1: Create the file**

```typescript
// apps/frontend/src/channex/hooks/useChannexProperties.ts
import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
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
  connected_channels: string[];   // e.g. [], ['airbnb'], ['airbnb','booking']
  room_types: StoredRoomType[];
}

interface Result {
  properties: ChannexProperty[];
  loading: boolean;
  error: string | null;
}

export function useChannexProperties(tenantId: string): Result {
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

    const q = query(
      collection(db, 'channex_integrations'),
      where('tenant_id', '==', tenantId),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const next: ChannexProperty[] = snapshot.docs.map((doc) => {
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
        setProperties(next);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [tenantId]);

  return { properties, loading, error };
}
```

- [ ] **Step 3.2: Verify compilation**

```bash
cd apps/frontend && pnpm build 2>&1 | grep -E "error|ERROR" | head -20
```

- [ ] **Step 3.3: Commit**

```bash
git add apps/frontend/src/channex/hooks/useChannexProperties.ts
git commit -m "feat(channex-hub): add useChannexProperties hook — Firestore subscription for all tenant properties"
```

---

## Task 4 — `ChannexHub.tsx` shell

**Files:**
- Create: `apps/frontend/src/channex/ChannexHub.tsx`

The hub manages which sub-tab is active. Sub-tabs: `properties` (always visible), `airbnb` and `booking` (only rendered, not necessarily visible yet — their visibility logic is added in Task 11). For now, hardcode all three visible for simplicity; Task 11 will make them conditional.

- [ ] **Step 4.1: Create `ChannexHub.tsx`**

```typescript
// apps/frontend/src/channex/ChannexHub.tsx
import AirbnbIntegration from '../integrations/airbnb/AirbnbIntegration';
import BookingIntegrationView from '../integrations/booking/BookingIntegrationView';
import { useChannexProperties } from './hooks/useChannexProperties';
import PropertiesList from './components/PropertiesList';
import PropertyDetail from './components/PropertyDetail';
import PropertySetupWizard from './components/PropertySetupWizard';
import { useState } from 'react';
import type { ChannexProperty } from './hooks/useChannexProperties';

type SubTab = 'properties' | 'airbnb' | 'booking';

interface Props {
  businessId: string;
}

export default function ChannexHub({ businessId }: Props) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('properties');
  const [showWizard, setShowWizard] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<ChannexProperty | null>(null);

  const { properties, loading, error } = useChannexProperties(businessId);

  const hasAirbnb = properties.some((p) => p.connected_channels.includes('airbnb') || p.connection_status === 'active');
  const hasBooking = properties.some((p) => p.connected_channels.includes('booking'));

  const subTabs: { id: SubTab; label: string }[] = [
    { id: 'properties', label: 'Properties' },
    ...(hasAirbnb ? [{ id: 'airbnb' as SubTab, label: 'Airbnb' }] : []),
    ...(hasBooking ? [{ id: 'booking' as SubTab, label: 'Booking.com' }] : []),
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="border-b border-gray-200 px-6 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">
          Channex Channel Manager
        </p>
        <h1 className="text-lg font-semibold text-gray-900">Migo UIT · Property Hub</h1>
      </div>

      {/* Sub-tab bar */}
      <div className="flex items-end gap-0 border-b border-gray-200 px-6">
        {subTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveSubTab(tab.id)}
            className={[
              'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeSubTab === tab.id
                ? 'border-indigo-500 text-indigo-700 bg-white'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {activeSubTab === 'properties' && (
          <>
            {showWizard ? (
              <div className="px-6 py-6">
                <PropertySetupWizard
                  tenantId={businessId}
                  onComplete={(prop) => {
                    setShowWizard(false);
                    setSelectedProperty(prop);
                  }}
                  onCancel={() => setShowWizard(false)}
                />
              </div>
            ) : selectedProperty ? (
              <div className="px-6 py-6">
                <button
                  type="button"
                  onClick={() => setSelectedProperty(null)}
                  className="mb-4 text-sm text-indigo-600 hover:text-indigo-800"
                >
                  ← Back to properties
                </button>
                <PropertyDetail property={selectedProperty} />
              </div>
            ) : (
              <div className="px-6 py-6">
                {loading && (
                  <p className="text-sm text-gray-500">Loading properties…</p>
                )}
                {error && (
                  <p className="text-sm text-red-600">{error}</p>
                )}
                {!loading && !error && (
                  <PropertiesList
                    properties={properties}
                    onSelect={(prop) => setSelectedProperty(prop)}
                    onNew={() => setShowWizard(true)}
                  />
                )}
              </div>
            )}
          </>
        )}

        {activeSubTab === 'airbnb' && (
          <div className="h-full">
            <AirbnbIntegration />
          </div>
        )}

        {activeSubTab === 'booking' && (
          <div className="h-full">
            <BookingIntegrationView businessId={businessId} />
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4.2: Stub missing component files so the project compiles**

Create three stub files (will be replaced in later tasks):

`apps/frontend/src/channex/components/PropertiesList.tsx`:
```typescript
import type { ChannexProperty } from '../hooks/useChannexProperties';

interface Props {
  properties: ChannexProperty[];
  onSelect: (p: ChannexProperty) => void;
  onNew: () => void;
}

export default function PropertiesList({ properties, onSelect, onNew }: Props) {
  return (
    <div>
      <button type="button" onClick={onNew} className="mb-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">
        + New Property
      </button>
      {properties.length === 0 && <p className="text-sm text-gray-500">No properties yet.</p>}
      {properties.map((p) => (
        <button key={p.firestoreDocId} type="button" onClick={() => onSelect(p)} className="block w-full text-left rounded-xl border px-4 py-3 mb-2 hover:bg-gray-50">
          {p.title}
        </button>
      ))}
    </div>
  );
}
```

`apps/frontend/src/channex/components/PropertySetupWizard.tsx`:
```typescript
import type { ChannexProperty } from '../hooks/useChannexProperties';

interface Props {
  tenantId: string;
  onComplete: (prop: ChannexProperty) => void;
  onCancel: () => void;
}

export default function PropertySetupWizard({ onCancel }: Props) {
  return (
    <div>
      <p className="text-sm text-gray-500">Wizard — coming in Task 7</p>
      <button type="button" onClick={onCancel} className="mt-4 text-sm text-gray-500">Cancel</button>
    </div>
  );
}
```

`apps/frontend/src/channex/components/PropertyDetail.tsx`:
```typescript
import type { ChannexProperty } from '../hooks/useChannexProperties';

interface Props {
  property: ChannexProperty;
}

export default function PropertyDetail({ property }: Props) {
  return <div className="text-sm text-gray-500">Detail for {property.title} — coming in Task 10</div>;
}
```

- [ ] **Step 4.3: Verify stubs compile**

```bash
cd apps/frontend && pnpm build 2>&1 | grep -E "error TS" | head -20
```

- [ ] **Step 4.4: Commit stubs**

```bash
git add apps/frontend/src/channex/
git commit -m "feat(channex-hub): add ChannexHub shell + component stubs"
```

---

## Task 5 — Wire `ChannelTabs` + `App.tsx`

**Files:**
- Modify: `apps/frontend/src/components/ChannelTabs/index.tsx`
- Modify: `apps/frontend/src/App.tsx`

- [ ] **Step 5.1: Update `ChannelTabs/index.tsx`**

Replace the file content. The key changes: add `'channex'` to the `Channel` union and `TABS` array; remove `'airbnb'` and `'booking'`.

```typescript
// apps/frontend/src/components/ChannelTabs/index.tsx
export type Channel = 'whatsapp' | 'messenger' | 'instagram' | 'channex';

interface Props {
  active: Channel;
  onChange: (channel: Channel) => void;
}

interface TabDef {
  channel: Channel;
  label: string;
  icon: string;
  activeClass: string;
  disabled?: boolean;
  tooltip?: string;
}

const TABS: TabDef[] = [
  {
    channel: 'whatsapp',
    label: 'WhatsApp',
    icon: '💬',
    activeClass: 'border-green-500 text-green-700',
  },
  {
    channel: 'messenger',
    label: 'Messenger',
    icon: '💙',
    activeClass: 'border-blue-500 text-blue-700',
  },
  {
    channel: 'instagram',
    label: 'Instagram',
    icon: '📸',
    activeClass: 'border-pink-500 text-pink-700',
  },
  {
    channel: 'channex',
    label: 'Channex',
    icon: '🏨',
    activeClass: 'border-indigo-500 text-indigo-700',
  },
];

export default function ChannelTabs({ active, onChange }: Props) {
  return (
    <div className="flex items-end gap-0 border-b border-gray-200">
      {TABS.map((tab) => {
        const isActive = !tab.disabled && tab.channel === active;
        const isDisabled = tab.disabled;

        return (
          <button
            key={tab.channel}
            onClick={() => {
              if (!isDisabled) onChange(tab.channel);
            }}
            disabled={isDisabled}
            title={tab.tooltip}
            className={[
              'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
              isActive
                ? `${tab.activeClass} bg-white`
                : isDisabled
                  ? 'border-transparent text-gray-300 cursor-not-allowed'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
            ].join(' ')}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
            {isDisabled && (
              <span className="text-[10px] font-normal text-gray-400 ml-0.5">(Soon)</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5.2: Update `App.tsx`**

In `App.tsx`, make these targeted changes:

**a) Add import for ChannexHub** (after the existing import for BookingIntegrationView):
```typescript
import ChannexHub from './channex/ChannexHub';
```

**b) Remove the `airbnb` and `booking` integration imports** if they are no longer used outside the ChannexHub. Open `App.tsx` and remove these lines (they will now be imported inside `ChannexHub.tsx` only):
```typescript
// REMOVE these two lines:
import AirbnbIntegration from './integrations/airbnb/AirbnbIntegration';
import BookingIntegrationView from './integrations/booking/BookingIntegrationView';
```

**c) Update `activeChannel` default** — change `useState<Channel>('whatsapp')` to stay on `'whatsapp'` (no change needed, just confirm).

**d) Remove `airbnb`/`booking` derived values** — in App.tsx, `integrationId`, `status`, `metaData`, `messages`, `conversations` are derived per active channel. They only apply to whatsapp/messenger/instagram. Remove the `airbnb`/`booking` cases from any switch/conditional that references the removed channels.

Find the block starting around line 94:
```typescript
const integrationId  = activeChannel === 'whatsapp' ? waIntegrationId
  : activeChannel === 'messenger'  ? msgrIntegrationId
  : activeChannel === 'instagram'  ? igIntegrationId
  : undefined;
```
This already excludes airbnb/booking (returns `undefined` for unknown channels). No change needed.

**e) Replace the airbnb/booking render blocks** — find the JSX section that renders `<AirbnbIntegration />` and `<BookingIntegrationView businessId={businessId} />` based on `activeChannel`. Replace both with a single `<ChannexHub>` branch:

```typescript
{activeChannel === 'channex' && (
  <div className="mt-4">
    <ChannexHub businessId={businessId} />
  </div>
)}
```

Remove the now-unused blocks:
```typescript
// DELETE these:
{activeChannel === 'airbnb' && (
  <div className="mt-4">
    <AirbnbIntegration />
  </div>
)}
{activeChannel === 'booking' && (
  <div className="mt-4">
    <BookingIntegrationView businessId={businessId} />
  </div>
)}
```

- [ ] **Step 5.3: Verify compilation**

```bash
cd apps/frontend && pnpm build 2>&1 | grep -E "error TS" | head -20
```

Expected: no errors related to the Channel type or removed imports.

- [ ] **Step 5.4: Manual verification**

Start the dev server:
```bash
cd apps/frontend && pnpm dev
```
Navigate to `http://localhost:5173`. Confirm: the tab bar shows WhatsApp, Messenger, Instagram, Channex. Clicking Channex shows the hub with "Properties" sub-tab. No Airbnb or Booking.com top-level tabs.

- [ ] **Step 5.5: Commit**

```bash
git add apps/frontend/src/components/ChannelTabs/index.tsx apps/frontend/src/App.tsx
git commit -m "feat(channex-hub): replace airbnb/booking top-level tabs with Channex hub"
```

---

## Task 6 — `PropertiesList.tsx` (full implementation)

**Files:**
- Modify: `apps/frontend/src/channex/components/PropertiesList.tsx`

Replace the stub with the full implementation.

- [ ] **Step 6.1: Implement `PropertiesList`**

```typescript
// apps/frontend/src/channex/components/PropertiesList.tsx
import type { ChannexProperty } from '../hooks/useChannexProperties';

interface Props {
  properties: ChannexProperty[];
  onSelect: (property: ChannexProperty) => void;
  onNew: () => void;
}

function OTABadge({ channel }: { channel: string }) {
  const styles: Record<string, string> = {
    airbnb: 'bg-rose-100 text-rose-700',
    booking: 'bg-blue-100 text-blue-700',
  };
  const labels: Record<string, string> = {
    airbnb: 'Airbnb',
    booking: 'Booking.com',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] ${styles[channel] ?? 'bg-slate-100 text-slate-600'}`}
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
        ? 'bg-amber-400'
        : 'bg-red-400';
  return <span className={`h-2 w-2 rounded-full ${color}`} />;
}

export default function PropertiesList({ properties, onSelect, onNew }: Props) {
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Properties</h2>
          <p className="text-sm text-slate-500">
            Manage Channex properties, room types, rate plans, and ARI.
          </p>
        </div>
        <button
          type="button"
          onClick={onNew}
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
        >
          + New Property
        </button>
      </div>

      {properties.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 px-8 py-12 text-center">
          <p className="text-sm font-medium text-slate-700">No properties yet</p>
          <p className="mt-1 text-sm text-slate-500">
            Create a property to start managing ARI and connecting OTA channels.
          </p>
          <button
            type="button"
            onClick={onNew}
            className="mt-4 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Create first property
          </button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {properties.map((property) => (
            <button
              key={property.firestoreDocId}
              type="button"
              onClick={() => onSelect(property)}
              className="group rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-indigo-300 hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-slate-900 group-hover:text-indigo-700">
                  {property.title}
                </p>
                <StatusDot status={property.connection_status} />
              </div>

              <p className="mt-1 text-xs text-slate-500">
                {property.currency} · {property.timezone}
              </p>

              <p className="mt-1 text-xs text-slate-500">
                {property.room_types.length} room type{property.room_types.length !== 1 ? 's' : ''}
              </p>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {property.connected_channels.length === 0 ? (
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                    Channex
                  </span>
                ) : (
                  property.connected_channels.map((ch) => (
                    <OTABadge key={ch} channel={ch} />
                  ))
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6.2: Verify compilation and visual**

```bash
cd apps/frontend && pnpm build 2>&1 | grep -E "error TS" | head -20
```

Start dev server and navigate to Channex tab → Properties. Confirm: empty state CTA visible with no properties; list renders cards with OTA badges when properties exist.

- [ ] **Step 6.3: Commit**

```bash
git add apps/frontend/src/channex/components/PropertiesList.tsx
git commit -m "feat(channex-hub): implement PropertiesList with OTA badges and status dots"
```

---

## Task 7 — `PropertySetupWizard.tsx`

**Files:**
- Modify: `apps/frontend/src/channex/components/PropertySetupWizard.tsx`

4-step wizard: Step 1 = property details, Step 2 = room types, Step 3 = rate plans, Step 4 = confirmation with task IDs.

- [ ] **Step 7.1: Implement the wizard**

```typescript
// apps/frontend/src/channex/components/PropertySetupWizard.tsx
import { useState } from 'react';
import {
  provisionProperty,
  createRoomType,
  createRatePlan,
} from '../api/channexHubApi';
import type { ChannexProperty } from '../hooks/useChannexProperties';

interface RoomDraft {
  title: string;
  defaultOccupancy: number;
  roomTypeId?: string;
}

interface RateDraft {
  roomTypeId: string;
  roomTitle: string;
  title: string;
  rate: number;
  ratePlanId?: string;
}

interface Props {
  tenantId: string;
  onComplete: (prop: ChannexProperty) => void;
  onCancel: () => void;
}

type Step = 1 | 2 | 3 | 4;

export default function PropertySetupWizard({ tenantId, onComplete, onCancel }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1
  const [title, setTitle] = useState(`Test Property - Migo UIT`);
  const [currency, setCurrency] = useState('USD');
  const [timezone, setTimezone] = useState('America/New_York');

  // Step 2
  const [rooms, setRooms] = useState<RoomDraft[]>([
    { title: 'Twin Room', defaultOccupancy: 2 },
    { title: 'Double Room', defaultOccupancy: 2 },
  ]);

  // Step 3
  const [rates, setRates] = useState<RateDraft[]>([]);

  // Step 4
  const [channexPropertyId, setChannexPropertyId] = useState('');
  const [firestoreDocId, setFirestoreDocId] = useState('');

  // ─── Step 1 → 2 ───────────────────────────────────────────────────────────

  async function handleStep1() {
    setSaving(true);
    setError(null);
    try {
      const result = await provisionProperty({
        tenantId,
        migoPropertyId: `${tenantId}-${Date.now()}`,
        title,
        currency,
        timezone,
      });
      setChannexPropertyId(result.channexPropertyId);
      setFirestoreDocId(result.firestoreDocId);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create property.');
    } finally {
      setSaving(false);
    }
  }

  // ─── Step 2 → 3 ───────────────────────────────────────────────────────────

  async function handleStep2() {
    setSaving(true);
    setError(null);
    try {
      const created: RoomDraft[] = [];
      for (const room of rooms) {
        const { id } = await createRoomType(channexPropertyId, {
          title: room.title,
          defaultOccupancy: room.defaultOccupancy,
          occAdults: room.defaultOccupancy,
        });
        created.push({ ...room, roomTypeId: id });
      }
      setRooms(created);
      // Pre-populate rate plan drafts: BAR + B&B for each room
      const drafts: RateDraft[] = [];
      for (const room of created) {
        if (!room.roomTypeId) continue;
        drafts.push(
          { roomTypeId: room.roomTypeId, roomTitle: room.title, title: 'Best Available Rate', rate: 100 },
          { roomTypeId: room.roomTypeId, roomTitle: room.title, title: 'Bed and Breakfast', rate: 120 },
        );
      }
      setRates(drafts);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create room types.');
    } finally {
      setSaving(false);
    }
  }

  // ─── Step 3 → 4 ───────────────────────────────────────────────────────────

  async function handleStep3() {
    setSaving(true);
    setError(null);
    try {
      const created: RateDraft[] = [];
      for (const rate of rates) {
        const { id } = await createRatePlan(channexPropertyId, rate.roomTypeId, {
          title: rate.title,
          currency,
          rate: rate.rate,
          occupancy: 2,
        });
        created.push({ ...rate, ratePlanId: id });
      }
      setRates(created);
      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create rate plans.');
    } finally {
      setSaving(false);
    }
  }

  // ─── Step 4 → complete ────────────────────────────────────────────────────

  function handleFinish() {
    onComplete({
      firestoreDocId,
      channex_property_id: channexPropertyId,
      title,
      currency,
      timezone,
      connection_status: 'pending',
      connected_channels: [],
      room_types: rooms
        .flatMap((r) =>
          rates
            .filter((rt) => rt.roomTypeId === r.roomTypeId)
            .map((rt) => ({
              room_type_id: r.roomTypeId!,
              title: r.title,
              default_occupancy: r.defaultOccupancy,
              rate_plan_id: rt.ratePlanId ?? null,
            })),
        ),
    });
  }

  const stepLabels = ['Property details', 'Room types', 'Rate plans', 'Confirm'];

  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      {/* Progress */}
      <div className="mb-6 flex items-center gap-2">
        {stepLabels.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                step > i + 1
                  ? 'bg-emerald-500 text-white'
                  : step === i + 1
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-400'
              }`}
            >
              {step > i + 1 ? '✓' : i + 1}
            </div>
            <span
              className={`text-xs font-medium ${step === i + 1 ? 'text-slate-900' : 'text-slate-400'}`}
            >
              {label}
            </span>
            {i < stepLabels.length - 1 && (
              <div className="h-px w-6 bg-slate-200" />
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Step 1: Property details */}
      {step === 1 && (
        <div className="space-y-4">
          <h3 className="text-base font-semibold text-slate-900">Property details</h3>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Name</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Currency</label>
              <input
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Timezone</label>
              <input
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          <div className="flex justify-between pt-2">
            <button type="button" onClick={onCancel} className="text-sm text-slate-500 hover:text-slate-700">Cancel</button>
            <button
              type="button"
              onClick={() => void handleStep1()}
              disabled={saving || !title}
              className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Creating…' : 'Create Property →'}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Room types */}
      {step === 2 && (
        <div className="space-y-4">
          <h3 className="text-base font-semibold text-slate-900">Room types</h3>
          <p className="text-sm text-slate-500">
            Property ID: <code className="font-mono text-xs text-indigo-700">{channexPropertyId}</code>
          </p>
          {rooms.map((room, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3">
              <div className="flex-1">
                <input
                  value={room.title}
                  onChange={(e) => {
                    const next = [...rooms];
                    next[i] = { ...room, title: e.target.value };
                    setRooms(next);
                  }}
                  className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
              <div className="w-28">
                <label className="block text-[11px] text-slate-500">Occupancy</label>
                <input
                  type="number"
                  min={1}
                  value={room.defaultOccupancy}
                  onChange={(e) => {
                    const next = [...rooms];
                    next[i] = { ...room, defaultOccupancy: Number(e.target.value) };
                    setRooms(next);
                  }}
                  className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
              <button
                type="button"
                onClick={() => setRooms(rooms.filter((_, j) => j !== i))}
                className="text-slate-400 hover:text-red-500"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setRooms([...rooms, { title: '', defaultOccupancy: 2 }])}
            className="text-sm text-indigo-600 hover:text-indigo-800"
          >
            + Add room type
          </button>
          <div className="flex justify-between pt-2">
            <button type="button" onClick={() => setStep(1)} className="text-sm text-slate-500 hover:text-slate-700">← Back</button>
            <button
              type="button"
              onClick={() => void handleStep2()}
              disabled={saving || rooms.length === 0}
              className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Creating…' : 'Create Room Types →'}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Rate plans */}
      {step === 3 && (
        <div className="space-y-4">
          <h3 className="text-base font-semibold text-slate-900">Rate plans</h3>
          {rates.map((rate, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3">
              <div className="flex-1">
                <label className="block text-[11px] text-slate-500">{rate.roomTitle}</label>
                <input
                  value={rate.title}
                  onChange={(e) => {
                    const next = [...rates];
                    next[i] = { ...rate, title: e.target.value };
                    setRates(next);
                  }}
                  className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
                />
              </div>
              <div className="w-24">
                <label className="block text-[11px] text-slate-500">Base rate</label>
                <input
                  type="number"
                  min={0}
                  value={rate.rate}
                  onChange={(e) => {
                    const next = [...rates];
                    next[i] = { ...rate, rate: Number(e.target.value) };
                    setRates(next);
                  }}
                  className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
                />
              </div>
            </div>
          ))}
          <div className="flex justify-between pt-2">
            <button type="button" onClick={() => setStep(2)} className="text-sm text-slate-500 hover:text-slate-700">← Back</button>
            <button
              type="button"
              onClick={() => void handleStep3()}
              disabled={saving || rates.length === 0}
              className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Creating…' : 'Create Rate Plans →'}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Confirmation */}
      {step === 4 && (
        <div className="space-y-4">
          <h3 className="text-base font-semibold text-slate-900">Setup complete</h3>
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 space-y-2 text-xs font-mono">
            <p><span className="text-slate-500">Property ID:</span> <span className="text-emerald-700">{channexPropertyId}</span></p>
            {rooms.map((r) => (
              <p key={r.roomTypeId}><span className="text-slate-500">{r.title}:</span> <span className="text-emerald-700">{r.roomTypeId}</span></p>
            ))}
            {rates.map((r, i) => (
              <p key={i}><span className="text-slate-500">{r.roomTitle} / {r.title}:</span> <span className="text-emerald-700">{r.ratePlanId}</span></p>
            ))}
          </div>
          <p className="text-xs text-slate-500">Save these IDs for the Channex certification form (Section 2).</p>
          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={handleFinish}
              className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Go to property →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7.2: Verify compilation**

```bash
cd apps/frontend && pnpm build 2>&1 | grep -E "error TS" | head -20
```

- [ ] **Step 7.3: Manual flow test**

With backend running (`cd apps/backend && pnpm dev`):
1. Navigate to Channex tab → Properties
2. Click "New Property"
3. Step 1: defaults to "Test Property - Migo UIT", USD, America/New_York — click "Create Property"
4. Step 2: Two rooms pre-populated — click "Create Room Types"
5. Step 3: Four rate plans pre-populated — click "Create Rate Plans"
6. Step 4: Confirm UUIDs visible for all entities

Verify in Channex staging dashboard (`https://staging.channex.io/properties`) that the property, room types, and rate plans were created.

- [ ] **Step 7.4: Commit**

```bash
git add apps/frontend/src/channex/components/PropertySetupWizard.tsx
git commit -m "feat(channex-hub): implement PropertySetupWizard — 4-step property + rooms + rates creation"
```

---

## Task 8 — `RoomRateManager.tsx`

**Files:**
- Create: `apps/frontend/src/channex/components/RoomRateManager.tsx`

Shows existing room types and rate plans for a property (read from backend). Allows adding new ones.

- [ ] **Step 8.1: Implement `RoomRateManager`**

```typescript
// apps/frontend/src/channex/components/RoomRateManager.tsx
import { useCallback, useEffect, useState } from 'react';
import {
  listRoomTypes,
  createRoomType,
  createRatePlan,
  type StoredRoomType,
} from '../api/channexHubApi';

interface Props {
  propertyId: string;
  currency: string;
}

export default function RoomRateManager({ propertyId, currency }: Props) {
  const [roomTypes, setRoomTypes] = useState<StoredRoomType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add room type form
  const [showRoomForm, setShowRoomForm] = useState(false);
  const [newRoomTitle, setNewRoomTitle] = useState('');
  const [newRoomOccupancy, setNewRoomOccupancy] = useState(2);
  const [savingRoom, setSavingRoom] = useState(false);

  // Add rate plan form
  const [showRateForm, setShowRateForm] = useState<string | null>(null); // roomTypeId
  const [newRateTitle, setNewRateTitle] = useState('');
  const [newRateAmount, setNewRateAmount] = useState(100);
  const [savingRate, setSavingRate] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listRoomTypes(propertyId);
      setRoomTypes(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load room types.');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => { void reload(); }, [reload]);

  async function handleAddRoom() {
    if (!newRoomTitle) return;
    setSavingRoom(true);
    try {
      await createRoomType(propertyId, {
        title: newRoomTitle,
        defaultOccupancy: newRoomOccupancy,
        occAdults: newRoomOccupancy,
      });
      setNewRoomTitle('');
      setNewRoomOccupancy(2);
      setShowRoomForm(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create room type.');
    } finally {
      setSavingRoom(false);
    }
  }

  async function handleAddRate(roomTypeId: string) {
    if (!newRateTitle) return;
    setSavingRate(true);
    try {
      await createRatePlan(propertyId, roomTypeId, {
        title: newRateTitle,
        currency,
        rate: newRateAmount,
        occupancy: 2,
      });
      setNewRateTitle('');
      setNewRateAmount(100);
      setShowRateForm(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create rate plan.');
    } finally {
      setSavingRate(false);
    }
  }

  // Group room types by room_type_id (multiple entries = multiple rate plans)
  const grouped = roomTypes.reduce<Record<string, StoredRoomType[]>>((acc, rt) => {
    const key = rt.room_type_id;
    if (!acc[key]) acc[key] = [];
    acc[key].push(rt);
    return acc;
  }, {});

  if (loading) return <p className="text-sm text-slate-500">Loading room types…</p>;

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {Object.entries(grouped).map(([roomTypeId, entries]) => (
        <div key={roomTypeId} className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-slate-900">{entries[0].title}</p>
              <p className="text-xs text-slate-500 font-mono">{roomTypeId}</p>
            </div>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
              Occupancy {entries[0].default_occupancy}
            </span>
          </div>

          <div className="mt-3 space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Rate Plans</p>
            {entries.map((rt) =>
              rt.rate_plan_id ? (
                <div key={rt.rate_plan_id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                  <span className="text-sm text-slate-700">{rt.title}</span>
                  <span className="font-mono text-xs text-slate-500">{rt.rate_plan_id}</span>
                </div>
              ) : null,
            )}

            {showRateForm === roomTypeId ? (
              <div className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2">
                <input
                  value={newRateTitle}
                  onChange={(e) => setNewRateTitle(e.target.value)}
                  placeholder="Rate plan name"
                  className="flex-1 rounded-lg border border-slate-200 px-2 py-1 text-xs"
                />
                <input
                  type="number"
                  min={0}
                  value={newRateAmount}
                  onChange={(e) => setNewRateAmount(Number(e.target.value))}
                  placeholder="Base rate"
                  className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-xs"
                />
                <button
                  type="button"
                  onClick={() => void handleAddRate(roomTypeId)}
                  disabled={savingRate || !newRateTitle}
                  className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {savingRate ? '…' : 'Add'}
                </button>
                <button type="button" onClick={() => setShowRateForm(null)} className="text-slate-400 hover:text-slate-600">✕</button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { setShowRateForm(roomTypeId); setNewRateTitle(''); setNewRateAmount(100); }}
                className="text-xs text-indigo-600 hover:text-indigo-800"
              >
                + Add rate plan
              </button>
            )}
          </div>
        </div>
      ))}

      {showRoomForm ? (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 space-y-3">
          <p className="text-sm font-semibold text-slate-900">New room type</p>
          <div className="flex items-center gap-3">
            <input
              value={newRoomTitle}
              onChange={(e) => setNewRoomTitle(e.target.value)}
              placeholder="Room name"
              className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
            <input
              type="number"
              min={1}
              value={newRoomOccupancy}
              onChange={(e) => setNewRoomOccupancy(Number(e.target.value))}
              className="w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleAddRoom()}
              disabled={savingRoom || !newRoomTitle}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {savingRoom ? 'Creating…' : 'Create Room Type'}
            </button>
            <button type="button" onClick={() => setShowRoomForm(false)} className="text-sm text-slate-500">Cancel</button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowRoomForm(true)}
          className="rounded-xl border-2 border-dashed border-slate-200 px-4 py-3 text-sm text-slate-500 hover:border-indigo-300 hover:text-indigo-600 w-full"
        >
          + Add room type
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 8.2: Verify compilation**

```bash
cd apps/frontend && pnpm build 2>&1 | grep -E "error TS" | head -20
```

- [ ] **Step 8.3: Commit**

```bash
git add apps/frontend/src/channex/components/RoomRateManager.tsx
git commit -m "feat(channex-hub): implement RoomRateManager — room type + rate plan CRUD"
```

---

## Task 9 — `ARICalendarFull.tsx`

**Files:**
- Create: `apps/frontend/src/channex/components/ARICalendarFull.tsx`

Month-grid calendar for date-range selection. When a range is selected, shows a side panel with: room type selector, rate plan selector, availability (numeric), rate (price), min_stay, stop_sell, CTA, CTD checkboxes. On save, fires availability and/or restrictions batch calls and displays the returned taskIds. Also has a Full Sync button.

- [ ] **Step 9.1: Implement `ARICalendarFull`**

```typescript
// apps/frontend/src/channex/components/ARICalendarFull.tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listRoomTypes,
  pushAvailabilityBatch,
  pushRestrictionsBatch,
  triggerFullSync,
  type StoredRoomType,
  type FullSyncResult,
} from '../api/channexHubApi';

interface Props {
  propertyId: string;
  currency: string;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + n);
  return next;
}

function startOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function endOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

export default function ARICalendarFull({ propertyId, currency }: Props) {
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => startOfMonthUtc(new Date()));
  const [roomTypes, setRoomTypes] = useState<StoredRoomType[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);

  const [selectionStart, setSelectionStart] = useState<string | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<string | null>(null);
  const [showPanel, setShowPanel] = useState(false);

  // ARI panel state
  const [selectedRoomTypeId, setSelectedRoomTypeId] = useState('');
  const [selectedRatePlanId, setSelectedRatePlanId] = useState('');
  const [availability, setAvailability] = useState<number | ''>('');
  const [rate, setRate] = useState('');
  const [minStay, setMinStay] = useState<number | ''>('');
  const [stopSell, setStopSell] = useState(false);
  const [closedToArrival, setClosedToArrival] = useState(false);
  const [closedToDeparture, setClosedToDeparture] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastTaskIds, setLastTaskIds] = useState<string[]>([]);

  // Full sync state
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncAvailability, setSyncAvailability] = useState(1);
  const [syncRate, setSyncRate] = useState('100');
  const [syncDays, setSyncDays] = useState(500);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<FullSyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    setLoadingRooms(true);
    listRoomTypes(propertyId)
      .then((data) => {
        setRoomTypes(data);
        // Auto-select first room type and rate plan
        const firstWithRate = data.find((rt) => rt.rate_plan_id);
        if (firstWithRate) {
          setSelectedRoomTypeId(firstWithRate.room_type_id);
          setSelectedRatePlanId(firstWithRate.rate_plan_id ?? '');
        }
      })
      .catch(() => {})
      .finally(() => setLoadingRooms(false));
  }, [propertyId]);

  const monthStart = useMemo(() => startOfMonthUtc(visibleMonth), [visibleMonth]);
  const monthEnd = useMemo(() => endOfMonthUtc(visibleMonth), [visibleMonth]);
  const gridStart = useMemo(() => addDays(monthStart, -monthStart.getUTCDay()), [monthStart]);
  const gridEnd = useMemo(() => addDays(monthEnd, 6 - monthEnd.getUTCDay()), [monthEnd]);

  const calendarDates = useMemo(() => {
    const dates: Date[] = [];
    for (let cur = new Date(gridStart); cur <= gridEnd; cur = addDays(cur, 1)) {
      dates.push(new Date(cur));
    }
    return dates;
  }, [gridEnd, gridStart]);

  const weeks = useMemo(() => {
    const rows: Date[][] = [];
    for (let i = 0; i < calendarDates.length; i += 7) {
      rows.push(calendarDates.slice(i, i + 7));
    }
    return rows;
  }, [calendarDates]);

  const selectedRange = useMemo((): [string, string] | null => {
    if (!selectionStart) return null;
    const end = selectionEnd ?? selectionStart;
    return selectionStart <= end ? [selectionStart, end] : [end, selectionStart];
  }, [selectionStart, selectionEnd]);

  const isSelected = useCallback(
    (ds: string) => Boolean(selectedRange && ds >= selectedRange[0] && ds <= selectedRange[1]),
    [selectedRange],
  );

  const handleCellClick = useCallback(
    (ds: string) => {
      if (!selectionStart || selectionEnd) {
        setSelectionStart(ds);
        setSelectionEnd(null);
        setShowPanel(false);
        setSaveError(null);
        setLastTaskIds([]);
        return;
      }
      const end = ds >= selectionStart ? ds : selectionStart;
      const start = ds < selectionStart ? ds : selectionStart;
      setSelectionStart(start);
      setSelectionEnd(end);
      setShowPanel(true);
      setSaveError(null);
    },
    [selectionEnd, selectionStart],
  );

  // Derived: rate plans available for selected room type
  const ratePlansForRoom = useMemo(
    () => roomTypes.filter((rt) => rt.room_type_id === selectedRoomTypeId && rt.rate_plan_id),
    [roomTypes, selectedRoomTypeId],
  );

  // Unique room types (deduplicated)
  const uniqueRooms = useMemo(() => {
    const seen = new Set<string>();
    return roomTypes.filter((rt) => {
      if (seen.has(rt.room_type_id)) return false;
      seen.add(rt.room_type_id);
      return true;
    });
  }, [roomTypes]);

  async function handleSave() {
    if (!selectedRange) return;
    const [dateFrom, dateTo] = selectedRange;
    setSaving(true);
    setSaveError(null);
    const taskIds: string[] = [];

    try {
      if (availability !== '') {
        const res = await pushAvailabilityBatch(propertyId, [
          { room_type_id: selectedRoomTypeId, date_from: dateFrom, date_to: dateTo, availability: Number(availability) },
        ]);
        taskIds.push(res.taskId);
      }

      const hasRestriction =
        rate !== '' || minStay !== '' || stopSell || closedToArrival || closedToDeparture;

      if (hasRestriction && selectedRatePlanId) {
        const res = await pushRestrictionsBatch(propertyId, [
          {
            rate_plan_id: selectedRatePlanId,
            date_from: dateFrom,
            date_to: dateTo,
            ...(rate !== '' ? { rate: String(rate) } : {}),
            ...(minStay !== '' ? { min_stay_arrival: Number(minStay) } : {}),
            ...(stopSell ? { stop_sell: true } : {}),
            ...(closedToArrival ? { closed_to_arrival: true } : {}),
            ...(closedToDeparture ? { closed_to_departure: true } : {}),
          },
        ]);
        taskIds.push(res.taskId);
      }

      setLastTaskIds(taskIds);
      setShowPanel(false);
      setSelectionStart(null);
      setSelectionEnd(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  async function handleFullSync() {
    setSyncing(true);
    setSyncError(null);
    setSyncResult(null);
    try {
      const result = await triggerFullSync(propertyId, {
        defaultAvailability: syncAvailability,
        defaultRate: syncRate,
        days: syncDays,
      });
      setSyncResult(result);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Full sync failed.');
    } finally {
      setSyncing(false);
    }
  }

  const monthLabel = useMemo(
    () => visibleMonth.toLocaleString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    [visibleMonth],
  );

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-900">ARI Calendar</h3>
          <p className="text-xs text-slate-500">Click a date to start a range, click another to end and open the update panel.</p>
        </div>
        <button
          type="button"
          onClick={() => { setShowSyncModal(true); setSyncResult(null); setSyncError(null); }}
          className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
        >
          Full Sync (500 days)
        </button>
      </div>

      {/* Task ID display after save */}
      {lastTaskIds.length > 0 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-xs font-semibold text-emerald-700 uppercase tracking-[0.1em]">Task IDs (save for certification form)</p>
          {lastTaskIds.map((id) => (
            <p key={id} className="mt-1 font-mono text-xs text-emerald-800">{id}</p>
          ))}
        </div>
      )}

      {loadingRooms ? (
        <p className="text-sm text-slate-500">Loading room types…</p>
      ) : (
        <>
          {/* Month navigation */}
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setVisibleMonth((m) => new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() - 1, 1)))}
              className="rounded-lg border px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">Prev</button>
            <span className="min-w-36 text-center text-sm font-semibold text-slate-900">{monthLabel}</span>
            <button type="button" onClick={() => setVisibleMonth((m) => new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1)))}
              className="rounded-lg border px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">Next</button>
          </div>

          {/* Calendar grid */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white select-none" onMouseDown={(e) => e.preventDefault()}>
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
              {WEEKDAY_LABELS.map((d) => (
                <div key={d} className="py-2 text-center text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{d}</div>
              ))}
            </div>
            <div className="divide-y divide-slate-200">
              {weeks.map((weekDates) => (
                <div key={isoDate(weekDates[0])} className="grid grid-cols-7">
                  {weekDates.map((date) => {
                    const ds = isoDate(date);
                    const inMonth = date.getUTCMonth() === visibleMonth.getUTCMonth();
                    const sel = isSelected(ds);
                    return (
                      <div
                        key={ds}
                        onClick={() => handleCellClick(ds)}
                        className={[
                          'flex flex-col items-start p-2 border border-slate-200 cursor-pointer min-h-[52px] transition-colors',
                          sel ? 'bg-indigo-100 ring-2 ring-inset ring-indigo-500 z-10' : 'hover:bg-slate-50',
                          !inMonth ? 'bg-slate-50/70 text-slate-300' : '',
                        ].join(' ')}
                        onMouseDown={(e) => e.preventDefault()}
                      >
                        <span className="text-sm font-medium text-slate-700">{date.getUTCDate()}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ARI Control Panel (side-sheet) */}
      {showPanel && selectedRange && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => { if (!saving) setShowPanel(false); }} />
          <div className="fixed inset-y-0 right-0 z-50 w-96 border-l border-gray-200 bg-white p-6 shadow-2xl overflow-y-auto">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">Update ARI</h2>
              <button type="button" onClick={() => { if (!saving) setShowPanel(false); }} className="text-gray-400 hover:text-gray-700 disabled:opacity-50" disabled={saving}>✕</button>
            </div>

            <div className="mb-4 rounded-xl bg-slate-50 px-3 py-2 text-sm">
              <span className="text-slate-500">Range: </span>
              <span className="font-semibold text-slate-900">{selectedRange[0]} → {selectedRange[1]}</span>
            </div>

            <div className="space-y-4">
              {/* Room Type selector */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Room Type</label>
                <select
                  value={selectedRoomTypeId}
                  onChange={(e) => {
                    setSelectedRoomTypeId(e.target.value);
                    const firstRate = roomTypes.find((rt) => rt.room_type_id === e.target.value && rt.rate_plan_id);
                    setSelectedRatePlanId(firstRate?.rate_plan_id ?? '');
                  }}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">— select —</option>
                  {uniqueRooms.map((rt) => (
                    <option key={rt.room_type_id} value={rt.room_type_id}>{rt.title}</option>
                  ))}
                </select>
              </div>

              {/* Rate Plan selector */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Rate Plan</label>
                <select
                  value={selectedRatePlanId}
                  onChange={(e) => setSelectedRatePlanId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">— select —</option>
                  {ratePlansForRoom.map((rt) => (
                    <option key={rt.rate_plan_id!} value={rt.rate_plan_id!}>{rt.title}</option>
                  ))}
                </select>
              </div>

              <hr className="border-slate-200" />

              {/* Availability */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">
                  Availability (units) — leave blank to skip
                </label>
                <input
                  type="number"
                  min={0}
                  value={availability}
                  onChange={(e) => setAvailability(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="e.g. 7"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <hr className="border-slate-200" />

              {/* Rate */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">
                  Rate ({currency}) — leave blank to skip
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  placeholder="e.g. 333"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Min Stay */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">
                  Min Stay (nights) — leave blank to skip
                </label>
                <input
                  type="number"
                  min={1}
                  value={minStay}
                  onChange={(e) => setMinStay(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="e.g. 3"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Restriction checkboxes */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Restrictions</p>
                {[
                  { id: 'stop_sell', label: 'Stop Sell', value: stopSell, set: setStopSell },
                  { id: 'cta', label: 'Closed to Arrival', value: closedToArrival, set: setClosedToArrival },
                  { id: 'ctd', label: 'Closed to Departure', value: closedToDeparture, set: setClosedToDeparture },
                ].map(({ id, label, value, set }) => (
                  <label key={id} className="flex cursor-pointer items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={value}
                      onChange={(e) => set(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-sm text-slate-700">{label}</span>
                  </label>
                ))}
              </div>
            </div>

            {saveError && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{saveError}</div>
            )}

            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || (!selectedRoomTypeId && availability === '')}
              className="mt-6 w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Updates'}
            </button>
          </div>
        </>
      )}

      {/* Full Sync modal */}
      {showSyncModal && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => { if (!syncing) setShowSyncModal(false); }} />
          <div className="fixed inset-x-4 top-1/3 z-50 mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <h3 className="text-base font-bold text-slate-900">Full Sync</h3>
            <p className="mt-1 text-sm text-slate-500">
              Sends {syncDays} days of ARI for all room types and rate plans in 2 Channex API calls. This is Test #1 of the certification.
            </p>
            <div className="mt-4 grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Availability</label>
                <input
                  type="number"
                  min={0}
                  value={syncAvailability}
                  onChange={(e) => setSyncAvailability(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Rate ({currency})</label>
                <input
                  value={syncRate}
                  onChange={(e) => setSyncRate(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Days</label>
                <input
                  type="number"
                  min={1}
                  value={syncDays}
                  onChange={(e) => setSyncDays(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
            </div>
            {syncError && (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{syncError}</div>
            )}
            {syncResult && (
              <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 space-y-1">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-emerald-700">Task IDs</p>
                <p className="font-mono text-xs text-emerald-800">Availability: {syncResult.availabilityTaskId}</p>
                <p className="font-mono text-xs text-emerald-800">Restrictions: {syncResult.restrictionsTaskId}</p>
              </div>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setShowSyncModal(false)} disabled={syncing} className="text-sm text-slate-500">Cancel</button>
              <button
                type="button"
                onClick={() => void handleFullSync()}
                disabled={syncing}
                className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {syncing ? 'Syncing…' : 'Run Full Sync'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 9.2: Verify compilation**

```bash
cd apps/frontend && pnpm build 2>&1 | grep -E "error TS" | head -20
```

- [ ] **Step 9.3: Manual test — availability update (Test #9)**

With backend running and the test property created in Task 7:
1. Go to Channex → Properties → select test property → ARI Calendar tab
2. Click Nov 21, click Nov 21 again (same date)
3. In panel: select Twin Room, no rate plan needed, set Availability = 7
4. Save → confirm taskId appears

- [ ] **Step 9.4: Manual test — rate update (Test #2)**

1. Click Nov 22, click Nov 22 again
2. In panel: select Twin Room, select Best Available Rate, leave Availability blank, set Rate = 333
3. Save → confirm taskId appears

- [ ] **Step 9.5: Commit**

```bash
git add apps/frontend/src/channex/components/ARICalendarFull.tsx
git commit -m "feat(channex-hub): implement ARICalendarFull — full ARI calendar with rate/restriction panel"
```

---

## Task 10 — `PropertyDetail.tsx` (full implementation)

**Files:**
- Modify: `apps/frontend/src/channex/components/PropertyDetail.tsx`

Replace the stub with two inner tabs: "Rooms & Rates" and "ARI Calendar".

- [ ] **Step 10.1: Implement `PropertyDetail`**

```typescript
// apps/frontend/src/channex/components/PropertyDetail.tsx
import { useState } from 'react';
import type { ChannexProperty } from '../hooks/useChannexProperties';
import RoomRateManager from './RoomRateManager';
import ARICalendarFull from './ARICalendarFull';

type InnerTab = 'rooms' | 'ari';

interface Props {
  property: ChannexProperty;
}

export default function PropertyDetail({ property }: Props) {
  const [innerTab, setInnerTab] = useState<InnerTab>('rooms');

  return (
    <div>
      {/* Property header */}
      <div className="mb-5 rounded-2xl border border-slate-200 bg-white px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{property.title}</h2>
            <p className="mt-0.5 font-mono text-xs text-slate-500">{property.channex_property_id}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">{property.currency} · {property.timezone}</p>
            <span
              className={`mt-1 inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase ${
                property.connection_status === 'active'
                  ? 'bg-emerald-100 text-emerald-700'
                  : property.connection_status === 'pending'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-red-100 text-red-700'
              }`}
            >
              {property.connection_status}
            </span>
          </div>
        </div>
      </div>

      {/* Inner tabs */}
      <div className="mb-4 flex gap-0 border-b border-slate-200">
        {([
          { id: 'rooms' as InnerTab, label: 'Rooms & Rates' },
          { id: 'ari' as InnerTab, label: 'ARI Calendar' },
        ] as const).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setInnerTab(tab.id)}
            className={[
              'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              innerTab === tab.id
                ? 'border-indigo-500 text-indigo-700'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {innerTab === 'rooms' && (
        <RoomRateManager
          propertyId={property.channex_property_id}
          currency={property.currency}
        />
      )}

      {innerTab === 'ari' && (
        <ARICalendarFull
          propertyId={property.channex_property_id}
          currency={property.currency}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 10.2: Verify compilation**

```bash
cd apps/frontend && pnpm build 2>&1 | grep -E "error TS" | head -20
```

- [ ] **Step 10.3: End-to-end flow test**

1. Channex tab → Properties → select a property
2. Rooms & Rates tab: room types and rate plans visible; can add new ones
3. ARI Calendar tab: calendar renders; can select date range; panel shows room/rate selectors, availability, rate, restrictions fields; save returns taskId; Full Sync modal works

- [ ] **Step 10.4: Commit**

```bash
git add apps/frontend/src/channex/components/PropertyDetail.tsx
git commit -m "feat(channex-hub): implement PropertyDetail — Rooms & Rates + ARI Calendar inner tabs"
```

---

## Task 11 — Final wiring: Airbnb/Booking.com sub-tabs + `connected_channels` on Airbnb connect

**Files:**
- Modify: `apps/backend/src/channex/channex-sync.service.ts`
- Verify: `apps/frontend/src/channex/ChannexHub.tsx` (already wires sub-tabs)

The `ChannexHub` already renders `<AirbnbIntegration />` and `<BookingIntegrationView />` as sub-tabs. This task adds `connected_channels: FieldValue.arrayUnion('airbnb')` to the Firestore write that happens when Airbnb OAuth completes and `connection_status` is set to `'active'`.

- [ ] **Step 11.1: Find where Airbnb becomes `active` in `channex-sync.service.ts`**

Open `apps/backend/src/channex/channex-sync.service.ts`. Search for `connection_status` being set to `'active'` (or `ChannexConnectionStatus.Active`). This will be inside `commitMapping()` or `autoSyncProperty()`. Find the `firebase.update(docRef, { connection_status: 'active', ... })` call.

- [ ] **Step 11.2: Add `connected_channels` arrayUnion to that write**

Add `connected_channels: FieldValue.arrayUnion('airbnb')` to the Firestore update in the same call. Example — the existing update block looks like:

```typescript
await this.firebase.update(docRef, {
  connection_status: ChannexConnectionStatus.Active,
  // ... other fields
});
```

Change to:

```typescript
import { FieldValue } from 'firebase-admin/firestore';

await this.firebase.update(docRef, {
  connection_status: ChannexConnectionStatus.Active,
  connected_channels: FieldValue.arrayUnion('airbnb'),
  // ... other fields
});
```

`FieldValue` is already imported in `channex-ari.service.ts` — check if it is already imported in `channex-sync.service.ts`. Add the import if not:
```typescript
import { FieldValue } from 'firebase-admin/firestore';
```

- [ ] **Step 11.3: Verify backend compiles**

```bash
cd apps/backend && pnpm build 2>&1 | grep -E "error TS" | head -20
```

- [ ] **Step 11.4: Verify Airbnb sub-tab appears dynamically**

1. Start both servers: `pnpm dev` from repo root
2. Navigate to Channex tab: only "Properties" sub-tab visible (no active airbnb connections)
3. Connect Airbnb via the Airbnb sub-tab (this will always be visible if `hasAirbnb` is derived from `connection_status === 'active'` — which is the current fallback logic in `ChannexHub.tsx` line: `properties.some((p) => p.connected_channels.includes('airbnb') || p.connection_status === 'active')`)
4. After OAuth completes: `connected_channels` now includes `'airbnb'` in Firestore → the Airbnb sub-tab remains visible

- [ ] **Step 11.5: Commit**

```bash
git add apps/backend/src/channex/channex-sync.service.ts
git commit -m "feat(channex-hub): set connected_channels on Airbnb OAuth complete"
```

---

## Task 12 — Final verification

- [ ] **Step 12.1: Full build — both apps**

```bash
pnpm --filter @migo-uit/backend build && pnpm --filter @migo-uit/frontend build
```

Expected: no TypeScript errors in either app. The pre-existing `BookingIntegrationView.tsx:230` TS2367 error is unrelated — note it but do not fix it here.

- [ ] **Step 12.2: Certification test dry-run**

With backend running and ngrok active:

1. Channex tab → Properties → "+ New Property" → complete wizard
   - Note the 5 IDs (1 property, 2 room types, 4 rate plans) — these go in Form Section 2
2. ARI Calendar → Full Sync → Run (default 500 days, rate $100, availability 1)
   - Note 2 taskIds → Form Section 4 (Test #1)
3. ARI Calendar → select Nov 22 → Twin Room / Best Available Rate / Rate = 333 → Save
   - Note taskId → Form Section 6 (Test #2)
4. ARI Calendar → select Nov 21 → Twin Room / Best Available Rate / Availability = 7 → Save
   - Note taskId → Form Section 27 (Test #9)

- [ ] **Step 12.3: Tag the feature branch for review**

```bash
git log --oneline -12
```

Confirm all tasks are committed. The branch is ready for `superpowers:requesting-code-review` or for a PR.

---

---

## Self-Review Gap — Batch Queue Required for Tests #3–#8

**Found during spec review:** Tests #3–#8 each require **1 Channex API call** containing multiple room type/rate plan/date combinations. The `ARICalendarFull` as designed in Task 9 makes **1 API call per panel save** (single row). For these tests, 3 separate saves = 3 Channex API calls = certification failure.

**Fix — Amendment to Task 9:**

After completing Task 9 as written, apply this amendment to `ARICalendarFull.tsx`:

Add a **batch queue** state variable and UI:

```typescript
// Add inside ARICalendarFull, after the restriction state variables:
interface BatchEntry {
  id: number;
  roomTypeId: string;
  ratePlanId: string;
  availability?: number;
  rate?: string;
  minStay?: number;
  stopSell?: boolean;
  closedToArrival?: boolean;
  closedToDeparture?: boolean;
}
const [batchQueue, setBatchQueue] = useState<BatchEntry[]>([]);
let batchCounter = 0;
```

**Replace the Save button logic** in the panel with:

1. **"Add to Batch"** button — adds the current panel values as a `BatchEntry` to `batchQueue` without clearing the panel (user can change values and add another).
2. **"Save Batch (N updates)"** button — visible when `batchQueue.length > 0`. Fires ONE availability call (all `availability` entries) + ONE restrictions call (all `rate`/restriction entries). Clears queue after save.

The `handleSave` function becomes `handleAddToBatch` + `handleSaveBatch`:

```typescript
function handleAddToBatch() {
  if (!selectedRoomTypeId) return;
  setBatchQueue((prev) => [
    ...prev,
    {
      id: batchCounter++,
      roomTypeId: selectedRoomTypeId,
      ratePlanId: selectedRatePlanId,
      ...(availability !== '' ? { availability: Number(availability) } : {}),
      ...(rate !== '' ? { rate: String(rate) } : {}),
      ...(minStay !== '' ? { minStay: Number(minStay) } : {}),
      ...(stopSell ? { stopSell } : {}),
      ...(closedToArrival ? { closedToArrival } : {}),
      ...(closedToDeparture ? { closedToDeparture } : {}),
    },
  ]);
  // Reset values but keep room/rate selection so user can easily modify for next entry
  setAvailability('');
  setRate('');
  setMinStay('');
  setStopSell(false);
  setClosedToArrival(false);
  setClosedToDeparture(false);
}

async function handleSaveBatch() {
  if (!selectedRange || batchQueue.length === 0) return;
  const [dateFrom, dateTo] = selectedRange;
  setSaving(true);
  setSaveError(null);
  const taskIds: string[] = [];

  try {
    const availUpdates = batchQueue
      .filter((e) => e.availability !== undefined)
      .map((e) => ({ room_type_id: e.roomTypeId, date_from: dateFrom, date_to: dateTo, availability: e.availability! }));

    if (availUpdates.length > 0) {
      const res = await pushAvailabilityBatch(propertyId, availUpdates);
      taskIds.push(res.taskId);
    }

    const restrictUpdates = batchQueue
      .filter((e) => e.ratePlanId && (e.rate !== undefined || e.minStay !== undefined || e.stopSell || e.closedToArrival || e.closedToDeparture))
      .map((e) => ({
        rate_plan_id: e.ratePlanId,
        date_from: dateFrom,
        date_to: dateTo,
        ...(e.rate !== undefined ? { rate: e.rate } : {}),
        ...(e.minStay !== undefined ? { min_stay_arrival: e.minStay } : {}),
        ...(e.stopSell ? { stop_sell: true } : {}),
        ...(e.closedToArrival ? { closed_to_arrival: true } : {}),
        ...(e.closedToDeparture ? { closed_to_departure: true } : {}),
      }));

    if (restrictUpdates.length > 0) {
      const res = await pushRestrictionsBatch(propertyId, restrictUpdates);
      taskIds.push(res.taskId);
    }

    setLastTaskIds(taskIds);
    setBatchQueue([]);
    setShowPanel(false);
    setSelectionStart(null);
    setSelectionEnd(null);
  } catch (err) {
    setSaveError(err instanceof Error ? err.message : 'Save failed.');
  } finally {
    setSaving(false);
  }
}
```

**Add a batch preview** above the save button in the panel:

```tsx
{batchQueue.length > 0 && (
  <div className="mt-3 rounded-xl bg-slate-50 border border-slate-200 p-3">
    <p className="text-xs font-semibold text-slate-600 mb-2">Batch queue ({batchQueue.length} updates)</p>
    {batchQueue.map((entry) => (
      <div key={entry.id} className="flex items-center justify-between text-xs text-slate-700 py-0.5">
        <span>{uniqueRooms.find((r) => r.room_type_id === entry.roomTypeId)?.title} / {ratePlansForRoom.find((r) => r.rate_plan_id === entry.ratePlanId)?.title ?? '—'}</span>
        <button type="button" onClick={() => setBatchQueue((q) => q.filter((e) => e.id !== entry.id))} className="text-red-400 hover:text-red-600">✕</button>
      </div>
    ))}
  </div>
)}

<div className="mt-4 flex gap-2">
  <button type="button" onClick={handleAddToBatch} disabled={!selectedRoomTypeId}
    className="flex-1 rounded-xl border border-indigo-300 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">
    + Add to Batch
  </button>
  {batchQueue.length > 0 && (
    <button type="button" onClick={() => void handleSaveBatch()} disabled={saving}
      className="flex-1 rounded-xl bg-indigo-600 py-2 text-sm font-semibold text-white disabled:opacity-50">
      {saving ? 'Saving…' : `Save (${batchQueue.length})`}
    </button>
  )}
</div>
```

**Certification workflow for Test #3 with batch queue:**
1. Select Nov 21, Nov 21 (single date)
2. Panel: Twin Room / Best Available Rate / Rate = 333 → "+ Add to Batch"
3. Panel: change date to Nov 25, Double Room / Best Available Rate / Rate = 444 → "+ Add to Batch"
4. Panel: change date to Nov 29, Double Room / Bed & Breakfast / Rate = 456.23 → "+ Add to Batch"
5. "Save (3)" → 1 POST /restrictions call with 3 entries → 1 Channex API call ✓

Note: Tests #3, #4, #5, #6, #7, #8 all use this batch queue pattern. Each test adds multiple entries then clicks "Save (N)".

---

## Certification test → form section mapping

| Test | Form section | ARI Calendar action |
|------|-------------|---------------------|
| #1 Full Sync | Section 4 | Full Sync button → 500 days (2 task IDs) |
| #2 Single date / single rate | Section 6 | Nov 22, Twin BAR, Rate = 333 |
| #3 Single date / multi-rate | Section 9 | 3 rows: Nov 21 Twin BAR $333, Nov 25 Double BAR $444, Nov 29 Double B&B $456.23 — batch via 3 panel saves (backend batches per call) |
| #4 Multi-date / multi-rate | Section 12 | 3 date ranges with rates |
| #5 Min Stay | Section 15 | min_stay_arrival field in panel |
| #6 Stop Sell | Section 18 | Stop Sell checkbox |
| #7 Multiple restrictions | Section 21 | CTA + CTD + min_stay + max_stay in one save |
| #8 Half-year update | Section 24 | Dec 1 2026 → May 1 2027, rate + CTA + CTD + min_stay |
| #9 Single date availability | Section 27 | Availability = 7 (Twin), 0 (Double) |
| #10 Multi-date availability | Section 30 | Twin Nov 10-16 = 3, Double Nov 17-24 = 4 |

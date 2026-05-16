# MigoProperty Pool — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Pools" sub-tab to `ChannexHub` that lets the admin manage `migo_properties` — create pools, assign/remove Channex property connections, monitor live availability, and push ARI fan-out to all connected platforms.

**Architecture:** New sub-tab inside the existing `ChannexHub` tab bar. Firestore `onSnapshot` for real-time availability counter. REST API client for mutations. No new routing — state-driven navigation identical to the existing properties/airbnb/booking tabs.

**Tech Stack:** React 18, TypeScript, Tailwind (design tokens), Firestore SDK (onSnapshot), fetch API, existing UI components (Button, Input, Select from `src/components/ui/`)

---

## File Map

**New files:**
```
apps/frontend/src/channex/
  api/migoPropertyApi.ts
  hooks/useMigoProperties.ts
  components/pools/
    PoolsList.tsx
    PoolCreateForm.tsx
    AssignConnectionModal.tsx
    PoolAriPanel.tsx
    PoolDetail.tsx
```

**Modified files:**
```
apps/frontend/src/channex/ChannexHub.tsx          (+pools tab)
apps/frontend/src/i18n/en.ts                      (+channex.tab.pools)
apps/frontend/src/i18n/es.ts                      (+channex.tab.pools)
apps/frontend/src/airbnb/AirbnbPage.tsx           (+availability_alert SSE case)
```

---

## Task 1: Create migoPropertyApi.ts

**Files:**
- Create: `apps/frontend/src/channex/api/migoPropertyApi.ts`

- [ ] **Step 1: Write the API module**

```typescript
const BASE = '/api/migo-properties';
const ARI_BASE = '/api/channex/ari';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PlatformConnection {
  platform: string;
  channex_property_id: string;
  listing_title: string;
  is_sync_enabled: boolean;
}

export interface MigoProperty {
  id: string;
  tenant_id: string;
  title: string;
  total_units: number;
  current_availability: number;
  alert_threshold: number;
  platform_connections: PlatformConnection[];
  created_at: string;
  updated_at: string;
}

export interface CreateMigoPropertyPayload {
  tenantId: string;
  title: string;
  total_units: number;
  alert_threshold?: number;
}

export interface UpdateMigoPropertyPayload {
  title?: string;
  total_units?: number;
  alert_threshold?: number;
}

export interface AssignConnectionPayload {
  channexPropertyId: string;
  platform: string;
  listingTitle: string;
  isSyncEnabled?: boolean;
}

export interface MigoPropertyAriPayload {
  dateFrom: string;
  dateTo: string;
  availability?: number;
  rate?: string;
  stopSell?: boolean;
  minStayArrival?: number;
  closedToArrival?: boolean;
  closedToDeparture?: boolean;
}

export interface AriPushResult {
  status: number;
  succeeded: string[];
  failed: Array<{ channexPropertyId: string; error: string }>;
}

// ─── Fetch helper ─────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  const body = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
  if (!res.ok) {
    const msg = Array.isArray(body?.message)
      ? body.message.join('; ')
      : (body?.message ?? `HTTP ${res.status}`);
    throw new Error(msg);
  }
  return body as T;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export function listMigoProperties(tenantId: string): Promise<MigoProperty[]> {
  return apiFetch(`${BASE}?tenantId=${encodeURIComponent(tenantId)}`);
}

export function createMigoProperty(payload: CreateMigoPropertyPayload): Promise<MigoProperty> {
  return apiFetch(BASE, { method: 'POST', body: JSON.stringify(payload) });
}

export function updateMigoProperty(
  id: string,
  payload: UpdateMigoPropertyPayload,
): Promise<MigoProperty> {
  return apiFetch(`${BASE}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteMigoProperty(id: string): Promise<void> {
  return apiFetch(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ─── Connections ──────────────────────────────────────────────────────────────

export function assignConnection(
  id: string,
  payload: AssignConnectionPayload,
): Promise<MigoProperty> {
  return apiFetch(`${BASE}/${encodeURIComponent(id)}/connections`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function removeConnection(id: string, channexId: string): Promise<MigoProperty> {
  return apiFetch(
    `${BASE}/${encodeURIComponent(id)}/connections/${encodeURIComponent(channexId)}`,
    { method: 'DELETE' },
  );
}

export function toggleSync(
  id: string,
  channexId: string,
  isSyncEnabled: boolean,
): Promise<MigoProperty> {
  return apiFetch(
    `${BASE}/${encodeURIComponent(id)}/connections/${encodeURIComponent(channexId)}`,
    { method: 'PATCH', body: JSON.stringify({ isSyncEnabled }) },
  );
}

// ─── Availability ─────────────────────────────────────────────────────────────

export function resetAvailability(id: string): Promise<MigoProperty> {
  return apiFetch(`${BASE}/${encodeURIComponent(id)}/availability/reset`, { method: 'POST' });
}

// ─── ARI fan-out ──────────────────────────────────────────────────────────────

export function pushAriToPool(
  migoPropertyId: string,
  payload: MigoPropertyAriPayload,
): Promise<AriPushResult> {
  return apiFetch(`${ARI_BASE}/migo-property/${encodeURIComponent(migoPropertyId)}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd "D:\migo\repos\WhatsApp Multi sign up demo\apps\frontend" && pnpm tsc --noEmit
```

Expected: zero errors.

---

## Task 2: Create useMigoProperties hook

**Files:**
- Create: `apps/frontend/src/channex/hooks/useMigoProperties.ts`

- [ ] **Step 1: Write the hook**

```typescript
import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import type { MigoProperty } from '../api/migoPropertyApi';

interface Result {
  pools: MigoProperty[];
  loading: boolean;
  error: string | null;
}

export function useMigoProperties(tenantId: string): Result {
  const [pools, setPools] = useState<MigoProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) {
      setPools([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const q = query(
      collection(db, 'migo_properties'),
      where('tenant_id', '==', tenantId),
      orderBy('created_at', 'desc'),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setPools(snapshot.docs.map((doc) => doc.data() as MigoProperty));
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [tenantId]);

  return { pools, loading, error };
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd "D:\migo\repos\WhatsApp Multi sign up demo\apps\frontend" && pnpm tsc --noEmit
```

Expected: zero errors.

---

## Task 3: Create PoolsList.tsx

**Files:**
- Create: `apps/frontend/src/channex/components/pools/PoolsList.tsx`

- [ ] **Step 1: Write the component**

```tsx
import type { MigoProperty } from '../../api/migoPropertyApi';
import Button from '../../../components/ui/Button';

interface Props {
  pools: MigoProperty[];
  onSelect: (pool: MigoProperty) => void;
  onNew: () => void;
}

function AvailabilityChip({ pool }: { pool: MigoProperty }) {
  const { current_availability, total_units, alert_threshold } = pool;
  const isAlert = current_availability <= alert_threshold;
  const isEmpty = current_availability <= 0;
  const color = isEmpty
    ? 'bg-danger-bg text-danger-text'
    : isAlert
      ? 'bg-notice-bg text-notice-text'
      : 'bg-ok-bg text-ok-text';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${color}`}
    >
      {isAlert && !isEmpty && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />}
      {current_availability} / {total_units}
    </span>
  );
}

function PlatformBadge({ platform }: { platform: string }) {
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
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] ${styles[platform] ?? 'bg-surface-subtle text-content-2'}`}
    >
      {labels[platform] ?? platform}
    </span>
  );
}

export default function PoolsList({ pools, onSelect, onNew }: Props) {
  const platforms = (pool: MigoProperty) =>
    [...new Set(pool.platform_connections.map((c) => c.platform))];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-content">Property Pools</h2>
          <p className="text-sm text-content-2">
            Group OTA listings into shared availability pools.
          </p>
        </div>
        <Button type="button" onClick={onNew} variant="primary" size="sm">
          + New Pool
        </Button>
      </div>

      {pools.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-edge px-8 py-12 text-center">
          <p className="text-sm font-medium text-content">No pools yet</p>
          <p className="mt-1 text-sm text-content-2">
            Create a pool to track availability across multiple OTA listings.
          </p>
          <Button type="button" onClick={onNew} variant="primary" size="sm" className="mt-4">
            Create first pool
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {pools.map((pool) => (
            <button
              key={pool.id}
              type="button"
              onClick={() => onSelect(pool)}
              className="group rounded-2xl border border-edge bg-surface-raised p-4 text-left transition hover:border-brand-light hover:shadow-sm"
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
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd "D:\migo\repos\WhatsApp Multi sign up demo\apps\frontend" && pnpm tsc --noEmit
```

---

## Task 4: Create PoolCreateForm.tsx

**Files:**
- Create: `apps/frontend/src/channex/components/pools/PoolCreateForm.tsx`

- [ ] **Step 1: Write the component**

```tsx
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
  const [totalUnits, setTotalUnits] = useState('');
  const [alertThreshold, setAlertThreshold] = useState('0');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const units = parseInt(totalUnits, 10);
    if (!title.trim() || isNaN(units) || units < 1) {
      setError('Title and total units (≥ 1) are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const pool = await createMigoProperty({
        tenantId,
        title: title.trim(),
        total_units: units,
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
            Total Physical Units
          </label>
          <Input
            type="number"
            min={1}
            value={totalUnits}
            onChange={(e) => setTotalUnits(e.target.value)}
            placeholder="e.g. 5"
            required
          />
          <p className="mt-1 text-xs text-content-3">
            Number of interchangeable physical units in this pool.
          </p>
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

- [ ] **Step 2: Verify TypeScript**

```bash
cd "D:\migo\repos\WhatsApp Multi sign up demo\apps\frontend" && pnpm tsc --noEmit
```

---

## Task 5: Create AssignConnectionModal.tsx

**Files:**
- Create: `apps/frontend/src/channex/components/pools/AssignConnectionModal.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState } from 'react';
import Button from '../../../components/ui/Button';
import { Input, Select } from '../../../components/ui/Input';
import { useChannexProperties } from '../../hooks/useChannexProperties';
import { assignConnection, type MigoProperty, type PlatformConnection } from '../../api/migoPropertyApi';

interface Props {
  migoPropertyId: string;
  tenantId: string;
  existingConnections: PlatformConnection[];
  onAssigned: (updated: MigoProperty) => void;
  onClose: () => void;
}

export default function AssignConnectionModal({
  migoPropertyId,
  tenantId,
  existingConnections,
  onAssigned,
  onClose,
}: Props) {
  const { properties, loading: propsLoading } = useChannexProperties(tenantId);
  const [selectedChannexId, setSelectedChannexId] = useState('');
  const [platform, setPlatform] = useState('airbnb');
  const [listingTitle, setListingTitle] = useState('');
  const [isSyncEnabled, setIsSyncEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connectedIds = new Set(existingConnections.map((c) => c.channex_property_id));
  const available = properties.filter((p) => !connectedIds.has(p.channex_property_id));

  function handlePropertySelect(channexId: string) {
    setSelectedChannexId(channexId);
    const prop = properties.find((p) => p.channex_property_id === channexId);
    if (prop) {
      setListingTitle(prop.title);
      if (prop.connected_channels.length > 0) {
        setPlatform(prop.connected_channels[0]);
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedChannexId || !listingTitle.trim()) {
      setError('Select a property and enter a listing title.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await assignConnection(migoPropertyId, {
        channexPropertyId: selectedChannexId,
        platform,
        listingTitle: listingTitle.trim(),
        isSyncEnabled,
      });
      onAssigned(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign connection');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl border border-edge bg-surface-raised px-6 py-6 shadow-xl">
        <h3 className="mb-5 text-base font-semibold text-content">Assign Platform Connection</h3>

        {propsLoading ? (
          <p className="text-sm text-content-2">Loading properties…</p>
        ) : available.length === 0 ? (
          <p className="text-sm text-content-2">
            All registered Channex properties are already connected.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-content-2">
                Channex Property
              </label>
              <Select
                value={selectedChannexId}
                onChange={(e) => handlePropertySelect(e.target.value)}
                required
              >
                <option value="">Select a property…</option>
                {available.map((p) => (
                  <option key={p.channex_property_id} value={p.channex_property_id}>
                    {p.title}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-content-2">
                Platform
              </label>
              <Select value={platform} onChange={(e) => setPlatform(e.target.value)}>
                <option value="airbnb">Airbnb</option>
                <option value="booking">Booking.com</option>
              </Select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-content-2">
                OTA Listing Title
              </label>
              <Input
                value={listingTitle}
                onChange={(e) => setListingTitle(e.target.value)}
                placeholder="e.g. Studio Full ventana grande"
                required
              />
            </div>

            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={isSyncEnabled}
                onChange={(e) => setIsSyncEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-edge accent-brand"
              />
              <span className="text-sm text-content">Sync enabled (include in ARI fan-out)</span>
            </label>

            {error && <p className="text-sm text-danger-text">{error}</p>}

            <div className="flex gap-3 pt-2">
              <Button type="submit" variant="primary" size="sm" disabled={saving}>
                {saving ? 'Assigning…' : 'Assign'}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd "D:\migo\repos\WhatsApp Multi sign up demo\apps\frontend" && pnpm tsc --noEmit
```

---

## Task 6: Create PoolAriPanel.tsx

**Files:**
- Create: `apps/frontend/src/channex/components/pools/PoolAriPanel.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState } from 'react';
import Button from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { pushAriToPool, type AriPushResult } from '../../api/migoPropertyApi';

interface Props {
  migoPropertyId: string;
  enabledConnectionCount: number;
}

export default function PoolAriPanel({ migoPropertyId, enabledConnectionCount }: Props) {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [stopSell, setStopSell] = useState(false);
  const [availability, setAvailability] = useState('');
  const [pushing, setPushing] = useState(false);
  const [result, setResult] = useState<AriPushResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handlePush(e: React.FormEvent) {
    e.preventDefault();
    if (!dateFrom || !dateTo) {
      setError('Date range is required.');
      return;
    }
    setPushing(true);
    setError(null);
    setResult(null);
    try {
      const payload = {
        dateFrom,
        dateTo,
        ...(stopSell ? { stopSell: true } : {}),
        ...(availability !== '' ? { availability: parseInt(availability, 10) } : {}),
      };
      const res = await pushAriToPool(migoPropertyId, payload);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Push failed');
    } finally {
      setPushing(false);
    }
  }

  return (
    <div className="rounded-2xl border border-edge bg-surface-raised px-5 py-4">
      <h3 className="mb-4 text-sm font-semibold text-content">ARI Fan-out</h3>
      <p className="mb-4 text-xs text-content-2">
        Push ARI updates to all {enabledConnectionCount} enabled platform
        {enabledConnectionCount !== 1 ? 's' : ''} simultaneously.
      </p>

      <form onSubmit={handlePush} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-content-2">
              Date From
            </label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-content-2">
              Date To
            </label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={stopSell}
              onChange={(e) => setStopSell(e.target.checked)}
              className="h-4 w-4 rounded border-edge accent-brand"
            />
            <span className="text-sm font-medium text-content">Stop Sell</span>
            <span className="text-xs text-content-3">Close all bookings for this period</span>
          </label>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-content-2">
              Availability Override <span className="font-normal normal-case">(optional)</span>
            </label>
            <Input
              type="number"
              min={0}
              value={availability}
              onChange={(e) => setAvailability(e.target.value)}
              placeholder="Leave blank to skip"
              className="max-w-[120px]"
            />
          </div>
        </div>

        {error && <p className="text-sm text-danger-text">{error}</p>}

        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={pushing || enabledConnectionCount === 0}
          className="self-start"
        >
          {pushing ? 'Pushing…' : 'Push to all platforms'}
        </Button>
      </form>

      {result && (
        <div className="mt-4 rounded-xl border border-edge p-3">
          {result.succeeded.length > 0 && (
            <div className="mb-2">
              <p className="text-xs font-semibold text-ok-text">
                ✓ Succeeded ({result.succeeded.length})
              </p>
              <ul className="mt-1 space-y-0.5">
                {result.succeeded.map((id) => (
                  <li key={id} className="font-mono text-xs text-content-2">{id}</li>
                ))}
              </ul>
            </div>
          )}
          {result.failed.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-danger-text">
                ✗ Failed ({result.failed.length})
              </p>
              <ul className="mt-1 space-y-0.5">
                {result.failed.map((f) => (
                  <li key={f.channexPropertyId} className="text-xs text-danger-text">
                    {f.channexPropertyId}: {f.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd "D:\migo\repos\WhatsApp Multi sign up demo\apps\frontend" && pnpm tsc --noEmit
```

---

## Task 7: Create PoolDetail.tsx

**Files:**
- Create: `apps/frontend/src/channex/components/pools/PoolDetail.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState } from 'react';
import Button from '../../../components/ui/Button';
import {
  removeConnection,
  toggleSync,
  resetAvailability,
  type MigoProperty,
} from '../../api/migoPropertyApi';
import AssignConnectionModal from './AssignConnectionModal';
import PoolAriPanel from './PoolAriPanel';

interface Props {
  pool: MigoProperty;
  tenantId: string;
  onBack: () => void;
  onUpdated: (updated: MigoProperty) => void;
}

function AvailabilityBadge({ pool }: { pool: MigoProperty }) {
  const { current_availability, total_units, alert_threshold } = pool;
  const isAlert = current_availability <= alert_threshold;
  const isEmpty = current_availability <= 0;
  const color = isEmpty
    ? 'bg-danger-bg text-danger-text'
    : isAlert
      ? 'bg-notice-bg text-notice-text'
      : 'bg-ok-bg text-ok-text';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${color}`}>
      {current_availability} / {total_units} available
      {isAlert && (
        <span className="text-xs opacity-80">· alert ≤ {alert_threshold}</span>
      )}
    </span>
  );
}

function PlatformBadge({ platform }: { platform: string }) {
  const styles: Record<string, string> = {
    airbnb: 'bg-danger-bg text-danger-text',
    booking: 'bg-notice-bg text-notice-text',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] ${styles[platform] ?? 'bg-surface-subtle text-content-2'}`}>
      {platform === 'booking' ? 'Booking.com' : platform}
    </span>
  );
}

export default function PoolDetail({ pool: initialPool, tenantId, onBack, onUpdated }: Props) {
  const [pool, setPool] = useState(initialPool);
  const [showAssign, setShowAssign] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  function handleUpdated(updated: MigoProperty) {
    setPool(updated);
    onUpdated(updated);
    setShowAssign(false);
  }

  async function handleRemoveConnection(channexId: string) {
    try {
      const updated = await removeConnection(pool.id, channexId);
      handleUpdated(updated);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to remove connection');
    }
  }

  async function handleToggleSync(channexId: string, current: boolean) {
    try {
      const updated = await toggleSync(pool.id, channexId, !current);
      handleUpdated(updated);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to toggle sync');
    }
  }

  async function handleReset() {
    setResetting(true);
    setResetError(null);
    try {
      const updated = await resetAvailability(pool.id);
      handleUpdated(updated);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setResetting(false);
    }
  }

  const enabledCount = pool.platform_connections.filter((c) => c.is_sync_enabled).length;

  return (
    <div className="flex flex-col gap-5">
      {/* Back */}
      <Button variant="ghost" size="sm" type="button" onClick={onBack} className="self-start">
        ← Back to pools
      </Button>

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-edge bg-surface-raised px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold text-content">{pool.title}</h2>
          <p className="mt-0.5 text-xs text-content-2 font-mono">{pool.id}</p>
        </div>
        <div className="flex items-center gap-3">
          <AvailabilityBadge pool={pool} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleReset}
            disabled={resetting}
          >
            {resetting ? 'Resetting…' : 'Reset to full'}
          </Button>
        </div>
        {resetError && <p className="w-full text-xs text-danger-text">{resetError}</p>}
      </div>

      {/* Platform connections */}
      <div className="rounded-2xl border border-edge bg-surface-raised px-5 py-4">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-content">Platform Connections</h3>
          <Button type="button" variant="outline" size="sm" onClick={() => setShowAssign(true)}>
            + Add
          </Button>
        </div>

        {pool.platform_connections.length === 0 ? (
          <p className="text-sm text-content-2">No connections yet. Add a platform connection above.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {pool.platform_connections.map((conn) => (
              <div
                key={conn.channex_property_id}
                className="flex items-center gap-3 rounded-xl border border-edge bg-surface px-4 py-3"
              >
                <PlatformBadge platform={conn.platform} />
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-content">{conn.listing_title}</p>
                  <p className="truncate font-mono text-xs text-content-3">{conn.channex_property_id}</p>
                </div>
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={conn.is_sync_enabled}
                    onChange={() => handleToggleSync(conn.channex_property_id, conn.is_sync_enabled)}
                    className="h-4 w-4 rounded border-edge accent-brand"
                  />
                  <span className="text-xs text-content-2">Sync</span>
                </label>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={() => handleRemoveConnection(conn.channex_property_id)}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ARI fan-out */}
      <PoolAriPanel migoPropertyId={pool.id} enabledConnectionCount={enabledCount} />

      {showAssign && (
        <AssignConnectionModal
          migoPropertyId={pool.id}
          tenantId={tenantId}
          existingConnections={pool.platform_connections}
          onAssigned={handleUpdated}
          onClose={() => setShowAssign(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd "D:\migo\repos\WhatsApp Multi sign up demo\apps\frontend" && pnpm tsc --noEmit
```

---

## Task 8: Wire pools tab into ChannexHub + i18n

**Files:**
- Modify: `apps/frontend/src/channex/ChannexHub.tsx`
- Modify: `apps/frontend/src/i18n/en.ts`
- Modify: `apps/frontend/src/i18n/es.ts`

- [ ] **Step 1: Add i18n keys**

In `en.ts`, after `'channex.tab.booking': 'Booking.com',` add:
```typescript
  'channex.tab.pools':      'Pools',
```

In `es.ts`, after `'channex.tab.booking': 'Booking.com',` add:
```typescript
  'channex.tab.pools':      'Pools',
```

- [ ] **Step 2: Update ChannexHub.tsx**

Change `type SubTab = 'properties' | 'airbnb' | 'booking';` to:
```typescript
type SubTab = 'properties' | 'airbnb' | 'booking' | 'pools';
```

Add import at top (after existing imports):
```typescript
import { useMigoProperties } from './hooks/useMigoProperties';
import PoolsList from './components/pools/PoolsList';
import PoolDetail from './components/pools/PoolDetail';
import PoolCreateForm from './components/pools/PoolCreateForm';
import type { MigoProperty } from './api/migoPropertyApi';
```

Add the pools tab to the `SUB_TABS` array:
```typescript
  const SUB_TABS: { id: SubTab; label: string }[] = [
    { id: 'properties', label: t('channex.tab.properties') },
    { id: 'airbnb',     label: t('channex.tab.airbnb') },
    { id: 'booking',    label: t('channex.tab.booking') },
    { id: 'pools',      label: t('channex.tab.pools') },
  ];
```

Add pools state variables (after `const { properties, loading, error } = useChannexProperties(businessId);`):
```typescript
  const { pools, loading: poolsLoading, error: poolsError } = useMigoProperties(businessId);
  const [showPoolCreate, setShowPoolCreate] = useState(false);
  const [selectedPool, setSelectedPool] = useState<MigoProperty | null>(null);
```

Add the pools tab content inside the `<div className="flex-1 min-h-0 overflow-auto">` block, after the `booking` tab block:
```tsx
        {activeSubTab === 'pools' && (
          <div className="px-6 py-6">
            {showPoolCreate ? (
              <PoolCreateForm
                tenantId={businessId}
                onCreated={(pool) => {
                  setShowPoolCreate(false);
                  setSelectedPool(pool);
                }}
                onCancel={() => setShowPoolCreate(false)}
              />
            ) : selectedPool ? (
              <PoolDetail
                pool={selectedPool}
                tenantId={businessId}
                onBack={() => setSelectedPool(null)}
                onUpdated={(updated) => setSelectedPool(updated)}
              />
            ) : (
              <>
                {poolsLoading && <p className="text-sm text-content-2">Loading pools…</p>}
                {poolsError && <p className="text-sm text-danger-text">{poolsError}</p>}
                {!poolsLoading && !poolsError && (
                  <PoolsList
                    pools={pools}
                    onSelect={(pool) => setSelectedPool(pool)}
                    onNew={() => setShowPoolCreate(true)}
                  />
                )}
              </>
            )}
          </div>
        )}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd "D:\migo\repos\WhatsApp Multi sign up demo\apps\frontend" && pnpm tsc --noEmit
```

Expected: zero errors.

---

## Task 9: Handle availability_alert SSE event in AirbnbPage.tsx

**Files:**
- Modify: `apps/frontend/src/airbnb/AirbnbPage.tsx`

The `availability_alert` event is broadcast to all SSE clients for the tenant. Since the existing SSE connection lives in `AirbnbPage.tsx`, add handling there.

- [ ] **Step 1: Extend the SSE type union**

Find the existing SSE type definitions (around lines 16-44). Change:
```typescript
type SSEEventType =
  | 'connection_status_change'
  | 'booking_new'
  | 'booking_unmapped_room';
```
to:
```typescript
type SSEEventType =
  | 'connection_status_change'
  | 'booking_new'
  | 'booking_unmapped_room'
  | 'availability_alert';
```

Add the new event interface after `SSEUnmappedRoomEvent`:
```typescript
interface SSEAvailabilityAlertEvent {
  type: 'availability_alert';
  tenantId: string;
  migoPropertyId: string;
  title: string;
  current_availability: number;
  timestamp: string;
}
```

Update the `SSEEvent` union type:
```typescript
type SSEEvent = SSEStatusChangeEvent | SSEBookingNewEvent | SSEUnmappedRoomEvent | SSEAvailabilityAlertEvent;
```

- [ ] **Step 2: Add state for the alert**

Find where other state is declared (`const [newBookingCode, setNewBookingCode] = useState…`) and add:
```typescript
  const [availabilityAlert, setAvailabilityAlert] = useState<SSEAvailabilityAlertEvent | null>(null);
  const alertTimeoutRef = useRef<number | null>(null);
```

- [ ] **Step 3: Handle the SSE case**

Inside the `switch (parsed.type)` block, add a new case after `booking_unmapped_room`:
```typescript
        case 'availability_alert':
          setAvailabilityAlert(parsed);
          if (alertTimeoutRef.current !== null) {
            window.clearTimeout(alertTimeoutRef.current);
          }
          alertTimeoutRef.current = window.setTimeout(() => {
            setAvailabilityAlert(null);
            alertTimeoutRef.current = null;
          }, 10000);
          break;
```

- [ ] **Step 4: Add cleanup in the useEffect return**

In the cleanup function of the SSE `useEffect`, add:
```typescript
      if (alertTimeoutRef.current !== null) {
        window.clearTimeout(alertTimeoutRef.current);
      }
```

- [ ] **Step 5: Render the alert banner**

Find a good place near the top of the rendered JSX (after the booking toast, before the main content). Add the availability alert toast:
```tsx
      {availabilityAlert && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-2xl border border-notice-border bg-notice-bg px-5 py-3 shadow-lg">
          <p className="text-sm font-semibold text-notice-text">
            ⚠ {availabilityAlert.title}: {availabilityAlert.current_availability} unit
            {availabilityAlert.current_availability !== 1 ? 's' : ''} remaining
          </p>
          <p className="mt-0.5 text-xs text-notice-text opacity-75">
            Manage availability in the Pools tab
          </p>
        </div>
      )}
```

- [ ] **Step 6: Verify TypeScript**

```bash
cd "D:\migo\repos\WhatsApp Multi sign up demo\apps\frontend" && pnpm tsc --noEmit
```

Expected: zero errors.

---

## Task 10 (manual): Smoke test

Start the dev server and verify:

```bash
pnpm --filter @migo-uit/frontend dev
```

1. Navigate to the Channex section — verify "Pools" tab appears
2. Click "Pools" tab — verify empty state shows "No pools yet"
3. Click "+ New Pool" — fill in title="Studio Full", units=5, threshold=1 — click Create → should redirect to PoolDetail
4. In PoolDetail, click "+ Add" → AssignConnectionModal shows available properties
5. Select a property, click Assign → connection appears in the list
6. Toggle sync checkbox — should persist (optimistic update)
7. Fill in ARI fan-out form with a date range + Stop Sell → click Push → see succeeded/failed result
8. Click "Reset to full" — availability badge resets to 5/5
9. Click "← Back to pools" — pool card appears in grid with correct availability chip color

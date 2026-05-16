# BDC Channel Selector — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded "first BDC channel" discovery in `syncBdc` with a user-facing modal that lists all BDC channels belonging to the tenant's Channex group, letting the user pick which hotel to sync Rooms & Rates for.

**Architecture:** A new `getChannelsByGroup(groupId)` method on `ChannexService` plus a new `getGroupId(tenantId)` read-only method on `ChannexGroupService` power a new `GET /channex/properties/bdc-channels?tenantId=X` endpoint. The existing `syncBdc` gains an optional `channelId` in the request body — if present it skips channel discovery, preserving backwards compatibility. A new `BdcChannelSelectModal` component fetches the list, shows radio buttons, and passes the chosen `channelId` back to `BookingConnectionPanel` which owns the sync call.

**Tech Stack:** NestJS (backend), React + Tailwind (frontend), Firestore `channex_groups` collection, existing `ChannexService`, existing `ChannexGroupService`.

---

## File Map

| Action | File |
|--------|------|
| Modify | `apps/backend/src/channex/channex.service.ts` |
| Modify | `apps/backend/src/channex/channex-group.service.ts` |
| Modify | `apps/backend/src/channex/channex-property.controller.ts` |
| Modify | `apps/backend/src/channex/channex-bdc-sync.service.ts` |
| Modify | `apps/frontend/src/channex/api/channexHubApi.ts` |
| Create | `apps/frontend/src/channex/components/connection/BdcChannelSelectModal.tsx` |
| Modify | `apps/frontend/src/channex/components/connection/BookingConnectionPanel.tsx` |

---

## Task 1: Backend — `getChannelsByGroup` on `ChannexService`

**Files:**
- Modify: `apps/backend/src/channex/channex.service.ts`

- [ ] **Step 1: Locate insertion point**

Open `apps/backend/src/channex/channex.service.ts`. Find the `getChannels` method (around line 796). The new method goes **immediately after** its closing brace.

- [ ] **Step 2: Insert `getChannelsByGroup`**

```typescript
  /**
   * Lists all OTA channel connections for a given Channex group.
   *
   * GET /api/v1/channels?filter[group_id]={groupId}
   *
   * Used to enumerate all BDC channels that belong to a tenant before
   * presenting the channel-selection modal.
   */
  async getChannelsByGroup(groupId: string): Promise<ChannexChannelItem[]> {
    this.logger.log(`[CHANNEX] Listing channels by group — groupId=${groupId}`);

    try {
      const response = await this.defLogger.request<ChannexChannelListResponse>({
        method: 'GET',
        url: `${this.baseUrl}/channels?filter[group_id]=${encodeURIComponent(groupId)}`,
        headers: this.buildAuthHeaders(),
      });

      return response?.data ?? [];
    } catch (err) {
      this.normaliseError(err);
    }
  }
```

`ChannexChannelItem` and `ChannexChannelListResponse` are already defined in `channex.types.ts` — no new imports needed.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/backend && pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/channex/channex.service.ts
git commit -m "feat(channex): add getChannelsByGroup to ChannexService"
```

---

## Task 2: Backend — `getGroupId` on `ChannexGroupService`

**Files:**
- Modify: `apps/backend/src/channex/channex-group.service.ts`

- [ ] **Step 1: Locate insertion point**

Open `apps/backend/src/channex/channex-group.service.ts`. Find the `ensureGroup` method. The new method goes **after** `ensureGroup`'s closing brace and **before** `private async cacheGroup`.

- [ ] **Step 2: Insert `getGroupId`**

```typescript
  /**
   * Returns the cached Channex Group ID for a given businessId, or null if
   * no group has been created yet. Unlike ensureGroup, does NOT create a group.
   */
  async getGroupId(businessId: string): Promise<string | null> {
    const db = this.firebase.getFirestore();
    const snap = await db.collection('channex_groups').doc(businessId).get();
    if (!snap.exists) return null;
    return (snap.data()!.channex_group_id as string) ?? null;
  }
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/backend && pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/channex/channex-group.service.ts
git commit -m "feat(channex): add read-only getGroupId to ChannexGroupService"
```

---

## Task 3: Backend — `GET /channex/properties/bdc-channels` endpoint

**Files:**
- Modify: `apps/backend/src/channex/channex-property.controller.ts`

- [ ] **Step 1: Add `ChannexGroupService` import**

Open `apps/backend/src/channex/channex-property.controller.ts`. Find the import block at the top. Add this line after the `ChannexBdcSyncService` import:

```typescript
import { ChannexGroupService } from './channex-group.service';
```

Also add `NotFoundException` to the NestJS imports at line 1 (it is already present — verify before adding):

```typescript
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
```

- [ ] **Step 2: Inject `ChannexGroupService` in the constructor**

Find the constructor (around line 57). Add `groupService` as the last injected dependency:

```typescript
  constructor(
    private readonly propertyService: ChannexPropertyService,
    private readonly oauthService: ChannexOAuthService,
    private readonly syncService: ChannexSyncService,
    private readonly bdcSyncService: ChannexBdcSyncService,
    private readonly channexService: ChannexService,
    private readonly groupService: ChannexGroupService,
  ) {}
```

`ChannexGroupService` is already registered as a provider in `channex.module.ts` — no module changes needed.

- [ ] **Step 3: Add the endpoint handler**

Find the `syncBdc` handler (`@Post(':propertyId/sync-bdc')`). Insert the new handler **directly above it**:

```typescript
  /**
   * GET /channex/properties/bdc-channels?tenantId=X
   *
   * Returns all Booking.com channels that belong to this tenant's Channex
   * group. Used by the BDC channel-selection modal before Rooms & Rates sync.
   *
   * Query:   tenantId — Migo tenant ID (same as businessId / WABA ID)
   * Returns: Array<{ id: string; title: string }>
   * Status:  200 OK
   *
   * Possible errors:
   *   404 Not Found — tenant has no Channex group yet (never provisioned a property)
   */
  @Get('bdc-channels')
  async getBdcChannels(
    @Query('tenantId') tenantId: string,
  ): Promise<Array<{ id: string; title: string }>> {
    this.logger.log(`[CTRL] GET /channex/properties/bdc-channels — tenantId=${tenantId}`);

    const groupId = await this.groupService.getGroupId(tenantId);
    if (!groupId) {
      throw new NotFoundException(
        `No Channex group found for tenant: ${tenantId}. Provision a property first.`,
      );
    }

    const allChannels = await this.channexService.getChannelsByGroup(groupId);

    const bdcChannels = allChannels.filter(
      (c) =>
        c.attributes?.channel === 'BookingCom' ||
        (c.attributes as any)?.channel_design_id === 'booking_com',
    );

    return bdcChannels.map((c) => ({ id: c.id, title: c.attributes.title }));
  }
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd apps/backend && pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Smoke-test the endpoint**

Start the backend (`pnpm --filter @migo-uit/backend dev`) and run:

```bash
# Replace with a real tenantId that has a provisioned Channex property
curl -s "http://localhost:3001/channex/properties/bdc-channels?tenantId=REAL_TENANT_ID" | jq .
# Expected: [{ "id": "...", "title": "..." }] or []

# 404 path — tenant that has never provisioned
curl -s "http://localhost:3001/channex/properties/bdc-channels?tenantId=nonexistent" | jq .
# Expected: { "statusCode": 404, "message": "No Channex group found for tenant..." }
```

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/channex/channex-property.controller.ts
git commit -m "feat(channex): add GET /channex/properties/bdc-channels endpoint"
```

---

## Task 4: Backend — `syncBdc` accepts optional `channelId`

**Files:**
- Modify: `apps/backend/src/channex/channex-bdc-sync.service.ts`
- Modify: `apps/backend/src/channex/channex-property.controller.ts`

### Part A — Service

- [ ] **Step 1: Update `syncBdc` signature**

Open `apps/backend/src/channex/channex-bdc-sync.service.ts`. Find the `syncBdc` method signature (around line 72):

```typescript
async syncBdc(propertyId: string, tenantId: string): Promise<BdcSyncResult> {
```

Replace with:

```typescript
async syncBdc(propertyId: string, tenantId: string, channelId?: string): Promise<BdcSyncResult> {
```

- [ ] **Step 2: Make Step 0 conditional**

Find the Step 0 block (around line 75–91):

```typescript
    // ── Step 0: Discover BDC channel on base property ─────────────────────────
    const channels = await this.channex.getChannels(propertyId);
    const bdcChannel = channels.find(
      (c: any) =>
        c.attributes?.channel === 'BookingCom' ||
        c.attributes?.channel_design_id === 'booking_com',
    );

    if (!bdcChannel) {
      throw new HttpException(
        'No Booking.com channel found for this property. Complete the Channex IFrame popup first.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const channexChannelId: string = bdcChannel.id;
    this.logger.log(`[BDC_SYNC] BDC channel found — channelId=${channexChannelId}`);
```

Replace it with:

```typescript
    // ── Step 0: Resolve BDC channel ───────────────────────────────────────────
    // If channelId is provided (from the channel-selection modal), use it directly
    // and skip the discovery call. Falls back to the original discovery when absent.
    let channexChannelId: string;

    if (channelId) {
      channexChannelId = channelId;
      this.logger.log(`[BDC_SYNC] BDC channel provided directly — channelId=${channexChannelId}`);
    } else {
      const channels = await this.channex.getChannels(propertyId);
      const bdcChannel = channels.find(
        (c: any) =>
          c.attributes?.channel === 'BookingCom' ||
          c.attributes?.channel_design_id === 'booking_com',
      );

      if (!bdcChannel) {
        throw new HttpException(
          'No Booking.com channel found for this property. Complete the Channex IFrame popup first.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      channexChannelId = bdcChannel.id;
      this.logger.log(`[BDC_SYNC] BDC channel found via discovery — channelId=${channexChannelId}`);
    }
```

All remaining references to `channexChannelId` in the method are unchanged — they already use that variable name.

### Part B — Controller

- [ ] **Step 3: Pass `channelId` through the controller**

In `channex-property.controller.ts`, find the `syncBdc` handler (around line 401). Update it to extract and forward `channelId`:

```typescript
  @Post(':propertyId/sync-bdc')
  @HttpCode(HttpStatus.CREATED)
  async syncBdc(
    @Param('propertyId') propertyId: string,
    @Body('tenantId') tenantId: string,
    @Body('channelId') channelId: string | undefined,
  ): Promise<BdcSyncResult> {
    this.logger.log(
      `[CTRL] POST /channex/properties/${propertyId}/sync-bdc — tenantId=${tenantId} channelId=${channelId ?? 'discovery'}`,
    );

    const result = await this.bdcSyncService.syncBdc(propertyId, tenantId, channelId);

    this.logger.log(
      `[CTRL] ✓ BDC sync complete — succeeded=${result.succeeded.length} failed=${result.failed.length}`,
    );

    return result;
  }
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd apps/backend && pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/channex/channex-bdc-sync.service.ts apps/backend/src/channex/channex-property.controller.ts
git commit -m "feat(channex): syncBdc accepts optional channelId to skip discovery"
```

---

## Task 5: Frontend — API functions in `channexHubApi.ts`

**Files:**
- Modify: `apps/frontend/src/channex/api/channexHubApi.ts`

- [ ] **Step 1: Add `BdcChannel` interface and `getBdcChannels` function**

Open `apps/frontend/src/channex/api/channexHubApi.ts`. Find the `// ─── OTA — Booking.com` section (around line 455). Insert the following **before** the existing `BdcSyncResult` interface:

```typescript
// ─── OTA — Booking.com ────────────────────────────────────────────────────────

export interface BdcChannel {
  id: string;
  title: string;
}

/**
 * GET /api/channex/properties/bdc-channels?tenantId=X
 *
 * Returns all Booking.com channels belonging to the tenant's Channex group.
 * Used by BdcChannelSelectModal to populate the channel list.
 */
export async function getBdcChannels(tenantId: string): Promise<BdcChannel[]> {
  const params = new URLSearchParams({ tenantId });
  return apiFetch(`${BASE}/properties/bdc-channels?${params}`);
}
```

- [ ] **Step 2: Update `syncBdcListings` to accept optional `channelId`**

Find the existing `syncBdcListings` function:

```typescript
export async function syncBdcListings(
  propertyId: string,
  tenantId: string,
): Promise<BdcSyncResult> {
  return apiFetch(`${BASE}/properties/${encodeURIComponent(propertyId)}/sync-bdc`, {
    method: 'POST',
    body: JSON.stringify({ tenantId }),
  });
}
```

Replace with:

```typescript
export async function syncBdcListings(
  propertyId: string,
  tenantId: string,
  channelId?: string,
): Promise<BdcSyncResult> {
  return apiFetch(`${BASE}/properties/${encodeURIComponent(propertyId)}/sync-bdc`, {
    method: 'POST',
    body: JSON.stringify({ tenantId, ...(channelId ? { channelId } : {}) }),
  });
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/frontend && pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/channex/api/channexHubApi.ts
git commit -m "feat(channex): add getBdcChannels and update syncBdcListings with optional channelId"
```

---

## Task 6: Frontend — `BdcChannelSelectModal` component

**Files:**
- Create: `apps/frontend/src/channex/components/connection/BdcChannelSelectModal.tsx`

- [ ] **Step 1: Create the file**

Create `apps/frontend/src/channex/components/connection/BdcChannelSelectModal.tsx` with this content:

```tsx
import { useEffect, useState } from 'react';
import { getBdcChannels, type BdcChannel } from '../../api/channexHubApi';
import Button from '../../../components/ui/Button';

interface Props {
  tenantId: string;
  onConfirm: (channelId: string) => void;
  onClose: () => void;
}

export default function BdcChannelSelectModal({ tenantId, onConfirm, onClose }: Props) {
  const [channels, setChannels] = useState<BdcChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await getBdcChannels(tenantId);
      setChannels(data);
      // Pre-select if exactly one channel available
      if (data.length === 1) setSelected(data[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load channels.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [tenantId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-edge bg-surface-raised px-6 py-6 shadow-xl">
        <h3 className="mb-1 text-base font-semibold text-content">
          Select Booking.com Hotel
        </h3>
        <p className="mb-4 text-sm text-content-2">
          Choose which hotel to sync Rooms &amp; Rates for.
        </p>

        {loading && (
          <p className="py-4 text-center text-sm text-content-3">Loading channels…</p>
        )}

        {!loading && error && (
          <div className="mb-4">
            <p className="mb-3 text-sm text-danger-text">{error}</p>
            <Button type="button" variant="secondary" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        )}

        {!loading && !error && channels.length === 0 && (
          <p className="py-4 text-center text-sm text-content-3">
            No Booking.com channels found for this account.
          </p>
        )}

        {!loading && !error && channels.length > 0 && (
          <div className="mb-5 space-y-2">
            {channels.map((ch) => (
              <label
                key={ch.id}
                className="flex cursor-pointer items-center gap-3 rounded-xl border border-edge bg-surface px-4 py-3 transition hover:bg-surface-subtle has-[:checked]:border-brand has-[:checked]:bg-brand/5"
              >
                <input
                  type="radio"
                  name="bdc-channel"
                  value={ch.id}
                  checked={selected === ch.id}
                  onChange={() => setSelected(ch.id)}
                  className="accent-brand"
                />
                <span className="text-sm font-medium text-content">{ch.title}</span>
              </label>
            ))}
          </div>
        )}

        <div className="flex gap-3">
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={!selected}
            onClick={() => selected && onConfirm(selected)}
          >
            Sync
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
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
git add apps/frontend/src/channex/components/connection/BdcChannelSelectModal.tsx
git commit -m "feat(channex): add BdcChannelSelectModal for hotel selection before sync"
```

---

## Task 7: Frontend — Wire modal into `BookingConnectionPanel`

**Files:**
- Modify: `apps/frontend/src/channex/components/connection/BookingConnectionPanel.tsx`

- [ ] **Step 1: Add modal import**

Open `apps/frontend/src/channex/components/connection/BookingConnectionPanel.tsx`. Add the modal import after the existing imports:

```typescript
import BdcChannelSelectModal from './BdcChannelSelectModal';
```

- [ ] **Step 2: Add `showChannelModal` state**

Inside `BookingConnectionPanel`, find the existing state declarations (around line 26–32). Add one new state after them:

```typescript
const [showChannelModal, setShowChannelModal] = useState(false);
```

- [ ] **Step 3: Replace `handleSync` with `handleSyncConfirmed`**

Find the existing `handleSync` callback (around line 46–59):

```typescript
  const handleSync = useCallback(async () => {
    if (!baseProperty) return;
    setSyncing(true);
    setError(null);
    setSyncResult(null);
    try {
      const result = await syncBdcListings(baseProperty.channex_property_id, tenantId);
      setSyncResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  }, [baseProperty, tenantId]);
```

Replace it with:

```typescript
  const handleSyncConfirmed = useCallback(async (channelId: string) => {
    if (!baseProperty) return;
    setShowChannelModal(false);
    setSyncing(true);
    setError(null);
    setSyncResult(null);
    try {
      const result = await syncBdcListings(
        baseProperty.channex_property_id,
        tenantId,
        channelId,
      );
      setSyncResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  }, [baseProperty, tenantId]);
```

- [ ] **Step 4: Update "Sync Rooms & Rates" button onClick**

Find the "Sync Rooms & Rates" button (around line 158–177). Change `onClick`:

```tsx
                  <button
                    type="button"
                    disabled={isLocked}
                    onClick={() => setShowChannelModal(true)}
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
```

- [ ] **Step 5: Render the modal**

Find the closing `</div>` of the outer `<div className="space-y-6">` (last line of the component return). Insert the modal render **just before** that final `</div>`:

```tsx
      {showChannelModal && baseProperty && (
        <BdcChannelSelectModal
          tenantId={tenantId}
          onConfirm={(channelId) => void handleSyncConfirmed(channelId)}
          onClose={() => setShowChannelModal(false)}
        />
      )}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd apps/frontend && pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/channex/components/connection/BookingConnectionPanel.tsx
git commit -m "feat(booking): open BdcChannelSelectModal on Sync Rooms & Rates click"
```

---

## Task 8: End-to-end verification

- [ ] **Step 1: Start the full stack**

```bash
# From repo root
pnpm dev
```

Backend: `http://localhost:3001` · Frontend: `https://localhost:5173`

- [ ] **Step 2: Verify `GET /channex/properties/bdc-channels`**

```bash
# Replace REAL_TENANT_ID with a tenant that has a provisioned Channex property
curl -s "http://localhost:3001/channex/properties/bdc-channels?tenantId=REAL_TENANT_ID" | jq .
# Expected: [{ "id": "...", "title": "Hotel Name" }]

# 404 path
curl -s "http://localhost:3001/channex/properties/bdc-channels?tenantId=unknown-tenant" | jq .
# Expected: { "statusCode": 404, "message": "No Channex group found for tenant: unknown-tenant..." }
```

- [ ] **Step 3: Verify modal flow in the browser**

1. Navigate to `https://localhost:5173` → Booking.com tab
2. Click **Sync Rooms & Rates**
3. Verify modal opens and shows a loading spinner
4. Verify channel list appears with radio buttons
5. If only one channel: verify it is pre-selected
6. Select a channel and click **Sync**
7. Verify modal closes and the "Syncing…" spinner appears on the button
8. Verify sync result banner: "Sync complete — X room type(s) and Y rate plan(s) synced"
9. Click **Cancel** — verify modal closes without triggering sync

- [ ] **Step 4: Verify backwards compatibility**

```bash
# Direct call without channelId — should still use discovery and succeed
curl -s -X POST http://localhost:3001/channex/properties/REAL_PROPERTY_ID/sync-bdc \
  -H "Content-Type: application/json" \
  -d '{"tenantId":"REAL_TENANT_ID"}' | jq .
# Expected: BdcSyncResult with succeeded/failed arrays, no error
```

- [ ] **Step 5: Final commit (mark plan complete)**

```bash
git add docs/superpowers/plans/2026-05-16-bdc-channel-selector.md
git commit -m "docs: mark bdc-channel-selector plan as complete"
```

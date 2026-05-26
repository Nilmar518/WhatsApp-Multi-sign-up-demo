# BDC Single-Property Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken 1:1 isolated-property model for Booking.com with the architecturally correct single-property model so that all BDC booking webhooks route correctly regardless of which room is booked.

**Architecture:** All BDC room types and rate plans are created under one base Channex property (provisioned before the sync). The BDC channel stays assigned to that base property permanently — no re-assignment step. `migo_property_id` is stored per room type in the base property's Firestore doc, with a fallback to property-level for backward compatibility.

**Tech Stack:** NestJS 10, TypeScript, Firestore (firebase-admin), Channex REST API, React 18, Vite

---

## File Map

| File | Change |
|------|--------|
| `apps/backend/src/channex/channex-ari.service.ts` | Add `migo_property_id?: string` to `StoredRoomType` |
| `apps/backend/src/channex/channex-sync.service.ts` | Add `migoPropertyId?: string` to `SyncNameOverride` + `ListingPreviewRoom` |
| `apps/backend/src/channex/channex-bdc-sync.service.ts` | Full pipeline rewrite (single-property model) |
| `apps/backend/src/channex/workers/channex-booking.worker.ts` | Two-level `migo_property_id` lookup |
| `apps/frontend/src/channex/api/channexHubApi.ts` | Update BDC result types; add `migoPropertyId` to frontend types |
| `apps/frontend/src/channex/components/connection/SyncNamingModal.tsx` | Add `channel` prop; BDC multi-room layout |
| `apps/frontend/src/channex/components/connection/BookingConnectionPanel.tsx` | Add provisioning step before IFrame |

---

## Task 1: Add `migo_property_id` to `StoredRoomType`

**Files:**
- Modify: `apps/backend/src/channex/channex-ari.service.ts:54-66`

This is the shared interface used by the booking worker's two-level lookup (Task 4) and by the BDC sync persistence (Task 3).

- [ ] **Step 1: Add field to `StoredRoomType`**

In `apps/backend/src/channex/channex-ari.service.ts`, change lines 54–66:

```typescript
export interface StoredRoomType {
  room_type_id: string;
  title: string;
  default_occupancy: number;
  occ_adults: number;
  occ_children: number;
  occ_infants: number;
  count_of_rooms: number;
  source: 'manual' | 'airbnb' | 'booking';
  ota_listing_id?: string;
  ota_room_id?: string;
  migo_property_id?: string;   // per room type — used by BDC single-property model
  rate_plans: StoredRatePlan[];
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/backend && pnpm tsc --noEmit
```
Expected: no errors (new optional field, no existing code breaks).

---

## Task 2: Add `migoPropertyId` to sync interfaces

**Files:**
- Modify: `apps/backend/src/channex/channex-sync.service.ts:145-164`

- [ ] **Step 1: Update `ListingPreviewRoom` and `SyncNameOverride`**

In `apps/backend/src/channex/channex-sync.service.ts`, change lines 145–164:

```typescript
export interface ListingPreviewRoom {
  id: string;
  roomName: string;
  rates: ListingPreviewRate[];
  migoPropertyId?: string;   // pre-populated in BDC preview for the naming modal
}

export interface ListingPreviewProperty {
  id: string;
  propertyName: string;
  rooms: ListingPreviewRoom[];
}

/** Maps OTA entity ID → custom names. Missing keys fall back to listing defaults. */
export interface SyncNameOverride {
  propertyName?: string;
  roomName?: string;
  rates?: Record<string, string>;
  migoPropertyId?: string;   // per room (BDC); ignored for Airbnb
}

export type SyncNameOverrides = Record<string, SyncNameOverride>;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/backend && pnpm tsc --noEmit
```
Expected: no errors.

---

## Task 3: Rewrite `channex-bdc-sync.service.ts`

**Files:**
- Modify: `apps/backend/src/channex/channex-bdc-sync.service.ts` (full rewrite)

This is the core change. The new pipeline:
- Creates room types + rate plans under `parentPropertyId` (no new isolated properties).
- Applies channel mappings once after all rooms succeed.
- Activates the channel once.
- Registers webhook on `parentPropertyId` once.
- Installs Messages App on `parentPropertyId` once.
- Persists one base property doc with `room_types[]` array.
- Eliminates Step E.5 (the re-assignment bug).

### New result types

- [ ] **Step 1: Update result type interfaces at top of file (lines 23–45)**

Replace the `IsolatedBdcResult`, `IsolatedBdcFailure`, `BdcSyncResult` interfaces with:

```typescript
export interface BdcRoomResult {
  otaRoomId: string;
  otaRoomTitle: string;
  channexRoomTitle: string;    // user-provided name (from SyncNameOverrides)
  roomTypeId: string;
  ratePlanIds: string[];
}

export interface BdcRoomFailure {
  otaRoomId: string;
  otaRoomTitle: string;
  step: 'A' | 'B';            // A = room type creation, B = rate plan creation
  reason: string;
}

export interface BdcSyncResult {
  channexChannelId: string;
  channexPropertyId: string;  // base property (single, permanent)
  webhookId: string | null;
  succeeded: BdcRoomResult[];
  failed: BdcRoomFailure[];
}
```

### New `getBdcListingPreview()`

- [ ] **Step 2: Rewrite `getBdcListingPreview` to return 1 property with N rooms**

Replace the method body (current lines 75–122) with:

```typescript
async getBdcListingPreview(propertyId: string, channelId?: string): Promise<ListingPreviewProperty[]> {
  let channexChannelId: string;
  if (channelId) {
    channexChannelId = channelId;
  } else {
    const channels = await this.channex.getChannels(propertyId);
    const bdcChannel = channels.find(
      (c) =>
        c.attributes?.channel === 'BookingCom' ||
        c.attributes?.channel_design_id === 'booking_com',
    );
    if (!bdcChannel) {
      throw new HttpException(
        'No Booking.com channel found for this property.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    channexChannelId = bdcChannel.id;
  }

  const channelDetails = await this.channex.getChannelDetails(channexChannelId);
  const raw = await this.channex.getMappingDetails(channelDetails.channel, channelDetails.settings);
  const entries = this.parseMappingDetails(raw);

  // Group all rates by room
  const roomsMap = new Map<string, BdcMappingEntry[]>();
  for (const entry of entries) {
    const group = roomsMap.get(entry.otaRoomId) ?? [];
    roomsMap.set(entry.otaRoomId, [...group, entry]);
  }

  // Single property with all BDC rooms nested inside
  const rooms: import('./channex-sync.service').ListingPreviewRoom[] = [];
  for (const [otaRoomId, roomEntries] of roomsMap) {
    rooms.push({
      id: otaRoomId,
      roomName: roomEntries[0].otaRoomTitle,
      rates: roomEntries.map((e) => ({ id: e.otaRateId, rateName: e.otaRateTitle })),
    });
  }

  return [
    {
      id: propertyId,           // base property Channex ID
      propertyName: '',         // read-only in modal — set during provisionProperty
      rooms,
    },
  ];
}
```

### New `syncBdc()` pipeline

- [ ] **Step 3: Rewrite `syncBdc()` method (lines 124–346)**

Replace the entire method body with the single-property pipeline:

```typescript
async syncBdc(
  propertyId: string,
  tenantId: string,
  channelId?: string,
  nameOverrides?: SyncNameOverrides,
): Promise<BdcSyncResult> {
  this.logger.log(`[BDC_SYNC] ▶ Starting — parentPropertyId=${propertyId} tenantId=${tenantId}`);

  // ── Step 0: Resolve BDC channel ID ─────────────────────────────────────────
  let channexChannelId: string;
  if (channelId) {
    channexChannelId = channelId;
    this.logger.log(`[BDC_SYNC] BDC channel provided — channelId=${channexChannelId}`);
  } else {
    const channels = await this.channex.getChannels(propertyId);
    const bdcChannel = channels.find(
      (c) =>
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
    this.logger.log(`[BDC_SYNC] BDC channel discovered — channelId=${channexChannelId}`);
  }

  // ── Step 1: Fetch mapping_details ──────────────────────────────────────────
  const channelDetails = await this.channex.getChannelDetails(channexChannelId);
  const raw = await this.channex.getMappingDetails(channelDetails.channel, channelDetails.settings);
  const entries = this.parseMappingDetails(raw);
  this.logger.log(`[BDC_SYNC] mapping_details ✓ — entries=${entries.length}`);

  if (entries.length === 0) {
    throw new HttpException(
      'mapping_details returned no rooms. Ensure the Booking.com Hotel ID was entered in the IFrame popup.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  // ── Step 2: Resolve parent doc metadata ────────────────────────────────────
  const parentDoc = await this.resolveParentDoc(propertyId);

  // ── Phase 1: Create room types + rate plans under parentPropertyId ─────────
  const succeeded: BdcRoomResult[] = [];
  const failed: BdcRoomFailure[] = [];

  // room mapping accumulator: otaRoomId → channexRoomTypeId
  const roomMappings: Record<string, string> = {};
  // rate plan mapping accumulator for channel update body
  const ratePlanMappings: Array<Record<string, unknown>> = [];

  const roomsMap = new Map<string, BdcMappingEntry[]>();
  for (const entry of entries) {
    const group = roomsMap.get(entry.otaRoomId) ?? [];
    roomsMap.set(entry.otaRoomId, [...group, entry]);
  }

  for (const [otaRoomId, roomEntries] of roomsMap) {
    const first = roomEntries[0];
    const override = nameOverrides?.[otaRoomId];
    const roomTitle = override?.roomName ?? first.otaRoomTitle;
    let currentStep: BdcRoomFailure['step'] = 'A';

    try {
      // ── Step A: Create room type under parentPropertyId ───────────────────
      currentStep = 'A';
      const rtResp = await this.channex.createRoomType({
        property_id: propertyId,
        title: roomTitle,
        count_of_rooms: 1,
        occ_adults: first.maxPersons,
        occ_children: 0,
        occ_infants: 0,
        default_occupancy: first.maxPersons,
      });
      const roomTypeId = rtResp.data.id;
      this.logger.log(
        `[BDC_SYNC] ✓ A — Room type created — "${roomTitle}" roomTypeId=${roomTypeId}`,
      );

      // ── Step B: Create rate plans under parentPropertyId ─────────────────
      currentStep = 'B';
      const ratePlanIds: string[] = [];
      for (const rateEntry of roomEntries) {
        const rateName = override?.rates?.[rateEntry.otaRateId] ?? rateEntry.otaRateTitle;
        const rpResp = await this.channex.createRatePlan({
          property_id: propertyId,
          room_type_id: roomTypeId,
          title: rateName,
          options: [{ occupancy: rateEntry.maxPersons, is_primary: true, rate: 0 }],
        });
        const ratePlanId = rpResp.data.id;
        ratePlanIds.push(ratePlanId);
        this.logger.log(
          `[BDC_SYNC] ✓ B — Rate plan created — "${rateName}" ratePlanId=${ratePlanId}`,
        );
        ratePlanMappings.push({
          rate_plan_id: ratePlanId,
          settings: {
            room_type_code: Number(rateEntry.otaRoomId),
            rate_plan_code: Number(rateEntry.otaRateId),
            occupancy: rateEntry.maxPersons,
            readonly: rateEntry.readonly,
            primary_occ: true,
            occ_changed: false,
            pricing_type: rateEntry.pricingType,
          },
        });
      }

      roomMappings[otaRoomId] = roomTypeId;
      succeeded.push({
        otaRoomId,
        otaRoomTitle: first.otaRoomTitle,
        channexRoomTitle: roomTitle,
        roomTypeId,
        ratePlanIds,
      });
    } catch (err) {
      const reason = (err as Error).message ?? String(err);
      this.logger.error(
        `[BDC_SYNC] Step ${currentStep} failed — otaRoomId=${otaRoomId}: ${reason}`,
      );
      failed.push({ otaRoomId, otaRoomTitle: first.otaRoomTitle, step: currentStep, reason });
    }
  }

  if (succeeded.length === 0) {
    throw new HttpException(
      'All BDC rooms failed to provision. Check server logs for details.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  // ── Phase 2: Channel + webhook + app — all on parentPropertyId ─────────────

  // ── Step C: Apply full room+rate mapping on BDC channel ───────────────────
  await this.channex.updateChannel(channexChannelId, {
    settings: { ...channelDetails.settings, mappingSettings: { rooms: roomMappings } },
    rate_plans: ratePlanMappings,
  });
  this.logger.log(
    `[BDC_SYNC] ✓ C — Channel mappings applied — rooms=${Object.keys(roomMappings).length} rates=${ratePlanMappings.length}`,
  );

  // ── Step D: Activate BDC channel ─────────────────────────────────────────
  try {
    await this.channex.activateChannelAction(channexChannelId);
  } catch {
    this.logger.warn('[BDC_SYNC] activateChannelAction failed — falling back to PUT is_active');
    await this.channex.activateChannel(channexChannelId);
  }
  this.logger.log(`[BDC_SYNC] ✓ D — BDC channel activated`);

  // ── Step E: Register webhook on parentPropertyId (once) ──────────────────
  const webhookId = await this.registerPropertyWebhook(propertyId);
  this.logger.log(
    `[BDC_SYNC] ✓ E — Webhook — propertyId=${propertyId} webhookId=${webhookId ?? 'none'}`,
  );

  // ── Step F: Install Messages App on parentPropertyId (once) ──────────────
  await this.channex.installApplication(propertyId, ChannexService.APP_IDS.channex_messages);
  this.logger.log(`[BDC_SYNC] ✓ F — Messages App installed — propertyId=${propertyId}`);

  // ── Step G: Install Booking CRS App (non-fatal) ───────────────────────────
  try {
    await this.channex.installBookingCrsApp(propertyId);
    this.logger.log(`[BDC_SYNC] ✓ G — Booking CRS installed — propertyId=${propertyId}`);
  } catch (err) {
    this.logger.warn(
      `[BDC_SYNC] Booking CRS install failed (non-fatal): ${(err as Error).message}`,
    );
  }

  // ── Step H: Persist to Firestore ─────────────────────────────────────────
  await this.persistToFirestore(
    propertyId,
    tenantId,
    channexChannelId,
    webhookId,
    succeeded,
    nameOverrides,
    parentDoc,
  );

  this.logger.log(
    `[BDC_SYNC] ✓ Pipeline complete — tenantId=${tenantId} succeeded=${succeeded.length} failed=${failed.length}`,
  );

  return { channexChannelId, channexPropertyId: propertyId, webhookId, succeeded, failed };
}
```

### New `persistToFirestore()`

- [ ] **Step 4: Rewrite `persistToFirestore` (lines 464–565)**

Replace the private method signature and body:

```typescript
private async persistToFirestore(
  parentPropertyId: string,
  tenantId: string,
  channexChannelId: string,
  webhookId: string | null,
  succeeded: BdcRoomResult[],
  nameOverrides: SyncNameOverrides | undefined,
  parentDoc: { timezone: string; channex_group_id: string | null; currency: string },
): Promise<void> {
  const db = this.firebase.getFirestore();
  const now = new Date().toISOString();

  // Build room_types[] — one entry per successfully provisioned room
  const roomTypes: StoredRoomType[] = succeeded.map((s) => {
    const override = nameOverrides?.[s.otaRoomId];
    return {
      room_type_id: s.roomTypeId,
      title: s.channexRoomTitle,
      count_of_rooms: 1,
      default_occupancy: 2,
      occ_adults: 2,
      occ_children: 0,
      occ_infants: 0,
      source: 'booking',
      ota_room_id: s.otaRoomId,
      migo_property_id: override?.migoPropertyId ?? undefined,
      rate_plans: s.ratePlanIds.map((id, i) => ({
        rate_plan_id: id,
        title: s.channexRoomTitle,
        currency: parentDoc.currency,
        rate: 0,
        occupancy: 2,
        is_primary: i === 0,
        ota_rate_id: s.otaRoomId,
      } as StoredRatePlan)),
    };
  });

  // Merge new BDC room types into base property doc (preserves manual rooms)
  const propertyRef = db
    .collection(COLLECTION)
    .doc(tenantId)
    .collection('properties')
    .doc(parentPropertyId);

  const existingSnap = await propertyRef.get();
  const existing = existingSnap.exists
    ? ((existingSnap.data()?.room_types as StoredRoomType[] | undefined) ?? [])
    : [];

  // Replace all 'booking' source rooms with the new set (idempotent re-sync)
  const merged = mergeRoomTypes(existing, roomTypes, 'booking');

  await this.firebase.set(
    propertyRef,
    {
      channex_channel_id: channexChannelId,
      channex_webhook_id: webhookId,
      connection_status: ChannexConnectionStatus.Active,
      connected_channels: ['booking'],
      room_types: merged,
      last_bdc_sync_timestamp: now,
      updated_at: now,
    },
    { merge: true },
  );

  this.logger.log(
    `[BDC_SYNC] ✓ Base property doc updated — propertyId=${parentPropertyId} rooms=${roomTypes.length}`,
  );

  // Update root integration doc with sync metadata
  const rootRef = db.collection(COLLECTION).doc(tenantId);
  await this.firebase.update(rootRef, {
    last_bdc_sync_timestamp: now,
    bdc_channel_id: channexChannelId,
    bdc_webhook_id: webhookId,
    updated_at: now,
  });

  // Register channel doc so getPropertyBookings can resolve propertyChannelCode
  try {
    const ch = await this.channex.getChannelDetails(channexChannelId);
    await db
      .collection(COLLECTION)
      .doc(tenantId)
      .collection('channels')
      .doc(channexChannelId)
      .set({
        channel_id: channexChannelId,
        title: ch.title,
        channel_code: ch.channel,
        status: ch.status,
        is_active: ch.isActive,
        synced_at: now,
        updated_at: now,
      });
  } catch (err) {
    this.logger.warn(
      `[BDC_SYNC] WARN — Could not register channel doc (non-fatal): ${(err as Error).message}`,
    );
  }
}
```

- [ ] **Step 5: Add missing import for `mergeRoomTypes`**

At the top of `channex-bdc-sync.service.ts`, the import on line 5 currently reads:
```typescript
import { StoredRoomType, StoredRatePlan } from './channex-ari.service';
```
Change to:
```typescript
import { StoredRoomType, StoredRatePlan, mergeRoomTypes } from './channex-ari.service';
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd apps/backend && pnpm tsc --noEmit
```
Expected: no errors.

---

## Task 4: Two-level `migo_property_id` lookup in booking worker

**Files:**
- Modify: `apps/backend/src/channex/workers/channex-booking.worker.ts:326-327`

- [ ] **Step 1: Replace single-level lookup with two-level lookup**

Add import for `StoredRoomType` at the top of the file if not already present. Then change lines 326–327:

```typescript
// BEFORE:
const migoPropertyId =
  (propertyDocSnap.data()?.migo_property_id as string | null) ?? null;
```

Replace with:

```typescript
import type { StoredRoomType } from '../channex-ari.service';

// In processInternal(), after propertyDocSnap is fetched (line ~221):
const roomTypes =
  (propertyDocSnap.data()?.room_types as StoredRoomType[] | undefined) ?? [];
const matchingRoom = reservationDoc.room_type_id
  ? roomTypes.find((rt) => rt.room_type_id === reservationDoc.room_type_id)
  : undefined;
const migoPropertyId =
  matchingRoom?.migo_property_id ??
  (propertyDocSnap.data()?.migo_property_id as string | null | undefined) ??
  null;
```

The `import type` goes at the top of the file. The runtime lookup replaces lines 326–327 in the file.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/backend && pnpm tsc --noEmit
```
Expected: no errors.

---

## Task 5: Update frontend BDC types in `channexHubApi.ts`

**Files:**
- Modify: `apps/frontend/src/channex/api/channexHubApi.ts:541-570` (BDC types section)

- [ ] **Step 1: Replace `IsolatedBdcResult`, `IsolatedBdcFailure`, `BdcSyncResult` and update `SyncNameOverride`, `ListingPreviewRoom`**

Change the BDC types block (lines 541–569):

```typescript
// ─── OTA — Booking.com ────────────────────────────────────────────────────────

export interface BdcChannel {
  id: string;
  title: string;
}

export async function getBdcChannels(tenantId: string): Promise<BdcChannel[]> {
  const params = new URLSearchParams({ tenantId });
  return apiFetch(`${BASE}/properties/bdc-channels?${params}`);
}

export interface BdcRoomResult {
  otaRoomId: string;
  otaRoomTitle: string;
  channexRoomTitle: string;
  roomTypeId: string;
  ratePlanIds: string[];
}

export interface BdcRoomFailure {
  otaRoomId: string;
  otaRoomTitle: string;
  step: 'A' | 'B';
  reason: string;
}

export interface BdcSyncResult {
  channexChannelId: string;
  channexPropertyId: string;   // base property — single for all BDC rooms
  webhookId: string | null;
  succeeded: BdcRoomResult[];
  failed: BdcRoomFailure[];
}
```

Change the listing preview + name override block (lines 563–569):

```typescript
// ─── Listing Preview (naming modal) ──────────────────────────────────────────

export interface ListingPreviewRate { id: string; rateName: string; }
export interface ListingPreviewRoom {
  id: string;
  roomName: string;
  rates: ListingPreviewRate[];
  migoPropertyId?: string;   // pre-populated from BDC mapping_details
}
export interface ListingPreviewProperty { id: string; propertyName: string; rooms: ListingPreviewRoom[]; }
export interface SyncNameOverride {
  propertyName?: string;
  roomName?: string;
  rates?: Record<string, string>;
  migoPropertyId?: string;   // per room (BDC)
}
export type SyncNameOverrides = Record<string, SyncNameOverride>;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/frontend && pnpm tsc --noEmit
```
Expected: no errors (or only pre-existing errors unrelated to these types).

---

## Task 6: Update `SyncNamingModal` — add `channel` prop and BDC layout

**Files:**
- Modify: `apps/frontend/src/channex/components/connection/SyncNamingModal.tsx`

- [ ] **Step 1: Add `channel` prop and BDC multi-room state initialization**

Replace the entire file with:

```typescript
import { useState } from 'react';
import type { ListingPreviewProperty, SyncNameOverrides } from '../../api/channexHubApi';
import { useLanguage } from '../../../context/LanguageContext';

interface Props {
  preview: ListingPreviewProperty[];
  channel: 'airbnb' | 'booking';
  onConfirm: (overrides: SyncNameOverrides) => void;
  onClose: () => void;
}

export default function SyncNamingModal({ preview, channel, onConfirm, onClose }: Props) {
  const { t } = useLanguage();
  const [names, setNames] = useState<SyncNameOverrides>(() => {
    const initial: SyncNameOverrides = {};

    if (channel === 'booking') {
      // BDC: 1 property, N rooms — key = otaRoomId
      const prop = preview[0];
      if (prop) {
        for (const room of prop.rooms) {
          initial[room.id] = {
            roomName: room.roomName,
            rates: Object.fromEntries(room.rates.map((r) => [r.id, r.rateName])),
            migoPropertyId: room.migoPropertyId ?? '',
          };
        }
      }
    } else {
      // Airbnb: N properties, 1 room per property — key = prop.id
      for (const prop of preview) {
        initial[prop.id] = {
          propertyName: prop.propertyName,
          roomName: prop.rooms[0]?.roomName ?? prop.propertyName,
          rates: Object.fromEntries((prop.rooms[0]?.rates ?? []).map((r) => [r.id, r.rateName])),
        };
      }
    }
    return initial;
  });

  function setPropertyName(propId: string, value: string) {
    setNames((prev) => ({ ...prev, [propId]: { ...prev[propId], propertyName: value } }));
  }

  function setRoomName(key: string, value: string) {
    setNames((prev) => ({ ...prev, [key]: { ...prev[key], roomName: value } }));
  }

  function setRateName(key: string, rateId: string, value: string) {
    setNames((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        rates: { ...(prev[key]?.rates ?? {}), [rateId]: value },
      },
    }));
  }

  function setMigoPropertyId(key: string, value: string) {
    setNames((prev) => ({ ...prev, [key]: { ...prev[key], migoPropertyId: value } }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-edge bg-surface shadow-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-edge px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-content">{t('channex.syncNaming.title')}</h2>
            <p className="text-xs text-content-2 mt-0.5">{t('channex.syncNaming.desc')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-content-3 hover:text-content transition-colors"
            aria-label="Close"
          >
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 2l12 12M14 2L2 14" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-6">
          {channel === 'booking' ? (
            // BDC layout: read-only property header, editable room rows
            <>
              {preview[0] && (
                <div className="flex items-center gap-2 pb-2 border-b border-edge">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-brand/10 text-[10px] font-bold text-brand">B</span>
                  <span className="text-sm font-semibold text-content">{preview[0].propertyName || t('channex.syncNaming.hotel')}</span>
                </div>
              )}
              {(preview[0]?.rooms ?? []).map((room) => {
                const override = names[room.id] ?? {};
                return (
                  <div key={room.id} className="ml-2 border-l-2 border-edge pl-4 space-y-3">
                    {/* Room name */}
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-ok-bg text-[10px] font-bold text-ok-text">R</span>
                        <label className="text-xs font-semibold text-content-2 uppercase tracking-wide">{t('channex.syncNaming.room')}</label>
                      </div>
                      <input
                        type="text"
                        value={override.roomName ?? ''}
                        onChange={(e) => setRoomName(room.id, e.target.value)}
                        className="w-full rounded-xl border border-edge bg-surface-subtle px-3 py-2 text-sm text-content focus:border-brand focus:outline-none"
                      />
                    </div>

                    {/* Migo Property ID */}
                    <div>
                      <label className="text-xs font-semibold text-content-2 uppercase tracking-wide block mb-1">
                        {t('channex.syncNaming.migoRoomId')}
                      </label>
                      <input
                        type="text"
                        value={override.migoPropertyId ?? ''}
                        onChange={(e) => setMigoPropertyId(room.id, e.target.value)}
                        placeholder={t('channex.syncNaming.migoRoomIdPlaceholder')}
                        className="w-full rounded-xl border border-edge bg-surface-subtle px-3 py-2 text-sm text-content focus:border-brand focus:outline-none"
                      />
                    </div>

                    {/* Rate levels */}
                    {room.rates.length > 0 && (
                      <div className="ml-4 border-l-2 border-edge pl-4 space-y-2">
                        {room.rates.map((rate) => (
                          <div key={rate.id}>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-notice-bg text-[10px] font-bold text-notice-text">$</span>
                              <label className="text-xs font-semibold text-content-2 uppercase tracking-wide">{t('channex.syncNaming.rate')}</label>
                            </div>
                            <input
                              type="text"
                              value={override.rates?.[rate.id] ?? ''}
                              onChange={(e) => setRateName(room.id, rate.id, e.target.value)}
                              className="w-full rounded-xl border border-edge bg-surface-subtle px-3 py-2 text-sm text-content focus:border-brand focus:outline-none"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          ) : (
            // Airbnb layout: one card per property (unchanged)
            preview.map((prop) => {
              const override = names[prop.id] ?? {};
              const room = prop.rooms[0];
              return (
                <div key={prop.id}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-brand/10 text-[10px] font-bold text-brand">P</span>
                    <label className="text-xs font-semibold text-content-2 uppercase tracking-wide">{t('channex.syncNaming.property')}</label>
                  </div>
                  <input
                    type="text"
                    value={override.propertyName ?? ''}
                    onChange={(e) => setPropertyName(prop.id, e.target.value)}
                    className="w-full rounded-xl border border-edge bg-surface-subtle px-3 py-2 text-sm text-content focus:border-brand focus:outline-none"
                  />
                  {room && (
                    <div className="mt-3 ml-4 border-l-2 border-edge pl-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-ok-bg text-[10px] font-bold text-ok-text">R</span>
                        <label className="text-xs font-semibold text-content-2 uppercase tracking-wide">{t('channex.syncNaming.room')}</label>
                      </div>
                      <input
                        type="text"
                        value={override.roomName ?? ''}
                        onChange={(e) => setRoomName(prop.id, e.target.value)}
                        className="w-full rounded-xl border border-edge bg-surface-subtle px-3 py-2 text-sm text-content focus:border-brand focus:outline-none"
                      />
                      {room.rates.length > 0 && (
                        <div className="mt-3 ml-4 border-l-2 border-edge pl-4 space-y-2">
                          {room.rates.map((rate) => (
                            <div key={rate.id}>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-notice-bg text-[10px] font-bold text-notice-text">$</span>
                                <label className="text-xs font-semibold text-content-2 uppercase tracking-wide">{t('channex.syncNaming.rate')}</label>
                              </div>
                              <input
                                type="text"
                                value={override.rates?.[rate.id] ?? ''}
                                onChange={(e) => setRateName(prop.id, rate.id, e.target.value)}
                                className="w-full rounded-xl border border-edge bg-surface-subtle px-3 py-2 text-sm text-content focus:border-brand focus:outline-none"
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-edge px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm text-content-2 hover:text-content transition-colors"
          >
            {t('channex.syncNaming.cancel')}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(names)}
            className="rounded-xl bg-brand px-5 py-2 text-sm font-semibold text-white hover:opacity-80 transition-opacity"
          >
            {t('channex.syncNaming.sync')}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add missing i18n keys**

In your i18n translation files, add:
- `channex.syncNaming.hotel` → `"Hotel"` (fallback property name label)
- `channex.syncNaming.migoRoomId` → `"Migo Room ID"`
- `channex.syncNaming.migoRoomIdPlaceholder` → `"Optional — e.g. migo-room-001"`

Find the i18n file:
```bash
# Locate translation files
find apps/frontend/src -name "*.ts" | xargs grep -l "syncNaming" | head -5
```
Add the three keys alongside the existing `channex.syncNaming.*` keys.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/frontend && pnpm tsc --noEmit
```

---

## Task 7: Update `BookingConnectionPanel` — provisioning step

**Files:**
- Modify: `apps/frontend/src/channex/components/connection/BookingConnectionPanel.tsx`

The panel currently relies on `allProperties[0]` as the IFrame target. The new flow:
1. Show a "create hotel" form (hotel name, currency, timezone, optional hotel-level migo_property_id).
2. On submit, call `provisionProperty()` → store `createdPropertyId` in state.
3. Open IFrame with `createdPropertyId`.
4. Sync step uses `createdPropertyId` as `propertyId`.

- [ ] **Step 1: Add `createdPropertyId` state and provisioning form**

Replace the entire `BookingConnectionPanel.tsx` with:

```typescript
import { useState, useCallback, useEffect, useRef } from 'react';
import { useLanguage } from '../../../context/LanguageContext';
import { useChannexProperties } from '../../hooks/useChannexProperties';
import {
  getAirbnbSessionToken,
  syncBdcListings,
  getBdcPreview,
  provisionProperty,
  type BdcSyncResult,
  type ListingPreviewProperty,
  type SyncNameOverrides,
} from '../../api/channexHubApi';
import { useAllPropertyThreads } from '../../hooks/useChannexThreads';
import PropertyCard from '../shared/PropertyCard';
import PropertyDetail from '../shared/PropertyDetail';
import MessagesInbox from '../shared/MessagesInbox';
import ChannexOAuthIFrame from './ChannexOAuthIFrame';
import ChannelManagementPanel from './ChannelManagementPanel';
import NoPropertyGuide from './NoPropertyGuide';
import BdcChannelSelectModal from './BdcChannelSelectModal';
import SyncNamingModal from './SyncNamingModal';
import type { ChannexProperty } from '../../hooks/useChannexProperties';

type SyncStep = 'idle' | 'channelSelect' | 'loadingPreview' | 'naming' | 'syncing';

interface Props {
  tenantId: string;
  onNavigateToProperties: () => void;
  configOnly?: boolean;
}

const TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Europe/Madrid',
  'Europe/Berlin', 'Europe/Rome', 'Asia/Dubai', 'Asia/Bangkok', 'Asia/Tokyo',
  'Australia/Sydney',
];

const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'THB', 'JPY', 'AUD', 'MXN', 'BRL'];

export default function BookingConnectionPanel({ tenantId, onNavigateToProperties, configOnly = false }: Props) {
  const { t } = useLanguage();
  const { properties: allProperties, loading } = useChannexProperties(tenantId);
  const { properties: bookingProperties } = useChannexProperties(tenantId, { source: 'booking' });
  const [selectedProperty, setSelectedProperty] = useState<ChannexProperty | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<BdcSyncResult | null>(null);
  const [isOpen, setIsOpen] = useState(true);
  const [syncStep, setSyncStep] = useState<SyncStep>('idle');
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ListingPreviewProperty[] | null>(null);
  const [iframeReloadToken, setIframeReloadToken] = useState(0);
  const hasAutoCollapsed = useRef(false);

  // Provisioning form state
  const [createdPropertyId, setCreatedPropertyId] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [hotelName, setHotelName] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [timezone, setTimezone] = useState('UTC');
  const [hotelMigoId, setHotelMigoId] = useState('');

  const bookingPropertyIds = bookingProperties.map((p) => p.channex_property_id);
  const { threads: allThreads, loading: threadsLoading } = useAllPropertyThreads(tenantId, bookingPropertyIds);

  useEffect(() => {
    if (!loading && bookingProperties.length > 0 && !hasAutoCollapsed.current) {
      setIsOpen(false);
      hasAutoCollapsed.current = true;
    }
  }, [loading, bookingProperties.length]);

  const handleProvision = useCallback(async () => {
    if (!hotelName.trim()) return;
    setProvisioning(true);
    setProvisionError(null);
    try {
      const result = await provisionProperty({
        tenantId,
        migoPropertyId: hotelMigoId.trim() || tenantId,
        title: hotelName.trim(),
        currency,
        timezone,
        propertyType: 'hotel',
      });
      setCreatedPropertyId(result.channexPropertyId);
    } catch (err) {
      setProvisionError(err instanceof Error ? err.message : t('channex.bdcConn.err.provision'));
    } finally {
      setProvisioning(false);
    }
  }, [hotelName, currency, timezone, hotelMigoId, tenantId, t]);

  const handleChannelSelected = useCallback(async (channelId: string) => {
    if (!createdPropertyId) return;
    setSelectedChannelId(channelId);
    setSyncStep('loadingPreview');
    setPreviewError(null);
    try {
      const data = await getBdcPreview(createdPropertyId, tenantId, channelId);
      setPreview(data);
      setSyncStep('naming');
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : t('channex.bdcConn.err.preview'));
      setSyncStep('idle');
    }
  }, [createdPropertyId, tenantId, t]);

  const handleNamingConfirmed = useCallback(async (nameOverrides: SyncNameOverrides) => {
    if (!createdPropertyId || !selectedChannelId) return;
    setSyncStep('syncing');
    setError(null);
    setSyncResult(null);
    try {
      const result = await syncBdcListings(createdPropertyId, tenantId, selectedChannelId, nameOverrides);
      setSyncResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('channex.bdcConn.err.sync'));
    } finally {
      setSyncStep('idle');
    }
  }, [createdPropertyId, tenantId, selectedChannelId, t]);

  const handleReconnect = useCallback(() => {
    setError(null);
    setSyncResult(null);
    setIframeReloadToken((n) => n + 1);
  }, []);

  const handleCloseModals = useCallback(() => {
    setSyncStep('idle');
    setPreview(null);
    setSelectedChannelId(null);
  }, []);

  const syncing = syncStep === 'syncing';

  if (!configOnly && selectedProperty) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setSelectedProperty(null)}
          className="mb-4 text-sm text-content-2 hover:text-content"
        >
          {t('channex.bdcConn.back')}
        </button>
        <PropertyDetail property={selectedProperty} tenantId={tenantId} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <div className="rounded-2xl border border-edge bg-surface-raised overflow-hidden">
          {/* Accordion header */}
          <button
            type="button"
            onClick={() => setIsOpen((v) => !v)}
            className="w-full flex items-center justify-between gap-3 px-6 py-4 text-left hover:bg-surface-subtle transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-notice-bg">
                <span className="text-xs font-bold text-notice-text">B</span>
              </div>
              <div>
                <h2 className="text-base font-semibold text-content">{t('channex.bdcConn.title')}</h2>
                <p className="text-xs text-content-2">
                  {bookingProperties.length > 0
                    ? t(bookingProperties.length === 1 ? 'channex.bdcConn.prop.one' : 'channex.bdcConn.prop.many', { n: bookingProperties.length })
                    : t('channex.bdcConn.desc')}
                </p>
              </div>
            </div>
            <svg
              className={['h-4 w-4 shrink-0 text-content-2 transition-transform duration-200', isOpen ? 'rotate-180' : ''].join(' ')}
              viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            >
              <path d="M4 6l4 4 4-4" />
            </svg>
          </button>

          {isOpen && (
            <div className="border-t border-edge px-6 pb-6 pt-4">
              {loading && <p className="text-sm text-content-2">{t('channex.bdcConn.loadingProps')}</p>}

              {!loading && !createdPropertyId && (
                // ── Step 1: Provisioning form ────────────────────────────────
                <div className="space-y-3">
                  <p className="text-sm text-content-2">{t('channex.bdcConn.provisionDesc')}</p>

                  <div>
                    <label className="block text-xs font-semibold text-content-2 uppercase tracking-wide mb-1">
                      {t('channex.bdcConn.hotelName')} *
                    </label>
                    <input
                      type="text"
                      value={hotelName}
                      onChange={(e) => setHotelName(e.target.value)}
                      placeholder={t('channex.bdcConn.hotelNamePlaceholder')}
                      className="w-full rounded-xl border border-edge bg-surface-subtle px-3 py-2 text-sm text-content focus:border-brand focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-content-2 uppercase tracking-wide mb-1">
                        {t('channex.bdcConn.currency')}
                      </label>
                      <select
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value)}
                        className="w-full rounded-xl border border-edge bg-surface-subtle px-3 py-2 text-sm text-content focus:border-brand focus:outline-none"
                      >
                        {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-content-2 uppercase tracking-wide mb-1">
                        {t('channex.bdcConn.timezone')}
                      </label>
                      <select
                        value={timezone}
                        onChange={(e) => setTimezone(e.target.value)}
                        className="w-full rounded-xl border border-edge bg-surface-subtle px-3 py-2 text-sm text-content focus:border-brand focus:outline-none"
                      >
                        {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-content-2 uppercase tracking-wide mb-1">
                      {t('channex.bdcConn.migoHotelId')}
                    </label>
                    <input
                      type="text"
                      value={hotelMigoId}
                      onChange={(e) => setHotelMigoId(e.target.value)}
                      placeholder={t('channex.bdcConn.migoHotelIdPlaceholder')}
                      className="w-full rounded-xl border border-edge bg-surface-subtle px-3 py-2 text-sm text-content focus:border-brand focus:outline-none"
                    />
                  </div>

                  {provisionError && (
                    <div className="rounded-xl border border-danger-text/20 bg-danger-bg px-4 py-3 text-sm text-danger-text">
                      {provisionError}
                    </div>
                  )}

                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      disabled={provisioning || !hotelName.trim()}
                      onClick={() => void handleProvision()}
                      className={[
                        'inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors',
                        provisioning || !hotelName.trim()
                          ? 'cursor-not-allowed bg-surface-subtle text-content-3'
                          : 'bg-brand text-white hover:opacity-80',
                      ].join(' ')}
                    >
                      {provisioning ? (
                        <>
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                          {t('channex.bdcConn.provisioning')}
                        </>
                      ) : t('channex.bdcConn.createHotel')}
                    </button>
                  </div>
                </div>
              )}

              {!loading && createdPropertyId && (
                // ── Step 2: IFrame + sync ────────────────────────────────────
                <>
                  <ChannexOAuthIFrame
                    key={`${createdPropertyId}-${iframeReloadToken}`}
                    propertyId={createdPropertyId}
                    channel="BDC"
                    getToken={getAirbnbSessionToken}
                  />

                  {previewError && (
                    <div className="mt-3 rounded-xl border border-danger-text/20 bg-danger-bg px-4 py-3 text-sm text-danger-text">
                      {t('channex.bdcConn.previewErr', { error: previewError })}
                    </div>
                  )}

                  {error && (
                    <div className="mt-3 rounded-xl border border-danger-text/20 bg-danger-bg px-4 py-3 text-sm text-danger-text">
                      {t('channex.bdcConn.err', { error })}
                    </div>
                  )}

                  {syncResult && (
                    <div className={[
                      'mt-3 rounded-xl border px-4 py-3 text-sm',
                      syncResult.failed.length === 0
                        ? 'border-ok-text/20 bg-ok-bg text-ok-text'
                        : 'border-yellow-200 bg-yellow-50 text-yellow-800',
                    ].join(' ')}>
                      <p className="font-semibold">
                        {t(syncResult.succeeded.length === 1 ? 'channex.bdcConn.synced.one' : 'channex.bdcConn.synced.many', { n: syncResult.succeeded.length })}
                        {syncResult.failed.length > 0 && `, ${syncResult.failed.length} ${t('channex.bdcConn.failed')}`}
                      </p>
                      {syncResult.succeeded.map((s) => (
                        <p key={s.otaRoomId} className="mt-0.5">• {s.channexRoomTitle}</p>
                      ))}
                      {syncResult.failed.map((f) => (
                        <p key={f.otaRoomId} className="mt-0.5 text-red-700">
                          • {f.otaRoomTitle}: {f.reason} (step {f.step})
                        </p>
                      ))}
                    </div>
                  )}

                  <div className="mt-4 flex items-center justify-between border-t border-edge pt-4">
                    <button
                      type="button"
                      onClick={handleReconnect}
                      className="text-sm text-content-3 underline hover:no-underline"
                    >
                      {t('channex.bdcConn.reconnect')}
                    </button>
                    <button
                      type="button"
                      disabled={syncing || syncStep === 'loadingPreview'}
                      onClick={() => setSyncStep('channelSelect')}
                      className={[
                        'inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors',
                        syncing || syncStep === 'loadingPreview'
                          ? 'cursor-not-allowed bg-surface-subtle text-content-3'
                          : 'bg-brand text-white hover:opacity-80',
                      ].join(' ')}
                    >
                      {syncing ? (
                        <>
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                          {t('channex.bdcConn.syncing')}
                        </>
                      ) : syncStep === 'loadingPreview' ? (
                        <>
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-content-3 border-t-content-2" />
                          {t('channex.bdcConn.loadingPreview')}
                        </>
                      ) : t('channex.bdcConn.sync')}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <ChannelManagementPanel tenantId={tenantId} />
      </div>

      {syncStep === 'channelSelect' && (
        <BdcChannelSelectModal
          tenantId={tenantId}
          channelType="booking"
          onConfirm={(channelId) => void handleChannelSelected(channelId)}
          onClose={handleCloseModals}
        />
      )}

      {syncStep === 'naming' && preview && (
        <SyncNamingModal
          preview={preview}
          channel="booking"
          onConfirm={(overrides) => void handleNamingConfirmed(overrides)}
          onClose={handleCloseModals}
        />
      )}

      {!configOnly && bookingProperties.length > 0 && (
        <>
          <div>
            <h3 className="mb-3 text-sm font-semibold text-content">{t('channex.bdcConn.messages')}</h3>
            <MessagesInbox tenantId={tenantId} threads={allThreads} loading={threadsLoading} />
          </div>
          <div>
            <h3 className="mb-3 text-sm font-semibold text-content">{t('channex.bdcConn.connectedProps')}</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {bookingProperties.map((property) => (
                <PropertyCard key={property.firestoreDocId} property={property} onClick={setSelectedProperty} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add missing i18n keys for provisioning form**

Find the i18n file (same location as Task 6 Step 2) and add:
- `channex.bdcConn.provisionDesc` → `"Create a Channex hotel property first. This will be the home for all your Booking.com rooms."`
- `channex.bdcConn.hotelName` → `"Hotel Name"`
- `channex.bdcConn.hotelNamePlaceholder` → `"e.g. Grand Hotel Barcelona"`
- `channex.bdcConn.currency` → `"Currency"`
- `channex.bdcConn.timezone` → `"Timezone"`
- `channex.bdcConn.migoHotelId` → `"Migo Hotel ID (optional)"`
- `channex.bdcConn.migoHotelIdPlaceholder` → `"e.g. hotel-001"`
- `channex.bdcConn.provisioning` → `"Creating hotel…"`
- `channex.bdcConn.createHotel` → `"Create Hotel & Connect"`
- `channex.bdcConn.err.provision` → `"Failed to create hotel. Try again."`

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/frontend && pnpm tsc --noEmit
```

---

## Task 8: End-to-end smoke test

Manual test to verify the full pipeline works.

- [ ] **Step 1: Start the dev server**

```bash
pnpm dev
```

- [ ] **Step 2: Test the provisioning form**

Navigate to `https://localhost:5173` → Booking.com connection panel.
Fill in hotel name, currency, timezone. Click "Create Hotel & Connect".
Expected: IFrame opens showing the Channex OAuth popup for the new property.

- [ ] **Step 3: Test BDC preview endpoint directly**

After completing Channex OAuth in the IFrame (so the BDC channel is created), call:

```bash
curl "http://localhost:3001/channex/properties/{YOUR_CREATED_PROPERTY_ID}/bdc-preview?tenantId=YOUR_TENANT"
```

Expected response shape — **1 item** (not N items):
```json
[
  {
    "id": "YOUR_CREATED_PROPERTY_ID",
    "propertyName": "",
    "rooms": [
      { "id": "586818903", "roomName": "Double Room", "rates": [ ... ] },
      { "id": "586818904", "roomName": "Suite", "rates": [ ... ] }
    ]
  }
]
```

- [ ] **Step 4: Verify BDC naming modal renders correctly**

Back in the UI: click "Sync Rooms" → select BDC channel → modal opens.
Expected:
- Hotel header row (read-only, shows property name or "Hotel")
- One room row per BDC room (editable name, editable rates, optional Migo Room ID field)
- No "Property Name" input (BDC layout has no `propertyName` input)

- [ ] **Step 5: Complete sync and verify Firestore**

Fill in room names (and optionally Migo Room IDs) → click "Sync".

In Firestore console, check `channex_integrations/{tenantId}/properties/{createdPropertyId}`:
```
✓ channex_channel_id set
✓ channex_webhook_id set (or null if CHANNEX_WEBHOOK_CALLBACK_URL not configured)
✓ connection_status = "active"
✓ connected_channels = ["booking"]
✓ room_types[] has N entries (one per BDC room)
  ✓ each entry has: room_type_id, title, ota_room_id, source="booking"
  ✓ entries with Migo Room ID filled have migo_property_id set
  ✓ each entry has rate_plans[] with correct ota_rate_id
```

- [ ] **Step 6: Verify webhook routing (if CHANNEX_WEBHOOK_CALLBACK_URL is set)**

In Channex dashboard → Properties → confirm the BDC channel is still assigned to the base property (NOT to a per-room isolated property). Only one webhook should appear on the base property.

- [ ] **Step 7: Verify booking worker picks up room-level `migo_property_id`**

Trigger a test booking webhook for a specific room:
```bash
curl -X POST http://localhost:3001/channex/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "event": "booking_new",
    "property_id": "YOUR_CREATED_PROPERTY_ID",
    "payload": {
      "booking_id": "test-bdc-001",
      "booking_revision_id": "rev-001",
      "room_type_id": "CHANNEX_ROOM_TYPE_ID_OF_ROOM_2",
      "check_in": "2026-06-01",
      "check_out": "2026-06-03",
      "booking_status": "new"
    }
  }'
```

In server logs, find `[BOOKING-WORKER]`. Confirm:
- `migoPropertyId=` matches the `migo_property_id` for `CHANNEX_ROOM_TYPE_ID_OF_ROOM_2` (not room 1).
- If that room has no `migo_property_id`, confirm fallback to property-level (or `null`).

---

## Self-Review Notes

**Spec coverage:**
- §3 (StoredRoomType) → Task 1 ✓
- §4.2 (SyncNameOverride, ListingPreviewRoom) → Task 2 ✓
- §4.1 (BDC pipeline rewrite) → Task 3 ✓
- §4.4 (booking worker lookup) → Task 4 ✓
- §5.1 (frontend types) → Task 5 ✓
- §5.3 (SyncNamingModal) → Task 6 ✓
- §5.2 (BookingConnectionPanel) → Task 7 ✓
- Backward compatibility: old isolated property docs untouched; `resolveIntegration()` still finds them → verified: no code in these tasks deletes or modifies old docs.

**Type consistency check:**
- `BdcRoomResult` defined in Task 3 (backend) and Task 5 (frontend) — both shapes match.
- `BdcRoomFailure` step union is `'A' | 'B'` in both.
- `BdcSyncResult.channexPropertyId` added in Task 3 and Task 5 both.
- `SyncNamingModal` `channel` prop added in Task 6; `BookingConnectionPanel` passes `channel="booking"` in Task 7 — consistent.
- `migoPropertyId` field name is camelCase throughout (TypeScript/JSON convention) ✓; Firestore field name is `migo_property_id` (snake_case) ✓.

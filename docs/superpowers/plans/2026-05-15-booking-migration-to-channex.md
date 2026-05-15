# Booking.com Migration into /channex Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire `src/booking/` entirely and wire Booking.com through the same `/channex` flow already used for Airbnb — no more split modules.

**Architecture:** New `ChannexBdcSyncService` lives inside `ChannexModule` alongside `ChannexSyncService`. Two new endpoints added to the existing `ChannexPropertyController`. Frontend `BookingConnectionPanel` swaps three function calls; the IFrame session token requires zero backend changes.

**Tech Stack:** NestJS (backend), React + TypeScript (frontend), Firestore, Channex REST API v1.

---

## File Map

| Action | File |
|---|---|
| Modify | `apps/backend/src/channex/channex.service.ts` |
| Create | `apps/backend/src/channex/channex-bdc-sync.service.ts` |
| Modify | `apps/backend/src/channex/channex-property.controller.ts` |
| Modify | `apps/backend/src/channex/channex.module.ts` |
| Modify | `apps/backend/src/app.module.ts` |
| Delete | `apps/backend/src/booking/` (entire directory) |
| Modify | `apps/frontend/src/channex/api/channexHubApi.ts` |
| Modify | `apps/frontend/src/channex/components/connection/BookingConnectionPanel.tsx` |

---

## Task 1: Add `deleteChannel()` to `ChannexService`

**Files:**
- Modify: `apps/backend/src/channex/channex.service.ts`

`ChannexService` has `deleteProperty` but not `deleteChannel`. The BDC disconnect needs it.

- [ ] **Add method after `updateChannel` (around line 1043), before `updateAvailabilityRule`:**

```typescript
  /**
   * Deletes a channel (OTA connection) from Channex.
   * DELETE /api/v1/channels/{channelId}
   * Called by ChannexBdcSyncService.disconnectBdc() to release the BDC Extranet
   * calendar. This is irreversible on the Channex side.
   */
  async deleteChannel(channelId: string): Promise<void> {
    this.logger.log(`[CHANNEX] Deleting channel — channelId=${channelId}`);
    try {
      await this.defLogger.request<void>({
        method: 'DELETE',
        url: `${this.baseUrl}/channels/${channelId}`,
        headers: this.buildAuthHeaders(),
      });
      this.logger.log(`[CHANNEX] ✓ Channel deleted — channelId=${channelId}`);
    } catch (err) {
      this.normaliseError(err);
    }
  }
```

---

## Task 2: Create `channex-bdc-sync.service.ts`

**Files:**
- Create: `apps/backend/src/channex/channex-bdc-sync.service.ts`

This is the full BDC pipeline — equivalent to what `BookingPipelineService` did, now expressed as a proper `ChannexModule` service. It takes `propertyId` directly (no root-doc lookup), uses `ChannexService.getChannels(propertyId)` to scope the BDC channel discovery to the specific property, and writes to the same `channex_integrations/{tenantId}/properties/{propertyId}` structure as Airbnb.

- [ ] **Create the file with the following content:**

```typescript
import { FieldValue } from 'firebase-admin/firestore';
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { SecretManagerService } from '../common/secrets/secret-manager.service';
import { ChannexService } from './channex.service';
import { StoredRoomType, StoredRatePlan, mergeRoomTypes } from './channex-ari.service';
import { ChannexWebhookPayload } from './channex.types';

const COLLECTION = 'channex_integrations';
const BDC_EVENT_MASK =
  'booking_new;booking_modification;booking_cancellation;message_new;inquiry_new;booking_inquiry';

interface BdcMappingEntry {
  otaRoomId: string;
  otaRoomTitle: string;
  otaRateId: string;
  otaRateTitle: string;
  maxPersons: number;
  readonly: boolean;
  pricingType: string;
}

export interface BdcSyncResult {
  channexPropertyId: string;
  channexChannelId: string;
  webhookId: string | undefined;
  roomTypesCreated: number;
  ratePlansCreated: number;
  mappingsCreated: number;
}

@Injectable()
export class ChannexBdcSyncService {
  private readonly logger = new Logger(ChannexBdcSyncService.name);
  private readonly callbackUrl: string;

  constructor(
    private readonly channex: ChannexService,
    private readonly firebase: FirebaseService,
    private readonly secrets: SecretManagerService,
  ) {
    this.callbackUrl =
      `${process.env.NGROK_URL ?? 'http://localhost:3001'}/webhook`;
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  async syncBdc(propertyId: string, tenantId: string): Promise<BdcSyncResult> {
    this.logger.log(`[BDC_SYNC] ▶ Starting — propertyId=${propertyId} tenantId=${tenantId}`);

    // Step 4a: Discover BDC channel scoped to this property
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
    this.logger.log(`[BDC_SYNC] Step 4a ✓ — channelId=${channexChannelId}`);

    // Step 4a (cont): Fetch mapping_details
    const channelDetails = await this.channex.getChannelDetails(channexChannelId);
    const raw = await this.channex.getMappingDetails(
      channelDetails.channel,
      channelDetails.settings,
    );
    const entries = this.parseMappingDetails(raw);
    this.logger.log(`[BDC_SYNC] mapping_details ✓ — entries=${entries.length}`);

    if (entries.length === 0) {
      throw new HttpException(
        'mapping_details returned no rooms. Ensure the Booking.com Hotel ID was entered in the IFrame popup.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // Steps 4b / 4c: Create Room Types + Rate Plans (idempotent by title prefix BDC:)
    const { roomTypeMap, ratePlanMap, roomTypesCreated, ratePlansCreated } =
      await this.createRoomsAndRates(propertyId, entries);
    this.logger.log(
      `[BDC_SYNC] Steps 4b/4c ✓ — rooms=${roomTypesCreated} rates=${ratePlansCreated}`,
    );

    // Step 5: Apply mappings via single atomic PUT on the channel
    const mappingsCreated = await this.applyMappings(
      channexChannelId,
      entries,
      roomTypeMap,
      ratePlanMap,
      channelDetails.settings,
    );
    this.logger.log(`[BDC_SYNC] Step 5 ✓ — mappings=${mappingsCreated}`);

    // Step 6: Activate channel (action endpoint with fallback to PUT is_active)
    try {
      await this.channex.activateChannelAction(channexChannelId);
    } catch {
      this.logger.warn('[BDC_SYNC] activateChannelAction failed — falling back to PUT is_active');
      await this.channex.activateChannel(channexChannelId);
    }
    this.logger.log(`[BDC_SYNC] Step 6 ✓ — channel activated`);

    // Step 7: Register webhook (idempotent by callback_url)
    const webhookId = await this.registerWebhook(propertyId);
    this.logger.log(`[BDC_SYNC] Step 7 ✓ — webhookId=${webhookId ?? 'already_existed'}`);

    // Step 8: Install Messages App (idempotent — 422 treated as already-installed)
    await this.channex.installApplication(
      propertyId,
      ChannexService.APP_IDS.channex_messages,
    );
    this.logger.log(`[BDC_SYNC] Step 8 ✓ — Messages App installed`);

    // Persist room types and status to Firestore
    await this.persistToFirestore(
      propertyId,
      tenantId,
      channexChannelId,
      entries,
      roomTypeMap,
      ratePlanMap,
      webhookId,
    );

    this.logger.log(`[BDC_SYNC] ✓ Pipeline complete — tenantId=${tenantId}`);

    return {
      channexPropertyId: propertyId,
      channexChannelId,
      webhookId,
      roomTypesCreated,
      ratePlansCreated,
      mappingsCreated,
    };
  }

  async disconnectBdc(propertyId: string, tenantId: string): Promise<void> {
    this.logger.log(
      `[BDC_DISCONNECT] Starting — propertyId=${propertyId} tenantId=${tenantId}`,
    );

    const db = this.firebase.getFirestore();
    const propertyRef = db
      .collection(COLLECTION)
      .doc(tenantId)
      .collection('properties')
      .doc(propertyId);

    const snap = await propertyRef.get();
    if (!snap.exists) {
      throw new HttpException(
        `No BDC integration found for propertyId=${propertyId}`,
        HttpStatus.NOT_FOUND,
      );
    }

    const channexChannelId: string = snap.data()?.channex_channel_id ?? '';
    if (channexChannelId) {
      await this.channex.deleteChannel(channexChannelId);
      this.logger.log(
        `[BDC_DISCONNECT] ✓ Channel deleted — channelId=${channexChannelId}`,
      );
    }

    await this.firebase.update(propertyRef, {
      channex_channel_id: null,
      connection_status: 'pending',
      connected_channels: FieldValue.arrayRemove('booking'),
      updated_at: new Date().toISOString(),
    });

    this.logger.log(`[BDC_DISCONNECT] ✓ Firestore updated — propertyId=${propertyId}`);
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private parseMappingDetails(raw: Record<string, unknown>): BdcMappingEntry[] {
    const rooms = (raw as any)?.data?.rooms;

    if (!Array.isArray(rooms)) {
      throw new HttpException(
        `mapping_details returned an unrecognised shape — expected data.rooms[]. Raw: ${JSON.stringify(raw, null, 2)}`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const entries: BdcMappingEntry[] = [];

    for (const room of rooms) {
      if (!room?.id) continue;
      const otaRoomId = String(room.id);
      const otaRoomTitle = String(room.title ?? `Room ${otaRoomId}`);
      const rates: any[] = Array.isArray(room.rates) ? room.rates : [];

      if (rates.length === 0) {
        this.logger.warn(`[BDC_SYNC] Room "${otaRoomTitle}" has no rates — skipping`);
        continue;
      }

      for (const rate of rates) {
        if (!rate?.id) continue;
        entries.push({
          otaRoomId,
          otaRoomTitle,
          otaRateId: String(rate.id),
          otaRateTitle: String(rate.title ?? `Rate ${rate.id}`),
          maxPersons: typeof rate.max_persons === 'number' ? rate.max_persons : 2,
          readonly: Boolean(rate.readonly ?? false),
          pricingType: String(rate.pricing ?? 'Standard'),
        });
      }
    }

    return entries;
  }

  private async createRoomsAndRates(
    propertyId: string,
    entries: BdcMappingEntry[],
  ): Promise<{
    roomTypeMap: Map<string, string>;
    ratePlanMap: Map<string, string>;
    roomTypesCreated: number;
    ratePlansCreated: number;
  }> {
    const existingRoomTypes = await this.channex.getRoomTypes(propertyId);
    const existingRatePlans = await this.channex.getRatePlans(propertyId);

    const roomTitleToId = new Map<string, string>(
      existingRoomTypes.map((rt) => [rt.attributes.title as string, rt.id]),
    );
    const rateTitleToId = new Map<string, string>(
      existingRatePlans.map((rp) => [rp.attributes.title as string, rp.id]),
    );

    const roomTypeMap = new Map<string, string>();
    const ratePlanMap = new Map<string, string>();
    let roomTypesCreated = 0;
    let ratePlansCreated = 0;

    for (const entry of entries) {
      if (!roomTypeMap.has(entry.otaRoomId)) {
        const roomTitle = `BDC: ${entry.otaRoomTitle}`;
        let channexRoomTypeId = roomTitleToId.get(roomTitle);

        if (!channexRoomTypeId) {
          const created = await this.channex.createRoomType({
            property_id: propertyId,
            title: roomTitle,
            count_of_rooms: 1,
            occ_adults: entry.maxPersons,
            occ_children: 0,
            occ_infants: 0,
            default_occupancy: entry.maxPersons,
          });
          channexRoomTypeId = created.data.id;
          roomTitleToId.set(roomTitle, channexRoomTypeId);
          roomTypesCreated++;
          this.logger.log(`[BDC_SYNC] ✓ Room type created — "${roomTitle}" id=${channexRoomTypeId}`);
        } else {
          this.logger.log(`[BDC_SYNC] Reusing room type — "${roomTitle}" id=${channexRoomTypeId}`);
        }

        roomTypeMap.set(entry.otaRoomId, channexRoomTypeId);
      }

      const rateKey = `${entry.otaRoomId}_${entry.otaRateId}`;
      if (!ratePlanMap.has(rateKey)) {
        const channexRoomTypeId = roomTypeMap.get(entry.otaRoomId)!;
        const rateTitle = `BDC: ${entry.otaRoomTitle} — ${entry.otaRateTitle}`;
        let channexRatePlanId = rateTitleToId.get(rateTitle);

        if (!channexRatePlanId) {
          const created = await this.channex.createRatePlan({
            property_id: propertyId,
            room_type_id: channexRoomTypeId,
            title: rateTitle,
            options: [{ occupancy: entry.maxPersons, is_primary: true, rate: 0 }],
          });
          channexRatePlanId = created.data.id;
          rateTitleToId.set(rateTitle, channexRatePlanId);
          ratePlansCreated++;
          this.logger.log(`[BDC_SYNC] ✓ Rate plan created — "${rateTitle}" id=${channexRatePlanId}`);
        } else {
          this.logger.log(`[BDC_SYNC] Reusing rate plan — "${rateTitle}" id=${channexRatePlanId}`);
        }

        ratePlanMap.set(rateKey, channexRatePlanId);
      }
    }

    return { roomTypeMap, ratePlanMap, roomTypesCreated, ratePlansCreated };
  }

  private async applyMappings(
    channelId: string,
    entries: BdcMappingEntry[],
    roomTypeMap: Map<string, string>,
    ratePlanMap: Map<string, string>,
    existingSettings: Record<string, unknown>,
  ): Promise<number> {
    const rooms: Record<string, string> = {};
    for (const [otaRoomId, channexRoomTypeId] of roomTypeMap) {
      rooms[otaRoomId] = channexRoomTypeId;
    }

    const ratePlans: Array<Record<string, unknown>> = [];
    for (const entry of entries) {
      const rateKey = `${entry.otaRoomId}_${entry.otaRateId}`;
      const channexRatePlanId = ratePlanMap.get(rateKey);
      if (!channexRatePlanId) continue;

      ratePlans.push({
        rate_plan_id: channexRatePlanId,
        settings: {
          room_type_code: Number(entry.otaRoomId),
          rate_plan_code: Number(entry.otaRateId),
          occupancy: entry.maxPersons,
          readonly: entry.readonly,
          primary_occ: true,
          occ_changed: false,
          pricing_type: entry.pricingType,
        },
      });
    }

    await this.channex.updateChannel(channelId, {
      settings: { ...existingSettings, mappingSettings: { rooms } },
      rate_plans: ratePlans,
    });

    return ratePlans.length;
  }

  private async registerWebhook(propertyId: string): Promise<string | undefined> {
    const existing = await this.channex.listPropertyWebhooks(propertyId);
    const found = (
      existing as Array<{ id: string; attributes: { callback_url: string } }>
    ).find((wh) => wh.attributes?.callback_url === this.callbackUrl);

    if (found) return found.id;

    const hmacSecret = this.secrets.get('CHANNEX_WEBHOOK_SECRET') ?? '';
    const payload: ChannexWebhookPayload = {
      property_id: propertyId,
      callback_url: this.callbackUrl,
      event_mask: BDC_EVENT_MASK,
      send_data: true,
      is_active: true,
      headers: { 'x-channex-signature': hmacSecret },
    };

    const result = await this.channex.createWebhookSubscription(payload);
    return result.webhookId;
  }

  private async persistToFirestore(
    propertyId: string,
    tenantId: string,
    channexChannelId: string,
    entries: BdcMappingEntry[],
    roomTypeMap: Map<string, string>,
    ratePlanMap: Map<string, string>,
    webhookId: string | undefined,
  ): Promise<void> {
    const roomTypeByOtaId = new Map<string, StoredRoomType>();

    for (const entry of entries) {
      const channexRoomTypeId = roomTypeMap.get(entry.otaRoomId)!;

      if (!roomTypeByOtaId.has(entry.otaRoomId)) {
        roomTypeByOtaId.set(entry.otaRoomId, {
          room_type_id: channexRoomTypeId,
          title: `BDC: ${entry.otaRoomTitle}`,
          default_occupancy: entry.maxPersons,
          occ_adults: entry.maxPersons,
          occ_children: 0,
          occ_infants: 0,
          count_of_rooms: 1,
          source: 'booking',
          ota_room_id: entry.otaRoomId,
          rate_plans: [],
        } as StoredRoomType);
      }

      const rateKey = `${entry.otaRoomId}_${entry.otaRateId}`;
      const channexRatePlanId = ratePlanMap.get(rateKey);
      if (channexRatePlanId) {
        roomTypeByOtaId.get(entry.otaRoomId)!.rate_plans.push({
          rate_plan_id: channexRatePlanId,
          title: `BDC: ${entry.otaRoomTitle} — ${entry.otaRateTitle}`,
          currency: 'USD',
          rate: 0,
          occupancy: entry.maxPersons,
          is_primary: true,
          ota_rate_id: entry.otaRateId,
        } as StoredRatePlan);
      }
    }

    const incomingRoomTypes = Array.from(roomTypeByOtaId.values());
    const db = this.firebase.getFirestore();
    const propertyRef = db
      .collection(COLLECTION)
      .doc(tenantId)
      .collection('properties')
      .doc(propertyId);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(propertyRef);
      const existing: StoredRoomType[] = (snap.data()?.room_types ?? []) as StoredRoomType[];
      const merged = mergeRoomTypes(existing, incomingRoomTypes, 'booking');

      tx.update(propertyRef, {
        connection_status: 'active',
        channel_name: 'BookingCom',
        channex_channel_id: channexChannelId,
        channex_property_id: propertyId,
        channex_webhook_id: webhookId ?? null,
        room_types: merged,
        connected_channels: FieldValue.arrayUnion('booking'),
        pipeline_completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    });
  }
}
```

---

## Task 3: Wire service into module + add controller endpoints

**Files:**
- Modify: `apps/backend/src/channex/channex.module.ts`
- Modify: `apps/backend/src/channex/channex-property.controller.ts`

### 3a — Register in `ChannexModule`

- [ ] **Add import and provider to `channex.module.ts`:**

Add at the top of the file:
```typescript
import { ChannexBdcSyncService } from './channex-bdc-sync.service';
```

Add `ChannexBdcSyncService` to the `providers` array (after `ChannexSyncService`):
```typescript
ChannexSyncService,
ChannexBdcSyncService,
```

### 3b — Add endpoints to `ChannexPropertyController`

- [ ] **Add import at the top of `channex-property.controller.ts`:**

```typescript
import { ChannexBdcSyncService, BdcSyncResult } from './channex-bdc-sync.service';
```

- [ ] **Add `ChannexBdcSyncService` to the constructor** (after `private readonly channexService: ChannexService`):

```typescript
  constructor(
    private readonly propertyService: ChannexPropertyService,
    private readonly oauthService: ChannexOAuthService,
    private readonly syncService: ChannexSyncService,
    private readonly channexService: ChannexService,
    private readonly bdcSyncService: ChannexBdcSyncService,
  ) {}
```

- [ ] **Add the two new endpoint methods** before the closing `}` of the class (after the `softDelete` method):

```typescript
  /**
   * POST /channex/properties/:propertyId/sync-bdc
   *
   * Executes the full Booking.com connection pipeline after the user has
   * completed the Channex IFrame popup (channel=BDC).
   *
   * Sequence: discover BDC channel → mapping_details → room types / rate plans
   * → channel mappings → activate → register webhook → install Messages App
   * → persist to Firestore.
   *
   * Body:    { tenantId: string }
   * Returns: BdcSyncResult
   * Status:  201 Created
   */
  @Post(':propertyId/sync-bdc')
  @HttpCode(HttpStatus.CREATED)
  async syncBdc(
    @Param('propertyId') propertyId: string,
    @Body('tenantId') tenantId: string,
  ): Promise<BdcSyncResult> {
    this.logger.log(
      `[CTRL] POST /channex/properties/${propertyId}/sync-bdc — tenantId=${tenantId}`,
    );

    const result = await this.bdcSyncService.syncBdc(propertyId, tenantId);

    this.logger.log(
      `[CTRL] ✓ BDC sync complete — rooms=${result.roomTypesCreated} rates=${result.ratePlansCreated}`,
    );

    return result;
  }

  /**
   * POST /channex/properties/:propertyId/disconnect-bdc
   *
   * Deletes the Booking.com channel in Channex and clears the BDC state
   * in Firestore. The Channex property itself is NOT deleted — only the
   * channel connection is removed.
   *
   * Body:    { tenantId: string }
   * Status:  204 No Content
   */
  @Post(':propertyId/disconnect-bdc')
  @HttpCode(HttpStatus.NO_CONTENT)
  async disconnectBdc(
    @Param('propertyId') propertyId: string,
    @Body('tenantId') tenantId: string,
  ): Promise<void> {
    this.logger.log(
      `[CTRL] POST /channex/properties/${propertyId}/disconnect-bdc — tenantId=${tenantId}`,
    );

    await this.bdcSyncService.disconnectBdc(propertyId, tenantId);

    this.logger.log(
      `[CTRL] ✓ BDC disconnected — propertyId=${propertyId}`,
    );
  }
```

---

## Task 4: Remove `BookingModule` from `app.module.ts`

**Files:**
- Modify: `apps/backend/src/app.module.ts`

- [ ] **Remove the import line:**

```typescript
import { BookingModule } from './booking/booking.module';
```

- [ ] **Remove `BookingModule` from the `imports` array** (and the comment above it):

```typescript
    // Channex.io × Booking.com — XML channel connection
    BookingModule,
```

---

## Task 5: Update frontend API — `channexHubApi.ts`

**Files:**
- Modify: `apps/frontend/src/channex/api/channexHubApi.ts`

### 5a — Add `BdcSyncResult` type and two new functions

- [ ] **Add after the `IsolatedSyncResult` interface (around line 422):**

```typescript
export interface BdcSyncResult {
  channexPropertyId: string;
  channexChannelId: string;
  webhookId: string | undefined;
  roomTypesCreated: number;
  ratePlansCreated: number;
  mappingsCreated: number;
}

export async function syncBdcListings(
  propertyId: string,
  tenantId: string,
): Promise<BdcSyncResult> {
  return apiFetch(
    `${BASE}/properties/${encodeURIComponent(propertyId)}/sync-bdc`,
    { method: 'POST', body: JSON.stringify({ tenantId }) },
  );
}

export async function disconnectBdcChannel(
  propertyId: string,
  tenantId: string,
): Promise<void> {
  return apiFetch(
    `${BASE}/properties/${encodeURIComponent(propertyId)}/disconnect-bdc`,
    { method: 'POST', body: JSON.stringify({ tenantId }) },
  );
}
```

### 5b — Remove the three legacy `/api/booking/*` functions

- [ ] **Delete the entire "OTA — Booking.com" section** (the three functions at the bottom of the file):

```typescript
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

---

## Task 6: Update `BookingConnectionPanel.tsx`

**Files:**
- Modify: `apps/frontend/src/channex/components/connection/BookingConnectionPanel.tsx`

Three targeted changes: token function, sync handler, disconnect handler. No UI changes.

### 6a — Fix imports

- [ ] **Replace the import block** that pulls from `channexHubApi`:

Old:
```typescript
import {
  getBookingSessionToken,
  syncBookingListings,
  disconnectBookingChannel,
} from '../../api/channexHubApi';
```

New:
```typescript
import {
  getAirbnbSessionToken,
  syncBdcListings,
  disconnectBdcChannel,
  type BdcSyncResult,
} from '../../api/channexHubApi';
```

### 6b — Update state type

- [ ] **Replace the `synced` boolean state** with a `syncResult` state that holds the BDC result for displaying counts:

Old:
```typescript
  const [synced, setSynced] = useState(false);
```

New:
```typescript
  const [syncResult, setSyncResult] = useState<BdcSyncResult | null>(null);
```

### 6c — Update `handleSync`

- [ ] **Replace `handleSync`:**

Old:
```typescript
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
```

New:
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

### 6d — Update `handleDisconnect`

- [ ] **Replace `handleDisconnect`:**

Old:
```typescript
  const handleDisconnect = useCallback(async () => {
    if (!window.confirm('Disconnect Booking.com? This will remove the channel from Channex.')) return;
    setDisconnecting(true);
    setError(null);
    setSynced(false);
    try {
      await disconnectBookingChannel(tenantId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Disconnect failed.');
    } finally {
      setDisconnecting(false);
    }
  }, [tenantId]);
```

New:
```typescript
  const handleDisconnect = useCallback(async () => {
    if (!baseProperty) return;
    if (!window.confirm('Disconnect Booking.com? This will remove the channel from Channex.')) return;
    setDisconnecting(true);
    setError(null);
    setSyncResult(null);
    try {
      await disconnectBdcChannel(baseProperty.channex_property_id, tenantId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Disconnect failed.');
    } finally {
      setDisconnecting(false);
    }
  }, [baseProperty, tenantId]);
```

### 6e — Update `handleReconnect`

- [ ] **Replace the `setSynced(false)` call in `handleReconnect`:**

Old:
```typescript
  const handleReconnect = useCallback(() => {
    setError(null);
    setSynced(false);
    setIframeReloadToken((t) => t + 1);
  }, []);
```

New:
```typescript
  const handleReconnect = useCallback(() => {
    setError(null);
    setSyncResult(null);
    setIframeReloadToken((t) => t + 1);
  }, []);
```

### 6f — Fix the IFrame `getToken` prop

- [ ] **Replace the `getToken` prop on `ChannexOAuthIFrame`:**

Old:
```typescript
                  getToken={(_propertyId) => getBookingSessionToken(tenantId).then((r) => r.token)}
```

New:
```typescript
                  getToken={getAirbnbSessionToken}
```

### 6g — Fix the success message in the JSX

- [ ] **Replace the `synced &&` block:**

Old:
```typescript
                {synced && (
                  <div className="mt-3 rounded-xl border border-ok-text/20 bg-ok-bg px-4 py-3 text-sm font-medium text-ok-text">
                    Sync complete — rooms and rates imported from Booking.com.
                  </div>
                )}
```

New:
```typescript
                {syncResult && (
                  <div className="mt-3 rounded-xl border border-ok-text/20 bg-ok-bg px-4 py-3 text-sm font-medium text-ok-text">
                    Sync complete — {syncResult.roomTypesCreated} room type(s) and {syncResult.ratePlansCreated} rate plan(s) imported from Booking.com.
                  </div>
                )}
```

---

## Task 7: Delete `src/booking/` directory

**Files:**
- Delete: `apps/backend/src/booking/` (entire directory — 8 files)

- [ ] **Delete the directory:**

```bash
Remove-Item -Recurse -Force apps/backend/src/booking
```

Verify it's gone:
```bash
Test-Path apps/backend/src/booking
# Expected: False
```

---

## Self-review

**Spec coverage:**
- ✓ `deleteChannel()` in `ChannexService` — Task 1
- ✓ `ChannexBdcSyncService` with full pipeline — Task 2
- ✓ `POST /channex/properties/:id/sync-bdc` — Task 3
- ✓ `POST /channex/properties/:id/disconnect-bdc` — Task 3
- ✓ `ChannexBdcSyncService` registered in `ChannexModule` — Task 3
- ✓ `BookingModule` removed from `app.module.ts` — Task 4
- ✓ `syncBdcListings` + `disconnectBdcChannel` added to `channexHubApi.ts` — Task 5
- ✓ Legacy `/api/booking/*` functions removed — Task 5
- ✓ `BookingConnectionPanel` wired to new functions — Task 6
- ✓ IFrame `getToken` simplified — Task 6
- ✓ `src/booking/` deleted — Task 7

**Type consistency:**
- `BdcSyncResult` defined in Task 2, imported in Task 3 controller, exported in Task 5 frontend — consistent
- `ChannexBdcSyncService` created in Task 2, registered in Task 3, referenced in Task 3 controller — consistent
- `deleteChannel` added in Task 1, called in Task 2 — correct ordering
- `syncBdcListings` / `disconnectBdcChannel` added in Task 5, imported in Task 6 — consistent

# Channex Unified Data Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the Firestore data model for all Channex integrations (Airbnb and Booking.com) so that every tenant has one root integration document, all properties live in a `properties` subcollection under it, and `room_types` (with rate plans) are stored on the property subdoc — while consolidating the two competing group-resolution code paths into one.

**Architecture:** Root doc `channex_integrations/{tenantId}` holds group identity; property docs live at `channex_integrations/{tenantId}/properties/{channexPropertyId}` and carry all per-property state including `room_types[]`. The `ChannexGroupService` becomes the single group-resolution path for both Airbnb and Booking.com flows. Booking workers (`channex-booking.worker.ts`, `channex-message.worker.ts`) already write to `{integrationDocId}/properties/{propId}` subcollections — after this refactor `integrationDocId = tenantId`, so their path construction is unchanged. The `resolveIntegration` method is updated to query the `properties` subcollection via `collectionGroup` and returns `firestoreDocId = tenantId`.

**Tech Stack:** NestJS, Firestore (firebase-admin), React + firebase/firestore (frontend). No new packages. No test runner — verification via `pnpm build`.

---

## Firestore Target Schema

```
channex_integrations/{tenantId}                    ← ROOT integration doc (key = tenantId)
  tenant_id: string
  channex_group_id: string
  channex_property_id: string   (mirror of primary property for pipeline quick-read)
  channex_channel_id: string|null  (mirror for webhook routing)
  created_at: string
  updated_at: string

  /properties/{channexPropertyId}                  ← SUBCOLLECTION — one doc per property
    channex_property_id: string
    tenant_id: string                               ← included for collectionGroup lookups
    migo_property_id: string
    channex_group_id: string
    channex_channel_id: string|null
    channex_webhook_id: string|null
    connection_status: string
    oauth_refresh_required: boolean
    last_sync_timestamp: string|null
    title, currency, timezone, property_type: string
    connected_channels: string[]
    room_types: StoredRoomType[]    ← same shape as before, moved here from root doc
    created_at: string
    updated_at: string

    /bookings/{ota_reservation_code}               ← workers already write here (unchanged)
    /threads/{message_thread_id}                   ← workers already write here (unchanged)
```

---

## File Map

### Backend — modified files
| File | Change |
|------|--------|
| `apps/backend/src/booking/booking.service.ts` | Remove `resolveGroupId`; inject `ChannexGroupService`; update all Firestore paths to new structure |
| `apps/backend/src/channex/channex-property.service.ts` | `provisionProperty` writes root doc + property subcol doc; `resolveIntegration` uses `collectionGroup('properties')` |
| `apps/backend/src/channex/channex-ari.service.ts` | Read/write `room_types` from property subcol doc, not root doc |
| `apps/backend/src/channex/channex-sync.service.ts` | `saveStageToFirestore`, `finalizeFirestoreDocument`, `updateFirestoreDocument`, `persistIsolatedSyncResults` all target property subcol doc |
| `apps/backend/src/booking/booking-pipeline.service.ts` | Write `room_types` to property subcol doc; keep root doc preflight read intact (mirrors stay) |

### Frontend — modified files
| File | Change |
|------|--------|
| `apps/frontend/src/channex/hooks/useChannexProperties.ts` | Subscribe to `channex_integrations/{tenantId}/properties` subcollection instead of flat query |

---

## Task 1 — Unify Group Resolution in BookingService

**Files:**
- Modify: `apps/backend/src/booking/booking.service.ts`

Context: `booking.service.ts` currently has a private `resolveGroupId` that creates Channex groups with title `"Tenant: ${tenantId}"` and caches to `channex_integrations/{tenantId}.channex_group_id`. Our new `ChannexGroupService` does the same thing but with title `tenantId` (no prefix) and caches to `channex_groups/{tenantId}`. The two paths can create duplicate groups in Channex. `ChannexModule` is already imported in `BookingModule`, and `ChannexGroupService` is already exported from `ChannexModule` — so injection is wiring-only.

- [ ] **Step 1.1: Add `ChannexGroupService` to the constructor and remove `resolveGroupId`**

Read `apps/backend/src/booking/booking.service.ts` lines 1–110 first.

Replace the import block top to add the import:
```typescript
import { ChannexGroupService } from '../channex/channex-group.service';
```

Replace the constructor:
```typescript
  constructor(
    private readonly defLogger: DefensiveLoggerService,
    private readonly secrets: SecretManagerService,
    private readonly firebase: FirebaseService,
    private readonly groupService: ChannexGroupService,
  ) {
    this.baseUrl =
      process.env.CHANNEX_BASE_URL ?? 'https://staging.channex.io/api/v1';
  }
```

Delete the entire `resolveGroupId` private method (lines ~66–110 in the original file).

- [ ] **Step 1.2: Replace `resolveGroupId` call in `getSessionToken`**

In `getSessionToken` (around line 124), change:
```typescript
    const channexGroupId = await this.resolveGroupId(tenantId);
```
to:
```typescript
    const channexGroupId = await this.groupService.ensureGroup(tenantId);
```

- [ ] **Step 1.3: Replace group_id read in `syncBooking`**

In `syncBooking` (around line 207–218), the method currently reads `channex_group_id` from `channex_integrations/{tenantId}` doc. Replace that block:
```typescript
    // OLD — reads from root doc
    const airbnbDoc = await db.collection(CHANNEX_INTEGRATIONS).doc(tenantId).get();
    const channexGroupId: string = airbnbDoc.data()?.channex_group_id ?? '';
    if (!channexGroupId) {
      throw new HttpException( ... );
    }
```
with:
```typescript
    const channexGroupId = await this.groupService.ensureGroup(tenantId);
```

- [ ] **Step 1.4: Verify backend compiles**

```powershell
cd apps/backend && pnpm build 2>&1 | Select-String "error TS|error:" | Select-Object -First 20
```

Expected: no errors.

- [ ] **Step 1.5: Commit**

```bash
git add apps/backend/src/booking/booking.service.ts
git commit -m "refactor(booking): replace custom resolveGroupId with ChannexGroupService.ensureGroup"
```

---

## Task 2 — Migrate `ChannexPropertyService` to Subcollection Structure

**Files:**
- Modify: `apps/backend/src/channex/channex-property.service.ts`

Context: `provisionProperty` currently writes one flat root doc at `channex_integrations/{tenantId}__{channexPropertyId}`. After this task it writes a root integration doc at `channex_integrations/{tenantId}` (merge, so it's idempotent) and a property subcol doc at `channex_integrations/{tenantId}/properties/{channexPropertyId}`. `resolveIntegration` currently queries the root collection by `channex_property_id`; after this task it uses `collectionGroup('properties')`. The returned `firestoreDocId` will now be `tenantId` (the root integration doc ID), which is exactly what the booking and message workers need.

- [ ] **Step 2.1: Update `provisionProperty` — dual write (root doc + property subcol)**

Read `apps/backend/src/channex/channex-property.service.ts` lines 85–160 first.

Replace the entire Firestore write section (the `// ── Step 2: Persist dual-ID mapping` block) with:

```typescript
    // ── Step 2: Persist to Firestore ───────────────────────���─────────────────

    const db = this.firebase.getFirestore();

    // Root integration doc — one per tenant, keyed by tenantId
    const rootRef = db.collection(COLLECTION).doc(dto.tenantId);
    await this.firebase.set(rootRef, {
      tenant_id: dto.tenantId,
      channex_group_id: groupId,
      channex_property_id: channexPropertyId,  // mirror for pipeline quick-read
      channex_channel_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { merge: true });

    // Property subcol doc — one per Channex property
    const propertyRef = rootRef.collection('properties').doc(channexPropertyId);
    await this.firebase.set(propertyRef, {
      channex_property_id: channexPropertyId,
      tenant_id: dto.tenantId,
      migo_property_id: dto.migoPropertyId,
      channex_group_id: groupId,
      channex_channel_id: null,
      channex_webhook_id: null,
      connection_status: ChannexConnectionStatus.Pending,
      oauth_refresh_required: false,
      last_sync_timestamp: null,
      title: dto.title,
      currency: dto.currency,
      timezone: dto.timezone,
      property_type: dto.propertyType ?? 'apartment',
      room_types: [],
      connected_channels: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    this.logger.log(
      `[PROVISION] ✓ Firestore written — tenantId=${dto.tenantId} propertyId=${channexPropertyId}`,
    );

    return { channexPropertyId, firestoreDocId: dto.tenantId };
```

Note: `firestoreDocId` now returns `tenantId` (the root doc ID, not the composite key).

- [ ] **Step 2.2: Update `resolveIntegration` — use `collectionGroup('properties')`**

Replace the entire `resolveIntegration` method body:

```typescript
  async resolveIntegration(
    channexPropertyId: string,
  ): Promise<{ tenantId: string; firestoreDocId: string } | null> {
    const db = this.firebase.getFirestore();

    // Query properties subcollection across all integration docs.
    // Each property doc stores tenant_id for direct resolution.
    const snap = await db
      .collectionGroup('properties')
      .where('channex_property_id', '==', channexPropertyId)
      .limit(1)
      .get();

    if (snap.empty) return null;

    const propertyDoc = snap.docs[0];
    const tenantId = propertyDoc.data().tenant_id as string;

    if (!tenantId) {
      throw new NotFoundException(
        `Property ${channexPropertyId} found but tenant_id is missing.`,
      );
    }

    // firestoreDocId = tenantId = root integration doc ID.
    // Booking/message workers build paths as:
    //   channex_integrations/{firestoreDocId}/properties/{channexPropertyId}
    // which resolves correctly.
    return { tenantId, firestoreDocId: tenantId };
  }
```

- [ ] **Step 2.3: Update `updateConnectionStatus` — write to property subcol doc**

`updateConnectionStatus` currently writes to `db.collection(COLLECTION).doc(integration.firestoreDocId)`.
After this task `integration.firestoreDocId = tenantId`, so that ref is the ROOT doc, not the property doc.
Connection status lives on the property doc. Update the docRef inside `updateConnectionStatus`:

```typescript
    const db = this.firebase.getFirestore();
    // Property subcol doc holds connection_status
    const docRef = db
      .collection(COLLECTION)
      .doc(integration.firestoreDocId)   // = tenantId
      .collection('properties')
      .doc(channexPropertyId);           // param passed to this method
```

The `updateConnectionStatus` signature is `(channexPropertyId, status)` — `channexPropertyId` is already available as the first parameter, so this change is self-contained.

- [ ] **Step 2.4: Update `getConnectionStatus` / `findDocByChannexPropertyId`**

`findDocByChannexPropertyId` currently reads the ROOT doc after resolving; after this task it must read the PROPERTY subdoc:

```typescript
  private async findDocByChannexPropertyId(
    channexPropertyId: string,
  ): Promise<Record<string, unknown>> {
    const integration = await this.resolveIntegration(channexPropertyId);
    if (!integration) {
      throw new NotFoundException(
        `No integration found for Channex property ID: ${channexPropertyId}`,
      );
    }

    const db = this.firebase.getFirestore();
    const doc = await db
      .collection(COLLECTION)
      .doc(integration.firestoreDocId)
      .collection('properties')
      .doc(channexPropertyId)
      .get();

    if (!doc.exists) {
      throw new NotFoundException(
        `No property doc found for Channex property ID: ${channexPropertyId}`,
      );
    }

    return doc.data() as Record<string, unknown>;
  }
```

- [ ] **Step 2.5: Verify backend compiles**

```powershell
cd apps/backend && pnpm build 2>&1 | Select-String "error TS|error:" | Select-Object -First 20
```

Expected: no errors.

- [ ] **Step 2.6: Commit**

```bash
git add apps/backend/src/channex/channex-property.service.ts
git commit -m "refactor(channex): migrate provisionProperty to subcollection structure + update resolveIntegration"
```

---

## Task 3 — Migrate BookingService Firestore Paths

**Files:**
- Modify: `apps/backend/src/booking/booking.service.ts`

Context: after Task 1, group creation is unified. Now the Firestore writes in `getSessionToken`, `syncBooking`, `saveMapping`, and `handleChannexWebhook` need to target the new structure. The root doc `channex_integrations/{tenantId}` holds mirrors (`channex_property_id`, `channex_channel_id`) for fast lookups; the property subcol doc holds the authoritative state.

- [ ] **Step 3.1: Update `getSessionToken` — write root doc + property subcol doc**

Read `apps/backend/src/booking/booking.service.ts` lines 124–200 first.

Replace the Firestore write block inside `getSessionToken` (both the `bookingDoc.exists` branch and the `else` branch) with:

```typescript
    // Root integration doc — idempotent merge
    const db = this.firebase.getFirestore();
    const rootRef = db.collection(CHANNEX_INTEGRATIONS).doc(tenantId);
    await this.firebase.set(rootRef, {
      tenant_id: tenantId,
      channex_group_id: channexGroupId,
      channex_property_id: channexPropertyId,   // mirror for pipeline quick-read
      channex_channel_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { merge: true });

    // Property subcol doc
    const propertyRef = rootRef.collection('properties').doc(channexPropertyId);
    await this.firebase.set(propertyRef, {
      channex_property_id: channexPropertyId,
      tenant_id: tenantId,
      channex_group_id: channexGroupId,
      channex_channel_id: null,
      connection_status: 'pending',
      room_types: [],
      connected_channels: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { merge: true });
```

Remove the old `if (bookingDoc.exists) { update } else { set }` pattern.

- [ ] **Step 3.2: Update `syncBooking` — write to property subcol doc**

Replace the two Firestore `update` calls inside `syncBooking` (the BDC shortpath at ~line 254–268 and the full path at ~line 304–316):

BDC shortpath (when `channelCode === 'BookingCom'`):
```typescript
      const db = this.firebase.getFirestore();
      const propertyRef = db
        .collection(CHANNEX_INTEGRATIONS)
        .doc(tenantId)
        .collection('properties')
        .doc(channexPropertyId);

      await this.firebase.update(propertyRef, {
        channex_channel_id: channexChannelId,
        channex_property_id: channexPropertyId,
        connection_status: 'channel_ready',
        updated_at: new Date().toISOString(),
      });

      // Mirror channel_id on root doc for webhook routing
      await this.firebase.update(
        db.collection(CHANNEX_INTEGRATIONS).doc(tenantId),
        { channex_channel_id: channexChannelId, updated_at: new Date().toISOString() },
      );
```

Full path (non-BDC fallback, end of method ~line 304):
```typescript
      const propertyRef = db
        .collection(CHANNEX_INTEGRATIONS)
        .doc(tenantId)
        .collection('properties')
        .doc(channexPropertyId);

      await this.firebase.update(propertyRef, {
        channex_channel_id: channexChannelId,
        channex_property_id: channexPropertyId,
        connection_status: 'active',
        ota_rooms: rooms,
        ota_rates: rates,
        updated_at: new Date().toISOString(),
      });

      await this.firebase.update(
        db.collection(CHANNEX_INTEGRATIONS).doc(tenantId),
        { channex_channel_id: channexChannelId, updated_at: new Date().toISOString() },
      );
```

Note: `channexPropertyId` is available as a local variable resolved earlier in `syncBooking` from `bookingChannel.attributes?.properties?.[0]`.

- [ ] **Step 3.3: Update `saveMapping` — write to property subcol doc**

Replace the `firebase.update` call in `saveMapping`:

```typescript
  async saveMapping(dto: MapBookingDto): Promise<{ saved: number }> {
    const db = this.firebase.getFirestore();
    // Read channex_property_id from root doc to find the property subcol doc
    const rootDoc = await db.collection(CHANNEX_INTEGRATIONS).doc(dto.tenantId).get();
    const channexPropertyId: string = rootDoc.data()?.channex_property_id ?? '';

    if (channexPropertyId) {
      const propertyRef = db
        .collection(CHANNEX_INTEGRATIONS)
        .doc(dto.tenantId)
        .collection('properties')
        .doc(channexPropertyId);

      await this.firebase.update(propertyRef, {
        mappings: dto.mappings,
        updated_at: new Date().toISOString(),
      });
    }

    this.logger.log(
      `[BOOKING_MAP] ✓ Saved ${dto.mappings.length} mapping(s) for tenant=${dto.tenantId}`,
    );
    return { saved: dto.mappings.length };
  }
```

- [ ] **Step 3.4: Update `handleChannexWebhook` — keep root doc query (mirror)**

The webhook handler already queries the root collection by `channex_channel_id`. We mirror `channex_channel_id` on the root doc in Steps 3.1/3.2, so this query remains valid. **No change needed** in `handleChannexWebhook` for the lookup.

Only update the downstream sub-writes inside the webhook handler (booking/message saves) if they write directly — check the existing code and if they delegate to the booking worker via BullMQ, no change is needed there either.

- [ ] **Step 3.5: Verify backend compiles**

```powershell
cd apps/backend && pnpm build 2>&1 | Select-String "error TS|error:" | Select-Object -First 20
```

Expected: no errors.

- [ ] **Step 3.6: Commit**

```bash
git add apps/backend/src/booking/booking.service.ts
git commit -m "refactor(booking): migrate Firestore paths to channex_integrations/{tenantId}/properties subcollection"
```

---

## Task 4 — Migrate BookingPipelineService

**Files:**
- Modify: `apps/backend/src/booking/booking-pipeline.service.ts`

Context: `commitPipeline` reads `channex_property_id` and `channex_channel_id` from the root doc at `channex_integrations/{tenantId}` (the root doc still has these as mirrors after Task 3, so the preflight read is unchanged). The only change is Step 8 — writing `room_types` must now go to the property subcol doc, not the root doc.

- [ ] **Step 4.1: Update Step 8 Firestore write — target property subcol doc**

Read `apps/backend/src/booking/booking-pipeline.service.ts` lines 218–256 first.

Replace the `await this.firebase.update(docRef, { ... })` at the end of `commitPipeline` (lines ~244–253) with:

```typescript
    // Write room_types to the property subcol doc
    const propertyRef = db
      .collection(CHANNEX_INTEGRATIONS)
      .doc(tenantId)
      .collection('properties')
      .doc(channexPropertyId);

    await this.firebase.update(propertyRef, {
      connection_status: 'active',
      channel_name: 'BookingCom',
      channex_channel_id: channexChannelId,
      channex_property_id: channexPropertyId,
      channex_webhook_id: webhookId ?? null,
      room_types: Array.from(roomTypesIndex.values()),
      pipeline_completed_at: new Date().toISOString(),
      connected_channels: FieldValue.arrayUnion('booking'),
      updated_at: new Date().toISOString(),
    });

    // Mirror connection_status + channel_id on root doc
    await this.firebase.update(docRef, {
      channex_channel_id: channexChannelId,
      updated_at: new Date().toISOString(),
    });
```

Add `FieldValue` import if not already present:
```typescript
import { FieldValue } from 'firebase-admin/firestore';
```

- [ ] **Step 4.2: Verify backend compiles**

```powershell
cd apps/backend && pnpm build 2>&1 | Select-String "error TS|error:" | Select-Object -First 20
```

Expected: no errors.

- [ ] **Step 4.3: Commit**

```bash
git add apps/backend/src/booking/booking-pipeline.service.ts
git commit -m "refactor(booking-pipeline): write room_types to property subcol doc"
```

---

## Task 5 — Migrate ChannexARIService

**Files:**
- Modify: `apps/backend/src/channex/channex-ari.service.ts`

Context: `channex-ari.service.ts` currently reads and writes `room_types` from/to `channex_integrations/{firestoreDocId}` (the root doc). After this task, `firestoreDocId = tenantId` and `room_types` lives on the property subcol doc. Since ARI methods receive `channexPropertyId` as a parameter and `resolveIntegration` now returns `{ firestoreDocId: tenantId }`, the property ref is simply `db.collection(INTEGRATIONS_COLLECTION).doc(integration.firestoreDocId).collection('properties').doc(channexPropertyId)`.

- [ ] **Step 5.1: Update `createRoomType` — write to property subcol doc**

Read `apps/backend/src/channex/channex-ari.service.ts` lines 69–130 first.

Replace the docRef construction (currently `db.collection(INTEGRATIONS_COLLECTION).doc(integration.firestoreDocId)`):

```typescript
    const db = this.firebase.getFirestore();
    const docRef = db
      .collection(INTEGRATIONS_COLLECTION)
      .doc(integration.firestoreDocId)   // = tenantId
      .collection('properties')
      .doc(channexPropertyId);           // param already available
```

The `channexPropertyId` parameter is the same one passed into `createRoomType` — use it directly.

Apply the same pattern wherever `docRef` is constructed in `createRoomType` and `createRatePlan`.

- [ ] **Step 5.2: Update `getRoomTypes` — read from property subcol doc**

Same change: replace the root doc ref with the property subcol ref in `getRoomTypes`.

- [ ] **Step 5.3: Update `fullSync` — read from property subcol doc**

In `fullSync` (~line 315), replace:

```typescript
    const db = this.firebase.getFirestore();
    const doc = await db
      .collection(INTEGRATIONS_COLLECTION)
      .doc(integration.firestoreDocId)
      .get();
```

with:

```typescript
    const db = this.firebase.getFirestore();
    const doc = await db
      .collection(INTEGRATIONS_COLLECTION)
      .doc(integration.firestoreDocId)
      .collection('properties')
      .doc(propertyId)
      .get();
```

The `propertyId` parameter is already available in `fullSync`.

- [ ] **Step 5.4: Verify backend compiles**

```powershell
cd apps/backend && pnpm build 2>&1 | Select-String "error TS|error:" | Select-Object -First 20
```

Expected: no errors.

- [ ] **Step 5.5: Commit**

```bash
git add apps/backend/src/channex/channex-ari.service.ts
git commit -m "refactor(channex-ari): read/write room_types from property subcol doc"
```

---

## Task 6 — Migrate ChannexSyncService Key Write Methods

**Files:**
- Modify: `apps/backend/src/channex/channex-sync.service.ts`

Context: four private methods query the root collection by `channex_property_id` and then write to the result. After this task they query the `properties` subcollection directly, get the parent ref (tenantId), and write to the property subcol doc.

The query pattern replaces: `db.collection(COLLECTION).where('channex_property_id', '==', propertyId).limit(1).get()` → target `snapshot.docs[0].ref` → with: `db.collectionGroup('properties').where('channex_property_id', '==', propertyId).limit(1).get()` → target `snapshot.docs[0].ref` (the property subcol doc directly).

- [ ] **Step 6.1: Update `saveStageToFirestore`**

Read lines 652–668 first.

Replace:
```typescript
  private async saveStageToFirestore(...) {
    const db = this.firebase.getFirestore();
    const snapshot = await db.collection(COLLECTION).where('channex_property_id', '==', propertyId).limit(1).get();
    if (snapshot.empty) return;
    await this.firebase.update(snapshot.docs[0].ref, { ... });
  }
```

with:
```typescript
  private async saveStageToFirestore(
    propertyId: string,
    channelId: string,
    staged: StagedMappingRow[],
  ): Promise<void> {
    const db = this.firebase.getFirestore();
    const snapshot = await db
      .collectionGroup('properties')
      .where('channex_property_id', '==', propertyId)
      .limit(1)
      .get();

    if (snapshot.empty) return;

    await this.firebase.update(snapshot.docs[0].ref, {
      staged_channel_id: channelId,
      staged_listings: staged.map((row) => row.airbnb),
      staged_channex_entities: staged.map((row) => row.channex),
      staged_at: new Date().toISOString(),
    });
  }
```

- [ ] **Step 6.2: Update `finalizeFirestoreDocument`**

Read lines 674–702 first.

Replace with:
```typescript
  private async finalizeFirestoreDocument(
    propertyId: string,
    channelId: string,
    roomTypes: SyncedRoomType[],
  ): Promise<void> {
    const db = this.firebase.getFirestore();
    const snapshot = await db
      .collectionGroup('properties')
      .where('channex_property_id', '==', propertyId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      throw new NotFoundException(`No property doc found for Channex property ID: ${propertyId}`);
    }

    await this.firebase.update(snapshot.docs[0].ref, {
      connection_status: ChannexConnectionStatus.Active,
      channex_channel_id: channelId,
      oauth_refresh_required: false,
      room_types: roomTypes,
      connected_channels: FieldValue.arrayUnion('airbnb'),
      staged_channel_id: null,
      staged_listings: null,
      staged_channex_entities: null,
      staged_at: null,
      last_sync_timestamp: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Mirror channel_id on the root integration doc for webhook routing
    const tenantId = snapshot.docs[0].data().tenant_id as string;
    if (tenantId) {
      await this.firebase.update(
        db.collection(COLLECTION).doc(tenantId),
        { channex_channel_id: channelId, updated_at: new Date().toISOString() },
      );
    }

    this.logger.log(`[COMMIT] ✓ Firestore finalized — propertyId=${propertyId} status=active`);
  }
```

- [ ] **Step 6.3: Update `updateFirestoreDocument`**

Read lines 744–778 first.

Replace with:
```typescript
  private async updateFirestoreDocument(
    propertyId: string,
    channelId: string,
    roomTypes: SyncedRoomType[],
  ): Promise<void> {
    const db = this.firebase.getFirestore();
    const snapshot = await db
      .collectionGroup('properties')
      .where('channex_property_id', '==', propertyId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      throw new NotFoundException(
        `No property doc found for Channex property ID: ${propertyId}`,
      );
    }

    await this.firebase.update(snapshot.docs[0].ref, {
      connection_status: ChannexConnectionStatus.Active,
      channex_channel_id: channelId,
      oauth_refresh_required: false,
      room_types: roomTypes,
      connected_channels: FieldValue.arrayUnion('airbnb'),
      last_sync_timestamp: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const tenantId = snapshot.docs[0].data().tenant_id as string;
    if (tenantId) {
      await this.firebase.update(
        db.collection(COLLECTION).doc(tenantId),
        { channex_channel_id: channelId, updated_at: new Date().toISOString() },
      );
    }

    this.logger.log(
      `[SYNC] ✓ Firestore updated — propertyId=${propertyId} status=active roomTypes=${roomTypes.length}`,
    );
  }
```

- [ ] **Step 6.4: Update `persistIsolatedSyncResults`**

Read lines 1217–1290 first.

The existing method queries the root collection by `channex_property_id` to get `integrationDocId`. After this task, the root doc is keyed by `tenantId` and `channex_property_id` is on the property subcol. Change the lookup and path building:

Replace the query + `integrationDocId` resolution at lines 1223–1239 with:

```typescript
    const db = this.firebase.getFirestore();
    // The parent property doc is now in the properties subcollection.
    // Look it up by channex_property_id to get the tenantId.
    const parentSnap = await db
      .collectionGroup('properties')
      .where('channex_property_id', '==', parentPropertyId)
      .limit(1)
      .get();

    if (parentSnap.empty) {
      this.logger.warn(
        `[SYNC:1:1] Parent property doc not found — parentPropertyId=${parentPropertyId}`,
      );
      return;
    }

    const tenantId = parentSnap.docs[0].data().tenant_id as string;
    // Root integration doc ID is just tenantId in the new structure.
    const integrationDocId = tenantId;
    const now = new Date().toISOString();
```

The rest of the method writes property subcol docs using `integrationDocId` — these are already correct because they use `db.collection(COLLECTION).doc(integrationDocId).collection('properties').doc(s.channexPropertyId)`. After the refactor `integrationDocId = tenantId`, so those paths become `channex_integrations/{tenantId}/properties/{channexPropertyId}` which is exactly right.

Also add `tenant_id` to each property subcol doc written in the `for (const s of succeeded)` loop:

```typescript
      await this.firebase.set(propertyRef, {
        channex_property_id: s.channexPropertyId,
        tenant_id: tenantId,    // ← ADD THIS
        channex_channel_id: channelId,
        // ... rest of existing fields
      });
```

- [ ] **Step 6.5: Update `resolveParentIntegrationDoc`**

Read lines 1160–1190 first.

This helper currently queries root collection by `channex_property_id`. Update to query `collectionGroup('properties')`:

```typescript
  private async resolveParentIntegrationDoc(propertyId: string): Promise<{
    timezone: string;
    channex_group_id: string | null;
    currency: string;
    tenant_id: string;
  }> {
    const db = this.firebase.getFirestore();
    const snapshot = await db
      .collectionGroup('properties')
      .where('channex_property_id', '==', propertyId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      throw new NotFoundException(
        `No property doc found for Channex property ID: ${propertyId}`,
      );
    }

    const data = snapshot.docs[0].data() as Record<string, unknown>;
    return {
      timezone: (data.timezone as string | undefined) || 'UTC',
      channex_group_id: (data.channex_group_id as string | null | undefined) ?? null,
      currency: (data.currency as string | undefined) || 'USD',
      tenant_id: (data.tenant_id as string | undefined) || '',
    };
  }
```

- [ ] **Step 6.6: Verify backend compiles**

```powershell
cd apps/backend && pnpm build 2>&1 | Select-String "error TS|error:" | Select-Object -First 20
```

Expected: no errors.

- [ ] **Step 6.7: Commit**

```bash
git add apps/backend/src/channex/channex-sync.service.ts
git commit -m "refactor(channex-sync): migrate all Firestore writes to property subcol + collectionGroup queries"
```

---

## Task 7 — Update Frontend `useChannexProperties` Hook

**Files:**
- Modify: `apps/frontend/src/channex/hooks/useChannexProperties.ts`

Context: the hook currently subscribes to a flat query `collection('channex_integrations').where('tenant_id', '==', tenantId)`. After this task it subscribes to the `properties` subcollection at `channex_integrations/{tenantId}/properties`.

- [ ] **Step 7.1: Replace the Firestore query with a subcollection subscription**

Read the file first.

Replace the entire `useEffect` body (lines 30–71):

```typescript
  useEffect(() => {
    if (!tenantId) {
      setProperties([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    // Subscribe to the properties subcollection under the tenant's integration doc.
    const propertiesCol = collection(db, 'channex_integrations', tenantId, 'properties');

    const unsubscribe = onSnapshot(
      propertiesCol,
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
```

Also remove the `query` and `where` imports since they are no longer needed:

```typescript
import { collection, onSnapshot } from 'firebase/firestore';
```

- [ ] **Step 7.2: Verify frontend compiles**

```powershell
cd apps/frontend && pnpm build 2>&1 | Select-String "error TS" | Select-Object -First 20
```

Expected: only the pre-existing `BookingIntegrationView.tsx:230` error.

- [ ] **Step 7.3: Commit**

```bash
git add apps/frontend/src/channex/hooks/useChannexProperties.ts
git commit -m "refactor(frontend): subscribe to channex_integrations/{tenantId}/properties subcollection"
```

---

## Task 8 — Final Build Verification + Smoke-Test Checklist

- [ ] **Step 8.1: Full build — both apps**

```powershell
cd "D:\migo\repos\WhatsApp Multi sign up demo"
pnpm --filter @migo-uit/backend build 2>&1 | Select-String "error TS|error:" | Select-Object -First 20
pnpm --filter @migo-uit/frontend build 2>&1 | Select-String "error TS" | Select-Object -First 20
```

Expected: backend clean; frontend only pre-existing `BookingIntegrationView.tsx:230`.

- [ ] **Step 8.2: Verify git log**

```bash
git log --oneline -8
```

Expected — roughly:
```
refactor(frontend): subscribe to channex_integrations/{tenantId}/properties subcollection
refactor(channex-sync): migrate all Firestore writes to property subcol + collectionGroup queries
refactor(channex-ari): read/write room_types from property subcol doc
refactor(booking-pipeline): write room_types to property subcol doc
refactor(booking): migrate Firestore paths to ...properties subcollection
refactor(channex): migrate provisionProperty to subcollection structure + update resolveIntegration
refactor(booking): replace custom resolveGroupId with ChannexGroupService.ensureGroup
```

- [ ] **Step 8.3: Manual smoke-test checklist (dev server)**

Start dev server and verify the following flows in the UI:

1. **Channex Hub — Properties tab**: starts empty (no properties), no console errors.
2. **Create property via wizard**: completes all 4 steps. After completion, the new property appears in the Properties list.
3. **Check Firestore** (Firebase console or emulator): verify structure matches the target schema:
   - `channex_integrations/{businessId}` root doc exists with `channex_group_id`
   - `channex_integrations/{businessId}/properties/{channexPropertyId}` subcol doc exists with `room_types: [{...}, {...}]`
4. **Booking.com connect**: click "+ Connect" → Booking.com → verify group is reused (no duplicate group created in Channex dashboard) and root doc has `channex_group_id` set.
5. **ARI Calendar**: open an existing property → Full Sync runs without error, task IDs appear in the emerald box.

---

## Firestore Index Note

The `collectionGroup('properties')` queries used in Tasks 2, 5, 6 require a **Firestore composite index** on the `properties` collection group for the field `channex_property_id`. Firestore will return an error with a direct link to create the index on the first query that needs it (dev environment only). Create the index when prompted. In production, add it to `firestore.indexes.json`.

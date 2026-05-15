# Spec: Booking.com Migration into /channex Module

**Date:** 2026-05-15
**Branch:** feat/messaging-inbox
**Status:** Approved

## Problem

Booking.com integration lives in a separate `src/booking/` module that duplicates
infrastructure already present in `src/channex/`. The correct model — used for Airbnb —
is that all OTA channel logic lives in `/channex`, is provider-agnostic at the routing
layer, and channel-specific pipelines are encapsulated in dedicated services. The `/booking`
module pre-dates this architecture and must be retired.

## Goal

Eliminate `src/booking/` entirely and have Booking.com follow the same connection flow
as Airbnb: the user creates a property in the Properties tab, then connects BDC via the
Channex OAuth IFrame, then syncs. All endpoints live under `/channex/properties/:id/*`.

## Architecture

### Provider-agnostic routing layer

`ChannexPropertyController` handles all OTA channels. Channel-specific pipeline logic
lives in dedicated services:

- `ChannexSyncService` → Airbnb pipeline (existing, untouched)
- `ChannexBdcSyncService` → Booking.com pipeline (new)

The session token endpoint (`GET /channex/properties/:id/one-time-token`) is already
channel-agnostic — no changes needed.

### Data storage

Booking.com properties write to the same Firestore collection and document structure
as Airbnb: `channex_integrations/{tenantId}/properties/{channexPropertyId}`.
Field `source: 'booking'` and `connected_channels: [..., 'booking']` distinguish BDC
properties from Airbnb ones (same convention already in use).

## Backend Changes

### New: `channex-bdc-sync.service.ts`

Location: `apps/backend/src/channex/channex-bdc-sync.service.ts`

**Public API:**

```ts
syncBdc(propertyId: string, tenantId: string): Promise<BdcSyncResult>
disconnectBdc(propertyId: string, tenantId: string): Promise<void>
```

**`syncBdc` pipeline (steps 4a → 8):**

1. **4a — Discover BDC channel:** List channels scoped to `property_id` via
   `GET /channels?property_id={propertyId}`, find the one with `channel === 'BookingCom'`.
2. **4a — Fetch mapping_details:** `GET /channels/{channelId}` for settings, then
   `POST /channels/mapping_details` → flatten `data.rooms[].rates[]` into `BdcMappingEntry[]`.
3. **4b — Create room types:** One per unique `otaRoomId`, title prefixed `BDC:`,
   idempotent by title match against existing room types. Uses `ChannexService.createRoomType`.
4. **4c — Create rate plans:** One per `{otaRoomId}_{otaRateId}` composite key,
   idempotent by title. Uses `ChannexService.createRatePlan`.
5. **5 — Apply mappings:** `PUT /channels/{channelId}` with `settings.mappingSettings.rooms`
   and `rate_plans[]` array — single atomic update (same mechanism as current pipeline).
6. **6 — Activate channel:** `POST /channels/{channelId}/activate` with fallback to
   `PUT is_active`.
7. **7 — Register webhook:** Idempotent — skip if callback_url already registered.
   Event mask: `booking_new;booking_modification;booking_cancellation;message_new;inquiry_new;booking_inquiry`.
8. **8 — Install Messages App + persist to Firestore:** Write room types to
   `channex_integrations/{tenantId}/properties/{propertyId}` using `mergeRoomTypes()`.
   Set `connection_status: 'active'`, `channel_name: 'BookingCom'`,
   `connected_channels: arrayUnion('booking')`.

**`disconnectBdc` steps:**

1. Read `channex_channel_id` from the property's Firestore document.
2. `DELETE /channels/{channelId}` via `ChannexService`.
3. Update Firestore: remove `'booking'` from `connected_channels`, clear `channex_channel_id`,
   set `connection_status: 'pending'` (property stays, channel is gone).

**Result shape:**

```ts
export interface BdcSyncResult {
  channexPropertyId: string;
  channexChannelId: string;
  webhookId: string | undefined;
  roomTypesCreated: number;
  ratePlansCreated: number;
  mappingsCreated: number;
}
```

### Updated: `ChannexPropertyController`

Two new endpoints added to the existing controller:

```
POST /channex/properties/:propertyId/sync-bdc
  Body: { tenantId: string }
  Returns: BdcSyncResult

POST /channex/properties/:propertyId/disconnect-bdc
  Body: { tenantId: string }
  Returns: 204 No Content
```

### Updated: `ChannexModule`

`ChannexBdcSyncService` registered as a provider. No export required.

### Deleted: `src/booking/`

```
apps/backend/src/booking/booking.controller.ts
apps/backend/src/booking/booking.service.ts
apps/backend/src/booking/booking-pipeline.service.ts
apps/backend/src/booking/booking.module.ts
apps/backend/src/booking/dto/commit-pipeline.dto.ts
apps/backend/src/booking/dto/connect-booking.dto.ts
apps/backend/src/booking/dto/disconnect-booking.dto.ts
apps/backend/src/booking/dto/map-booking.dto.ts
```

`BookingModule` removed from `app.module.ts` imports.

## Frontend Changes

### Updated: `channexHubApi.ts`

**Add:**

```ts
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
): Promise<BdcSyncResult>
// POST /api/channex/properties/:id/sync-bdc   body: { tenantId }

export async function disconnectBdcChannel(
  propertyId: string,
  tenantId: string,
): Promise<void>
// POST /api/channex/properties/:id/disconnect-bdc   body: { tenantId }
```

**Remove:**
- `getBookingSessionToken` (called `/api/booking/session`)
- `syncBookingListings` (called `/api/booking/sync`)
- `disconnectBookingChannel` (called `/api/booking/disconnect`)

### Updated: `BookingConnectionPanel.tsx`

Three targeted changes — no UI changes:

| | Before | After |
|---|---|---|
| IFrame token | `getBookingSessionToken(tenantId).then(r => r.token)` | `getAirbnbSessionToken` (same existing function) |
| Sync handler | `syncBookingListings(tenantId)` | `syncBdcListings(baseProperty.channex_property_id, tenantId)` |
| Disconnect handler | `disconnectBookingChannel(tenantId)` | `disconnectBdcChannel(baseProperty.channex_property_id, tenantId)` |

The `syncResult` state type changes from the old rooms/rates shape to `BdcSyncResult`.
The success message displays `roomTypesCreated` and `ratePlansCreated` counts.

## Connection Flow (after migration)

```
Properties tab → Create property → channex_property_id stored in Firestore
                       ↓
Booking tab → ChannexOAuthIFrame (channel="BDC", same token endpoint)
                       ↓
User completes BDC popup
                       ↓
"Sync Rooms & Rates" → POST /channex/properties/:id/sync-bdc
  → discover BDC channel → mapping_details → rooms/rates/mappings → activate → webhook
                       ↓
Connected properties list + MessagesInbox appear (same as Airbnb)
```

## What Is NOT Changed

- `ChannexSyncService` and all Airbnb endpoints — untouched
- `ChannexWebhookController` + `ChannexBookingWorker` — BDC webhooks already route through
  these correctly (they match by `channex_property_id` in Firestore)
- `useChannexProperties` hook — already filters by `source: 'booking'` for `{ source: 'booking' }`
- All other channex components (PropertyCard, PropertyDetail, MessagesInbox, etc.)
- Firestore data model

## Risk Notes

- **Channel discovery change:** Current `BookingService.syncBooking` finds the BDC channel
  by `group_id`. New approach finds it by `property_id`. Both are valid Channex query params;
  `property_id` scoping is more precise and avoids cross-property channel collisions within a group.
- **Shell property removal:** `BookingService.getSessionToken` created a shell property
  on-demand. In the new flow the property must already exist (created in Properties tab).
  `BookingConnectionPanel` already guards against missing property via `NoPropertyGuide` —
  no new guard needed.
- **Webhook deduplication:** `BookingService.handleChannexWebhook` wrote to
  `booking_reservations` and `booking_threads` sub-collections. These are separate from
  the main `reservations` collection used by `ChannexBookingWorker`. After migration,
  all BDC events route through `ChannexBookingWorker` which writes to `reservations`.
  Existing `booking_reservations` / `booking_threads` data in Firestore is orphaned but
  harmless (frontend components don't read those collections).

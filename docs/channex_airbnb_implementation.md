# Channex.io × Airbnb — Architectural Implementation Blueprint

**Project:** Migo UIT — Property Management Extension  
**Integration Layer:** Channex.io (Staging → Production)  
**Authored:** 2026-04-10  
**Branch context:** `nilmar/518-57-feature-airbnb-integration-via-channexio-onboarding-oauth`

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Phase 1 — Core Channex Module (Backend Infrastructure)](#2-phase-1--core-channex-module-backend-infrastructure)
3. [Phase 2 — Property Provisioning & Firestore Persistence](#3-phase-2--property-provisioning--firestore-persistence)
4. [Phase 3 — OAuth Onboarding via Channel IFrame](#4-phase-3--oauth-onboarding-via-channel-iframe)
5. [Phase 4 — Webhook Reception (Push/Pull Architecture)](#5-phase-4--webhook-reception-pushpull-architecture)
6. [Phase 5 — Room Type Mapping & ARI Synchronization](#6-phase-5--room-type-mapping--ari-synchronization)
7. [Phase 6 — Frontend Admin UI (`/airbnb`)](#7-phase-6--frontend-admin-ui-airbnb)
8. [Phase 7 — Omnichannel Messaging Bridge](#8-phase-7--omnichannel-messaging-bridge)
9. [Phase 8 — Resilience: Rate Limiting & Fault Tolerance](#9-phase-8--resilience-rate-limiting--fault-tolerance)
10. [Firestore Data Schemas](#10-firestore-data-schemas)
11. [Environment Variables & Secrets](#11-environment-variables--secrets)
12. [Dependency Map (Existing Files Modified)](#12-dependency-map-existing-files-modified)

---

## 1. Architecture Overview

### System Context Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      MIGO UIT FRONTEND (React)                   │
│                                                                   │
│  /airbnb route                                                    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  AirbnbOnboardingPage                                     │    │
│  │  ├── PropertyProvisioningForm   (Step 1)                  │    │
│  │  ├── ChannexIFrame              (Step 2 — OAuth + Mapping)│    │
│  │  ├── ARICalendar                (Step 3 — Availability)   │    │
│  │  └── ReservationInbox           (Step 4 — Bookings)       │    │
│  └──────────────────────────────────────────────────────────┘    │
└───────────────────────────────┬─────────────────────────────────┘
                                │ /api/* (Vite proxy)
┌───────────────────────────────▼─────────────────────────────────┐
│                     NESTJS BACKEND (:3001)                        │
│                                                                   │
│  ChannexModule                                                    │
│  ├── ChannexService          (HTTP client to Channex API)         │
│  ├── ChannexPropertyService  (provisioning + Firestore writes)    │
│  ├── ChannexOAuthService     (one-time token generation)          │
│  ├── ChannexARIService       (availability + restrictions push)   │
│  ├── ChannexWebhookController (POST /channex/webhook)             │
│  └── ChannexBookingWorker    (BullMQ consumer — Pull pattern)     │
│                                                                   │
│  Shared Infrastructure (existing, unmodified)                     │
│  ├── SecretManagerService    (reads CHANNEX_API_KEY)              │
│  ├── FirebaseService         (Firestore reads/writes)             │
│  └── DefensiveLoggerService  (all HTTP calls via .request<T>())   │
└───────────────────┬──────────────────────┬──────────────────────┘
                    │                      │
        ┌───────────▼──────┐   ┌──────────▼──────────┐
        │  Channex.io API   │   │  BullMQ / Redis      │
        │  (Staging)        │   │  (booking-revisions  │
        │                   │   │   queue)             │
        │  POST /properties │   └─────────────────────┘
        │  POST /auth/...   │
        │  GET  /booking_   │
        │       revisions/  │
        │  POST /room_types │
        │  POST /availability│
        │  POST /restrictions│
        └───────────────────┘
```

### Key Architectural Decisions

| Decision | Rationale |
|---|---|
| **Isolated `ChannexModule`** | Mirrors pattern of `MessengerIntegrationModule`, `InstagramIntegrationModule` — zero coupling to existing WhatsApp/Meta flows |
| **Org-level Channex API key** | Single `CHANNEX_API_KEY` in `.env.secrets` controls all tenants; no per-tenant key rotation |
| **Global webhook endpoint** | `POST /channex/webhook` receives all property events; tenant routing done by `channex_property_id` lookup in Firestore |
| **Push/Pull webhook pattern** | Channex sends `send_data=false` webhooks (anemic ping); NestJS pulls full data via `GET /booking_revisions/:id` — keeps PII off the wire |
| **BullMQ/Redis queue** | Guarantees `200 OK` response to Channex in < 200 ms; booking processing is fully async |
| **IFrame auth (headless)** | White-label Airbnb OAuth without redirecting users off Migo UIT domain |
| **Batching ARI pushes (6 s cron)** | Respects Channex rate limit of 10 ARI requests/min/property; Redis buffer consolidates bursts |
| **Firestore `channex_integrations` collection** | Separate from `integrations/` (Meta/WhatsApp) to avoid schema conflicts; indexed on `channex_property_id` for O(log n) webhook routing |

---

## 2. Phase 1 — Core Channex Module (Backend Infrastructure)

**Goal:** Establish the foundational NestJS module, HTTP client service, and secret wiring that all subsequent phases depend on.

### New Files

#### `apps/backend/src/channex/channex.module.ts`
- Declares and exports `ChannexService`, `ChannexPropertyService`, `ChannexOAuthService`, `ChannexARIService`
- Imports `FirebaseModule`, `DefensiveLoggerModule`, `SecretManagerModule` (all already global — no re-registration needed)
- Registers the BullMQ queue `booking-revisions` via `BullModule.registerQueue()`
- Registers `ChannexWebhookController` and `ChannexPropertyController` as HTTP controllers

#### `apps/backend/src/channex/channex.service.ts`
- **Responsibility:** Thin HTTP adapter to Channex REST API. All methods delegate HTTP calls to `DefensiveLoggerService.request<T>()` — identical pattern to `MetaIntegrationService`
- **Base URL:** Resolved from env — `CHANNEX_BASE_URL` (`https://staging.channex.io/api/v1` in staging, `https://api.channex.io/v1` in production)
- **Auth header:** `user-api-key: {CHANNEX_API_KEY}` injected on every outbound request
- **Methods to expose:**
  - `createProperty(payload: CreateChannexPropertyDto): Promise<ChannexPropertyResponse>`
  - `getOneTimeToken(propertyId: string): Promise<string>`
  - `getBookingRevision(revisionId: string): Promise<BookingRevisionDto>`
  - `createRoomType(payload: CreateRoomTypeDto): Promise<ChannexRoomTypeResponse>`
  - `pushAvailability(values: AvailabilityEntryDto[]): Promise<void>`
  - `pushRestrictions(values: RestrictionEntryDto[]): Promise<void>`

#### `apps/backend/src/channex/channex.types.ts`
- TypeScript interfaces for all Channex API response shapes: `ChannexPropertyResponse`, `ChannexRoomTypeResponse`, `BookingRevisionDto`, `BookingRoomDto`, `GuestDto`, `TaxDto`, `GuaranteeDto`
- Enum `BookingRevisionStatus { New = 'new', Modified = 'modified', Cancelled = 'cancelled' }`
- Enum `ChannexConnectionStatus { Pending = 'pending', Active = 'active', TokenExpired = 'token_expired', Error = 'error' }`

### Modified Files

#### `apps/backend/src/app.module.ts`
- Add `ChannexModule` to the `imports` array (same pattern as `CatalogManagerModule`)
- Add `BullModule.forRoot({ connection: { host: process.env.REDIS_HOST, port: Number(process.env.REDIS_PORT) } })` for global BullMQ/Redis connection

#### `apps/backend/src/common/secrets/secret-manager.service.ts`
- No code change — `CHANNEX_API_KEY` is simply added to `.env.secrets`; existing `get()` method handles it automatically

---

## 3. Phase 2 — Property Provisioning & Firestore Persistence

**Goal:** When a Migo UIT admin registers a new property, programmatically create the corresponding entity in Channex and persist the dual-ID mapping in Firestore.

### API Endpoint

```
POST /channex/properties
Body: CreateChannexPropertyDto
Response: { channexPropertyId: string, firestoreDocId: string }
```

### New Files

#### `apps/backend/src/channex/channex-property.controller.ts`
- `@Post('properties')` → calls `ChannexPropertyService.provisionProperty()`
- `@Get('properties/:propertyId/status')` → returns `connection_status` from Firestore
- `@Delete('properties/:propertyId')` → soft-delete: sets `connection_status = 'error'` in Firestore (does not call Channex DELETE — irreversible on OTA side)

#### `apps/backend/src/channex/channex-property.service.ts`
- **`provisionProperty(dto: CreateChannexPropertyDto, tenantId: string)`**
  1. Calls `ChannexService.createProperty()` → receives `channex_property_id` (UUID)
  2. Writes to Firestore `channex_integrations/{tenantId}__{channex_property_id}` (see schema in §10)
  3. Returns composite result to controller
- **`getConnectionStatus(channexPropertyId: string)`** — single Firestore read by document ID
- **`updateConnectionStatus(channexPropertyId: string, status: ChannexConnectionStatus)`** — used by webhook worker and health-check cron

#### `apps/backend/src/channex/dto/create-channex-property.dto.ts`
| Field | Type | Required | Notes |
|---|---|---|---|
| `tenantId` | `string` | Yes | Migo UIT business ID (maps to `tenant_id` in Firestore) |
| `migoPropertyId` | `string` | Yes | Internal property reference in Migo's data model |
| `title` | `string` | Yes | Property commercial name |
| `currency` | `string` | Yes | ISO 4217 (e.g. `USD`, `PEN`) |
| `timezone` | `string` | Yes | IANA tz string (e.g. `America/Lima`) |
| `propertyType` | `string` | No | `apartment` or `hotel`; defaults to `apartment` |
| `groupId` | `string` | No | Channex Group UUID for multi-property tenants |

#### `apps/backend/src/channex/dto/channex-property-response.dto.ts`
- Typed DTO for Channex `POST /properties` 201 response body

### Firestore Write (§10 for full schema)

Collection: `channex_integrations`  
Document ID: `{tenantId}__{channex_property_id}` (deterministic, enables direct reads)

---

## 4. Phase 3 — OAuth Onboarding via Channel IFrame

**Goal:** Securely embed the Channex IFrame inside the Migo UIT React app so tenants can connect their Airbnb accounts without leaving the platform.

### Backend

#### `apps/backend/src/channex/channex-oauth.service.ts`
- **`generateOneTimeToken(propertyId: string): Promise<string>`**
  1. Calls `POST https://staging.channex.io/api/v1/auth/one_time_token` with `{ property_id: propertyId }` in body
  2. Extracts `data.token` from response (15-minute TTL, single-use)
  3. Returns raw token string — never persisted (ephemeral by design)
- **`generateCopyLink(propertyId: string, channel: 'ABB'): Promise<string>`** — fallback for CSP-blocked environments; calls Channel API to generate a sharable auth URL

#### `apps/backend/src/channex/channex-property.controller.ts` (extended)
- `@Get('properties/:propertyId/one-time-token')` → calls `ChannexOAuthService.generateOneTimeToken()`; returns `{ token: string }` to frontend

### Frontend

#### `apps/frontend/src/airbnb/components/ChannexIFrame.tsx`

**Responsibilities:**
- Receives `propertyId` and `tenantId` as props
- On mount: calls `GET /api/channex/properties/:propertyId/one-time-token`
- Constructs `src` URL:
  ```
  https://staging.channex.io/auth/exchange
    ?oauth_session_key={TOKEN}
    &app_mode=headless
    &redirect_to=/channels
    &property_id={PROPERTY_ID}
    &channels=ABB
  ```
- Renders `<iframe>` at full panel height; `app_mode=headless` strips Channex global nav, preserving Migo UIT visual identity
- **Token refresh:** If the GET returns an error or the iframe fires a `postMessage` error event, the component triggers a re-fetch of a new token
- **Fallback (CSP):** If iframe fails to load (detected via `onerror`), renders "Copy Link" button that calls `GET /api/channex/properties/:propertyId/copy-link` and shows the URL in a modal

**State machine:**
```
IDLE → FETCHING_TOKEN → RENDERING_IFRAME → CONNECTED
                    ↘ TOKEN_ERROR → RETRY / COPY_LINK_FALLBACK
```

#### `apps/frontend/src/airbnb/api/channexApi.ts`
- `getOneTimeToken(propertyId: string): Promise<string>`
- `getCopyLink(propertyId: string): Promise<string>`
- `getConnectionStatus(propertyId: string): Promise<ConnectionStatusDto>`
- `provisionProperty(payload: CreatePropertyPayload): Promise<ProvisionedProperty>`
- `pushAvailability(propertyId: string, payload: ARIPayload): Promise<void>`
- `pushRestrictions(propertyId: string, payload: RestrictionsPayload): Promise<void>`

All calls go through the Vite proxy `/api → http://localhost:3001` — identical pattern to `catalogManagerApi.ts`.

---

## 5. Phase 4 — Webhook Reception (Push/Pull Architecture)

**Goal:** Receive Channex webhook pings with guaranteed `200 OK` latency, enqueue revision IDs, and pull full booking data asynchronously from a secure worker.

### Backend

#### `apps/backend/src/channex/channex-webhook.controller.ts`
- Route: `POST /channex/webhook`
- **Step 1 — Immediate ACK:** Responds `200 OK` within < 200 ms regardless of processing state
- **Step 2 — Signature validation:** Validates `X-Channex-Signature` HMAC header (using `CHANNEX_WEBHOOK_SECRET` from `.env.secrets`) — rejects with `403` if invalid
- **Step 3 — Event routing:** Reads `event` field from anemic payload; dispatches to queue only for: `booking_new`, `booking_modification`, `booking_cancellation`, `booking_unmapped_room`; discards `non_acked_booking` (handled by alert service separately)
- **Step 4 — Enqueue:** Injects `revision_id` and `property_id` into BullMQ queue `booking-revisions` via `@InjectQueue('booking-revisions')`

**Webhook payload shape (send_data=false — PII-free):**
```typescript
interface ChannexWebhookPing {
  event: string;           // e.g. 'booking_new'
  property_id: string;     // UUID — Channex property
  revision_id: string;     // UUID — the booking revision to pull
  channel_id?: string;     // UUID — channel (Airbnb = ABB)
}
```

#### `apps/backend/src/channex/workers/channex-booking.worker.ts`
- BullMQ `@Processor('booking-revisions')` consumer
- **`processBookingRevision(job: Job<BookingRevisionJob>)`:**
  1. **Tenant lookup:** Queries Firestore `channex_integrations` where `channex_property_id == property_id` → resolves `tenant_id` in O(log n)
  2. **Pull:** Calls `ChannexService.getBookingRevision(revision_id)` → full `BookingRevisionDto`
  3. **Transform:** Runs `BookingRevisionTransformer.toFirestoreReservation()` DTO translation (§5.1 below)
  4. **Upsert Firestore:** Writes to `channex_integrations/{docId}/reservations/{ota_reservation_code}` using `ota_reservation_code` as idempotency key (prevents duplicates on retry)
  5. **Messaging bridge trigger:** Emits internal event `channex.reservation.new` with guest contact data → picked up by `ChannexMessagingBridgeService` (Phase 7)
  6. **ACK to Channex:** Calls `POST /api/v1/booking_revisions/{id}/acknowledge` — mandatory to prevent `non_acked_booking` retry storm

#### `apps/backend/src/channex/dto/booking-revision.dto.ts`
Complete typed mapping of the Channex Booking Revision object including:
- Root fields: `amount`, `currency`, `ota_commission`, `status`, `ota_reservation_code`, `payment_collect`, `payment_type`, `arrival_date`, `departure_date`
- Nested `rooms[]` → `guests[]` → `{ name, surname }`
- Nested `taxes[]` → `{ type, total_price, is_inclusive }`
- Nested `guarantee` → `{ card_type, expiration_date }` (masked — PCI-out-of-scope for Airbnb)

#### `apps/backend/src/channex/transformers/booking-revision.transformer.ts`
- **`toFirestoreReservation(revision: BookingRevisionDto, tenantId: string): FirestoreReservationDoc`**
- Handles financial logic:
  - `net_payout = amount - ota_commission`
  - For each tax: if `is_inclusive === false`, accumulate into `total_due`
- Extracts guest PII from `revision.rooms[0].guests[0]` — acknowledges OTA opacity (surname may be null pre-48h)
- Sets `payment_status = 'ota_managed'` when `payment_collect === 'ota'` (Airbnb case — no manual charge UI enabled)

### 5.1 Booking Revision → Firestore Translation Table

| Channex Field | Firestore Field | Notes |
|---|---|---|
| `ota_reservation_code` | `reservation_id` (doc key) | Idempotency key |
| `status` | `booking_status` | `new` / `modified` / `cancelled` |
| `arrival_date` | `check_in` | ISO 8601 date |
| `departure_date` | `check_out` | ISO 8601 date |
| `amount` | `gross_amount` | Numeric |
| `currency` | `currency` | ISO 4217 |
| `ota_commission` | `ota_fee` | Numeric |
| `amount - ota_commission` | `net_payout` | Computed |
| `taxes[].total_price` (non-inclusive) | `additional_taxes` | Summed array |
| `rooms[0].guests[0].name` | `guest_first_name` | May be null |
| `rooms[0].guests[0].surname` | `guest_last_name` | OTA-gated pre-48h |
| `payment_collect` | `payment_collect` | `ota` for Airbnb |
| `payment_type` | `payment_type` | `bank_transfer` for Airbnb |
| `channel_id` | `channex_channel_id` | For audit |
| `property_id` | `channex_property_id` | For routing |

---

## 6. Phase 5 — Room Type Mapping & ARI Synchronization

**Goal:** Create logical room type entities in Channex, enable the IFrame-based channel mapping, and implement the batched ARI push mechanism with rate-limit compliance.

### Backend

#### `apps/backend/src/channex/channex-ari.service.ts`
- **`createRoomType(dto: CreateRoomTypeDto): Promise<ChannexRoomTypeResponse>`**
  - Calls `POST https://staging.channex.io/api/v1/room_types`
  - On success: stores `room_type_id` in Firestore `channex_integrations/{docId}.room_types[]`
  - Default `availability` is 0 on creation — property hidden from OTA until first ARI push
- **`bufferAvailabilityUpdate(update: AvailabilityEntryDto): Promise<void>`**
  - Writes update to Redis key `ari:buffer:{property_id}:availability` (sorted set by date)
  - Does NOT call Channex immediately — deferred to cron batch
- **`bufferRestrictionsUpdate(update: RestrictionEntryDto): Promise<void>`**
  - Writes to Redis key `ari:buffer:{property_id}:restrictions`
- **`flushARIBatch(propertyId: string): Promise<void>`** — called by cron every 6 seconds
  - Reads + clears Redis buffer
  - Merges overlapping date ranges into minimal `values[]` array
  - Calls `POST /api/v1/availability` (max 10 req/min — 1 req per 6s = safe)
  - Calls `POST /api/v1/restrictions`
  - On `429 Too Many Requests`: routes job to Dead Letter Queue with 60-second delay (exponential back-off pattern)

#### `apps/backend/src/channex/dto/create-room-type.dto.ts`
| Field | Type | Required |
|---|---|---|
| `propertyId` | `string` | Yes |
| `tenantId` | `string` | Yes |
| `title` | `string` | Yes |
| `defaultOccupancy` | `number` | Yes |
| `occAdults` | `number` | Yes |
| `occChildren` | `number` | No |
| `occInfants` | `number` | No |

#### `apps/backend/src/channex/dto/ari-entry.dto.ts`
Shared base; extended by `AvailabilityEntryDto` and `RestrictionEntryDto`:

**AvailabilityEntryDto:**
| Field | Type | Notes |
|---|---|---|
| `property_id` | `string` | |
| `room_type_id` | `string` | |
| `date_from` | `string` | ISO 8601 |
| `date_to` | `string` | ISO 8601 |
| `availability` | `0 \| 1` | Binary for vacation rentals |

**RestrictionEntryDto:**
| Field | Type | Notes |
|---|---|---|
| `property_id` | `string` | |
| `rate_plan_id` | `string` | Note: rate plan, not room type |
| `date_from` | `string` | ISO 8601 |
| `date_to` | `string` | ISO 8601 |
| `rate` | `string` | Decimal string e.g. `"150.00"` |
| `min_stay_arrival` | `number` | Airbnb uses "Arrival" model |
| `max_stay` | `number \| null` | |
| `stop_sell` | `boolean` | |
| `closed_to_arrival` | `boolean` | CTA flag |
| `closed_to_departure` | `boolean` | CTD flag |

#### `apps/backend/src/channex/channex-ari.controller.ts`
```
POST /channex/properties/:propertyId/room-types        → createRoomType
GET  /channex/properties/:propertyId/room-types        → list from Firestore
POST /channex/properties/:propertyId/availability      → bufferAvailabilityUpdate
POST /channex/properties/:propertyId/restrictions      → bufferRestrictionsUpdate
```

#### `apps/backend/src/channex/cron/ari-flush.cron.ts`
- `@Cron(CronExpression.EVERY_6_SECONDS)` (NestJS `@nestjs/schedule`)
- Queries Firestore for all `channex_integrations` with `connection_status === 'active'`
- For each active property: calls `ChannexARIService.flushARIBatch(propertyId)`
- Logs flush results via `DefensiveLoggerService`

---

## 7. Phase 6 — Frontend Admin UI (`/airbnb`)

**Goal:** Provide a fully isolated React surface at `/airbnb` for the entire Channex/Airbnb lifecycle. Zero modifications to `App.tsx`, existing hooks, or existing components.

### Routing

#### `apps/frontend/src/main.tsx` (minimal modification)
Add one condition to the existing pathname-based routing:
```tsx
const isAirbnb = window.location.pathname.startsWith('/airbnb');
// Render: isAirbnb ? <AirbnbPage /> : isInventory ? <InventoryPage /> : ...
```

### New Files

#### `apps/frontend/src/airbnb/AirbnbPage.tsx`
Top-level orchestrator for the Airbnb integration surface. Manages a 4-step wizard state:
1. `PROVISION` — property registration form
2. `CONNECT` — Channex IFrame (Airbnb OAuth + channel mapping)
3. `INVENTORY` — ARI calendar
4. `BOOKINGS` — reservation inbox

Uses local `useState` for wizard step; reads `propertyId` from component state after provisioning.

#### `apps/frontend/src/airbnb/components/PropertyProvisioningForm.tsx`
- Form fields: `title`, `currency`, `timezone`, `propertyType`
- On submit: calls `channexApi.provisionProperty()` → advances wizard to step 2
- Shows Channex property UUID after success (copy-to-clipboard)

#### `apps/frontend/src/airbnb/components/ChannexIFrame.tsx`
(Detailed in Phase 3 above)

#### `apps/frontend/src/airbnb/components/ConnectionStatusBadge.tsx`
- Polls `GET /api/channex/properties/:propertyId/status` every 30 seconds
- Renders status chip: `pending` (gray) / `active` (emerald) / `token_expired` (amber) / `error` (red)
- When `token_expired`: renders "Re-connect" button that re-mounts `ChannexIFrame` with a fresh token
- When `booking_unmapped_room` event received (via SSE — see §7 below): renders blocking modal

#### `apps/frontend/src/airbnb/components/ARICalendar.tsx`
- Date range picker for availability windows
- Toggle per date: `available (1)` / `blocked (0)`
- Rate input field (decimal; stored as string for Channex compatibility)
- Min stay input (integer, Airbnb "Arrival" model)
- CTA / CTD boolean toggles
- On save: calls `channexApi.pushAvailability()` and/or `channexApi.pushRestrictions()` — backend buffers to Redis, batch fires every 6 s

#### `apps/frontend/src/airbnb/components/ReservationInbox.tsx`
- Lists reservations from Firestore `channex_integrations/{docId}/reservations/` via REST polling (SSE upgrade in Phase 7)
- Columns: `reservation_id`, `guest_first_name`, `check_in`, `check_out`, `gross_amount`, `booking_status`, `payment_collect`
- For `booking_status === 'cancelled'`: strikethrough row with amber chip
- For `payment_collect === 'ota'` (all Airbnb): shows "Paid by Airbnb" badge; charge button disabled
- "Message Guest" action button → triggers omnichannel message flow (Phase 7)

#### `apps/frontend/src/airbnb/components/UnmappedRoomModal.tsx`
- Full-screen blocking modal triggered when backend emits `booking_unmapped_room` event
- Explains the risk (overbooking), shows affected listing
- "Fix Mapping" CTA re-mounts `ChannexIFrame` with `redirect_to=/channels` pointing to the unmapped listing

#### `apps/frontend/src/airbnb/api/channexApi.ts`
(Detailed in Phase 3 above)

### Server-Sent Events (SSE) for Real-Time UI Updates

#### `apps/backend/src/channex/channex-events.controller.ts`
- Route: `GET /channex/events/:tenantId` — SSE stream
- Emits events:
  - `connection_status_change` — when `ChannexPropertyService.updateConnectionStatus()` is called
  - `booking_new` — when worker processes a new reservation
  - `booking_unmapped_room` — immediate alert with `property_id` and `channel_id`

The frontend `AirbnbPage.tsx` opens one `EventSource` connection on mount and routes events to the relevant child component.

---

## 8. Phase 7 — Omnichannel Messaging Bridge

**Goal:** Capture guest contact data from Airbnb reservations and surface them in the Migo UIT unified inbox to enable two-way WhatsApp/Instagram messaging.

### Architecture

Airbnb (via Channex) does not expose guest WhatsApp numbers directly. The bridge operates on a **best-effort enrichment model**:

1. **Stage 1 — Guest Record Creation:** When `channex.reservation.new` fires, `ChannexMessagingBridgeService` creates or updates a contact document in Firestore `contacts/{tenantId}/guests/{ota_reservation_code}` with available PII (name, surname, `check_in`, `check_out`)
2. **Stage 2 — Phone Enrichment (Manual):** The `ReservationInbox` UI shows a "Add Phone" prompt for guests without a WhatsApp number; admin inputs it; stored in the guest contact doc
3. **Stage 3 — Conversation Thread:** "Message Guest" button in `ReservationInbox` → calls existing `MessagingService.sendMessage()` with the guest's phone number and pre-populated reservation context template

### New Files

#### `apps/backend/src/channex/channex-messaging-bridge.service.ts`
- **`onReservationNew(reservation: FirestoreReservationDoc, tenantId: string)`**
  - Upserts `contacts/{tenantId}/guests/{ota_reservation_code}` Firestore document
  - Fields: `first_name`, `last_name` (if available), `check_in`, `check_out`, `channel: 'airbnb'`, `whatsapp_number: null`
  - Does NOT call WhatsApp API at this stage — no phone number yet
- **`linkGuestPhone(tenantId: string, reservationCode: string, phone: string)`**
  - Updates `whatsapp_number` in the guest contact doc
  - Emits SSE event `guest_phone_linked` to `AirbnbPage`

#### `apps/backend/src/channex/dto/link-guest-phone.dto.ts`
- `tenantId: string`, `reservationCode: string`, `phone: string` (E.164 format)

#### `apps/backend/src/channex/channex-messaging-bridge.controller.ts`
```
POST /channex/guests/:reservationCode/phone    → linkGuestPhone
GET  /channex/guests/:reservationCode          → get guest contact
```

### Firestore Guest Contact Schema

**Collection:** `contacts/{tenantId}/guests/{ota_reservation_code}`

```typescript
{
  ota_reservation_code: string;  // doc ID
  first_name: string;
  last_name: string | null;      // OTA-gated
  channel: 'airbnb';
  channex_property_id: string;
  check_in: string;              // ISO 8601
  check_out: string;
  whatsapp_number: string | null; // E.164, filled manually
  created_at: Timestamp;
  updated_at: Timestamp;
}
```

### Frontend Integration

#### `apps/frontend/src/airbnb/components/ReservationInbox.tsx` (extended)
- "Message Guest" button state:
  - `whatsapp_number === null` → shows "Add Phone" inline input → calls `channexApi.linkGuestPhone()`
  - `whatsapp_number !== null` → opens the existing `ChatConsole` component (already in `src/components/ChatConsole/`) in a panel, pre-loaded with the guest's thread

This leverages the existing `MessagingService` and `ChatConsole` without modifying either — the Channex module feeds data _into_ existing omnichannel infrastructure.

---

## 9. Phase 8 — Resilience: Rate Limiting & Fault Tolerance

**Goal:** Implement the BullMQ/Redis batching and back-off patterns required by Channex's rate limits.

### Rate Limit Constraints (from Channex documentation)

| Scope | Limit |
|---|---|
| ARI per property | 10 req/min (5 availability + 5 restrictions) |
| Global API | ~1,500 req/min across all properties |
| Payload size | ~10 MB per JSON request |
| Booking ACK timeout | 30 minutes before `non_acked_booking` fires |

### Batching Strategy (6-Second Cron)

```
User action → ARICalendar → POST /channex/properties/:id/availability
                                        ↓
                              Redis ZADD ari:buffer:{property_id}:availability
                                        ↓
                           [every 6 seconds] ARI Flush Cron
                                        ↓
                              Read + clear Redis buffer
                                        ↓
                              Merge date ranges into minimal values[]
                                        ↓
                              POST /api/v1/availability (Channex)
                                        ↓
                             200 OK → clear buffer
                             429 → Dead Letter Queue + 60s delay
```

### Retry Back-off

#### `apps/backend/src/channex/workers/ari-retry.worker.ts`
- Consumes Dead Letter Queue `ari-dlq`
- Implements exponential back-off: `delay = 60_000 * 2^(job.attemptsMade - 1)` ms
- Max 3 retries; after 3 failures: sets `connection_status = 'error'` in Firestore + emits SSE alert

### BullMQ Queue Definitions

| Queue Name | Producer | Consumer | Purpose |
|---|---|---|---|
| `booking-revisions` | `ChannexWebhookController` | `ChannexBookingWorker` | Async Pull of booking data |
| `ari-flush` | `ARIFlushCron` | `ChannexARIService` | Batched ARI push per property |
| `ari-dlq` | `ChannexARIService` (429 handler) | `ARIRetryWorker` | Back-off retry queue |

### Health Monitoring

#### `apps/backend/src/channex/cron/channex-health.cron.ts`
- `@Cron('0 */15 * * * *')` — runs every 15 minutes
- For each `active` integration in `channex_integrations`: calls `GET /api/v1/channels/:channel_id` on Channex
- If response contains `error_type` field or non-`active` status → sets `connection_status = 'token_expired'` and `oauth_refresh_required = true` in Firestore → SSE emits `connection_status_change` to frontend

---

## 10. Firestore Data Schemas

### Collection: `channex_integrations`

**Document ID:** `{tenantId}__{channex_property_id}`

```typescript
{
  // Identity
  tenant_id: string;              // Migo UIT business ID [indexed]
  migo_property_id: string;       // Internal property ref [indexed]
  channex_property_id: string;    // UUID from Channex POST /properties [indexed]
  channex_channel_id: string;     // UUID of Airbnb channel after OAuth
  channex_group_id?: string;      // Optional group for multi-property tenants

  // Connection state
  connection_status: 'pending' | 'active' | 'token_expired' | 'error';
  oauth_refresh_required: boolean;
  last_sync_timestamp: Timestamp;

  // Property config
  title: string;
  currency: string;               // ISO 4217
  timezone: string;               // IANA tz

  // Room types (stored locally to avoid repeated Channex GET calls)
  room_types: Array<{
    room_type_id: string;
    title: string;
    default_occupancy: number;
    rate_plan_id?: string;        // Set after rate plan creation
  }>;

  // Timestamps
  created_at: Timestamp;
  updated_at: Timestamp;
}
```

**Required Firestore Indexes:**
- `channex_property_id` (single field) — for O(log n) webhook routing
- `tenant_id` (single field) — for tenant dashboard queries
- `connection_status + tenant_id` (composite) — for health-check cron

### Sub-collection: `channex_integrations/{docId}/reservations`

**Document ID:** `{ota_reservation_code}`

```typescript
{
  reservation_id: string;         // = ota_reservation_code (idempotency key)
  booking_status: 'new' | 'modified' | 'cancelled';
  channel: 'airbnb';
  channex_property_id: string;

  // Dates
  check_in: string;               // ISO 8601
  check_out: string;

  // Financial
  gross_amount: number;
  currency: string;
  ota_fee: number;                // ota_commission from Channex
  net_payout: number;             // gross_amount - ota_fee
  additional_taxes: number;       // sum of non-inclusive taxes
  payment_collect: 'ota';         // always 'ota' for Airbnb
  payment_type: 'bank_transfer';  // always for Airbnb

  // Guest (OTA-gated)
  guest_first_name: string;
  guest_last_name: string | null; // null until 48h pre-checkin

  // Messaging bridge
  whatsapp_number: string | null; // E.164, admin-supplied

  // Timestamps
  created_at: Timestamp;
  updated_at: Timestamp;
}
```

---

## 11. Environment Variables & Secrets

### `.env.secrets` (existing file, managed by `SecretManagerService`)

```bash
# Add to apps/backend/.env.secrets
CHANNEX_API_KEY=your_org_level_api_key_from_staging_channex_io
CHANNEX_WEBHOOK_SECRET=hmac_secret_configured_in_channex_webhook_settings
```

### `.env` (non-secret config)

```bash
# Add to apps/backend/.env
CHANNEX_BASE_URL=https://staging.channex.io/api/v1
CHANNEX_IFRAME_BASE_URL=https://staging.channex.io
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
```

**Production swap:** Change `CHANNEX_BASE_URL` to `https://api.channex.io/v1` — no code changes required. Mirrors the existing ngrok/Meta URL swap pattern documented in root `CLAUDE.md`.

---

## 12. Dependency Map (Existing Files Modified)

### Files Modified (Minimal Surgical Changes)

| File | Change | Risk |
|---|---|---|
| `apps/backend/src/app.module.ts` | Add `ChannexModule` import + `BullModule.forRoot()` | Low — additive only |
| `apps/frontend/src/main.tsx` | Add `isAirbnb` pathname check + `AirbnbPage` import | Low — 2 additive lines |

### Files Explicitly NOT Modified

| File | Reason |
|---|---|
| `apps/backend/src/webhook/webhook.controller.ts` | Meta/WhatsApp webhook endpoint untouched |
| `apps/backend/src/webhook/webhook.service.ts` | Meta message processing untouched |
| `apps/backend/src/integrations/**` | All Meta/Instagram/Messenger modules untouched |
| `apps/frontend/src/App.tsx` | Multi Sign-Up demo untouched |
| `apps/frontend/src/components/**` | All existing components untouched (except `ChatConsole` is _consumed_, not modified) |
| `apps/backend/src/messaging/**` | WhatsApp messaging service untouched; Channex bridge _calls into_ it |

### New File Index

```
apps/backend/src/channex/
├── channex.module.ts
├── channex.service.ts                        ← HTTP adapter to Channex API
├── channex.types.ts                          ← All TypeScript interfaces/enums
├── channex-property.controller.ts
├── channex-property.service.ts
├── channex-oauth.service.ts
├── channex-ari.controller.ts
├── channex-ari.service.ts
├── channex-events.controller.ts              ← SSE stream
├── channex-webhook.controller.ts
├── channex-messaging-bridge.controller.ts
├── channex-messaging-bridge.service.ts
├── dto/
│   ├── create-channex-property.dto.ts
│   ├── channex-property-response.dto.ts
│   ├── create-room-type.dto.ts
│   ├── ari-entry.dto.ts
│   ├── booking-revision.dto.ts
│   └── link-guest-phone.dto.ts
├── transformers/
│   └── booking-revision.transformer.ts
├── workers/
│   ├── channex-booking.worker.ts             ← BullMQ Pull consumer
│   └── ari-retry.worker.ts                   ← Dead Letter Queue handler
└── cron/
    ├── ari-flush.cron.ts                     ← Every 6s ARI batch dispatch
    └── channex-health.cron.ts                ← Every 15min token health check

apps/frontend/src/airbnb/
├── AirbnbPage.tsx                            ← Top-level orchestrator + SSE listener
├── api/
│   └── channexApi.ts                         ← Fetch wrappers → /api/channex/*
└── components/
    ├── PropertyProvisioningForm.tsx
    ├── ChannexIFrame.tsx                     ← Headless OAuth IFrame
    ├── ConnectionStatusBadge.tsx
    ├── ARICalendar.tsx
    ├── ReservationInbox.tsx
    └── UnmappedRoomModal.tsx                 ← Blocking alert for unmapped rooms
```

---

## Implementation Phase Sequence

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7 → Phase 8
  ↑           ↑          ↑          ↑          ↑          ↑          ↑         ↑
Core       Provision  OAuth      Webhooks   ARI Sync   React UI  Messaging  Resilience
Module     + Firestore IFrame    Push/Pull  + Batching  /airbnb   Bridge    Rate Limits
```

Phases 1–4 are strictly sequential (each depends on the previous). Phases 5–8 can be developed in parallel once Phase 4 is stable, as they share the foundational `ChannexService` but have no inter-dependencies.

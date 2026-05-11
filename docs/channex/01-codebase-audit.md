# Channex Module — Codebase Audit

> Audit against Channex PMS Certification requirements.
> Generated: 2026-04-30

---

## Module File Map

| File | Responsibility |
|------|---------------|
| `channex.module.ts` | NestJS module wiring — providers, controllers, queue injection |
| `channex.service.ts` | Thin HTTP adapter to Channex REST API. No business logic — all calls flow through here. |
| `channex.types.ts` | TypeScript interfaces for all Channex API payloads and responses |
| `channex-ari.service.ts` | Room Type CRUD + real-time ARI push (availability & restrictions) |
| `channex-ari.controller.ts` | HTTP endpoints exposed to frontend for ARI operations |
| `channex-property.service.ts` | Property lifecycle: create, update, resolve integration by ID |
| `channex-property.controller.ts` | HTTP endpoints for property provisioning |
| `channex-sync.service.ts` | Sync from Airbnb listing data into Channex property/room attributes |
| `channex-webhook.controller.ts` | Receives Channex push events — ACK-first pattern, routes to BullMQ queues |
| `channex-messaging-bridge.service.ts` | Routes Channex messages/inquiries into the Migo messaging layer |
| `channex-messaging-bridge.controller.ts` | HTTP endpoints for messaging bridge |
| `channex-oauth.service.ts` | Airbnb OAuth token exchange and refresh via Channex |
| `workers/channex-booking.worker.ts` | BullMQ processor — handles booking lifecycle events off the main thread |
| `workers/channex-message.worker.ts` | BullMQ processor — handles message/inquiry events |
| `guards/channex-hmac.guard.ts` | Validates `x-channex-signature` HMAC on every inbound webhook |
| `dto/` | Request DTOs for controller endpoints |
| `transformers/` | Response transformers |
| `cron/` | Scheduled tasks |

---

## ARI Push Mechanism

### Architecture Decision (from code comments)

Migo UIT is primarily an **informational PMS** — it receives webhooks and responds to messages. The previous batched Redis/BullMQ ARI flush pattern was removed as over-engineered.

Current pattern: **Synchronous, direct HTTP push per update.**

```
Frontend action
  → POST /channex/ari/availability (or /restrictions)
    → ChannexARIService.pushAvailability(update)
      → ChannexService.pushAvailability([update])   ← single-item array
        → POST https://staging.channex.io/api/v1/availability
          ← Channex confirms → 200 OK returned to frontend
```

### Availability DTO (current)

```typescript
export interface AvailabilityEntryDto {
  property_id: string;
  room_type_id: string;
  date_from: string;       // ISO 8601 (YYYY-MM-DD)
  date_to: string;
  availability: 0 | 1;    // ← BINARY: 0=blocked, 1=open
}
```

### Restrictions DTO (current)

```typescript
export interface RestrictionEntryDto {
  property_id: string;
  rate_plan_id: string;
  date_from: string;
  date_to: string;
  rate?: string;                 // e.g. "150.00"
  min_stay_arrival?: number;
  max_stay?: number | null;
  stop_sell?: boolean;
  closed_to_arrival?: boolean;
  closed_to_departure?: boolean;
}
```

### Notable intentional omissions (from code comments)

- `min_stay_through` — **deliberately excluded**. Comment: "Always use `min_stay_arrival` (Airbnb evaluates stay restrictions on the arrival day). Ignore `min_stay_through` to prevent sync discrepancies."
- `date` (single-date shorthand) — always uses `date_from`/`date_to` range format
- `days` (weekday filter) — not supported
- `rates[]` (multi-occupancy) — not supported

---

## Booking Webhook Pipeline

### ACK-First Contract (implemented correctly)

```
Channex sends POST /channex/webhook
  → ChannexHmacGuard validates x-channex-signature
  → 200 OK flushed immediately (before any async work)
  → payload added to BullMQ queue
    → ChannexBookingWorker processes asynchronously
```

### `send_data: true` (implemented)

Webhook subscription is configured with `send_data: true`. The full booking revision payload is delivered in the webhook push — no secondary `GET /booking_revisions/:id` call is needed.

### Queue configuration

```
Queue: booking-revisions
  attempts: 3
  backoff: fixed 5s
  removeOnComplete: true
  removeOnFail: false (kept for post-mortem)
  jobId: revisionId (idempotency — prevents duplicate processing)

Queue: channex-messages
  Same config; jobId: ota_message_id or message_thread_id
```

### Booking events handled

| Event | Handled | Queue |
|-------|---------|-------|
| `booking_new` | ✅ | booking-revisions |
| `booking_modification` | ✅ | booking-revisions |
| `booking_cancellation` | ✅ | booking-revisions |
| `booking_unmapped_room` | ✅ | booking-revisions |
| `reservation_request` | ✅ | booking-revisions |
| `alteration_request` | ✅ | booking-revisions |
| `message` | ✅ | channex-messages |
| `inquiry` | ✅ | channex-messages |
| `non_acked_booking` | ⚠️ Discarded (log only, no queue entry) | — |

---

## Rate Limiting Status

### Channex limits

- 10 Availability requests / minute / property
- 10 Restrictions requests / minute / property

### Current implementation

**No rate limiting guard on ARI pushes.** Each frontend action triggers a direct synchronous call to Channex. If a user saves multiple changes in quick succession (or if a bulk operation is triggered), the 10 req/min limit can be exceeded.

Current error handling: `ChannexRateLimitError` (wraps 429 response) is thrown and the controller returns the appropriate HTTP status to the frontend. There is no automatic retry or queue backoff.

**Status: MISSING** — no client-side rate limiter, no outbox queue, no backoff on 429 for ARI pushes.

---

## Full Sync Capability

### Channex requirement (Test #1)

Send 500 days of Availability + Rates & Restrictions for all Room Types and Rate Plans in **2 API calls**:
- 1 × POST /availability (all rooms, 500 days)
- 1 × POST /restrictions (all rate plans, 500 days)

### Current implementation

No full-sync mechanism exists. ARI pushes are triggered by individual frontend actions. There is no service method that generates and sends a 500-day bulk payload.

**Status: MISSING** — no `fullSync()` or similar method in `ChannexARIService`.

---

## Batching Capability

### Channex requirement (Tests #2–#8)

Multiple changes (e.g. 3 rate updates for different rate plans on different dates) must be **combined into a single API call** — one `POST /restrictions` with a `values[]` array containing all updates.

### Current implementation

`pushAvailability(update: AvailabilityEntryDto)` and `pushRestrictions(update: RestrictionEntryDto)` each accept a single update object and call `channex.[method]([update])` with a 1-item array.

There is no batching layer. Each frontend save action results in exactly one API call with exactly one item.

**Status: MISSING** — no batch accumulation before dispatching.

---

## Inventory Count vs Binary Availability

### Channex requirement (Tests #9, #10)

Availability values are **integer counts** (e.g. 7 units, 3 units). Test 9 expects reducing Twin Room from 8 → 7 and Double Room from 1 → 0.

### Current implementation

`AvailabilityEntryDto.availability` is typed as `0 | 1` — binary open/blocked model. This matches the Airbnb vacation rental model (single listing = 1 unit) but **does not support inventory counts** for multi-unit room types required by certification.

**Status: PARTIAL** — works for single-unit (Airbnb) use case; needs `number` type for multi-unit certification.

---

## Property & Room Setup

### What's implemented

| Capability | Status |
|-----------|--------|
| Create property (`POST /api/v1/properties`) | ✅ `ChannexPropertyService` |
| Update property attributes | ✅ `ChannexPropertyService` |
| Create room type (`POST /api/v1/room_types`) | ✅ `ChannexARIService.createRoomType()` |
| Get room types | ✅ reads from Firestore cache |
| Create rate plan (`POST /api/v1/rate_plans`) | ✅ `ChannexService.createRatePlan()` |
| Get rate plans | ✅ `ChannexService.getRatePlans()` |
| Multiple room types per property | ✅ supported by API layer |
| Multiple rate plans per room type | ✅ supported by API layer |
| `min_stay_type` property setting | ✅ `'arrival'` hardcoded in property payload |

---

## Credential & Auth

### API Key

Sent as `x-api-key` header on all Channex API calls. Sourced from `CHANNEX_API_KEY` env variable.

### HMAC Webhook Security

`ChannexHmacGuard` validates `x-channex-signature` header on every inbound webhook using `CHANNEX_WEBHOOK_SECRET` env variable.

### Error Classes

```typescript
ChannexRateLimitError  // wraps HTTP 429
ChannexAuthError       // wraps HTTP 401 / 403
```

---

## Certification Readiness Summary

| Area | Status | Notes |
|------|--------|-------|
| Full Sync (Test #1) | ❌ MISSING | No 500-day bulk push capability |
| Single Date Rate Update (Test #2) | ⚠️ PARTIAL | Works but not from PMS save trigger — frontend-driven only |
| Batched Multi-Rate Updates (Tests #3–#8) | ❌ MISSING | No batch accumulation; each update = 1 API call |
| Min Stay restrictions (Test #5) | ✅ | `min_stay_arrival` supported; `min_stay_through` intentionally excluded |
| Stop Sell (Test #6) | ✅ | `stop_sell` field present in DTO |
| CTA / CTD (Test #7) | ✅ | `closed_to_arrival` and `closed_to_departure` in DTO |
| Availability counts (Tests #9, #10) | ⚠️ PARTIAL | Binary 0/1 only; integer counts not supported |
| Booking Receiving (Test #11) | ✅ | ACK-first + send_data + BullMQ worker |
| Rate limiting compliance | ❌ MISSING | No client-side rate limiter or queue backoff |
| Delta-only updates | ✅ | No full-sync polling; updates triggered by user actions |
| Webhook HMAC validation | ✅ | `ChannexHmacGuard` implemented |
| Booking ACK | ✅ | `acknowledgeBookingRevision()` called by worker |

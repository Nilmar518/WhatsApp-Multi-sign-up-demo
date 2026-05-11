# Channex Certification — Test Cases Research

> Research from official Channex documentation and certification form analysis.
> Source form: `output/form-2026-04-30.md` in booking-skills project.
> Generated: 2026-04-30

---

## ARI Endpoints (Official Docs)

### POST /api/v1/availability

**Staging:** `https://staging.channex.io/api/v1/availability`

**Payload:**
```json
{
  "values": [
    {
      "property_id": "<uuid>",
      "room_type_id": "<uuid>",
      "date_from": "2026-11-01",
      "date_to": "2026-11-10",
      "availability": 2
    }
  ]
}
```

Field notes:
- `availability` — non-negative integer count (NOT binary 0/1 for multi-unit)
- Can use `"date"` (single date) OR `"date_from"` + `"date_to"` (range)
- Multiple entries allowed in `values[]` array in one call
- Past dates rejected

**Success response:**
```json
{
  "data": [{ "id": "<task-uuid>", "type": "task" }],
  "meta": { "message": "Success", "warnings": [] }
}
```

The `id` in the response is the **task ID** — this is what the certification form asks for.

---

### POST /api/v1/restrictions

**Staging:** `https://staging.channex.io/api/v1/restrictions`

**Payload:**
```json
{
  "values": [
    {
      "property_id": "<uuid>",
      "rate_plan_id": "<uuid>",
      "date_from": "2026-11-01",
      "date_to": "2026-11-10",
      "rate": "150.00",
      "min_stay_arrival": 2,
      "min_stay_through": 2,
      "max_stay": 7,
      "stop_sell": false,
      "closed_to_arrival": false,
      "closed_to_departure": false
    }
  ]
}
```

Field notes:
- `rate` — decimal string OR minor currency integer (15000 = $150.00). String preferred.
- `min_stay_arrival` — min stay evaluated on arrival day (Airbnb model)
- `min_stay_through` — min stay evaluated every day of stay
- `min_stay` — virtual field; auto-translated based on property's `min_stay_type` setting
- `max_stay` — non-negative integer; 0 = no restriction
- `days` — optional `["mo","tu","we"]` to apply only on specific weekdays
- All restriction fields are optional — at least one must be present
- Multiple entries allowed in `values[]` in one call

**Success response:** same task envelope as availability.

---

## Rate Limits (Official Docs)

| Endpoint | Limit |
|----------|-------|
| POST /availability | 10 requests / minute / property |
| POST /restrictions | 10 requests / minute / property |

**429 response:**
```json
{ "errors": { "code": "http_too_many_requests", "title": "Too Many Requests" } }
```

**Recommended handling:**
- On 429: pause all updates for the property for 1 minute, then retry
- Batch changes into single API calls every 6 seconds
- Use CRON or queue to distribute requests
- Max payload: 10 MB per JSON call

**Certification requirement:** Must confirm you have a queue or limiter in place (form Section 33).

---

## Booking Endpoints (Official Docs)

### GET /api/v1/booking_revisions

Returns unacknowledged booking revisions.

```
GET https://staging.channex.io/api/v1/booking_revisions
  ?filter[property_id]=<uuid>
```

**Response structure:**
```json
{
  "meta": { "total": 1, "page": 1, "limit": 10 },
  "data": [{
    "type": "booking_revision",
    "id": "<revision-uuid>",
    "attributes": {
      "booking_id": "<booking-uuid>",
      "unique_id": "BDC-9996013801",
      "ota_name": "Booking.com",
      "status": "new",
      "arrival_date": "2026-11-21",
      "departure_date": "2026-11-25",
      "amount": "220.00",
      "currency": "USD"
    }
  }]
}
```

### POST /api/v1/booking_revisions/:id/ack

Acknowledges a booking revision — removes it from the feed.

```
POST https://staging.channex.io/api/v1/booking_revisions/<revision-id>/ack
```

No request body required.

**Important:** Unacknowledged bookings trigger email warnings after 30 minutes. Acknowledged bookings are removed from the feed permanently.

---

## Test Case #1 — Full Data Update (Full Sync)

**Objective:** Simulate initial go-live: send 500 days of ARI for all rooms and rates.

**Required API calls: 2**

1. `POST /availability` — all room types, 500 days
   ```json
   {
     "values": [
       {
         "property_id": "<property-id>",
         "room_type_id": "<twin-room-id>",
         "date_from": "2026-04-30",
         "date_to": "2027-10-12",
         "availability": 1
       },
       {
         "property_id": "<property-id>",
         "room_type_id": "<double-room-id>",
         "date_from": "2026-04-30",
         "date_to": "2027-10-12",
         "availability": 1
       }
     ]
   }
   ```

2. `POST /restrictions` — all rate plans, 500 days
   ```json
   {
     "values": [
       {
         "property_id": "<property-id>",
         "rate_plan_id": "<twin-bar-id>",
         "date_from": "2026-04-30",
         "date_to": "2027-10-12",
         "rate": "100.00"
       },
       {
         "property_id": "<property-id>",
         "rate_plan_id": "<twin-bb-id>",
         "date_from": "2026-04-30",
         "date_to": "2027-10-12",
         "rate": "120.00"
       },
       {
         "property_id": "<property-id>",
         "rate_plan_id": "<double-bar-id>",
         "date_from": "2026-04-30",
         "date_to": "2027-10-12",
         "rate": "100.00"
       },
       {
         "property_id": "<property-id>",
         "rate_plan_id": "<double-bb-id>",
         "date_from": "2026-04-30",
         "date_to": "2027-10-12",
         "rate": "120.00"
       }
     ]
   }
   ```

**Form asks for:** Task IDs returned from both calls (one ID per line, Section 4).

**Our gap:** No full-sync service method exists. Need to implement a `fullSync(propertyId)` that sends both calls with all room types and rate plans from Firestore data.

---

## Test Case #2 — Single Date Update for Single Rate

**Objective:** Modify price for Twin Room / BAR on November 22, 2026 → $333.

**Required API calls: 1** (auto-triggered from PMS save)

```json
{
  "values": [{
    "property_id": "<property-id>",
    "rate_plan_id": "<twin-bar-id>",
    "date_from": "2026-11-22",
    "date_to": "2026-11-22",
    "rate": "333.00"
  }]
}
```

**Form asks for:** Task ID (Section 5–6).

**Our gap:** Our system can already push a single restriction. Needs to be triggered from a real "PMS save" UI action. Channex verifies the push happens automatically from the PMS, not manually via curl.

---

## Test Case #3 — Single Date Update for Multiple Rates

**Objective:** 3 rate changes on different dates and rate plans, sent as **one batched call**.

| Room | Rate Plan | Date | Price |
|------|-----------|------|-------|
| Twin | BAR | Nov 21, 2026 | $333 |
| Double | BAR | Nov 25, 2026 | $444 |
| Double | B&B | Nov 29, 2026 | $456.23 |

**Required API calls: 1**

```json
{
  "values": [
    { "property_id": "<id>", "rate_plan_id": "<twin-bar>", "date_from": "2026-11-21", "date_to": "2026-11-21", "rate": "333.00" },
    { "property_id": "<id>", "rate_plan_id": "<double-bar>", "date_from": "2026-11-25", "date_to": "2026-11-25", "rate": "444.00" },
    { "property_id": "<id>", "rate_plan_id": "<double-bb>", "date_from": "2026-11-29", "date_to": "2026-11-29", "rate": "456.23" }
  ]
}
```

**Form asks for:** Task ID (Section 8–9).

**Our gap:** Current system sends 1 call per update. Needs batch accumulation layer.

---

## Test Case #4 — Multiple Date Update for Multiple Rates

**Objective:** 3 rate range changes, sent as **one batched call**.

| Room | Rate Plan | Date Range | Price |
|------|-----------|-----------|-------|
| Twin | BAR | Nov 1–10, 2026 | $241 |
| Double | BAR | Nov 10–16, 2026 | $312.66 |
| Double | B&B | Nov 1–20, 2026 | $111 |

**Required API calls: 1**

```json
{
  "values": [
    { "property_id": "<id>", "rate_plan_id": "<twin-bar>", "date_from": "2026-11-01", "date_to": "2026-11-10", "rate": "241.00" },
    { "property_id": "<id>", "rate_plan_id": "<double-bar>", "date_from": "2026-11-10", "date_to": "2026-11-16", "rate": "312.66" },
    { "property_id": "<id>", "rate_plan_id": "<double-bb>", "date_from": "2026-11-01", "date_to": "2026-11-20", "rate": "111.00" }
  ]
}
```

**Form asks for:** Task ID (Section 11–12).

**Our gap:** Same batching gap as Test #3.

---

## Test Case #5 — Min Stay Update

**Objective:** 3 min-stay restrictions for different rates, sent as **one batched call**.

| Room | Rate Plan | Date | Min Stay |
|------|-----------|------|---------|
| Twin | BAR | Nov 23, 2026 | 3 nights |
| Double | BAR | Nov 25, 2026 | 2 nights |
| Double | B&B | Nov 15, 2026 | 5 nights |

**Required API calls: 1**

```json
{
  "values": [
    { "property_id": "<id>", "rate_plan_id": "<twin-bar>", "date_from": "2026-11-23", "date_to": "2026-11-23", "min_stay_arrival": 3 },
    { "property_id": "<id>", "rate_plan_id": "<double-bar>", "date_from": "2026-11-25", "date_to": "2026-11-25", "min_stay_arrival": 2 },
    { "property_id": "<id>", "rate_plan_id": "<double-bb>", "date_from": "2026-11-15", "date_to": "2026-11-15", "min_stay_arrival": 5 }
  ]
}
```

**Note:** We use `min_stay_arrival` (Airbnb model). Channex also accepts `min_stay_through` — our codebase intentionally omits this.

**Form asks for:** Task ID (Section 14–15).

**Our gap:** Batching.

---

## Test Case #6 — Stop Sell Update

**Objective:** Enable stop_sell for 3 rates on specific dates.

| Room | Rate Plan | Date |
|------|-----------|------|
| Twin | BAR | Nov 14, 2026 |
| Double | BAR | Nov 16, 2026 |
| Double | B&B | Nov 20, 2026 |

**Required API calls: 1**

```json
{
  "values": [
    { "property_id": "<id>", "rate_plan_id": "<twin-bar>", "date_from": "2026-11-14", "date_to": "2026-11-14", "stop_sell": true },
    { "property_id": "<id>", "rate_plan_id": "<double-bar>", "date_from": "2026-11-16", "date_to": "2026-11-16", "stop_sell": true },
    { "property_id": "<id>", "rate_plan_id": "<double-bb>", "date_from": "2026-11-20", "date_to": "2026-11-20", "stop_sell": true }
  ]
}
```

**Form asks for:** Task ID (Section 17–18). Optional if not supported by PMS.

**Our status:** `stop_sell` field is present in `RestrictionEntryDto`. Gap is batching.

---

## Test Case #7 — Multiple Restrictions Update

**Objective:** Complex multi-field restrictions across 4 rate/range combinations.

| Room | Rate Plan | Date Range | CTA | CTD | Max Stay | Min Stay |
|------|-----------|-----------|-----|-----|---------|---------|
| Twin | BAR | Nov 1–10 | true | false | 4 | 1 |
| Twin | B&B | Nov 12–16 | false | true | — | 6 |
| Double | BAR | Nov 10–16 | true | — | — | 2 |
| Double | B&B | Nov 1–20 | — | — | — | 10 |

**Required API calls: 1**

```json
{
  "values": [
    { "property_id": "<id>", "rate_plan_id": "<twin-bar>", "date_from": "2026-11-01", "date_to": "2026-11-10", "closed_to_arrival": true, "closed_to_departure": false, "max_stay": 4, "min_stay_arrival": 1 },
    { "property_id": "<id>", "rate_plan_id": "<twin-bb>", "date_from": "2026-11-12", "date_to": "2026-11-16", "closed_to_arrival": false, "closed_to_departure": true, "min_stay_arrival": 6 },
    { "property_id": "<id>", "rate_plan_id": "<double-bar>", "date_from": "2026-11-10", "date_to": "2026-11-16", "closed_to_arrival": true, "min_stay_arrival": 2 },
    { "property_id": "<id>", "rate_plan_id": "<double-bb>", "date_from": "2026-11-01", "date_to": "2026-11-20", "min_stay_arrival": 10 }
  ]
}
```

**Form asks for:** Task ID (Section 20–21).

**Our status:** All fields (`closed_to_arrival`, `closed_to_departure`, `max_stay`, `min_stay_arrival`) present in DTO. Gap is batching.

---

## Test Case #8 — Half-Year Update

**Objective:** Long-range multi-field updates covering 6 months.

| Room | Rate Plan | Date Range | Rate | CTA | CTD | Min Stay |
|------|-----------|-----------|------|-----|-----|---------|
| Twin | BAR | Dec 1, 2026 – May 1, 2027 | $432 | false | false | 2 |
| Double | BAR | Dec 1, 2026 – May 1, 2027 | $342 | — | — | 3 |

**Required API calls: 1**

```json
{
  "values": [
    { "property_id": "<id>", "rate_plan_id": "<twin-bar>", "date_from": "2026-12-01", "date_to": "2027-05-01", "rate": "432.00", "closed_to_arrival": false, "closed_to_departure": false, "min_stay_arrival": 2 },
    { "property_id": "<id>", "rate_plan_id": "<double-bar>", "date_from": "2026-12-01", "date_to": "2027-05-01", "rate": "342.00", "min_stay_arrival": 3 }
  ]
}
```

**Form asks for:** Task ID (Section 23–24).

**Our gap:** Batching + long range rate updates.

---

## Test Case #9 — Single Date Availability Update

**Objective:** Booking reduces availability on specific dates.

| Room | Date | Before | After |
|------|------|--------|-------|
| Twin | Nov 21, 2026 | 8 | 7 |
| Double | Nov 25, 2026 | 1 | 0 |

**Required API calls: 1–2**

```json
{
  "values": [
    { "property_id": "<id>", "room_type_id": "<twin-room>", "date_from": "2026-11-21", "date_to": "2026-11-21", "availability": 7 },
    { "property_id": "<id>", "room_type_id": "<double-room>", "date_from": "2026-11-25", "date_to": "2026-11-25", "availability": 0 }
  ]
}
```

**Form asks for:** Task ID(s) (Section 26–27).

**Our gap:** Our `AvailabilityEntryDto.availability` is typed as `0 | 1` (binary). Must accept integer counts for certification. Also, this test requires **automatic** push triggered by a booking action.

---

## Test Case #10 — Multiple Date Availability Update

**Objective:** Adjust inventory across date ranges.

| Room | Date Range | Units |
|------|-----------|-------|
| Twin | Nov 10–16, 2026 | 3 |
| Double | Nov 17–24, 2026 | 4 |

**Required API calls: 1–2**

```json
{
  "values": [
    { "property_id": "<id>", "room_type_id": "<twin-room>", "date_from": "2026-11-10", "date_to": "2026-11-16", "availability": 3 },
    { "property_id": "<id>", "room_type_id": "<double-room>", "date_from": "2026-11-17", "date_to": "2026-11-24", "availability": 4 }
  ]
}
```

**Form asks for:** Task ID(s) (Section 29–30).

**Our gap:** Same as Test #9 — binary availability type.

---

## Test Case #11 — Booking Receiving

**Objective:** Receive, process, and acknowledge 3 booking revision types.

### Required steps

1. **New booking** → receive webhook event `booking_new` → store booking → call `POST /booking_revisions/:id/ack`
2. **Modified booking** → `booking_modification` → update stored booking → ACK
3. **Cancelled booking** → `booking_cancellation` → update stored booking → ACK

### What the form requires (Section 32)

- Booking ID (from any of the 3 operations)
- Booking Revision ID for New Revision
- Booking Revision ID for Modified Revision
- Booking Revision ID for Cancelled Revision

### Our implementation status

| Component | Status |
|-----------|--------|
| Webhook endpoint `POST /channex/webhook` | ✅ |
| HMAC signature validation | ✅ |
| ACK-first pattern (200 before queue) | ✅ |
| `send_data: true` (no secondary GET needed) | ✅ |
| BullMQ worker handles all 3 revision statuses | ✅ |
| Idempotency via `jobId: revisionId` | ✅ |
| `POST /booking_revisions/:id/ack` called by worker | ✅ |

**Form asks for:** 4 UUIDs (booking ID + 3 revision IDs). These come from Channex dashboard after creating test bookings.

---

## Section 33 — Rate Limits and Update Logic

### Question 1: Can you stay within rate limits?

Channex requires acknowledgment that you have a queue or limiter.

**Current status:** No rate limiter on ARI pushes. Synchronous single-item calls. Must implement before certifying.

**Answer needed:** Yes (requires implementation).

### Question 2: Do you send only updated changes?

Channex explicitly rejects full-sync-on-timer patterns. They require delta-only pushes.

**Current status:** Our pushes are triggered by user actions (frontend saves). No automatic full-sync timer exists. Full sync is only done manually (once, for certification Test #1). This satisfies the requirement.

**Answer needed:** Yes.

---

## Certification Setup Property Requirements

The form (Section 2) requires creating a test property in Channex staging with:

| Entity | Name | Occupancy | Default Rate |
|--------|------|-----------|-------------|
| Property | `Test Property - Migo UIT` | — | — |
| Room Type | Twin Room | 2 | — |
| Room Type | Double Room | 2 | — |
| Rate Plan | Twin Room / Best Available Rate | — | $100 |
| Rate Plan | Twin Room / Bed & Breakfast | — | $120 |
| Rate Plan | Double Room / Best Available Rate | — | $100 |
| Rate Plan | Double Room / Bed & Breakfast | — | $120 |

Then fetch their UUIDs via Channex API:
- `GET /api/v1/properties` → Property ID
- `GET /api/v1/room_types?filter[property_id]=<id>` → Room Type IDs
- `GET /api/v1/rate_plans?filter[property_id]=<id>` → Rate Plan IDs

These IDs go into the certification form (Section 2, 6 UUID fields).

---

## Section 1 — PMS Functionality Answers

Based on codebase audit:

| Question | Our Answer |
|---------|-----------|
| Multiple Room Types per Property | **Yes** |
| Multiple Rate Plans per Room Type | **Yes** |
| Restrictions supported | Availability, Rate, Min Stay Arrival, Max Stay, Closed To Arrival, Closed To Departure, Stop Sell (**not Min Stay Through**) |
| Need credit card details with bookings? | **No** (we rely on OTA payment) |
| PCI Certified? | **No** (we use Channex/OTA payment handling) |

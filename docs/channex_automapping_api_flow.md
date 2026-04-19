# Channex Auto-Mapping API Flow — Technical Reference

**Scope:** The exact sequential HTTP calls required to fully automate the
Channex × Airbnb mapping without any manual UI interaction.  
**API base (staging):** `https://staging.channex.io/api/v1`  
**Auth header:** `user-api-key: {CHANNEX_API_KEY}` on every request.  
**Sources verified against:** Channex-BL official client library
(`ChannexIO/Channex-BL`), channex-mcp resource layer (`webrenew/channex-mcp`),
and the Channex docs Room Types / Rate Plans collection pages.

---

## Research Findings: Endpoint Status

| Endpoint tried | Result |
|---|---|
| `GET /channels/{id}/ota_rooms` | **404 — does not exist** |
| `GET /channels/{id}/mapping` | **404 on staging for new channels** |
| `GET /channels/{id}/ota_options` | **404 — does not exist** |
| `GET /channels/{id}/listings` | **✓ Confirmed in channex-mcp resource layer** |
| `GET /channels/{id}/mappings` | **✓ Confirmed in Channex-BL library** |
| `PUT /channels/{id}/mappings/{mappingId}` | **✓ Confirmed in channex-mcp resource layer** |
| `PUT /channels/{id}` with `is_active` | **✓ Confirmed in channex-mcp resource layer** |

---

## Architecture Insight: How Channex Mapping Works

The Channex mapping model is **not a CREATE flow** — it is an **UPDATE flow**:

1. When the user completes the Airbnb OAuth popup, Channex internally creates
   one **mapping record** per Airbnb listing. These records exist in the channel
   from the moment the OAuth is complete — they are just *empty* (no Channex
   Room Type or Rate Plan linked yet).
2. Our job is to:
   - Fetch those existing mapping records to learn the Airbnb listing IDs.
   - Create a Channex Room Type + Rate Plan for each listing.
   - Patch each mapping record with the newly created IDs.
3. Once all mappings are filled in, activate the channel.

This means the previous implementation (`POST /channels/{id}/mappings` to create
a new mapping) is incorrect. The correct verb is `PUT` on an **existing** mapping
record ID.

---

## Step 0 — Resolve the Airbnb Channel ID

Already working in our codebase. Listed here for completeness.

```
GET /api/v1/channels?filter[property_id]={channexPropertyId}
```

**Response — find the entry where `attributes.channel === "ABB"` or
`attributes.title` includes "airbnb" (case-insensitive):**

```json
{
  "data": [
    {
      "id": "a6d4a50c-a1a8-4cd3-8d81-07d35f916746",
      "type": "channel",
      "attributes": {
        "title": "Airbnb",
        "channel": "ABB",
        "status": "not_connected",
        "is_active": false,
        "property_id": "{channexPropertyId}"
      }
    }
  ]
}
```

Save `data[n].id` → **channelId**.

---

## Step 1 — Fetch Airbnb Listings (OTA Side)

> **Correct endpoint:** `GET /api/v1/channels/{channelId}/listings`  
> This is the only reliable endpoint confirmed to return Airbnb listing data
> for a newly OAuth-connected channel.

```
GET /api/v1/channels/{channelId}/listings
Headers: user-api-key: {CHANNEX_API_KEY}
```

**Response:**

```json
{
  "data": [
    {
      "id": "12345678",
      "type": "listing",
      "attributes": {
        "listing_id": "12345678",
        "title": "Cozy Ocean-View Studio in Lima",
        "status": "active"
      }
    },
    {
      "id": "87654321",
      "type": "listing",
      "attributes": {
        "listing_id": "87654321",
        "title": "Downtown Penthouse Suite",
        "status": "active"
      }
    }
  ]
}
```

**Empty array guard:** If `data` is empty or the request returns 404, the user
has **not completed the Airbnb OAuth popup**. Surface a clear `422` to the
frontend: _"No Airbnb listings found. Please complete the authorization popup first."_

From each listing, save:
- `data[n].attributes.listing_id` → **otaListingId** (Airbnb's own ID)
- `data[n].attributes.title` → **listingTitle** (used as Room Type name)

---

## Step 2 — Fetch Existing Mapping Records

Before creating anything, fetch the channel's mapping records. Channex created
these automatically when the OAuth completed — one record per Airbnb listing.

```
GET /api/v1/channels/{channelId}/mappings
Headers: user-api-key: {CHANNEX_API_KEY}
```

**Response:**

```json
{
  "data": [
    {
      "id": "e1f2g3h4-...",
      "type": "channel_mapping",
      "attributes": {
        "listing_id": "12345678",
        "room_type_id": null,
        "rate_plan_id": null,
        "is_mapped": false
      }
    },
    {
      "id": "i5j6k7l8-...",
      "type": "channel_mapping",
      "attributes": {
        "listing_id": "87654321",
        "room_type_id": null,
        "rate_plan_id": null,
        "is_mapped": false
      }
    }
  ]
}
```

Build a lookup map: `otaListingId → mappingRecordId`

```
{ "12345678": "e1f2g3h4-...", "87654321": "i5j6k7l8-..." }
```

> **If `data` is empty here** even though Step 1 returned listings, Channex has
> not yet materialised the mapping records. Wait 1–2 seconds and retry once.
> This is a known eventual-consistency behaviour on the Channex staging environment.

---

## Step 3 — Create Room Types (one per listing)

```
POST /api/v1/room_types
Headers: user-api-key: {CHANNEX_API_KEY}
         Content-Type: application/json
```

**Minimal required payload (confirmed from official docs):**

```json
{
  "room_type": {
    "property_id": "{channexPropertyId}",
    "title": "Cozy Ocean-View Studio in Lima",
    "count_of_rooms": 1,
    "occ_adults": 2,
    "occ_children": 0,
    "occ_infants": 0,
    "default_occupancy": 2
  }
}
```

**Response (HTTP 201):**

```json
{
  "data": {
    "type": "room_type",
    "id": "994d1375-dbbd-4072-8724-b2ab32ce781b",
    "attributes": {
      "id": "994d1375-dbbd-4072-8724-b2ab32ce781b",
      "title": "Cozy Ocean-View Studio in Lima",
      "occ_adults": 2,
      "occ_children": 0,
      "occ_infants": 0,
      "default_occupancy": 2,
      "count_of_rooms": 1
    }
  }
}
```

Save `data.id` → **roomTypeId**.

---

## Step 4 — Create Rate Plans (one per Room Type)

```
POST /api/v1/rate_plans
Headers: user-api-key: {CHANNEX_API_KEY}
         Content-Type: application/json
```

**Minimal required payload (confirmed from official docs):**

```json
{
  "rate_plan": {
    "property_id": "{channexPropertyId}",
    "room_type_id": "{roomTypeId}",
    "title": "Cozy Ocean-View Studio in Lima — Standard",
    "options": [
      {
        "occupancy": 2,
        "is_primary": true,
        "rate": 0
      }
    ]
  }
}
```

> **`rate: 0` is intentional** for the initial creation. The actual nightly rate
> is managed via the ARI push (`POST /restrictions`) after mapping is complete.
> Creating with `rate: 0` is standard practice; Channex does not validate a
> minimum rate on creation.

**Response (HTTP 201):**

```json
{
  "data": {
    "type": "rate_plan",
    "id": "bab451e7-9ab1-4cc4-aa16-107bf7bbabb2",
    "attributes": {
      "id": "bab451e7-9ab1-4cc4-aa16-107bf7bbabb2",
      "title": "Cozy Ocean-View Studio in Lima — Standard",
      "sell_mode": "per_room",
      "rate_mode": "manual",
      "currency": "USD",
      "options": [
        { "occupancy": 2, "is_primary": true, "rate": 0 }
      ]
    }
  }
}
```

Save `data.id` → **ratePlanId**.

---

## Step 5 — Patch the Mapping Record

This is the **critical correction** vs. our previous implementation.  
We do **not** POST to create a new mapping — we **PUT** to fill in an existing one.

```
PUT /api/v1/channels/{channelId}/mappings/{mappingRecordId}
Headers: user-api-key: {CHANNEX_API_KEY}
         Content-Type: application/json
```

Where `{mappingRecordId}` is the UUID obtained from Step 2 for this listing's
`otaListingId`.

**Request body:**

```json
{
  "mapping": {
    "room_type_id": "{roomTypeId}",
    "rate_plan_id": "{ratePlanId}",
    "is_mapped": true
  }
}
```

**Response (HTTP 200):**

```json
{
  "data": {
    "id": "e1f2g3h4-...",
    "type": "channel_mapping",
    "attributes": {
      "listing_id": "12345678",
      "room_type_id": "994d1375-dbbd-4072-8724-b2ab32ce781b",
      "rate_plan_id": "bab451e7-9ab1-4cc4-aa16-107bf7bbabb2",
      "is_mapped": true
    }
  }
}
```

Repeat Steps 3–5 for every listing.

---

## Step 6 — Activate the Channel

Once all mappings are filled in, the channel must be **explicitly activated**.
Setting `is_active: true` is a separate call — it does **not** happen
automatically when the last mapping is completed.

```
PUT /api/v1/channels/{channelId}
Headers: user-api-key: {CHANNEX_API_KEY}
         Content-Type: application/json
```

**Request body:**

```json
{
  "channel": {
    "is_active": true
  }
}
```

**Response (HTTP 200):**

```json
{
  "data": {
    "id": "{channelId}",
    "type": "channel",
    "attributes": {
      "title": "Airbnb",
      "channel": "ABB",
      "is_active": true,
      "status": "active"
    }
  }
}
```

---

## Complete Sequential Flow

```
Step 0  GET  /channels?filter[property_id]={propId}          → channelId
Step 1  GET  /channels/{channelId}/listings                   → [ { listing_id, title } ]
Step 2  GET  /channels/{channelId}/mappings                   → [ { id, listing_id, is_mapped: false } ]

Per listing:
  Step 3  POST /room_types                                    → roomTypeId
  Step 4  POST /rate_plans                                    → ratePlanId
  Step 5  PUT  /channels/{channelId}/mappings/{mappingId}    → { is_mapped: true }

Step 6  PUT  /channels/{channelId}  { is_active: true }       → channel active
```

---

## Firestore Update (after Step 6)

Write to `channex_integrations/{docId}`:

```json
{
  "connection_status": "active",
  "channex_channel_id": "{channelId}",
  "oauth_refresh_required": false,
  "room_types": [
    {
      "id": "{roomTypeId}",
      "title": "Cozy Ocean-View Studio in Lima",
      "ratePlanId": "{ratePlanId}",
      "otaListingId": "12345678"
    }
  ],
  "last_sync_timestamp": "{ISO8601}",
  "updated_at": "{ISO8601}"
}
```

---

## Error Handling Matrix

| Condition | Likely Cause | HTTP response to client |
|---|---|---|
| Step 1 returns empty `data` | OAuth popup not completed | `422 Unprocessable Entity` |
| Step 1 returns `401/403` | Channex API key invalid | `502 Bad Gateway` |
| Step 2 returns empty `data` | Channex mapping records not yet materialised | Retry once after 1.5 s; 422 if still empty |
| Step 3/4 returns `422` | Invalid property_id or missing required field | `502 Bad Gateway` with Channex error detail |
| Step 5 `mappingId` not found | Listing/mapping mismatch | Skip + log warning; do not abort entire sync |
| Step 6 returns `403` | Channel not owned by this API key | `502 Bad Gateway` |

---

## Implementation Delta — What Must Change in Our Codebase

The current `ChannexSyncService` has three incorrect assumptions:

| # | Current (wrong) | Correct |
|---|---|---|
| 1 | `GET /channels/{id}/ota_options` to fetch listings | `GET /channels/{id}/listings` |
| 2 | `POST /channels/{id}/mappings` to create a new mapping record | `GET /channels/{id}/mappings` first, then `PUT /channels/{id}/mappings/{existingId}` |
| 3 | No channel activation call | `PUT /channels/{id} { channel: { is_active: true } }` after all mappings |

The service must be refactored to a **5-method pipeline**:
1. `getAirbnbListings(channelId)` — Step 1
2. `getMappingRecords(channelId)` — Step 2
3. `createRoomType(...)` — Step 3 (already correct)
4. `createRatePlan(...)` — Step 4 (already correct)
5. `patchMappingRecord(channelId, mappingId, roomTypeId, ratePlanId)` — Step 5
6. `activateChannel(channelId)` — Step 6 (new)

---

*Sources: [Channex-BL](https://github.com/ChannexIO/Channex-BL) ·
[channex-mcp](https://github.com/webrenew/channex-mcp) ·
[Room Types Docs](https://docs.channex.io/api-v.1-documentation/room-types-collection.md) ·
[Rate Plans Docs](https://docs.channex.io/api-v.1-documentation/rate-plans-collection.md) ·
[Channex Changelog](https://docs.channex.io/changelog)*

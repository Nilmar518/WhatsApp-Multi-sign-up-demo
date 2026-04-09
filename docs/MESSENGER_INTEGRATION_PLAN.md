# Messenger Integration Plan (Meta Graph API v25.0)

## Document Purpose
This plan defines how to extend the current multi-tenant WhatsApp integration architecture to support Facebook Messenger (Page messaging) using Meta Graph API v25.0. It is designed for a hybrid Firestore model where each integration uses a UUID (`integrationId`) and tenant linkage is done via arrays such as `connectedBusinessIds`.

## Scope
- Inbound Messenger webhooks (`object: page`)
- Outbound Messenger Send API
- OAuth and token lifecycle for multi-page onboarding
- Conversation routing / standby handling for coexistence with Meta Business Suite Inbox
- Multi-tenant data model and mapping (`page_id` -> `integrationId`)

---

## 1) Required Permissions (Scopes)

### Mandatory OAuth Scopes for Messenger Onboarding
Use Meta Login with at least the following scopes:

1. `pages_show_list`
- Required to list Pages the user can grant access to.
- Used in `GET /me/accounts` (or equivalent Page listing calls).

2. `pages_messaging`
- Required to send/receive Messenger messages on behalf of a Page.
- Needed for Send API and message webhook operations.

3. `pages_manage_metadata`
- Required to subscribe/unsubscribe app webhooks for a Page (`/{page-id}/subscribed_apps`).
- Needed for page-level webhook field management.

4. `public_profile`
- Basic login identity scope; typically included in Meta Login.
- Useful for account identity and consent UX diagnostics.

### Recommended Additional Scopes (Conditional)
- `pages_read_engagement`: useful for some Page metadata checks.
- `business_management`: useful for enterprise/business asset flows.

### Access Level Notes
- Standard access is enough for role users (app admins/developers/testers).
- Advanced access is required for production traffic from non-role users.
- App Review is required for production-grade `pages_messaging` and related permissions.

### Token Types in v25.0: User Access Token vs Long-lived Page Access Token

#### User Access Token (UAT)
- Obtained from OAuth login.
- Represents the Facebook user and granted scopes.
- Used to list manageable Pages and exchange into Page tokens.
- Typically shorter lifetime unless exchanged to long-lived user token.

#### Long-lived Page Access Token (PAT)
- Page-scoped token derived from a user token that has proper Page tasks/permissions.
- Used for:
  - Send API (`/{PAGE_ID}/messages` or `/me/messages` with Page token)
  - Page webhook subscription (`/{PAGE_ID}/subscribed_apps`)
  - Conversation routing APIs (`pass_thread_control`, `take_thread_control`, etc.)
- Operationally treated as long-lived/persistent, but still subject to invalidation events:
  - User password/security reset
  - Revoked app permissions
  - Removed Page task/role
  - Business asset permission changes

### Token Governance Requirements
- Never store PAT in plaintext Firestore.
- Store secrets in Secret Manager (matching current architecture pattern).
- Persist only non-sensitive metadata in Firestore (`pageId`, `pageName`, token status, last validated timestamp).
- Add active token validation job (daily or every few hours) using safe lightweight Graph checks.

---

## 2) Webhook Architecture

### Webhook Object and Event Shape (`object: page`)
Messenger webhook payloads are delivered as batched events:

```json
{
  "object": "page",
  "entry": [
    {
      "id": "<PAGE_ID>",
      "time": 1710000000000,
      "messaging": [
        {
          "sender": { "id": "<PSID>" },
          "recipient": { "id": "<PAGE_ID>" },
          "timestamp": 1710000000123,
          "message": {
            "mid": "m_abc",
            "text": "hello"
          }
        }
      ]
    }
  ]
}
```

Core routing keys:
- `entry[].id` is the `page_id` and must be the first multi-tenant lookup key.
- `sender.id` is PSID (Page-scoped user id).
- `messaging[]` channel contains events when your app is current thread owner.

### Messaging vs Standby Events
When multiple apps/inbox tools are connected (including Meta Business Suite Inbox), your app may receive events in either channel:

1. `messaging`
- Your app currently controls the thread.
- You may respond normally (subject to policy windows).

2. `standby`
- Your app does not control the thread currently.
- Events are informational unless you explicitly take/request thread control.
- Postback payload caveat: standby-delivered postbacks may omit payload details.

Example `standby` envelope:

```json
{
  "object": "page",
  "entry": [
    {
      "id": "<PAGE_ID>",
      "time": 1710000000000,
      "standby": [
        {
          "sender": { "id": "<PSID>" },
          "recipient": { "id": "<PAGE_ID>" },
          "timestamp": 1710000000123,
          "message": { "mid": "m_def", "text": "need help" }
        }
      ]
    }
  ]
}
```

### Conversation Routing / Handover Implications
Meta now emphasizes Conversation Routing (backward-compatible with most Handover Protocol behavior). Practical design:

- Subscribe to fields at minimum:
  - `messages`
  - `messaging_postbacks`
  - `messaging_optins`
  - `messaging_handover`
  - `standby`

- Persist ownership state per conversation:
  - `threadOwnerAppId`
  - `ownershipState` (`ACTIVE`, `IDLE`, `STANDBY_ONLY`)
  - `lastOwnershipChangeAt`

- Outbound policy:
  - If event arrived via `standby`, do not auto-reply unless business rule explicitly requests ownership transfer and then confirms ownership before send.

### Security Verification (`X-Hub-Signature-256`)
For every webhook POST, validate HMAC SHA-256 using app secret over the raw request body.

Header format:
- `X-Hub-Signature-256: sha256=<hex_digest>`

Pseudo-code:

```ts
const incoming = req.header('x-hub-signature-256') || '';
const expected =
  'sha256=' +
  createHmac('sha256', APP_SECRET)
    .update(rawBodyBuffer)
    .digest('hex');

if (!timingSafeEqual(Buffer.from(incoming), Buffer.from(expected))) {
  throw new UnauthorizedException('Invalid webhook signature');
}
```

Implementation requirements:
- Use raw body bytes, not parsed JSON stringification.
- Perform constant-time comparison.
- Reject missing or malformed signature.
- Return `200` quickly only after minimal validation and queue processing (ack-first async model remains valid).

---

## 3) Multi-tenant Integration Flow (Page Linking)

### Target Outcome
A tenant user links one or more Facebook Pages to the platform; each linked page is mapped to one `integrationId` UUID (or sub-resource under one Messenger integration, based on your tenancy strategy).

### Step-by-step Flow

1. User Login (OAuth)
- Frontend initiates Meta Login with required scopes.
- Backend receives authorization code and exchanges for user token.
- Persist onboarding session with tenant context (`businessId`, operator user id).

2. List Available Pages
- Use user token to fetch manageable Pages.
- Show page list in UI with:
  - `page_id`
  - `page_name`
  - granted tasks/roles

3. Exchange to Long-lived Page Access Token (PAT)
- For selected page, derive/use page token from user context.
- Validate token by calling a low-risk page endpoint.
- Save PAT in secret manager under integration-scoped key.

4. Subscribe App to Page Webhooks
- `POST /{PAGE_ID}/subscribed_apps`
- subscribe fields: `messages,messaging_postbacks,messaging_optins,messaging_handover,standby`
- Validate with `GET /{PAGE_ID}/subscribed_apps`.

5. Persist Integration Record
- Write non-sensitive metadata in Firestore:
  - provider: `META_MESSENGER`
  - `connectedBusinessIds: [<businessId>]`
  - `metaData.pageId`, `metaData.pageName`, `metaData.pageAccessTokenSecretRef`
  - setup status: `PAGE_SUBSCRIBED`

6. Health Check and Activation
- Verify webhook callback delivery with test event.
- Verify send API with controlled internal test PSID (if available).
- Transition integration status to `ACTIVE`.

### Suggested Firestore Shape

```json
{
  "integrationId": "8fd8d8f8-7f4d-4dcb-8d93-6f3eafc4a111",
  "provider": "META_MESSENGER",
  "connectedBusinessIds": ["787167007221172"],
  "status": "ACTIVE",
  "setupStatus": "PAGE_SUBSCRIBED",
  "metaData": {
    "pageId": "123456789012345",
    "pageName": "Acme Support",
    "webhookObject": "page",
    "webhookFields": [
      "messages",
      "messaging_postbacks",
      "messaging_optins",
      "messaging_handover",
      "standby"
    ],
    "tokenSecretKey": "META_PAGE_TOKEN__8fd8d8f8-7f4d-4dcb-8d93-6f3eafc4a111",
    "lastTokenValidationAt": "2026-04-08T12:00:00.000Z"
  },
  "createdAt": "2026-04-08T12:00:00.000Z",
  "updatedAt": "2026-04-08T12:00:00.000Z"
}
```

---

## 4) Messaging API (Outbound)

### Endpoint Usage in v25.0
Preferred explicit endpoint:
- `POST https://graph.facebook.com/v25.0/{PAGE_ID}/messages`

Also supported with page token context:
- `POST https://graph.facebook.com/v25.0/me/messages`

### cURL Example (`/me/messages`)

```bash
curl -X POST "https://graph.facebook.com/v25.0/me/messages" \
  -H "Content-Type: application/json" \
  -d '{
    "messaging_type": "RESPONSE",
    "recipient": { "id": "<PSID>" },
    "message": { "text": "Hello from multi-tenant platform" },
    "access_token": "<PAGE_ACCESS_TOKEN>"
  }'
```

### Equivalent JSON Body (Server-side Request)

```json
{
  "messaging_type": "RESPONSE",
  "recipient": { "id": "<PSID>" },
  "message": { "text": "Hello from multi-tenant platform" }
}
```

### `messaging_type` Requirements
Use correct `messaging_type` to avoid policy blocks:

1. `RESPONSE`
- Use within the standard response window after user interaction.

2. `UPDATE`
- Use for non-promotional updates tied to ongoing interaction context.

3. `MESSAGE_TAG`
- Use outside normal window only with approved/allowed tags and strict policy compliance.
- Track deprecations from changelog (example: several message tags deprecated effective Apr 27, 2026).

### Outbound Guardrails
- Validate thread ownership before send in multi-app routing scenarios.
- Persist outbound request/response correlation ids.
- Implement retry only for transient errors; do not blindly retry policy or permission errors.

---

## 5) Community Insights and Best Practices

## Common Pitfalls (Observed Across Integrations in OSS/Forums)

1. Ignoring `standby`
- Symptom: duplicate replies or conflicting responses with Page Inbox.
- Cause: bot replies to all events regardless of ownership channel.
- Fix: route `standby` events to passive processing; only reply after ownership is confirmed.

2. Missing `messaging_handover` subscription
- Symptom: ownership appears random; difficult to debug why app stopped receiving `messaging` channel.
- Fix: subscribe to `messaging_handover` and persist ownership transitions.

3. Treating PAT as never-expiring
- Symptom: sudden permission errors after admin changes/password reset.
- Fix: health-check PAT lifecycle and automate re-auth UX.

4. Not validating `X-Hub-Signature-256` with raw body
- Symptom: false signature mismatch or security gap.
- Fix: verify against raw bytes before JSON transformations.

5. Sending with wrong `messaging_type` or deprecated tags
- Symptom: Graph errors (policy/code 100 class), blocked sends.
- Fix: enforce messaging policy matrix in code and keep changelog-driven tests.

6. No idempotency on webhook ingest
- Symptom: duplicated inbound tickets/messages after retry deliveries.
- Fix: dedupe by (`mid`, `timestamp`, `page_id`) and preserve ordering by webhook timestamp.

## Handover/Conversation Routing Best Practices
- Always subscribe to both active and passive channels (`messaging` + `standby`).
- Track thread owner state before sending.
- Use explicit control APIs when needed:
  - `/pass_thread_control`
  - `/take_thread_control`
  - `/request_thread_control`
  - `/release_thread_control`
- Prefer deterministic ownership transitions over heuristic retry sends.

---

## Multi-tenant Specifics

### Mapping `page_id` to `integrationId` UUID
Inbound routing key is `entry[].id` (Page ID). Build a fast mapping index:

1. Primary lookup
- Query integration where:
  - `provider == META_MESSENGER`
  - `metaData.pageId == entry.id`

2. Tenant guard
- Ensure resolved integration contains expected tenant relation (`connectedBusinessIds` includes active tenant).

3. Persisted session model
- Conversation docs should include:
  - `integrationId`
  - `businessId`
  - `pageId`
  - `psid`
  - `threadOwnerAppId`

### Recommended Collections

```text
integrations/{integrationId}
  provider = META_MESSENGER
  connectedBusinessIds = [businessId]
  metaData.pageId
  metaData.tokenSecretKey

integrations/{integrationId}/conversations/{pageId_psid}
  pageId
  psid
  threadOwnerAppId
  lastInboundAt

integrations/{integrationId}/messages/{messageId}
  direction = inbound|outbound
  channel = messaging|standby
  pageId
  psid
  raw
```

### Indexing
Create Firestore indexes for:
- `provider + metaData.pageId`
- `connectedBusinessIds (array-contains) + provider`
- conversation lookups by `pageId + psid`

### Secret Strategy
Store PAT using integration-scoped secret key:
- `META_PAGE_TOKEN__{integrationId}`

Never store PAT plaintext in `metaData`.

---

## Operational Architecture

### Webhook Processing Pipeline
1. Verify signature (`X-Hub-Signature-256`).
2. Validate `object === page`.
3. Ack HTTP 200 rapidly.
4. Async fan-out each `entry` and each event item.
5. Resolve `integrationId` by `page_id`.
6. Dedupe and persist raw payload/event envelope.
7. Route by channel:
   - `messaging`: active bot logic
   - `standby`: passive logic / ownership checks only
8. Apply policy and ownership checks before outbound sends.

### Reliability Controls
- Idempotency key: hash of `page_id + psid + mid + timestamp + event_type`.
- Dead-letter queue for failed event handlers.
- Backoff retries for transient Graph/API failures.
- Alerting for token invalidation and webhook signature failures.

---

## API and Payload Examples

### Subscribe App to Page Webhooks

```bash
curl -X POST "https://graph.facebook.com/v25.0/<PAGE_ID>/subscribed_apps" \
  -d "subscribed_fields=messages,messaging_postbacks,messaging_optins,messaging_handover,standby" \
  -d "access_token=<PAGE_ACCESS_TOKEN>"
```

### Check Subscribed Apps

```bash
curl -X GET "https://graph.facebook.com/v25.0/<PAGE_ID>/subscribed_apps?access_token=<PAGE_ACCESS_TOKEN>"
```

### Pass Thread Control

```bash
curl -X POST "https://graph.facebook.com/v25.0/<PAGE_ID>/pass_thread_control" \
  -d "recipient={\"id\":\"<PSID>\"}" \
  -d "target_app_id=<TARGET_APP_ID>" \
  -d "metadata=handoff to live agent" \
  -d "access_token=<PAGE_ACCESS_TOKEN>"
```

---

## v25.0 Change Monitoring and Breaking-change Readiness

### Immediate v25.0 Relevance for Messaging Integrations
1. Messenger Platform changelog confirms latest version track is v25.0.
2. Deprecated message tags enforcement timeline (Apr 27, 2026) can break existing MESSAGE_TAG flows.
3. Graph API v25.0 notes include webhook mTLS certificate CA transition deadlines (critical if mTLS is enabled).

### Release Management Checklist
- Pin all Messenger Graph calls to `v25.0` explicitly.
- Add contract tests for webhook schema drift (`messages`, `standby`, `message_echoes`, `messaging_handover`).
- Add policy tests for deprecated tags and fallback paths.
- Add trust-store readiness task for mTLS environments.

---

## Official Documentation Links (v25.0 Context)

### Core
- Messenger Platform overview:
  - https://developers.facebook.com/docs/messenger-platform
- Messenger Webhooks setup:
  - https://developers.facebook.com/docs/messenger-platform/webhooks
- Messenger Webhook Events reference:
  - https://developers.facebook.com/docs/messenger-platform/reference/webhook-events
- Standby event reference:
  - https://developers.facebook.com/docs/messenger-platform/reference/webhook-events/standby
- Send API reference:
  - https://developers.facebook.com/docs/messenger-platform/reference/send-api
- Conversation Routing:
  - https://developers.facebook.com/docs/messenger-platform/conversation-routing

### Graph/Webhooks Security
- Graph Webhooks getting started:
  - https://developers.facebook.com/docs/graph-api/webhooks/getting-started
- Graph API v25.0 changelog:
  - https://developers.facebook.com/docs/graph-api/changelog/version25.0/
- Messenger Platform changelog:
  - https://developers.facebook.com/docs/messenger-platform/changelog

---

## Implementation Blueprint for This Repository

### Backend Modules to Introduce
1. `apps/backend/src/integrations/messenger/`
- `messenger-integration.service.ts` (OAuth, page listing, PAT exchange, page subscription)
- `messenger.provider.ts` (fits `IntegrationProviderContract` pattern)
- DTOs for onboarding steps

2. `apps/backend/src/webhook/`
- Extend current controller/service to support Messenger `object: page` branch in parallel with WhatsApp paths.
- Add signature verification middleware using raw body.

3. `apps/backend/src/messaging/`
- Add provider-aware send function for Messenger (`META_MESSENGER`) using PAT from secret store.

### Data/Secret Integration
- Reuse `integrations` collection with UUID document IDs.
- Add `META_PAGE_TOKEN__{integrationId}` secret namespace.
- Keep `connectedBusinessIds` query pattern for tenant resolution consistency.

### Rollout Phases
1. Phase 1: read-only inbound ingest and storage for `messages` + `standby`.
2. Phase 2: controlled outbound sends using `RESPONSE` only.
3. Phase 3: ownership-aware routing (thread control APIs + handoff observability).
4. Phase 4: policy expansion (`UPDATE`, approved `MESSAGE_TAG` cases) and advanced automation.

---

## Final Recommendations
- Treat Messenger routing state as first-class data, not transient runtime memory.
- Do not auto-reply to `standby` events.
- Enforce strict signature verification and idempotency for every webhook event.
- Keep Graph version explicit (`v25.0`) and changelog-driven tests mandatory in CI.
- Reuse your proven UUID + `connectedBusinessIds` pattern to avoid coupling Page IDs with tenant identity.

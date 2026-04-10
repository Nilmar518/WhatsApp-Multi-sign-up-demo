# Instagram API Integration — Architecture & Implementation Guide

> **Revision:** Production-ready (April 2026)
> **API Product:** Instagram API with Instagram Login (native flow)
> **API Version:** `v25.0`
> **Replaces:** Legacy "Messenger API for Instagram" strategy document

---

## Table of Contents

1. [Architectural Overview](#1-architectural-overview)
2. [Authentication — Native OAuth 2.0 Flow](#2-authentication--native-oauth-20-flow)
3. [The Dual-ID System & Webhook Routing](#3-the-dual-id-system--webhook-routing)
4. [Inbound Webhook Processing & Echo Loop Guard](#4-inbound-webhook-processing--echo-loop-guard)
5. [Outbound Messaging Architecture](#5-outbound-messaging-architecture)
6. [Comment Automation & Private Replies](#6-comment-automation--private-replies)
7. [Instagram UI Constraints — Rich Cards & Catalogs](#7-instagram-ui-constraints--rich-cards--catalogs)
8. [Compliance Windows & State Management](#8-compliance-windows--state-management)
9. [Firestore Schema Reference](#9-firestore-schema-reference)
10. [Environment Configuration Reference](#10-environment-configuration-reference)

---

## 1. Architectural Overview

### Why We Migrated Away from "Messenger API for Instagram"

The platform was originally designed around **Messenger API for Instagram**, which routes all
Instagram messaging through the Facebook Graph API (`graph.facebook.com`) and requires:

- A linked Facebook Page
- Facebook-scoped OAuth (`pages_manage_metadata`, `pages_show_list`, etc.)
- `FB.login()` popup in the frontend (broken for native Instagram scopes)
- Page Access Tokens, not Instagram tokens

This approach was deprecated in favour of the modern **Instagram API with Instagram Login**,
which is a self-contained product that issues native Instagram tokens with no Facebook Page
requirement. It uses `api.instagram.com` for auth and `graph.instagram.com` for all API calls.

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│  ONBOARDING (once per business)                                     │
│                                                                     │
│  Frontend                    Backend                  Instagram     │
│  ────────                    ───────                  ─────────     │
│  [Connect IG] ──redirect──▶  api.instagram.com/oauth/authorize      │
│                              (user approves scopes)                 │
│                 ◀──code────  api.instagram.com (redirect back)      │
│                              GET /oauth-callback?code=X&state=biz   │
│                              │                                      │
│                              ├─ POST api.instagram.com/oauth/...    │
│                              │   code → short-lived token           │
│                              │                                      │
│                              ├─ GET  graph.instagram.com/access_token│
│                              │   short-lived → long-lived (60 days) │
│                              │                                      │
│                              ├─ GET  graph.instagram.com/v25.0/me   │
│                              │   token → igUserId (IGSID)           │
│                              │                                      │
│                              └─ Firestore write + webhook subscribe │
│                 ◀──redirect── /?ig_connected=1                      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  RUNTIME (per inbound event)                                        │
│                                                                     │
│  Instagram Platform          Backend                                │
│  ──────────────              ───────                                │
│  POST /webhook  ────────────▶ WebhookController                     │
│  (object:"instagram")         │                                     │
│                               ├─ HMAC-SHA256 signature check        │
│                               ├─ Route to processInstagramInbound() │
│                               ├─ Echo loop guard (discard echoes)   │
│                               ├─ findInstagramIntegrationByEntryId()│
│                               │   (dual-ID lookup + self-heal)      │
│                               ├─ Rule Engine evaluation             │
│                               └─ Outbound via graph.instagram.com   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Authentication — Native OAuth 2.0 Flow

### What Changed

| Dimension | Old (Messenger API for IG) | New (Instagram API with Instagram Login) |
|---|---|---|
| Auth entry point | `FB.login()` popup | `window.location.href` redirect |
| OAuth host | `facebook.com/dialog/oauth` | `api.instagram.com/oauth/authorize` |
| Scopes | `pages_*`, `instagram_basic`, `instagram_manage_messages` | `instagram_business_*` only |
| Token host | `graph.facebook.com` | `api.instagram.com` + `graph.instagram.com` |
| Facebook Page required | Yes | No |
| Credentials | `META_APP_ID` / `META_APP_SECRET` | `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` |

> **Critical:** `INSTAGRAM_APP_ID` and `INSTAGRAM_APP_SECRET` are credentials for a
> **separate product** ("Instagram API with Instagram Login") inside your Meta App Dashboard.
> They are distinct from `META_APP_ID` / `META_APP_SECRET` used for WhatsApp and Messenger.

### Required OAuth Scopes

```
instagram_business_basic
instagram_business_manage_messages
instagram_business_manage_comments
```

No Facebook-scoped permissions are required or requested.

### Frontend: Initiating the OAuth Redirect

`FB.login()` categorically rejects native Instagram scopes — it must not be used.
The frontend constructs the authorization URL and does a hard redirect:

```typescript
// apps/frontend/src/hooks/useInstagramConnect.ts

const connect = (businessId: string) => {
  const params = new URLSearchParams({
    client_id:     import.meta.env.VITE_INSTAGRAM_APP_ID,
    redirect_uri:  import.meta.env.VITE_IG_REDIRECT_URI,   // backend callback URL
    scope:         'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments',
    response_type: 'code',
    state:         businessId,   // passed through unchanged; recovered in callback
  });

  window.location.href = `https://api.instagram.com/oauth/authorize?${params.toString()}`;
};
```

`VITE_IG_REDIRECT_URI` must point directly to the **backend** callback endpoint — this is not
proxied through the frontend. In development, it must be an ngrok HTTPS URL.

### Backend: Three-Step Token Pipeline

`GET /integrations/instagram/oauth-callback?code=X&state={businessId}`

```
Step 1 — Auth code → short-lived token
  POST https://api.instagram.com/oauth/access_token
  Content-Type: application/x-www-form-urlencoded
  Body: client_id, client_secret, grant_type=authorization_code,
        redirect_uri, code

  ⚠ Instagram occasionally appends '#_' to the code in the redirect URL.
    Strip it before sending: code.replace(/#_$/, '')

Step 2 — Short-lived → long-lived token (60 days)
  GET https://graph.instagram.com/access_token
  Params: grant_type=ig_exchange_token, client_secret, access_token

Step 3 — Resolve Instagram User ID
  GET https://graph.instagram.com/v25.0/me?fields=id,username
  Params: access_token

  ⚠ This returns the native IGSID (e.g. 2636...), NOT the Professional
    Account ID used in webhook entry.id. See Section 3 for the dual-ID
    strategy that resolves this mismatch.
```

On success, the controller redirects the browser to `{FRONTEND_URL}/?ig_connected=1`.
On any failure, it redirects to `{FRONTEND_URL}/?ig_error={message}`.

The frontend `InstagramConnect` component reads `?ig_error` on mount, surfaces it as a
banner, then cleans the URL with `history.replaceState`.

### Webhook Subscription (Post-Setup)

After writing the Firestore document, `finaliseSetup()` subscribes the account:

```
POST https://graph.instagram.com/v25.0/{igAccountId}/subscribed_apps
Params:
  subscribed_fields: messages,comments,mentions
  access_token:      {longLivedToken}
```

This call is idempotent — "already subscribed" errors are swallowed and logged as success.

---

## 3. The Dual-ID System & Webhook Routing

### The ID Mismatch Problem

This is the most subtle production issue in the integration. Two structurally different IDs
exist for the same Instagram account:

| ID | Source | Value example | Used in |
|---|---|---|---|
| **IGSID** (`igUserId`) | `GET /me` during OAuth | `2636...` | Stored during setup |
| **Professional Account ID** | Webhook `entry[].id` and `messaging[].recipient.id` | `1784...` | All inbound webhooks |

For accounts linked to a Facebook Page, these IDs are **always different**.
`GET /me` on the native IG token returns the consumer-facing IGSID. Webhooks are dispatched
using the Page-Linked Instagram Professional Account ID. There is no Graph API call that
returns the Professional Account ID via the native Instagram token — it is only discoverable
when the first webhook arrives.

### Solution: Dual Storage + Self-Healing Webhook Routing

**During OAuth setup (`finaliseSetup`):**

Both fields are written to Firestore with the same initial value (the `/me` IGSID):

```typescript
await this.firebase.update(docRef, {
  'metaData.igUserId':   igAccountId,   // native IGSID — immutable, never changes
  'metaData.igAccountId': igAccountId,  // starts as IGSID, self-healed to Professional ID
  // ...
});
```

**During webhook processing (`findInstagramIntegrationByEntryId`):**

A two-stage Firestore lookup is performed:

```
Stage 1 — Primary query (fast path, used after first self-heal):
  WHERE provider == 'META_INSTAGRAM'
  AND   metaData.igAccountId == entryId

Stage 2 — Fallback query (first webhook after OAuth for Page-linked accounts):
  WHERE provider == 'META_INSTAGRAM'
  AND   metaData.igUserId == entryId

If found via Stage 2 → Self-Heal:
  doc.ref.update({ 'metaData.igAccountId': entryId })
  (non-fatal if write fails — lookup still succeeds)
```

```typescript
// webhook.service.ts — findInstagramIntegrationByEntryId (simplified)

const primarySnap = await db.collection('integrations')
  .where('provider', '==', 'META_INSTAGRAM')
  .where('metaData.igAccountId', '==', entryId)
  .limit(1).get();

if (!primarySnap.empty) return primarySnap.docs[0];

const fallbackSnap = await db.collection('integrations')
  .where('provider', '==', 'META_INSTAGRAM')
  .where('metaData.igUserId', '==', entryId)
  .limit(1).get();

if (fallbackSnap.empty) return null;

// Self-heal: future lookups will hit Stage 1
await fallbackSnap.docs[0].ref.update({ 'metaData.igAccountId': entryId });
return fallbackSnap.docs[0];
```

**Outcome:** The warning `No META_INSTAGRAM integration found for entryId=...` fires at most
once — on the very first inbound webhook for a Page-linked account. After the self-heal write
completes, all subsequent lookups resolve instantly via the primary query.

### Composite Firestore Index Required

Both lookup queries must be backed by composite indexes:

```
Collection: integrations
  Index 1: provider ASC, metaData.igAccountId ASC
  Index 2: provider ASC, metaData.igUserId ASC
```

---

## 4. Inbound Webhook Processing & Echo Loop Guard

### Payload Structure

Instagram webhooks arrive at `POST /webhook` with `object: "instagram"`. The NestJS
`WebhookController` routes them to `processInstagramInbound()` after HMAC-SHA256 validation.

```json
{
  "object": "instagram",
  "entry": [
    {
      "id": "178414304107XXXXX",
      "time": 1712600000,
      "messaging": [
        {
          "sender":    { "id": "396492032692XXXXX" },
          "recipient": { "id": "178414304107XXXXX" },
          "timestamp": 1712600000000,
          "message": {
            "mid": "aGVsbG8...",
            "text": "hello"
          }
        }
      ]
    }
  ]
}
```

`entry[].id` and `messaging[].recipient.id` both carry the Professional Account ID.
`messaging[].sender.id` is the IGSID of the end-user (or the business's own IGSID for echo events).

### Echo Loop Guard

When the backend sends an outbound message, Instagram reflects it back as an inbound webhook
with `message.is_echo: true` and with `sender.id` equal to the business account's IGSID.
Without a guard, this echo re-enters the Rule Engine and triggers an infinite reply loop.

**Two conditions are checked — either is sufficient to discard the event:**

```typescript
// Condition 1 — explicit echo flag
if (msg.message?.is_echo === true) {
  this.logger.debug(`[INSTAGRAM_WEBHOOK] Echo discarded — mid=${msg.message?.mid}`);
  continue;
}

// Condition 2 — sender is the business itself (self-message)
if (msg.sender?.id === msg.recipient?.id) {
  this.logger.debug(`[INSTAGRAM_WEBHOOK] Self-message discarded — sender===recipient`);
  continue;
}
```

Both checks run **before** any Rule Engine evaluation or Firestore reads.

### Interaction Type Routing

After the echo guard, the event type is determined from the message structure:

```
message.attachments[0].type === 'story_mention'  →  STORY_MENTION
changes[].field === 'comments'                   →  COMMENT
changes[].field === 'mentions'                   →  MENTION
(default)                                        →  DIRECT_MESSAGE
```

---

## 5. Outbound Messaging Architecture

### Endpoint

All outbound messages, regardless of interaction type, use the native Instagram messaging
endpoint. The `/me` node resolves to the account whose token is supplied, eliminating the
need to hard-code `igAccountId` in the URL:

```
POST https://graph.instagram.com/v25.0/me/messages
Query param: access_token={longLivedToken}
```

This completely bypasses the legacy Facebook Graph API endpoint
(`graph.facebook.com/{pageId}/messages`), which required Page Access Tokens.

### Outbound Payload — Text DM

```json
{
  "recipient": { "id": "{igsid}" },
  "message":   { "text": "Your message here" }
}
```

### Outbound Payload — Product Rich Card

See [Section 7](#7-instagram-ui-constraints--rich-cards--catalogs) for payload structure and
rendering constraints.

### Manual DM Endpoint

`POST /integrations/instagram/:integrationId/messages`

```json
{ "recipientId": "{igsid}", "text": "Hello" }
```

Enforces the 24-hour messaging window — returns `HTTP 403` if the window is closed.
Persists the outbound message to `integrations/{id}/messages/` for the chat UI.

---

## 6. Comment Automation & Private Replies

### Comment Webhook Structure

Comment events arrive under `entry[].changes` (not `entry[].messaging`):

```json
{
  "object": "instagram",
  "entry": [{
    "id": "178414304107XXXXX",
    "changes": [{
      "field": "comments",
      "value": {
        "id":       "{commentId}",
        "text":     "What's the price?",
        "timestamp": 1712600000,
        "media": { "id": "{mediaId}" },
        "from": { "id": "{igsid}", "username": "user123" }
      }
    }]
  }]
}
```

### Public Reply

Appends a visible reply under the original post:

```
POST https://graph.instagram.com/v25.0/{commentId}/replies
Params: access_token
Body:   { "message": "{text}" }
```

### Private Reply (DM triggered by comment)

Delivers a DM initiated by targeting the comment ID, bypassing the standard requirement
for the user to have previously messaged the business:

```
POST https://graph.instagram.com/v25.0/me/messages
Params: access_token
Body:
{
  "recipient": { "comment_id": "{commentId}" },
  "message":   { "text": "{text}" }
}
```

### Compliance Guardrails

These are enforced **before** any API call is made:

| Rule | Enforcement |
|---|---|
| **Single Reply Rule** | Firestore doc `messages/comment_{commentId}` must have `privateReplyStatus: 'PENDING'`; any other value returns `HTTP 403` |
| **7-Day Temporal Limit** | `commentTimestamp` checked: if `Date.now() - new Date(timestamp) > 7 days`, returns `HTTP 403` |
| **24-Hour Window** | DM replies check `conversations/{igsid}.lastUserInteractionTimestamp`; if stale, returns `HTTP 403` |

After a successful Private Reply, `privateReplyStatus` is updated to `'PRIVATE_REPLY_SENT'`
atomically so duplicate webhook deliveries are idempotent.

---

## 7. Instagram UI Constraints — Rich Cards & Catalogs

### Graceful Degradation Behaviour

Instagram silently degrades a `generic` template card to **plain text** if any of the
following unsupported fields are present:

- `default_action` — **must never be included** in Instagram payloads
- Postback buttons (`type: "postback"`) — **strictly prohibited**
- More than 3 buttons per element
- Carousel with more than 1 element (only the first renders; others are silently dropped)

> This degradation produces no API error — the request returns `HTTP 200` but the user
> receives stripped text, making it extremely difficult to diagnose in production without
> dedicated visual testing against a live Instagram account.

### Minimum Viable Rich Card Structure

To force Instagram to render the card UI rather than falling back to text, **at least one
`web_url` button is mandatory**:

```json
{
  "recipient": { "id": "{igsid}" },
  "message": {
    "attachment": {
      "type": "template",
      "payload": {
        "template_type": "generic",
        "elements": [
          {
            "title":    "Ceramic Vase — $45.00",
            "subtitle": "In stock · Free shipping over $50",
            "image_url": "https://storage.googleapis.com/your-bucket/vase.jpg",
            "buttons": [
              {
                "type":  "web_url",
                "url":   "https://your-store.com/products/ceramic-vase",
                "title": "View Product"
              }
            ]
          }
        ]
      }
    }
  }
}
```

**Rules at a glance:**

| Property | Allowed | Notes |
|---|---|---|
| `default_action` | ❌ Never | Causes full card degradation to text |
| `type: "postback"` buttons | ❌ Never | Causes full card degradation to text |
| `type: "web_url"` buttons | ✅ Required | At least one mandatory for card rendering |
| Number of elements | Max 1 | Additional elements are silently dropped |
| Number of buttons | Max 3 | Per element |
| `title` length | Max 80 chars | |
| `subtitle` length | Max 80 chars | |

### Image Hosting Constraints

Meta's `safe_image.php` crawler validates all `image_url` values before rendering.
Certain CDN domains are blocked and return `HTTP 403` to Meta's crawler — this causes the
entire card to degrade to plain text with no API-level error:

- **Pinterest CDNs** (`pinimg.com`, `pinterest.com`) — consistently blocked (403)
- Any domain with strict hotlink protection or Referer checks

**Required:** All product images must be hosted on permissive public cloud storage:
- Firebase Storage (public bucket, no signed URLs required for CDN-served images)
- AWS S3 with public-read ACL
- Cloudflare R2 with public access

### Price Parsing from Meta Catalog API

Meta's Catalog API returns prices as formatted strings, not numbers:
- `"45.00 USD"`, `"1,200.50"`, `"$80.00"`, `"80,00"`

**Never parse with `parseFloat()` directly** — `parseFloat("80,00")` returns `80`, not
`80.00`. Use strict regex extraction:

```typescript
// Extract the numeric portion before any unit/currency suffix
const numericStr = priceString.match(/[\d.,]+/)?.[0] ?? '0';

// Normalize decimal separator (some locales use comma)
const normalized = numericStr.replace(/,(\d{2})$/, '.$1');

const price = parseFloat(normalized);
```

**Also note:** Meta stores prices in minor currency units for some catalog types
(e.g. `1000` = $10.00 USD in the Commerce Catalog). Confirm the unit convention for
your catalog type before display formatting:

```typescript
// For Commerce Catalog (minor units):
const displayPrice = (rawPrice / 100).toFixed(2);

// For Instagram Shopping (decimal string):
const displayPrice = parseFloat(rawPrice).toFixed(2);
```

---

## 8. Compliance Windows & State Management

### 24-Hour Messaging Window

The window opens when the user sends a message (DM, Story Mention reply, or
Quick Reply tap). Every subsequent inbound interaction resets the timer.

```typescript
// Enforced in WebhookService before every outbound DM dispatch
private async checkInstagramWindowOpen(
  integrationDocRef: FirebaseFirestore.DocumentReference,
  igsid: string,
): Promise<boolean> {
  const convSnap = await integrationDocRef
    .collection('conversations').doc(igsid).get();
  const ts = convSnap.data()?.lastUserInteractionTimestamp as number | undefined;
  return !!ts && (Date.now() - ts) < 24 * 60 * 60 * 1000;
}
```

`lastUserInteractionTimestamp` is updated to `Date.now()` on every processed inbound
DM or Story Mention. It is **not** updated when a comment webhook fires — a comment
alone does not open the 24-hour window.

### Story Mention Window Behaviour

A Story Mention arrives as an inbound DM event and therefore:
- Updates `lastUserInteractionTimestamp`
- Opens the 24-hour messaging window immediately
- Can be replied to with a standard text or rich card DM

### Token Expiry

Long-lived Instagram tokens expire after **60 days**. A cron job must refresh them
between day 50 and day 55 using:

```
GET https://graph.instagram.com/refresh_access_token
Params:
  grant_type:   ig_refresh_token
  access_token: {currentLongLivedToken}
```

The refreshed token is written back to `metaData.accessToken` in Firestore.

---

## 9. Firestore Schema Reference

### `integrations/{integrationId}`

```typescript
{
  integrationId:        string,       // UUID
  provider:             'META_INSTAGRAM',
  connectedBusinessIds: string[],     // [businessId]
  status:               'WEBHOOKS_SUBSCRIBED',
  setupStatus:          'WEBHOOKS_SUBSCRIBED',
  createdAt:            string,       // ISO 8601
  updatedAt:            string,       // ISO 8601

  metaData: {
    igUserId:              string,    // Native IGSID from GET /me (immutable)
    igAccountId:           string,    // Professional Account ID matching webhook entry.id
                                      // Starts equal to igUserId; self-healed on first webhook
    igUsername:            string,
    accessToken:           string,    // Long-lived Instagram token (60-day)
    webhookFields:         string[],  // ['messages', 'comments', 'mentions']
    lastTokenValidationAt: string,    // ISO 8601
  }
}
```

### `integrations/{id}/conversations/{igsid}`

```typescript
{
  igsid:                        string,
  lastUserInteractionTimestamp: number,   // epoch ms — drives 24-hour window check
  channel:                      'META_INSTAGRAM',
  updatedAt:                    string,
}
```

### `integrations/{id}/messages/{messageId}`

```typescript
{
  id:              string,          // local UUID
  externalId:      string,          // Meta's mid
  direction:       'inbound' | 'outbound',
  from:            string,          // sender ID
  to:              string,          // recipient ID
  text:            string,
  timestamp:       string,          // ISO 8601
  channel:         'META_INSTAGRAM',
  interactionType: 'DIRECT_MESSAGE' | 'COMMENT' | 'STORY_MENTION',
  createdAt:       string,

  // Comment-specific fields (interactionType === 'COMMENT')
  commentId?:           string,
  mediaId?:             string,
  privateReplyStatus?:  'PENDING' | 'PRIVATE_REPLY_SENT',
  privateReplySentAt?:  string,
}
```

---

## 10. Environment Configuration Reference

### `apps/backend/.env`

```bash
# Instagram OAuth 2.0
# Must match exactly what is registered in Meta App Dashboard → Valid OAuth Redirect URIs
IG_OAUTH_REDIRECT_URI=https://{ngrok-id}.ngrok-free.app/integrations/instagram/oauth-callback

# Backend redirects the browser here after successful OAuth callback
FRONTEND_URL=https://localhost:5173
```

### `apps/backend/.env.secrets`

```bash
# Instagram API with Instagram Login credentials
# Found in: Meta App Dashboard → your app → Instagram → Basic Settings
# DISTINCT from META_APP_ID / META_APP_SECRET
INSTAGRAM_APP_ID=your_instagram_app_id
INSTAGRAM_APP_SECRET=your_instagram_app_secret
```

### `apps/frontend/.env`

```bash
# Used by useInstagramConnect to build the api.instagram.com/oauth/authorize URL
VITE_INSTAGRAM_APP_ID=your_instagram_app_id

# Must match IG_OAUTH_REDIRECT_URI in backend/.env exactly
# Points directly to the backend (not the Vite dev server)
VITE_IG_REDIRECT_URI=https://{ngrok-id}.ngrok-free.app/integrations/instagram/oauth-callback
```

### ngrok Update Checklist

Instagram OAuth requires HTTPS. Every time ngrok restarts, update **all three** locations:

- [ ] `NGROK_URL` in `apps/backend/.env`
- [ ] `IG_OAUTH_REDIRECT_URI` in `apps/backend/.env`
- [ ] `VITE_IG_REDIRECT_URI` in `apps/frontend/.env`
- [ ] Meta App Dashboard → Instagram → Valid OAuth Redirect URIs

---

## Appendix A: API Endpoint Summary

| Operation | Method | URL |
|---|---|---|
| Auth code → short-lived token | `POST` | `https://api.instagram.com/oauth/access_token` |
| Short-lived → long-lived token | `GET` | `https://graph.instagram.com/access_token` |
| Resolve account ID | `GET` | `https://graph.instagram.com/v25.0/me` |
| Subscribe webhook fields | `POST` | `https://graph.instagram.com/v25.0/{igAccountId}/subscribed_apps` |
| Send DM / Private Reply | `POST` | `https://graph.instagram.com/v25.0/me/messages` |
| Send Public Reply to comment | `POST` | `https://graph.instagram.com/v25.0/{commentId}/replies` |
| Refresh long-lived token | `GET` | `https://graph.instagram.com/refresh_access_token` |

## Appendix B: Key Decision Log

| Decision | Rationale |
|---|---|
| Dropped `FB.login()` | Categorically rejects native `instagram_business_*` scopes |
| `window.location.href` redirect | Only mechanism that correctly passes IG scopes to `api.instagram.com` |
| Separate `INSTAGRAM_APP_ID` credentials | Instagram Login is a separate product from WhatsApp/Messenger in Meta Dashboard |
| Strip `#_` from auth code | Instagram sometimes appends this fragment in the redirect URL; causes 400 if not stripped |
| `/me/messages` not `/{igAccountId}/messages` | `/me` resolves via token; avoids needing to pass Professional Account ID explicitly |
| Dual-ID storage (`igUserId` + `igAccountId`) | `/me` returns IGSID; webhooks use Professional Account ID — different for Page-linked accounts |
| Self-healing on first webhook | Professional Account ID is not discoverable before the first webhook fires |
| No `default_action` in IG cards | Silently degrades entire card to plain text; no API error surfaced |
| No postback buttons in IG cards | Same silent degradation behaviour as `default_action` |
| Regex price extraction | `parseFloat()` on formatted strings yields mathematical corruption |
| Firebase Storage / S3 for images | Meta's `safe_image.php` blocks Pinterest and strict-hotlink CDNs silently |

# Instagram Messaging API — Implementation Plan

## Architecture Summary

Instagram Direct is integrated as a third provider (`META_INSTAGRAM`) alongside the
existing `META` (WhatsApp) and `META_MESSENGER` (Facebook Messenger) providers. The
existing provider pattern (IntegrationProviderContract + IntegrationsService Map) is
extended without any structural changes — one new sub-module, one new provider class,
one new enum.

Webhook events arrive at the same `POST /webhook` endpoint. They are routed to a new
`processInstagramInbound()` processor in `WebhookService` based on `object === "instagram"`.

---

## 5-Phase Breakdown

### Phase 1 — Onboarding & Permissions ← **CURRENT**

**Goal:** Connect an Instagram Business Account and store the integration in Firestore.

**New Files:**
```
apps/backend/src/integrations/instagram/
  ├── dto/setup-instagram.dto.ts
  ├── instagram-setup-status.enum.ts
  ├── instagram-integration.service.ts   POST /integrations/instagram/setup
  ├── instagram-integration.controller.ts
  ├── instagram-integration.module.ts
  └── instagram.provider.ts

apps/frontend/src/
  ├── hooks/useInstagramConnect.ts
  └── components/InstagramConnect/index.tsx
```

**Modified Files:**
| File | Change |
|------|--------|
| `integrations/integration-provider.contract.ts` | Add `'META_INSTAGRAM'` to `IntegrationProvider` union |
| `integrations/integrations.module.ts` | Import `InstagramIntegrationModule`, provide `InstagramProvider` |
| `integrations/integrations.service.ts` | Register `META_INSTAGRAM` in provider Map; handle reset key |
| `webhook/webhook.controller.ts` | Add `object === 'instagram'` routing case |
| `webhook/webhook.service.ts` | Add `processInstagramInbound()` stub (logs, no-op for Phase 1) |
| `types/integration.ts` | Add Instagram setup status literals |
| `components/ChannelTabs/index.tsx` | Enable Instagram tab (remove `disabled`) |
| `App.tsx` | Add Instagram channel state + `InstagramConnect` / chat block |

**OAuth Scopes Requested:**
- `instagram_basic`
- `instagram_manage_messages`
- `instagram_manage_comments`
- `pages_read_engagement`
- `pages_show_list`
- `pages_manage_metadata`
- `public_profile`

**Firestore Document Written:**
```
integrations/{integrationId}
  provider:               'META_INSTAGRAM'
  connectedBusinessIds:   [businessId]
  status:                 'WEBHOOKS_SUBSCRIBED'
  setupStatus:            'WEBHOOKS_SUBSCRIBED'
  metaData:
    pageId:               Facebook Page ID linked to the IG account
    pageName:             Display name of the Facebook Page
    igAccountId:          Instagram Business Account ID (IGSID namespace root)
    igUsername:           @handle (from /instagram_business_account fields)
    accessToken:          Long-lived Page Access Token (POC mode)
    webhookFields:        ['messages','messaging_postbacks','messaging_optins',
                           'standby','comments','live_comments']
    lastTokenValidationAt: ISO timestamp
  createdAt:              ISO timestamp
  updatedAt:              ISO timestamp
```

---

### Phase 2 — Ingestion & Classification

**Goal:** Route `object: "instagram"` webhooks; classify events as DM / STORY_MENTION /
COMMENT; persist to Firestore conversation schema.

**New Files:**
```
apps/backend/src/integrations/instagram/
  └── instagram-webhook-normalizer.service.ts
      - Parses entry[].messaging[] → DIRECT_MESSAGE, STORY_MENTION
      - Parses entry[].changes[field=comments] → COMMENT
      - Emits UnifiedInboundEvent DTO

apps/backend/src/webhook/dto/
  └── unified-inbound-event.dto.ts
      { source, interactionType, identifier, textPayload, raw }
```

**Modified Files:**
| File | Change |
|------|--------|
| `webhook/webhook.service.ts` | Replace stub with real `processInstagramInbound()` using normalizer |
| Firestore `conversations/{id}` | Add `channel: 'INSTAGRAM'`, `lastUserInteractionTimestamp`, `interactions/` sub-collection |

**Firestore Schema Extension:**
```
conversations/{conversationId}
  integrationId:              string
  channel:                    'INSTAGRAM'
  igsid:                      string         ← Instagram-Scoped User ID
  lastUserInteractionTimestamp: number        ← Unix ms — enforces 24-h window
  interactions/{comment_id}
    igsid:                    string
    mediaId:                  string
    repliedAt:                Timestamp
    status:                   'PRIVATE_REPLY_SENT'
```

---

### Phase 3 — Catalog Rendering for DMs

**Goal:** When the Rule Engine triggers a catalog response for Instagram, format it as
sequential single-element Generic Template rich cards (bypasses IG carousel bug).

**New Files:**
```
apps/backend/src/integrations/instagram/
  └── instagram-outbound-mapper.service.ts
      - Transforms Firestore product docs into Generic Template payloads
      - Enforces: elements.length === 1, title ≤ 80 chars, subtitle ≤ 80 chars
      - Dispatches sequential cards for multi-product responses
      - Endpoint: POST /v25.0/{IG_PAGE_ID}/messages
```

**Modified Files:**
| File | Change |
|------|--------|
| `webhook/webhook.service.ts` | Route Instagram catalog triggers to `InstagramOutboundMapper` |
| `catalog/` or `auto-reply/` | Check `source === 'INSTAGRAM'` before selecting formatter |

**Payload Constraints Enforced:**
| Firestore Field | Template Target | Constraint |
|---|---|---|
| `product.media.url` | `image_url` | JPEG/PNG, max 8 MB |
| `product.title` | `title` | max 80 chars |
| `product.metadata` | `subtitle` | max 80 chars (price + stock) |
| `product.checkoutUrl` | `buttons[0].url` | max 3 buttons per element |

---

### Phase 4 — Accordion UI & Contextual Chat Panel

**Goal:** Overhaul Instagram channel UI with three content streams (DMs, Mentions,
Comments) and a context-aware right panel.

**New Files:**
```
apps/frontend/src/components/InstagramInbox/
  ├── index.tsx               ← orchestrator
  ├── AccordionSection.tsx    ← reusable expand/collapse section
  ├── DmList.tsx              ← list of DM conversations
  ├── MentionList.tsx         ← list of story mentions
  ├── CommentList.tsx         ← list of comment interactions
  └── CommentDetailPanel.tsx  ← right panel: media thumbnail + reply options
```

**Modified Files:**
| File | Change |
|------|--------|
| `App.tsx` | Replace simple `InstagramConnect` block with `InstagramInbox` when connected |
| `ChatConsole/index.tsx` | Accept `interactionType` prop; render reply-mode header for comments |

**UX Detail — Comment Panel:**
When a Comment is selected:
- Fetch `mediaId` from Firestore `interactions/{commentId}`
- Display parent Post/Reel thumbnail via GET `/{media-id}?fields=media_url,thumbnail_url`
- Show "Reply Publicly" (Graph API comment reply) and "Send Private DM" (Private Reply) CTAs

---

### Phase 5 — Compliance Guardrails

**Goal:** Enforce Meta's three hard limits in the backend — 24-hour DM window, 7-day
Private Reply deadline, one Private Reply per unique `comment_id`.

**Modified Files:**
| File | Change |
|------|--------|
| `webhook/webhook.service.ts` | Evaluate `lastUserInteractionTimestamp` before dispatching any outbound IG message |
| `integrations/instagram/instagram-outbound-mapper.service.ts` | Wrap all dispatch calls with window check; dead-letter queue for expired conversations |
| Firestore `conversations/{id}` | `lastUserInteractionTimestamp` updated on every inbound message |
| Firestore `interactions/{comment_id}` | `status: 'PRIVATE_REPLY_SENT'` check before sending; reject duplicates |

**Window Logic:**
```typescript
const isWindowOpen = (lastInteractionTimestamp: number): boolean => {
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  return (Date.now() - lastInteractionTimestamp) <= TWENTY_FOUR_HOURS_MS;
};
```

**Private Reply Idempotency:**
```
Firestore path: integrations/{id}/conversations/{conversationId}/interactions/{comment_id}
Query: if doc exists with status === 'PRIVATE_REPLY_SENT' → discard, do not re-dispatch
```

**Rate Limit Guard (future BullMQ integration):**
```
Max 200 DMs / hour per IG account
Token bucket via BullMQ limiter: { max: 200, duration: 3_600_000 }
```

---

## Firestore Index Requirements

```
Collection: integrations
Composite indexes required:
  1. connectedBusinessIds (array-contains) + provider (asc)  ← Phase 1
  2. connectedBusinessIds (array-contains) + channel (asc)   ← Phase 2 (conversations)
```

---

## Environment / Secrets

No new `.env` keys required for Phase 1. The same `META_APP_ID` / `META_APP_SECRET`
from `.env.secrets` are reused. The long-lived Page Access Token for each integration
is stored in Firestore `metaData.accessToken` (POC mode, consistent with Messenger).

For production, replace with SecretManager key pattern: `META_IG_TOKEN__{integrationId}`.

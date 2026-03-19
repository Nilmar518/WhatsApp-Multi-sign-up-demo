# WhatsApp POC — Ground Truth Reference

> **Purpose:** Authoritative, copy-pasteable reference for migrating this POC to production.
> All snippets are extracted verbatim from the working codebase. API version: **Meta Graph API v25.0**.
> Do not invent patterns not documented here.

---

## Table of Contents
1. [Meta API Configuration & Endpoints](#1-meta-api-configuration--endpoints)
2. [Webhook Management (Inbound)](#2-webhook-management-inbound)
3. [Catalog & Inventory Management](#3-catalog--inventory-management)
4. [The Cart Engine](#4-the-cart-engine)
5. [Outbound Messaging Payloads](#5-outbound-messaging-payloads)
6. [Firestore Database Schema](#6-firestore-database-schema)

---

## 1. Meta API Configuration & Endpoints

### 1.1 API Versions

Two different Graph API versions are used — **do not mix them up**:

| Version | Used For |
|---|---|
| `v19.0` | Catalog CRUD (create/read/update/delete catalogs & products) |
| `v25.0` | Messages, WABA discovery, Commerce settings, webhook verification |

```typescript
// From webhook.service.ts
const META_GRAPH_V25 = 'https://graph.facebook.com/v25.0';

// From common/utils/send-whatsapp-text.ts
const META_MESSAGES_ENDPOINT =
  'https://graph.facebook.com/v25.0/{phoneNumberId}/messages';
```

### 1.2 Environment Variables

**`.env` (non-secret, committed)**
```bash
PORT=3001
NGROK_URL=https://your-ngrok-url.ngrok-free.app
META_WEBHOOK_VERIFY_TOKEN=migo_verify_secret_2024
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@your_project_id.iam.gserviceaccount.com
```

**`.env.secrets` (secret, gitignored — mirrors GCP Secret Manager)**
```bash
META_APP_ID=your_meta_app_id
META_APP_SECRET=your_meta_app_secret
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_KEY_HERE\n-----END PRIVATE KEY-----\n"
META_BUSINESS_ID=your_business_manager_id
META_SYSTEM_USER_ID=your_system_user_id
META_SYSTEM_USER_TOKEN=your_system_user_token   # Required for catalog & messaging ops
```

**Secret priority chain (SecretManagerService):**
1. `.env.secrets` file (highest — GCP Secret Manager equivalent)
2. `process.env` fallback (from `.env`)

### 1.3 HTTP Headers

All Meta Graph API calls use:
```typescript
headers: {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${accessToken}`,
}
```

### 1.4 Token Selection Rules

```
META_SYSTEM_USER_TOKEN  ← always preferred for catalog ops & product messages
                           (requires catalog_management scope)
integration.metaData.accessToken  ← fallback, WABA token from OAuth sign-up flow
                                     lacks catalog_management → Meta Error 10
```

From `webhook.service.ts`:
```typescript
const systemToken = this.secrets.get('META_SYSTEM_USER_TOKEN') ?? accessToken;
```

### 1.5 DefensiveLoggerService — Instrumented HTTP Wrapper

All internal Meta API calls use `DefensiveLoggerService.request<T>()`:

```typescript
// src/common/logger/defensive-logger.service.ts

async request<T>(config: AxiosRequestConfig): Promise<T> {
  const response: AxiosResponse<T> = await axios({ ...config });
  return response.data;
  // On error — throws TokenExpiredError for Meta error codes 190 or 100
  //           (unless 100 is a field access error)
}

// Meta-specific error escalation:
// errorCode === 190           → always TokenExpiredError
// errorCode === 100 AND NOT nonexisting-field message → TokenExpiredError
```

### 1.6 Endpoint Reference

| Operation | Method | URL |
|---|---|---|
| Send message | POST | `v25.0/{phoneNumberId}/messages` |
| Link catalog to WABA | POST | `v25.0/{phoneNumberId}/whatsapp_commerce_settings` |
| List owned catalogs | GET | `v19.0/{ownerBusinessId}/owned_product_catalogs` |
| List client catalogs (fallback) | GET | `v19.0/{ownerBusinessId}/client_product_catalogs` |
| Create catalog | POST | `v19.0/{ownerBusinessId}/owned_product_catalogs` |
| Rename catalog | POST | `v19.0/{catalogId}` |
| Delete catalog | DELETE | `v19.0/{catalogId}` |
| List products | GET | `v19.0/{catalogId}/products` |
| Create product | POST | `v19.0/{catalogId}/products` |
| Update product | POST | `v19.0/{productItemId}` |
| Delete product | DELETE | `v19.0/{productItemId}` |
| Commerce account fallback | GET | `v25.0/{ownerBusinessId}/commerce_accounts` |
| Debug token | GET | `v25.0/debug_token` |

---

## 2. Webhook Management (Inbound)

### 2.1 GET Verification (Hub Challenge)

**Source:** `src/webhook/webhook.controller.ts`

```typescript
@Get()
verify(
  @Query('hub.mode') mode: string,
  @Query('hub.verify_token') token: string,
  @Query('hub.challenge') challenge: string,
  @Res() res: Response,
) {
  const verifyToken = this.config.get<string>('META_WEBHOOK_VERIFY_TOKEN');

  if (mode === 'subscribe' && token === verifyToken) {
    res.status(200).send(challenge);   // ← respond with the raw challenge string
  } else {
    res.status(403).send('Forbidden');
  }
}
```

**Conditions for success:**
- `hub.mode === 'subscribe'`
- `hub.verify_token === META_WEBHOOK_VERIFY_TOKEN` (from env)
- Response: HTTP 200 with the raw `hub.challenge` string as body

### 2.2 POST Handler — ACK-First Pattern

**Source:** `src/webhook/webhook.controller.ts`

```typescript
@Post()
receive(@Body() body: unknown, @Res() res: Response): void {
  // 1. Acknowledge Meta immediately (MUST respond within 5 seconds)
  res.status(200).json({ received: true });

  // 2. Dispatch async processing outside current event-loop tick
  setImmediate(() => {
    this.webhookService.processInbound(body).catch((err) => { /* log */ });
  });
}
```

### 2.3 Payload Type Definitions

**Source:** `src/webhook/webhook.service.ts`

```typescript
interface MetaWebhookPayload {
  object?: string;
  entry?: MetaEntry[];
}

interface MetaEntry {
  id: string;
  changes?: MetaChange[];
}

interface MetaChange {
  field?: string;  // "messages" | "account_update" | "catalog_item_update"
  value?: MetaChangeValue | AccountUpdateValue;
}

interface MetaChangeValue {
  messaging_product?: string;
  metadata?: {
    display_phone_number?: string;
    phone_number_id?: string;
  };
  messages?: MetaInboundMessage[];
  statuses?: unknown[]; // delivery receipts — not processed
}

interface MetaInboundMessage {
  from: string;
  id: string;
  timestamp: string; // Unix seconds as string — convert: new Date(parseInt(ts, 10) * 1000)
  type: string;      // "text" | "order" | "interactive"
  text?: { body: string };
  order?: {
    catalog_id: string;
    text?: string;
    product_items: Array<{
      product_retailer_id: string;
      quantity: number;
      item_price: number;
      currency: string;
    }>;
  };
  interactive?: {
    type: 'button_reply' | 'list_reply' | string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
}

// account_update system event
interface AccountUpdateValue {
  event?: string;               // "PARTNER_APP_INSTALLED"
  waba_info?: { waba_id?: string };
  owner_business_id?: string;
}

// catalog_item_update system event (Meta policy engine)
interface CatalogItemUpdateValue {
  item_id?: string;
  retailer_id?: string;
  review_status?: string;       // "REJECTED" triggers SUSPENDED_BY_POLICY
  rejection_reasons?: string[];
}
```

### 2.4 Exact JSON Path Extraction

```typescript
// From parseMetaPayload() in webhook.service.ts

// ── Iterate entries and changes ────────────────────────────────────────────
for (const entry of payload.entry ?? []) {
  for (const change of entry.changes ?? []) {
    if (change.field !== 'messages') continue;  // skip non-message events

    const value = change.value as MetaChangeValue;
    const phoneNumberId = value?.metadata?.phone_number_id ?? '';

    for (const msg of value?.messages ?? []) {
      // Timestamp: Unix seconds string → ISO
      const ts = new Date(parseInt(msg.timestamp, 10) * 1000).toISOString();

      // ── TEXT ──────────────────────────────────────────────────────────
      if (msg.type === 'text' && msg.text?.body) {
        // text body: msg.text.body
      }

      // ── NATIVE CART (ORDER) ───────────────────────────────────────────
      else if (msg.type === 'order' && msg.order?.product_items?.length) {
        // Map to internal type:
        const orderItems = msg.order.product_items.map((item) => ({
          productRetailerId: item.product_retailer_id,  // snake → camel
          quantity:          item.quantity,
          itemPrice:         item.item_price,            // snake → camel
          currency:          item.currency,
        }));
      }

      // ── BUTTON REPLY (INTERACTIVE) ────────────────────────────────────
      else if (
        msg.type === 'interactive' &&
        msg.interactive?.type === 'button_reply' &&
        msg.interactive.button_reply?.id
      ) {
        // Button ID: msg.interactive.button_reply.id (e.g. "CMD_VIEW_MPM")
        // Button title: msg.interactive.button_reply.title
      }
    }
  }
}
```

### 2.5 Special System Event Routing

Events on `change.field` other than `'messages'`:

| field | event value | Action |
|---|---|---|
| `account_update` | `PARTNER_APP_INSTALLED` | Write PENDING_TOKEN stub to Firestore |
| `catalog_item_update` | `review_status === 'REJECTED'` | Mark product `SUSPENDED_BY_POLICY` in Firestore |

### 2.6 Inbound Message Persistence (Idempotency)

```typescript
// Firestore transaction ensures exactly-once write per wamid
// Path: integrations/{businessId}/messages/{wamid}

await db.runTransaction(async (tx) => {
  const existing = await tx.get(msgRef);
  if (existing.exists) {
    isDuplicate = true;
    return; // no-op — duplicate delivery blocked
  }
  tx.set(msgRef, storedMsg);
});

// Integration lookup: find by phoneNumberId
db.collection('integrations')
  .where('metaData.phoneNumberId', '==', msg.phoneNumberId)
  .limit(1)
  .get();
```

---

## 3. Catalog & Inventory Management

### 3.1 Catalog Linking / Unlinking

**Link a catalog to a WhatsApp phone number:**
```typescript
// POST https://graph.facebook.com/v25.0/{phoneNumberId}/whatsapp_commerce_settings
// Body:
{
  catalog_id: "12345678901234",
  is_catalog_visible: true,
  is_cart_enabled: true
}
```

**Unlink a catalog:**
```typescript
// POST https://graph.facebook.com/v25.0/{phoneNumberId}/whatsapp_commerce_settings
// Body:
{
  is_catalog_visible: false,
  catalog_id: ""
}
```

**After link success:** client must call `GET /catalog?businessId=X` to trigger Firestore sync.

### 3.2 Owner Business ID Resolution (3-tier)

```typescript
// Priority order (from catalog-manager.service.ts):
// 1. META_BUSINESS_ID from .env.secrets — explicit override
// 2. integration.metaData.ownerBusinessId — Firestore cache (written on first discovery)
// 3. Live discovery from Meta:
GET https://graph.facebook.com/v19.0/{wabaId}?fields=owner_business_info
// Response: { owner_business_info: { id: "...", name: "..." } }
// → cache result in Firestore: metaData.ownerBusinessId
```

### 3.3 Product List Fields

```typescript
// GET https://graph.facebook.com/v19.0/{catalogId}/products
// Required fields parameter:
fields: 'id,name,retailer_id,description,availability,condition,price,currency,url,image_url,review_status'
```

### 3.4 Product Creation Payload (v19.0)

```typescript
// POST https://graph.facebook.com/v19.0/{catalogId}/products
{
  retailer_id:  "SKU-001",
  item_group_id: "GROUP-001",   // WRITE-side name (READ returns retailer_product_group_id)
  name:         "Test Product",
  description:  "Product description",
  availability: "in stock",     // Required exact value for cart eligibility
  condition:    "new",
  price:        "10000",        // Meta format: minor units as string (10000 = $100.00)
  currency:     "USD",
  image_url:    "https://example.com/image.jpg",
  url:          "https://example.com/product"
}
```

**CRITICAL naming asymmetry for variants/groups:**
- **READ** (GET response): `retailer_product_group_id`
- **WRITE** (POST body): `item_group_id`

### 3.5 Catalog Creation — Error 100 Fallback

```typescript
// If POST /{ownerBusinessId}/owned_product_catalogs returns Error 100:
// 1. GET https://graph.facebook.com/v25.0/{ownerBusinessId}/commerce_accounts
// 2. If found → POST https://graph.facebook.com/v25.0/{commerceAccountId}/catalogs
//              Body: { name, vertical: "commerce" }
// 3. If not found → 400 Bad Request with remediation instructions
```

### 3.6 Optimistic Write Pattern (Firestore + Meta)

```typescript
// 1. Write Firestore with status='SYNCING_WITH_META'
await firebase.set(productRef, { ...product, status: 'SYNCING_WITH_META' });

// 2. POST to Meta Graph API
const metaResponse = await defLogger.request({ method: 'POST', url: ..., data: ... });

// 3a. Success → update status to ACTIVE
await firebase.update(productRef, {
  status: 'ACTIVE',
  metaProductId: metaResponse.id,
  updatedAt: now,
});

// 3b. Failure → update status to FAILED_INTEGRATION
await firebase.update(productRef, {
  status: 'FAILED_INTEGRATION',
  failureReason: err.message,
  updatedAt: now,
});
```

### 3.7 Product Sync to Firestore (catalog array)

The catalog service stores the raw Meta product list on the integration root document:

```typescript
// integrations/{businessId}.catalog structure after sync:
{
  catalogId: "12345678901234",
  catalogName: "My Catalog",
  fetchedAt: "2026-03-11T12:00:00.000Z",
  products: [
    // Raw Meta API response items — snake_case field names preserved:
    {
      id: "9876543210",
      retailer_id: "SKU-001",         // ← used by CartService.lookupProductByRetailerId()
      name: "Playera azul",
      availability: "in stock",       // ← checked by CartService (must === "in stock")
      price: "Bs.100.00",             // ← string, parsed by CartService.parseProductPrice()
      currency: "BOB",
      image_url: "https://...",       // ← note snake_case, not camelCase
      // ...other Meta fields
    }
  ]
}
```

---

## 4. The Cart Engine

### 4.1 Cart Types

**Source:** `src/cart/cart.types.ts`

```typescript
export interface CartItem {
  productRetailerId: string;  // Meta product SKU — unique key within the cart
  name: string;
  quantity: number;
  unitPrice: number;          // Major units directly (e.g. 100, not 10000)
  currency: string;
  imageUrl?: string;          // Omitted when absent (not stored as undefined)
}

export type CartStatus =
  | 'active'
  | 'archived'
  | 'checked_out'
  | 'pending_payment';

// Firestore document: integrations/{businessId}/carts/{cartId}
// Invariant: at most ONE document per (businessId, contactWaId) may have status='active'
export interface Cart {
  id: string;
  businessId: string;
  contactWaId: string;
  status: CartStatus;
  items: CartItem[];
  createdAt: string;   // ISO 8601
  updatedAt: string;   // ISO 8601
  archivedAt?: string;
  note?: string;       // Customer note from native WhatsApp cart
  sourceWaMessageId?: string;
}

export interface IncomingOrderItem {
  productRetailerId: string;
  quantity: number;
  itemPrice: number;   // From Meta webhook: item_price (already major units)
  currency: string;
}
```

### 4.2 Intent Detection — Regex Patterns

**Source:** `src/cart/cart.service.ts` — compiled once at class load time.

```typescript
// CLEAR intent
private static readonly REGEX_CLEAR =
  /^(borrar|vaciar|limpiar)\s+carrito$/i;
// Matches: "borrar carrito", "vaciar carrito", "limpiar carrito"

// ADD intent — group 2 captures the retailer_id (may contain spaces)
private static readonly REGEX_ADD =
  /^(agregar|sumar|m[aá]s|a[ñn]adir)\s+(.+)$/i;
// Matches: "agregar morado1", "sumar TS 001", "más SKU-001", "añadir item"

// SUBTRACT intent — group 2 captures the retailer_id
private static readonly REGEX_SUBTRACT =
  /^(quitar|restar|eliminar|menos)\s+(.+)$/i;
// Matches: "quitar morado1", "restar SKU-001", "eliminar item", "menos sku"

// VIEW intent — full-string match
private static readonly REGEX_VIEW =
  /^(ver\s+carrito|mi\s+carrito|resumen|total)$/i;
// Matches: "ver carrito", "mi carrito", "resumen", "total"
```

**Pre-processing applied before regex test:**
```typescript
// Normalise: trim + collapse internal whitespace
const normalized = text.trim().replace(/\s+/g, ' ');
// "Agregar   morado1 " → "Agregar morado1"  (matches REGEX_ADD)
```

**Evaluation order:** CLEAR → VIEW → ADD → SUBTRACT → `return null` (not a cart command)

```typescript
// retailerId extraction from regex match:
const addMatch = normalized.match(CartService.REGEX_ADD);
const retailerId = addMatch[2].trim();  // Group 2 = everything after the keyword
```

### 4.3 Firestore Queries

**Active cart lookup:**
```typescript
// Requires Firestore index: carts(contactWaId ASC, status ASC)
await this.cartsRef(businessId)
  .where('contactWaId', '==', contactWaId)
  .where('status', '==', 'active')
  .limit(1)
  .get();
// returns snap.docs[0].data() as Cart, or null if snap.empty
```

**Integration lookup by phone number:**
```typescript
await db.collection('integrations')
  .where('metaData.phoneNumberId', '==', phoneNumberId)
  .limit(1)
  .get();
```

**catalog_products batch lookup (for native order sync):**
```typescript
// Single Firestore query for all retailer IDs — no N round-trips
// Firestore `in` clause limit: 30 items max (matches Meta's native cart limit)
await integrationRef
  .collection('catalog_products')
  .where('retailerId', 'in', retailerIds)  // Array of strings
  .get();
// Returns Map<retailerId, { name: string; imageUrl?: string }>
```

**Product lookup from embedded catalog array (for text commands):**
```typescript
// Read integrations/{businessId} root document
const docSnap = await integrationRef.get();
const docData = docSnap.data() as Record<string, unknown>;
const products = (docData['catalog'] as Record<string, unknown>)?.['products'];

// Find by retailer_id (snake_case — raw Meta field name)
const found = (products as RawProduct[]).find(
  (p) => p['retailer_id'] === retailerId,
);

// Availability guard — MUST === 'in stock'
if (found['availability'] !== 'in stock') return null;
```

**Auto-reply rules query:**
```typescript
await docRef
  .collection('auto_replies')
  .where('isActive', '==', true)
  .get();
```

### 4.4 ADD Command — Item Array Manipulation

**Source:** `src/cart/cart.service.ts` — `handleAddCommand()`

```typescript
const items = [...cart.items];

// Search by exact productRetailerId match
const existingIdx = items.findIndex(
  (i) => i.productRetailerId === retailerId,
);

if (existingIdx >= 0) {
  // Item already in cart — increment quantity by 1
  items[existingIdx] = {
    ...items[existingIdx],
    quantity: items[existingIdx].quantity + 1,
  };
} else {
  // New item — build CartItem from catalog data
  items.push({
    productRetailerId: retailerId,
    name:      product.name,
    quantity:  1,
    unitPrice: product.unitPrice,
    currency:  product.currency,
    // imageUrl omitted entirely when absent (not undefined)
    ...(product.imageUrl ? { imageUrl: product.imageUrl } : {}),
  });
}

await this.firebase.update(ref, { items, updatedAt: now });
```

### 4.5 SUBTRACT Command — Item Array Manipulation

**Source:** `src/cart/cart.service.ts` — `handleSubtractCommand()`

```typescript
const items = [...cart.items];

// Find by exact productRetailerId match
const idx = items.findIndex((i) => i.productRetailerId === retailerId);

if (idx < 0) {
  return { /* error: item not in cart */ };
}

const existing = items[idx];

if (existing.quantity > 1) {
  // Decrement — item stays with one less unit
  items[idx] = { ...existing, quantity: existing.quantity - 1 };
  responseText = `➖ *${existing.name}*: quedan ${items[idx].quantity} en tu carrito.`;
} else {
  // Last unit — remove item entirely
  items.splice(idx, 1);
  responseText = `🗑️ *${existing.name}* eliminado del carrito.`;
}

await this.firebase.update(ref, { items, updatedAt: now });
```

### 4.6 Native Order Sync (type='order' webhook)

**Source:** `src/cart/cart.service.ts` — `syncFromNativeOrder()`

The incoming `product_items` array **replaces** cart contents exactly:

```typescript
// Step 1: Batch-fetch enrichment data (single Firestore query)
const retailerIds = orderItems.map((i) => i.productRetailerId);
const catalogMap = await this.lookupCatalogProducts(integrationRef, retailerIds);
// Returns Map<retailerId, { name: string; imageUrl?: string }>

// Step 2: Build enriched CartItems synchronously
const enrichedItems: CartItem[] = orderItems.map((item) => {
  const local = catalogMap.get(item.productRetailerId);
  return {
    productRetailerId: item.productRetailerId,
    name:      local?.name ?? item.productRetailerId,  // fallback to retailerId
    quantity:  item.quantity,
    unitPrice: item.itemPrice,  // from Meta webhook — no math applied
    currency:  item.currency,
    ...(local?.imageUrl ? { imageUrl: local.imageUrl } : {}),
  };
});

// Step 3: Persist — REPLACES existing items
await this.firebase.update(ref, { items: enrichedItems, updatedAt: now });
```

### 4.7 Price Parsing — `parseProductPrice()`

**Source:** `src/cart/cart.service.ts`

```typescript
private static parseProductPrice(raw: unknown): number {
  // Numeric (already in major units) — return as-is
  if (typeof raw === 'number') {
    return raw > 0 ? raw : 0;
  }

  if (typeof raw !== 'string' || !raw.trim()) return 0;

  // Extract first decimal number from string
  // CORRECT: "Bs.100.00" → match "100.00" → parseFloat → 100
  // WRONG pattern: .replace(/[^0-9.]/g, '') → ".100.00" → 0.1  ← DO NOT USE
  const match = raw.trim().match(/\d+(?:\.\d+)?/);
  if (!match) return 0;

  const parsed = parseFloat(match[0]);
  return isNaN(parsed) || parsed <= 0 ? 0 : parsed;
}

// Examples:
// "Bs.100.00" → 100
// "Bs.68.00"  → 68
// "Bs.9.50"   → 9.5
// 100         → 100
// ""          → 0
// NO division by 100 is ever applied
```

### 4.8 Price Formatting — `formatCartPrice()`

```typescript
private static formatCartPrice(amount: number, currency: string): string {
  if (amount === 0) return '—';
  try {
    return new Intl.NumberFormat('es-BO', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,   // "Bs. 100" (no trailing zeros)
      maximumFractionDigits: 2,   // "Bs. 68,50" (shows cents when non-zero)
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;  // fallback for unknown currency codes
  }
}
// BOB example: 100 → "Bs. 100", 68.5 → "Bs. 68,50"
```

### 4.9 Cart Lifecycle Operations

**Archive (soft delete) + create new empty cart:**
```typescript
// Old cart: status → 'archived', archivedAt → now
await firebase.update(existingRef, {
  status: 'archived',
  archivedAt: now,
  updatedAt: now,
});
// New empty cart created immediately
await firebase.set(newRef, { id, businessId, contactWaId, status: 'active', items: [], createdAt, updatedAt });
```

**Lock cart for payment:**
```typescript
// status → 'pending_payment' (prevents further modification)
await firebase.update(cartRef, { status: 'pending_payment', updatedAt: now });
// NOT archived yet — transitions to 'checked_out' on payment confirmation
//                  or back to 'active' if cancelled
```

---

## 5. Outbound Messaging Payloads

### 5.1 Plain Text Message

**Source:** `src/common/utils/send-whatsapp-text.ts`

```typescript
// Endpoint: POST https://graph.facebook.com/v25.0/{phoneNumberId}/messages
const payload = {
  messaging_product: 'whatsapp',
  recipient_type:    'individual',
  to:                recipientWaId,     // Customer's wa_id (phone number)
  type:              'text',
  text:              { body: text },    // WhatsApp markdown (*bold*, _italic_) supported
};

// Headers:
{
  'Content-Type': 'application/json',
  Authorization:  `Bearer ${accessToken}`,
}

// Response shape:
interface MetaMessagesResponse {
  messaging_product: string;
  contacts: { input: string; wa_id: string }[];
  messages: { id: string }[];  // messages[0].id = wamid
}
// Extract wamid: data.messages?.[0]?.id
```

### 5.2 Interactive Button Message (VIEW CART response)

**Source:** `src/cart/cart.service.ts` — `handleViewCommand()`

Full payload POSTed to Meta:
```json
{
  "messaging_product": "whatsapp",
  "recipient_type":    "individual",
  "to":                "<contactWaId>",
  "type":              "interactive",
  "interactive": {
    "type": "button",
    "body": {
      "text": "🛒 Tienes 3 artículos en tu carrito por un total de Bs. 500. ¿Qué deseas hacer?"
    },
    "action": {
      "buttons": [
        {
          "type": "reply",
          "reply": {
            "id":    "CMD_VIEW_MPM",
            "title": "Ver ítems"
          }
        },
        {
          "type": "reply",
          "reply": {
            "id":    "CMD_PAY_CART",
            "title": "Pagar"
          }
        }
      ]
    }
  }
}
```

**Meta Cloud API constraints for button messages:**
- Max 3 reply buttons per message
- `button.reply.title`: max **20 characters**
- `button.reply.id`: max **256 characters** — returned verbatim in next `button_reply` webhook

**Body text construction:**
```typescript
const bodyText = hasPrices
  ? `🛒 Tienes ${itemCount} artículo${plural} en tu carrito por un total de ` +
    `${CartService.formatCartPrice(totalAmount, currency)}. ¿Qué deseas hacer?`
  : `🛒 Tienes ${itemCount} artículo${plural} en tu carrito. ¿Qué deseas hacer?`;
```

### 5.3 Product List Message — Cart View (CMD_VIEW_MPM)

**Source:** `src/webhook/webhook.service.ts` — `sendProductListFromCart()`

Triggered when customer taps "Ver ítems" button:

```json
{
  "messaging_product": "whatsapp",
  "recipient_type":    "individual",
  "to":                "<contactWaId>",
  "type":              "interactive",
  "interactive": {
    "type": "product_list",
    "header": { "type": "text", "text": "Tu Carrito" },
    "body":   { "text": "Aquí tienes los ítems que agregaste:" },
    "action": {
      "catalog_id": "<catalogId>",
      "sections": [
        {
          "title": "Artículos en tu carrito",
          "product_items": [
            { "product_retailer_id": "sku-001" },
            { "product_retailer_id": "sku-002" }
          ]
        }
      ]
    }
  }
}
```

**Construction:**
```typescript
const productItems = cart.items.map((item) => ({
  product_retailer_id: item.productRetailerId,
}));

const interactivePayload = {
  type:   'product_list',
  header: { type: 'text', text: 'Tu Carrito' },
  body:   { text: 'Aquí tienes los ítems que agregaste:' },
  action: {
    catalog_id: catalog.catalogId,
    sections: [{ title: 'Artículos en tu carrito', product_items: productItems }],
  },
};
```

### 5.4 Multi-Product Messages — Auto-Reply (Keyword Trigger)

**Source:** `src/webhook/webhook.service.ts` — `evaluateAndRespond()`

Meta requires different `interactive.type` based on product count:

**Single product (`type: "product"`):**
```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "<contactWaId>",
  "type": "interactive",
  "interactive": {
    "type": "product",
    "body":   { "text": "Aquí tienes el producto solicitado:" },
    "footer": { "text": "Migo UIT" },
    "action": {
      "catalog_id":          "<catalogId>",
      "product_retailer_id": "sku-001"
    }
  }
}
```

**Multiple products (`type: "product_list"`, requires header):**
```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "<contactWaId>",
  "type": "interactive",
  "interactive": {
    "type": "product_list",
    "header": { "type": "text", "text": "Nuestro Catálogo" },
    "body":   { "text": "Aquí tienes los productos solicitados:" },
    "footer": { "text": "Migo UIT" },
    "action": {
      "catalog_id": "<catalogId>",
      "sections": [
        {
          "title": "<collectionTitle from auto_reply rule>",
          "product_items": [
            { "product_retailer_id": "sku-001" },
            { "product_retailer_id": "sku-002" }
          ]
        }
      ]
    }
  }
}
```

**Selection logic:**
```typescript
const isSingle = retailerIds.length === 1;
const interactive = isSingle
  ? { type: 'product', action: { catalog_id, product_retailer_id: retailerIds[0] }, ... }
  : { type: 'product_list', header: ..., action: { catalog_id, sections: [...] }, ... };
```

**Retailer ID filtering before send (auto-reply deduplication):**
```typescript
// Chunk retailerIds by 30 (Firestore `in` limit)
// Query catalog_products subcollection for status
// Filter: keep only status === 'ACTIVE' (skip orphans/rejected)
// Deduplicate by itemGroupId: only FIRST representative per product family
//   key = p.itemGroupId ?? p.retailerId
// Result: unique array of retailerIds safe to send to Meta
```

### 5.5 Text Receipt (Checkout — CMD_PAY_CART)

**Source:** `src/webhook/webhook.service.ts` — `sendPaymentReceiptFromCart()`

> Replaces native `order_details` interactive which is geo-restricted (Error #131009 for BOB/Bolivianos).

**Sent as plain `type: 'text'` message.**

**Construction:**
```typescript
const SEPARATOR  = '━'.repeat(19);  // "━━━━━━━━━━━━━━━━━━━"
const PAYMENT_URL =
  `https://wa.me/59169775986?text=Hola,%20quiero%20pagar%20el%20pedido%20` +
  encodeURIComponent(cart.id);

// Price formatter — major units, no division:
const fmt = (amount: number): string =>
  `Bs. ${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;

const lines: string[] = [
  `🧾 *DETALLE DE TU PEDIDO* 🧾`,
  SEPARATOR,
  '',
];

for (const item of cart.items) {
  const subtotal = item.unitPrice * item.quantity;
  grandTotal += subtotal;

  lines.push(`🛍️ *${item.quantity}x ${item.name}*`);
  lines.push(`↳ Precio: ${fmt(item.unitPrice)}`);
  lines.push(`↳ Subtotal: ${fmt(subtotal)}`);
  lines.push('');
}

lines.push(SEPARATOR);
lines.push(`💳 *TOTAL A PAGAR: ${fmt(grandTotal)}*`);
lines.push('');
lines.push('Para completar tu compra, por favor ingresa al siguiente enlace:');
lines.push(`👉 ${PAYMENT_URL}`);

const receiptText = lines.join('\n');
```

**Rendered output example:**
```
🧾 *DETALLE DE TU PEDIDO* 🧾
━━━━━━━━━━━━━━━━━━━

🛍️ *2x Playera azul*
↳ Precio: Bs. 100
↳ Subtotal: Bs. 200

🛍️ *1x Camiseta roja*
↳ Precio: Bs. 68
↳ Subtotal: Bs. 68

━━━━━━━━━━━━━━━━━━━
💳 *TOTAL A PAGAR: Bs. 268*

Para completar tu compra, por favor ingresa al siguiente enlace:
👉 https://wa.me/59169775986?text=Hola,%20quiero%20pagar%20el%20pedido%20<cartId>
```

**Post-send — cart locked:**
```typescript
await this.firebase.update(cartRef, {
  status:    'pending_payment',
  updatedAt: new Date().toISOString(),
});
```

---

## 6. Firestore Database Schema

### 6.1 Top-Level Collection: `integrations`

```
integrations/{businessId}            ← businessId is the app's internal ID (e.g. "demo-business-001")
```

**Root document fields:**
```jsonc
{
  "businessId": "demo-business-001",
  "status": "ACTIVE",                // "ACTIVE" | "PENDING_TOKEN"
  "metaData": {
    "accessToken":      "EAABs...",   // WABA user token from OAuth sign-up
    "wabaId":           "1234567890",
    "phoneNumberId":    "9876543210",  // Used to route inbound webhooks
    "ownerBusinessId":  "1111111111"   // Cached from Meta API discovery
  },
  "catalog": {
    "catalogId":   "2222222222",
    "catalogName": "My Catalog",
    "fetchedAt":   "2026-03-11T12:00:00.000Z",
    "products": [
      // Raw Meta API response — snake_case field names preserved:
      {
        "id":           "9876543210",
        "retailer_id":  "SKU-001",      // ← CartService uses this field name
        "name":         "Playera azul",
        "availability": "in stock",     // ← must === "in stock" for cart eligibility
        "price":        "Bs.100.00",    // ← string, parsed by parseProductPrice()
        "currency":     "BOB",
        "image_url":    "https://...", // ← snake_case
        "description":  "...",
        "condition":    "new",
        "url":          "https://..."
      }
    ]
  },
  "updatedAt": "2026-03-11T12:00:00.000Z"
}
```

### 6.2 Subcollection: `integrations/{businessId}/messages/{wamid}`

```jsonc
{
  "id":        "wamid.HBgLNTkx...",   // Meta's wamid — used as document ID
  "direction": "inbound",              // "inbound" | "outbound"
  "from":      "59170000001",          // wa_id of sender
  "to":        "59170000002",          // wa_id of recipient (outbound only)
  "text":      "agregar morado1",      // Message text or label (e.g. "[Auto-reply: Colección]")
  "timestamp": "2026-03-11T12:00:00.000Z"
}
```

**Notes:**
- Document ID = `wamid` (enables idempotency via Firestore transaction)
- Outbound messages written after successful Meta API call
- `[Button: Ver ítems]` format used for interactive button replies
- `[Auto-reply: <collectionTitle>]` format for auto-reply outbound records
- `[Catálogo: N producto(s)]` format for MPM cart view outbound records

### 6.3 Subcollection: `integrations/{businessId}/carts/{cartId}`

```jsonc
{
  "id":           "abc123def456",       // Firestore auto-generated ID
  "businessId":   "demo-business-001",
  "contactWaId":  "59170000001",        // Customer's WhatsApp number
  "status":       "active",            // "active" | "archived" | "pending_payment" | "checked_out"
  "items": [
    {
      "productRetailerId": "SKU-001",   // Meta retailer_id — unique key within cart
      "name":              "Playera azul",
      "quantity":          2,
      "unitPrice":         100,         // Major units (not minor); no division applied
      "currency":          "BOB",
      "imageUrl":          "https://..." // Optional — omitted entirely when absent
    }
  ],
  "createdAt":   "2026-03-11T12:00:00.000Z",
  "updatedAt":   "2026-03-11T12:00:00.000Z",
  "archivedAt":  "2026-03-11T13:00:00.000Z",  // Set when status → 'archived'
  "note":        "Por favor entregar en la tarde",  // From native WhatsApp cart
  "sourceWaMessageId": "wamid.HBgL..."             // wamid that triggered last update
}
```

**Invariant:** At most ONE document per `(businessId, contactWaId)` may have `status='active'`.

**Status transitions:**
```
active → archived        (borrar carrito command, or archiveActiveCart())
active → pending_payment (CMD_PAY_CART: sendPaymentReceiptFromCart())
active → checked_out     (payment confirmed — manual/future)
pending_payment → active (payment cancelled — manual/future)
```

### 6.4 Subcollection: `integrations/{businessId}/catalog_products/{productDocId}`

```jsonc
{
  "retailerId":    "SKU-001",             // Merchant SKU — used for CartService lookups
  "itemGroupId":   "GROUP-001",           // Optional — used for MPM deduplication
  "name":          "Playera azul",
  "imageUrl":      "https://...",
  "catalogId":     "2222222222",
  "metaProductId": "9876543210",          // Meta's product item ID (set after sync)
  "status":        "ACTIVE",             // See status enum below
  "createdAt":     "2026-03-11T12:00:00.000Z",
  "updatedAt":     "2026-03-11T12:00:00.000Z"
}
// status enum: "SYNCING_WITH_META" | "ACTIVE" | "FAILED_INTEGRATION" | "SUSPENDED_BY_POLICY" | "DELETED_IN_META"
```

### 6.5 Subcollection: `.../catalog_products/{productDocId}/variants/{variantDocId}`

```jsonc
{
  "retailerId":    "SKU-001-BLUE-M",
  "name":          "Playera azul M",
  "itemGroupId":   "GROUP-001",           // Links to parent product
  "catalogId":     "2222222222",
  "metaVariantId": "1234567890",          // Set after successful Meta sync
  "attributeKey":  "color",
  "attributeValue":"blue",
  "price":         100,                   // Number (major units)
  "currency":      "BOB",
  "availability":  "in stock",
  "status":        "ACTIVE",
  "failureReason": null,
  "rejectionReasons": [],                 // Populated by catalog_item_update webhook
  "createdAt":     "2026-03-11T12:00:00.000Z",
  "updatedAt":     "2026-03-11T12:00:00.000Z"
}
// status enum: "SYNCING_WITH_META" | "ACTIVE" | "FAILED_INTEGRATION" | "ARCHIVED" | "SUSPENDED_BY_POLICY"
```

### 6.6 Subcollection: `integrations/{businessId}/auto_replies/{ruleId}`

```jsonc
{
  "isActive":        true,
  "matchType":       "exact",           // "exact" | "partial"
  "triggerWord":     "camisetas",       // Compared case-insensitively after .toLowerCase().trim()
  "retailerIds":     ["SKU-001", "SKU-002"],  // Products to show (pre-filtered by resolveActiveUniqueRetailerIds)
  "collectionTitle": "Colección Verano", // Used as MPM section title
  "createdAt":       "2026-03-11T12:00:00.000Z",
  "updatedAt":       "2026-03-11T12:00:00.000Z"
}
```

**Keyword matching logic:**
```typescript
const normalizedText = msg.text.toLowerCase().trim();
const keyword = rule.triggerWord.toLowerCase().trim();

rule.matchType === 'exact'
  ? normalizedText === keyword
  : normalizedText.includes(keyword)
```

### 6.7 Required Firestore Indexes

```
Collection: carts
  Fields: contactWaId ASC, status ASC
  Reason: getActiveCart() query uses both fields with .limit(1)

collectionGroup: catalog_products
  Fields: retailerId ASC
  Reason: catalog_item_update webhook uses collectionGroup query

collectionGroup: variants
  Fields: retailerId ASC
  Reason: catalog_item_update webhook uses collectionGroup query
```

---

## Appendix A: Message Flow Diagram

```
Inbound POST /webhook
  │
  ├─ change.field === 'account_update' && event === 'PARTNER_APP_INSTALLED'
  │    └─ Write PENDING_TOKEN stub to integrations/{businessId}
  │
  ├─ change.field === 'catalog_item_update' && review_status === 'REJECTED'
  │    └─ Mark SUSPENDED_BY_POLICY in catalog_products + variants (collectionGroup)
  │
  └─ change.field === 'messages'
       │
       ├─ msg.type === 'interactive' (button_reply)
       │    ├─ buttonReplyId === 'CMD_VIEW_MPM' → sendProductListFromCart()
       │    └─ buttonReplyId === 'CMD_PAY_CART' → sendPaymentReceiptFromCart() + lock cart
       │
       ├─ msg.type === 'order' (native WhatsApp Cart)
       │    └─ cartService.syncFromNativeOrder() → REPLACE cart items
       │
       ├─ msg.type === 'text' — CartService.tryHandleTextCommand()
       │    ├─ CLEAR  → archiveActiveCart() → plain text reply
       │    ├─ VIEW   → (empty) plain text | (populated) interactive buttons
       │    ├─ ADD    → lookup catalog.products → increment/append → persist
       │    └─ SUBTRACT → lookup cart items → decrement/splice → persist
       │
       └─ No cart match → Keyword rule engine
            └─ auto_replies.where(isActive==true) → match triggerWord
                 └─ resolveActiveUniqueRetailerIds() → product | product_list
```

## Appendix B: Token Scope Requirements

| Operation | Required Token | Required Scope |
|---|---|---|
| Send text/interactive messages | `META_SYSTEM_USER_TOKEN` or WABA token | `whatsapp_business_messaging` |
| Send product / product_list messages | `META_SYSTEM_USER_TOKEN` preferred | `catalog_management` |
| Catalog CRUD (create/update/delete) | `META_SYSTEM_USER_TOKEN` | `catalog_management`, `business_management` |
| WABA discovery (`/owner_business_info`) | WABA token or System User | `whatsapp_business_management` |
| Commerce settings link/unlink | `META_SYSTEM_USER_TOKEN` | `whatsapp_business_management` |

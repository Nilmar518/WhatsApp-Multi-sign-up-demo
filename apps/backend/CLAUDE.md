# Backend — CLAUDE.md

## Current Feature: Catalog CRUD (Objective 1)

The `catalog-manager` NestJS module adds full Create/Read/Update/Delete support for
Meta product catalogs and their items. It is **completely isolated** from the existing
Multi Sign-Up and messaging logic.

---

## Catalog CRUD — Implementation Status

| Layer       | Status | Notes                                                      |
|-------------|--------|------------------------------------------------------------|
| DTOs        | ✅ Done | `create-catalog.dto.ts`, `create-product.dto.ts`, `update-product.dto.ts` |
| Service     | ✅ Done | `catalog-manager.service.ts` — all Meta Graph API calls    |
| Controller  | ✅ Done | `catalog-manager.controller.ts` — 7 REST endpoints         |
| Module      | ✅ Done | Registered in `app.module.ts`                              |
| Auth/Guard  | 🔜 TODO | Endpoints currently unguarded (fine for demo)              |

---

## New API Endpoints

Base path: `/catalog-manager`

```
GET    /catalog-manager/catalogs?businessId=X           List all catalogs
POST   /catalog-manager/catalogs                        Create a catalog
DELETE /catalog-manager/catalogs/:catalogId?businessId=X Delete a catalog

GET    /catalog-manager/catalogs/:id/products?businessId=X  List products
POST   /catalog-manager/catalogs/:id/products               Create a product
PUT    /catalog-manager/catalogs/:id/products/:itemId        Update a product
DELETE /catalog-manager/catalogs/:id/products/:itemId?businessId=X Delete a product
```

> **Note:** `:catalogId` and `:itemId` are Meta Graph API IDs (numeric strings),
> not Firestore document IDs.

---

## How to Run

```bash
# From the repo root
pnpm --filter @migo-uit/backend dev

# Or from apps/backend
pnpm dev
```

Backend runs on **http://localhost:3001**.

---

## How to Test the Catalog Manager Endpoints

All commands below require an active integration for `demo-business-001`
(i.e., Firestore `integrations/demo-business-001` must have `metaData.accessToken`).

### List catalogs
```bash
curl "http://localhost:3001/catalog-manager/catalogs?businessId=demo-business-001"
```

### Create a catalog
```bash
curl -X POST http://localhost:3001/catalog-manager/catalogs \
  -H "Content-Type: application/json" \
  -d '{"businessId": "demo-business-001", "name": "Test Catalog"}'
```

### Delete a catalog
```bash
curl -X DELETE \
  "http://localhost:3001/catalog-manager/catalogs/{CATALOG_ID}?businessId=demo-business-001"
```

### List products in a catalog
```bash
curl "http://localhost:3001/catalog-manager/catalogs/{CATALOG_ID}/products?businessId=demo-business-001"
```

### Create a product
```bash
curl -X POST \
  "http://localhost:3001/catalog-manager/catalogs/{CATALOG_ID}/products" \
  -H "Content-Type: application/json" \
  -d '{
    "businessId": "demo-business-001",
    "retailerId": "SKU-001",
    "name": "Test Product",
    "description": "A test product description",
    "availability": "in stock",
    "condition": "new",
    "price": 1000,
    "currency": "USD",
    "imageUrl": "https://example.com/image.jpg",
    "url": "https://example.com/product"
  }'
```

### Update a product
```bash
curl -X PUT \
  "http://localhost:3001/catalog-manager/catalogs/{CATALOG_ID}/products/{PRODUCT_ITEM_ID}" \
  -H "Content-Type: application/json" \
  -d '{"businessId": "demo-business-001", "price": 2000, "availability": "out of stock"}'
```

### Delete a product
```bash
curl -X DELETE \
  "http://localhost:3001/catalog-manager/catalogs/{CATALOG_ID}/products/{PRODUCT_ITEM_ID}?businessId=demo-business-001"
```

---

## Architecture — Isolation from Multi Sign-Up Logic

**Key decisions to preserve the existing demo:**

1. **Separate module:** `CatalogManagerModule` at `src/catalog-manager/` — entirely new code.
   The existing `CatalogModule` (`src/catalog/`) is **untouched**.

2. **Separate controller prefix:** `/catalog-manager` vs existing `/catalog`.
   No route conflicts, no shared state.

3. **Same infrastructure, no new globals:** Injects `DefensiveLoggerService`,
   `FirebaseService`, and `SecretManagerService` — all already global modules.
   No new providers registered globally.

4. **Token source:** Access token is read from the Firestore integration document
   (`integrations/{businessId}.metaData.accessToken`), same as the existing read-only
   endpoint. No new token flows introduced.

5. **`META_BUSINESS_ID` requirement:** Catalog creation and listing use
   `META_BUSINESS_ID` from `.env.secrets`. Product operations use the per-catalog ID
   passed in the URL. If `META_BUSINESS_ID` is absent, a clear `400 Bad Request` is
   returned — the rest of the app is unaffected.

---

## Token Permissions Note

The Meta access token stored during the Multi Sign-Up flow grants WhatsApp Business
permissions. Catalog **management** (create/delete catalogs, create/update/delete products)
may require additional Commerce Manager permissions on the token. If you receive
`(#200) Permissions error` from Meta, the token needs to be upgraded with:

- `catalog_management` permission on the Facebook App
- The Business Manager admin must approve the integration

For a production deployment, use a System User token with explicit catalog scope.

---

## Required Secrets (for Catalog CRUD)

| Secret            | Source          | Purpose                                  |
|-------------------|-----------------|------------------------------------------|
| `META_BUSINESS_ID`| `.env.secrets`  | Parent Business ID for catalog creation  |

All other secrets (access tokens) are read from Firestore at request time.

---

## Pre-flight Permission Check

Runs automatically before every `pnpm dev` via the `predev` npm hook.

```bash
# Manual run
pnpm --filter @migo-uit/backend check-permissions
# or
node apps/backend/src/scripts/check-permissions.js
```

Script: `src/scripts/check-permissions.js` (plain Node.js, no compilation needed)

**What it checks:**
- Builds an App Access Token from `META_APP_ID|META_APP_SECRET`
- Calls `GET /v25.0/debug_token` to validate the token
- Verifies the following scopes are present:
  - `business_management` ← required
  - `catalog_management` ← required
  - `whatsapp_business_management` ← required
  - `ads_management` ← desired (warning only)
- If `META_SYSTEM_USER_TOKEN` is in `.env.secrets`, also validates user-level scopes

**Exit codes:**
- `0` — all required scopes present (or check inconclusive due to network/missing creds)
- `1` — definitive API response shows a required scope is missing

**Action if scopes are missing:**
1. Open Meta Business Suite → Commerce Manager and accept Terms of Service
2. In Meta App Dashboard → App Review, request the missing permissions
3. Re-run `pnpm dev`

---

## Commerce Account Fallback

When `POST /{ownerBusinessId}/product_catalogs` returns **Error 100** (Unsupported
post request / missing Commerce Terms), the service automatically:

1. Calls `GET /v25.0/{ownerBusinessId}/commerce_accounts`
2. If a Commerce Account is found, retries via `POST /v25.0/{commerceAccountId}/catalogs`
3. If no Commerce Account is found, returns a clear `400 Bad Request` with remediation steps

---

## WABA ↔ Catalog Linking

After selecting or creating a catalog, it must be linked to the WhatsApp phone number
to enable Shopping features. The link endpoint calls:

```
POST https://graph.facebook.com/v25.0/{phoneNumberId}/whatsapp_commerce_settings
Body: { catalog_id: "...", is_catalog_visible: true }
```

API: `POST /catalog-manager/catalogs/:catalogId/link?businessId=X`

After a successful link call, the **client must trigger** `GET /catalog?businessId=X`
(the existing read-only sync endpoint) to update Firestore and propagate to the UI
via `onSnapshot`.

---

## Health Check Endpoint

`GET /catalog-manager/health?businessId=X`

Returns `CatalogHealthResult` used by the System Health indicator in the dashboard:
- `appIsValid` — whether the stored access token is valid
- `missingScopes` — which required scopes are absent
- `hasCommerceAccount` — whether a Commerce Account exists (needed for catalog creation)
- `commerceAccountId` — first Commerce Account ID
- `ownerBusinessId` — resolved Business Manager ID
- `warnings` — advisory messages

---

## Roadmap

```
Objective 1 — Catalog CRUD (CURRENT)
  ✅ List / Create / Delete catalogs (Meta Graph API)
  ✅ List / Create / Update / Delete products (Meta Graph API)
  ✅ Admin UI at /catalog-manager (isolated from Multi Sign-Up demo)

Objective 2 — Messaging Automation (NEXT)
  🔜 Message templates with product catalog attachments
  🔜 Automated product recommendations via WhatsApp interactive messages
  🔜 Order status webhooks (inbound message parsing for catalog interactions)
  🔜 Firestore: persist catalog selections per conversation thread
```

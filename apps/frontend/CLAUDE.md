# Frontend — CLAUDE.md

## Current Feature: Catalog Manager UI (Objective 1)

A completely isolated admin interface at `/catalog-manager` for managing WhatsApp
product catalogs and their items. Built as a separate view — **zero changes** to the
existing Multi Sign-Up demo components.

---

## Catalog CRUD — Implementation Status

| Layer           | Status | Notes                                                       |
|-----------------|--------|-------------------------------------------------------------|
| API client      | ✅ Done | `src/catalog-manager/api/catalogManagerApi.ts`              |
| Catalog list UI | ✅ Done | `src/catalog-manager/components/CatalogList.tsx`            |
| Product list UI | ✅ Done | `src/catalog-manager/components/ProductList.tsx`            |
| Main orchestrator | ✅ Done | `src/catalog-manager/CatalogManagerApp.tsx`               |
| Routing         | ✅ Done | `main.tsx` — pathname-based, no external router dependency  |
| Error handling  | ✅ Done | Per-operation error display, retry buttons                  |

---

## New File Structure

```
src/
├── catalog-manager/                   ← NEW (isolated feature)
│   ├── api/
│   │   └── catalogManagerApi.ts       ← fetch wrappers for /api/catalog-manager/*
│   ├── components/
│   │   ├── CatalogList.tsx            ← list + create + delete catalogs
│   │   └── ProductList.tsx            ← list + create + edit + delete products
│   └── CatalogManagerApp.tsx          ← main orchestrator, business selector
├── App.tsx                            ← UNTOUCHED (Multi Sign-Up demo)
└── main.tsx                           ← 3-line patch: pathname routing
```

---

## How to Run

```bash
# From the repo root (runs frontend + backend in parallel)
pnpm dev

# Frontend only (from apps/frontend)
pnpm dev
```

Frontend runs on **https://localhost:5173** (self-signed SSL for Meta compliance).

---

## Accessing the Catalog Manager

Navigate to: **https://localhost:5173/catalog-manager**

The main Multi Sign-Up demo is still at: **https://localhost:5173/**

> The `← Main App` link in the Catalog Manager header navigates back to `/`.

---

## Routing Architecture

No external router library was added. Routing is a **3-line pathname check** in
`main.tsx`:

```tsx
const isCatalogManager = window.location.pathname.startsWith('/catalog-manager');
// Render CatalogManagerApp if true, App otherwise
```

Vite's default SPA mode serves `index.html` for all unknown paths, so navigating
directly to `/catalog-manager` works without server-side configuration.

**Why no React Router?**
- Avoids adding a dependency
- The Multi Sign-Up demo has no router; keeping it consistent reduces cognitive overhead
- The catalog manager is a standalone tool, not a nested view

---

## Architecture — Isolation from Multi Sign-Up Logic

**Key decisions to preserve the existing demo:**

1. **Separate directory:** All new code lives under `src/catalog-manager/`. No file
   in that directory imports from the existing app components.

2. **No shared state:** `CatalogManagerApp` manages its own React state independently.
   It does not read from `useIntegrationStatus`, `useMessages`, or any existing hooks.

3. **Direct fetch API:** `catalogManagerApi.ts` uses `window.fetch` directly with the
   `/api/catalog-manager/*` proxy. It does not import `firebase` or existing hooks.

4. **Minimal `main.tsx` change:** Only 3 additive lines were added — an import and a
   conditional render. The existing `<App />` render path is completely unchanged.

5. **No shared CSS:** Uses Tailwind classes consistent with the rest of the project.
   No new global styles.

---

## Business Context

The business selector in the Catalog Manager header mirrors the existing `BusinessToggle`
component behaviour — it switches between `demo-business-001` and `demo-business-002`.
Each business must have an **active integration** (status `ACTIVE` in Firestore) for the
catalog API calls to succeed.

---

## API Endpoints Used

All calls go through the Vite proxy `/api → http://localhost:3001`:

```
GET    /api/catalog-manager/catalogs?businessId=X
POST   /api/catalog-manager/catalogs
DELETE /api/catalog-manager/catalogs/:catalogId?businessId=X

GET    /api/catalog-manager/catalogs/:id/products?businessId=X
POST   /api/catalog-manager/catalogs/:id/products
PUT    /api/catalog-manager/catalogs/:id/products/:itemId
DELETE /api/catalog-manager/catalogs/:id/products/:itemId?businessId=X
```

---

## Price Handling

Meta stores prices in **minor currency units** (e.g. `1000` = $10.00 USD).

- **Form input:** User enters a decimal (`10.00`) → multiplied by 100 before sending
- **Display:** Raw price string from Meta (`"1000"`) → formatted via `Intl.NumberFormat`
- **Helper:** `formatPrice(price, currency)` in `catalogManagerApi.ts`

---

## Roadmap

```
Objective 1 — Catalog CRUD UI (CURRENT)
  ✅ Catalog list view (load, create, delete)
  ✅ Product list view (load, create, edit, delete)
  ✅ Business selector (demo-business-001 / 002)
  ✅ Error states and loading skeletons
  ✅ Isolated route at /catalog-manager

Objective 2 — Messaging Automation UI (NEXT)
  🔜 Compose messages with catalog product attachments
  🔜 Automated campaign builder (trigger: catalog event → WhatsApp message)
  🔜 Conversation view with catalog context panel
  🔜 Order/cart status integration with webhook events
```

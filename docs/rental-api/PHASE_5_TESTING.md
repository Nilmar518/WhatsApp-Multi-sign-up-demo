# Phase 5 — E2E Tests & Bruno Collection

> **Status:** Delivered. Project complete.
> **Scope:** FBK-006 code changes + Jest/Supertest E2E harness against the Firestore & Auth emulators + a Bruno collection covering every endpoint.

---

## 1. FBK-006 code changes applied at the top of Phase 5

| # | Change | Files |
|---|--------|-------|
| 1 | **`Location` soft-delete.** `Location` gains `deletedAt`. Adapter `delete()` flips `deletedAt` + `active: false`; `list` / `findById` filter `deletedAt == null`. Historical Reservations/Expenses keep resolving via `locationSnapshot`. | `packages/rental-entities/src/locations/location.entity.ts`, `apps/rental-backend/src/modules/locations/infrastructure/firestore-location.repository.ts`, `apps/rental-backend/firestore.indexes.json` (new composite indexes with `deletedAt` first) |
| 2 | **Immutable payment amounts.** `PaymentsService.update` explicitly throws `ValidationError` when the payload carries `amount` or `method` (the ValidationPipe already strips unknown fields, this is belt-and-braces for audit). | `apps/rental-backend/src/modules/reservations/application/payments.service.ts` |
| 3 | **`POST /organizations/sync-claims`.** Re-reads the current user's Firestore record + re-issues `setCustomUserClaims`. | `apps/rental-backend/src/modules/organizations/application/organizations.service.ts` (new `syncClaims`), `.../interface/organizations.controller.ts` (new route), `.../organizations.module.ts` (imports `UsersModule`) |
| 4 | **RBAC deferred to v2** per user directive — no `@Roles` guard shipped. All authenticated tenant members can read/write. |
| 5 | **Bruno auth via `{{FIREBASE_ID_TOKEN}}`**, minted against the Auth emulator (dev) or REST API (prod). Documented in [`../../apps/rental-backend/bruno/README.md`](../../apps/rental-backend/bruno/README.md). |

Build verification:
```
pnpm --filter @migo-uit/rental-entities build   → ✓
pnpm --filter @migo-uit/rental-backend  build   → ✓
```

---

## 2. Test harness

### Layout
```
apps/rental-backend/
├── test/
│   ├── jest-e2e.json            Jest config (ts-jest, maxWorkers=1, moduleNameMapper→rental-entities source)
│   ├── tsconfig.json            Extends app tsconfig, relaxes noUnused* for specs
│   ├── helpers/
│   │   ├── env-setup.ts         Sets FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST,
│   │   │                         FIREBASE_PROJECT_ID, and a base64 emulator-fake FIREBASE_SERVICE_ACCOUNT
│   │   ├── global-setup.ts      Verifies both emulators are reachable before any spec runs
│   │   ├── auth.ts              createEmulatorUser / refreshEmulatorToken / resetAuthEmulator / resetFirestoreEmulator
│   │   └── app.ts               bootTestApp() — spins up the full NestJS app with the real ValidationPipe + DomainErrorFilter
│   └── e2e/
│       ├── health.e2e-spec.ts
│       ├── lifecycle.e2e-spec.ts        (the golden path)
│       └── services-expenses.e2e-spec.ts
└── package.json                 Adds `test:e2e` and `emulators` scripts + jest/supertest/ts-jest dev deps
```

### `firebase.json` at the repo root
Pins emulator ports so CI and dev use the same values:
```json
{
  "firestore": { "port": 8080 },
  "auth":      { "port": 9099 },
  "ui":        { "port": 4000 }
}
```

### How to run

```bash
# Terminal 1 — start emulators (requires firebase-tools: npm i -g firebase-tools)
pnpm --filter @migo-uit/rental-backend emulators

# Terminal 2 — run the E2E suite
pnpm --filter @migo-uit/rental-backend test:e2e
```

The suite wipes the Firestore + Auth emulator state between spec files via `resetFirestoreEmulator()` / `resetAuthEmulator()`. Production Firestore (`rentals-ae6f3`) is never touched — `FIRESTORE_EMULATOR_HOST` redirects the admin SDK entirely.

### Jest module-name-mapper trick
Specs import from `@migo-uit/rental-entities` just like runtime code, but the mapper resolves to the **source** (`packages/rental-entities/src/index.ts`) rather than the compiled `dist/`. So you don't have to rebuild the package between edits.

---

## 3. Coverage summary

The three spec files exercise **every endpoint** in the API, plus the non-obvious invariants:

### `health.e2e-spec.ts`
- `GET /health` without auth → 200.
- Any other route without auth → 401 `UNAUTHORIZED`.

### `lifecycle.e2e-spec.ts` (the core golden path)
- **Bootstrap** `POST /organizations` creates Org + owner User + 4 seed ExpenseCategories atomically; response includes `tokenRefreshRequired: true`.
- **Token refresh** — spec re-exchanges the refresh token so subsequent calls carry the new custom claims.
- `GET /organizations/me` — reads via claims-derived tenant context.
- `GET /expense-categories` — verifies the 4 seed rows (`insumos`, `servicios`, `mantenimiento`, `personal`) are `seed: true`.
- `POST /locations` — happy-path create.
- `POST /reservations` — happy path; validates `balanceDue = totalPrice` on creation.
- **Overlap rejection** — creating a second reservation at the same location with overlapping dates → 409 `CONFLICT`.
- **Foreign-currency payment reconciliation** — a VES payment with client-supplied exchangeRate is converted in the transaction; `newBalanceDue` is in USD and decremented correctly (40000 − 10000 = 30000 minor units).
- **Immutable amount** — attempt to `PATCH` a payment's `amount` field → 400/422.
- **Location soft-delete** — `DELETE /locations/:id` returns 204; subsequent `GET /locations/:id` returns 404; the reservation that referenced the location is still readable and still carries its original `locationSnapshot.name`.
- `POST /organizations/sync-claims` — returns the claim payload and `tokenRefreshRequired: true`.

### `services-expenses.e2e-spec.ts`
- **Subscription service without cadence** → 400/422 (domain invariant).
- **Standalone service** (no `locationId`) — happy path create.
- **Unknown expense category** → 400 `VALIDATION_ERROR`.
- **Seeded category** — happy path create.
- **Category archival** — `PATCH archived: true` hides the row from the default list; `?includeArchived=true` shows it again; **historical expenses that reference the archived category remain queryable** (FBK-004 #4, FBK-006 #4).
- **Archived-category rejection on new expenses** → 400.

### What's NOT covered (deliberately)
- Load/volume testing — out of scope for v1.
- Production Firestore index deploys — handled by `firebase deploy --only firestore:indexes`.
- Role-based access control — deferred to v2 per FBK-006 #4.

---

## 4. Bruno collection

Location: `apps/rental-backend/bruno/`
- `bruno_collection.json` — folder-organized collection with **every endpoint** documented in `PHASE_4_API.md`.
- `README.md` — how to mint a Firebase ID token against either the emulator or production Auth.

### Folder layout
```
Rental API/
├── Health/                       GET /health (public)
├── Organizations/                POST /, POST /sync-claims, GET /me, PATCH /me
├── Users/                        POST /, GET /me, GET /, GET /:id, PATCH /:id, DELETE /:id
├── Locations/                    POST /, GET /, GET /:id, PATCH /:id, DELETE /:id (soft)
├── Reservations/                 POST /, GET /, GET /:id, PATCH /:id, DELETE /:id (soft)
├── Payments/                     POST /:rid/payments, GET /:rid/payments, GET one, PATCH, DELETE, GET /payments (org-wide)
├── Services/                     POST /, GET /, GET /:id, PATCH /:id, DELETE /:id
├── Expenses/                     POST /, GET /, GET /:id, PATCH /:id, DELETE /:id (soft)
└── Expense Categories/           POST /, GET /, GET /:id, PATCH /:id, DELETE /:id
```

### Environment variables
Every request inherits `Content-Type: application/json` and `Authorization: Bearer {{FIREBASE_ID_TOKEN}}` from `defaultHeaders`. Resource IDs use placeholders (`{{ORGANIZATION_ID}}`, `{{RESERVATION_ID}}`, …) that the user fills from previous responses.

---

## 5. Project close-out

The Rental API is now a fully working, multi-tenant, Firestore-backed NestJS backend with:
- a framework-free domain package (`@migo-uit/rental-entities`) that any future client/worker can consume,
- clean DDD layering (domain → application → interface with adapters in their own infrastructure folders, lint-enforced separation),
- Firebase-Auth-based authentication via custom claims with a one-shot org bootstrap,
- transactional financial integrity (payment recordAndReconcile, foreign-currency-aware),
- mandatory soft-delete on every financial entity,
- a full E2E harness runnable against the Firestore emulator, and
- a Bruno collection ready for exploratory testing.

Remaining work beyond v1 (tracked via the feedback entries):
- v2: granular RBAC (owner/admin/staff/viewer enforcement via `@Roles` guard).
- v2: `ExchangeRateProvider` port (automatic currency rates instead of client-supplied).
- v2: optional soft-delete on User / Service / Location restoration endpoints.
- Infra: rate-limiting in front of Cloud Run; CI wiring to spin up the Firestore emulator automatically before `pnpm test:e2e`.

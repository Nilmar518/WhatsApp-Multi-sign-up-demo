# Phase 3 — Infrastructure & Agnostic Repositories

> **Status:** Delivered, awaiting feedback.
> **Scope:** `apps/rental-backend` scaffold + Firestore-backed concrete adapters for every repository port defined in Phase 2. No application services, no controllers, no endpoints — those are Phase 4.

---

## 1. What was built

### 1.1 Domain package deltas (applying FBK-004)
Before touching the backend, the Phase 2 `@migo-uit/rental-entities` package was updated to honor the FBK-004 decisions:
- `users/user.entity.ts` — removed `passwordHash`; added required `externalAuthId` (Firebase UID). `SafeUser` is gone because no secret remains.
- `users/user.dto.ts` — deleted `LoginDto`; `CreateUserDto` now requires `externalAuthId` and drops `password` entirely.
- `users/user.repository.ts` — `findByEmailWithSecret` → `findByExternalAuthId(orgId, externalAuthId)` plus a `findByEmail` helper.
- `reservations/reservation.entity.ts`, `reservations/payment.entity.ts`, `expenses/expense.entity.ts` — each gained `deletedAt: Date | null` for mandatory soft-delete on financial records.
- `reservations/payment.repository.ts` — `recordAndReconcile` accepts an optional `balanceDeduction: MoneyShape` so Phase 4 application services can override the auto-computed conversion when the client pre-computes it.

Both packages build clean under strict TS:
```
pnpm --filter @migo-uit/rental-entities build   # ✓
pnpm --filter @migo-uit/rental-backend build    # ✓
```

### 1.2 Backend scaffold (`apps/rental-backend/`)

```
apps/rental-backend/
├── package.json                     @migo-uit/rental-backend — NestJS 10 + firebase-admin + nestjs-cls
├── tsconfig.json / tsconfig.build.json
├── nest-cli.json
├── .eslintrc.js                     no-restricted-imports guards module boundaries + firebase-admin leakage
├── .env.example                     variable names only; never the real service-account
├── firestore.indexes.json           composite indexes for every access pattern in Phase 1
└── src/
    ├── main.ts                      ValidationPipe (whitelist+forbid), DomainErrorFilter, CORS, port 3002
    ├── app.module.ts                Global ConfigModule + ClsModule + shared modules + 6 bounded contexts
    ├── shared/
    │   ├── config/                  (placeholder; @nestjs/config used directly)
    │   ├── secrets/
    │   │   ├── secret-manager.service.ts     decodes base64 FIREBASE_SERVICE_ACCOUNT; cached in memory
    │   │   └── secret-manager.module.ts      @Global()
    │   ├── firebase/
    │   │   ├── firebase-admin.service.ts     admin.initializeApp on onModuleInit, exposes auth()/app()
    │   │   └── firebase-admin.module.ts      @Global()
    │   ├── firestore/
    │   │   ├── firestore.service.ts          safe-write wrapper (set/update/delete/tx/batch + logging)
    │   │   ├── firestore.module.ts           @Global()
    │   │   ├── firestore.paths.ts            single source of truth for every document path
    │   │   └── firestore.mappers.ts          toDate / requireDate / compactUndefined helpers
    │   ├── tenant/
    │   │   ├── tenant-context.service.ts     CLS accessor for organizationId + userId + roles
    │   │   └── tenant.module.ts              @Global()
    │   ├── errors/
    │   │   └── domain-error.filter.ts        Maps DomainError subtypes to HTTP status codes
    │   ├── pagination/
    │   │   └── cursor.codec.ts               base64url opaque cursor (docId + orderBy + value)
    │   └── money/
    │       └── money.utils.ts                cloneMoney / subtractSameCurrency / convertToReservationCurrency
    └── modules/
        ├── organizations/
        │   ├── organizations.tokens.ts
        │   ├── organizations.module.ts
        │   └── infrastructure/firestore-organization.repository.ts
        ├── users/
        │   ├── users.tokens.ts
        │   ├── users.module.ts
        │   └── infrastructure/firestore-user.repository.ts
        ├── locations/
        │   └── ...
        ├── reservations/
        │   ├── reservations.tokens.ts        RESERVATION_REPOSITORY + PAYMENT_REPOSITORY
        │   ├── reservations.module.ts
        │   └── infrastructure/
        │       ├── firestore-reservation.repository.ts
        │       └── firestore-payment.repository.ts   ← the transactional one
        ├── services/
        │   └── ...
        └── expenses/
            ├── expenses.tokens.ts            EXPENSE_REPOSITORY + EXPENSE_CATEGORY_REPOSITORY
            ├── expenses.module.ts
            └── infrastructure/
                ├── firestore-expense.repository.ts
                └── firestore-expense-category.repository.ts
```

### 1.3 Dependency direction (lint-enforced)

`.eslintrc.js` declares:
- A module under `src/modules/{x}/...` **may not** import from `src/modules/{y}/...`. The only cross-module contract is a repository port token re-exported from the target module's `module.ts` (e.g. `LocationsModule` exports `LOCATION_REPOSITORY`). Adapters never talk to each other.
- Only `src/shared/firebase`, `src/shared/firestore`, and files under any `modules/*/infrastructure/` may import from `firebase-admin`. Application/interface layers (Phase 4) cannot.

---

## 2. Key design decisions

### 2.1 Credentials
`SecretManagerService.getServiceAccount()` reads `FIREBASE_SERVICE_ACCOUNT` (base64), decodes to JSON, and extracts `project_id` / `client_email` / `private_key` with `\n` normalization. The cached object is consumed once by `FirebaseAdminService.onModuleInit` which calls `admin.initializeApp({ credential: admin.credential.cert(...) })`. **The raw key never appears in logs** and never touches disk. In production this swap-in to GCP Secret Manager is a one-function change, matching the existing `apps/backend` pattern.

### 2.2 Firestore safe-write wrapper
`FirestoreService.set/update/delete/runTransaction/batch` mirrors the existing `apps/backend` `FirebaseService`: every write is wrapped with a try/catch that logs `code` + `path` before re-throwing. Repositories never call `ref.set()` / `ref.update()` directly — they always go through the wrapper, giving us one chokepoint for observability.

### 2.3 Document path layout (`shared/firestore/firestore.paths.ts`)
All paths are generated by a single object:
```
organizations/{orgId}
organizations/{orgId}/users/{userId}
organizations/{orgId}/locations/{locationId}
organizations/{orgId}/reservations/{reservationId}
organizations/{orgId}/reservations/{reservationId}/payments/{paymentId}
organizations/{orgId}/services/{serviceId}
organizations/{orgId}/expenses/{expenseId}
organizations/{orgId}/expense_categories/{id}
```
Typos that could target another tenant are now a compile error.

### 2.4 Branded IDs at the boundary
Adapters use `asOrganizationId(str)` / `asUserId(str)` etc. when hydrating domain entities from raw Firestore strings. The Application layer (Phase 4) receives fully-typed IDs — passing a `UserId` where an `OrganizationId` is expected will not compile.

### 2.5 Pagination — opaque cursor (FBK-004 #1)
`encodeCursor({ docId, orderBy, value })` returns a base64url string. `decodeCursor` validates shape before use. Each repo orders by a well-known field (`createdAt`, `startDate`, `incurredAt`, `receivedAt`) and calls `query.startAfter(cursor.value)`. Clients never see Firestore doc IDs or timestamp internals.

### 2.6 Soft-delete on financial records (FBK-004 #3)
- `Reservation`, `Payment`, `Expense` have `deletedAt: Date | null`.
- Adapter `delete(...)` sets `deletedAt = serverTimestamp()` instead of removing the doc.
- Adapter `findById`, `list`, and `listForOrganization` always filter `where('deletedAt', '==', null)`.
- `Organization`, `User`, `Location`, `Service`, `ExpenseCategory` — hard-delete remains (they are non-financial / tenant-config). We can add soft-delete there too if Phase 4 reveals the need.

### 2.7 `ExpenseCategory` archival (FBK-004 #4)
- `archived: boolean` on the category doc.
- `list(orgId, includeArchived=false)` hides archived categories from pickers.
- Historical `Expense.category` strings are **never rewritten**. Archiving a category only affects new documents — the past is immutable (audit requirement).
- `seedDefaults(orgId)` materialized the legacy set (`Insumos / Servicios / Mantenimiento / Personal`) with `seed: true`. Phase 4 will call this from the org-creation use case.

### 2.8 Foreign-currency reconciliation (FBK-004 #5) — the one truly interesting adapter
`FirestorePaymentRepository.recordAndReconcile(orgId, reservationId, input, balanceDeduction?)` runs inside `firestore.runTransaction`:
1. Reads the Reservation snapshot. Throws `NotFoundError` if missing or soft-deleted.
2. Computes the deduction in **`reservation.totalPrice.currency`**:
   - If the caller provided `balanceDeduction`, use it verbatim (escape hatch for pre-computed cases).
   - Otherwise, `convertToReservationCurrency(payment.amount, reservation.currencyCode)`:
     - Same currency → `exchangeRate = 1`, `baseAmount = amount`.
     - Different currency → `converted = round(payment.amount * payment.exchangeRate)` in the reservation's currency.
3. Invariants: deduction currency must match reservation `balanceDue.currencyCode`; amount must be positive and ≤ `balanceDue.amount`. Violations throw `ConflictError` and abort the transaction.
4. Writes the payment document and updates `reservation.balanceDue = subtractSameCurrency(current, deduction)` in a single atomic commit.
5. Returns `{ payment, newBalanceDue }` to callers.

Consequences:
- `balanceDue` is **always** in `totalPrice.currency` — no implicit conversion ever on the reservation side.
- No race — concurrent payments cannot overdraw the balance because the transaction reads `balanceDue` inside the critical section.
- Application services (Phase 4) only need to validate the *business* decision to accept the payment (status machine, permissions, etc.); accounting arithmetic is fully handled here.

### 2.9 Reservation overlap check
Firestore cannot range-query on two different fields, so `hasOverlappingActive(...)` does:
```
reservations.where(deletedAt=null).where(locationId=X).where(startDate < endDate)
  → in-memory filter: status ∈ active && otherEnd > startDate && id != excluded
```
Acceptable for v1 volumes. If a single location regularly has thousands of reservations we can pre-compute a `lastActiveEndAt` field per location, but not before we need it.

### 2.10 Firestore indexes
`apps/rental-backend/firestore.indexes.json` declares composite indexes for:
- All Phase 1 access patterns (reservations by status/location/source/guest, expenses by location/category, services by active+mode, collection-group payments by org+status+receivedAt).
- Every index that includes a soft-deletable collection has `deletedAt` as the first ordered field so `where('deletedAt','==',null)` works with the other filters.

Will be deployed with `firebase deploy --only firestore:indexes` once Phase 4 has endpoints to exercise them.

---

## 3. Compile & install verification

```
pnpm install                                      # 5 workspace projects ✓
pnpm --filter @migo-uit/rental-entities build     # TS strict ✓
pnpm --filter @migo-uit/rental-backend build      # nest build ✓
```

All types line up. Adapters satisfy the ports from `@migo-uit/rental-entities` exactly — any drift would have surfaced as a compile error.

---

## 4. Not in scope (reserved for Phase 4)

- `FirebaseAuthGuard` and `@CurrentTenant()` decorator (wired but not bound globally).
- Controllers for any module.
- Application use-case classes (`CreateReservationUseCase`, `RecordPaymentUseCase`, etc.).
- Org-creation orchestration (Organization + owner User + seeded ExpenseCategories in one transaction).
- HTTP-level validation beyond the ValidationPipe already configured in `main.ts`.
- Any interaction with `apps/backend` (the existing WhatsApp app stays untouched).
- E2E tests + Bruno collection — Phase 5.

---

## 5. Questions for you before Phase 4

1. **Rate-limiting / abuse protection** — should Phase 4 ship with per-org rate limits, or defer to Cloud Run/API Gateway? Nothing tenant-facing is exposed yet, so this is your call.
2. **Error shape on the wire** — currently the `DomainErrorFilter` emits `{ "error": { "code": "NOT_FOUND", "message": "..." } }`. Confirm this contract before Phase 5 freezes it into the Bruno collection.
3. **Org-creation bootstrap** — when a new `Organization` is created via the API, should Phase 4 orchestrate: (a) create Organization, (b) create the owning User record pointing at their Firebase UID, (c) call `seedDefaults` on expense categories — all in one transaction? Proposing yes.
4. **Auth custom claims** — Phase 4 will read `organizationId` from the Firebase ID token's custom claims. Confirm this is the source of truth (i.e. the app sets custom claims when a user joins an org), rather than looking up `user.organizationId` from Firestore per request.
5. **Backend port** — `3002` by default (existing WhatsApp backend is on `3001`). OK?

Once you answer (or overrule), Phase 4 will add the application/interface layers and we'll have runnable endpoints.

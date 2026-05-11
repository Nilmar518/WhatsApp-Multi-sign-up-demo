# Phase 2 — DTOs & Schemas (`@migo-uit/rental-entities`)

> **Status:** Delivered, awaiting feedback.
> **Scope:** All code in this phase lives in `packages/rental-entities/` and has **zero runtime dependency** on `@nestjs/*` or `firebase-admin`. The backend app (Phase 3+) consumes it as `@migo-uit/rental-entities`.

---

## 1. What was built

### 1.1 Package scaffolding
- `packages/rental-entities/package.json` — name `@migo-uit/rental-entities`, private, TS 5.3, deps: `class-validator`, `class-transformer`, `reflect-metadata`.
- `tsconfig.json` + `tsconfig.build.json` — strict TS, decorators + metadata enabled, no emit-on-error.
- Workspace wired in `pnpm-workspace.yaml` (added `'packages/*'`).
- `README.md` — usage blurb.

### 1.2 Source tree

```
src/
├── shared/
│   ├── ids.ts              # Branded ID types + asXxxId() helpers
│   ├── money.ts            # Money VO + MoneyInput DTO
│   ├── address.ts          # Address VO (ISO-3166-1 alpha-2 country)
│   ├── pagination.ts       # PageRequest DTO + PageResult<T>
│   ├── errors.ts           # DomainError hierarchy (NotFound, Conflict, etc.)
│   ├── tenant.ts           # TenantContext type (for CLS injection later)
│   ├── timestamps.ts       # Timestamped mixin
│   └── index.ts
├── organizations/          # Organization aggregate
├── users/                  # User aggregate (per-org, FBK-003 #2)
├── locations/              # Location aggregate
├── reservations/           # Reservation + Payment aggregates
├── services/               # Service aggregate
├── expenses/               # Expense + ExpenseCategory aggregates
└── index.ts                # barrel — everything re-exported
```

For each bounded context the pattern is identical:
1. `xxx.entity.ts` — `interface Xxx` (what the repo returns), enums as `const` tuples + derived union types, domain helpers (pure functions).
2. `xxx.dto.ts` — `class CreateXxxDto`, `UpdateXxxDto`, `XxxListQueryDto`, `XxxResponseDto`. These are `class-validator` / `class-transformer` classes — they carry validation *and* serve as TS types for controller handlers in Phase 4.
3. `xxx.repository.ts` — `interface IXxxRepository` (the port). Input/output types are domain-shaped (no raw primitives where a branded ID belongs).
4. `index.ts` — barrel.

### 1.3 Value objects

#### `Money` (`src/shared/money.ts`)
```ts
class Money {
  amount: number;         // integer, minor units (cents)
  currencyCode: string;   // ISO-4217 uppercase
  exchangeRate: number;   // client-supplied (FBK-001 #7)
  baseAmount: number;     // integer, minor units in org's base currency
}
```
- `Money.create(...)` uppercases `currencyCode` and builds a fresh instance.
- `Money.computeBaseAmount(amount, rate)` — rounded multiplication helper, used when reconciling `balanceDue` on the backend.
- `Money.subtract(other)` — currency-guarded; throws if codes disagree.
- `MoneyInput` is the validator-decorated DTO version used inside request payloads.

#### `Address` (`src/shared/address.ts`)
- Required: `street`, `city`, `country` (2-letter).
- Optional: `region`, `postalCode`.

### 1.4 Branded IDs

`src/shared/ids.ts` defines branded string types for every aggregate — `OrganizationId`, `UserId`, `LocationId`, `ReservationId`, `PaymentId`, `ServiceId`, `ExpenseId`, `ExpenseCategoryId`. Repository ports use these types directly. Coercion helpers `asXxxId(v)` are provided for the adapter layer where raw strings come from Firestore. This guarantees that Phase 3+ code cannot accidentally pass a `UserId` where an `OrganizationId` is expected.

---

## 2. Aggregate-by-aggregate summary

### 2.1 Organization (`src/organizations/`)
- `Organization { organizationId, name, baseCurrencyCode, ownerUserId, status, settings, createdAt, updatedAt }`.
- `CreateOrganizationDto` captures `ownerEmail` + `ownerDisplayName` — the backend creates the owning `User` in the same transaction (Phase 4 orchestration).
- Status machine: `active | suspended`.

### 2.2 User (`src/users/`) — per-org per FBK-003 #2
- `User { userId, organizationId, email, displayName, passwordHash|null, externalIdpSub|null, roles[], status, lastLoginAt, ... }`.
- `SafeUser = Omit<User, 'passwordHash'>` — exposed to callers; `findByEmailWithSecret` is the only port method returning the full record.
- Roles: `owner | admin | staff | viewer`.
- `LoginDto` co-lives here so the auth layer in Phase 4 can import it without crossing module boundaries.

### 2.3 Location (`src/locations/`)
- `Location { locationId, organizationId, name, type, address, timezone, active, tags, metadata, ... }`.
- `type: 'property' | 'unit' | 'room' | 'site'` — kept SaaS-generic.
- Address is embedded (`AddressShape`).
- Query filters: `active`, `type`, `tag`.

### 2.4 Reservation (`src/reservations/reservation.*`)
- `Reservation { reservationId, organizationId, locationId, locationSnapshot, guestUserId|null, guestContact|null, startDate, endDate, status, source, totalPrice, balanceDue, notes, ... }`.
- `status: pending | confirmed | cancelled | completed | no_show`.
- `source: string` — **open taxonomy per FBK-003 #1**. `ReservationSourceDefaults` (`Direct`, `Airbnb`, `Booking`, `VRBO`, `Expedia`) is a non-binding suggestion list for tenant UIs.
- `balanceDue: MoneyShape` — **persisted** (FBK-003 #5). Kept in sync transactionally by `IPaymentRepository.recordAndReconcile`.
- `locationSnapshot` is the denormalization we discussed in Phase 1.
- `canTransitionReservation(from, to)` helper rejects transitions out of terminal states.
- `hasOverlappingActive(...)` exposed on the repo port — used by the Application layer to enforce "a location cannot be double-booked for overlapping active reservations."

### 2.5 Payment (`src/reservations/payment.*`)
- Sub-collection under its parent reservation per FBK-003 #4. The port methods carry both `organizationId` **and** `reservationId` so adapters build the path `organizations/{org}/reservations/{res}/payments/{p}`.
- `organizationId` is denormalized onto each document for collection-group queries — surfaced via `listForOrganization(orgId, filters, page)`.
- **The transactional reconcile lives here:** `recordAndReconcile(orgId, resId, input) → { payment, newBalanceDue }`. The Firestore adapter (Phase 3) will implement this inside a `runTransaction` so the payment write and the reservation's `balanceDue` update land together or not at all.
- `method: cash | card | transfer | platform | other`.
- `status: pending | received | refunded | failed`.

### 2.6 Service (`src/services/`)
- `Service { serviceId, organizationId, locationId|null, name, description|null, active, billingMode, cadence|null, unitPrice, tags, ... }`.
- `billingMode: one_off | per_use | subscription`.
- `cadence: daily | weekly | monthly | yearly` — **required if and only if `billingMode === 'subscription'`**. Enforced in `CreateServiceDto` via `@ValidateIf`.
- `locationId` is nullable — standalone service allowed (org-level retainer, etc.).
- Query filter `unassigned: true` returns services where `locationId == null`.

### 2.7 Expense (`src/expenses/expense.*`)
- `Expense { expenseId, organizationId, locationId|null, reservationId|null, category, description, vendorName|null, amount, incurredAt, attachments, ... }`.
- **No recurrence fields** per FBK-003 #3. Every expense is a single-occurrence document.
- `category: string` (open) — validated against the tenant's `ExpenseCategory` lookup in the Application layer (Phase 4).

### 2.8 ExpenseCategory (`src/expenses/expense-category.*`) — new in Phase 2 per FBK-003 #6
- Tenant-configurable lookup at `organizations/{orgId}/expense_categories/{id}`.
- `ExpenseCategory { expenseCategoryId, organizationId, key, label, seed, archived, ... }`.
- `key` is lowercase alphanumeric with `-`/`_`, tenant-unique. `label` is human-facing.
- `DEFAULT_EXPENSE_CATEGORIES` constant carries the legacy seed rows: `Insumos`, `Servicios`, `Mantenimiento`, `Personal`. The repo exposes `seedDefaults(orgId)` — called once per new organization in Phase 4.

---

## 3. Decisions made in this phase

| Decision | Rationale |
|---|---|
| `class-validator` + `class-transformer` instead of Zod | Matches the existing `apps/backend` stack (FBK-001 #2). The classes have no `@nestjs/*` imports, so they stay framework-agnostic and can be reused by workers or CLI tools. |
| Separate `Entity` interface vs `Dto` class | The entity describes the **domain read model** (what adapters return). The DTO describes a **wire format** (what HTTP accepts). Decoupling them keeps the domain free of validation metadata. |
| Branded IDs | Prevents accidental id-swap bugs at compile time. Adapters in Phase 3 use `asXxxId()` to brand raw strings from Firestore. |
| `MoneyInput` on wire, `Money` inside the domain | The wire DTO accepts any `number` amounts; the `Money` class enforces invariants (non-negative, integer) via `class-validator`. Adapters pick the right one. |
| `PageRequest` + opaque `cursor: string` | Firestore pagination uses document snapshots; we represent this as an opaque string that the Firestore adapter base64-encodes. The port stays database-agnostic. |
| Port method signatures accept `organizationId: OrganizationId` as their **first** argument everywhere | It's redundant with the CLS tenant context at runtime, but explicit in the signature forces the adapter to scope the query. Belt-and-braces. |
| `IPaymentRepository.recordAndReconcile` returns the `newBalanceDue` | Application services and UI can show the updated balance without a second read. |
| No `ExchangeRateProvider` port yet | v1 accepts rates from the client (FBK-001 #7). The `Money` VO already has the fields in place, so adding a provider later is additive. |

---

## 4. How the backend will consume this (preview for Phase 3/4)

```ts
// apps/rental-backend/src/modules/reservations/interface/reservations.controller.ts
import {
  CreateReservationDto,
  ReservationResponseDto,
} from '@migo-uit/rental-entities';

// apps/rental-backend/src/modules/reservations/application/create-reservation.use-case.ts
import {
  IReservationRepository,
  ILocationRepository,
  ConflictError,
} from '@migo-uit/rental-entities';
```

The backend will provide concrete adapters (`FirestoreReservationRepository`) implementing the ports. **No module ever imports another module's internals**; the only shared contract is this package.

---

## 5. What Phase 2 does NOT include

Deliberately omitted so Phase 2 stays scoped to the domain package:
- Any NestJS module, controller, service, guard, filter, interceptor.
- Any `firebase-admin` call or Firestore adapter.
- `firestore.indexes.json` — lives in `apps/rental-backend/` (Phase 3).
- Authentication implementation (JWT strategy, hashing) — Phase 4.
- E2E tests or Bruno collection — Phase 5.

---

## 6. Verification

- `pnpm install` at the repo root should register `@migo-uit/rental-entities` in `pnpm-workspace.yaml`.
- `pnpm --filter @migo-uit/rental-entities build` compiles without errors (strict mode).
- The package exports are available via `import { ... } from '@migo-uit/rental-entities'` from any sibling workspace.

I have NOT run `pnpm install` in this phase because it's a workspace mutation and I want your green light first. Confirm and I'll run it as the opening step of Phase 3.

---

## 7. Questions / clarifications before Phase 3

1. **Cursor format** — OK with an opaque base64 string handled entirely by the Firestore adapter? Or do you want a structured cursor shape (`{ lastDocId, orderBy }`) exposed on the port?
2. **User authentication secrets** — For v1 JWT auth, do you want local password hashes (`bcrypt`) persisted on the User doc, or should we delegate to Firebase Auth from the start? The current schema supports both (`passwordHash` **or** `externalIdpSub`).
3. **Soft delete vs hard delete** — Current repo ports expose `delete(...)` which is a hard delete. Any preference for soft-delete (`deletedAt` field) on financial records (Expenses, Payments) for audit purposes?
4. **`ExpenseCategory` archival** — When a category is archived, should existing expenses keep the stale string or should the backend block archiving categories referenced by ≥1 expense? I've implemented the former (archive is UI-level); confirm.
5. **`Reservation.balanceDue` currency** — Always equal to `totalPrice.currency`? Or should payments in a different currency be converted into the reservation's currency at record time (using the client-supplied rate)? Phase 3 needs to know this to implement `recordAndReconcile`.

Once you approve, Phase 3 will implement `apps/rental-backend` scaffolding plus the Firestore-backed concrete adapters for all these ports.

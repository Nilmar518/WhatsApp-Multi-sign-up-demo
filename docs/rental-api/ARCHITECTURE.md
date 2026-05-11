# Rental API — Architecture (Phase 0, revised after pivot)

> **Status:** Revised per Phase 0 feedback. Firestore-first, stack aligned with the existing `apps/backend`.
> **Scope:** A generic, business-agnostic, multi-tenant Property Management & Financial API (SaaS-ready), built with DDD + SOLID inside the existing pnpm monorepo.

---

## 1. Decisions Locked In (from user feedback)

| # | Decision | Source |
|---|----------|--------|
| 1 | **Match the existing stack in `apps/backend`** — NestJS 10 on Express, class-validator/class-transformer, firebase-admin, @nestjs/config. | User directive |
| 2 | **Database is Google Cloud Firestore** (NoSQL) — no SQL, no Prisma, no relational ORM. | User directive |
| 3 | **Data access only via our own API** — no client→Firestore direct calls; the backend is the single gatekeeper. | User directive |
| 4 | **Credentials via base64 env var** `FIREBASE_SERVICE_ACCOUNT` containing the service-account JSON for project `rentals-ae6f3`. No hard-coding. | User directive |
| 5 | **Simple auth layer** — JWT-bearer middleware/guard with a shared secret or RS256 public key. Expandable later. | User directive |
| 6 | **Naming approved** — `apps/rental-backend` and `@migo-uit/rental-entities`. | User directive |
| 7 | **Currency rates from client** for v1 — client supplies `amount`, `currencyCode`, `exchangeRate`, `baseAmount`. No rate provider yet. | User directive |

---

## 2. Stack Derived from `apps/backend/package.json`

| Concern | Choice | Notes |
|---|---|---|
| Language / Runtime | TypeScript 5.3+, Node.js 22 LTS | Matches root `engines`. |
| Package manager | pnpm 9 workspaces | `pnpm-workspace.yaml` will be extended to include `packages/*`. |
| HTTP framework | **NestJS 10** on `@nestjs/platform-express` | Exact match with `apps/backend`. |
| Validation | **class-validator + class-transformer** (shared in `packages/rental-entities`) | Classes double as TS types and validators; decorator-based, but zero imports from `@nestjs/*`, so they stay framework-agnostic. |
| Config | **@nestjs/config** + **dotenv** | Matches existing. |
| Secrets | Thin `SecretManagerService` analog — reads base64 `FIREBASE_SERVICE_ACCOUNT` from env, decodes to JSON in memory. In prod this provider swaps to GCP Secret Manager identically to the existing emulator pattern. | Inspired by the existing SOP in `CLAUDE.md`. |
| Database | **Google Cloud Firestore** via `firebase-admin` 12 | All writes go through a `FirestoreService` wrapper (same pattern as existing `FirebaseService` — logs errors with code + path, re-throws). |
| Auth | `@nestjs/passport` + `passport-jwt` with a single `JwtAuthGuard` applied globally (`@Public()` decorator to opt out). | Minimal for v1 per user directive. Token carries `sub` (userId) and `org` (organizationId). |
| Tenant context | `nestjs-cls` (AsyncLocalStorage) | Propagates `{ organizationId, userId }` from JWT through services/repos without polluting method signatures. |
| Scheduling / queues | `@nestjs/schedule`, `@nestjs/bull` | Already in root `package.json`; ready when needed. |
| HTTP client (outbound) | **axios** | Matches existing. |
| Logging | `Logger` from `@nestjs/common` (matches existing usage) | Structured logs via console; upgrade to `nestjs-pino` later if needed. |
| Testing | **Jest + Supertest** for unit & E2E; **Firestore emulator** (`@firebase/rules-unit-testing` or `firebase-tools emulators:start`) for E2E isolation. | No test runner currently exists in `apps/backend`; Jest is the Nest default and is additive. |
| API docs | Hand-curated **Bruno** collection in `apps/rental-backend/bruno/` | Delivered per phase starting Phase 4. |
| Lint / Format | ESLint + Prettier matching the existing `apps/backend` config | Copy the baseline from the existing app. |

### Deliberate divergences from `apps/backend`

- **Credentials format:** the existing app uses three separate env vars (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`). For `rental-backend` we'll use a **single base64 `FIREBASE_SERVICE_ACCOUNT`** per the user directive. The `FirestoreService` decodes it on boot.
- **Testing:** the existing app has no tests. The rental API will add Jest + Supertest + Firestore emulator from day one (TDD requirement).
- **Zero cross-domain coupling:** a lint rule (`no-restricted-imports`) will forbid any module from importing a sibling module's internals — stricter than the existing app.

---

## 3. Folder Structure

```
/ (repo root)
├── pnpm-workspace.yaml                      # extend: add 'packages/*'
├── apps/
│   ├── backend/                             # existing — untouched
│   ├── frontend/                            # existing — untouched
│   └── rental-backend/                      # NEW — the Rental API
│       ├── src/
│       │   ├── main.ts
│       │   ├── app.module.ts
│       │   ├── shared/
│       │   │   ├── auth/                    # JwtStrategy, JwtAuthGuard, @Public()
│       │   │   ├── tenant/                  # CLS-based TenantContext + TenantGuard
│       │   │   ├── firestore/               # FirestoreService wrapper (safe writes)
│       │   │   ├── secrets/                 # SecretManagerService (decodes FIREBASE_SERVICE_ACCOUNT)
│       │   │   ├── money/                   # Money VO helpers (client-supplied rates)
│       │   │   ├── config/                  # env validation
│       │   │   └── errors/                  # DomainError → HTTP filter
│       │   └── modules/                     # one folder per bounded context
│       │       ├── organizations/
│       │       │   ├── domain/              # Organization aggregate
│       │       │   ├── application/         # use cases, IOrganizationRepository port
│       │       │   ├── infrastructure/      # FirestoreOrganizationRepository (adapter)
│       │       │   └── interface/           # controller + DTO mappers
│       │       ├── users/                   # same 4-layer split
│       │       ├── locations/
│       │       ├── reservations/
│       │       ├── services/
│       │       └── expenses/
│       ├── test/
│       │   ├── e2e/                         # supertest specs, one per module
│       │   └── fixtures/                    # Firestore seed helpers
│       ├── bruno/                           # Bruno collection (checked in)
│       ├── .env.example                     # names only, no secrets
│       ├── package.json
│       └── tsconfig.json
└── packages/
    └── rental-entities/                     # NEW — framework-free
        ├── src/
        │   ├── shared/
        │   │   ├── ids.ts                   # branded ID types
        │   │   ├── money.ts                 # Money class + validators
        │   │   └── tenant.ts                # OrganizationId, UserId
        │   ├── organizations/
        │   │   ├── organization.dto.ts
        │   │   └── organization.repository.ts   # IOrganizationRepository port
        │   ├── users/
        │   ├── locations/
        │   ├── reservations/
        │   ├── services/
        │   ├── expenses/
        │   └── index.ts
        ├── package.json                     # "@migo-uit/rental-entities"
        └── tsconfig.json
```

### Dependency direction (lint-enforced)

```
interface ──▶ application ──▶ domain  ◀── infrastructure
                 │                              │
                 └──▶ packages/rental-entities ◀┘
                        (no @nestjs/*, no firebase-admin)
```

Sibling modules MUST NOT import each other's internals. Cross-aggregate workflows (e.g. "creating a reservation bumps a location's availability snapshot") happen in dedicated Application Services that depend only on the target repository ports.

---

## 4. Cross-cutting Decisions

### 4.1 Tenant enforcement
- A `JwtAuthGuard` populates CLS with `{ organizationId, userId }`.
- Every repository adapter reads `organizationId` from CLS and scopes the Firestore reference to `organizations/{orgId}/...`. Forgetting to scope is impossible — the port's methods do not accept a raw tenant id.

### 4.2 Firestore write safety
- All writes go through `FirestoreService.set/update/delete/runTransaction/runBatch`. Each wrapper logs `code`, `path`, and `projectId` on error, then re-throws. This matches the existing `FirebaseService` pattern so future observability tooling works uniformly.

### 4.3 Money value object
- A single `Money` class in `packages/rental-entities/src/shared/money.ts`:
  ```ts
  class Money {
    amount: number           // minor units (cents)
    currencyCode: string     // ISO-4217 uppercase, validated by regex
    exchangeRate: number     // rate used to convert to baseAmount at record time
    baseAmount: number       // minor units in the Organization's base currency
  }
  ```
- All monetary fields on reservations, services, expenses use `Money`. Firestore stores it as a map; no extra infra needed.
- For v1, `exchangeRate` is supplied by the client (per user directive). A future `IExchangeRateProvider` port can be added without touching domain code.

### 4.4 Optional location link (Expenses & Services)
- `Expense.locationId` and `Service.locationId` are `string | null`. Aggregate invariants ("unassigned expenses belong to the organization at large") are enforced in the domain layer, not by Firestore rules.

### 4.5 Domain errors → HTTP
- Application layer throws typed subclasses of `DomainError` (`NotFoundError`, `ValidationError`, `ConflictError`, `ForbiddenError`).
- A single `DomainErrorFilter` maps them to HTTP status codes. Controllers never throw `HttpException` directly.

### 4.6 Credentials & secrets
- On boot, `SecretManagerService` reads `FIREBASE_SERVICE_ACCOUNT` (base64), decodes to JSON, and feeds it to `admin.initializeApp({ credential: admin.credential.cert(json) })`.
- `.env.example` contains the **variable names** only. Real values live in `.env.secrets` (gitignored) locally, and in GCP Secret Manager in production (swap is a one-line change in `SecretManagerService.get`).

### 4.7 Testing strategy
- **Unit:** Jest, mock the repository ports (not Firestore).
- **E2E:** boot a full Nest app against the **Firestore emulator** launched via `firebase-tools`. Each spec wipes the emulator between runs. Supertest drives HTTP.
- No production Firestore is ever touched by the test suite.

---

## 5. Deliverables — Phase 0 (revised)

- [x] `ARCHITECTURE.md` revised for Firestore + existing-stack alignment.
- [x] `PROGRESS_LOG.md` updated.
- [x] `FEEDBACK_TRACKER.md` created with the Phase 0 feedback recorded.
- [x] Security alert issued — the exposed service-account key must be rotated.

Phase 0 is now closed per the user's "Redo Phase 0" directive; Phase 1 (ERD) is delivered alongside in [`PHASE_1_ERD.md`](./PHASE_1_ERD.md) and is **awaiting feedback**.

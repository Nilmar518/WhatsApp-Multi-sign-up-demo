# Phase 4 — Application Services & Endpoints

> **Status:** Delivered, awaiting feedback.
> **Scope:** Application-layer services (use-case orchestration) + interface-layer controllers (HTTP) for every bounded context. Built on top of the Phase 3 adapters. Backend compiles clean (`nest build`).

---

## 1. What was added on top of Phase 3

```
apps/rental-backend/src/
├── shared/
│   ├── auth/                                NEW
│   │   ├── firebase-user.ts                 FirebaseUserContext + RequestWithFirebaseUser
│   │   ├── public.decorator.ts              @Public() opts a handler out of auth
│   │   ├── current-firebase-user.decorator.ts   @CurrentFirebaseUser()
│   │   ├── firebase-auth.guard.ts           Global guard: verifyIdToken + hydrate CLS from claims
│   │   └── auth.module.ts                   Registers the guard as APP_GUARD
│   └── health/
│       └── health.controller.ts             Public GET /health
└── modules/
    ├── organizations/
    │   ├── application/organizations.service.ts
    │   ├── infrastructure/organization-bootstrap.service.ts   ← batch write Org+User+4 categories
    │   ├── interface/organizations.controller.ts
    │   └── organizations.module.ts          (adds controller + services)
    ├── users/{application,interface}
    ├── locations/{application,interface}
    ├── reservations/
    │   ├── application/reservations.service.ts
    │   ├── application/payments.service.ts
    │   ├── interface/reservations.controller.ts
    │   ├── interface/payments.controller.ts
    │   └── reservations.module.ts           imports LocationsModule to resolve LOCATION_REPOSITORY
    ├── services/{application,interface}
    └── expenses/
        ├── application/expenses.service.ts
        ├── application/expense-categories.service.ts
        ├── interface/expenses.controller.ts
        └── interface/expense-categories.controller.ts
```

The lint rule in `.eslintrc.js` was already configured to allow cross-module imports only for repository **tokens** (e.g. `LOCATION_REPOSITORY`) — sibling modules never touch each other's adapters or services. `ReservationsModule` gets `LOCATION_REPOSITORY` by importing `LocationsModule` (which re-exports the token) — orthodox Nest DI, fully DDD-compliant.

---

## 2. Auth & tenant-context wiring

`FirebaseAuthGuard` (global via `APP_GUARD`) runs on every request unless the handler carries `@Public()`:

1. Extract `Authorization: Bearer <token>` — missing header → `UnauthorizedError`.
2. `admin.auth().verifyIdToken(token, checkRevoked=true)` — failure → `UnauthorizedError`.
3. Build `FirebaseUserContext` from the decoded token:
   - `firebaseUid` = `sub`
   - `email`, `name` (if present)
   - `organizationId`, `userId`, `roles` — **read from the token's custom claims** (FBK-005 #4). Never queried from Firestore on the hot path.
4. Attach to the request as `req.firebaseUser`.
5. If both `organizationId` and `userId` claims are present, also populate CLS via `TenantContextService.set(...)` so every downstream service sees the tenant through `tenant.organizationId()` / `tenant.userId()`.

The two public endpoints are `GET /health` and the bootstrap `POST /organizations` (which needs a Firebase token to identify the signing-up user, but no `organizationId` claim yet — the claim is **set** by that endpoint).

### `POST /organizations` bootstrap (one transaction, FBK-005 #3)

Handled by `OrganizationBootstrapService` in the infrastructure layer — this is the only place outside `infrastructure/` which legitimately touches `firebase-admin` directly, because it composes a cross-aggregate atomic write that can't be expressed through individual port calls:

1. Validate the request (ValidationPipe already done).
2. `FirestoreService.batch()` stages:
   - `organizations/{newOrgId}` — Organization doc
   - `organizations/{newOrgId}/users/{newUserId}` — owner User (`externalAuthId = firebaseUid`, `roles: ['owner']`)
   - `organizations/{newOrgId}/expense_categories/{...}` × 4 — seed categories `Insumos / Servicios / Mantenimiento / Personal` (`seed: true`)
3. `batch.commit()` — atomic commit, no partial state.
4. `admin.auth().setCustomUserClaims(firebaseUid, { organizationId, userId, roles: ['owner'] })`.
5. Response includes `tokenRefreshRequired: true` — clients must call `firebase.auth().currentUser.getIdToken(true)` before their next request so the new claims propagate.

---

## 3. Endpoints

All paths below are rooted at the backend URL (default `http://localhost:3002`). All endpoints require a valid Firebase ID token with `organizationId` + `userId` custom claims **unless marked `(public)`**.

Error shape (uniform): `{ "error": { "code": "<CODE>", "message": "<human text>" } }` — emitted by `DomainErrorFilter`.

### Health `(public)`
| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Liveness check. No auth. |

### Organizations
| Method | Path | Notes |
|---|---|---|
| POST | `/organizations` `(public-ish: token without org claim)` | Bootstrap new tenant + owner + seed categories, sets custom claims. Body: `CreateOrganizationDto`. Returns `{ organization, ownerUser, categoriesSeeded, tokenRefreshRequired: true }`. |
| GET | `/organizations/me` | Current tenant from claims. |
| PATCH | `/organizations/me` | Body: `UpdateOrganizationDto`. |

### Users
| Method | Path | Notes |
|---|---|---|
| POST | `/users` | Invite/register a user already known to Firebase. Body: `CreateUserDto` (`externalAuthId`, `email`, `displayName`, `roles`). |
| GET | `/users/me` | The authenticated user's own record. |
| GET | `/users` | List users in the tenant. Query: `PageRequest` (`limit`, `cursor`). |
| GET | `/users/:userId` | |
| PATCH | `/users/:userId` | Body: `UpdateUserDto`. |
| DELETE | `/users/:userId` | Hard delete (users are non-financial). |

### Locations
| Method | Path | Notes |
|---|---|---|
| POST | `/locations` | Body: `CreateLocationDto`. |
| GET | `/locations` | Query: `active`, `type`, `tag`, + `PageRequest`. |
| GET | `/locations/:locationId` | |
| PATCH | `/locations/:locationId` | |
| DELETE | `/locations/:locationId` | Hard delete (Phase 4 does NOT yet check for dependent reservations — see §5 Q1). |

### Reservations
| Method | Path | Notes |
|---|---|---|
| POST | `/reservations` | Validates: endDate > startDate; Location exists and is `active`; no overlapping active reservation. Creates in status `pending`. `balanceDue = totalPrice`. |
| GET | `/reservations` | Query: `locationId`, `guestUserId`, `status`, `source`, `startFrom`, `startTo`, + `PageRequest`. |
| GET | `/reservations/:reservationId` | |
| PATCH | `/reservations/:reservationId` | Enforces `canTransitionReservation` state machine; on date change + still-active, re-runs overlap check; on `totalPrice` change, recomputes `balanceDue = newTotal − amountAlreadyPaid` per currency. |
| DELETE | `/reservations/:reservationId` | **Soft-delete** (sets `deletedAt`). |

### Payments (nested under reservations)
| Method | Path | Notes |
|---|---|---|
| POST | `/reservations/:reservationId/payments` | Body: `CreatePaymentDto`. Runs `IPaymentRepository.recordAndReconcile` in a Firestore transaction: converts to reservation currency using the client-supplied rate (FBK-004 #5), decrements `reservation.balanceDue`, writes the payment. Returns `{ payment, newBalanceDue }`. |
| GET | `/reservations/:reservationId/payments` | Paginated sub-collection list. |
| GET | `/reservations/:reservationId/payments/:paymentId` | |
| PATCH | `/reservations/:reservationId/payments/:paymentId` | Update `status`, `externalRef`, or `receivedAt`. Does **not** re-reconcile — amount changes are intentionally unsupported to preserve audit. |
| DELETE | `/reservations/:reservationId/payments/:paymentId` | **Soft-delete**. |
| GET | `/payments` | Org-wide finance listing via `collectionGroup('payments')` (FBK-003 #4). Query: `status`, `method`, `receivedFrom`, `receivedTo`, + `PageRequest`. |

### Services
| Method | Path | Notes |
|---|---|---|
| POST | `/services` | Enforces `cadence` required if `billingMode === 'subscription'`. |
| GET | `/services` | Query: `active`, `billingMode`, `locationId`, `unassigned`, `tag`, + `PageRequest`. |
| GET | `/services/:serviceId` | |
| PATCH | `/services/:serviceId` | Re-checks subscription/cadence invariant against merged state. |
| DELETE | `/services/:serviceId` | Hard delete. |

### Expenses
| Method | Path | Notes |
|---|---|---|
| POST | `/expenses` | Validates `category` against tenant `ExpenseCategory` lookup (rejects unknown + archived). Rejects combos with `reservationId` but no `locationId`. |
| GET | `/expenses` | Query: `locationId`, `unassigned`, `reservationId`, `category`, `incurredFrom`, `incurredTo`, + `PageRequest`. |
| GET | `/expenses/:expenseId` | |
| PATCH | `/expenses/:expenseId` | |
| DELETE | `/expenses/:expenseId` | **Soft-delete**. |

### Expense Categories
| Method | Path | Notes |
|---|---|---|
| POST | `/expense-categories` | Tenant-scoped create. `key` is lowercase alphanumeric + `-_`; must be unique within the tenant. |
| GET | `/expense-categories?includeArchived=true` | |
| GET | `/expense-categories/:id` | |
| PATCH | `/expense-categories/:id` | Set `archived: true` to hide from pickers. **Historical expenses are never rewritten** (FBK-004 #4). |
| DELETE | `/expense-categories/:id` | Hard delete (rare — prefer archive). |

---

## 4. Where business logic lives (design check)

- **Controllers** are ≤10 lines of delegation each. They never call repositories, never import `firebase-admin`, and never `throw new HttpException` directly — they only raise domain errors via the services, which the `DomainErrorFilter` maps.
- **Application services** (`*.service.ts` under `application/`) contain every rule that isn't pure-data validation:
  - `ReservationsService.create` — date ordering, Location existence + `active`, overlap check.
  - `ReservationsService.update` — state-machine transitions via `canTransitionReservation`, re-check overlaps when dates change, keep `balanceDue` arithmetic consistent on totalPrice change.
  - `PaymentsService.record` — defers to `recordAndReconcile` (transactional).
  - `ServicesService` — subscription → cadence invariant.
  - `ExpensesService.create` — category-lookup validation, location-required-if-reservation rule.
  - `OrganizationsService.create` — delegates to `OrganizationBootstrapService` which owns the cross-aggregate atomic write.
- **Repository adapters** (unchanged from Phase 3) still carry no business logic.

---

## 5. Build verification

```
pnpm --filter @migo-uit/rental-entities build   → ✓
pnpm --filter @migo-uit/rental-backend  build   → ✓
```

All types line up; no `any` leakage at module boundaries; strict-null and strict-optional-properties pass.

---

## 6. Open questions for you before Phase 5 (E2E + Bruno)

1. **Location delete with dependent reservations** — right now `DELETE /locations/:id` is an unchecked hard delete. Do you want Phase 5 to add a domain check that blocks deletion when any **non-cancelled** reservation references the location, or is cascading/soft-delete preferred?
2. **Payment amount edits** — I intentionally forbid editing `amount` on a payment via `PATCH` (would have to un-reconcile + re-reconcile the reservation balance, messy). If the user miskeys the amount, they should `DELETE` (soft) and create a fresh payment. Is that your expected workflow, or do you want an explicit corrective endpoint?
3. **Custom-claims propagation UX** — after `POST /organizations`, the client must force-refresh the ID token before the next call. Should Phase 5 ship a `POST /organizations/sync-claims` helper that re-reads the user's current membership and re-issues custom claims, so recovery is self-serve when claims get stale?
4. **Roles enforcement** — the guard populates `roles` into CLS but no handler yet checks `owner|admin|staff|viewer`. For Phase 5, do you want a simple `@Roles('admin','owner')` decorator + `RolesGuard` on mutating endpoints, or keep v1 permissive (any authenticated tenant member can do anything)?
5. **Bruno auth handling** — for the Phase 5 Bruno collection, do you have an existing fixture of a minted Firebase ID token for a test tenant, or should I document the steps to mint one from the Firebase Auth REST API (sign-in-with-password) and reference an env var like `{{FIREBASE_ID_TOKEN}}` in every request?

Once you answer, Phase 5 will add Jest+Supertest E2E specs driven by the Firestore emulator + a complete Bruno collection with one request per endpoint above.

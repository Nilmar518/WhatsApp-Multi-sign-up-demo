# Rental API — Progress Log

Living document. **Project complete at end of Phase 5.**

---

## Legend
- ✅ Done and approved · 🟡 Delivered, awaiting feedback · ⏳ Not started · ⛔ Blocked

---

## Phase Status

| Phase | Title | Status | Last updated |
|-------|-------|--------|--------------|
| 0 | Environment, Tech Stack & Architecture Alignment | ✅ Done | 2026-04-20 |
| 1 | ERD & Domain Modeling | ✅ Done | 2026-04-20 |
| 2 | DTOs & Schemas (`packages/rental-entities`) | ✅ Done | 2026-04-20 |
| 3 | Infrastructure & Agnostic Repositories | ✅ Done | 2026-04-20 |
| 4 | Application Services & Endpoints | ✅ Done | 2026-04-20 |
| 5 | E2E Tests & Bruno Collection | ✅ **Done — project complete** | 2026-04-20 |

---

## Phase summaries

### Phase 0 — Stack & architecture ✅
Pivoted to Firestore + existing `apps/backend` stack. Base64 `FIREBASE_SERVICE_ACCOUNT`. Firebase Auth for identity. Port `3002`. Names `apps/rental-backend` + `@migo-uit/rental-entities`. See [`ARCHITECTURE.md`](./ARCHITECTURE.md). FBK-002 (leaked key) resolved.

### Phase 1 — ERD ✅
Firestore document model rooted at `organizations/{orgId}`. Sub-collections for users, locations, reservations (+payments), services, expenses, expense_categories. 9 domain invariants. 8 composite indexes. See [`PHASE_1_ERD.md`](./PHASE_1_ERD.md). Questions answered in FBK-003.

### Phase 2 — `@migo-uit/rental-entities` ✅
Framework-agnostic package: branded IDs, `Money` VO, `Address` VO, pagination types, `DomainError` hierarchy; entities + class-validator DTOs + port interfaces for all 7 aggregates. See [`PHASE_2_SCHEMAS.md`](./PHASE_2_SCHEMAS.md). Questions answered in FBK-004.

### Phase 3 — Infrastructure ✅
`apps/rental-backend` scaffold. `SecretManagerService`, `FirebaseAdminService`, `FirestoreService` safe-write wrapper, `TenantContextService` (CLS), `DomainErrorFilter`, opaque base64 cursor codec, money utils. 8 Firestore adapters — one per port, zero cross-module imports. Transactional `PaymentRepository.recordAndReconcile` with foreign-currency conversion. See [`PHASE_3_INFRASTRUCTURE.md`](./PHASE_3_INFRASTRUCTURE.md). Questions answered in FBK-005.

### Phase 4 — Application & endpoints ✅
`FirebaseAuthGuard` (global APP_GUARD) reads `organizationId` / `userId` / `roles` from custom claims — zero Firestore lookups on the hot path. `OrganizationBootstrapService` atomically writes Org + owner User + 4 seed ExpenseCategories + `setCustomUserClaims`. Application services for each aggregate (Reservations overlap+transitions, Payments record+reconcile, Services subscription/cadence invariant, Expenses category validation). ~35 endpoints across 7 aggregates + health. See [`PHASE_4_API.md`](./PHASE_4_API.md). Questions answered in FBK-006.

### Phase 5 — E2E & Bruno ✅ (2026-04-20)

**FBK-006 code changes applied:**
- `Location` gains `deletedAt`; `DELETE /locations/:id` is now a soft-delete; list/findById filter out deleted.
- `PaymentsService.update` explicitly throws `ValidationError` on `amount`/`method` edits (immutable per audit directive).
- `POST /organizations/sync-claims` added — re-issues Firebase custom claims from the current Firestore membership.
- `OrganizationsModule` now imports `UsersModule` to resolve `USER_REPOSITORY` in `syncClaims`.
- `firestore.indexes.json` expanded for `locations` with `deletedAt` first.

**Test harness:**
- Jest + Supertest running against Firestore (`:8080`) + Auth (`:9099`) emulators.
- `test/helpers/` — env setup, emulator readiness check, Firebase user minter, token refresh, state reset, Nest app boot.
- `firebase.json` at repo root pins emulator ports.
- `pnpm --filter @migo-uit/rental-backend emulators` + `pnpm --filter @migo-uit/rental-backend test:e2e`.

**E2E specs (3 files):**
- `health.e2e-spec.ts` — public endpoint + 401 on unauthenticated calls.
- `lifecycle.e2e-spec.ts` — bootstrap → token refresh → location CRUD → reservation + overlap rejection → foreign-currency payment reconciliation → immutable amount → location soft-delete preserves historical snapshot → sync-claims.
- `services-expenses.e2e-spec.ts` — subscription-cadence invariant; unknown/archived category rejection; category archival hides from list but retains historical expenses.

**Bruno collection:**
- `apps/rental-backend/bruno/bruno_collection.json` — every endpoint, folder-organized, with `{{baseUrl}}`, `{{FIREBASE_ID_TOKEN}}`, and per-resource ID placeholders.
- `apps/rental-backend/bruno/README.md` — token-minting instructions (emulator + prod).

**Build verification:**
```
pnpm --filter @migo-uit/rental-entities build   → ✓
pnpm --filter @migo-uit/rental-backend  build   → ✓
pnpm install (5 workspace projects)             → ✓
```

See [`PHASE_5_TESTING.md`](./PHASE_5_TESTING.md).

---

## Deliverables index
- [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- [`PHASE_1_ERD.md`](./PHASE_1_ERD.md)
- [`PHASE_2_SCHEMAS.md`](./PHASE_2_SCHEMAS.md)
- [`PHASE_3_INFRASTRUCTURE.md`](./PHASE_3_INFRASTRUCTURE.md)
- [`PHASE_4_API.md`](./PHASE_4_API.md)
- [`PHASE_5_TESTING.md`](./PHASE_5_TESTING.md)
- [`FEEDBACK_TRACKER.md`](./FEEDBACK_TRACKER.md) — FBK-001 through FBK-006
- Code: `packages/rental-entities/` + `apps/rental-backend/`
- Bruno: `apps/rental-backend/bruno/bruno_collection.json`

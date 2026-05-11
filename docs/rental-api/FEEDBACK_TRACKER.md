# Rental API — Feedback Tracker

Each entry records user feedback, the date it was given, and how it was resolved in the docs/code.

---

## FBK-001 — Phase 0 pivot to Firestore + existing-stack alignment
**Date:** 2026-04-20 · **Phase:** 0
Discard NestJS/Prisma/Postgres. Match `apps/backend` stack. Firestore. `firebase-admin`. Base64 `FIREBASE_SERVICE_ACCOUNT` env var. Simple JWT auth. Names `apps/rental-backend` + `@migo-uit/rental-entities`. Currency rates client-supplied for v1.
**Resolution:** `ARCHITECTURE.md` rewritten; Firestore ERD designed in Phase 1; locked in.

---

## FBK-002 — Security incident: service-account key leaked in chat
**Date:** 2026-04-20 · **Phase:** 0
User pasted a live Firebase service-account JSON into chat.
**Resolution (2026-04-20):** ✅ User confirmed key rotated; assistant never wrote the key to disk.

---

## FBK-003 — Phase 1 ERD answers (6 questions)
**Date:** 2026-04-20 · **Phase:** 1
1. Reservation `source` → **open string**, with non-binding suggestions.
2. Users **strictly per-org** for v1.
3. **No recurrence** on expenses; single-occurrence docs only.
4. Payments as **sub-collection** under reservations, with denormalized `organizationId`.
5. `balanceDue` **persisted** via transactional `recordAndReconcile`.
6. Expense categories as **tenant-configurable lookup** (open string), seeded with legacy defaults.
**Resolution:** Applied in Phase 2 (`@migo-uit/rental-entities`).

---

## FBK-004 — Phase 2 answers (5 questions) + approval to run `pnpm install`
**Date:** 2026-04-20 · **Phase:** 2

| # | Question | User decision |
|---|----------|---------------|
| 1 | Pagination cursor — opaque string vs structured? | **Opaque base64 string.** Adapter hides cursor mechanics from clients. |
| 2 | User password storage — local bcrypt vs Firebase Auth? | **Delegate to Firebase Auth.** Backend stores only `externalAuthId` (Firebase UID) mapped to an `Organization`. No local password hashes at any point. |
| 3 | Soft-delete on financial records? | **Yes, `deletedAt` is mandatory** on Reservations, Payments, Expenses. Financial records are never hard-deleted — audit trail is non-negotiable. |
| 4 | Archiving `ExpenseCategory` — block if referenced? | **No — UI-level archive only.** The `archived` flag hides the category from pickers; historical Expenses retain the original `category` string/ID as it was at creation time. Archival does **not** rewrite past data. |
| 5 | `Reservation.balanceDue` currency model? | **Always in `totalPrice.currency`.** Foreign-currency payments are converted at record time using the client-supplied exchange rate so the deduction against `balanceDue` lands in the reservation's currency. |

Also approved: running `pnpm install` at the start of Phase 3 to sync the workspace.

### Resolution (applied at the top of Phase 3, 2026-04-20)

**Schema deltas applied to `@migo-uit/rental-entities`:**
- `users/user.entity.ts`: removed `passwordHash`; `externalIdpSub` → **`externalAuthId: string` (required, Firebase UID)**; `SafeUser` is now equivalent to `User` since no secret remains.
- `users/user.dto.ts`: `LoginDto` deleted. `CreateUserDto` now requires `externalAuthId`, drops `password`.
- `users/user.repository.ts`: `findByEmailWithSecret` → `findByExternalAuthId(organizationId, externalAuthId)`.
- `reservations/reservation.entity.ts`: added `deletedAt: Date | null`.
- `reservations/payment.entity.ts`: added `deletedAt: Date | null`.
- `expenses/expense.entity.ts`: added `deletedAt: Date | null`.
- Repository ports: `delete(...)` is now a **soft-delete** for Reservations, Payments, Expenses (sets `deletedAt`). All list/findById methods filter `deletedAt == null` by default.
- `ExpenseCategory`: archival behavior documented — `archived: true` hides from pickers but does not touch historical Expenses. Phase 4 will read the `category` string straight from the Expense doc without re-validating against the category lookup on historical rows.
- `reservations/payment.repository.ts`: `recordAndReconcile` now accepts an optional `balanceDeduction: MoneyShape` input. If omitted and `payment.amount.currencyCode == reservation.totalPrice.currencyCode`, the deduction equals `payment.amount.amount`; otherwise the Firestore adapter computes `amount * payment.exchangeRate` into the reservation's currency (client-supplied rate per FBK-001 #7). The reservation's `balanceDue` is decremented in a single transaction.

**Backend conventions locked:**
- `FirebaseAuthGuard` (to be wired in Phase 4) uses `admin.auth().verifyIdToken(bearer)` and populates CLS `TenantContext` with `organizationId` from custom claims and `userId` resolved via `findByExternalAuthId`.
- No password endpoints — login, signup, password reset all live on the Firebase Auth client side.

---

## FBK-005 — Phase 3 answers (5 questions) + approval for Phase 4
**Date:** 2026-04-20 · **Phase:** 3

| # | Question | User decision |
|---|----------|---------------|
| 1 | Rate-limiting at the API layer or at infra? | **Defer to infra** (Cloud Run / API Gateway / Firebase Hosting). Keep NestJS lightweight. |
| 2 | Confirm error wire shape `{ error: { code, message } }`? | **Confirmed.** |
| 3 | Org-creation bootstrap in one transaction (Org + owner User + seeded ExpenseCategories)? | **Yes — one transaction.** Robust, no partial state. |
| 4 | `organizationId` source — Firebase ID-token custom claims vs Firestore lookup? | **Custom claims.** Best practice; saves a Firestore read per authenticated request. |
| 5 | Backend port `3002`? | **Confirmed.** No collision with existing services. |

**Resolution (applied during Phase 4, 2026-04-20):**
- `FirebaseAuthGuard` verifies bearer ID tokens via `admin.auth().verifyIdToken()`. It reads custom claims `organizationId`, `userId`, and `roles` and populates the CLS `TenantContextService` from those claims alone — **no Firestore lookup on the hot path**.
- `CreateOrganizationUseCase` delegates to `OrganizationBootstrapService` which uses `FirestoreService.batch()` to write the Organization doc, the owner User doc, and the four seed ExpenseCategory docs in a single atomic commit, then calls `admin.auth().setCustomUserClaims(firebaseUid, { organizationId, userId, roles: ['owner'] })`. The client must refresh the ID token to pick up the new claims.
- No `@nestjs/throttler` or other rate-limiting middleware added.
- `DomainErrorFilter` wire shape unchanged from Phase 3: `{ "error": { "code": "NOT_FOUND", "message": "…" } }`.
- Backend listens on port `3002` by default (`PORT` env var overrides).

---

## FBK-006 — Phase 4 answers (5 questions) + approval for Phase 5
**Date:** 2026-04-20 · **Phase:** 4

| # | Question | User decision |
|---|----------|---------------|
| 1 | `DELETE /locations/:id` with dependents? | **Soft-delete Locations** (`deletedAt` on the entity). Blocking is not enough — we must never orphan historical Reservations/Expenses that reference a location. |
| 2 | Confirm payment amounts are immutable? | **Confirmed.** PATCH rejects any attempt to change `amount`. Correction workflow = soft-delete + re-create. |
| 3 | Add `POST /organizations/sync-claims`? | **Yes.** Helpful for bootstrap token refresh and edge cases. Re-reads the current user's membership and re-issues `setCustomUserClaims`. |
| 4 | RBAC in v1? | **Keep permissive.** Any authenticated user mapped to `organizationId` has read/write access. Granular roles (`admin / owner / viewer`) reserved for v2. |
| 5 | Bruno auth strategy? | **Mint via Firebase Auth REST / emulator.** Collection uses `{{FIREBASE_ID_TOKEN}}` env var; include a markdown/script note with the minting command. |

### Resolution (applied in Phase 5, 2026-04-20)

**Schema / backend changes:**
- `@migo-uit/rental-entities` — `Location` entity gains `deletedAt: Date | null`; `location.dto.ts` `LocationResponseDto` reflects it. No change to the port signature (existing `delete(...)` semantic flips to soft-delete).
- `apps/rental-backend/src/modules/locations/infrastructure/firestore-location.repository.ts` — `delete()` now sets `deletedAt = serverTimestamp()`; `findById` / `list` filter `where('deletedAt','==',null)`.
- `OrganizationsService.syncClaims()` added; wired to new `POST /organizations/sync-claims` controller. Uses `FirebaseAdminService.auth().setCustomUserClaims(firebaseUid, { organizationId, userId, roles })` after resolving the user from `findByExternalAuthId`.
- `PaymentsService.update()` explicitly throws `ValidationError` if the request payload carries an `amount` field — the `UpdatePaymentDto` already omits it, but we reject typos where the client tries to sneak it in.
- `firestore.indexes.json` — adds composite index on `locations` with `deletedAt` first.

**Testing:**
- Jest + Supertest against the Firestore emulator (`localhost:8080`) and Auth emulator (`localhost:9099`). `firebase.json` at repo root pins ports. Tests never touch `rentals-ae6f3`.
- `test/helpers/` provides: `mintIdToken(email, password)`, `resetEmulators()`, `bootAppWithEmulators()`.

**Bruno:**
- `apps/rental-backend/bruno/` contains one collection JSON with every endpoint, folder-organized, using `{{baseUrl}}` and `{{FIREBASE_ID_TOKEN}}` variables.
- `apps/rental-backend/bruno/README.md` documents how to mint a token (emulator mode + production mode) and set the env var.

---

_Project complete at end of Phase 5._


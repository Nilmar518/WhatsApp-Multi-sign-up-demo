# Tasks

## Sub-issue 1 (Research) — ✅ COMPLETED
- [x] Review Meta Docs
- [x] Identify Permissions
- [x] Technical Summary → `docs/META_TECH_REF.md`

## Sub-issue 2 (Scaffolding) — ✅ COMPLETED
- [x] Initialize pnpm workspace (`pnpm-workspace.yaml`, root `package.json`)
- [x] Scaffold NestJS backend (`apps/backend`) with modular architecture
- [x] Configure Firebase Admin SDK (`FirebaseService`)
- [x] Implement Defensive Logger service (logs REQUEST / RESPONSE / LATENCY / ERROR_CODE)
- [x] Scaffold Vite + React + TypeScript + Tailwind frontend (`apps/frontend`)
- [x] Configure Firebase Client SDK with `onSnapshot` hook
- [x] Implement webhook controller with dynamic ngrok URL support

## Sub-issue 3 (Integration Flow) — ✅ COMPLETED
- [x] Implement `POST /auth/exchange-token` endpoint
- [x] State machine: IDLE → CONNECTING → ACTIVE | ERROR (persisted in Firestore)
- [x] Frontend Connect button with Meta Embedded Signup `FB.login` flow
- [x] Real-time status UI via `useIntegrationStatus` hook (onSnapshot)
- [x] Implement `WebhookService` — parses `entry[].changes[].value.messages[]`
- [x] Inbound messages persisted to `integrations/{businessId}.messages[]` via `arrayUnion`
- [x] Defensive parse-failure logging (raw payload captured on error)
- [x] `POST /messages/send` endpoint — reads `accessToken` + `phoneNumberId` from Firestore
- [x] `MessagingService` — sends via Meta Cloud API `/{phoneNumberId}/messages`
- [x] Outbound messages persisted to `integrations/{businessId}.messages[]`
- [x] `ChatConsole` component — real-time feed via onSnapshot, reply input, Send button
- [x] "User must message first" rule documented in UI badge and controller JSDoc
- [x] curl / Postman mock payloads documented in `docs/TESTING.md`
- [x] ngrok SOP documented in `CLAUDE.md`

## Sub-issue 4 (Production Hardening) — ✅ COMPLETED
- [x] `SecretManagerService` — GCP Secret Manager emulator (reads `.env.secrets`, logs every access)
- [x] `SecretManagerModule` — global provider, `.env.secrets.example` documented
- [x] CLAUDE.md updated with production swap guide (`@google-cloud/secret-manager`)
- [x] `SystemUserService.tryEscalate()` — exchanges long-lived token for permanent System User token
- [x] `AuthService` updated to use `SecretManagerService` + `SystemUserService`
- [x] `GET /catalog` — fetches `/{wabaId}/product_catalogs` then `/{catalogId}/products`
- [x] Catalog data persisted to `integrations/{businessId}.catalog` in Firestore
- [x] `CatalogView` component — product list, Load/Refresh button, availability badges
- [x] `BusinessToggle` component — switch between `demo-business-001` / `demo-business-002`
- [x] `ResetButton` component — calls `DELETE /integrations/:businessId`, UI auto-resets via onSnapshot
- [x] `DELETE /integrations/:businessId` endpoint (`IntegrationsController`)
- [x] `docs/TESTING.md` updated with §5-§8 (Catalog, Reset, Postman entries, Final Demo Scenario)

## Sub-issue 5 (Environment Synchronization) — ✅ COMPLETED
- [x] Configure ngrok — `NGROK_URL` set in `apps/backend/.env`
- [x] GCP Integration — `FirebaseService` now reads `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY`
      via `SecretManagerService` (was incorrectly using `ConfigService` which cannot see `.env.secrets`)
- [x] `apps/backend/.env` created with PORT, NGROK_URL, META_WEBHOOK_VERIFY_TOKEN, FIREBASE_PROJECT_ID
- [x] `apps/backend/.env.secrets` created (template — user must fill in real values after rotating credentials)
- [x] `apps/frontend/.env` created with VITE_ prefixed variables (template — user must fill Firebase Web SDK values)
- [x] `apps/frontend/index.html` — replaced hardcoded `'__META_APP_ID__'` with `'%VITE_FB_APP_ID%'`
      (Vite native HTML env interpolation; no build plugin needed)
- [ ] **MANUAL** Register webhook in Meta App Dashboard:
      Callback URL: `https://postmeningeal-erich-discernably.ngrok-free.dev/webhook`
      Verify token: `migo_verify_secret_2024` → subscribe to `messages` field

## Sub-issue 6 (Production Firebase Migration) — ✅ COMPLETED
- [x] Migrated Firebase credentials to production project `smart-service-85369`
- [x] Backend `FIREBASE_PROJECT_ID` aligned to `smart-service-85369` in `.env` and `.env.secrets`
- [x] Frontend `VITE_FIREBASE_PROJECT_ID` aligned to `smart-service-85369` — Web SDK config consistent
- [x] `FirebaseService.initializeApp()` — explicit top-level `projectId` added to eliminate SDK ambiguity
- [x] Firestore write wrappers (`set` / `update`) added to `FirebaseService` — log error code + project + path on failure
- [x] All backend write call-sites migrated to `this.firebase.set()` / `this.firebase.update()`
- [x] **Real-time Persistence** — `onSnapshot` listener and backend writes confirmed on same project ✅

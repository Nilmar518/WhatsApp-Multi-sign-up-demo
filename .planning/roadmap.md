# Migo UIT Project Roadmap

## Milestone 1: Research (Sub-issue 1) — ✅ DONE
- [x] Review Meta Docs
- [x] Identify Permissions (`whatsapp_business_management`, `whatsapp_business_messaging`, `business_management`)
- [x] Produce Technical Summary → `docs/META_TECH_REF.md`

## Milestone 2: Scaffolding (Sub-issue 2) — ✅ DONE
- [x] Set up NestJS backend structure (modular, DTO-validated, DefensiveLogger)
- [x] Set up React frontend (Vite + TS + Tailwind, folder-based components)
- [x] Configure Firebase Admin (backend) and Firebase Client (frontend)
- [x] Configure ngrok webhook verification (dynamic URL via ENV)

## Milestone 3: Integration Flow (Sub-issue 3) — ✅ DONE
- [x] Implement Meta API token exchange (`POST /auth/exchange-token`)
- [x] Connect frontend with real-time Firestore updates (onSnapshot)
- [x] Webhook inbound message parser (`WebhookService`)
- [x] Inbound messages persisted to Firestore, surfaced in ChatConsole
- [x] `POST /messages/send` — outbound via Cloud API with stored Long-Lived token
- [x] Testing guide (`docs/TESTING.md`) and ngrok SOP (`CLAUDE.md`)

## Milestone 4: Production Hardening (Sub-issue 4) — ✅ DONE ← JUST COMPLETED
- [x] GCP Secret Manager emulator (`SecretManagerService` + `.env.secrets`)
- [x] CLAUDE.md production swap guide for `@google-cloud/secret-manager`
- [x] System User Token escalation (permanent non-expiring tokens)
- [x] Product Catalog fetch and display (`GET /catalog` + `CatalogView`)
- [x] Multi-integration Business Toggle (demo-business-001 / demo-business-002)
- [x] Dev Reset button (`DELETE /integrations/:id` + `ResetButton`)
- [x] Full demo walkthrough documented in `docs/TESTING.md §8`

## POC Status: DEMO-READY ✅

All four milestones complete. The system demonstrates:
- Zero-friction WhatsApp Business onboarding via Meta Embedded Signup
- Real-time status tracking via Firestore `onSnapshot`
- Bidirectional messaging (inbound webhook → Firestore → UI; outbound via Cloud API)
- Product catalog integration with Meta Commerce Manager
- Permanent token management via System User escalation
- Production-aligned secret handling (GCP Secret Manager emulation)
- Multi-tenant support via Business Toggle
- One-click demo reset

## Future Enhancements (Post-POC)
- Meta App Review → Advanced Access for `whatsapp_business_messaging`
- Business Verification flow for client-facing onboarding
- Delivery receipt processing (`statuses[]` handler in WebhookService)
- Migrate `messages[]` array → Firestore subcollection (1MB scale limit)
- Pre-approved WhatsApp message template creation UI
- Authentication middleware on reset and catalog endpoints
- GCP Secret Manager swap in production deploy

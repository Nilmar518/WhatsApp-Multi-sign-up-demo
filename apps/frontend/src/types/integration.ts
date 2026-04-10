/**
 * IntegrationStatus — the full set of values that can appear in the
 * `status` field of a Firestore `integrations/{id}` document.
 *
 * Lifecycle states (pre-existing):
 *   IDLE            — no integration exists
 *   CONNECTING      — signup flow initiated, not yet confirmed
 *   PENDING_TOKEN   — webhook-only onboarding path waiting for token
 *   ACTIVE          — fully connected (backward-compat alias for WEBHOOKS_SUBSCRIBED)
 *   ERROR           — last operation failed
 *   MIGRATING       — Force Migration OTP flow in progress
 *
 * Setup state machine (Phase 2 — step-by-step onboarding):
 *   TOKEN_EXCHANGED     — OAuth code → long-lived token stored
 *   PHONE_REGISTERED    — phone number activated on WhatsApp Cloud API
 *   STATUS_VERIFIED     — phone code_verification_status confirmed VERIFIED
 *   CATALOG_SELECTED    — product catalog linked to the integration
 *   WEBHOOKS_SUBSCRIBED — app subscribed to WABA message events
 *
 * The backward-compat facade (POST /auth/exchange-token) ends with status=ACTIVE
 * so existing hooks are unaffected. The per-step endpoints (POST /integrations/meta/*)
 * emit intermediate states that the useWhatsAppConnect hook (Phase 5) will read.
 */
export type IntegrationStatus =
  // ── Lifecycle states ──────────────────────────────────────────────────────
  | 'IDLE'
  | 'CONNECTING'
  | 'PENDING_TOKEN'
  | 'ACTIVE'
  | 'ERROR'
  | 'MIGRATING'
  // ── WhatsApp setup state machine (Phase 2) ────────────────────────────────
  | 'TOKEN_EXCHANGED'
  | 'PHONE_REGISTERED'
  | 'STATUS_VERIFIED'
  | 'CATALOG_SELECTED'
  | 'WEBHOOKS_SUBSCRIBED'
  // ── Messenger setup state machine ─────────────────────────────────────────
  | 'PAGE_SELECTED'
  | 'PAGE_SUBSCRIBED'
  // ── Instagram setup state machine ─────────────────────────────────────────
  | 'ACCOUNT_RESOLVED';

export interface IntegrationDoc {
  businessId: string;
  status: IntegrationStatus;
  setupStatus?: IntegrationStatus;
  metaData: Record<string, string>;
  updatedAt: string;
}

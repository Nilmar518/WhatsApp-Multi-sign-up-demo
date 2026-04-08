/**
 * meta-api-versions.ts
 *
 * Single source of truth for all Meta Graph API version strings used across
 * the backend. Importing from here instead of hardcoding version strings
 * ensures that upgrading to a new API version is a single-line change.
 *
 * Version assignment rationale (as of Phase 6 of the scalable architecture plan):
 *
 *   TOKEN_EXCHANGE  v22.0
 *     Endpoints: oauth/access_token, /me, /{wabaId}, /{wabaId}/phone_numbers,
 *                /{phoneNumberId}/register, /{wabaId}/subscribed_apps
 *     Used by: auth.service.ts, meta-integration.service.ts,
 *              registration.service.ts, system-user.service.ts
 *     Rationale: Minimum version that supports the OAuth code exchange flow
 *                with the `whatsapp_business_management` scope set. v22 is
 *                stable for these identity + token endpoints.
 *
 *   PHONE_CATALOG   v24.0
 *     Endpoints: /{phoneNumberId}/messages, /{businessId}/owned_product_catalogs,
 *                /{businessId}/client_product_catalogs, /{catalogId}/products,
 *                /{phoneNumberId}/whatsapp_commerce_settings,
 *                /{businessId}/commerce_accounts, /{catalogId} (rename/delete)
 *     Used by: messaging.service.ts, catalog-manager.service.ts
 *     Rationale: v24 introduced stable multi-product message templates and
 *                improved catalog filtering. Going higher than v24 risks breaking
 *                the whatsapp_commerce_settings edge on sandbox numbers.
 *
 *   WABA_ADMIN      v25.0
 *     Endpoints: /{wabaId}/phone_numbers (provision), /request_code, /verify_code,
 *                /{wabaId}/subscribed_apps (migration path),
 *                /{businessId}/owned_whatsapp_business_accounts,
 *                /{businessId}/system_user_access_tokens, /debug_token
 *     Used by: migration.service.ts, system-user.service.ts,
 *              catalog-manager.service.ts (WABA owner discovery)
 *     Rationale: v25 is required by the Force Migration OTP flow and the System
 *                User token escalation path. Previously isolated in those services
 *                with inline comments ("All v25.0"); now canonical here.
 *
 *   MESSAGES        v23.0
 *     Future-reserved for the outbound messages endpoint. Currently collapsed
 *     into PHONE_CATALOG (v24.0). Exposed as a separate constant so that a
 *     messages-only upgrade can be done without touching catalog endpoints.
 */
export const META_API = {
  /** OAuth token exchange, WABA verification, phone register + subscribe */
  TOKEN_EXCHANGE: 'v22.0',
  /** Outbound messages, catalog CRUD, whatsapp_commerce_settings */
  PHONE_CATALOG:  'v24.0',
  /** Migration OTP, WABA discovery, System User token escalation, debug_token */
  WABA_ADMIN:     'v25.0',
  /** Reserved for future messages-specific version alignment */
  MESSAGES:       'v23.0',

  /** Convenience: full base URL with a version injected */
  base(version: string): string {
    return `https://graph.facebook.com/${version}`;
  },
} as const;

export type MetaApiVersion = (typeof META_API)[keyof Omit<typeof META_API, 'base'>];

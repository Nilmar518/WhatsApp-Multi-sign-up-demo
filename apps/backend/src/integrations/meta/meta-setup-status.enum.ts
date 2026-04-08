/**
 * MetaSetupStatus — linear onboarding state machine for Meta/WhatsApp integration.
 *
 * Persisted to Firestore as `setupStatus` on `integrations/{integrationId}`.
 * Each value maps to a discrete step that can be retried independently if it fails.
 *
 * Progression:
 *   TOKEN_EXCHANGED → PHONE_REGISTERED → STATUS_VERIFIED → CATALOG_SELECTED → WEBHOOKS_SUBSCRIBED
 *
 * CATALOG_SELECTED is optional in the facade flow (requires user to pick a catalog).
 * The `status` field is kept in sync so the existing `useIntegrationStatus` hook
 * can surface granular progress without modification.
 */
export enum MetaSetupStatus {
  TOKEN_EXCHANGED     = 'TOKEN_EXCHANGED',
  PHONE_REGISTERED    = 'PHONE_REGISTERED',
  STATUS_VERIFIED     = 'STATUS_VERIFIED',
  CATALOG_SELECTED    = 'CATALOG_SELECTED',
  WEBHOOKS_SUBSCRIBED = 'WEBHOOKS_SUBSCRIBED',
}

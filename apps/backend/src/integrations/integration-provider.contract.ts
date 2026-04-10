/**
 * IntegrationProviderContract
 *
 * Every third-party integration provider must satisfy this contract.
 * It enforces a uniform lifecycle interface so IntegrationsService can
 * orchestrate any provider without provider-specific logic at the top level.
 *
 * Design notes (from INTEGRATIONS_ARCHITECTURE.md):
 *   - This is a TypeScript `type`, not an abstract class, which means
 *     enforcement is compile-time only. A future Phase could promote this to
 *     an abstract class to enable shared base logic (common logging, event
 *     emission). For now the type is sufficient.
 *   - `shareable` controls whether one integration document can be linked to
 *     multiple businesses via `connectedBusinessIds[]` (Phase 4).
 *     Meta is exclusive (shareable=false) — one phone number per business.
 */

export type IntegrationProvider = 'META' | 'META_MESSENGER' | 'META_INSTAGRAM';

export interface ConnectResult {
  integrationId: string;
}

export interface HealthStatus {
  healthy: boolean;
  reason?: string;
}

export interface IntegrationProviderContract {
  readonly provider: IntegrationProvider;
  readonly shareable: boolean;

  /**
   * Initiates the integration connection for a tenant.
   * `credentials` is provider-specific (OAuth code, API key, etc.).
   * Returns a `ConnectResult` containing the new `integrationId`.
   */
  connect(credentials: Record<string, unknown>): Promise<ConnectResult>;

  /**
   * Gracefully disconnects an integration.
   * Must revoke or invalidate stored tokens and reset Firestore status to IDLE.
   * Conversation history and non-sensitive metadata should be preserved.
   */
  disconnect(integrationId: string): Promise<void>;

  /**
   * Checks whether the stored credentials are still valid.
   * Returns `{ healthy: true }` or `{ healthy: false, reason: '...' }`.
   */
  healthCheck(integrationId: string): Promise<HealthStatus>;
}

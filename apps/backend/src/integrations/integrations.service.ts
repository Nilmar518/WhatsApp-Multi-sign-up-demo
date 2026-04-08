import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  IntegrationProvider,
  IntegrationProviderContract,
  ConnectResult,
  HealthStatus,
} from './integration-provider.contract';
import { MetaProvider } from './meta/meta.provider';
import { SecretManagerService } from '../common/secrets/secret-manager.service';
import { FirebaseService } from '../firebase/firebase.service';

/** Slim projection returned by GET /integrations?businessId=X */
export interface IntegrationSummary {
  integrationId: string;
  provider: string;
  status: string;
  setupStatus: string | null;
}

/**
 * IntegrationsService — central orchestrator for all integration providers.
 *
 * Holds a Map<IntegrationProvider, IntegrationProviderContract> and delegates
 * every lifecycle operation to the appropriate provider entry. Adding a new
 * provider (e.g. Google, BNB) requires only registering it in the constructor —
 * no changes to this service or the controller.
 *
 * Non-contract operations (e.g. hard reset for dev/demo) live here as explicit
 * methods so the controller remains thin and provider-agnostic.
 */
@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);
  private readonly providers: Map<IntegrationProvider, IntegrationProviderContract>;

  constructor(
    // Register all providers here. Each must implement IntegrationProviderContract.
    private readonly meta: MetaProvider,
    // Phase 3+ adds Google, BNB etc. as additional constructor parameters.
    private readonly secrets: SecretManagerService,
    private readonly firebase: FirebaseService,
  ) {
    this.providers = new Map<IntegrationProvider, IntegrationProviderContract>([
      ['META', this.meta],
    ]);
    this.logger.log(
      `[INTEGRATIONS] Registered providers: [${[...this.providers.keys()].join(', ')}]`,
    );
  }

  // ─── Provider access ────────────────────────────────────────────────────────

  /**
   * Returns the contract implementation for the given provider.
   * Throws NotFoundException for unknown providers so callers get a clear 404
   * rather than a runtime TypeError.
   */
  getProvider(provider: IntegrationProvider): IntegrationProviderContract {
    const p = this.providers.get(provider);
    if (!p) {
      throw new NotFoundException(
        `Provider '${provider}' is not registered. Available: [${[...this.providers.keys()].join(', ')}]`,
      );
    }
    return p;
  }

  // ─── Lifecycle delegation ───────────────────────────────────────────────────

  /**
   * Initiates a new integration connection for the given provider.
   * Delegates to `provider.connect(credentials)`.
   */
  async connect(
    provider: IntegrationProvider,
    credentials: Record<string, unknown>,
  ): Promise<ConnectResult> {
    return this.getProvider(provider).connect(credentials);
  }

  /**
   * Gracefully disconnects an integration, invalidating credentials and
   * resetting Firestore status to IDLE.
   * Delegates to `provider.disconnect(integrationId)`.
   */
  async disconnect(
    provider: IntegrationProvider,
    integrationId: string,
  ): Promise<void> {
    return this.getProvider(provider).disconnect(integrationId);
  }

  /**
   * Performs a health check on the stored credentials for the integration.
   * Delegates to `provider.healthCheck(integrationId)`.
   */
  async healthCheck(
    provider: IntegrationProvider,
    integrationId: string,
  ): Promise<HealthStatus> {
    return this.getProvider(provider).healthCheck(integrationId);
  }

  // ─── Multi-tenancy queries (Phase 4) ────────────────────────────────────────────

  /**
   * Returns all integration documents where connectedBusinessIds contains
   * the given businessId. Uses a Firestore array-contains query.
   *
   * In production, add a composite index on connectedBusinessIds (array-contains)
   * + provider (asc) for efficient lookups.
   */
  async findByBusinessId(businessId: string): Promise<IntegrationSummary[]> {
    const db = this.firebase.getFirestore();
    const snap = await db
      .collection('integrations')
      .where('connectedBusinessIds', 'array-contains', businessId)
      .get();

    return snap.docs.map((doc) => {
      const d = doc.data();
      return {
        integrationId: doc.id,
        provider:      (d.provider as string | undefined) ?? 'META',
        status:        (d.status as string | undefined) ?? 'IDLE',
        setupStatus:   (d.setupStatus as string | undefined) ?? null,
      };
    });
  }

  /**
   * Returns the list of known business IDs for the demo BusinessToggle.
   *
   * In the demo these are the two fixture IDs that the frontend always renders.
   * In production this would be replaced by a true business-registry lookup
   * (e.g. Firestore `businesses` collection or a dedicated service).
   *
   * This stub keeps the frontend working without wiring a full auth system.
   */
  listBusinessIds(): string[] {
    return ['787167007221172', 'demo-business-002'];
  }

  // ─── Non-contract operations (dev/demo only) ────────────────────────────────────

  /**
   * Hard-wipes the Firestore integration document and invalidates any stored
   * secret for the integration. Intended for development and demo resets only.
   *
   * This operation is intentionally NOT part of IntegrationProviderContract
   * because it is destructive and provider-agnostic — it bypasses the
   * disconnect lifecycle (e.g. no Meta Graph API call to unsubscribe).
   */
  async reset(integrationId: string): Promise<void> {
    const db = this.firebase.getFirestore();
    const docRef = db.collection('integrations').doc(integrationId);
    const snap = await docRef.get();

    if (!snap.exists) {
      throw new NotFoundException(
        `No integration found for integrationId=${integrationId}`,
      );
    }

    // Invalidate any provider tokens for this integration
    this.secrets.set(`META_TOKEN__${integrationId}`, '');

    await docRef.delete();

    this.logger.log(
      `[INTEGRATIONS] ✓ Hard reset — integrationId=${integrationId} document wiped`,
    );
  }
}

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  IntegrationProviderContract,
  ConnectResult,
  HealthStatus,
} from '../integration-provider.contract';
import { MetaIntegrationService } from './meta-integration.service';
import { SecretManagerService } from '../../common/secrets/secret-manager.service';
import { FirebaseService } from '../../firebase/firebase.service';
import { ExchangeTokenStepDto } from './dto/exchange-token-step.dto';

/**
 * MetaProvider — IntegrationProviderContract implementation for Meta/WhatsApp.
 *
 * This class is the single entry point for the IntegrationsService to interact
 * with all Meta-specific operations. It delegates setup steps to
 * MetaIntegrationService and owns the disconnect + health-check logic.
 *
 * Provider characteristics:
 *   shareable = false — one WhatsApp phone number is exclusive to one business.
 *   One Firestore `integrations/{id}` document per connected business.
 */
@Injectable()
export class MetaProvider implements IntegrationProviderContract {
  readonly provider = 'META' as const;
  readonly shareable = false;

  private readonly logger = new Logger(MetaProvider.name);

  constructor(
    private readonly metaService: MetaIntegrationService,
    private readonly secrets: SecretManagerService,
    private readonly firebase: FirebaseService,
  ) {}

  // ─── connect ───────────────────────────────────────────────────────────────

  /**
   * Step 1 of the setup state machine: exchanges the Facebook OAuth code for a
   * long-lived token and writes `setupStatus=TOKEN_EXCHANGED` to Firestore.
   *
   * `credentials` must satisfy the ExchangeTokenStepDto shape:
   *   { code, wabaId, phoneNumberId?, businessId? }
   *
   * Full onboarding (all 5 steps) is orchestrated either by the
   * backward-compat AuthService facade or by the useWhatsAppConnect hook (Phase 5).
   */
  async connect(credentials: Record<string, unknown>): Promise<ConnectResult> {
    const dto = credentials as unknown as ExchangeTokenStepDto;
    const result = await this.metaService.exchangeToken(dto);
    return { integrationId: result.integrationId };
  }

  // ─── disconnect ────────────────────────────────────────────────────────────

  /**
   * Gracefully disconnects a Meta/WhatsApp integration.
   *
   * Actions performed:
   *   1. Invalidate the stored access token in SecretManagerService.
   *   2. Reset Firestore status to IDLE and null out `metaData` credential fields.
   *
   * Preserved intentionally:
   *   - `messages/` sub-collection — conversation history survives reconnection.
   *   - `catalog` field — catalog link is preserved for when the business reconnects.
   *   - `setupStatus` — cleared to allow fresh onboarding on next connect.
   */
  async disconnect(integrationId: string): Promise<void> {
    const db = this.firebase.getFirestore();
    const docRef = db.collection('integrations').doc(integrationId);
    const snap = await docRef.get();

    if (!snap.exists) {
      throw new NotFoundException(
        `No integration found for integrationId=${integrationId}`,
      );
    }

    // Invalidate the secret so getMetaToken() fails fast after disconnect.
    // An empty string signals "no token". In production this would call
    // Secret Manager to disable the secret version.
    this.secrets.set(`META_TOKEN__${integrationId}`, '');

    // Reset Firestore — only touch credential-bearing and status fields.
    // The messages sub-collection and catalog are left intact.
    await this.firebase.update(docRef, {
      status: 'IDLE',
      setupStatus: null,
      'metaData.phoneNumberId': null,
      'metaData.wabaId': null,
      'metaData.tokenType': null,
      updatedAt: new Date().toISOString(),
    });

    this.logger.log(
      `[META_PROVIDER] ✓ Disconnected integrationId=${integrationId} — token invalidated, status=IDLE`,
    );
  }

  // ─── healthCheck ───────────────────────────────────────────────────────────

  /**
   * Lightweight health check: verifies that a non-empty token secret exists
   * for this integration and that the Firestore document is in a connected state.
   *
   * Phase 6 can extend this to call Meta's GET /debug_token endpoint for a
   * full token-validity and scope check.
   */
  async healthCheck(integrationId: string): Promise<HealthStatus> {
    // Check 1 — token must exist in SecretManagerService
    const raw = this.secrets.get(`META_TOKEN__${integrationId}`);
    if (!raw) {
      return {
        healthy: false,
        reason: 'No access token stored. Re-authenticate via the Embedded Signup flow.',
      };
    }

    let parsed: { accessToken?: string };
    try {
      parsed = JSON.parse(raw) as { accessToken?: string };
    } catch {
      return { healthy: false, reason: 'Stored token is malformed.' };
    }

    if (!parsed.accessToken) {
      return {
        healthy: false,
        reason: 'Stored token payload is missing the accessToken field.',
      };
    }

    // Check 2 — Firestore document must be in a connected state
    const db = this.firebase.getFirestore();
    const snap = await db.collection('integrations').doc(integrationId).get();

    if (!snap.exists) {
      return { healthy: false, reason: 'Integration document not found.' };
    }

    const status = snap.data()?.status as string | undefined;
    const connectedStatuses = new Set(['ACTIVE', 'WEBHOOKS_SUBSCRIBED', 'CATALOG_SELECTED']);

    if (!connectedStatuses.has(status ?? '')) {
      return {
        healthy: false,
        reason: `Integration status is '${status ?? 'unknown'}' — not in a connected state.`,
      };
    }

    this.logger.log(
      `[META_PROVIDER] healthCheck ✓ integrationId=${integrationId} status=${status}`,
    );
    return { healthy: true };
  }
}

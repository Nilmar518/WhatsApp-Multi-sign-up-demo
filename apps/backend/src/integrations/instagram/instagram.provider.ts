import { Injectable, Logger } from '@nestjs/common';
import {
  ConnectResult,
  HealthStatus,
  IntegrationProviderContract,
} from '../integration-provider.contract';
import { InstagramIntegrationService } from './instagram-integration.service';
import { FirebaseService } from '../../firebase/firebase.service';
import { InstagramSetupStatus } from './instagram-setup-status.enum';

@Injectable()
export class InstagramProvider implements IntegrationProviderContract {
  readonly provider = 'META_INSTAGRAM' as const;
  readonly shareable = false;

  private readonly logger = new Logger(InstagramProvider.name);

  constructor(
    private readonly instagramService: InstagramIntegrationService,
    private readonly firebase: FirebaseService,
  ) {}

  /**
   * Delegates to InstagramIntegrationService.setupInstagram().
   * credentials must contain: { shortLivedToken, businessId, pageId? }
   */
  async connect(credentials: Record<string, unknown>): Promise<ConnectResult> {
    const result = await this.instagramService.setupInstagram({
      shortLivedToken: credentials.shortLivedToken as string,
      businessId: credentials.businessId as string,
      pageId: credentials.pageId as string | undefined,
    });
    return { integrationId: result.integrationId };
  }

  async disconnect(integrationId: string): Promise<void> {
    const db     = this.firebase.getFirestore();
    const docRef = db.collection('integrations').doc(integrationId);
    await this.firebase.update(docRef, {
      status: 'IDLE',
      setupStatus: null,
      'metaData.accessToken': null,
      updatedAt: new Date().toISOString(),
    });

    this.logger.log(
      `[INSTAGRAM_PROVIDER] ✓ Disconnected — integrationId=${integrationId}`,
    );
  }

  async healthCheck(integrationId: string): Promise<HealthStatus> {
    const db   = this.firebase.getFirestore();
    const snap = await db.collection('integrations').doc(integrationId).get();

    if (!snap.exists) {
      return {
        healthy: false,
        reason: `No integration document found for integrationId=${integrationId}`,
      };
    }

    const data = snap.data() as {
      setupStatus?: string;
      metaData?: { accessToken?: string | null; igAccountId?: string };
    };

    if (!data.metaData?.accessToken) {
      return {
        healthy: false,
        reason: 'Page Access Token not found in Firestore metaData. Re-authenticate.',
      };
    }

    if (!data.metaData?.igAccountId) {
      return {
        healthy: false,
        reason: 'Instagram Business Account ID not resolved. Re-authenticate.',
      };
    }

    if (data.setupStatus !== InstagramSetupStatus.WEBHOOKS_SUBSCRIBED) {
      return {
        healthy: false,
        reason: `Integration setup incomplete — current status: ${data.setupStatus ?? 'unknown'}`,
      };
    }

    return { healthy: true };
  }
}

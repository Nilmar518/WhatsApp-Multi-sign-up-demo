import { Injectable, Logger } from '@nestjs/common';
import {
  ConnectResult,
  HealthStatus,
  IntegrationProviderContract,
} from '../integration-provider.contract';
import {
  MessengerIntegrationService,
} from './messenger-integration.service';
import { FirebaseService } from '../../firebase/firebase.service';
import { MessengerSetupStatus } from './messenger-setup-status.enum';

@Injectable()
export class MessengerProvider implements IntegrationProviderContract {
  readonly provider = 'META_MESSENGER' as const;

  /**
   * Messenger Pages can be shared — one Page can serve multiple businesses
   * through separate integration documents if needed.
   */
  readonly shareable = true;

  private readonly logger = new Logger(MessengerProvider.name);

  constructor(
    private readonly messengerService: MessengerIntegrationService,
    private readonly firebase: FirebaseService,
  ) {}

  /**
   * Delegates to MessengerIntegrationService.setupMessenger().
   * credentials must contain: { shortLivedToken, businessId, pageId? }
   */
  async connect(credentials: Record<string, unknown>): Promise<ConnectResult> {
    const result = await this.messengerService.setupMessenger({
      shortLivedToken: credentials.shortLivedToken as string,
      businessId: credentials.businessId as string,
      pageId: credentials.pageId as string | undefined,
    });
    return { integrationId: result.integrationId };
  }

  /**
   * Resets the integration document to IDLE using Firestore only.
   * Conversation history and Page metadata are preserved.
   */
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
      `[MESSENGER_PROVIDER] ✓ Disconnected — integrationId=${integrationId}`,
    );
  }

  /**
   * Returns healthy=true only when:
   *   - Firestore document exists with setupStatus=PAGE_SUBSCRIBED.
   *   - Page Access Token is present in Firestore metaData.accessToken.
   */
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
      metaData?: { accessToken?: string | null };
    };

    const token = data.metaData?.accessToken;
    if (!token) {
      return {
        healthy: false,
        reason: 'Page Access Token not found in Firestore metaData. Re-authenticate.',
      };
    }

    const status = data.setupStatus;
    if (status !== MessengerSetupStatus.PAGE_SUBSCRIBED) {
      return {
        healthy: false,
        reason: `Integration setup incomplete — current status: ${status ?? 'unknown'}`,
      };
    }

    return { healthy: true };
  }
}

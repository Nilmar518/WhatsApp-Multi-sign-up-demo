import { Injectable, Logger } from '@nestjs/common';
import { DefensiveLoggerService } from '../common/logger/defensive-logger.service';
import { SecretManagerService } from '../common/secrets/secret-manager.service';
import { FirebaseService } from '../firebase/firebase.service';

interface SystemUserTokenResponse {
  access_token: string;
  token_type: string;
}

@Injectable()
export class SystemUserService {
  private readonly logger = new Logger(SystemUserService.name);

  constructor(
    private readonly defLogger: DefensiveLoggerService,
    private readonly secrets: SecretManagerService,
    private readonly firebase: FirebaseService,
  ) {}

  /**
   * Attempts to exchange the long-lived user token for a permanent
   * System User Access Token via the Meta Business API.
   *
   * This method NEVER throws — escalation failure is non-fatal. The integration
   * remains ACTIVE on the 60-day long-lived token if escalation is not configured
   * or if the Meta API call fails.
   *
   * Prerequisites (in .env.secrets):
   *   META_BUSINESS_ID   — Business Manager ID
   *   META_SYSTEM_USER_ID — System User created in Business Manager with WABA role
   */
  async tryEscalate(
    businessId: string,
    longLivedToken: string,
  ): Promise<void> {
    const metaBusinessId = this.secrets.get('META_BUSINESS_ID');
    const systemUserId = this.secrets.get('META_SYSTEM_USER_ID');

    if (!metaBusinessId || !systemUserId) {
      this.logger.warn(
        '[SYSTEM_USER] META_BUSINESS_ID or META_SYSTEM_USER_ID not set in secrets — skipping escalation. ' +
          'Add them to .env.secrets to enable permanent tokens.',
      );
      return;
    }

    try {
      const response = await this.defLogger.request<SystemUserTokenResponse>({
        method: 'POST',
        url: `https://graph.facebook.com/v19.0/${metaBusinessId}/system_user_access_tokens`,
        headers: { Authorization: `Bearer ${longLivedToken}` },
        data: {
          system_user_id: systemUserId,
          scopes: 'whatsapp_business_messaging,whatsapp_business_management',
          set_token_expires_in_60_days: false,
        },
      });

      const permanentToken = response.access_token;
      const db = this.firebase.getFirestore();
      const docRef = db.collection('integrations').doc(businessId);

      await this.firebase.update(docRef, {
        'metaData.accessToken': permanentToken,
        'metaData.tokenType': 'SYSTEM_USER',
        updatedAt: new Date().toISOString(),
      });

      this.logger.log(
        `[SYSTEM_USER] ✓ Escalated to permanent System User token for businessId=${businessId}`,
      );
    } catch (err: any) {
      // Escalation failure does NOT downgrade the integration — long-lived token remains valid
      this.logger.error(
        `[SYSTEM_USER] ✗ Escalation failed for businessId=${businessId}: ${err.message as string}. ` +
          'Staying on 60-day long-lived token.',
      );
    }
  }
}

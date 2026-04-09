import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  NotImplementedException,
} from '@nestjs/common';
import { DefensiveLoggerService } from '../common/logger/defensive-logger.service';
import { FirebaseService } from '../firebase/firebase.service';
import { SendMessageDto } from './dto/send-message.dto';
import { META_API } from '../integrations/meta/meta-api-versions';

interface MetaMessageResponse {
  messaging_product: string;
  contacts: { input: string; wa_id: string }[];
  messages: { id: string }[];
}

interface MessengerMessageResponse {
  recipient_id: string;
  message_id: string;
}

export interface StoredMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  from: string;
  to?: string; // set on outbound messages — the customer's wa_id
  text: string;
  timestamp: string;
}

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly defLogger: DefensiveLoggerService,
    private readonly firebase: FirebaseService,
  ) {}

  async sendMessage(dto: SendMessageDto): Promise<{ messageId: string }> {
    const { provider } = dto;

    if (provider === 'META') {
      return this.sendWhatsAppMessage(dto);
    }

    if (provider === 'META_MESSENGER') {
      return this.sendMessengerMessage(dto);
    }

    throw new NotImplementedException(
      `Provider ${provider} is not implemented yet for outbound messaging.`,
    );
  }

  private async sendWhatsAppMessage(
    dto: SendMessageDto,
  ): Promise<{ messageId: string }> {
    const { businessId, recipientId, text } = dto;
    const db = this.firebase.getFirestore();

    // businessId is linked via connectedBusinessIds[]; Firestore doc ID is integrationId (UUID)
    const integrationSnap = await db
      .collection('integrations')
      .where('provider', '==', 'META')
      .where('connectedBusinessIds', 'array-contains', businessId)
      .limit(1)
      .get();

    if (integrationSnap.empty) {
      throw new NotFoundException(
        `No integration found for businessId=${businessId}`,
      );
    }

    const docRef = integrationSnap.docs[0].ref;
    const integrationId = integrationSnap.docs[0].id;
    const data = integrationSnap.docs[0].data();

    const { accessToken, phoneNumberId } = (data.metaData ?? {}) as {
      accessToken?: string;
      phoneNumberId?: string;
    };

    // Capability-based validation: do not block on status value (ACTIVE/WEBHOOKS_SUBSCRIBED/etc).
    if (!accessToken || !phoneNumberId) {
      throw new BadRequestException(
        'Integration is not fully connected. Run the Embedded Signup flow first.',
      );
    }

    const response = await this.defLogger.request<MetaMessageResponse>({
      method: 'POST',
      url: `${META_API.base(META_API.PHONE_CATALOG)}/${phoneNumberId}/messages`,
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipientId,
        type: 'text',
        text: { body: text },
      },
    });

    const messageId = response.messages?.[0]?.id ?? 'unknown';
    this.logger.log(
      `[SEND] ✓ provider=META integrationId=${integrationId} wamid=${messageId} → ${recipientId}`,
    );

    const outboundMsg: StoredMessage = {
      id: messageId,
      direction: 'outbound',
      from: phoneNumberId,
      to: recipientId, // customer's wa_id/phone — used by frontend to thread conversations
      text,
      timestamp: new Date().toISOString(),
    };

    // Write to messages sub-collection for real-time frontend sync
    await docRef.collection('messages').doc(messageId).set(outboundMsg);

    // Touch updatedAt on the root doc so listeners see a fresh snapshot
    await this.firebase.update(docRef, { updatedAt: new Date().toISOString() });

    return { messageId };
  }

  private async sendMessengerMessage(
    dto: SendMessageDto,
  ): Promise<{ messageId: string }> {
    const { businessId, recipientId, text, message } = dto;
    const db = this.firebase.getFirestore();

    const integrationSnap = await db
      .collection('integrations')
      .where('provider', '==', 'META_MESSENGER')
      .where('connectedBusinessIds', 'array-contains', businessId)
      .limit(1)
      .get();

    if (integrationSnap.empty) {
      throw new NotFoundException(
        `No META_MESSENGER integration found for businessId=${businessId}`,
      );
    }

    const docRef = integrationSnap.docs[0].ref;
    const integrationId = integrationSnap.docs[0].id;
    const data = integrationSnap.docs[0].data() as {
      metaData?: { pageId?: string; accessToken?: string };
    };

    const pageId = data.metaData?.pageId ?? '';
    const pageToken = data.metaData?.accessToken ?? '';

    if (!pageToken || !pageId) {
      throw new BadRequestException(
        'Messenger integration is not fully connected. Run Messenger setup first.',
      );
    }

    const response = await this.defLogger.request<MessengerMessageResponse>({
      method: 'POST',
      url: `${META_API.base(META_API.WABA_ADMIN)}/me/messages`,
      headers: { Authorization: `Bearer ${pageToken}` },
      data: {
        recipient: { id: recipientId },
        message: message ?? { text },
        messaging_type: 'RESPONSE',
      },
    });

    const messageId = response.message_id ?? 'unknown';
    this.logger.log(
      `[SEND] ✓ provider=META_MESSENGER integrationId=${integrationId} mid=${messageId} → ${recipientId}`,
    );

    const outboundMsg: StoredMessage = {
      id: messageId,
      direction: 'outbound',
      from: pageId,
      to: recipientId,
      text,
      timestamp: new Date().toISOString(),
    };

    await docRef.collection('messages').doc(messageId).set(outboundMsg);
    await this.firebase.update(docRef, { updatedAt: new Date().toISOString() });

    return { messageId };
  }
}

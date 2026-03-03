import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DefensiveLoggerService } from '../common/logger/defensive-logger.service';
import { FirebaseService } from '../firebase/firebase.service';
import { SendMessageDto } from './dto/send-message.dto';

interface MetaMessageResponse {
  messaging_product: string;
  contacts: { input: string; wa_id: string }[];
  messages: { id: string }[];
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
    const { businessId, recipientPhoneNumber, text } = dto;
    const db = this.firebase.getFirestore();
    const docRef = db.collection('integrations').doc(businessId);
    const snap = await docRef.get();

    if (!snap.exists) {
      throw new NotFoundException(
        `No integration found for businessId=${businessId}`,
      );
    }

    const { accessToken, phoneNumberId } = (snap.data()?.metaData ?? {}) as {
      accessToken?: string;
      phoneNumberId?: string;
    };

    if (!accessToken || !phoneNumberId) {
      throw new BadRequestException(
        'Integration is not fully connected. Run the Embedded Signup flow first.',
      );
    }

    const response = await this.defLogger.request<MetaMessageResponse>({
      method: 'POST',
      url: `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipientPhoneNumber,
        type: 'text',
        text: { body: text },
      },
    });

    const messageId = response.messages?.[0]?.id ?? 'unknown';
    this.logger.log(`[SEND] ✓ wamid=${messageId} → ${recipientPhoneNumber}`);

    const outboundMsg: StoredMessage = {
      id: messageId,
      direction: 'outbound',
      from: phoneNumberId,
      to: recipientPhoneNumber, // customer's wa_id — used by frontend to thread conversations
      text,
      timestamp: new Date().toISOString(),
    };

    // Write to messages sub-collection for real-time frontend sync
    await docRef.collection('messages').doc(messageId).set(outboundMsg);

    // Touch updatedAt on the root doc so listeners see a fresh snapshot
    await this.firebase.update(docRef, { updatedAt: new Date().toISOString() });

    return { messageId };
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';

// ─── Meta Webhook payload types ──────────────────────────────────────────────

interface MetaWebhookPayload {
  object?: string;
  entry?: MetaEntry[];
}

interface MetaEntry {
  id: string;
  changes?: MetaChange[];
}

interface MetaChange {
  field?: string;
  value?: MetaChangeValue | AccountUpdateValue;
}

interface MetaChangeValue {
  messaging_product?: string;
  metadata?: {
    display_phone_number?: string;
    phone_number_id?: string;
  };
  messages?: MetaInboundMessage[];
  statuses?: unknown[]; // delivery receipts — not processed in this iteration
}

// ─── account_update system event types ───────────────────────────────────────

interface AccountUpdateValue {
  event?: string;
  waba_info?: {
    waba_id?: string;
  };
  owner_business_id?: string;
}

interface MetaInboundMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
}

// ─── Internal parsed shape ───────────────────────────────────────────────────

interface ParsedInboundMessage {
  waMessageId: string;
  from: string;
  text: string;
  timestamp: string;
  phoneNumberId: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_PROVISIONING_BUSINESS_ID = 'demo-business-001';

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(private readonly firebase: FirebaseService) {}

  /**
   * Entry point called by WebhookController.
   * Always resolves — never throws — so the controller can safely return 200
   * to Meta even when payloads are malformed or unexpected.
   */
  async processInbound(payload: unknown): Promise<void> {
    // ── Detect PARTNER_APP_INSTALLED before normal message parsing ────────────
    // This fires when the BSP app is installed on a WABA, even if the frontend
    // OAuth handshake has not completed yet. We use it as a fail-safe to write
    // a PENDING_TOKEN stub so the integration identity is never lost.
    try {
      const typed = payload as MetaWebhookPayload;
      for (const entry of typed.entry ?? []) {
        for (const change of entry.changes ?? []) {
          if (change.field === 'account_update') {
            const v = change.value as AccountUpdateValue;
            if (v?.event === 'PARTNER_APP_INSTALLED') {
              await this.provisionFromWebhook(
                v.waba_info?.waba_id ?? '',
                v.owner_business_id ?? '',
              );
            }
          }
        }
      }
    } catch (err: any) {
      this.logger.error(
        `[WEBHOOK_PROVISIONING] ✗ Provisioning error: ${err.message as string}`,
      );
      // Non-fatal — continue to regular message processing
    }

    // ── Regular inbound message processing ───────────────────────────────────
    let parsed: ParsedInboundMessage[];

    try {
      parsed = this.parseMetaPayload(payload as MetaWebhookPayload);
    } catch (err: any) {
      // Defensive: log the raw payload verbatim so we can debug offline
      this.logger.error(
        `[WEBHOOK_PARSE_FAILURE] ${err.message as string}`,
      );
      this.logger.error(
        `[WEBHOOK_RAW_PAYLOAD] ${JSON.stringify(payload)}`,
      );
      return;
    }

    if (!parsed.length) {
      // Common case: status/delivery receipt update or system event — nothing to store
      this.logger.debug(
        '[WEBHOOK_EVENT] No actionable text messages in payload (likely a status update or system event)',
      );
      return;
    }

    for (const msg of parsed) {
      await this.persistInboundMessage(msg);
    }
  }

  // ── Provisioning ──────────────────────────────────────────────────────────

  /**
   * Called when Meta fires PARTNER_APP_INSTALLED on the account_update webhook.
   * Writes a PENDING_TOKEN stub to Firestore so the WABA identity is persisted
   * even if the frontend OAuth flow has not completed.
   *
   * Idempotent: skips if the integration is already ACTIVE.
   */
  private async provisionFromWebhook(
    wabaId: string,
    ownerBusinessId: string,
  ): Promise<void> {
    this.logger.log(
      `[WEBHOOK_PROVISIONING]: Detected asset installation for WABA ${wabaId}. Initializing Firestore record...`,
    );

    if (!wabaId) {
      this.logger.warn(
        '[WEBHOOK_PROVISIONING] waba_id missing in payload — skipping',
      );
      return;
    }

    const db = this.firebase.getFirestore();
    const docRef = db
      .collection('integrations')
      .doc(DEFAULT_PROVISIONING_BUSINESS_ID);

    const existing = await docRef.get();
    const existingStatus = existing.exists
      ? (existing.data()?.status as string)
      : null;

    // Never downgrade a fully-active integration
    if (existingStatus === 'ACTIVE') {
      this.logger.log(
        `[WEBHOOK_PROVISIONING] integrations/${DEFAULT_PROVISIONING_BUSINESS_ID} already ACTIVE — skipping`,
      );
      return;
    }

    const stubPayload = {
      businessId: DEFAULT_PROVISIONING_BUSINESS_ID,
      status: 'PENDING_TOKEN',
      metaData: { wabaId, ownerBusinessId },
      updatedAt: new Date().toISOString(),
    };

    await this.firebase.set(docRef, stubPayload, { merge: true });

    this.logger.log(
      `[WEBHOOK_PROVISIONING] ✓ integrations/${DEFAULT_PROVISIONING_BUSINESS_ID} set to PENDING_TOKEN (wabaId=${wabaId})`,
    );
  }

  // ── Parsing ───────────────────────────────────────────────────────────────

  private parseMetaPayload(payload: MetaWebhookPayload): ParsedInboundMessage[] {
    const results: ParsedInboundMessage[] = [];

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        // Only process `messages` field events
        if (change.field !== 'messages') continue;

        const value = change.value as MetaChangeValue;
        const phoneNumberId = value?.metadata?.phone_number_id ?? '';

        for (const msg of value?.messages ?? []) {
          if (msg.type !== 'text' || !msg.text?.body) {
            this.logger.warn(
              `[WEBHOOK_SKIP] Unsupported message type="${msg.type}" from=${msg.from} — only "text" is handled`,
            );
            continue;
          }

          results.push({
            waMessageId: msg.id,
            from: msg.from,
            text: msg.text.body,
            // Meta timestamps are Unix seconds — convert to ISO
            timestamp: new Date(parseInt(msg.timestamp, 10) * 1000).toISOString(),
            phoneNumberId,
          });
        }
      }
    }

    return results;
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  private async persistInboundMessage(msg: ParsedInboundMessage): Promise<void> {
    const db = this.firebase.getFirestore();

    // Diagnostic: log the exact phoneNumberId extracted from the Meta payload
    // so it can be compared against what's stored in Firestore → metaData.phoneNumberId
    this.logger.log(
      `[WEBHOOK_STORE] Querying integrations where metaData.phoneNumberId == "${msg.phoneNumberId}"`,
    );

    // Locate the integration document by the receiving phone number ID
    const snapshot = await db
      .collection('integrations')
      .where('metaData.phoneNumberId', '==', msg.phoneNumberId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      this.logger.warn(
        `[WEBHOOK_STORE] ✗ No integration found for phoneNumberId="${msg.phoneNumberId}" — message dropped. ` +
        `Check Firestore: integrations/*/metaData.phoneNumberId must equal this value exactly.`,
      );
      return;
    }

    const docRef = snapshot.docs[0].ref;
    const subcollectionPath = `${docRef.path}/messages/${msg.waMessageId}`;

    this.logger.log(
      `[WEBHOOK_STORE] Found integration doc: ${docRef.path} — writing to ${subcollectionPath}`,
    );

    const storedMsg = {
      id: msg.waMessageId,
      direction: 'inbound' as const,
      from: msg.from,
      text: msg.text,
      timestamp: msg.timestamp,
    };

    // Write to messages sub-collection so the frontend real-time listener picks it up instantly
    await docRef.collection('messages').doc(msg.waMessageId).set(storedMsg);

    // Touch updatedAt on the root doc so useIntegrationStatus listeners get a fresh snapshot
    await this.firebase.update(docRef, { updatedAt: new Date().toISOString() });

    this.logger.log(
      `[WEBHOOK_STORE] ✓ Saved inbound wamid=${msg.waMessageId} from=${msg.from} → ${subcollectionPath}`,
    );
  }
}

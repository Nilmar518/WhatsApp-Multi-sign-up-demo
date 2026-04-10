import { Injectable, Logger } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { DefensiveLoggerService } from '../common/logger/defensive-logger.service';
import { SecretManagerService } from '../common/secrets/secret-manager.service';
import type { AutoReply } from '../auto-reply/auto-reply.types';
import { MatchType } from '../auto-reply/auto-reply.types';
import { CartService } from '../cart/cart.service';
import type { IncomingOrderItem } from '../cart/cart.types';
import { MessagingService } from '../messaging/messaging.service';
import {
  sendWhatsAppText,
  sendWhatsAppInteractive,
} from '../common/utils/send-whatsapp-text';
import { META_API } from '../integrations/meta/meta-api-versions';

// ─── Meta Webhook payload types ──────────────────────────────────────────────

interface MetaWebhookPayload {
  object?: string;
  entry?: MetaEntry[];
}

interface MetaEntry {
  id: string;
  changes?: MetaChange[];
  messaging?: MessengerEvent[];
  standby?: MessengerEvent[];
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

// ─── catalog_item_update event types ─────────────────────────────────────────

interface CatalogItemUpdateValue {
  /** Meta product item ID */
  item_id?: string;
  /** Merchant-defined SKU / retailer ID */
  retailer_id?: string;
  /** Current review status sent by Meta's policy engine */
  review_status?: string;
  rejection_reasons?: string[];
}

interface MetaInboundMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  /** Present when type === 'order' (native WhatsApp Cart) */
  order?: {
    catalog_id: string;
    text?: string;
    product_items: Array<{
      product_retailer_id: string;
      quantity: number;
      item_price: number;
      currency: string;
    }>;
  };
  /**
   * Present when type === 'interactive' — the customer tapped a button or
   * selected a list item in one of our interactive messages.
   */
  interactive?: {
    /** Discriminates button replies from list replies */
    type: 'button_reply' | 'list_reply' | string;
    /** Populated for button messages (our cart action buttons) */
    button_reply?: {
      /** The id we set when building the button — e.g. "CMD_VIEW_MPM" */
      id: string;
      title: string;
    };
    list_reply?: {
      id: string;
      title: string;
      description?: string;
    };
  };
}

interface MessengerEvent {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
  };
}

// ─── Instagram webhook types ──────────────────────────────────────────────────

interface InstagramAttachment {
  /** 'story_mention' | 'image' | 'video' | 'audio' | 'file' | 'share' */
  type: string;
  payload?: { url?: string; sticker_id?: number };
}

interface InstagramMessageEvent {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  is_echo?: boolean;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    attachments?: InstagramAttachment[];
    /** Stringified JSON metadata — some clients encode story_mention here */
    metadata?: string;
  };
}

/**
 * Payload of entry[].changes[].value when field === 'comments'.
 * Represents a public comment on an Instagram Post or Reel.
 */
interface InstagramCommentValue {
  /** The unique Comment ID — used as idempotency key for Private Replies */
  id?: string;
  text?: string;
  from?: { id?: string; username?: string };
  media?: { id?: string; media_product_type?: string };
  /** Unix epoch seconds of comment creation */
  created_time?: number;
  /** Set when this is a reply to another comment */
  parent_id?: string;
}

interface InstagramGraphMeResponse {
  id?: string;
  user_id?: string;
}

type InstagramInteractionType = 'DIRECT_MESSAGE' | 'STORY_MENTION' | 'COMMENT';

// ─── Internal parsed shape ───────────────────────────────────────────────────

interface ParsedInboundMessage {
  waMessageId: string;
  from: string;
  /** 'text' | 'order' | 'interactive' — controls routing in evaluateAndRespond */
  type: string;
  text: string;
  timestamp: string;
  phoneNumberId: string;
  /** Populated when type === 'order' */
  orderItems?: IncomingOrderItem[];
  /** Populated when type === 'interactive' — the button id the customer tapped */
  buttonReplyId?: string;
}

// ─── Integration context returned after persistence ──────────────────────────

interface IntegrationContext {
  businessId: string;
  provider: 'META' | 'META_MESSENGER' | 'META_INSTAGRAM' | string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  docRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>;
  integrationId: string;
  accessToken: string;
  phoneNumberId: string;
  catalog?: { catalogId: string; [key: string]: unknown };
}

interface BusinessCatalogContext {
  catalogId: string;
  catalogDocRef: FirebaseFirestore.DocumentReference;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_PROVISIONING_BUSINESS_ID = '787167007221172';
const META_GRAPH_MESSAGES = META_API.base(META_API.PHONE_CATALOG);
const INSTAGRAM_GRAPH_BASE = 'https://graph.instagram.com';
const FACEBOOK_GRAPH_BASE = 'https://graph.facebook.com';
const INSTAGRAM_API_VERSION = 'v25.0';

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly firebase: FirebaseService,
    private readonly defLogger: DefensiveLoggerService,
    private readonly secrets: SecretManagerService,
    private readonly cartService: CartService,
    private readonly messagingService: MessagingService,
  ) {}

  /**
   * Entry point called by WebhookController.
   * Backward-compatible alias for the WhatsApp pipeline.
   */
  async processInbound(payload: unknown): Promise<void> {
    await this.processWhatsAppInbound(payload);
  }

  /**
   * WhatsApp pipeline entry point.
   * Always resolves — never throws — so the controller can safely return 200
   * to Meta even when payloads are malformed or unexpected.
   */
  async processWhatsAppInbound(payload: unknown): Promise<void> {
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

          if (change.field === 'catalog_item_update') {
            await this.handleCatalogItemUpdate(
              change.value as CatalogItemUpdateValue,
            );
          }
        }
      }
    } catch (err: unknown) {
      this.logger.error(
        `[WEBHOOK_PROVISIONING] ✗ Provisioning error: ${(err as Error).message}`,
      );
      // Non-fatal — continue to regular message processing
    }

    // ── Regular inbound message processing ───────────────────────────────────
    let parsed: ParsedInboundMessage[];

    try {
      parsed = this.parseMetaPayload(payload as MetaWebhookPayload);
    } catch (err: unknown) {
      // Defensive: log the raw payload verbatim so we can debug offline
      this.logger.error(
        `[WEBHOOK_PARSE_FAILURE] ${(err as Error).message}`,
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
      const context = await this.persistInboundMessage(msg);
      if (context) {
        try {
          await this.evaluateAndRespond(msg, context);
        } catch (err: unknown) {
          this.logger.error(
            `[RULE_ENGINE] ✗ Rule evaluation error for wamid=${msg.waMessageId}: ${(err as Error).message}`,
          );
          // Non-fatal — message was already persisted successfully
        }
      }
    }
  }

  /**
   * Messenger pipeline entry point for `object=page` webhook payloads.
   * Parses both active channel events (`messaging`) and passive channel events
   * (`standby`) and stores inbound text messages under integrations/{id}/messages.
   */
  async processMessengerInbound(payload: unknown): Promise<void> {
    const typed = payload as MetaWebhookPayload;

    for (const entry of typed.entry ?? []) {
      const pageId = entry.id;
      if (!pageId) continue;

      const integrationDoc = await this.findMessengerIntegrationByPageId(pageId);
      if (!integrationDoc) {
        this.logger.warn(
          `[MESSENGER_WEBHOOK] No META_MESSENGER integration found for pageId=${pageId}`,
        );
        continue;
      }

      const events = [
        ...(entry.messaging ?? []).map((event) => ({ channel: 'messaging' as const, event })),
        ...(entry.standby ?? []).map((event) => ({ channel: 'standby' as const, event })),
      ];

      const data = integrationDoc.data() as {
        provider?: string;
        connectedBusinessIds?: string[];
        metaData?: { accessToken?: string; pageId?: string; catalogId?: string };
        catalog?: { catalogId?: string; [key: string]: unknown };
      };

      const businessId = data.connectedBusinessIds?.[0] ?? integrationDoc.id;
      const provider = data.provider ?? 'META_MESSENGER';
      const pageToken = data.metaData?.accessToken ?? '';
      const pageIdFromDoc = data.metaData?.pageId ?? pageId;
      const integrationCatalogId = data.metaData?.catalogId ?? data.catalog?.catalogId;
      const catalog = data.catalog as { catalogId?: string; [key: string]: unknown } | undefined;

      for (const { channel, event } of events) {
        const senderId = event.sender?.id ?? '';
        const text = event.message?.text ?? '';
        const rawTimestamp = event.timestamp;
        const timestamp =
          typeof rawTimestamp === 'number'
            ? new Date(rawTimestamp).toISOString()
            : new Date().toISOString();

        if (!senderId || !text.trim()) continue;

        const messageId =
          event.message?.mid ?? `messenger_${pageId}_${senderId}_${rawTimestamp ?? Date.now()}`;

        await this.storeMessengerInboundMessage(
          integrationDoc.ref,
          messageId,
          senderId,
          text,
          timestamp,
          channel,
          pageId,
        );

        // Only active-channel text messages feed the rule engine.
        if (channel === 'messaging') {
          await this.evaluateAndRespond(
            {
              waMessageId: messageId,
              from: senderId,
              type: 'text',
              text,
              timestamp,
              phoneNumberId: pageIdFromDoc,
            },
            {
              businessId,
              provider,
              docRef: integrationDoc.ref,
              integrationId: integrationDoc.id,
              accessToken: pageToken,
              phoneNumberId: pageIdFromDoc,
              catalog: integrationCatalogId
                ? ({ catalogId: integrationCatalogId } as { catalogId: string; [key: string]: unknown })
                : undefined,
            },
          );
        }
      }
    }
  }

  private async findMessengerIntegrationByPageId(pageId: string) {
    const db = this.firebase.getFirestore();
    const snapshot = await db
      .collection('integrations')
      .where('provider', '==', 'META_MESSENGER')
      .where('metaData.pageId', '==', pageId)
      .limit(1)
      .get();

    if (snapshot.empty) return null;
    return snapshot.docs[0];
  }

  private async storeMessengerInboundMessage(
    docRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>,
    messageId: string,
    from: string,
    text: string,
    timestamp: string,
    channel: 'messaging' | 'standby',
    pageId: string,
  ): Promise<void> {
    const db = this.firebase.getFirestore();
    const msgRef = docRef.collection('messages').doc(messageId);

    let isDuplicate = false;
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(msgRef);
      if (existing.exists) {
        isDuplicate = true;
        return;
      }

      tx.set(msgRef, {
        id: messageId,
        direction: 'inbound',
        from,
        text,
        timestamp,
        pageId,
        channel,
      });
    });

    if (isDuplicate) {
      this.logger.warn(
        `[MESSENGER_WEBHOOK] Duplicate inbound message ignored id=${messageId} pageId=${pageId}`,
      );
      return;
    }

    await this.firebase.update(docRef, { updatedAt: new Date().toISOString() });

    this.logger.log(
      `[MESSENGER_WEBHOOK] Saved inbound id=${messageId} pageId=${pageId} channel=${channel}`,
    );
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
          // Meta timestamps are Unix seconds — convert to ISO
          const ts = new Date(parseInt(msg.timestamp, 10) * 1000).toISOString();

          if (msg.type === 'text' && msg.text?.body) {
            results.push({
              waMessageId: msg.id,
              from: msg.from,
              type: 'text',
              text: msg.text.body,
              timestamp: ts,
              phoneNumberId,
            });
          } else if (msg.type === 'order' && msg.order?.product_items?.length) {
            // Native WhatsApp Cart — route to CartService in evaluateAndRespond
            results.push({
              waMessageId: msg.id,
              from: msg.from,
              type: 'order',
              text: `[Carrito: ${msg.order.product_items.length} producto(s)]`,
              timestamp: ts,
              phoneNumberId,
              orderItems: msg.order.product_items.map((item) => ({
                productRetailerId: item.product_retailer_id,
                quantity: item.quantity,
                itemPrice: item.item_price,
                currency: item.currency,
              })),
            });
          } else if (
            msg.type === 'interactive' &&
            msg.interactive?.type === 'button_reply' &&
            msg.interactive.button_reply?.id
          ) {
            // Button-reply from one of our interactive messages (CMD_VIEW_MPM, CMD_PAY_CART, …)
            results.push({
              waMessageId:   msg.id,
              from:          msg.from,
              type:          'interactive',
              // Human-readable label stored in Firestore for the chat timeline
              text:          `[Button: ${msg.interactive.button_reply.title ?? msg.interactive.button_reply.id}]`,
              timestamp:     ts,
              phoneNumberId,
              buttonReplyId: msg.interactive.button_reply.id,
            });
          } else {
            this.logger.warn(
              `[WEBHOOK_SKIP] Unsupported message type="${msg.type}" from=${msg.from} — skipping`,
            );
          }
        }
      }
    }

    return results;
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  /**
   * Writes the inbound message to Firestore and returns the integration context
   * needed for rule evaluation. Returns null if no matching integration is found.
   */
  private async persistInboundMessage(
    msg: ParsedInboundMessage,
  ): Promise<IntegrationContext | null> {
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
      return null;
    }

    const doc = snapshot.docs[0];
    const docRef = doc.ref;
    const data = doc.data() as Record<string, unknown>;
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

    // ── Distributed lock via Firestore transaction ────────────────────────────
    // The read-check-then-write pattern (read → exists? → write) has a race
    // condition when Meta delivers the same webhook concurrently: two handlers
    // can both pass the read check before either writes, causing a duplicate
    // auto-reply. A Firestore transaction makes the check-and-create atomic —
    // only one concurrent writer will succeed; the other will see the document
    // already exists and abort cleanly.
    const msgRef = docRef.collection('messages').doc(msg.waMessageId);
    let isDuplicate = false;

    await db.runTransaction(async (tx) => {
      const existing = await tx.get(msgRef);
      if (existing.exists) {
        isDuplicate = true;
        return; // no writes — transaction completes with no mutation
      }
      tx.set(msgRef, storedMsg);
    });

    if (isDuplicate) {
      this.logger.warn(
        `[WEBHOOK_IDEMPOTENCY] wamid=${msg.waMessageId} already processed — ` +
        `duplicate delivery blocked by distributed lock`,
      );
      return null;
    }

    // Touch updatedAt on the root doc so useIntegrationStatus listeners get a fresh snapshot
    await this.firebase.update(docRef, { updatedAt: new Date().toISOString() });

    this.logger.log(
      `[WEBHOOK_STORE] ✓ Saved inbound wamid=${msg.waMessageId} from=${msg.from} → ${subcollectionPath}`,
    );

    // Return integration context for rule evaluation.
    // In Hybrid POC, token + phoneNumberId are read directly from metaData.
    const connectedBusinessIds = (data.connectedBusinessIds ?? []) as string[];
    const realBusinessId = connectedBusinessIds[0] ?? '';
    const metaData = (data.metaData ?? {}) as {
      accessToken?: string;
      phoneNumberId?: string;
      catalogId?: string;
    };
    const catalog = data.catalog as { catalogId?: string } | undefined;
    const integrationCatalogId = metaData.catalogId ?? catalog?.catalogId;

    if (!realBusinessId) {
      this.logger.warn(
        `[WEBHOOK_CTX] connectedBusinessIds missing for integrationId=${doc.id} — rule evaluation may be skipped`,
      );
    }

    if (!metaData.accessToken) {
      this.logger.warn(
        `[WEBHOOK_CTX] No Meta token found in integration metaData for integrationId=${doc.id}`,
      );
    }

    return {
      businessId: realBusinessId || doc.id,
      provider: (data.provider as string | undefined) ?? 'META',
      docRef,
      integrationId: doc.id,
      accessToken: metaData.accessToken ?? '',
      phoneNumberId: metaData.phoneNumberId ?? '',
      catalog: integrationCatalogId
        ? ({ catalogId: integrationCatalogId } as { catalogId: string; [key: string]: unknown })
        : undefined,
    };
  }

  // ── Rule Engine ───────────────────────────────────────────────────────────

  /**
   * Evaluates inbound message text against active auto-reply rules.
   * If a rule matches and a catalog is linked, sends a WhatsApp product_list
   * interactive message back to the sender.
   */
  private async evaluateAndRespond(
    msg: ParsedInboundMessage,
    context: IntegrationContext,
  ): Promise<void> {
    const { businessId, provider, docRef, accessToken, phoneNumberId, catalog, integrationId } = context;

    // ── Handle interactive button replies (CMD_VIEW_MPM, CMD_PAY_CART, …) ──────
    // Routed first — these come from our own interactive messages and are
    // entirely distinct from text commands or native cart orders.
    if (provider === 'META' && msg.type === 'interactive' && msg.buttonReplyId) {
      try {
        await this.handleInteractiveReply(msg, context);
      } catch (err: unknown) {
        this.logger.error(
          `[INTERACTIVE] ✗ handleInteractiveReply failed for id="${msg.buttonReplyId}": ` +
          `${(err as Error).message}`,
        );
      }
      return;
    }

    // ── Handle native WhatsApp Cart (type === 'order') ────────────────────────
    // Sync the customer's cart to Firestore and skip the keyword rule engine.
    if (provider === 'META' && msg.type === 'order' && msg.orderItems?.length) {
      try {
        await this.cartService.syncFromNativeOrder(
          businessId,
          msg.from,
          msg.orderItems,
          msg.waMessageId,
        );
        this.logger.log(
          `[CART_ENGINE] ✓ Native order synced — businessId=${businessId} from=${msg.from} items=${msg.orderItems.length}`,
        );
      } catch (err: unknown) {
        this.logger.error(
          `[CART_ENGINE] ✗ syncFromNativeOrder failed: ${(err as Error).message}`,
        );
      }
      return; // Do not run keyword rule engine for cart messages
    }

    // ── Handle cart text commands ─────────────────────────────────────────────
    // Check before the keyword rule engine so "borrar carrito" doesn't
    // accidentally trigger an unrelated keyword rule.
    let cartResult: Awaited<ReturnType<CartService['tryHandleTextCommand']>> = null;
    if (provider === 'META') {
      try {
        cartResult = await this.cartService.tryHandleTextCommand(
          businessId,
          msg.from,
          msg.text,
        );
      } catch (err: unknown) {
        this.logger.error(
          `[CART_ENGINE] ✗ tryHandleTextCommand failed: ${(err as Error).message}`,
        );
      }
    }

    if (provider === 'META' && cartResult) {
      this.logger.log(
        `[CART_ENGINE] ✓ Cart command "${cartResult.action}" — businessId=${businessId} from=${msg.from}`,
      );

      // Send WhatsApp reply with the cart command result.
      // view_cart with items → interactive button message.
      // All other actions  → plain text message.
      if (accessToken && phoneNumberId) {
        const systemToken = this.secrets.get('META_SYSTEM_USER_TOKEN') ?? accessToken;
        try {
          let wamid: string;

          if (cartResult.interactivePayload) {
            // ── Interactive button message (VIEW CART — populated) ───────────
            ({ wamid } = await sendWhatsAppInteractive({
              phoneNumberId,
              recipientWaId: msg.from,
              interactive:   cartResult.interactivePayload,
              accessToken:   systemToken,
            }));
          } else {
            // ── Plain text (ADD, SUBTRACT, CLEAR, VIEW empty) ────────────────
            ({ wamid } = await sendWhatsAppText({
              phoneNumberId,
              recipientWaId: msg.from,
              text:          cartResult.responseText,
              accessToken:   systemToken,
            }));
          }

          // Persist to Firestore regardless of message type.
          // responseText is used as the chat-timeline label in both cases.
          await docRef.collection('messages').doc(wamid).set({
            id:        wamid,
            direction: 'outbound',
            from:      phoneNumberId,
            to:        msg.from,
            text:      cartResult.responseText,
            timestamp: new Date().toISOString(),
          });
          await this.firebase.update(docRef, { updatedAt: new Date().toISOString() });

          this.logger.log(
            `[CART_ENGINE] ✓ Cart reply sent — wamid=${wamid} to=${msg.from} ` +
            `action=${cartResult.action} type=${cartResult.interactivePayload ? 'interactive' : 'text'}`,
          );
        } catch (err: unknown) {
          this.logger.error(
            `[CART_ENGINE] ✗ Failed to send cart reply: ${(err as Error).message}`,
          );
        }
      }
      return; // Do not run keyword rule engine for cart commands
    }

    // ── Keyword auto-reply rule engine ─────────────────────────────────────────
    // Rules are keyed by tenant businessId, not integrationId.
    const rulesRef = this.firebase
      .getFirestore()
      .collection('integrations')
      .doc(businessId)
      .collection('auto_replies');

    const rulesSnap = await rulesRef.where('isActive', '==', true).get();

    if (rulesSnap.empty) {
      this.logger.debug(
        `[RULE_ENGINE] No active rules for businessId=${businessId}`,
      );
      return;
    }

    const normalizedText = msg.text.toLowerCase().trim();

    // Find first matching rule
    const matchedRule = rulesSnap.docs
      .map((d) => d.data() as AutoReply)
      .find((rule) => {
        const keyword = rule.triggerWord.toLowerCase().trim();
        return rule.matchType === MatchType.EXACT
          ? normalizedText === keyword
          : normalizedText.includes(keyword);
      });

    if (!matchedRule) {
      this.logger.debug(
        `[RULE_ENGINE] No rule matched for text="${normalizedText}" (businessId=${businessId})`,
      );
      return;
    }

    this.logger.log(
      `[RULE_ENGINE] Rule matched: trigger="${matchedRule.triggerWord}" matchType=${matchedRule.matchType} from=${msg.from}`,
    );

    const catalogCtx = await this.resolveCatalogContextForIntegration(
      businessId,
      integrationId,
      catalog?.catalogId,
    );

    // A catalog must be linked somewhere under this business to send product messages
    if (!catalogCtx) {
      this.logger.warn(
        `[RULE_ENGINE] Rule matched but no business catalog linked for businessId=${businessId} — skipping auto-reply`,
      );
      return;
    }

    this.logger.debug(
      `[RULE_ENGINE] Integration fetched for channel=${provider} integrationId=${integrationId} using catalogId=${catalogCtx.catalogId}`,
    );

    if (provider === 'META' && (!accessToken || !phoneNumberId)) {
      this.logger.warn(
        `[RULE_ENGINE] Missing accessToken or phoneNumberId for businessId=${businessId} — skipping auto-reply`,
      );
      return;
    }

    const { retailerIds: rawRetailerIds, collectionTitle, triggerWord } = matchedRule;

    // Guard: a rule with no products would produce a 400 from Meta — bail early.
    if (!rawRetailerIds.length) {
      this.logger.warn(
        `[RULE_ENGINE] Rule "${triggerWord}" has no retailerIds — skipping auto-reply`,
      );
      return;
    }

    // Filter orphan/non-ACTIVE items and deduplicate by itemGroupId so that
    // each product family is represented by exactly one retailer_id.
    const retailerIds = await this.resolveActiveUniqueRetailerIds(
      catalogCtx.catalogDocRef,
      rawRetailerIds,
    );

    if (!retailerIds.length) {
      this.logger.warn(
        `[RULE_ENGINE] Rule "${triggerWord}" has no eligible retailerIds after filtering — skipping auto-reply`,
      );
      return;
    }

    // Meta requires different interactive types depending on product count:
    //   1 product  → type "product"      (action.product_retailer_id, no sections)
    //   2+ products → type "product_list" (action.sections, requires header)
    const isSingle = retailerIds.length === 1;

    const interactive = isSingle
      ? {
          type: 'product',
          body:   { text: 'Aquí tienes el producto solicitado:' },
          footer: { text: 'Migo UIT' },
          action: {
            catalog_id:            catalogCtx.catalogId,
            product_retailer_id:   retailerIds[0],
          },
        }
      : {
          type: 'product_list',
          header: { type: 'text', text: 'Nuestro Catálogo' },
          body:   { text: 'Aquí tienes los productos solicitados:' },
          footer: { text: 'Migo UIT' },
          action: {
            catalog_id: catalogCtx.catalogId,
            sections: [
              {
                title: collectionTitle,
                product_items: retailerIds.map((id) => ({
                  product_retailer_id: id,
                })),
              },
            ],
          },
        };

    if (provider === 'META') {
      const interactivePayload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: msg.from,
        type: 'interactive',
        interactive,
      };

      // Use the integration-scoped token from the hybrid document for outbound
      // messaging on this WABA. A global system-user token can belong to a
      // different business context and trigger Meta auth error 190.
      const outboundToken = accessToken;

      const response = await this.defLogger.request<{
        messages: { id: string }[];
      }>({
        method: 'POST',
        url: `${META_GRAPH_MESSAGES}/${phoneNumberId}/messages`,
        headers: { Authorization: `Bearer ${outboundToken}` },
        data: interactivePayload,
      });

      const wamid = response.messages?.[0]?.id ?? 'unknown';
      this.logger.log(
        `[RULE_ENGINE] ✓ Sent ${isSingle ? 'product' : 'product_list'} wamid=${wamid} to=${msg.from} (trigger="${triggerWord}", ${retailerIds.length} product(s))`,
      );

      // Persist the auto-reply outbound message to Firestore for the chat timeline
      await docRef.collection('messages').doc(wamid).set({
        id: wamid,
        direction: 'outbound',
        from: phoneNumberId,
        to: msg.from,
        text: `[Auto-reply: ${matchedRule.collectionTitle}]`,
        timestamp: new Date().toISOString(),
      });

      await this.firebase.update(docRef, { updatedAt: new Date().toISOString() });
      return;
    }

    if (provider === 'META_MESSENGER') {
      const messengerMessage = await this.buildMessengerCatalogTemplate(
        catalogCtx.catalogDocRef,
        retailerIds,
      );

      if (!messengerMessage) {
        this.logger.warn(
          `[RULE_ENGINE] Messenger rich product join returned no valid elements for businessId=${businessId} — skipping auto-reply`,
        );
        return;
      }

      const { messageId } = await this.messagingService.sendMessage({
        businessId,
        provider: 'META_MESSENGER',
        recipientId: msg.from,
        text: `[Auto-reply: ${matchedRule.collectionTitle}]`,
        message: messengerMessage,
      });

      this.logger.log(
        `[RULE_ENGINE] ✓ Sent messenger carousel messageId=${messageId} to=${msg.from} (trigger="${triggerWord}", ${retailerIds.length} product(s))`,
      );
      return;
    }

    if (provider === 'META_INSTAGRAM') {
      // Instagram truncates multi-element Generic Template carousels to the
      // first element. Strategy: send each product as an independent single-
      // element rich card, sequentially. (Research doc §2, carousel bug.)
      await this.sendInstagramProductCards(
        catalogCtx.catalogDocRef,
        retailerIds,
        msg.from,       // recipient IGSID
        phoneNumberId,  // IG Account ID (used as the messages endpoint node)
        accessToken,
        docRef,
        matchedRule.collectionTitle,
        triggerWord,
      );
      return;
    }

    this.logger.warn(
      `[RULE_ENGINE] Unsupported provider=${provider} for catalog reply; skipping`,
    );
  }

  /**
   * Sends catalog products to an Instagram user as sequential single-element
   * Generic Template rich cards.
   *
   * Why single-element? Instagram DMs truncate multi-element Generic Template
   * carousels to the first card and silently drop the rest. Sending one card
   * per request bypasses this platform bug. (Research doc §2.)
   *
   * Flow:
   *   1. Fetch matching product docs from Firestore (same join as Messenger).
   *   2. Send a preamble text DM: "Aquí tienes los productos solicitados:".
   *   3. For each product, POST a single-element Generic Template to
   *      GET /v25.0/{pageId}/messages with the Page Access Token.
   *   4. Persist each outbound card to Firestore for the chat timeline.
   *
   * Constraints enforced per the strategy doc:
   *   - title:    ≤ 80 chars
   *   - subtitle: ≤ 80 chars  (formatted price + availability)
   *   - buttons:  max 3 per element (we use 1: "Ver producto")
   *   - image:    JPEG/PNG via public URL, max 8 MB
   */
  /**
   * Checks whether the 24-hour Instagram DM messaging window is still open
   * for a given contact. The window opens on the most recent inbound
   * interaction (DM or Story Mention) and expires after 24 hours of silence.
   *
   * Returns `true` if the window is open (message may be sent),
   *         `false` if the window has expired (message must be suppressed).
   */
  private async checkInstagramWindowOpen(
    integrationDocRef: FirebaseFirestore.DocumentReference,
    igsid: string,
  ): Promise<boolean> {
    try {
      const convRef  = integrationDocRef.collection('conversations').doc(igsid);
      const convSnap = await convRef.get();

      if (!convSnap.exists) return false;

      const ts = convSnap.data()?.lastUserInteractionTimestamp as number | undefined;
      if (!ts) return false;

      const WINDOW_MS = 24 * 60 * 60 * 1000;
      return Date.now() - ts < WINDOW_MS;
    } catch (err: unknown) {
      this.logger.warn(
        `[IG_WINDOW] Could not read conversation timestamp for igsid=${igsid}: ` +
          `${(err as Error).message} — defaulting to window closed`,
      );
      return false;
    }
  }

  private async sendInstagramProductCards(
    catalogDocRef: FirebaseFirestore.DocumentReference,
    retailerIds: string[],
    recipientIgsid: string,
    igAccountId: string,
    accessToken: string,
    integrationDocRef: FirebaseFirestore.DocumentReference,
    collectionTitle: string,
    triggerWord: string,
  ): Promise<void> {
    // ── 24-hour window guard ──────────────────────────────────────────────────
    const windowOpen = await this.checkInstagramWindowOpen(integrationDocRef, recipientIgsid);
    if (!windowOpen) {
      this.logger.warn(
        `[IG_CATALOG] 24-hour window closed for igsid=${recipientIgsid} ` +
          `(trigger="${triggerWord}") — auto-reply suppressed`,
      );
      return;
    }

    // POST /me/messages — /me resolves to the account whose token is supplied.
    // This avoids embedding the igAccountId in the URL and is the canonical
    // endpoint for the Instagram API with Instagram Login.
    const INSTAGRAM_MESSAGES_URL = `https://graph.instagram.com/v25.0/me/messages`;

    // ── Fetch product documents (same join logic as Messenger) ────────────────
    type IgProduct = {
      productId?: string;
      retailerId?: string;
      name?: string;
      price?: string | number;
      currency?: string;
      availability?: string;
      imageUrl?: string;
      image_url?: string;
      url?: string;
    };

    const targetIds = Array.from(new Set(retailerIds)).slice(0, 10);
    const byRetailerId = new Map<string, IgProduct>();
    const CHUNK = 30;

    for (let i = 0; i < targetIds.length; i += CHUNK) {
      const chunk = targetIds.slice(i, i + CHUNK);
      const snap = await catalogDocRef
        .collection('products')
        .where('retailerId', 'in', chunk)
        .get();

      for (const d of snap.docs) {
        const item = d.data() as IgProduct;
        if (item.retailerId) byRetailerId.set(item.retailerId, item);
      }
    }

    // Fallback: match by document ID for legacy rules
    for (const rid of targetIds) {
      if (byRetailerId.has(rid)) continue;
      const doc = await catalogDocRef.collection('products').doc(rid).get();
      if (doc.exists) {
        const item = doc.data() as IgProduct;
        byRetailerId.set(item.retailerId ?? rid, { ...item, retailerId: item.retailerId ?? rid });
      }
    }

    const validElements = targetIds
      .map((rid) => byRetailerId.get(rid))
      .filter((p): p is IgProduct => Boolean(p?.name && (p?.imageUrl ?? p?.image_url)));

    if (!validElements.length) {
      this.logger.warn(
        `[IG_CATALOG] No valid products resolved for triggerWord="${triggerWord}" — skipping`,
      );
      return;
    }

    // ── Step 1: Preamble text message ─────────────────────────────────────────
    try {
      await this.defLogger.request({
        method: 'POST',
        url: INSTAGRAM_MESSAGES_URL,
        params: { access_token: accessToken },
        data: {
          recipient: { id: recipientIgsid },
          message: { text: `Aquí tienes los productos de "${collectionTitle}":` },
        },
      });
      this.logger.log(
        `[IG_CATALOG] ✓ Preamble text sent to igsid=${recipientIgsid}`,
      );
    } catch (err: unknown) {
      this.logger.warn(
        `[IG_CATALOG] ✗ Preamble text failed: ${(err as Error).message} — continuing with cards`,
      );
    }

    // ── Step 2: One rich card per product ─────────────────────────────────────
    const truncate = (str: string, max: number) =>
      str.length > max ? `${str.slice(0, max - 1)}…` : str;

    const formatPrice = (price: string | number | undefined, currency?: string): string => {
      if (price === undefined || price === null) return '';

      let numeric: number;

      if (typeof price === 'number') {
        numeric = price;
      } else {
        const raw = String(price).trim();
        // Keep only digits and separators so we can normalize mixed formats
        // like "Bs.80.00", "BOB 120.00", "1.234,56" and "1,234.56".
        const cleaned = raw.replace(/[^\d.,]/g, '');
        if (!cleaned) return '';

        const lastDot = cleaned.lastIndexOf('.');
        const lastComma = cleaned.lastIndexOf(',');
        const decimalPos = Math.max(lastDot, lastComma);

        if (decimalPos === -1) {
          numeric = parseFloat(cleaned.replace(/[^\d]/g, ''));
        } else {
          const integerPart = cleaned.slice(0, decimalPos).replace(/[^\d]/g, '');
          const decimalPart = cleaned.slice(decimalPos + 1).replace(/[^\d]/g, '');
          const normalized = `${integerPart || '0'}.${decimalPart || '0'}`;
          numeric = parseFloat(normalized);
        }
      }

      if (!Number.isFinite(numeric)) return '';

      const formatted = numeric.toFixed(2);
      return currency ? `${currency} ${formatted}` : formatted;
    };

    for (const product of validElements) {
      const title    = truncate((product.name ?? '').trim(), 80);
      const priceStr = formatPrice(product.price, product.currency);
      const subtitle = truncate(
        [priceStr, product.availability].filter(Boolean).join(' · '),
        80,
      );
      const imageUrl = (product.imageUrl ?? product.image_url ?? '').trim();
      const productUrl = (product.url ?? '').trim();
      const cardUrl = productUrl || 'https://instagram.com';

      const element: Record<string, unknown> = { title, image_url: imageUrl, subtitle };

      // Instagram may degrade Generic Templates without buttons into plain text.
      // Always include at least one URL button to force rich-card rendering.
      element.default_action = {
        type: 'web_url',
        url: cardUrl,
        webview_height_ratio: 'FULL',
      };
      element.buttons = [
        { type: 'web_url', url: cardUrl, title: 'Ver Producto' },
      ];

      const cardPayload = {
        recipient: { id: recipientIgsid },
        message: {
          attachment: {
            type: 'template',
            payload: {
              template_type: 'generic',
              elements: [element],
            },
          },
        },
      };

      try {
        const response = await this.defLogger.request<{ message_id?: string; recipient_id?: string }>({
          method: 'POST',
          url: INSTAGRAM_MESSAGES_URL,
          params: { access_token: accessToken },
          data: cardPayload,
        });

        const msgId = response?.message_id ?? `ig_card_${Date.now()}`;

        // Persist outbound card to Firestore for the chat timeline
        await integrationDocRef.collection('messages').doc(msgId).set({
          id:            msgId,
          direction:     'outbound',
          from:          igAccountId,
          to:            recipientIgsid,
          text:          `[Auto-reply: ${title}]`,
          timestamp:     new Date().toISOString(),
          channel:       'META_INSTAGRAM',
          interactionType: 'DIRECT_MESSAGE',
        });

        this.logger.log(
          `[IG_CATALOG] ✓ Card sent — product="${title}" to=${recipientIgsid} msgId=${msgId}`,
        );
      } catch (cardErr: unknown) {
        this.logger.error(
          `[IG_CATALOG] ✗ Card failed for product="${title}": ${(cardErr as Error).message}`,
        );
      }
    }

    await this.firebase.update(integrationDocRef, { updatedAt: new Date().toISOString() });

    this.logger.log(
      `[IG_CATALOG] ✓ Sent ${validElements.length} card(s) to igsid=${recipientIgsid} ` +
        `(trigger="${triggerWord}")`,
    );
  }

  private async resolveBusinessCatalogContext(
    businessId: string,
  ): Promise<BusinessCatalogContext | null> {
    const db = this.firebase.getFirestore();
    const snap = await db
      .collection('catalogs')
      .where('businessId', '==', businessId)
      .where('isActive', '==', true)
      .limit(1)
      .get();

    if (!snap.empty) {
      const doc = snap.docs[0];
      const data = doc.data() as { catalogId?: string };
      const catalogId = data.catalogId ?? doc.id;
      if (catalogId) {
        return { catalogId, catalogDocRef: doc.ref };
      }
    }

    return null;
  }

  private async resolveCatalogContextForIntegration(
    businessId: string,
    integrationId: string,
    integrationCatalogId?: string,
  ): Promise<BusinessCatalogContext | null> {
    const db = this.firebase.getFirestore();

    if (integrationCatalogId) {
      const doc = await db.collection('catalogs').doc(integrationCatalogId).get();
      if (doc.exists) {
        const data = doc.data() as { businessId?: string; catalogId?: string };
        const catalogBusinessId = data.businessId ?? '';
        if (!catalogBusinessId || catalogBusinessId === businessId) {
          this.logger.debug(
            `[RULE_ENGINE] Integration fetched for channel resolution using catalogId=${data.catalogId ?? doc.id}`,
          );
          return {
            catalogId: data.catalogId ?? doc.id,
            catalogDocRef: doc.ref,
          };
        }

        this.logger.warn(
          `[RULE_ENGINE] integrationId=${integrationId} has metaData.catalogId=${integrationCatalogId} but catalog businessId=${catalogBusinessId} != ${businessId}`,
        );
      } else {
        this.logger.warn(
          `[RULE_ENGINE] integrationId=${integrationId} references missing catalogId=${integrationCatalogId}`,
        );
      }
    }

    return this.resolveBusinessCatalogContext(businessId);
  }

  private async buildMessengerCatalogTemplate(
    catalogDocRef: FirebaseFirestore.DocumentReference,
    retailerIds: string[],
  ): Promise<Record<string, unknown> | null> {
    const targetRetailerIds = Array.from(new Set(retailerIds)).slice(0, 10);
    if (!targetRetailerIds.length) {
      return null;
    }

    const CHUNK = 30;
    const chunks: string[][] = [];
    for (let i = 0; i < targetRetailerIds.length; i += CHUNK) {
      chunks.push(targetRetailerIds.slice(i, i + CHUNK));
    }

    this.logger.debug(
      `[RULE_ENGINE] Querying: ${catalogDocRef.path}/products for retailerIds=[${targetRetailerIds.join(', ')}]`,
    );

    type CatalogProduct = {
      productId?: string;
      retailerId?: string;
      name?: string;
      price?: string | number;
      currency?: string;
      imageUrl?: string;
      image_url?: string;
    };

    const byRetailerId = new Map<string, CatalogProduct>();
    const unresolved = new Set(targetRetailerIds);

    for (const chunk of chunks) {
      const snap = await catalogDocRef
        .collection('products')
        .where('retailerId', 'in', chunk)
        .get();

      for (const d of snap.docs) {
        const item = d.data() as CatalogProduct;
        const retailerId = item.retailerId;
        if (retailerId) {
          byRetailerId.set(retailerId, item);
          unresolved.delete(retailerId);
        }
      }
    }

    this.logger.debug(
      `[RULE_ENGINE] Fetched ${byRetailerId.size} raw products matching retailerIds`,
    );

    // Fallback for legacy rules where retailerId may actually match product document id.
    for (const rid of unresolved) {
      const doc = await catalogDocRef.collection('products').doc(rid).get();
      if (!doc.exists) {
        continue;
      }
      const item = doc.data() as CatalogProduct;
      const retailerId = item.retailerId ?? rid;
      byRetailerId.set(retailerId, { ...item, retailerId });
    }

    const elements = targetRetailerIds
      .map((retailerId) => {
        const product = byRetailerId.get(retailerId);
        if (!product) {
          this.logger.warn(
            `[RULE_ENGINE] Messenger product join miss for retailerId=${retailerId}`,
          );
          return null;
        }

        const title = product.name?.trim();
        const imageUrl = product.image_url ?? product.imageUrl;
        const subtitle = `${product.currency ?? ''} ${product.price ?? ''}`.trim();

        // Strict rich-data rule: do not send placeholder media/text.
        if (!title || !imageUrl || !subtitle) {
          this.logger.warn(
            `[RULE_ENGINE] Skipping incomplete messenger product retailerId=${retailerId}`,
          );
          return null;
        }

        return {
          title,
          image_url: imageUrl,
          subtitle,
          buttons: [
            {
              type: 'postback',
              title: 'Anadir al carrito',
              payload: `ADD_CART_${retailerId}`,
            },
          ],
        };
      })
      .filter((el): el is {
        title: string;
        image_url: string;
        subtitle: string;
        buttons: Array<{ type: string; title: string; payload: string }>;
      } => Boolean(el));

    if (!elements.length) {
      return null;
    }

    return {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'generic',
          elements,
        },
      },
    };
  }

  // ── Retailer ID Resolution ────────────────────────────────────────────────

  /**
   * Filters and deduplicates a raw list of retailer IDs before sending a
   * WhatsApp product message.
   *
   * Two problems this solves:
   *   1. Orphan IDs — items that were deleted or rejected in Meta but whose
   *      retailer_id is still stored in the auto-reply rule. Sending them causes
   *      WhatsApp to silently drop the product from the carousel.
   *   2. Variant duplication — if the rule contains both a parent product AND
   *      its variants, WhatsApp only needs ONE representative from the group
   *      (it automatically shows variant selectors). Sending all of them wastes
   *      product_items slots (limit: 30 per section).
   *
   * Algorithm:
    *   a. Query catalogs/{catalogId}/products for each retailer_id.
   *   b. For known items: skip those not in ACTIVE status (filter orphans).
   *   c. For unknown items (not tracked in Firestore): keep them unchanged —
   *      conservative behaviour avoids breaking rules created before tracking.
   *   d. Deduplicate by itemGroupId — only the first representative of each
   *      product family is kept.
   *
   * The status filter runs in-memory after the Firestore read to avoid
   * requiring a composite index on (retailerId, status).
   */
  private async resolveActiveUniqueRetailerIds(
    catalogDocRef: FirebaseFirestore.DocumentReference,
    retailerIds: string[],
  ): Promise<string[]> {
    if (!retailerIds.length) return [];

    // Chunk into groups of 30 — Firestore `in` clause limit
    const CHUNK = 30;
    const chunks: string[][] = [];
    for (let i = 0; i < retailerIds.length; i += CHUNK) {
      chunks.push(retailerIds.slice(i, i + CHUNK));
    }

    // Fetch known records from root catalog products (no composite index needed)
    this.logger.debug(
      `[RULE_ENGINE] Querying: ${catalogDocRef.path}/products for retailerIds=[${retailerIds.join(', ')}]`,
    );

    const known = new Map<string, { availability: string; itemGroupId?: string }>();
    for (const chunk of chunks) {
      try {
        const snap = await catalogDocRef
          .collection('products')
          .where('retailerId', 'in', chunk)
          .get();

        this.logger.debug(
          `[RULE_ENGINE] Fetched ${snap.size} raw products matching retailerIds`,
        );

        for (const doc of snap.docs) {
          const d = doc.data() as { retailerId?: string; availability?: string; itemGroupId?: string };
          if (d.retailerId) {
            known.set(d.retailerId, {
              availability: d.availability ?? 'unknown',
              itemGroupId: d.itemGroupId,
            });
          }
        }
      } catch (err: unknown) {
        this.logger.warn(
          `[RULE_ENGINE] catalog products lookup failed — proceeding without filter: ` +
          `${(err as Error).message}`,
        );
      }
    }

    // Filter and build candidate list
    const candidates: Array<{ retailerId: string; itemGroupId?: string }> = [];
    for (const retailerId of retailerIds) {
      const record = known.get(retailerId);
      if (record) {
        if (record.availability !== 'in stock') {
          this.logger.warn(
            `[RULE_ENGINE] Skipping retailer_id="${retailerId}" — ` +
            `availability is "${record.availability}" (not in stock)`,
          );
          continue;
        }
        candidates.push({ retailerId, itemGroupId: record.itemGroupId });
      } else {
        // Not tracked in Firestore — keep conservatively (may be a legacy item)
        candidates.push({ retailerId });
      }
    }

    // Deduplicate by itemGroupId: only the first representative per group is kept.
    // WhatsApp automatically loads all variants of a group from Commerce Manager.
    const seen = new Map<string, { retailerId: string; itemGroupId?: string }>();
    for (const p of candidates) {
      const key = p.itemGroupId ?? p.retailerId;
      if (!seen.has(key)) {
        seen.set(key, p);
      }
    }

    const unique = Array.from(seen.values());

    if (unique.length !== retailerIds.length) {
      this.logger.log(
        `[RULE_ENGINE] retailerIds resolved: ${retailerIds.length} raw → ` +
        `${unique.length} active+unique ` +
        `(${retailerIds.length - unique.length} filtered or deduplicated)`,
      );
    }

    return unique.map((p) => p.retailerId);
  }

  // ── Catalog Item Policy Sync ───────────────────────────────────────────────

  /**
   * Handles `catalog_item_update` webhook events fired by Meta's policy engine.
   *
   * When Meta rejects a product (review_status = "REJECTED"), we locate every
   * matching document in the `catalog_products` subcollection (matched by
   * retailer_id) and mark them SUSPENDED_BY_POLICY so the UI can surface the
   * issue to the merchant without requiring a manual catalog refresh.
   *
   * Non-fatal: any Firestore error is logged but does not interrupt normal
   * webhook processing.
   */
  private async handleCatalogItemUpdate(
    value: CatalogItemUpdateValue,
  ): Promise<void> {
    const { retailer_id, review_status, rejection_reasons } = value;

    this.logger.log(
      `[CATALOG_POLICY] catalog_item_update received — retailer_id=${retailer_id ?? 'n/a'} status=${review_status ?? 'n/a'}`,
    );

    if (!retailer_id || review_status !== 'REJECTED') {
      this.logger.debug(
        `[CATALOG_POLICY] Event skipped — not a REJECTED status (status=${review_status ?? 'n/a'})`,
      );
      return;
    }

    try {
      const db = this.firebase.getFirestore();

      const updatePayload: Record<string, unknown> = {
        status: 'SUSPENDED_BY_POLICY',
        updatedAt: new Date().toISOString(),
      };
      if (rejection_reasons?.length) {
        updatePayload['rejectionReasons'] = rejection_reasons;
      }

      let totalUpdated = 0;

      // ── Check catalog_products (top-level products) ───────────────────────
      const productSnap = await db
        .collectionGroup('catalog_products')
        .where('retailerId', '==', retailer_id)
        .get();

      for (const doc of productSnap.docs) {
        await this.firebase.update(doc.ref, updatePayload);
        this.logger.log(
          `[CATALOG_POLICY] ✓ Product marked SUSPENDED_BY_POLICY → ${doc.ref.path}`,
        );
        totalUpdated++;
      }

      // ── Check variants subcollection ──────────────────────────────────────
      // Variants are stored at catalog_products/{id}/variants/{autoId}
      const variantSnap = await db
        .collectionGroup('variants')
        .where('retailerId', '==', retailer_id)
        .get();

      for (const doc of variantSnap.docs) {
        await this.firebase.update(doc.ref, updatePayload);
        this.logger.log(
          `[CATALOG_POLICY] ✓ Variant marked SUSPENDED_BY_POLICY → ${doc.ref.path}`,
        );
        totalUpdated++;
      }

      if (totalUpdated === 0) {
        this.logger.warn(
          `[CATALOG_POLICY] No Firestore records found for retailer_id=${retailer_id} — nothing to update`,
        );
      }
    } catch (err: unknown) {
      this.logger.error(
        `[CATALOG_POLICY] ✗ Failed to update Firestore for retailer_id=${retailer_id}: ${(err as Error).message}`,
      );
    }
  }

  // ── Interactive button-reply router ────────────────────────────────────────

  /**
   * Dispatches an interactive button_reply to the correct handler based on
   * the button id set when the interactive message was originally sent.
   *
   * Recognised ids:
   *   CMD_VIEW_MPM  → send a product_list interactive showing the cart items
   *   CMD_PAY_CART  → send an order_details interactive for payment
   *
   * Unknown ids are logged at WARN and silently dropped so unknown future
   * button ids do not cause unhandled errors in production.
   */
  private async handleInteractiveReply(
    msg: ParsedInboundMessage,
    context: IntegrationContext,
  ): Promise<void> {
    const { buttonReplyId, from: contactWaId } = msg;
    const { businessId } = context;

    this.logger.log(
      `[INTERACTIVE] Button reply received — id="${buttonReplyId}" from=${contactWaId}`,
    );

    switch (buttonReplyId) {
      case 'CMD_VIEW_MPM':
        await this.sendProductListFromCart(contactWaId, businessId, context);
        break;

      case 'CMD_PAY_CART':
        await this.sendPaymentReceiptFromCart(contactWaId, businessId, context);
        break;

      default:
        this.logger.warn(
          `[INTERACTIVE] Unrecognised button id="${buttonReplyId}" — no handler registered`,
        );
    }
  }

  // ── CMD_VIEW_MPM — product_list interactive ────────────────────────────────

  /**
   * Sends a WhatsApp `product_list` interactive message containing every
   * item currently in the customer's active cart.
   *
   * Meta payload structure (v25.0):
   * ```json
   * {
   *   "type": "interactive",
   *   "interactive": {
   *     "type": "product_list",
   *     "header": { "type": "text", "text": "Tu Carrito" },
   *     "body":   { "text": "Aquí tienes los ítems que agregaste:" },
   *     "action": {
   *       "catalog_id": "<catalogId>",
   *       "sections": [{
   *         "title": "Artículos en tu carrito",
   *         "product_items": [
   *           { "product_retailer_id": "sku-001" },
   *           { "product_retailer_id": "sku-002" }
   *         ]
   *       }]
   *     }
   *   }
   * }
   * ```
   *
   * Falls back to a plain-text reply if the cart is empty or no catalog
   * is linked to the integration.
   */
  private async sendProductListFromCart(
    contactWaId: string,
    businessId: string,
    context: IntegrationContext,
  ): Promise<void> {
    const { docRef, accessToken, phoneNumberId, catalog } = context;
    const systemToken = this.secrets.get('META_SYSTEM_USER_TOKEN') ?? accessToken;

    // ── Guard: catalog must be linked ────────────────────────────────────────
    if (!catalog?.catalogId) {
      this.logger.warn(
        `[INTERACTIVE][MPM] No catalog linked for businessId=${businessId} — cannot send product_list`,
      );
      return;
    }

    // ── Fetch active cart ─────────────────────────────────────────────────────
    const cart = await this.cartService.getActiveCart(businessId, contactWaId);

    if (!cart || cart.items.length === 0) {
      // Send a plain-text fallback rather than an empty product_list
      await sendWhatsAppText({
        phoneNumberId,
        recipientWaId: contactWaId,
        text:          '🛒 Tu carrito está vacío. Usá *"agregar [código]"* para añadir productos.',
        accessToken:   systemToken,
      });
      return;
    }

    // ── Build the product_list payload ────────────────────────────────────────
    const productItems = cart.items.map((item) => ({
      product_retailer_id: item.productRetailerId,
    }));

    const interactivePayload = {
      type:   'product_list',
      header: { type: 'text', text: 'Tu Carrito' },
      body:   { text: 'Aquí tienes los ítems que agregaste:' },
      action: {
        catalog_id: catalog.catalogId,
        sections: [
          {
            title:         'Artículos en tu carrito',
            product_items: productItems,
          },
        ],
      },
    };

    // ── Send to Meta ──────────────────────────────────────────────────────────
    const response = await this.defLogger.request<{ messages: { id: string }[] }>({
      method: 'POST',
      url:    `${META_GRAPH_MESSAGES}/${phoneNumberId}/messages`,
      headers: { Authorization: `Bearer ${systemToken}` },
      data: {
        messaging_product: 'whatsapp',
        recipient_type:    'individual',
        to:                contactWaId,
        type:              'interactive',
        interactive:       interactivePayload,
      },
    });

    const wamid = response.messages?.[0]?.id ?? 'unknown';

    // ── Persist to Firestore for chat timeline ────────────────────────────────
    await docRef.collection('messages').doc(wamid).set({
      id:        wamid,
      direction: 'outbound',
      from:      phoneNumberId,
      to:        contactWaId,
      text:      `[Catálogo: ${cart.items.length} producto(s)]`,
      timestamp: new Date().toISOString(),
    });
    await this.firebase.update(docRef, { updatedAt: new Date().toISOString() });

    this.logger.log(
      `[INTERACTIVE][MPM] ✓ product_list sent — wamid=${wamid} items=${cart.items.length} to=${contactWaId}`,
    );
  }

  // ── CMD_PAY_CART — formatted text receipt ─────────────────────────────────

  /**
   * Sends a plain-text payment receipt to the customer and locks the cart.
   *
   * Replaces the native `order_details` interactive message which is
   * geo-restricted to markets where WhatsApp Pay is available (error #131009
   * when used with BOB/Bolivianos).
   *
   * Flow:
   *   1. Fetch the active cart from Firestore.
   *   2. Build a formatted receipt string with per-item subtotals + grand total.
   *   3. Send as a standard `type:'text'` message via sendWhatsAppText().
   *   4. Lock the cart by setting status = 'pending_payment' so further
   *      add/remove commands cannot modify it while payment is in progress.
   *   5. Persist the receipt text to the Firestore chat timeline.
   *
   * Receipt format (WhatsApp markdown rendered on-device):
   *
   *   🧾 *DETALLE DE TU PEDIDO* 🧾
   *   ━━━━━━━━━━━━━━━━━━━
   *
   *   🛍️ *2x Playera azul*
   *   ↳ Precio: Bs. 100
   *   ↳ Subtotal: Bs. 200
   *
   *   ━━━━━━━━━━━━━━━━━━━
   *   💳 *TOTAL A PAGAR: Bs. 200*
   *
   *   Para completar tu compra, por favor ingresa al siguiente enlace:
   *   👉 https://wa.me/59169775986?text=Hola,...
   */
  private async sendPaymentReceiptFromCart(
    contactWaId: string,
    businessId: string,
    context: IntegrationContext,
  ): Promise<void> {
    const { docRef, accessToken, phoneNumberId } = context;
    const systemToken = this.secrets.get('META_SYSTEM_USER_TOKEN') ?? accessToken;

    // ── Fetch active cart ─────────────────────────────────────────────────────
    const cart = await this.cartService.getActiveCart(businessId, contactWaId);

    if (!cart || cart.items.length === 0) {
      await sendWhatsAppText({
        phoneNumberId,
        recipientWaId: contactWaId,
        text:          '🛒 Tu carrito está vacío. No hay nada que pagar.',
        accessToken:   systemToken,
      });
      return;
    }

    // ── Price formatter ───────────────────────────────────────────────────────
    // unitPrice is stored as a direct major-unit value (e.g. 68, not 6800).
    // No division needed. Whole numbers are shown without decimals ("Bs. 68"),
    // fractional values with two decimal places ("Bs. 68.50").
    const fmt = (amount: number): string =>
      `Bs. ${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;

    // ── Build receipt lines ───────────────────────────────────────────────────
    const SEPARATOR  = '━'.repeat(19);
    const PAYMENT_URL =
      `https://wa.me/59169775986?text=Hola,%20quiero%20pagar%20el%20pedido%20` +
      encodeURIComponent(cart.id);

    const lines: string[] = [
      `🧾 *DETALLE DE TU PEDIDO* 🧾`,
      SEPARATOR,
      '',
    ];

    let grandTotal = 0;

    for (const item of cart.items) {
      const subtotal = item.unitPrice * item.quantity;
      grandTotal    += subtotal;

      lines.push(`🛍️ *${item.quantity}x ${item.name}*`);
      lines.push(`↳ Precio: ${fmt(item.unitPrice)}`);
      lines.push(`↳ Subtotal: ${fmt(subtotal)}`);
      lines.push('');
    }

    lines.push(SEPARATOR);
    lines.push(`💳 *TOTAL A PAGAR: ${fmt(grandTotal)}*`);
    lines.push('');
    lines.push('Para completar tu compra, por favor ingresa al siguiente enlace:');
    lines.push(`👉 ${PAYMENT_URL}`);

    const receiptText = lines.join('\n');

    // ── Send receipt as plain text ────────────────────────────────────────────
    const { wamid } = await sendWhatsAppText({
      phoneNumberId,
      recipientWaId: contactWaId,
      text:          receiptText,
      accessToken:   systemToken,
    });

    // ── Lock cart — status → 'pending_payment' ────────────────────────────────
    // Prevents the customer from modifying the cart while payment is pending.
    // The cart is NOT archived yet; it will be transitioned to 'checked_out'
    // once payment is confirmed, or back to 'active' if it is cancelled.
    const cartRef = docRef.collection('carts').doc(cart.id);
    await this.firebase.update(cartRef, {
      status:    'pending_payment',
      updatedAt: new Date().toISOString(),
    });

    // ── Persist receipt to Firestore chat timeline ────────────────────────────
    await docRef.collection('messages').doc(wamid).set({
      id:        wamid,
      direction: 'outbound',
      from:      phoneNumberId,
      to:        contactWaId,
      text:      receiptText,
      timestamp: new Date().toISOString(),
    });
    await this.firebase.update(docRef, { updatedAt: new Date().toISOString() });

    this.logger.log(
      `[INTERACTIVE][PAY] ✓ Receipt sent — wamid=${wamid} ` +
      `total=${fmt(grandTotal)} items=${cart.items.length} cartId=${cart.id} to=${contactWaId}`,
    );
  }

  // ─── Instagram inbound pipeline (Phase 2) ────────────────────────────────────

  /**
   * Instagram pipeline entry point for `object=instagram` webhook payloads.
   *
   * Classifies each inbound event as:
   *   DIRECT_MESSAGE  — standard text DM from entry[].messaging[]
   *   STORY_MENTION   — DM that contains an attachment.type === 'story_mention',
   *                     or a metadata stringified payload with type=story_mention
   *   COMMENT         — public comment from entry[].changes[field=comments]
   *
   * Firestore writes:
   *   integrations/{integrationId}/messages/{messageId}
   *     direction, from (IGSID), text, timestamp, channel, interactionType,
   *     commentId (COMMENT only), mediaId (COMMENT only)
   *
   *   integrations/{integrationId}/conversations/{igsid}
   *     lastUserInteractionTimestamp (DM + STORY_MENTION only — enforces 24-h window)
   *     channel, igsid
   *
   * Meta guarantees "at least once" delivery — all writes are idempotent via
   * Firestore transactions keyed on messageId / commentId.
   */
  async processInstagramInbound(payload: unknown): Promise<void> {
    this.logger.log('[INSTAGRAM_WEBHOOK] Inbound payload received');
    this.logger.debug(`[INSTAGRAM_WEBHOOK_PAYLOAD] ${JSON.stringify(payload).slice(0, 500)}`);

    const typed = payload as MetaWebhookPayload;

    for (const entry of typed.entry ?? []) {
      const routingIds = new Set<string>();

      // entry.id may be a Page-linked ID for some event classes.
      if (entry.id) {
        routingIds.add(entry.id);
      }

      // For message webhooks, recipient.id is the most reliable routing ID.
      for (const event of (entry.messaging ?? []) as InstagramMessageEvent[]) {
        const recipientId = event.recipient?.id;
        if (recipientId) {
          routingIds.add(recipientId);
        }
      }

      const candidateIds = [...routingIds];
      if (candidateIds.length === 0) {
        continue;
      }

      // Resolve the META_INSTAGRAM integration document.
      // Tries candidate webhook IDs first, then falls back to token ownership
      // resolution and self-heals igAccountId once a match is found.
      const integrationDoc = await this.findInstagramIntegrationByEntryIds(candidateIds);
      if (!integrationDoc) {
        this.logger.warn(
          `[INSTAGRAM_WEBHOOK] No META_INSTAGRAM integration found for candidates=${candidateIds.join(',')}`,
        );
        continue;
      }

      // Read integration doc data once — shared across Path A and the rule engine.
      const igDocData = integrationDoc.data() as {
        connectedBusinessIds?: string[];
        metaData?: {
          accessToken?: string;
          igAccountId?: string;
          igUserId?: string;
          catalogId?: string;
        };
        catalog?: { catalogId?: string };
      };
      const igBusinessId = igDocData.connectedBusinessIds?.[0] ?? integrationDoc.id;
      const igPageToken  = igDocData.metaData?.accessToken ?? '';
      // With the Instagram API with Instagram Login, the IG account ID is the
      // identifier used for all outbound messages — no Facebook Page ID required.
      const igAccountId  =
        igDocData.metaData?.igAccountId ??
        candidateIds[0] ??
        igDocData.metaData?.igUserId ??
        integrationDoc.id;
      const igCatalogId  = igDocData.metaData?.catalogId ?? igDocData.catalog?.catalogId;

      // ── Path A: Direct Messages & Story Mentions ─────────────────────────
      for (const event of (entry.messaging ?? []) as InstagramMessageEvent[]) {
        const senderId = event.sender?.id ?? '';
        const recipientId = event.recipient?.id ?? '';
        const igsid = senderId === igAccountId ? recipientId : senderId;
        if (!igsid) continue;

        const mid = event.message?.mid;
        const rawTimestamp = event.timestamp;
        const timestamp =
          typeof rawTimestamp === 'number'
            ? new Date(rawTimestamp).toISOString()
            : new Date().toISOString();

        const messageId = mid ?? `ig_dm_${igAccountId}_${igsid}_${rawTimestamp ?? Date.now()}`;
        const text = event.message?.text ?? '';
        const attachments = event.message?.attachments ?? [];
        const isEchoEvent =
          Boolean(event.message?.is_echo) ||
          Boolean(event.is_echo) ||
          (Boolean(senderId) && senderId === recipientId) ||
          (Boolean(senderId) && senderId === igAccountId);

        // Detect Story Mention via attachment type, OR via stringified metadata
        // (Meta's behaviour varies by Graph API version — guard both nodes).
        const isStoryMention =
          attachments.some((a) => a.type === 'story_mention') ||
          (() => {
            try {
              const meta = event.message?.metadata;
              if (!meta) return false;
              const parsed = JSON.parse(meta) as { type?: string };
              return parsed?.type === 'story_mention';
            } catch {
              return false;
            }
          })();

        const interactionType: InstagramInteractionType = isStoryMention
          ? 'STORY_MENTION'
          : 'DIRECT_MESSAGE';

        await this.storeInstagramMessage(
          integrationDoc.ref,
          messageId,
          igsid,
          text,
          timestamp,
          interactionType,
          igAccountId,
          isEchoEvent ? 'outbound' : 'inbound',
        );

        // Echo/outbound guard: keep chat history, but do not trigger automation.
        if (isEchoEvent) {
          this.logger.debug(
            `[INSTAGRAM_WEBHOOK] Echo/outbound message ignored by rule engine — ` +
              `messageId=${messageId} sender=${senderId} recipient=${recipientId}`,
          );
          continue;
        }

        // Every DM or story mention resets the 24-hour window.
        await this.updateInstagramConversationTimestamp(integrationDoc.ref, igsid);

        // Only text DMs (not story mentions) are evaluated by the keyword rule engine.
        // Story mentions get a dedicated thank-you flow (Phase 4); comments go through
        // the Private Reply path (Phase 5).
        if (interactionType === 'DIRECT_MESSAGE' && text.trim()) {
          try {
            await this.evaluateAndRespond(
              {
                waMessageId: messageId,
                from: igsid,
                type: 'text',
                text,
                timestamp,
                phoneNumberId: igAccountId,
              },
              {
                businessId:    igBusinessId,
                provider:      'META_INSTAGRAM',
                docRef:        integrationDoc.ref,
                integrationId: integrationDoc.id,
                accessToken:   igPageToken,
                phoneNumberId: igAccountId,
                catalog: igCatalogId ? { catalogId: igCatalogId } : undefined,
              },
            );
          } catch (ruleErr: unknown) {
            this.logger.error(
              `[INSTAGRAM_WEBHOOK] ✗ Rule engine error for igsid=${igsid}: ` +
                `${(ruleErr as Error).message}`,
            );
          }
        }
      }

      // ── Path B: Public Comments (Posts + Reels) ──────────────────────────
      for (const change of entry.changes ?? []) {
        if (change.field !== 'comments') continue;

        const value = change.value as InstagramCommentValue | undefined;
        if (!value?.id) continue;

        const commentId   = value.id;
        const commenterIgsid = value.from?.id ?? '';
        const text        = value.text ?? '';
        const mediaId     = value.media?.id ?? '';
        const createdTime = value.created_time;
        const timestamp   = createdTime
          ? new Date(createdTime * 1000).toISOString()
          : new Date().toISOString();

        // Use commentId as the Firestore document key — guarantees idempotency.
        // If the same comment webhook arrives twice, the transaction detects the
        // existing doc and skips — preventing duplicate Private Reply dispatch in Phase 5.
        await this.storeInstagramComment(
          integrationDoc.ref,
          commentId,
          commenterIgsid,
          text,
          timestamp,
          mediaId,
          igAccountId,
        );

        // Comments do NOT update lastUserInteractionTimestamp.
        // The 24-hour window only opens once the user responds to a Private Reply.
      }
    }
  }

  // ─── Instagram private helpers ────────────────────────────────────────────

  /**
   * Finds the META_INSTAGRAM integration document for webhook candidate IDs.
   *
   * Order:
   *   1) metaData.igAccountId in candidate IDs
   *   2) metaData.igUserId in candidate IDs (then self-heal igAccountId)
   *   3) Token-owner probing (Graph /me with stored token), then self-heal
   */
  private async findInstagramIntegrationByEntryIds(entryIds: string[]) {
    const normalizedIds = Array.from(
      new Set(entryIds.map((id) => id.trim()).filter((id) => id.length > 0)),
    ).slice(0, 10);

    if (normalizedIds.length === 0) {
      return null;
    }

    const db = this.firebase.getFirestore();

    // ── Primary query ────────────────────────────────────────────────────────
    const primarySnap = await db
      .collection('integrations')
      .where('provider', '==', 'META_INSTAGRAM')
      .where('metaData.igAccountId', 'in', normalizedIds)
      .limit(1)
      .get();

    if (!primarySnap.empty) {
      return primarySnap.docs[0];
    }

    // ── Fallback query (igUserId) ─────────────────────────────────────────────
    const fallbackSnap = await db
      .collection('integrations')
      .where('provider', '==', 'META_INSTAGRAM')
      .where('metaData.igUserId', 'in', normalizedIds)
      .limit(1)
      .get();

    if (!fallbackSnap.empty) {
      const doc = fallbackSnap.docs[0];
      const data = doc.data() as { metaData?: { igUserId?: string } };
      const matchedId =
        normalizedIds.find((id) => id === data.metaData?.igUserId) ?? normalizedIds[0];

      this.logger.log(
        `[INSTAGRAM_WEBHOOK] Self-healing igAccountId → ${matchedId} ` +
          `for integration ${doc.id} (matched via igUserId)`,
      );
      try {
        await doc.ref.update({
          'metaData.igAccountId': matchedId,
          'metaData.lastWebhookIdentityResolutionAt': new Date().toISOString(),
        });
      } catch (healErr: any) {
        this.logger.warn(
          `[INSTAGRAM_WEBHOOK] Self-heal write failed (non-fatal): ${healErr?.message as string}`,
        );
      }

      return doc;
    }

    // ── Last-resort: probe each integration token to resolve account ownership ─
    const probeSnap = await db
      .collection('integrations')
      .where('provider', '==', 'META_INSTAGRAM')
      .limit(25)
      .get();

    for (const doc of probeSnap.docs) {
      const data = doc.data() as { metaData?: { accessToken?: string } };
      const token = data.metaData?.accessToken;
      if (!token) continue;

      const resolvedId = await this.resolveInstagramWebhookScopedId(token);
      if (!resolvedId || !normalizedIds.includes(resolvedId)) {
        continue;
      }

      this.logger.log(
        `[INSTAGRAM_WEBHOOK] Token ownership matched entry id ${resolvedId} → integration ${doc.id}`,
      );

      try {
        await doc.ref.update({
          'metaData.igAccountId': resolvedId,
          'metaData.lastWebhookIdentityResolutionAt': new Date().toISOString(),
          'metaData.accountIdResolution': 'webhook_token_probe',
        });
      } catch (healErr: any) {
        this.logger.warn(
          `[INSTAGRAM_WEBHOOK] Token-probe self-heal write failed (non-fatal): ` +
            `${healErr?.message as string}`,
        );
      }

      return doc;
    }

    return null;
  }

  /**
   * Resolves the webhook-scoped Instagram account ID from an access token.
   *
   * We probe graph.instagram.com first with fields=id,user_id and prefer user_id,
   * which is frequently the global Professional Account ID used in webhook entry.id.
   * Then we fall back to graph.facebook.com /me id, and finally instagram /me id.
   */
  private async resolveInstagramWebhookScopedId(accessToken: string): Promise<string | null> {
    try {
      const igMe = await this.defLogger.request<InstagramGraphMeResponse>({
        method: 'GET',
        url: `${INSTAGRAM_GRAPH_BASE}/${INSTAGRAM_API_VERSION}/me`,
        params: {
          fields: 'id,user_id',
          access_token: accessToken,
        },
      });

      if (igMe?.user_id) {
        return igMe.user_id;
      }

      if (igMe?.id) {
        return igMe.id;
      }
    } catch {
      // Best-effort only; fall through to Facebook Graph.
    }

    try {
      const fbMe = await this.defLogger.request<InstagramGraphMeResponse>({
        method: 'GET',
        url: `${FACEBOOK_GRAPH_BASE}/${INSTAGRAM_API_VERSION}/me`,
        params: {
          fields: 'id',
          access_token: accessToken,
        },
      });

      return fbMe?.id ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Idempotently stores an Instagram Direct Message or Story Mention.
   * Document key = messageId (Meta's mid or a deterministic fallback).
   */
  private async storeInstagramMessage(
    docRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>,
    messageId: string,
    igsid: string,
    text: string,
    timestamp: string,
    interactionType: InstagramInteractionType,
    igAccountId: string,
    direction: 'inbound' | 'outbound' = 'inbound',
  ): Promise<void> {
    const db = this.firebase.getFirestore();
    const msgRef = docRef.collection('messages').doc(messageId);

    let isDuplicate = false;
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(msgRef);
      if (existing.exists) { isDuplicate = true; return; }

      tx.set(msgRef, {
        id: messageId,
        direction,
        from: direction === 'outbound' ? igAccountId : igsid,
        to: direction === 'outbound' ? igsid : igAccountId,
        text,
        timestamp,
        channel: 'META_INSTAGRAM',
        interactionType,
        igAccountId,
      });
    });

    if (isDuplicate) {
      this.logger.warn(
        `[INSTAGRAM_WEBHOOK] Duplicate ${direction} message ignored — id=${messageId} igsid=${igsid}`,
      );
      return;
    }

    await this.firebase.update(docRef, { updatedAt: new Date().toISOString() });
    this.logger.log(
      `[INSTAGRAM_WEBHOOK] ✓ Saved ${direction} ${interactionType} — id=${messageId} counterpart=${igsid}`,
    );
  }

  /**
   * Idempotently stores an Instagram Comment.
   * Document key = commentId — enforces Single Reply Rule (Phase 5):
   * if doc already exists, the comment was already processed.
   */
  private async storeInstagramComment(
    docRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>,
    commentId: string,
    commenterIgsid: string,
    text: string,
    timestamp: string,
    mediaId: string,
    igAccountId: string,
  ): Promise<void> {
    const db = this.firebase.getFirestore();
    const msgRef = docRef.collection('messages').doc(`comment_${commentId}`);

    let isDuplicate = false;
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(msgRef);
      if (existing.exists) { isDuplicate = true; return; }

      tx.set(msgRef, {
        id: `comment_${commentId}`,
        direction: 'inbound',
        from: commenterIgsid,
        text,
        timestamp,
        channel: 'META_INSTAGRAM',
        interactionType: 'COMMENT' as InstagramInteractionType,
        commentId,
        mediaId,
        igAccountId,
        // Private Reply status — updated to 'PRIVATE_REPLY_SENT' in Phase 5
        privateReplyStatus: 'PENDING',
      });
    });

    if (isDuplicate) {
      this.logger.warn(
        `[INSTAGRAM_WEBHOOK] Duplicate comment ignored — commentId=${commentId}`,
      );
      return;
    }

    await this.firebase.update(docRef, { updatedAt: new Date().toISOString() });
    this.logger.log(
      `[INSTAGRAM_WEBHOOK] ✓ Saved COMMENT — commentId=${commentId} from=${commenterIgsid} mediaId=${mediaId}`,
    );
  }

  /**
   * Updates (or creates) the per-user conversation record within this integration.
   * Sets `lastUserInteractionTimestamp` to now — the Phase 5 24-hour window guard
   * reads this value before dispatching any outbound Instagram message.
   */
  private async updateInstagramConversationTimestamp(
    docRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>,
    igsid: string,
  ): Promise<void> {
    const conversationRef = docRef.collection('conversations').doc(igsid);
    await this.firebase.set(
      conversationRef,
      {
        igsid,
        channel: 'META_INSTAGRAM',
        lastUserInteractionTimestamp: Date.now(),
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  }
}

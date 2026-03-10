import { Injectable, Logger } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { DefensiveLoggerService } from '../common/logger/defensive-logger.service';
import { SecretManagerService } from '../common/secrets/secret-manager.service';
import type { AutoReply } from '../auto-reply/auto-reply.types';
import { MatchType } from '../auto-reply/auto-reply.types';

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
}

// ─── Internal parsed shape ───────────────────────────────────────────────────

interface ParsedInboundMessage {
  waMessageId: string;
  from: string;
  text: string;
  timestamp: string;
  phoneNumberId: string;
}

// ─── Integration context returned after persistence ──────────────────────────

interface IntegrationContext {
  businessId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  docRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>;
  accessToken: string;
  phoneNumberId: string;
  catalog?: { catalogId: string; [key: string]: unknown };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_PROVISIONING_BUSINESS_ID = 'demo-business-001';
const META_GRAPH_V25 = 'https://graph.facebook.com/v25.0';

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly firebase: FirebaseService,
    private readonly defLogger: DefensiveLoggerService,
    private readonly secrets: SecretManagerService,
  ) {}

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

    // Return integration context for rule evaluation
    const metaData = (data.metaData ?? {}) as {
      accessToken?: string;
      phoneNumberId?: string;
    };
    const catalog = data.catalog as { catalogId?: string } | undefined;

    return {
      businessId: doc.id,
      docRef,
      accessToken: metaData.accessToken ?? '',
      phoneNumberId: metaData.phoneNumberId ?? '',
      catalog: catalog?.catalogId
        ? (catalog as { catalogId: string; [key: string]: unknown })
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
    const { businessId, docRef, accessToken, phoneNumberId, catalog } = context;

    // Fetch active rules from subcollection
    const rulesSnap = await docRef
      .collection('auto_replies')
      .where('isActive', '==', true)
      .get();

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

    // A catalog must be linked to send product messages
    if (!catalog?.catalogId) {
      this.logger.warn(
        `[RULE_ENGINE] Rule matched but no catalog linked for businessId=${businessId} — skipping auto-reply`,
      );
      return;
    }

    if (!accessToken || !phoneNumberId) {
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
      docRef,
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
            catalog_id:            catalog.catalogId,
            product_retailer_id:   retailerIds[0],
          },
        }
      : {
          type: 'product_list',
          header: { type: 'text', text: 'Nuestro Catálogo' },
          body:   { text: 'Aquí tienes los productos solicitados:' },
          footer: { text: 'Migo UIT' },
          action: {
            catalog_id: catalog.catalogId,
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

    const interactivePayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: msg.from,
      type: 'interactive',
      interactive,
    };

    // Prefer the System User token for catalog-scoped operations.
    // The WABA access token lacks catalog_management permission, which Meta
    // requires to validate catalog_id during outbound product messages.
    const systemToken = this.secrets.get('META_SYSTEM_USER_TOKEN') ?? accessToken;

    const response = await this.defLogger.request<{
      messages: { id: string }[];
    }>({
      method: 'POST',
      url: `${META_GRAPH_V25}/${phoneNumberId}/messages`,
      headers: { Authorization: `Bearer ${systemToken}` },
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
   *   a. Query catalog_products subcollection for each retailer_id.
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
    docRef: FirebaseFirestore.DocumentReference,
    retailerIds: string[],
  ): Promise<string[]> {
    if (!retailerIds.length) return [];

    // Chunk into groups of 30 — Firestore `in` clause limit
    const CHUNK = 30;
    const chunks: string[][] = [];
    for (let i = 0; i < retailerIds.length; i += CHUNK) {
      chunks.push(retailerIds.slice(i, i + CHUNK));
    }

    // Fetch known records from catalog_products (no composite index needed)
    const known = new Map<string, { status: string; itemGroupId?: string }>();
    for (const chunk of chunks) {
      try {
        const snap = await docRef
          .collection('catalog_products')
          .where('retailerId', 'in', chunk)
          .get();

        for (const doc of snap.docs) {
          const d = doc.data() as { retailerId?: string; status?: string; itemGroupId?: string };
          if (d.retailerId) {
            known.set(d.retailerId, {
              status:      d.status ?? 'UNKNOWN',
              itemGroupId: d.itemGroupId,
            });
          }
        }
      } catch (err: unknown) {
        this.logger.warn(
          `[RULE_ENGINE] catalog_products lookup failed — proceeding without filter: ` +
          `${(err as Error).message}`,
        );
      }
    }

    // Filter and build candidate list
    const candidates: Array<{ retailerId: string; itemGroupId?: string }> = [];
    for (const retailerId of retailerIds) {
      const record = known.get(retailerId);
      if (record) {
        if (record.status !== 'ACTIVE') {
          this.logger.warn(
            `[RULE_ENGINE] Skipping retailer_id="${retailerId}" — ` +
            `Firestore status="${record.status}" (not ACTIVE)`,
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
}

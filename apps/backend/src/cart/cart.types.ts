// ─── Cart Domain Types ────────────────────────────────────────────────────────

export interface CartItem {
  /** Meta product retailer ID / SKU — unique key within the cart */
  productRetailerId: string;
  /** Human-readable display name (from catalog_products or text command) */
  name: string;
  quantity: number;
  /**
   * Unit price as received directly from the Meta order webhook (`item_price`).
   * No conversion is applied — the value is stored and displayed as-is.
   */
  unitPrice: number;
  currency: string;
  /**
   * Product image URL sourced from the local catalog_products Firestore cache.
   * Omitted when the product has no configured image in Commerce Manager, or
   * when the item was added via a text command rather than a native cart.
   */
  imageUrl?: string;
}

export type CartStatus =
  | 'active'
  | 'archived'
  | 'checked_out'
  /** Cart is awaiting payment — locks the cart from further modification */
  | 'pending_payment';

/**
 * Firestore document: integrations/{businessId}/carts/{cartId}
 *
 * Invariant: at most ONE document per (businessId, contactWaId) may have
 * status='active' at any given time.  All previous carts are soft-deleted
 * by setting status='archived' or 'checked_out'.
 */
export interface Cart {
  id: string;
  businessId: string;
  /** Customer's WhatsApp ID (wa_id / phone number) */
  contactWaId: string;
  status: CartStatus;
  items: CartItem[];
  createdAt: string;
  updatedAt: string;
  /** ISO timestamp set when the cart is soft-deleted */
  archivedAt?: string;
  /** Optional customer note sent with a native WhatsApp cart */
  note?: string;
  /** wamid of the last message that triggered a cart update */
  sourceWaMessageId?: string;
}

// ─── Webhook input types ──────────────────────────────────────────────────────

/**
 * Shape of a single product_item from a Meta order webhook payload.
 * Mapped from the raw snake_case Meta fields to camelCase.
 */
export interface IncomingOrderItem {
  productRetailerId: string;
  quantity: number;
  /** Unit price in minor units as provided by Meta */
  itemPrice: number;
  currency: string;
}

// ─── WhatsApp Interactive message types ──────────────────────────────────────

/**
 * A single reply-button inside a WhatsApp interactive button message.
 * API constraints: id max 256 chars, title max 20 chars.
 */
export interface WhatsAppInteractiveButton {
  type: 'reply';
  reply: {
    /** Returned verbatim in the customer's next button_reply webhook */
    id: string;
    /** Label shown on the button — max 20 characters */
    title: string;
  };
}

/**
 * Typed shape of the `interactive` object POSTed to Meta Graph API v25.0.
 * Only the `button` type is used today; the `type` discriminant is kept
 * narrow so TypeScript can enforce valid payloads at compile time.
 */
export interface WhatsAppInteractivePayload {
  type: 'button';
  body: { text: string };
  action: { buttons: WhatsAppInteractiveButton[] };
  /** Optional header above the body (text, image, video, or document) */
  header?: { type: 'text'; text: string };
  /** Optional footer below the buttons */
  footer?: { text: string };
}

// ─── Cart command result ──────────────────────────────────────────────────────

/**
 * Returned by CartService.tryHandleTextCommand when a cart command is detected.
 * WebhookService inspects the result to decide which Meta API payload to send:
 *
 *   interactivePayload present → POST type='interactive' (button message)
 *   interactivePayload absent  → POST type='text'        (plain text fallback)
 *
 * responseText is always populated — it is used as the Firestore chat-timeline
 * record regardless of which API payload was sent.
 */
export interface CartCommandResult {
  action: 'add_item' | 'remove_item' | 'clear_cart' | 'view_cart';
  cart: Cart;
  /** Plain text fallback / Firestore chat-timeline record */
  responseText: string;
  /**
   * When present, WebhookService sends this as a WhatsApp interactive message
   * instead of the plain-text responseText.
   */
  interactivePayload?: WhatsAppInteractivePayload;
}

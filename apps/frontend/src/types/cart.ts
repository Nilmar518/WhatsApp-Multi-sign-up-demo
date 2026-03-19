export interface CartItem {
  productRetailerId: string;
  name: string;
  quantity: number;
  /**
   * Unit price as received directly from the Meta order webhook (`item_price`).
   * Stored as-is — no conversion needed (e.g. 68 means 68 in the given currency).
   */
  unitPrice: number;
  currency: string;
  /**
   * Product image URL sourced from the local catalog_products Firestore cache.
   * Undefined when the product has no configured image in Commerce Manager,
   * or when the item was added via a text command rather than a native cart.
   */
  imageUrl?: string;
}

export type CartStatus = 'active' | 'archived' | 'checked_out';

/**
 * Mirrors the Firestore document at integrations/{businessId}/carts/{cartId}.
 * One document per contact may have status='active' at any given time.
 */
export interface Cart {
  id: string;
  businessId: string;
  contactWaId: string;
  status: CartStatus;
  items: CartItem[];
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  note?: string;
  sourceWaMessageId?: string;
}

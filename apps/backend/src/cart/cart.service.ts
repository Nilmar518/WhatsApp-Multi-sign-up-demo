import { Injectable, Logger } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import type {
  Cart,
  CartItem,
  CartCommandResult,
  CartStatus,
  IncomingOrderItem,
} from './cart.types';

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  // ── Text-command regexes ────────────────────────────────────────────────────
  // Compiled once at class-load time. Every regex uses /i so the input does not
  // need to be lowercased before matching. The caller normalises internal
  // whitespace (collapses multiple spaces to one) before testing.

  /** "borrar carrito" | "vaciar carrito" | "limpiar carrito" */
  private static readonly REGEX_CLEAR =
    /^(borrar|vaciar|limpiar)\s+carrito$/i;

  /**
   * ADD intent — group 2 captures the retailer_id (may contain spaces).
   * Synonyms: agregar | sumar | más | mas | añadir | anadir
   */
  private static readonly REGEX_ADD =
    /^(agregar|sumar|m[aá]s|a[ñn]adir)\s+(.+)$/i;

  /**
   * SUBTRACT intent — group 2 captures the retailer_id (may contain spaces).
   * Synonyms: quitar | restar | eliminar | menos
   */
  private static readonly REGEX_SUBTRACT =
    /^(quitar|restar|eliminar|menos)\s+(.+)$/i;

  /**
   * VIEW intent — full-string match, no capture group needed.
   * "ver carrito" | "mi carrito" | "resumen" | "total"
   *
   * These are read-only commands: Firestore is never written.
   */
  private static readonly REGEX_VIEW =
    /^(ver\s+carrito|mi\s+carrito|resumen|total)$/i;

  constructor(private readonly firebase: FirebaseService) {}

  // ─── Firestore ref helpers ──────────────────────────────────────────────────

  private cartsRef(businessId: string) {
    return this.firebase
      .getFirestore()
      .collection('integrations')
      .doc(businessId)
      .collection('carts');
  }

  // ─── Active cart management ─────────────────────────────────────────────────

  /**
   * Returns the single active cart for a contact, or null if none exists.
   *
   * Firestore index required: carts(contactWaId ASC, status ASC)
   */
  async getActiveCart(businessId: string, contactWaId: string): Promise<Cart | null> {
    const snap = await this.cartsRef(businessId)
      .where('contactWaId', '==', contactWaId)
      .where('status', '==', 'active')
      .limit(1)
      .get();
    if (snap.empty) return null;
    return snap.docs[0].data() as Cart;
  }

  private async getOrCreateActiveCart(
    businessId: string,
    contactWaId: string,
  ): Promise<Cart> {
    const existing = await this.getActiveCart(businessId, contactWaId);
    if (existing) return existing;
    return this.createEmptyCart(businessId, contactWaId);
  }

  private async createEmptyCart(businessId: string, contactWaId: string): Promise<Cart> {
    const ref = this.cartsRef(businessId).doc();
    const now = new Date().toISOString();

    const cart: Cart = {
      id: ref.id,
      businessId,
      contactWaId,
      status: 'active',
      items: [],
      createdAt: now,
      updatedAt: now,
    };

    await this.firebase.set(ref, cart as unknown as Record<string, unknown>);
    this.logger.log(
      `[CART_CREATE] ✓ id=${ref.id} businessId=${businessId} contactWaId=${contactWaId}`,
    );
    return cart;
  }

  // ─── Native order sync ──────────────────────────────────────────────────────

  /**
   * Syncs the active cart from a native WhatsApp cart (type='order') webhook.
   *
   * The incoming product_items array REPLACES the cart contents exactly —
   * matching Meta's behaviour where the native cart is the user's full intent.
   *
   * Enrichment strategy — zero Meta API calls:
   *   1. Collect all retailer IDs from the webhook payload.
   *   2. Issue a SINGLE Firestore batch query against catalog_products.
   *   3. Build a Map<retailerId, { name, imageUrl }> from the results.
   *   4. Map each webhook item against the lookup map synchronously.
   *
   * This replaces the previous approach of one individual Firestore query per
   * item (N round-trips) with a single round-trip regardless of cart size.
   */
  async syncFromNativeOrder(
    businessId: string,
    contactWaId: string,
    orderItems: IncomingOrderItem[],
    sourceWaMessageId?: string,
    note?: string,
  ): Promise<Cart> {
    const db = this.firebase.getFirestore();
    const integrationRef = db.collection('integrations').doc(businessId);

    // ── Step 1: Batch-fetch all matching catalog_products in one query ─────────
    const retailerIds = orderItems.map((i) => i.productRetailerId);
    const catalogMap = await this.lookupCatalogProducts(integrationRef, retailerIds);

    // ── Step 2: Build enriched CartItems synchronously from the Map ───────────
    const enrichedItems: CartItem[] = orderItems.map((item) => {
      const local = catalogMap.get(item.productRetailerId);

      return {
        productRetailerId: item.productRetailerId,
        // Fall back to the retailer ID when the product is absent from the cache.
        // This keeps the cart functional even for products created after the last
        // catalog sync or for catalogs that have never been synced locally.
        name: local?.name ?? item.productRetailerId,
        quantity: item.quantity,
        // Price comes directly from the webhook payload — no math applied.
        unitPrice: item.itemPrice,
        currency: item.currency,
        // Conditionally spread imageUrl so documents for image-less products
        // remain clean (no imageUrl: undefined field stored in Firestore).
        ...(local?.imageUrl ? { imageUrl: local.imageUrl } : {}),
      };
    });

    // ── Step 3: Persist to Firestore ──────────────────────────────────────────
    const cart = await this.getOrCreateActiveCart(businessId, contactWaId);
    const ref = this.cartsRef(businessId).doc(cart.id);
    const now = new Date().toISOString();

    const updates: Partial<Cart> = {
      items: enrichedItems,
      updatedAt: now,
      ...(note ? { note } : {}),
      ...(sourceWaMessageId ? { sourceWaMessageId } : {}),
    };

    await this.firebase.update(ref, updates as Record<string, unknown>);

    this.logger.log(
      `[CART_SYNC] ✓ Native order synced — cart=${cart.id} items=${enrichedItems.length} ` +
      `enriched=${catalogMap.size}/${retailerIds.length} businessId=${businessId}`,
    );
    return { ...cart, ...updates };
  }

  // ─── Soft delete ────────────────────────────────────────────────────────────

  /**
   * Archives the active cart (soft delete) and creates a fresh empty active cart.
   *
   * The old document is preserved with status='archived' for order history.
   * A new empty 'active' cart is immediately created so the next interaction
   * can begin accumulating items without waiting for an explicit cart creation.
   */
  async archiveActiveCart(businessId: string, contactWaId: string): Promise<Cart> {
    const existing = await this.getActiveCart(businessId, contactWaId);
    const now = new Date().toISOString();

    if (existing) {
      const existingRef = this.cartsRef(businessId).doc(existing.id);
      await this.firebase.update(existingRef, {
        status: 'archived' as CartStatus,
        archivedAt: now,
        updatedAt: now,
      } as Record<string, unknown>);
      this.logger.log(
        `[CART_ARCHIVE] ✓ Cart archived: id=${existing.id} businessId=${businessId}`,
      );
    }

    return this.createEmptyCart(businessId, contactWaId);
  }

  // ─── Item operations ────────────────────────────────────────────────────────

  /**
   * Adds an item to the active cart (or creates one first).
   * If an item with the same name already exists, its quantity is incremented
   * instead of inserting a duplicate row.
   */
  async addItem(
    businessId: string,
    contactWaId: string,
    name: string,
    quantity: number,
    productRetailerId?: string,
    unitPrice = 0,
    currency = 'USD',
  ): Promise<Cart> {
    const cart = await this.getOrCreateActiveCart(businessId, contactWaId);
    const ref = this.cartsRef(businessId).doc(cart.id);

    const items = [...cart.items];
    const existingIdx = items.findIndex(
      (i) => i.name.toLowerCase() === name.toLowerCase(),
    );

    if (existingIdx >= 0) {
      items[existingIdx] = {
        ...items[existingIdx],
        quantity: items[existingIdx].quantity + quantity,
      };
    } else {
      items.push({
        productRetailerId: productRetailerId ?? name.toLowerCase().replace(/\s+/g, '-'),
        name,
        quantity,
        unitPrice,
        currency,
      });
    }

    const now = new Date().toISOString();
    await this.firebase.update(ref, { items, updatedAt: now });

    this.logger.log(
      `[CART_ADD] ✓ "${name}" ×${quantity} → cart=${cart.id} businessId=${businessId}`,
    );
    return { ...cart, items, updatedAt: now };
  }

  /**
   * Removes the first item whose name contains the provided search string
   * (case-insensitive partial match). Returns the updated cart and a flag
   * indicating whether an item was actually removed.
   */
  async removeItemByName(
    businessId: string,
    contactWaId: string,
    name: string,
  ): Promise<{ cart: Cart; found: boolean }> {
    const cart = await this.getActiveCart(businessId, contactWaId);

    if (!cart || cart.items.length === 0) {
      const empty = cart ?? (await this.createEmptyCart(businessId, contactWaId));
      return { cart: empty, found: false };
    }

    const ref = this.cartsRef(businessId).doc(cart.id);
    const normalizedName = name.toLowerCase();
    const before = cart.items.length;
    const items = cart.items.filter(
      (i) => !i.name.toLowerCase().includes(normalizedName),
    );
    const found = items.length < before;

    if (found) {
      const now = new Date().toISOString();
      await this.firebase.update(ref, { items, updatedAt: now });
      this.logger.log(
        `[CART_REMOVE] ✓ Removed "${name}" from cart=${cart.id} businessId=${businessId}`,
      );
      return { cart: { ...cart, items }, found };
    }

    return { cart, found: false };
  }

  // ─── Text command handler ───────────────────────────────────────────────────

  /**
   * Entry point called by WebhookService for every inbound text message.
   *
   * Returns null when the text is not a recognised cart command so the caller
   * can fall through to the keyword auto-reply rule engine unchanged.
   *
   * When a command IS detected, always returns a CartCommandResult — even for
   * error cases (unknown retailer_id, item not in cart, etc.) — so the caller
   * has a ready-made WhatsApp reply to send back to the customer.
   *
   * Pre-processing: internal whitespace is collapsed to a single space so that
   * "Agregar   morado1" and "agregar morado1" both match identically.
   *
   * Supported intents (case-insensitive, Spanish):
   *
   *   CLEAR   → borrar / vaciar / limpiar  + "carrito"
   *   VIEW    → ver carrito / mi carrito / resumen / total   (read-only)
   *   ADD     → agregar / sumar / más / mas / añadir / anadir  + <retailer_id>
   *   SUBTRACT→ quitar / restar / eliminar / menos              + <retailer_id>
   */
  async tryHandleTextCommand(
    businessId: string,
    contactWaId: string,
    text: string,
  ): Promise<CartCommandResult | null> {
    // Normalise: trim edges, collapse runs of whitespace to a single space.
    // This makes " Agregar   morado1 " equivalent to "agregar morado1".
    const normalized = text.trim().replace(/\s+/g, ' ');

    // ── CLEAR ─────────────────────────────────────────────────────────────────
    if (CartService.REGEX_CLEAR.test(normalized)) {
      const cart = await this.archiveActiveCart(businessId, contactWaId);
      return {
        action: 'clear_cart',
        cart,
        responseText:
          '🗑️ Tu carrito fue vaciado. Podés seguir agregando productos cuando quieras.',
      };
    }

    // ── VIEW ──────────────────────────────────────────────────────────────────
    // Checked before ADD/SUBTRACT so that "total" never ambiguously matches
    // a product retailer_id that happens to start with those letters.
    if (CartService.REGEX_VIEW.test(normalized)) {
      return this.handleViewCommand(businessId, contactWaId);
    }

    // ── ADD ───────────────────────────────────────────────────────────────────
    const addMatch = normalized.match(CartService.REGEX_ADD);
    if (addMatch) {
      // Group 2 is everything after the keyword — the full retailer_id,
      // including any internal spaces (e.g. "codigo 1", "TS 001").
      const retailerId = addMatch[2].trim();
      return this.handleAddCommand(businessId, contactWaId, retailerId);
    }

    // ── SUBTRACT ──────────────────────────────────────────────────────────────
    const subMatch = normalized.match(CartService.REGEX_SUBTRACT);
    if (subMatch) {
      const retailerId = subMatch[2].trim();
      return this.handleSubtractCommand(businessId, contactWaId, retailerId);
    }

    // Not a cart command — let the caller route to the next handler.
    return null;
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Batch-fetches name and imageUrl for a list of retailer IDs from the local
   * catalog_products Firestore cache.
   *
   * Single query, zero Meta API calls.
   *
   * Returns a Map<retailerId, { name, imageUrl? }> so callers can look up any
   * item in O(1) after a single await. Entries are absent from the Map when
   * the product is not tracked in the local cache — callers must handle this
   * by falling back to the raw retailer ID as the display name.
   *
   * Non-fatal: any Firestore error is logged and an empty Map is returned so
   * the cart write still succeeds with retailer IDs as fallback names.
   *
   * Firestore `in` clause limit: 30 items per query. Native WhatsApp carts
   * are capped at 30 line items by the Meta platform, so a single query is
   * always sufficient. If that limit ever rises, chunk retailerIds into
   * groups of 30 and merge the results before returning.
   */
  private async lookupCatalogProducts(
    integrationRef: FirebaseFirestore.DocumentReference,
    retailerIds: string[],
  ): Promise<Map<string, { name: string; imageUrl?: string }>> {
    const result = new Map<string, { name: string; imageUrl?: string }>();

    if (!retailerIds.length) return result;

    try {
      const snap = await integrationRef
        .collection('catalog_products')
        .where('retailerId', 'in', retailerIds)
        .get();

      for (const doc of snap.docs) {
        const data = doc.data() as Record<string, unknown>;
        const retailerId = data['retailerId'];

        if (typeof retailerId !== 'string' || !retailerId) continue;

        const name =
          typeof data['name'] === 'string' && data['name']
            ? data['name']
            : retailerId; // safe fallback so the Map entry is always usable

        const imageUrl =
          typeof data['imageUrl'] === 'string' && data['imageUrl']
            ? data['imageUrl']
            : undefined;

        result.set(retailerId, { name, imageUrl });
      }

      this.logger.debug(
        `[CART_ENRICH] catalog_products lookup — requested=${retailerIds.length} found=${result.size}`,
      );
    } catch (err: unknown) {
      // Non-fatal: log and return empty Map so the cart write still proceeds.
      // Items will display retailer IDs as names and will have no image URLs.
      this.logger.warn(
        `[CART_ENRICH] catalog_products batch lookup failed — ` +
        `cart will save with retailer IDs as fallback names. ` +
        `Error: ${(err as Error).message}`,
      );
    }

    return result;
  }

  // ─── Text command sub-handlers ────────────────────────────────────────────

  /**
   * ADD command handler.
   *
   * Flow:
   *   1. Look up the product in catalog_products by exact retailer_id match.
   *      Returns an error response if the product is not found or not ACTIVE —
   *      the customer gets immediate feedback without a silent failure.
   *   2. Get or create the active cart.
   *   3. Search the items array by productRetailerId (exact match):
   *        found     → increment quantity by 1
   *        not found → push a new CartItem built from catalog data
   *   4. Persist to Firestore and return the result.
   */
  private async handleAddCommand(
    businessId: string,
    contactWaId: string,
    retailerId: string,
  ): Promise<CartCommandResult> {
    const db = this.firebase.getFirestore();
    const integrationRef = db.collection('integrations').doc(businessId);

    // ── Step 1: Catalog lookup ────────────────────────────────────────────────
    const product = await this.lookupProductByRetailerId(integrationRef, retailerId);

    if (!product) {
      // Product not in local cache — return a user-facing error. We still need
      // a cart object to satisfy the return type; create one if absent.
      const cart =
        (await this.getActiveCart(businessId, contactWaId)) ??
        (await this.createEmptyCart(businessId, contactWaId));
      return {
        action: 'add_item',
        cart,
        responseText:
          `❌ No encontré el producto *${retailerId}* en el catálogo. ` +
          `Verificá el código e intentá de nuevo.`,
      };
    }

    // ── Step 2: Get/create active cart ───────────────────────────────────────
    const cart = await this.getOrCreateActiveCart(businessId, contactWaId);
    const ref  = this.cartsRef(businessId).doc(cart.id);
    const items = [...cart.items];

    // ── Step 3: Increment or append ──────────────────────────────────────────
    const existingIdx = items.findIndex(
      (i) => i.productRetailerId === retailerId,
    );

    if (existingIdx >= 0) {
      // Item already in cart — increment quantity by 1.
      items[existingIdx] = {
        ...items[existingIdx],
        quantity: items[existingIdx].quantity + 1,
      };
    } else {
      // New item — build CartItem from catalog data.
      items.push({
        productRetailerId: retailerId,
        name:      product.name,
        quantity:  1,
        unitPrice: product.unitPrice,
        currency:  product.currency,
        // imageUrl is omitted entirely when the catalog has none, keeping the
        // document clean rather than writing imageUrl: undefined.
        ...(product.imageUrl ? { imageUrl: product.imageUrl } : {}),
      });
    }

    // ── Step 4: Persist ───────────────────────────────────────────────────────
    const now = new Date().toISOString();
    await this.firebase.update(ref, { items, updatedAt: now });
    const updatedCart: Cart = { ...cart, items, updatedAt: now };

    const isIncrement  = existingIdx >= 0;
    const displayQty   = isIncrement ? items[existingIdx].quantity : 1;

    this.logger.log(
      `[CART_ADD_CMD] ✓ retailerId="${retailerId}" ${isIncrement ? 'incremented' : 'added'} ` +
      `qty=${displayQty} cart=${cart.id} businessId=${businessId}`,
    );

    return {
      action: 'add_item',
      cart:   updatedCart,
      responseText: isIncrement
        ? `✅ *${product.name}* actualizado: ${displayQty} en tu carrito.`
        : `✅ *${product.name}* agregado al carrito.`,
    };
  }

  /**
   * SUBTRACT command handler.
   *
   * Flow:
   *   1. Fetch the active cart. If none exists, return an error response.
   *   2. Find the item by exact productRetailerId match.
   *      Returns an error response if not found — no silent failure.
   *   3. quantity > 1 → decrement by 1 and update the item in place.
   *      quantity === 1 → remove the item object from the array entirely.
   *   4. Persist to Firestore and return the result.
   */
  private async handleSubtractCommand(
    businessId: string,
    contactWaId: string,
    retailerId: string,
  ): Promise<CartCommandResult> {
    // ── Step 1: Cart guard ────────────────────────────────────────────────────
    const cart = await this.getActiveCart(businessId, contactWaId);
    if (!cart || cart.items.length === 0) {
      const empty =
        cart ?? (await this.createEmptyCart(businessId, contactWaId));
      return {
        action: 'remove_item',
        cart:   empty,
        responseText: '🛒 No tenés ningún producto en tu carrito activo.',
      };
    }

    // ── Step 2: Find item ─────────────────────────────────────────────────────
    const ref   = this.cartsRef(businessId).doc(cart.id);
    const items = [...cart.items];
    const idx   = items.findIndex((i) => i.productRetailerId === retailerId);

    if (idx < 0) {
      return {
        action: 'remove_item',
        cart,
        responseText:
          `❌ No encontré *${retailerId}* en tu carrito. ` +
          `Usá *ver carrito* para ver tus productos actuales.`,
      };
    }

    // ── Step 3: Decrement or remove ───────────────────────────────────────────
    const existing = items[idx];
    let responseText: string;

    if (existing.quantity > 1) {
      // Decrement — item stays in the cart with one less unit.
      items[idx]   = { ...existing, quantity: existing.quantity - 1 };
      responseText = `➖ *${existing.name}*: quedan ${items[idx].quantity} en tu carrito.`;
    } else {
      // Last unit — remove the item from the array entirely.
      items.splice(idx, 1);
      responseText = `🗑️ *${existing.name}* eliminado del carrito.`;
    }

    // ── Step 4: Persist ───────────────────────────────────────────────────────
    const now = new Date().toISOString();
    await this.firebase.update(ref, { items, updatedAt: now });

    this.logger.log(
      `[CART_SUB_CMD] ✓ retailerId="${retailerId}" ` +
      `${existing.quantity > 1 ? 'decremented' : 'removed'} ` +
      `cart=${cart.id} businessId=${businessId}`,
    );

    return {
      action: 'remove_item',
      cart:   { ...cart, items, updatedAt: now },
      responseText,
    };
  }

  /**
   * Looks up a single product from the catalog embedded in the integration document.
   *
   * Schema:
   *   integrations/{businessId}.catalog.products  — Array of raw Meta ProductItem objects.
   *   Field names are snake_case as returned by the Meta Graph API and stored by
   *   CatalogService: retailer_id, name, availability, price, currency, image_url.
   *
   * Availability guard:
   *   Only products with availability === 'in stock' are returned. Out-of-stock
   *   products are treated as absent so the customer gets an error response
   *   rather than a cart entry pointing at an unpurchasable item.
   *
   * Price parsing:
   *   Delegates to parseProductPrice() which handles both Meta's pure-numeric
   *   minor-unit strings ("10000" → 100.00) and display-formatted strings
   *   ("Bs.100.00" → 100.00). See that method for full details.
   *
   * Returns null when: catalog array is missing, retailer_id not found,
   * product out of stock, or any Firestore read error (non-fatal).
   */
  private async lookupProductByRetailerId(
    integrationRef: FirebaseFirestore.DocumentReference,
    retailerId: string,
  ): Promise<{
    name: string;
    unitPrice: number;
    currency: string;
    imageUrl?: string;
  } | null> {
    try {
      // ── Step 1: Read the integration document ───────────────────────────────
      // One document read instead of a subcollection query — the catalog array
      // is already embedded in integrations/{businessId}.catalog.products.
      const docSnap = await integrationRef.get();

      if (!docSnap.exists) {
        this.logger.warn(
          `[CART_LOOKUP] Integration document not found — cannot resolve retailerId="${retailerId}"`,
        );
        return null;
      }

      const docData = docSnap.data() as Record<string, unknown>;
      const catalog = docData['catalog'] as Record<string, unknown> | undefined;
      const products = catalog?.['products'];

      if (!Array.isArray(products) || products.length === 0) {
        this.logger.warn(
          `[CART_LOOKUP] catalog.products is absent or empty — ` +
          `call GET /catalog?businessId=... to sync from Meta first`,
        );
        return null;
      }

      // ── Step 2: Find by retailer_id (snake_case — raw Meta field name) ──────
      type RawProduct = Record<string, unknown>;
      const found = (products as RawProduct[]).find(
        (p) => p['retailer_id'] === retailerId,
      );

      if (!found) {
        this.logger.warn(
          `[CART_LOOKUP] retailerId="${retailerId}" not found in catalog.products ` +
          `(${products.length} product(s) in catalog)`,
        );
        return null;
      }

      // ── Step 3: Availability guard ──────────────────────────────────────────
      if (found['availability'] !== 'in stock') {
        this.logger.warn(
          `[CART_LOOKUP] retailerId="${retailerId}" is not purchasable — ` +
          `availability="${String(found['availability'] ?? 'missing')}"`,
        );
        return null;
      }

      // ── Step 4: Extract and normalise fields ────────────────────────────────

      // name — fall back to retailerId so the cart always shows something legible
      const name =
        typeof found['name'] === 'string' && found['name']
          ? found['name']
          : retailerId;

      // unitPrice — handles both minor-unit strings and display-formatted strings
      const unitPrice = CartService.parseProductPrice(found['price']);

      // currency — ISO 4217 code stored by CatalogService from Meta's response
      const currency =
        typeof found['currency'] === 'string' && found['currency']
          ? found['currency']
          : 'USD';

      // imageUrl — Meta field name is image_url (snake_case) in the embedded array
      const imageUrl =
        typeof found['image_url'] === 'string' && found['image_url']
          ? found['image_url']
          : undefined;

      this.logger.debug(
        `[CART_LOOKUP] ✓ Found retailerId="${retailerId}" — ` +
        `name="${name}" unitPrice=${unitPrice} currency=${currency}`,
      );

      return { name, unitPrice, currency, imageUrl };

    } catch (err: unknown) {
      this.logger.warn(
        `[CART_LOOKUP] catalog lookup failed for retailerId="${retailerId}": ` +
        `${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Parses a raw product price value from Firestore into a decimal unit price.
   *
   * The catalog price field is stored as a currency-prefixed string like
   * "Bs.100.00" or "Bs.68.00". The numeric value is extracted by matching
   * the first digit sequence with an optional decimal part, which naturally
   * skips any leading currency symbol (including the "." that is part of "Bs.").
   *
   * Examples:
   *   "Bs.100.00" → 100     (match "100.00", parseFloat → 100)
   *   "Bs.68.00"  → 68      (match "68.00",  parseFloat → 68)
   *   "Bs.9.50"   → 9.5     (match "9.50",   parseFloat → 9.5)
   *   100         → 100     (numeric, returned as-is)
   *   ""          → 0       (missing/empty, safe fallback)
   *
   * Why `.match()` and NOT `.replace(/[^0-9.]/g, '')`:
   *   replace() keeps every "." in the string, including the one in "Bs.".
   *   "Bs.100.00".replace(...)  →  ".100.00"  →  parseFloat → 0.1  ← WRONG
   *   "Bs.100.00".match(\d+...) →  "100.00"   →  parseFloat → 100  ← CORRECT
   *
   * No division by 100 is applied — the matched value is already in major units.
   *
   * Static so it can be called without an instance reference inside map().
   */
  private static parseProductPrice(raw: unknown): number {
    // ── Numeric value (stored directly) ──────────────────────────────────────
    if (typeof raw === 'number') {
      return raw > 0 ? raw : 0;
    }

    if (typeof raw !== 'string' || !raw.trim()) return 0;

    // ── Extract the first valid decimal number from the string ────────────────
    // \d+        — one or more digits (the integer part)
    // (?:\.\d+)? — an optional decimal part (dot followed by one or more digits)
    //
    // Scanning "Bs.100.00" left-to-right:
    //   "B" → no digit, skip
    //   "s" → no digit, skip
    //   "." → no digit, skip          ← the "Bs." dot is safely bypassed
    //   "1" → digit! match starts: "100.00" captured
    //
    // parseFloat("100.00") → 100  (no division, no stripping artifacts)
    const match = raw.trim().match(/\d+(?:\.\d+)?/);
    if (!match) return 0;

    const parsed = parseFloat(match[0]);
    return isNaN(parsed) || parsed <= 0 ? 0 : parsed;
  }

  // ─── View command handler ─────────────────────────────────────────────────

  /**
   * VIEW command handler — read-only, never writes to Firestore.
   *
   * Empty state → plain text reply (no items to act on, no buttons needed).
   *
   * Populated state → WhatsApp interactive button message:
   *
   *   Body:  "🛒 Tienes X artículos en tu carrito por un total de Bs. Y.
   *           ¿Qué deseas hacer?"
   *
   *   Buttons:
   *     [Ver ítems]  id=CMD_VIEW_MPM   ← customer wants the item list
   *     [Pagar]      id=CMD_PAY_CART   ← customer proceeds to checkout
   *
   * WebhookService inspects CartCommandResult.interactivePayload; when
   * present it calls sendWhatsAppInteractive() instead of sendWhatsAppText().
   */
  private async handleViewCommand(
    businessId: string,
    contactWaId: string,
  ): Promise<CartCommandResult> {
    const cart = await this.getActiveCart(businessId, contactWaId);

    // ── Empty state — plain text, no buttons ──────────────────────────────
    if (!cart || cart.items.length === 0) {
      const empty =
        cart ?? (await this.createEmptyCart(businessId, contactWaId));
      return {
        action:       'view_cart',
        cart:         empty,
        responseText: '🛒 Tu carrito está vacío.',
      };
    }

    // ── Aggregate cart metrics ─────────────────────────────────────────────
    const itemCount   = cart.items.reduce((s, i) => s + i.quantity, 0);
    const hasPrices   = cart.items.some((i) => i.unitPrice > 0);
    const totalAmount = cart.items.reduce(
      (sum, i) => sum + i.unitPrice * i.quantity,
      0,
    );
    // All items share the same currency — first item is representative.
    const currency = cart.items[0].currency;

    // ── Body text for the interactive message ──────────────────────────────
    // Shown above the buttons. Includes item count + total when prices exist.
    const plural  = itemCount !== 1 ? 's' : '';
    const bodyText = hasPrices
      ? `🛒 Tienes ${itemCount} artículo${plural} en tu carrito por un total de ` +
        `${CartService.formatCartPrice(totalAmount, currency)}. ¿Qué deseas hacer?`
      : `🛒 Tienes ${itemCount} artículo${plural} en tu carrito. ¿Qué deseas hacer?`;

    // ── Interactive button payload ─────────────────────────────────────────
    // Meta Cloud API constraints:
    //   - Max 3 reply buttons per message
    //   - button.reply.title: max 20 characters
    //   - button.reply.id:    max 256 characters, returned verbatim in the
    //                         customer's next button_reply webhook event
    const interactivePayload: import('./cart.types').WhatsAppInteractivePayload = {
      type:   'button',
      body:   { text: bodyText },
      action: {
        buttons: [
          {
            type:  'reply',
            reply: { id: 'CMD_VIEW_MPM', title: 'Ver ítems' },
          },
          {
            type:  'reply',
            reply: { id: 'CMD_PAY_CART', title: 'Pagar' },
          },
        ],
      },
    };

    this.logger.log(
      `[CART_VIEW_CMD] Interactive buttons queued — cart=${cart.id} ` +
      `items=${itemCount} total=${hasPrices ? totalAmount : 'n/a'} businessId=${businessId}`,
    );

    return {
      action: 'view_cart',
      cart,
      // responseText is stored in Firestore as the chat-timeline record.
      // It doubles as a plain-text fallback if the interactive send fails.
      responseText:        bodyText,
      interactivePayload,
    };
  }

  /**
   * Formats a direct price value (e.g. 100, 68.5) as a localised currency
   * string for use in WhatsApp message bodies.
   *
   * Uses the es-BO locale so that BOB renders as "Bs. 100" matching the
   * standard WhatsApp business convention in Bolivian markets. For other
   * ISO 4217 currency codes (USD, EUR, etc.) Intl applies the correct symbol
   * automatically. Falls back to "<CURRENCY> <amount>" if the code is unknown.
   *
   * minimumFractionDigits: 0 → "Bs. 100" (no trailing zeros for whole numbers)
   * maximumFractionDigits: 2 → "Bs. 68,50" (shows cents when non-zero)
   *
   * Static so it can be called without an instance reference inside map().
   */
  private static formatCartPrice(amount: number, currency: string): string {
    if (amount === 0) return '—';
    try {
      return new Intl.NumberFormat('es-BO', {
        style: 'currency',
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      // Intl throws RangeError for unrecognised currency codes.
      return `${currency} ${amount}`;
    }
  }
}

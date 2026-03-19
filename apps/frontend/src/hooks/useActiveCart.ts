import { useEffect, useState, useCallback } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  updateDoc,
  where,
  limit,
} from 'firebase/firestore';
import { db } from '../firebase/firebase';
import type { Cart } from '../types/cart';

// ─── Return shape ─────────────────────────────────────────────────────────────

export interface UseActiveCartResult {
  /** Active cart document, or null when the contact has no active cart */
  cart: Cart | null;
  /** True only during the initial Firestore connection (before first snapshot) */
  isLoading: boolean;
  /** True while the archive Firestore write is in-flight */
  isArchiving: boolean;
  /**
   * Soft-deletes the current active cart by writing status='archived'.
   * The onSnapshot listener detects that the document no longer matches the
   * query and automatically sets cart → null, clearing the UI with no extra
   * state management needed.
   */
  archiveCart: () => Promise<void>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useActiveCart
 *
 * **Data layer only** — no JSX, no UI logic.
 *
 * Opens a real-time Firestore listener on:
 *   `integrations/{businessId}/carts`
 *   where contactWaId == contactWaId AND status == 'active'
 *
 * Exposes:
 *   - `cart`         — the live Cart document (or null)
 *   - `isLoading`    — spinner flag for the initial fetch
 *   - `isArchiving`  — button-disabled flag during the archive write
 *   - `archiveCart`  — mutation: sets status='archived' (soft delete)
 *
 * Required Firestore composite index (create once in Firebase console):
 *   Collection group: carts | Fields: contactWaId ASC, status ASC
 *
 * Re-subscribes automatically when businessId or contactWaId changes.
 */
export function useActiveCart(
  businessId: string,
  contactWaId: string | null,
): UseActiveCartResult {
  const [cart, setCart] = useState<Cart | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);

  // ── Real-time listener ───────────────────────────────────────────────────
  useEffect(() => {
    if (!contactWaId) {
      setCart(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setCart(null);

    const q = query(
      collection(db, 'integrations', businessId, 'carts'),
      where('contactWaId', '==', contactWaId),
      where('status', '==', 'active'),
      limit(1),
    );

    console.log(
      `[useActiveCart] LISTENING — integrations/${businessId}/carts (contactWaId=${contactWaId})`,
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setIsLoading(false);
        setCart(snapshot.empty ? null : (snapshot.docs[0].data() as Cart));
      },
      (error) => {
        console.error('[useActiveCart] onSnapshot error:', error);
        setIsLoading(false);
      },
    );

    return () => {
      console.log(`[useActiveCart] UNSUBSCRIBED (contactWaId=${contactWaId})`);
      unsubscribe();
    };
  }, [businessId, contactWaId]);

  // ── Archive mutation ─────────────────────────────────────────────────────
  const archiveCart = useCallback(async () => {
    if (!cart) return;

    setIsArchiving(true);
    try {
      const cartRef = doc(db, 'integrations', businessId, 'carts', cart.id);
      const now = new Date().toISOString();

      // Writing status='archived' causes this document to fall outside the
      // query filter (status == 'active'), so onSnapshot fires immediately
      // and sets cart → null — the UI clears itself automatically.
      await updateDoc(cartRef, {
        status: 'archived',
        archivedAt: now,
        updatedAt: now,
      });

      console.log(`[useActiveCart] ✓ Cart archived: id=${cart.id}`);
    } catch (error) {
      console.error('[useActiveCart] archiveCart failed:', error);
      throw error; // re-throw so CartViewer can show an error if needed
    } finally {
      setIsArchiving(false);
    }
  }, [businessId, cart]);

  return { cart, isLoading, isArchiving, archiveCart };
}

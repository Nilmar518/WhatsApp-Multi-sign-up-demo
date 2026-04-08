/**
 * CartPanel — Container component.
 *
 * Thin glue layer: connects the useActiveCart data hook to the CartViewer
 * presentational component. Contains zero business logic and zero Firebase
 * imports — those live exclusively in their respective layers.
 *
 * Usage:
 *   <CartPanel integrationId={integrationId} contactWaId={activeContact?.waId ?? null} />
 */
import React from 'react';
import { useActiveCart } from '../../hooks/useActiveCart';
import { CartViewer } from './CartViewer';

interface CartPanelProps {
  integrationId: string | null;
  /** wa_id of the currently selected conversation contact, or null */
  contactWaId: string | null;
}

export function CartPanel({ integrationId, contactWaId }: CartPanelProps) {
  const { cart, isLoading, isArchiving, archiveCart } = useActiveCart(
    integrationId,
    contactWaId,
  );

  return (
    <CartViewer
      contactWaId={contactWaId}
      cart={cart}
      isLoading={isLoading}
      isArchiving={isArchiving}
      onArchive={archiveCart}
    />
  );
}

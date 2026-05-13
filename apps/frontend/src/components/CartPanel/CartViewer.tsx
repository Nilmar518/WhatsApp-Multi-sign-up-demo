/**
 * CartViewer — Pure presentational component.
 *
 * Zero Firebase imports. Receives all data and callbacks as props.
 * Tested independently of the Firestore layer.
 */
import { useState } from 'react';
import type { Cart, CartItem } from '../../types/cart';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CartViewerProps {
  /** wa_id of the currently selected contact (null = no conversation open) */
  contactWaId: string | null;
  /** Active cart document. Null when the contact has no active cart. */
  cart: Cart | null;
  /** True during the initial Firestore connection */
  isLoading: boolean;
  /** True while the archive write is in-flight — disables the archive button */
  isArchiving: boolean;
  /** Called when the agent clicks "Archivar Carrito" */
  onArchive: () => Promise<void>;
}

// ─── Price helpers ────────────────────────────────────────────────────────────

/**
 * Formats a direct price value (e.g. 68, 100.5) as a localised currency string.
 * No conversion is applied — unitPrice is stored as the exact webhook value.
 *
 * minimumFractionDigits: 0  → "Bs. 68"  (no trailing zeros for whole amounts)
 * maximumFractionDigits: 2  → "Bs. 68,50" (shows cents when present)
 *
 * Falls back to a plain "<CURRENCY> <amount>" string if the ISO currency code
 * is unrecognised by the runtime's Intl implementation.
 */
function formatPrice(amount: number, currency: string): string {
  if (amount === 0) return '—';
  try {
    return new Intl.NumberFormat('es-BO', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

function cartTotal(items: CartItem[]): { amount: number; currency: string } | null {
  if (items.length === 0) return null;
  const hasPrices = items.some((i) => i.unitPrice > 0);
  if (!hasPrices) return null;
  return {
    amount: items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0),
    currency: items[0].currency,
  };
}

// ─── ProductThumbnail ─────────────────────────────────────────────────────────

/**
 * Renders the product image when imageUrl is available and loads successfully.
 * Falls back to a neutral shopping-bag icon on two conditions:
 *   1. imageUrl is undefined (product has no image in Commerce Manager)
 *   2. The <img> fires onError (broken URL, CORS, deleted CDN asset)
 *
 * The error state is local to this component so a single broken image never
 * affects the rest of the list.
 */
function ProductThumbnail({ imageUrl, name }: { imageUrl?: string; name: string }) {
  const [imgError, setImgError] = useState(false);
  const showPlaceholder = !imageUrl || imgError;

  if (showPlaceholder) {
    return (
      <div
        className="w-14 h-14 rounded-md border border-edge bg-surface-subtle
                   flex items-center justify-center flex-shrink-0"
        aria-hidden
      >
        {/* Heroicons: shopping-bag outline */}
        <svg
          className="w-6 h-6 text-content-3"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993
               l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0
               01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576
               0 1.059.435 1.119 1.007z"
          />
        </svg>
      </div>
    );
  }

  return (
    <img
      src={imageUrl}
      alt={name}
      onError={() => setImgError(true)}
      className="w-14 h-14 object-cover rounded-md border border-edge flex-shrink-0"
    />
  );
}

// ─── CartItemRow ──────────────────────────────────────────────────────────────

function CartItemRow({ item }: { item: CartItem }) {
  const subtotal = item.unitPrice * item.quantity;

  return (
    <li className="flex items-center gap-3 py-3 border-b border-edge last:border-0">

      {/* Left — product thumbnail (56×56, rounded, with fallback) */}
      <ProductThumbnail imageUrl={item.imageUrl} name={item.name} />

      {/* Middle — name + unit price */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-content truncate leading-tight">
          {item.name}
        </p>
        {item.unitPrice > 0 && (
          <p className="text-xs text-content-3 mt-0.5 tabular-nums">
            {formatPrice(item.unitPrice, item.currency)}
          </p>
        )}
      </div>

      {/* Right — quantity label + bold subtotal */}
      <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
        <span className="text-xs text-content-3 tabular-nums">
          Qty: {item.quantity}
        </span>
        <span className="text-sm font-bold text-content tabular-nums">
          {item.unitPrice > 0 ? formatPrice(subtotal, item.currency) : '—'}
        </span>
      </div>
    </li>
  );
}

// ─── Skeleton loader ──────────────────────────────────────────────────────────

function CartSkeleton() {
  return (
    <div className="px-4 py-1 animate-pulse">
      {[1, 2, 3].map((n) => (
        // Mirror the CartItemRow flex layout so the skeleton collapses to the
        // same dimensions as a real row — no layout shift when data arrives.
        <div
          key={n}
          className="flex items-center gap-3 py-3 border-b border-edge last:border-0"
        >
          {/* Image placeholder */}
          <div className="w-14 h-14 rounded-md bg-surface-subtle flex-shrink-0" />

          {/* Name + price placeholder */}
          <div className="flex-1 space-y-2">
            <div className="h-3 bg-surface-subtle rounded w-3/4" />
            <div className="h-2.5 bg-surface-subtle rounded w-1/3" />
          </div>

          {/* Qty + subtotal placeholder */}
          <div className="flex flex-col items-end gap-1.5">
            <div className="h-2.5 bg-surface-subtle rounded w-10" />
            <div className="h-3 bg-surface-subtle rounded w-14" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Archive button ───────────────────────────────────────────────────────────

interface ArchiveButtonProps {
  isArchiving: boolean;
  onArchive: () => Promise<void>;
}

function ArchiveButton({ isArchiving, onArchive }: ArchiveButtonProps) {
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    try {
      await onArchive();
    } catch {
      setError('No se pudo archivar el carrito. Reintentá en un momento.');
    }
  }

  return (
    <div className="space-y-2">
      {error && (
        <p className="text-xs text-danger-text text-center">{error}</p>
      )}
      <button
        onClick={handleClick}
        disabled={isArchiving}
        className="
          w-full flex items-center justify-center gap-2
          px-4 py-2.5 rounded-lg text-sm font-semibold
          border border-red-200 text-danger-text bg-danger-bg
          hover:bg-red-100 hover:border-red-300
          active:scale-[0.98]
          disabled:opacity-50 disabled:cursor-not-allowed
          transition-all duration-150
        "
      >
        {isArchiving ? (
          <>
            <svg
              className="w-4 h-4 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Archivando…
          </>
        ) : (
          <>
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8l1 12a2 2 0 002 2h8a2 2 0 002-2L19 8"
              />
            </svg>
            Archivar Carrito
          </>
        )}
      </button>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CartViewer({
  contactWaId,
  cart,
  isLoading,
  isArchiving,
  onArchive,
}: CartViewerProps) {
  const itemCount = cart?.items.reduce((s, i) => s + i.quantity, 0) ?? 0;
  const total = cart ? cartTotal(cart.items) : null;

  return (
    /*
     * Outer shell: fixed height + flex column.
     * The header never scrolls. The item list scrolls inside its own div.
     * The footer (total + archive button) is pinned below the list.
     *
     * h-[500px] — fixed height as specified in the wireframe.
     * overflow-hidden on the shell prevents the card itself from growing.
     */
    <div className="flex flex-col h-full bg-surface-raised overflow-hidden">

      {/* ── Sticky header ─────────────────────────────────────────────────── */}
      {/*
       * flex-shrink-0 keeps the header from being compressed by the scrollable
       * region. "Sticky" in UX terms — it stays visible while items scroll.
       */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-edge bg-surface-subtle flex-shrink-0">
        <div className="flex items-center gap-2">
          <span role="img" aria-label="carrito" className="text-base leading-none">
            🛒
          </span>
          <h2 className="text-xs font-semibold text-content-2 uppercase tracking-widest">
            Carrito Actual
          </h2>
        </div>

        {/* Item count badge — only shown when there are items */}
        {itemCount > 0 && (
          <span className="text-xs bg-emerald-100 text-emerald-700 font-semibold px-2 py-0.5 rounded-full tabular-nums">
            {itemCount}&nbsp;ítem{itemCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* ── Scrollable body ────────────────────────────────────────────────── */}
      {/*
       * flex-1 takes all remaining vertical space.
       * overflow-y-auto enables scrolling only in this region.
       * min-h-0 is required in a flex column for overflow-y-auto to activate.
       */}
      <div className="flex-1 overflow-y-auto min-h-0">

        {/* State: no contact selected */}
        {!contactWaId && (
          <EmptyState
            icon="💬"
            title="Ninguna conversación seleccionada"
            subtitle="Seleccioná un chat para ver el carrito del cliente en tiempo real."
          />
        )}

        {/* State: loading (initial connection) */}
        {contactWaId && isLoading && <CartSkeleton />}

        {/* State: no active cart */}
        {contactWaId && !isLoading && (!cart || cart.items.length === 0) && (
          <EmptyState
            icon="🛒"
            title="El usuario no tiene un carrito activo"
            subtitle="Los productos aparecerán aquí cuando el cliente agregue artículos desde WhatsApp."
          />
        )}

        {/* State: cart with items */}
        {contactWaId && !isLoading && cart && cart.items.length > 0 && (
          <ul className="px-4 py-1">
            {cart.items.map((item, idx) => (
              <CartItemRow key={`${item.productRetailerId}-${idx}`} item={item} />
            ))}
          </ul>
        )}
      </div>

      {/* ── Footer — total + archive button ──────────────────────────────── */}
      {/*
       * flex-shrink-0 pins the footer below the scrollable list.
       * Only rendered when a real cart exists (non-empty).
       */}
      {cart && cart.items.length > 0 && (
        <div className="flex-shrink-0 border-t border-edge px-4 py-3 bg-surface-subtle space-y-3">
          {/* Running total */}
          {total && (
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-content-2 uppercase tracking-widest">
                Total estimado
              </span>
              <span className="text-base font-bold text-emerald-600 tabular-nums">
                {formatPrice(total.amount, total.currency)}
              </span>
            </div>
          )}

          {/* Archive / soft-delete action */}
          <ArchiveButton isArchiving={isArchiving} onArchive={onArchive} />

          {/* Last-updated timestamp */}
          <p className="text-[11px] text-content-3 text-center">
            Actualizado{' '}
            {new Date(cart.updatedAt).toLocaleString('es-AR', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Shared empty state ───────────────────────────────────────────────────────

function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 py-8 text-center gap-2">
      <span className="text-4xl leading-none mb-1" role="img" aria-hidden>
        {icon}
      </span>
      <p className="text-sm font-medium text-content-2 leading-snug">{title}</p>
      <p className="text-xs text-content-3 leading-snug max-w-[200px]">{subtitle}</p>
    </div>
  );
}

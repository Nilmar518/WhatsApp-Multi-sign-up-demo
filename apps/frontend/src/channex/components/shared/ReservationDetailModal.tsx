import { useEffect } from 'react';
import type { Reservation } from '../../api/channexHubApi';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

function nights(checkIn: string, checkOut: string): number | null {
  const a = new Date(checkIn);
  const b = new Date(checkOut);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function statusLabel(status: string): string {
  return status.replace(/^booking_/, '').replace(/_/g, ' ');
}

const STATUS_STYLES: Record<string, string> = {
  new: 'bg-ok-bg text-ok-text',
  booking_new: 'bg-ok-bg text-ok-text',
  confirmed: 'bg-ok-bg text-ok-text',
  modified: 'bg-caution-bg text-caution-text',
  booking_modification: 'bg-caution-bg text-caution-text',
  cancelled: 'bg-danger-bg text-danger-text',
  booking_cancellation: 'bg-danger-bg text-danger-text',
};

function statusStyle(status: string): string {
  return STATUS_STYLES[status] ?? 'bg-surface-subtle text-content-2';
}

// ─── Row helpers ──────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex items-start gap-3 py-2 border-b border-edge last:border-0">
      <span className="w-36 shrink-0 text-xs text-content-3 pt-0.5">{label}</span>
      <span className="flex-1 text-sm text-content break-words">{value}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-5 mb-1 text-[11px] font-semibold uppercase tracking-wider text-content-3">
      {children}
    </p>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface ReservationDetailModalProps {
  reservation: Reservation | null;
  onClose: () => void;
  /** Called when the "No show" button is clicked. Passes the reservation. */
  onNoShow?: (reservation: Reservation) => void;
}

export default function ReservationDetailModal({
  reservation: r,
  onClose,
  onNoShow,
}: ReservationDetailModalProps) {
  useEffect(() => {
    if (!r) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [r, onClose]);

  if (!r) return null;

  const guestName =
    [r.guest_first_name, r.guest_last_name].filter(Boolean).join(' ') ||
    r.customer_name ||
    '—';

  const nightCount = r.count_of_nights ?? nights(r.check_in, r.check_out);

  // Use rooms sum for BDC (top-level amount is often 0); fall back to gross_amount
  const displayAmount =
    (r.gross_amount_rooms ?? 0) > 0 ? r.gross_amount_rooms : r.gross_amount;

  const isBookingCom = r.channel === 'booking_com';

  const occupancyParts: string[] = [];
  if ((r.occ_adults ?? 0) > 0) occupancyParts.push(`${r.occ_adults} adult${r.occ_adults !== 1 ? 's' : ''}`);
  if ((r.occ_children ?? 0) > 0) occupancyParts.push(`${r.occ_children} child${r.occ_children !== 1 ? 'ren' : ''}`);
  if ((r.occ_infants ?? 0) > 0) occupancyParts.push(`${r.occ_infants} infant${r.occ_infants !== 1 ? 's' : ''}`);

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Panel */}
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-surface shadow-2xl border border-edge">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-surface border-b border-edge px-5 py-4 rounded-t-2xl">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-base font-semibold text-content truncate">{guestName}</h2>
            <span
              className={`shrink-0 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${statusStyle(r.booking_status)}`}
            >
              {statusLabel(r.booking_status)}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full p-1.5 text-content-3 hover:bg-surface-subtle hover:text-content transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-5 pb-5">
          {/* Stay */}
          <SectionTitle>Stay</SectionTitle>
          <div className="rounded-xl border border-edge bg-surface-subtle px-4 py-1">
            <InfoRow label="Check-in" value={r.check_in || '—'} />
            <InfoRow label="Check-out" value={r.check_out || '—'} />
            {nightCount !== null && (
              <InfoRow label="Duration" value={`${nightCount} night${nightCount !== 1 ? 's' : ''}`} />
            )}
            {occupancyParts.length > 0 && (
              <InfoRow label="Guests" value={occupancyParts.join(', ')} />
            )}
            {r.meal_plan && <InfoRow label="Meal plan" value={r.meal_plan} />}
          </div>

          {/* Financial */}
          <SectionTitle>Financial</SectionTitle>
          <div className="rounded-xl border border-edge bg-surface-subtle px-4 py-1">
            <InfoRow
              label="Total (gross)"
              value={displayAmount > 0 ? fmt(displayAmount, r.currency) : '—'}
            />
            {r.ota_fee > 0 && (
              <InfoRow label="OTA commission" value={fmt(r.ota_fee, r.currency)} />
            )}
            <InfoRow
              label="Net payout"
              value={r.net_payout > 0 ? fmt(r.net_payout, r.currency) : '—'}
            />
            <InfoRow label="Payment collect" value={r.payment_collect || '—'} />
            <InfoRow label="Payment type" value={r.payment_type || '—'} />
          </div>

          {/* Guest / Contact */}
          <SectionTitle>Guest</SectionTitle>
          <div className="rounded-xl border border-edge bg-surface-subtle px-4 py-1">
            <InfoRow label="Name" value={guestName} />
            {r.customer_email && (
              <InfoRow
                label="Email"
                value={
                  <a
                    href={`mailto:${r.customer_email}`}
                    className="text-brand hover:underline"
                  >
                    {r.customer_email}
                  </a>
                }
              />
            )}
            {r.customer_phone && (
              <InfoRow
                label="Phone"
                value={
                  <a
                    href={`tel:${r.customer_phone}`}
                    className="text-brand hover:underline"
                  >
                    {r.customer_phone}
                  </a>
                }
              />
            )}
            {r.customer_country && <InfoRow label="Country" value={r.customer_country} />}
          </div>

          {/* Booking refs */}
          <SectionTitle>Booking info</SectionTitle>
          <div className="rounded-xl border border-edge bg-surface-subtle px-4 py-1">
            {r.ota_unique_id && <InfoRow label="OTA booking ID" value={r.ota_unique_id} />}
            {r.reservation_id && r.reservation_id !== r.ota_unique_id && (
              <InfoRow label="Reservation ID" value={r.reservation_id} />
            )}
            {r.channel_name && <InfoRow label="Channel" value={r.channel_name} />}
            {r.pms_booking_id && (
              <InfoRow
                label="PMS ID"
                value={
                  <span className="font-mono text-xs">{r.pms_booking_id}</span>
                }
              />
            )}
          </div>

          {/* Notes */}
          {r.notes && (
            <>
              <SectionTitle>Notes</SectionTitle>
              <div className="rounded-xl border border-edge bg-surface-subtle px-4 py-3">
                <p className="whitespace-pre-wrap text-xs text-content-2">{r.notes}</p>
              </div>
            </>
          )}

          {/* No show — BDC only */}
          {isBookingCom && onNoShow && r.booking_status !== 'cancelled' && (
            <div className="mt-5 rounded-xl border border-danger-bg bg-danger-bg/30 px-4 py-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-danger-text">Mark as No Show</p>
                <p className="mt-0.5 text-xs text-content-3">
                  Guest did not arrive. This action will be reported to Booking.com.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNoShow(r)}
                className="shrink-0 rounded-lg border border-danger-text px-3 py-1.5 text-xs font-semibold text-danger-text hover:bg-danger-bg transition-colors"
              >
                No show
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

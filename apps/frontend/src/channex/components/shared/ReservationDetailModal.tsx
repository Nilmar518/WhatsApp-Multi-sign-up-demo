import { useEffect, useState, useCallback } from 'react';
import type { Reservation } from '../../api/channexHubApi';
import { syncBookingFromChannex, getBookingById } from '../../api/channexHubApi';
import NoShowConfirmModal from './NoShowConfirmModal';
import { useLanguage } from '../../../context/LanguageContext';
import DocumentsSection from '../../../documents/DocumentsSection';

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
  tenantId: string;
  propertyTitle?: string;
  /** OTA channel code from the property (e.g. "BDC", "ABB"). Used to determine No Show eligibility. */
  propertyChannelCode: string | null;
  onClose: () => void;
  /** Called after a successful No Show report — use to refresh the reservations list. */
  onNoShowComplete?: () => void;
}

export default function ReservationDetailModal({
  reservation,
  tenantId,
  propertyTitle,
  propertyChannelCode,
  onClose,
  onNoShowComplete,
}: ReservationDetailModalProps) {
  const { t } = useLanguage();
  const [showNoShowConfirm, setShowNoShowConfirm] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ ok: boolean; rooms?: number } | null>(null);
  const [localReservation, setLocalReservation] = useState<Reservation | null>(null);

  // handleSync uses localReservation/reservation directly — not r — so it can
  // live before the early-return guard without causing TypeScript narrowing issues.
  const handleSync = useCallback(async () => {
    const current = localReservation ?? reservation;
    if (!current?.channex_booking_id || !current?.channex_property_id) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      await syncBookingFromChannex(current.channex_property_id, current.channex_booking_id, tenantId);
      const refreshed = await getBookingById(current.channex_property_id, current.channex_booking_id, tenantId);
      setLocalReservation(refreshed.reservation);
      setSyncResult({ ok: true, rooms: refreshed.reservation.rooms_detail?.length ?? 0 });
    } catch (err) {
      console.error('[BOOKING-SYNC] Error:', err);
      setSyncResult({ ok: false });
    } finally {
      setSyncing(false);
    }
  }, [localReservation, reservation, tenantId]);

  useEffect(() => {
    if (!reservation) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !showNoShowConfirm) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [reservation, onClose, showNoShowConfirm]);

  // Visibility is controlled by the parent prop.
  // r is declared AFTER the guard so TypeScript can narrow it to Reservation.
  if (!reservation) return null;
  const r: Reservation = localReservation ?? reservation;

  const guestName =
    [r.guest_first_name, r.guest_last_name].filter(Boolean).join(' ') ||
    r.customer_name ||
    '—';

  const nightCount = r.count_of_nights ?? nights(r.check_in, r.check_out);

  // Use rooms sum for BDC (top-level amount is often 0); fall back to gross_amount
  const displayAmount =
    (r.gross_amount_rooms ?? 0) > 0 ? r.gross_amount_rooms : r.gross_amount;

  const isBookingCom =
    propertyChannelCode === 'BookingCom' || propertyChannelCode === 'booking_com';
  const noShowButtonVisible =
    isBookingCom &&
    r.booking_status !== 'cancelled' &&
    r.booking_status !== 'no_show' &&
    !!r.channex_booking_id;

  console.log('[NoShow] button check:', {
    reservation_id: r.reservation_id,
    propertyChannelCode,
    isBookingCom,
    booking_status: r.booking_status,
    channex_booking_id: r.channex_booking_id,
    noShowButtonVisible,
  });

  const occupancyParts: string[] = [];
  if ((r.occ_adults ?? 0) > 0) occupancyParts.push(t(r.occ_adults === 1 ? 'channex.reservDetail.occ.adult.one' : 'channex.reservDetail.occ.adult.many', { n: r.occ_adults ?? 0 }));
  if ((r.occ_children ?? 0) > 0) occupancyParts.push(t(r.occ_children === 1 ? 'channex.reservDetail.occ.child.one' : 'channex.reservDetail.occ.child.many', { n: r.occ_children ?? 0 }));
  if ((r.occ_infants ?? 0) > 0) occupancyParts.push(t(r.occ_infants === 1 ? 'channex.reservDetail.occ.infant.one' : 'channex.reservDetail.occ.infant.many', { n: r.occ_infants ?? 0 }));

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
          <SectionTitle>{t('channex.reservDetail.stay')}</SectionTitle>
          <div className="rounded-xl border border-edge bg-surface-subtle px-4 py-1">
            <InfoRow label={t('channex.reservDetail.checkin')} value={r.check_in || '—'} />
            {r.arrival_hour && <InfoRow label="Hora llegada" value={r.arrival_hour} />}
            <InfoRow label={t('channex.reservDetail.checkout')} value={r.check_out || '—'} />
            {nightCount !== null && (
              <InfoRow label={t('channex.reservDetail.duration')} value={t(nightCount === 1 ? 'channex.reservDetail.night.one' : 'channex.reservDetail.night.many', { n: nightCount })} />
            )}
            {occupancyParts.length > 0 && (
              <InfoRow label={t('channex.reservDetail.guests')} value={occupancyParts.join(', ')} />
            )}
            {r.meal_plan && <InfoRow label={t('channex.reservDetail.mealPlan')} value={r.meal_plan} />}
          </div>

          {/* Rooms */}
          {r.rooms_detail && r.rooms_detail.length > 0 && (
            <>
              <SectionTitle>Habitaciones ({r.rooms_detail.length})</SectionTitle>
              <div className="space-y-2">
                {r.rooms_detail.map((room, i) => (
                  <div key={i} className="rounded-xl border border-edge bg-surface-subtle px-4 py-2">
                    <div className="flex items-center justify-between gap-2 py-1">
                      <span className="text-xs text-content-3 shrink-0">Habitación {i + 1}</span>
                      <span className="text-sm font-medium text-content">
                        {room.room_title ?? (room.room_type_code ? `#${room.room_type_code}` : '—')}
                      </span>
                    </div>
                    {room.amount != null && (
                      <div className="flex items-center justify-between gap-2 py-1 border-t border-edge">
                        <span className="text-xs text-content-3 shrink-0">Precio</span>
                        <span className="text-sm text-content">{room.amount} {r.currency}</span>
                      </div>
                    )}
                    {room.guests && room.guests.length > 0 && (
                      <div className="flex items-center justify-between gap-2 py-1 border-t border-edge">
                        <span className="text-xs text-content-3 shrink-0">Huésped</span>
                        <span className="text-sm text-content">
                          {room.guests.map(g => [g.name, g.surname].filter(Boolean).join(' ')).join(', ')}
                        </span>
                      </div>
                    )}
                    {room.meal_plan && (
                      <div className="flex items-start gap-2 py-1 border-t border-edge">
                        <span className="text-xs text-content-3 shrink-0 pt-0.5">Plan comidas</span>
                        <span className="text-xs text-content-2 text-right">{room.meal_plan}</span>
                      </div>
                    )}
                    {room.smoking_preferences && (
                      <div className="flex items-center justify-between gap-2 py-1 border-t border-edge">
                        <span className="text-xs text-content-3 shrink-0">Fumador</span>
                        <span className="text-xs text-content-2">{room.smoking_preferences}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Financial */}
          <SectionTitle>{t('channex.reservDetail.financial')}</SectionTitle>
          <div className="rounded-xl border border-edge bg-surface-subtle px-4 py-1">
            <InfoRow
              label={t('channex.reservDetail.grossTotal')}
              value={displayAmount > 0 ? fmt(displayAmount, r.currency) : '—'}
            />
            {r.ota_fee > 0 && (
              <InfoRow label={t('channex.reservDetail.otaComm')} value={fmt(r.ota_fee, r.currency)} />
            )}
            <InfoRow
              label={t('channex.reservDetail.netPayout')}
              value={r.net_payout > 0 ? fmt(r.net_payout, r.currency) : '—'}
            />
            <InfoRow label={t('channex.reservDetail.payCollect')} value={r.payment_collect || '—'} />
            <InfoRow label={t('channex.reservDetail.payType')} value={r.payment_type || '—'} />
          </div>

          {/* Guest / Contact */}
          <SectionTitle>
            {t('channex.reservDetail.guestSection')}
            {r.is_genius && (
              <span className="ml-2 inline-flex items-center rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">
                ★ Genius
              </span>
            )}
          </SectionTitle>
          <div className="rounded-xl border border-edge bg-surface-subtle px-4 py-1">
            <InfoRow label={t('channex.reservDetail.name')} value={guestName} />
            {r.customer_phone && (
              <InfoRow
                label={t('channex.reservDetail.phone')}
                value={
                  <a href={`tel:${r.customer_phone}`} className="text-brand hover:underline">
                    {r.customer_phone}
                  </a>
                }
              />
            )}
            {r.customer_email && (
              <InfoRow
                label={t('channex.reservDetail.email')}
                value={
                  <a href={`mailto:${r.customer_email}`} className="text-brand hover:underline">
                    {r.customer_email}
                  </a>
                }
              />
            )}
            {r.customer_country && <InfoRow label={t('channex.reservDetail.country')} value={r.customer_country} />}
          </div>

          {/* Booking refs */}
          <SectionTitle>{t('channex.reservDetail.bookingInfo')}</SectionTitle>
          <div className="rounded-xl border border-edge bg-surface-subtle px-4 py-1">
            {propertyTitle && (
              <InfoRow label={t('channex.reservDetail.property')} value={propertyTitle} />
            )}
            {r.ota_unique_id && <InfoRow label={t('channex.reservDetail.otaId')} value={r.ota_unique_id} />}
            {r.reservation_id && r.reservation_id !== r.ota_unique_id && (
              <InfoRow label={t('channex.reservDetail.reservId')} value={r.reservation_id} />
            )}
            {r.channel_name && <InfoRow label={t('channex.reservDetail.channel')} value={r.channel_name} />}
            {r.pms_booking_id && (
              <InfoRow
                label={t('channex.reservDetail.pmsId')}
                value={
                  <span className="font-mono text-xs">{r.pms_booking_id}</span>
                }
              />
            )}
          </div>

          {/* Sync from Channex */}
          {r.channex_booking_id && (
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                disabled={syncing}
                onClick={() => void handleSync()}
                className="rounded-lg border border-edge bg-surface px-3 py-1.5 text-xs font-medium text-content-2 hover:border-brand-light hover:text-brand transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {syncing ? 'Syncing...' : '↻ Sync desde Channex'}
              </button>
              {syncResult && (
                <span className={`text-xs ${syncResult.ok ? 'text-ok-text' : 'text-danger-text'}`}>
                  {syncResult.ok
                    ? `✓ ${syncResult.rooms} habitación(es) actualizadas`
                    : '✗ Error al sincronizar'}
                </span>
              )}
            </div>
          )}

          {/* Notes */}
          {r.notes && (
            <>
              <SectionTitle>{t('channex.reservDetail.notes')}</SectionTitle>
              <div className="rounded-xl border border-edge bg-surface-subtle px-4 py-3">
                <p className="whitespace-pre-wrap text-xs text-content-2">{r.notes}</p>
              </div>
            </>
          )}

          {/* Documentos */}
          <SectionTitle>Documentos</SectionTitle>
          <DocumentsSection
            reservation={r}
            businessId={tenantId}
          />

          {/* No show — BDC only */}
          {noShowButtonVisible && (
            <div className="mt-5 rounded-xl border border-danger-bg bg-danger-bg/30 px-4 py-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-danger-text">{t('channex.reservDetail.noShowTitle')}</p>
                <p className="mt-0.5 text-xs text-content-3">
                  {t('channex.reservDetail.noShowDesc')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowNoShowConfirm(true)}
                className="shrink-0 rounded-lg border border-danger-text px-3 py-1.5 text-xs font-semibold text-danger-text hover:bg-danger-bg transition-colors"
              >
                {t('channex.reservDetail.noShowBtn')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* No Show confirmation modal — rendered above this modal */}
      {showNoShowConfirm && r && (
        <NoShowConfirmModal
          reservation={r}
          tenantId={tenantId}
          onClose={() => setShowNoShowConfirm(false)}
          onSuccess={() => {
            setShowNoShowConfirm(false);
            onNoShowComplete?.();
          }}
        />
      )}
    </div>
  );
}

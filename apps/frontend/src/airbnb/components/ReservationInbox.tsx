import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { collection, doc, getDocs, limit, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { linkGuestPhone } from '../api/channexApi';
import ChatConsole from '../../components/ChatConsole';

interface Props {
  propertyId?: string;
  integrationDocId?: string | null;
  activePropertyId?: string | null;
  onExpandClick?: () => void;
}

interface ReservationRecord {
  reservation_id: string;
  booking_unique_id?: string;
  booking_status: 'new' | 'modified' | 'cancelled';
  status?: string;
  channex_property_id: string;
  check_in: string;
  check_out: string;
  arrival_date?: string;
  departure_date?: string;
  gross_amount: number;
  total_price?: number;
  currency: string;
  ota_fee: number;
  net_payout: number;
  additional_taxes: number;
  payment_collect: 'ota' | 'property';
  payment_type: string;
  guest_first_name: string | null;
  guest_last_name: string | null;
  customer_name?: string | null;
  whatsapp_number?: string | null;
  created_at: string;
  updated_at: string;
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function buildGuestName(reservation: ReservationRecord): string {
  if (reservation.customer_name && reservation.customer_name.trim()) {
    return reservation.customer_name;
  }

  const parts = [reservation.guest_first_name, reservation.guest_last_name].filter(Boolean);
  return parts.length ? parts.join(' ') : 'Guest unavailable';
}

function getReservationId(reservation: ReservationRecord): string {
  return reservation.booking_unique_id ?? reservation.reservation_id;
}

function getCheckIn(reservation: ReservationRecord): string {
  return reservation.arrival_date ?? reservation.check_in;
}

function getCheckOut(reservation: ReservationRecord): string {
  return reservation.departure_date ?? reservation.check_out;
}

function getStatus(reservation: ReservationRecord): string {
  return reservation.booking_status ?? reservation.status ?? 'unknown';
}

function normalizeStatus(status: string): string {
  return status.trim().toLowerCase();
}

function isInactiveStatus(status: string): boolean {
  const normalized = normalizeStatus(status);
  return (
    normalized === 'booking_cancellation' ||
    normalized === 'booking_cancelled' ||
    normalized === 'cancelled' ||
    normalized === 'cancellation'
  );
}

function getStatusDisplay(status: string): {
  label: 'Activo' | 'Cancelado';
  badgeClass: string;
} {
  if (isInactiveStatus(status)) {
    return {
      label: 'Cancelado',
      badgeClass: 'bg-rose-100 text-rose-700',
    };
  }

  return {
    label: 'Activo',
    badgeClass: 'bg-emerald-100 text-emerald-700',
  };
}

function getPayoutAmount(reservation: ReservationRecord): number {
  if (typeof reservation.net_payout === 'number') {
    return reservation.net_payout;
  }

  if (typeof reservation.total_price === 'number') {
    return reservation.total_price;
  }

  return reservation.gross_amount;
}

function resolveTenantId(): string {
  return new URLSearchParams(window.location.search).get('tenantId') ?? 'demo-business-001';
}

type MinimalChatConsoleProps = {
  phoneNumber: string;
  onClose: () => void;
};

const GuestChatConsole = ChatConsole as unknown as ComponentType<MinimalChatConsoleProps>;

export default function ReservationInbox({
  propertyId,
  integrationDocId,
  activePropertyId,
  onExpandClick,
}: Props) {
  const tenantId = useMemo(() => resolveTenantId(), []);
  const [resolvedIntegrationDocId, setResolvedIntegrationDocId] = useState<string | null>(integrationDocId ?? null);
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [linkedPhones, setLinkedPhones] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [phoneDrafts, setPhoneDrafts] = useState<Record<string, string>>({});
  const [linking, setLinking] = useState<string | null>(null);
  const [activeChatPhone, setActiveChatPhone] = useState<string | null>(null);

  useEffect(() => {
    if (integrationDocId) {
      setResolvedIntegrationDocId(integrationDocId);
      return;
    }

    if (!propertyId) {
      setResolvedIntegrationDocId(null);
      setReservations([]);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);
    setResolvedIntegrationDocId(null);
    setReservations([]);

    const resolve = async () => {
      try {
        const q = query(
          collection(db, 'channex_integrations'),
          where('channex_property_id', '==', propertyId),
          limit(1),
        );

        const snapshot = await getDocs(q);

        if (!active) return;

        if (snapshot.empty) {
          setError('No integration document was found for this property.');
          setLoading(false);
          return;
        }

        setResolvedIntegrationDocId(snapshot.docs[0].id);
      } catch (err: unknown) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to resolve the reservation inbox.');
        setLoading(false);
      }
    };

    void resolve();

    return () => {
      active = false;
    };
  }, [integrationDocId, propertyId, reloadKey]);

  useEffect(() => {
    if (!resolvedIntegrationDocId) return;

    setLoading(true);
    setError(null);

    const path = activePropertyId
      ? collection(db, 'channex_integrations', resolvedIntegrationDocId, 'properties', activePropertyId, 'bookings')
      : collection(db, 'channex_integrations', resolvedIntegrationDocId, 'reservations');

    const q = query(path);

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const next = snapshot.docs
          .map((doc) => doc.data() as ReservationRecord)
          .sort((a, b) => {
            const aTs = Date.parse(a.created_at ?? a.updated_at ?? '') || 0;
            const bTs = Date.parse(b.created_at ?? b.updated_at ?? '') || 0;
            return bTs - aTs;
          });

        setReservations(next);
        setLoading(false);
      },
      (snapshotError) => {
        setError(snapshotError.message);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [activePropertyId, resolvedIntegrationDocId]);

  useEffect(() => {
    if (!tenantId || reservations.length === 0) return;

    const unsubscribers = reservations.map((reservation) => {
      const contactRef = doc(db, 'contacts', tenantId, 'guests', reservation.reservation_id);

      return onSnapshot(
        contactRef,
        (snapshot) => {
          const whatsappNumber = snapshot.exists() ? (snapshot.data().whatsapp_number as string | null | undefined) ?? null : null;

          setLinkedPhones((current) => ({
            ...current,
            [reservation.reservation_id]: whatsappNumber,
          }));
        },
        (snapshotError) => {
          setError(snapshotError.message);
        },
      );
    });

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [reservations, tenantId]);

  const handleMessageGuest = (phone: string) => {
    setActiveChatPhone(phone);
  };

  const handleAddPhone = async (reservationId: string) => {
    const phone = phoneDrafts[reservationId]?.trim();

    if (!phone) return;

    setLinking(reservationId);

    try {
      await linkGuestPhone(reservationId, phone);
      setPhoneDrafts((current) => ({ ...current, [reservationId]: '' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link phone number.');
    } finally {
      setLinking(null);
    }
  };

  return (
    <>
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-slate-100 bg-slate-50 px-6 py-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Airbnb Reservations</h2>
            <p className="mt-1 text-sm text-slate-600">
              Live reservation feed from the Firestore sub-collection.
            </p>
          </div>

          {onExpandClick && (
            <button
              type="button"
              onClick={onExpandClick}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
              title="Expand reservations"
              aria-label="Expand reservations"
            >
              <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.8">
                <path d="M7 3H3v4M13 3h4v4M7 17H3v-4M13 17h4v-4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="px-6 py-6">
        {loading && (
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-rose-500" />
            Loading reservations...
          </div>
        )}

        {error && !loading && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <div className="flex items-start justify-between gap-3">
              <p>{error}</p>
              <button
                type="button"
                onClick={() => setReloadKey((value) => value + 1)}
                className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-red-700 ring-1 ring-red-200 transition hover:bg-red-100"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {!loading && !error && reservations.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
            No reservations yet.
          </div>
        )}

        {!loading && !error && reservations.length > 0 && (
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Reservation ID</th>
                    <th className="px-4 py-3">Guest</th>
                    <th className="px-4 py-3">Check-In</th>
                    <th className="px-4 py-3">Check-Out</th>
                    <th className="px-4 py-3">Net Payout</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {reservations.map((reservation) => {
                    const status = getStatus(reservation);
                    const cancelled = isInactiveStatus(status);
                    const statusDisplay = getStatusDisplay(status);
                    const linkedPhone = linkedPhones[reservation.reservation_id] ?? null;
                    const displayReservationId = getReservationId(reservation);

                    return (
                      <tr key={displayReservationId} className={cancelled ? 'bg-rose-50/40' : ''}>
                        <td className={`px-4 py-4 font-mono text-xs text-slate-700 ${cancelled ? 'line-through text-slate-400' : ''}`}>
                          {displayReservationId}
                        </td>
                        <td className={`px-4 py-4 text-slate-700 ${cancelled ? 'line-through text-slate-400' : ''}`}>
                          <div className="flex flex-col gap-1">
                            <span className="font-medium">{buildGuestName(reservation)}</span>
                            <span className="inline-flex w-fit rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                              Paid by Airbnb
                            </span>
                          </div>
                        </td>
                        <td className={`px-4 py-4 text-slate-700 ${cancelled ? 'line-through text-slate-400' : ''}`}>
                          {getCheckIn(reservation)}
                        </td>
                        <td className={`px-4 py-4 text-slate-700 ${cancelled ? 'line-through text-slate-400' : ''}`}>
                          {getCheckOut(reservation)}
                        </td>
                        <td className={`px-4 py-4 font-medium text-slate-900 ${cancelled ? 'line-through text-slate-400' : ''}`}>
                          {formatMoney(getPayoutAmount(reservation), reservation.currency)}
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-col gap-1">
                            <span
                              className={[
                                'inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold',
                                statusDisplay.badgeClass,
                              ].join(' ')}
                            >
                              {statusDisplay.label}
                            </span>
                            <span className="text-[11px] text-slate-500">{status}</span>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-right">
                          <div className="flex flex-col items-end gap-2">
                            {linkedPhone ? (
                              <button
                                type="button"
                                onClick={() => handleMessageGuest(linkedPhone)}
                                className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                              >
                                Message Guest
                              </button>
                            ) : (
                              <div className="flex items-center gap-2">
                                <input
                                  type="tel"
                                  inputMode="tel"
                                  placeholder="+15551234567"
                                  value={phoneDrafts[reservation.reservation_id] ?? ''}
                                  onChange={(event) =>
                                    setPhoneDrafts((current) => ({
                                      ...current,
                                      [reservation.reservation_id]: event.target.value,
                                    }))
                                  }
                                  className="w-40 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none transition focus:border-rose-400 focus:ring-4 focus:ring-rose-100"
                                />
                                <button
                                  type="button"
                                  disabled={linking === reservation.reservation_id}
                                  onClick={() => void handleAddPhone(reservation.reservation_id)}
                                  className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                                >
                                  {linking === reservation.reservation_id ? 'Linking...' : 'Add Phone'}
                                </button>
                              </div>
                            )}

                            {linkedPhone && (
                              <span className="text-[11px] text-slate-500">{linkedPhone}</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      </div>

      {activeChatPhone && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-slate-900/30"
            onClick={() => setActiveChatPhone(null)}
            aria-hidden="true"
          />

          <aside
            className="absolute inset-y-0 right-0 w-full max-w-xl bg-white shadow-2xl border-l border-slate-200 flex flex-col"
            role="dialog"
            aria-modal="true"
            aria-label="Guest chat panel"
          >
            <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Guest Chat</p>
                <p className="text-sm font-medium text-slate-700 mt-1">{activeChatPhone}</p>
              </div>
              <button
                type="button"
                onClick={() => setActiveChatPhone(null)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 text-slate-600 transition hover:bg-slate-100"
                aria-label="Close chat"
              >
                X
              </button>
            </header>

            <div className="flex-1 overflow-hidden p-4">
              <GuestChatConsole
                phoneNumber={activeChatPhone}
                onClose={() => setActiveChatPhone(null)}
              />
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
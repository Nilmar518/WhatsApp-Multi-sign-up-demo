import { useEffect, useState } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '../../../firebase/firebase';
import type { ActiveProperty } from '../AirbnbIntegration';

interface Props {
  integrationDocId: string | null;
  activeProperty: ActiveProperty | null;
}

interface BookingRecord {
  reservation_id?: string;
  booking_unique_id?: string;
  customer_name?: string | null;
  guest_first_name?: string | null;
  guest_last_name?: string | null;
  arrival_date?: string;
  departure_date?: string;
  check_in?: string;
  check_out?: string;
  net_payout?: number;
  gross_amount?: number;
  total_price?: number;
  currency?: string;
  booking_status?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function getReservationId(booking: BookingRecord): string {
  return booking.booking_unique_id ?? booking.reservation_id ?? 'Unavailable';
}

function getGuestName(booking: BookingRecord): string {
  if (booking.customer_name && booking.customer_name.trim()) {
    return booking.customer_name;
  }

  const parts = [booking.guest_first_name, booking.guest_last_name].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : 'Guest unavailable';
}

function getCheckIn(booking: BookingRecord): string {
  return booking.arrival_date ?? booking.check_in ?? 'N/A';
}

function getCheckOut(booking: BookingRecord): string {
  return booking.departure_date ?? booking.check_out ?? 'N/A';
}

function getAmount(booking: BookingRecord): number | null {
  if (typeof booking.net_payout === 'number') return booking.net_payout;
  if (typeof booking.total_price === 'number') return booking.total_price;
  if (typeof booking.gross_amount === 'number') return booking.gross_amount;
  return null;
}

function getStatus(booking: BookingRecord): string {
  return booking.booking_status ?? booking.status ?? 'unknown';
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

export default function DetailedReservationsView({ integrationDocId, activeProperty }: Props) {
  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!integrationDocId || !activeProperty?.channex_property_id) {
      setBookings([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const q = query(
      collection(
        db,
        'channex_integrations',
        integrationDocId,
        'properties',
        activeProperty.channex_property_id,
        'bookings',
      ),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const next = snapshot.docs
          .map((doc) => doc.data() as BookingRecord)
          .sort((a, b) => {
            const aTs = Date.parse(a.updated_at ?? a.created_at ?? '') || 0;
            const bTs = Date.parse(b.updated_at ?? b.created_at ?? '') || 0;
            return bTs - aTs;
          });

        setBookings(next);
        setLoading(false);
      },
      (snapshotError) => {
        setError(snapshotError.message);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [activeProperty?.channex_property_id, integrationDocId]);

  if (!integrationDocId || !activeProperty) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center text-sm text-slate-500">
        Select a listing to view reservations.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-rose-500" />
        Loading reservations...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error}
      </div>
    );
  }

  if (bookings.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center text-sm text-slate-500">
        No reservations found for this listing.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-slate-50 px-6 py-5">
        <h2 className="text-xl font-semibold text-slate-900">Reservations Detail</h2>
        <p className="mt-1 text-sm text-slate-600">
          Full booking data for {activeProperty.title}.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
            <tr>
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">Guest</th>
              <th className="px-4 py-3">Check-in</th>
              <th className="px-4 py-3">Check-out</th>
              <th className="px-4 py-3">Total Price</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {bookings.map((booking) => {
              const id = getReservationId(booking);
              const status = getStatus(booking);
              const cancelled = isInactiveStatus(status);
              const statusDisplay = getStatusDisplay(status);
              const amount = getAmount(booking);
              const currency = booking.currency ?? 'USD';

              return (
                <tr key={id} className={cancelled ? 'bg-rose-50/40' : ''}>
                  <td className={`px-4 py-4 font-mono text-xs ${cancelled ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                    {id}
                  </td>
                  <td className={`px-4 py-4 ${cancelled ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                    {getGuestName(booking)}
                  </td>
                  <td className={`px-4 py-4 ${cancelled ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                    {getCheckIn(booking)}
                  </td>
                  <td className={`px-4 py-4 ${cancelled ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                    {getCheckOut(booking)}
                  </td>
                  <td className={`px-4 py-4 font-medium ${cancelled ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
                    {amount === null ? 'N/A' : formatMoney(amount, currency)}
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
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

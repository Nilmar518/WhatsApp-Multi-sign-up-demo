import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../../../firebase/firebase';
import type { RoomType } from '../api/bookingApi';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Reservation {
  // doc ID — equals booking_unique_id (e.g. "ABB-HM4JNTBN2A") when present
  id: string;
  reservation_id?: string | null;
  channex_booking_id?: string | null;
  booking_status?: string;
  channel?: string;
  channex_property_id?: string;
  check_in?: string;
  check_out?: string;
  gross_amount?: number;
  currency?: string;
  guest_first_name?: string | null;
  guest_last_name?: string | null;
  customer_name?: string | null;
  room_type_id?: string | null;
  count_of_nights?: number | null;
  created_at?: string;
  updated_at?: string;
}

interface Props {
  tenantId: string;
  /** Channex property UUID — required to build the correct subcollection path. */
  propertyId: string | null;
  /** Standardized room_types array from the integration doc for title lookups. */
  roomTypes: RoomType[];
  /** Legacy flat room list — only populated for pre-migration integrations. */
  otaRooms: { id: string; title: string }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getGuestName(r: Reservation): string {
  if (r.guest_first_name) {
    return [r.guest_first_name, r.guest_last_name].filter(Boolean).join(' ');
  }
  return r.customer_name?.trim() || 'Guest unavailable';
}

function getDisplayId(r: Reservation): string {
  return r.reservation_id ?? r.id ?? '—';
}

function normalizeStatus(raw: string | undefined): string {
  return (raw ?? '').trim().toLowerCase();
}

function getStatusMeta(raw: string | undefined): { label: string; badgeClass: string } {
  const s = normalizeStatus(raw);
  if (s.includes('cancel')) return { label: 'Cancelado', badgeClass: 'bg-danger-bg text-danger-text' };
  if (s.includes('modif'))  return { label: 'Modificado', badgeClass: 'bg-caution-bg text-caution-text' };
  return { label: 'Activo', badgeClass: 'bg-ok-bg text-ok-text' };
}

function isCancelled(raw: string | undefined): boolean {
  return normalizeStatus(raw).includes('cancel');
}

function formatMoney(amount: number | undefined, currency = 'USD'): string {
  if (amount === undefined || amount === null) return '—';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BookingReservations({ tenantId, propertyId, roomTypes, otaRooms }: Props) {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // propertyId is required to build the correct subcollection path. While the
    // parent loads the integration doc it can transiently be null — show a
    // spinner rather than querying a wrong or missing path.
    if (!propertyId) {
      setLoading(true);
      return;
    }

    setLoading(true);
    setError(null);

    // Path: channex_integrations/{tenantId}/properties/{propertyId}/bookings
    const q = query(
      collection(db, 'channex_integrations', tenantId, 'properties', propertyId, 'bookings'),
      orderBy('created_at', 'desc'),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setReservations(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as Reservation));
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [tenantId, propertyId]);

  // Look up room title — try standardized room_types first, fall back to legacy otaRooms.
  const roomTitle = (roomTypeId: string | null | undefined): string => {
    if (!roomTypeId) return '—';
    return (
      roomTypes.find((rt) => rt.id === roomTypeId)?.title ??
      otaRooms.find((r) => r.id === roomTypeId)?.title ??
      roomTypeId
    );
  };

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-edge bg-surface-subtle px-4 py-4 text-sm text-content-2">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-edge border-t-notice-text" />
        {propertyId ? 'Loading reservations…' : 'Waiting for property…'}
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="rounded-xl border border-danger-bg bg-danger-bg px-4 py-3 text-sm text-danger-text">
        {error}
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="overflow-hidden rounded-2xl border border-edge bg-surface-raised shadow-sm">
      <div className="border-b border-edge bg-surface-subtle px-6 py-5">
        <h2 className="text-xl font-semibold text-content">Booking.com Reservations</h2>
        <p className="mt-1 text-sm text-content-2">
          Live reservation feed — updates instantly when webhooks are received.
        </p>
      </div>

      {reservations.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-notice-bg">
            <svg className="h-6 w-6 text-notice-text" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 9v7.5" />
            </svg>
          </div>
          <p className="text-sm font-medium text-content-2">No reservations yet</p>
          <p className="mt-1 text-xs text-content-3">
            Booking.com reservations will appear here when webhooks are received.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-edge text-left text-sm">
            <thead className="bg-surface-subtle text-xs uppercase tracking-[0.16em] text-content-2">
              <tr>
                <th className="px-4 py-3">Reservation</th>
                <th className="px-4 py-3">Guest</th>
                <th className="px-4 py-3">Check-In</th>
                <th className="px-4 py-3">Check-Out</th>
                <th className="px-4 py-3">Room</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge bg-surface-raised">
              {reservations.map((r) => {
                const cancelled = isCancelled(r.booking_status);
                const { label, badgeClass } = getStatusMeta(r.booking_status);
                const dimClass = cancelled ? 'text-content-3 line-through' : 'text-content';

                return (
                  <tr key={r.id} className={cancelled ? 'bg-danger-bg/10' : ''}>
                    <td className={`px-4 py-4 font-mono text-xs ${dimClass}`}>
                      {getDisplayId(r)}
                    </td>
                    <td className={`px-4 py-4 font-medium ${dimClass}`}>
                      {getGuestName(r)}
                    </td>
                    <td className={`px-4 py-4 ${dimClass}`}>{r.check_in ?? '—'}</td>
                    <td className={`px-4 py-4 ${dimClass}`}>{r.check_out ?? '—'}</td>
                    <td className={`px-4 py-4 ${dimClass}`}>
                      {roomTitle(r.room_type_id)}
                    </td>
                    <td className={`px-4 py-4 font-medium ${cancelled ? 'text-content-3 line-through' : 'text-content'}`}>
                      {formatMoney(r.gross_amount, r.currency)}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-col gap-1">
                        <span className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${badgeClass}`}>
                          {label}
                        </span>
                        <span className="text-[11px] text-content-2">{r.booking_status}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

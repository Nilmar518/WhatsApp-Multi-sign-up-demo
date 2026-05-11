import { useEffect, useRef, useState } from 'react';
import { getPropertyBookings, pullPropertyBookings, type Reservation } from '../api/channexHubApi';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CHANNEL_LABELS: Record<string, string> = {
  airbnb: 'Airbnb',
  booking_com: 'Booking.com',
  vrbo: 'VRBO',
};

const STATUS_STYLES: Record<string, string> = {
  new: 'bg-emerald-100 text-emerald-700',
  booking_new: 'bg-emerald-100 text-emerald-700',
  confirmed: 'bg-emerald-100 text-emerald-700',
  modified: 'bg-amber-100 text-amber-700',
  booking_modification: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-red-100 text-red-600',
  booking_cancellation: 'bg-red-100 text-red-600',
};

function statusStyle(status: string): string {
  return STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-600';
}

function statusLabel(status: string): string {
  return status.replace(/^booking_/, '').replace(/_/g, ' ');
}

function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] ?? channel;
}

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

// ─── Sub-components ───────────────────────────────────────────────────────────

function ReservationCard({ r }: { r: Reservation }) {
  const guestName = [r.guest_first_name, r.guest_last_name].filter(Boolean).join(' ')
    || r.customer_name
    || '—';
  const nightCount = r.count_of_nights ?? nights(r.check_in, r.check_out);

  return (
    <div className="rounded-xl border border-slate-100 bg-white px-4 py-3 shadow-sm transition-shadow hover:shadow-md">
      {/* Top row: guest + status + channel */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-slate-800 leading-tight">{guestName}</p>
        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${channelStyle(r.channel)}`}
          >
            {channelLabel(r.channel)}
          </span>
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${statusStyle(r.booking_status)}`}
          >
            {statusLabel(r.booking_status)}
          </span>
        </div>
      </div>

      {/* Dates */}
      <p className="mt-1 text-xs text-slate-500">
        {r.check_in || '—'} → {r.check_out || '—'}
        {nightCount !== null && (
          <span className="ml-1 text-slate-400">({nightCount}n)</span>
        )}
      </p>

      {/* Financial */}
      <div className="mt-2 flex items-center gap-3 text-xs text-slate-600">
        <span>
          <span className="font-medium text-slate-800">{fmt(r.net_payout, r.currency)}</span>
          <span className="ml-1 text-slate-400">net</span>
        </span>
        {r.ota_fee > 0 && (
          <span className="text-slate-400">
            OTA fee {fmt(r.ota_fee, r.currency)}
          </span>
        )}
      </div>

      {/* Reservation code */}
      {r.reservation_id && (
        <p className="mt-1.5 font-mono text-[10px] text-slate-400 truncate">
          {r.reservation_id}
        </p>
      )}
    </div>
  );
}

const CHANNEL_BADGE_STYLES: Record<string, string> = {
  airbnb: 'bg-rose-100 text-rose-700',
  booking_com: 'bg-blue-100 text-blue-700',
};

function channelStyle(channel: string): string {
  return CHANNEL_BADGE_STYLES[channel] ?? 'bg-slate-100 text-slate-600';
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface ReservationsPanelProps {
  propertyId: string;
  tenantId: string;
  /** Optional filter — show only bookings from these channel keys ('airbnb', 'booking_com', …). All shown when empty. */
  channels?: string[];
  /** Polling interval in ms. Default 30 000. Pass 0 to disable. */
  pollInterval?: number;
}

export default function ReservationsPanel({
  propertyId,
  tenantId,
  channels,
  pollInterval = 30_000,
}: ReservationsPanelProps) {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ synced: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      const data = await getPropertyBookings(propertyId, tenantId);
      setReservations(data);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reservations');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    setError(null);
    try {
      const result = await pullPropertyBookings(propertyId, tenantId);
      setSyncResult(result);
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    load();

    if (pollInterval > 0) {
      timerRef.current = setInterval(() => load(true), pollInterval);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId, tenantId, pollInterval]);

  const visible = channels?.length
    ? reservations.filter((r) => channels.includes(r.channel))
    : reservations;

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />
        ))}
      </div>
    );
  }

  return (
    <div>
      {/* Header row */}
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-slate-700">
          {visible.length} reservation{visible.length !== 1 ? 's' : ''}
        </p>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-[11px] text-slate-400">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <button
            type="button"
            onClick={() => load()}
            disabled={loading || syncing}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50"
          >
            ↻
          </button>
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing || loading}
            className="flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
          >
            <span className={syncing ? 'animate-spin inline-block' : ''}>↻</span>
            {syncing ? 'Syncing…' : 'Sync from Channex'}
          </button>
        </div>
      </div>

      {/* Sync result toast */}
      {syncResult && (
        <div className="mb-3 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-700">
          ✓ Sync complete — {syncResult.synced} booking{syncResult.synced !== 1 ? 's' : ''} imported from Channex
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!error && visible.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 py-12 text-center">
          <p className="text-sm text-slate-500">No reservations yet</p>
          <p className="mt-1 text-xs text-slate-400">
            Bookings from Airbnb and Booking.com will appear here automatically.
          </p>
        </div>
      )}

      {/* List */}
      {visible.length > 0 && (
        <div className="space-y-2">
          {visible.map((r) => (
            <ReservationCard key={r.id ?? r.reservation_id ?? r.channex_booking_id} r={r} />
          ))}
        </div>
      )}
    </div>
  );
}

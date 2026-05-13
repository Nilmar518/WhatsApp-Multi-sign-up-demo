import { useEffect, useRef, useState } from 'react';
import { getPropertyBookings, pullPropertyBookings, type Reservation } from '../api/channexHubApi';
import Button from '../../components/ui/Button';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CHANNEL_LABELS: Record<string, string> = {
  airbnb: 'Airbnb',
  booking_com: 'Booking.com',
  vrbo: 'VRBO',
};

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
    <div className="rounded-xl border border-edge bg-surface-raised px-4 py-3 shadow-sm transition-shadow hover:shadow-md">
      {/* Top row: guest + status + channel */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-content leading-tight">{guestName}</p>
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
      <p className="mt-1 text-xs text-content-2">
        {r.check_in || '—'} → {r.check_out || '—'}
        {nightCount !== null && (
          <span className="ml-1 text-content-3">({nightCount}n)</span>
        )}
      </p>

      {/* Financial */}
      <div className="mt-2 flex items-center gap-3 text-xs text-content-2">
        <span>
          <span className="font-medium text-content">{fmt(r.net_payout, r.currency)}</span>
          <span className="ml-1 text-content-3">net</span>
        </span>
        {r.ota_fee > 0 && (
          <span className="text-content-3">
            OTA fee {fmt(r.ota_fee, r.currency)}
          </span>
        )}
      </div>

      {/* Reservation code */}
      {r.reservation_id && (
        <p className="mt-1.5 font-mono text-[10px] text-content-3 truncate">
          {r.reservation_id}
        </p>
      )}
    </div>
  );
}

const CHANNEL_BADGE_STYLES: Record<string, string> = {
  airbnb: 'bg-danger-bg text-danger-text',
  booking_com: 'bg-notice-bg text-notice-text',
};

function channelStyle(channel: string): string {
  return CHANNEL_BADGE_STYLES[channel] ?? 'bg-surface-subtle text-content-2';
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
          <div key={i} className="h-20 animate-pulse rounded-xl bg-surface-subtle" />
        ))}
      </div>
    );
  }

  return (
    <div>
      {/* Header row */}
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-content">
          {visible.length} reservation{visible.length !== 1 ? 's' : ''}
        </p>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-[11px] text-content-3">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <Button
            type="button"
            onClick={() => load()}
            disabled={loading || syncing}
            variant="secondary"
            size="sm"
          >
            ↻
          </Button>
          <Button
            type="button"
            onClick={handleSync}
            disabled={syncing || loading}
            variant="outline"
            size="sm"
            className="flex items-center gap-1"
          >
            <span className={syncing ? 'animate-spin inline-block' : ''}>↻</span>
            {syncing ? 'Syncing…' : 'Sync from Channex'}
          </Button>
        </div>
      </div>

      {/* Sync result toast */}
      {syncResult && (
        <div className="mb-3 rounded-lg bg-ok-bg border border-ok-bg px-3 py-2 text-sm text-ok-text">
          ✓ Sync complete — {syncResult.synced} booking{syncResult.synced !== 1 ? 's' : ''} imported from Channex
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-3 rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-text">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!error && visible.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-edge py-12 text-center">
          <p className="text-sm text-content-2">No reservations yet</p>
          <p className="mt-1 text-xs text-content-3">
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

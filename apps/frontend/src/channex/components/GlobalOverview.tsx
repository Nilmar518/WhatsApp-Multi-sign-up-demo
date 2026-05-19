import { useEffect, useState } from 'react';
import type { Timestamp } from 'firebase/firestore';
import type { ChannexProperty } from '../hooks/useChannexProperties';
import { usePropertyThreads } from '../hooks/useChannexThreads';
import type { ChannexThread } from '../hooks/useChannexThreads';
import { getPropertyBookings, type Reservation } from '../api/channexHubApi';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  new: 'bg-ok-bg text-ok-text',
  booking_new: 'bg-ok-bg text-ok-text',
  confirmed: 'bg-ok-bg text-ok-text',
  modified: 'bg-caution-bg text-caution-text',
  booking_modification: 'bg-caution-bg text-caution-text',
  cancelled: 'bg-danger-bg text-danger-text',
  booking_cancellation: 'bg-danger-bg text-danger-text',
};

function statusStyle(s: string): string {
  return STATUS_STYLES[s] ?? 'bg-surface-subtle text-content-2';
}

function statusLabel(s: string): string {
  return s.replace(/^booking_/, '').replace(/_/g, ' ');
}

function guestDisplayName(r: Reservation): string {
  const full = [r.guest_first_name, r.guest_last_name].filter(Boolean).join(' ');
  return full || r.customer_name || '—';
}

function formatTime(ts: Timestamp): string {
  const d = ts.toDate();
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex justify-center py-4">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-edge border-t-brand" />
    </div>
  );
}

// ─── Chevron ──────────────────────────────────────────────────────────────────

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={['h-4 w-4 shrink-0 transition-transform text-content-3', open ? 'rotate-180' : ''].join(' ')}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

// ─── Booking accordion per property ───────────────────────────────────────────

function PropertyBookingsAccordion({
  property,
  tenantId,
  onOpen,
}: {
  property: ChannexProperty;
  tenantId: string;
  onOpen: (bookingId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [bookings, setBookings] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    setLoading(true);
    getPropertyBookings(property.channex_property_id, tenantId)
      .then(({ bookings: b }) => {
        const sorted = [...b].sort((a, z) =>
          (a.check_in ?? '').localeCompare(z.check_in ?? ''),
        );
        setBookings(sorted);
        setLoaded(true);
      })
      .catch(() => setLoaded(true))
      .finally(() => setLoading(false));
  }, [open, loaded, property.channex_property_id, tenantId]);

  return (
    <div className="rounded-xl border border-edge bg-surface-raised overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-subtle transition-colors"
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-content truncate">{property.title}</p>
          {loaded && (
            <p className="text-xs text-content-3">{bookings.length} reserva{bookings.length !== 1 ? 's' : ''}</p>
          )}
        </div>
        <Chevron open={open} />
      </button>

      {open && (
        <div className="border-t border-edge px-2 py-2 space-y-0.5">
          {loading && <Spinner />}
          {!loading && bookings.length === 0 && (
            <p className="px-3 py-3 text-xs text-content-3">Sin reservas</p>
          )}
          {!loading && bookings.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => { const id = r.channex_booking_id ?? r.id; if (id) onOpen(id); }}
              className="w-full text-left rounded-lg px-3 py-2.5 hover:bg-surface-subtle transition-colors flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-content truncate">{guestDisplayName(r)}</p>
                <p className="text-xs text-content-3">{r.check_in ?? '—'} → {r.check_out ?? '—'}</p>
              </div>
              <span className={`shrink-0 text-[11px] font-semibold rounded-full px-2 py-0.5 uppercase ${statusStyle(r.booking_status)}`}>
                {statusLabel(r.booking_status)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Messages accordion per property ─────────────────────────────────────────

function PropertyMessagesAccordion({
  property,
  tenantId,
  onOpen,
}: {
  property: ChannexProperty;
  tenantId: string;
  onOpen: (threadId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { threads, loading } = usePropertyThreads(tenantId, property.channex_property_id);

  return (
    <div className="rounded-xl border border-edge bg-surface-raised overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-subtle transition-colors"
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-content truncate">{property.title}</p>
          {!loading && (
            <p className="text-xs text-content-3">{threads.length} conversación{threads.length !== 1 ? 'es' : ''}</p>
          )}
        </div>
        <Chevron open={open} />
      </button>

      {open && (
        <div className="border-t border-edge px-2 py-2 space-y-0.5">
          {loading && <Spinner />}
          {!loading && threads.length === 0 && (
            <p className="px-3 py-3 text-xs text-content-3">Sin mensajes</p>
          )}
          {!loading && threads.map((thread) => (
            <ThreadRow key={thread.id} thread={thread} onClick={() => onOpen(thread.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ThreadRow({ thread, onClick }: { thread: ChannexThread; onClick: () => void }) {
  const needsReply = thread.lastMessageSender === 'guest';
  const replied = thread.lastMessageSender === 'host';

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-lg px-3 py-2.5 hover:bg-surface-subtle transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-content truncate">{thread.guestName}</p>
          {thread.lastMessage && (
            <p className="text-xs text-content-3 truncate">{thread.lastMessage}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {thread.updatedAt && (
            <p className="text-[10px] text-content-3 whitespace-nowrap">{formatTime(thread.updatedAt)}</p>
          )}
          {needsReply && (
            <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 bg-notice-bg text-notice-text whitespace-nowrap">
              Pendiente
            </span>
          )}
          {replied && (
            <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 bg-ok-bg text-ok-text whitespace-nowrap">
              Respondido
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  tenantId: string;
  properties: ChannexProperty[];
  propertiesLoading: boolean;
  onOpenBooking: (property: ChannexProperty, bookingId: string) => void;
  onOpenThread: (property: ChannexProperty, threadId: string) => void;
}

export default function GlobalOverview({
  tenantId,
  properties,
  propertiesLoading,
  onOpenBooking,
  onOpenThread,
}: Props) {
  const activeProperties = properties.filter((p) => p.connection_status === 'active');

  return (
    <div className="space-y-8 mt-6">
      {/* Global Bookings */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest text-content-2 mb-3">
          Reservas
        </h2>
        {propertiesLoading && <Spinner />}
        {!propertiesLoading && activeProperties.length === 0 && (
          <p className="text-sm text-content-3">Sin propiedades activas</p>
        )}
        <div className="space-y-2">
          {activeProperties.map((property) => (
            <PropertyBookingsAccordion
              key={property.channex_property_id}
              property={property}
              tenantId={tenantId}
              onOpen={(bookingId) => onOpenBooking(property, bookingId)}
            />
          ))}
        </div>
      </section>

      {/* Global Messages */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest text-content-2 mb-3">
          Mensajes
        </h2>
        {propertiesLoading && <Spinner />}
        {!propertiesLoading && activeProperties.length === 0 && (
          <p className="text-sm text-content-3">Sin propiedades activas</p>
        )}
        <div className="space-y-2">
          {activeProperties.map((property) => (
            <PropertyMessagesAccordion
              key={property.channex_property_id}
              property={property}
              tenantId={tenantId}
              onOpen={(threadId) => onOpenThread(property, threadId)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

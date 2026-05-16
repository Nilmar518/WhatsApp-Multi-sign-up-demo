import type { ChannexProperty } from '../../hooks/useChannexProperties';

function OTABadge({ channel }: { channel: string }) {
  const styles: Record<string, string> = {
    airbnb: 'bg-danger-bg text-danger-text',
    booking: 'bg-notice-bg text-notice-text',
  };
  const labels: Record<string, string> = {
    airbnb: 'Airbnb',
    booking: 'Booking.com',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] ${styles[channel] ?? 'bg-surface-subtle text-content-2'}`}
    >
      {labels[channel] ?? channel}
    </span>
  );
}

function StatusDot({ status }: { status: ChannexProperty['connection_status'] }) {
  const color =
    status === 'active'
      ? 'bg-emerald-500'
      : status === 'pending'
        ? 'bg-caution-bg'
        : 'bg-danger-bg';
  return <span className={`h-2 w-2 rounded-full ${color}`} />;
}

interface Props {
  property: ChannexProperty;
  onClick: (property: ChannexProperty) => void;
}

export default function PropertyCard({ property, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={() => onClick(property)}
      className="group w-full rounded-2xl border border-edge bg-surface-raised p-4 text-left transition hover:border-brand-light hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-content group-hover:text-brand">{property.title}</p>
        <StatusDot status={property.connection_status} />
      </div>

      <p className="mt-1 text-xs text-content-2">
        {property.currency} · {property.timezone}
      </p>

      <p className="mt-1 text-xs text-content-2">
        {property.room_types.length} room type{property.room_types.length !== 1 ? 's' : ''}
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {property.connected_channels.length === 0 ? (
          <span className="inline-flex items-center rounded-full bg-surface-subtle px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-content-2">
            Channex
          </span>
        ) : (
          property.connected_channels.map((ch) => <OTABadge key={ch} channel={ch} />)
        )}
      </div>
    </button>
  );
}

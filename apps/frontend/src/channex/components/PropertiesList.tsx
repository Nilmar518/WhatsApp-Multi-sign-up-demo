import type { ChannexProperty } from '../hooks/useChannexProperties';

interface Props {
  properties: ChannexProperty[];
  onSelect: (property: ChannexProperty) => void;
  onNew: () => void;
}

function OTABadge({ channel }: { channel: string }) {
  const styles: Record<string, string> = {
    airbnb: 'bg-rose-100 text-rose-700',
    booking: 'bg-blue-100 text-blue-700',
  };
  const labels: Record<string, string> = {
    airbnb: 'Airbnb',
    booking: 'Booking.com',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] ${styles[channel] ?? 'bg-slate-100 text-slate-600'}`}
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
        ? 'bg-amber-400'
        : 'bg-red-400';
  return <span className={`h-2 w-2 rounded-full ${color}`} />;
}

export default function PropertiesList({ properties, onSelect, onNew }: Props) {
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Properties</h2>
          <p className="text-sm text-slate-500">
            Manage Channex properties, room types, rate plans, and ARI.
          </p>
        </div>
        <button
          type="button"
          onClick={onNew}
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
        >
          + New Property
        </button>
      </div>

      {properties.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 px-8 py-12 text-center">
          <p className="text-sm font-medium text-slate-700">No properties yet</p>
          <p className="mt-1 text-sm text-slate-500">
            Create a property to start managing ARI and connecting OTA channels.
          </p>
          <button
            type="button"
            onClick={onNew}
            className="mt-4 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Create first property
          </button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {properties.map((property) => (
            <button
              key={property.firestoreDocId}
              type="button"
              onClick={() => onSelect(property)}
              className="group rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-indigo-300 hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-slate-900 group-hover:text-indigo-700">
                  {property.title}
                </p>
                <StatusDot status={property.connection_status} />
              </div>

              <p className="mt-1 text-xs text-slate-500">
                {property.currency} · {property.timezone}
              </p>

              <p className="mt-1 text-xs text-slate-500">
                {property.room_types.length} room type{property.room_types.length !== 1 ? 's' : ''}
              </p>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {property.connected_channels.length === 0 ? (
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                    Channex
                  </span>
                ) : (
                  property.connected_channels.map((ch) => (
                    <OTABadge key={ch} channel={ch} />
                  ))
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

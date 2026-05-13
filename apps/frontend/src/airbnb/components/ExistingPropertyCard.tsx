import type { ChannexProperty } from '../../channex/hooks/useChannexProperties';

interface Props {
  property: ChannexProperty;
  onContinue: (propertyId: string) => void;
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  pending: 'Pending',
  token_expired: 'Token expired',
  error: 'Error',
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  pending: 'bg-amber-50 border-amber-200 text-amber-700',
  token_expired: 'bg-orange-50 border-orange-200 text-orange-700',
  error: 'bg-red-50 border-red-200 text-red-700',
};

export default function ExistingPropertyCard({ property, onContinue }: Props) {
  const statusColor = STATUS_COLORS[property.connection_status] ?? STATUS_COLORS['pending'];
  const statusLabel = STATUS_LABELS[property.connection_status] ?? property.connection_status;

  return (
    <div className="rounded-2xl border border-emerald-100 bg-surface-raised shadow-sm overflow-hidden">
      <div className="border-b border-emerald-50 bg-gradient-to-r from-emerald-50 to-teal-50 px-6 py-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">
          Step 1
        </p>
        <h2 className="mt-1 text-xl font-semibold text-content">Property Setup</h2>
        <p className="mt-1 text-sm text-content-2">
          Your business already has a Channex property registered.
        </p>
      </div>

      <div className="px-6 py-6 space-y-5">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-content">{property.title}</p>
              <p className="text-xs font-mono text-content-2 break-all">
                {property.channex_property_id}
              </p>
            </div>
            <span
              className={[
                'shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium',
                statusColor,
              ].join(' ')}
            >
              {statusLabel}
            </span>
          </div>

          <div className="flex flex-wrap gap-4 text-xs text-content-2">
            <span>
              <span className="font-medium">Currency:</span> {property.currency}
            </span>
            <span>
              <span className="font-medium">Timezone:</span> {property.timezone}
            </span>
            {property.connected_channels.length > 0 && (
              <span>
                <span className="font-medium">Channels:</span>{' '}
                {property.connected_channels.join(', ')}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={() => onContinue(property.channex_property_id)}
            className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-rose-700"
          >
            Continue with this property
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

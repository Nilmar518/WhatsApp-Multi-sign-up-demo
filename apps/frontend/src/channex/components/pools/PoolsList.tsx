import type { MigoProperty } from '../../api/migoPropertyApi';
import Button from '../../../components/ui/Button';

interface Props {
  pools: MigoProperty[];
  onSelect: (pool: MigoProperty) => void;
  onNew: () => void;
  onEdit: (pool: MigoProperty) => void;
}

function AvailabilityChip({ pool }: { pool: MigoProperty }) {
  const { current_availability, total_units, alert_threshold } = pool;
  const isAlert = current_availability <= alert_threshold;
  const isEmpty = current_availability <= 0;
  const color = isEmpty
    ? 'bg-danger-bg text-danger-text'
    : isAlert
      ? 'bg-notice-bg text-notice-text'
      : 'bg-ok-bg text-ok-text';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${color}`}
    >
      {isAlert && !isEmpty && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />}
      {current_availability} / {total_units}
    </span>
  );
}

function PlatformBadge({ platform }: { platform: string }) {
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
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] ${styles[platform] ?? 'bg-surface-subtle text-content-2'}`}
    >
      {labels[platform] ?? platform}
    </span>
  );
}

export default function PoolsList({ pools, onSelect, onNew, onEdit }: Props) {
  const platforms = (pool: MigoProperty) =>
    [...new Set(pool.platform_connections.map((c) => c.platform))];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-content">Property Pools</h2>
          <p className="text-sm text-content-2">
            Group OTA listings into shared availability pools.
          </p>
        </div>
        <Button type="button" onClick={onNew} variant="primary" size="sm">
          + New Pool
        </Button>
      </div>

      {pools.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-edge px-8 py-12 text-center">
          <p className="text-sm font-medium text-content">No pools yet</p>
          <p className="mt-1 text-sm text-content-2">
            Create a pool to track availability across multiple OTA listings.
          </p>
          <Button type="button" onClick={onNew} variant="primary" size="sm" className="mt-4">
            Create first pool
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {pools.map((pool) => (
            <div key={pool.id} className="relative group">
              <button
                type="button"
                onClick={() => onSelect(pool)}
                className="w-full rounded-2xl border border-edge bg-surface-raised p-4 text-left transition hover:border-brand-light hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-content group-hover:text-brand">{pool.title}</p>
                  <AvailabilityChip pool={pool} />
                </div>

                <p className="mt-1 text-xs text-content-2">
                  {pool.platform_connections.length} connection
                  {pool.platform_connections.length !== 1 ? 's' : ''}
                </p>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {platforms(pool).length === 0 ? (
                    <span className="inline-flex items-center rounded-full bg-surface-subtle px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-content-2">
                      No platforms
                    </span>
                  ) : (
                    platforms(pool).map((p) => <PlatformBadge key={p} platform={p} />)
                  )}
                </div>
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onEdit(pool); }}
                title="Edit pool"
                className="absolute right-3 top-3 rounded-lg px-2 py-1 text-xs text-content-2 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-surface-subtle hover:text-content"
              >
                Edit
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

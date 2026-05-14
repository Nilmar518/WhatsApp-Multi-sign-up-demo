import { useState } from 'react';
import Button from '../../../components/ui/Button';
import {
  removeConnection,
  toggleSync,
  resetAvailability,
  type MigoProperty,
} from '../../api/migoPropertyApi';
import AssignConnectionModal from './AssignConnectionModal';
import PoolAriPanel from './PoolAriPanel';

interface Props {
  pool: MigoProperty;
  tenantId: string;
  onBack: () => void;
  onUpdated: (updated: MigoProperty) => void;
}

function AvailabilityBadge({ pool }: { pool: MigoProperty }) {
  const { current_availability, total_units, alert_threshold } = pool;
  const isAlert = current_availability <= alert_threshold;
  const isEmpty = current_availability <= 0;
  const color = isEmpty
    ? 'bg-danger-bg text-danger-text'
    : isAlert
      ? 'bg-notice-bg text-notice-text'
      : 'bg-ok-bg text-ok-text';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${color}`}>
      {current_availability} / {total_units} available
      {isAlert && (
        <span className="text-xs opacity-80">· alert ≤ {alert_threshold}</span>
      )}
    </span>
  );
}

function PlatformBadge({ platform }: { platform: string }) {
  const styles: Record<string, string> = {
    airbnb: 'bg-danger-bg text-danger-text',
    booking: 'bg-notice-bg text-notice-text',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] ${styles[platform] ?? 'bg-surface-subtle text-content-2'}`}>
      {platform === 'booking' ? 'Booking.com' : platform}
    </span>
  );
}

export default function PoolDetail({ pool: initialPool, tenantId, onBack, onUpdated }: Props) {
  const [pool, setPool] = useState(initialPool);
  const [showAssign, setShowAssign] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  function handleUpdated(updated: MigoProperty) {
    setPool(updated);
    onUpdated(updated);
    setShowAssign(false);
  }

  async function handleRemoveConnection(channexId: string) {
    try {
      const updated = await removeConnection(pool.id, channexId);
      handleUpdated(updated);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to remove connection');
    }
  }

  async function handleToggleSync(channexId: string, current: boolean) {
    try {
      const updated = await toggleSync(pool.id, channexId, !current);
      handleUpdated(updated);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to toggle sync');
    }
  }

  async function handleReset() {
    setResetting(true);
    setResetError(null);
    try {
      const updated = await resetAvailability(pool.id);
      handleUpdated(updated);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setResetting(false);
    }
  }

  const enabledCount = pool.platform_connections.filter((c) => c.is_sync_enabled).length;

  return (
    <div className="flex flex-col gap-5">
      {/* Back */}
      <Button variant="ghost" size="sm" type="button" onClick={onBack} className="self-start">
        ← Back to pools
      </Button>

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-edge bg-surface-raised px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold text-content">{pool.title}</h2>
          <p className="mt-0.5 text-xs text-content-2 font-mono">{pool.id}</p>
        </div>
        <div className="flex items-center gap-3">
          <AvailabilityBadge pool={pool} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleReset}
            disabled={resetting}
          >
            {resetting ? 'Resetting…' : 'Reset to full'}
          </Button>
        </div>
        {resetError && <p className="w-full text-xs text-danger-text">{resetError}</p>}
      </div>

      {/* Platform connections */}
      <div className="rounded-2xl border border-edge bg-surface-raised px-5 py-4">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-content">Platform Connections</h3>
          <Button type="button" variant="outline" size="sm" onClick={() => setShowAssign(true)}>
            + Add
          </Button>
        </div>

        {pool.platform_connections.length === 0 ? (
          <p className="text-sm text-content-2">No connections yet. Add a platform connection above.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {pool.platform_connections.map((conn) => (
              <div
                key={conn.channex_property_id}
                className="flex items-center gap-3 rounded-xl border border-edge bg-surface px-4 py-3"
              >
                <PlatformBadge platform={conn.platform} />
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-content">{conn.listing_title}</p>
                  <p className="truncate font-mono text-xs text-content-3">{conn.channex_property_id}</p>
                </div>
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={conn.is_sync_enabled}
                    onChange={() => handleToggleSync(conn.channex_property_id, conn.is_sync_enabled)}
                    className="h-4 w-4 rounded border-edge accent-brand"
                  />
                  <span className="text-xs text-content-2">Sync</span>
                </label>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={() => handleRemoveConnection(conn.channex_property_id)}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ARI fan-out */}
      <PoolAriPanel migoPropertyId={pool.id} enabledConnectionCount={enabledCount} />

      {showAssign && (
        <AssignConnectionModal
          migoPropertyId={pool.id}
          tenantId={tenantId}
          existingConnections={pool.platform_connections}
          onAssigned={handleUpdated}
          onClose={() => setShowAssign(false)}
        />
      )}
    </div>
  );
}

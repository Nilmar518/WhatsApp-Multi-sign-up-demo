import { useState } from 'react';
import Button from '../../../components/ui/Button';
import { recalibrateAvailability, type MigoProperty } from '../../api/migoPropertyApi';

const DISMISSED_KEY = 'migo-pool-sync-dismissed';

export function isPoolSyncDismissed(): boolean {
  return localStorage.getItem(DISMISSED_KEY) === 'true';
}

interface Props {
  pool: MigoProperty;
  computedTotal: number;
  onCalibrated: (updated: MigoProperty) => void;
  onClose: () => void;
}

export default function PoolSyncModal({ pool, computedTotal, onCalibrated, onClose }: Props) {
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const occupied = Math.max(0, pool.total_units - pool.current_availability);
  const newAvail = Math.max(0, computedTotal - occupied);

  function handleDismiss() {
    if (dontShowAgain) {
      localStorage.setItem(DISMISSED_KEY, 'true');
    }
    onClose();
  }

  async function handleAdjust() {
    setAdjusting(true);
    setError(null);
    try {
      const updated = await recalibrateAvailability(pool.id);
      if (dontShowAgain) {
        localStorage.setItem(DISMISSED_KEY, 'true');
      }
      onCalibrated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Adjustment failed');
    } finally {
      setAdjusting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-edge bg-surface-raised px-6 py-6 shadow-xl">
        <h3 className="mb-2 text-base font-semibold text-content">Pool capacity mismatch</h3>
        <p className="text-sm text-content-2 mb-4">
          Your connected properties sum to{' '}
          <strong className="text-content">{computedTotal} unit{computedTotal !== 1 ? 's' : ''}</strong>,
          but the pool is set to{' '}
          <strong className="text-content">{pool.total_units}</strong>.
        </p>

        <div className="rounded-lg bg-surface px-4 py-3 text-sm mb-4">
          <div className="flex justify-between text-content-2 mb-1">
            <span>Current</span>
            <span className="font-semibold text-content">
              {pool.current_availability} / {pool.total_units}
            </span>
          </div>
          <div className="flex justify-between text-content-2">
            <span>After adjustment</span>
            <span className="font-semibold text-ok-text">
              {newAvail} / {computedTotal}
            </span>
          </div>
        </div>

        {error && <p className="mb-3 text-sm text-danger-text">{error}</p>}

        <div className="flex gap-3 mb-4">
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleAdjust}
            disabled={adjusting}
          >
            {adjusting ? 'Adjusting…' : `Adjust to ${computedTotal} units`}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={handleDismiss}>
            Dismiss
          </Button>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-content-2">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
            className="h-4 w-4 rounded border-edge accent-brand"
          />
          Don't show this suggestion again
        </label>
      </div>
    </div>
  );
}

import { useState } from 'react';
import Button from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { updateMigoProperty, type MigoProperty } from '../../api/migoPropertyApi';

interface Props {
  pool: MigoProperty;
  onSaved: (updated: MigoProperty) => void;
  onClose: () => void;
}

export default function PoolEditModal({ pool, onSaved, onClose }: Props) {
  const [title, setTitle] = useState(pool.title);
  const [alertThreshold, setAlertThreshold] = useState(String(pool.alert_threshold));
  const [totalUnits, setTotalUnits] = useState(String(pool.total_units));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('Pool name is required.');
      return;
    }
    const units = parseInt(totalUnits, 10);
    const threshold = parseInt(alertThreshold, 10);
    if (isNaN(units) || units < 0) {
      setError('Total units must be 0 or greater.');
      return;
    }
    if (isNaN(threshold) || threshold < 0) {
      setError('Alert threshold must be 0 or greater.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateMigoProperty(pool.id, {
        title: title.trim(),
        alert_threshold: threshold,
        total_units: units,
      });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl border border-edge bg-surface-raised px-6 py-6 shadow-xl">
        <h3 className="mb-5 text-base font-semibold text-content">Edit Pool</h3>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-content-2">
              Pool Name
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-content-2">
              Alert Threshold
            </label>
            <Input
              type="number"
              min={0}
              value={alertThreshold}
              onChange={(e) => setAlertThreshold(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-content-2">
              Total Units (capacity)
            </label>
            <Input
              type="number"
              min={0}
              value={totalUnits}
              onChange={(e) => setTotalUnits(e.target.value)}
            />
            <p className="mt-1 text-xs text-notice-text">
              Editing this overrides the auto-calculated capacity from connections.
            </p>
          </div>

          {error && <p className="text-sm text-danger-text">{error}</p>}

          <div className="flex gap-3 pt-2">
            <Button type="submit" variant="primary" size="sm" disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

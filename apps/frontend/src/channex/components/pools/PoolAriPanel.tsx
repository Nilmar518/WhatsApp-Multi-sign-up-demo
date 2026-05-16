import { useState } from 'react';
import Button from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { pushAriToPool, type AriPushResult } from '../../api/migoPropertyApi';

interface Props {
  migoPropertyId: string;
  enabledConnectionCount: number;
}

export default function PoolAriPanel({ migoPropertyId, enabledConnectionCount }: Props) {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [stopSell, setStopSell] = useState(false);
  const [availability, setAvailability] = useState('');
  const [pushing, setPushing] = useState(false);
  const [result, setResult] = useState<AriPushResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handlePush(e: React.FormEvent) {
    e.preventDefault();
    if (!dateFrom || !dateTo) {
      setError('Date range is required.');
      return;
    }
    setPushing(true);
    setError(null);
    setResult(null);
    try {
      const payload = {
        dateFrom,
        dateTo,
        ...(stopSell ? { stopSell: true } : {}),
        ...(availability !== '' ? { availability: parseInt(availability, 10) } : {}),
      };
      const res = await pushAriToPool(migoPropertyId, payload);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Push failed');
    } finally {
      setPushing(false);
    }
  }

  return (
    <div className="rounded-2xl border border-edge bg-surface-raised px-5 py-4">
      <h3 className="mb-4 text-sm font-semibold text-content">ARI Fan-out</h3>
      <p className="mb-4 text-xs text-content-2">
        Push ARI updates to all {enabledConnectionCount} enabled platform
        {enabledConnectionCount !== 1 ? 's' : ''} simultaneously.
      </p>

      <form onSubmit={handlePush} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-content-2">
              Date From
            </label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-content-2">
              Date To
            </label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={stopSell}
              onChange={(e) => setStopSell(e.target.checked)}
              className="h-4 w-4 rounded border-edge accent-brand"
            />
            <span className="text-sm font-medium text-content">Stop Sell</span>
            <span className="text-xs text-content-3">Close all bookings for this period</span>
          </label>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-content-2">
              Availability Override <span className="font-normal normal-case">(optional)</span>
            </label>
            <Input
              type="number"
              min={0}
              value={availability}
              onChange={(e) => setAvailability(e.target.value)}
              placeholder="Leave blank to skip"
              className="max-w-[120px]"
            />
          </div>
        </div>

        {error && <p className="text-sm text-danger-text">{error}</p>}

        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={pushing || enabledConnectionCount === 0}
          className="self-start"
        >
          {pushing ? 'Pushing…' : 'Push to all platforms'}
        </Button>
      </form>

      {result && (
        <div className="mt-4 rounded-xl border border-edge p-3">
          {result.succeeded.length > 0 && (
            <div className="mb-2">
              <p className="text-xs font-semibold text-ok-text">
                ✓ Succeeded ({result.succeeded.length})
              </p>
              <ul className="mt-1 space-y-0.5">
                {result.succeeded.map((id) => (
                  <li key={id} className="font-mono text-xs text-content-2">{id}</li>
                ))}
              </ul>
            </div>
          )}
          {result.failed.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-danger-text">
                ✗ Failed ({result.failed.length})
              </p>
              <ul className="mt-1 space-y-0.5">
                {result.failed.map((f) => (
                  <li key={f.channexPropertyId} className="text-xs text-danger-text">
                    {f.channexPropertyId}: {f.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { getConnectionStatus, type ChannexConnectionStatus } from '../api/channexApi';

interface Props {
  propertyId: string;
  onReconnect: () => void;
}

const STATUS_STYLES: Record<ChannexConnectionStatus, { label: string; tone: string }> = {
  pending: { label: 'Pending', tone: 'bg-slate-100 text-slate-700 ring-slate-200' },
  active: { label: 'Active', tone: 'bg-emerald-100 text-emerald-700 ring-emerald-200' },
  token_expired: { label: 'Token expired', tone: 'bg-amber-100 text-amber-800 ring-amber-200' },
  error: { label: 'Error', tone: 'bg-red-100 text-red-700 ring-red-200' },
};

export default function ConnectionStatusBadge({ propertyId, onReconnect }: Props) {
  const [status, setStatus] = useState<ChannexConnectionStatus>('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const poll = async () => {
      try {
        const response = await getConnectionStatus(propertyId);

        if (!active) return;

        setStatus(response.connectionStatus);
        setError(null);
      } catch (err: unknown) {
        if (!active) return;

        setError(err instanceof Error ? err.message : 'Unable to load connection status.');
        setStatus('error');
      } finally {
        if (active) setLoading(false);
      }
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 30_000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [propertyId]);

  const style = STATUS_STYLES[status];

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ${style.tone}`}>
          {loading ? 'Checking...' : style.label}
        </span>
        {error && !loading && (
          <span className="text-xs text-slate-500">{error}</span>
        )}
      </div>

      {status === 'token_expired' && (
        <button
          type="button"
          onClick={onReconnect}
          className="inline-flex items-center justify-center rounded-full bg-amber-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-amber-600"
        >
          Reconnect
        </button>
      )}
    </div>
  );
}
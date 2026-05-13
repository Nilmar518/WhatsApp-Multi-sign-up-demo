import { useEffect, useState } from 'react';
import { getConnectionStatus, type ChannexConnectionStatus } from '../api/channexApi';
import { Badge } from '../../components/ui';

interface Props {
  propertyId: string;
  onReconnect: () => void;
}

const STATUS_BADGE_VARIANT: Record<ChannexConnectionStatus, 'ok' | 'danger' | 'caution' | 'neutral'> = {
  pending: 'neutral',
  active: 'ok',
  token_expired: 'caution',
  error: 'danger',
};

const STATUS_LABELS: Record<ChannexConnectionStatus, string> = {
  pending: 'Pending',
  active: 'Active',
  token_expired: 'Token expired',
  error: 'Error',
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

  const badgeVariant = STATUS_BADGE_VARIANT[status];

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <Badge variant={badgeVariant}>
          {loading ? 'Checking...' : STATUS_LABELS[status]}
        </Badge>
        {error && !loading && (
          <span className="text-xs text-content-2">{error}</span>
        )}
      </div>

      {status === 'token_expired' && (
        <button
          type="button"
          onClick={onReconnect}
          className="inline-flex items-center justify-center rounded-full bg-caution-bg px-4 py-2 text-xs font-semibold text-caution-text transition hover:opacity-80"
        >
          Reconnect
        </button>
      )}
    </div>
  );
}
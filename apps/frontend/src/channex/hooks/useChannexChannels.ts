import { useState, useEffect, useCallback } from 'react';
import { getChannels, type StoredChannel } from '../api/channexHubApi';

interface Result {
  channels: StoredChannel[];
  loading: boolean;
  error: string | null;
  updateChannel: (channelId: string, patch: Partial<StoredChannel>) => void;
  refetch: () => void;
}

export function useChannexChannels(tenantId: string): Result {
  const [channels, setChannels] = useState<StoredChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!tenantId) {
      setChannels([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    getChannels(tenantId)
      .then(setChannels)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load channels.'),
      )
      .finally(() => setLoading(false));
  }, [tenantId, tick]);

  const updateChannel = useCallback((channelId: string, patch: Partial<StoredChannel>) => {
    setChannels((prev) =>
      prev.map((ch) => (ch.channel_id === channelId ? { ...ch, ...patch } : ch)),
    );
  }, []);

  const refetch = useCallback(() => setTick((n) => n + 1), []);

  return { channels, loading, error, updateChannel, refetch };
}

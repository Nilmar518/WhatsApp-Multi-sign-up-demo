import { useState, useEffect } from 'react';
import { getLiveChannels, type StoredChannel } from '../../api/channexHubApi';
import { useLanguage } from '../../../context/LanguageContext';

interface Props {
  tenantId: string;
  channelType: 'airbnb' | 'booking';
  onConfirm: (channelId: string) => void;
  onClose: () => void;
}

function matchesType(ch: StoredChannel, channelType: 'airbnb' | 'booking'): boolean {
  const code = ch.channel_code.trim().toLowerCase();
  if (channelType === 'airbnb') return code === 'abb' || code.includes('airbnb');
  return code === 'bookingcom' || code === 'booking_com' || code.includes('booking');
}

export default function BdcChannelSelectModal({ tenantId, channelType, onConfirm, onClose }: Props) {
  const { t } = useLanguage();
  const [channels, setChannels] = useState<StoredChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const title = t(channelType === 'airbnb' ? 'channex.bdcModal.titleAirbnb' : 'channex.bdcModal.titleBdc');

  const fetchChannels = () => {
    setLoading(true);
    setError(null);
    getLiveChannels(tenantId)
      .then((data) => {
        const filtered = data.filter((ch) => matchesType(ch, channelType));
        setChannels(filtered);
        const inactive = filtered.filter((ch) => !ch.is_active);
        if (inactive.length === 1) setSelected(inactive[0].channel_id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : t('channex.bdcModal.err')))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchChannels();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, channelType]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-edge bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-edge px-5 py-4">
          <h2 className="text-base font-semibold text-content">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-content-3 hover:text-content transition-colors"
            aria-label="Close"
          >
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 2l12 12M14 2L2 14" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-content-2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-content-3 border-t-content-2" />
              {t('channex.bdcModal.loading')}
            </div>
          )}

          {!loading && error && (
            <div className="space-y-3">
              <p className="text-sm text-danger-text">{error}</p>
              <button
                type="button"
                onClick={fetchChannels}
                className="text-sm font-medium text-brand hover:underline"
              >
                {t('channex.bdcModal.retry')}
              </button>
            </div>
          )}

          {!loading && !error && channels.length === 0 && (
            <p className="text-sm text-content-2">{t('channex.bdcModal.empty')}</p>
          )}

          {!loading && !error && channels.length > 0 && (
            <ul className="space-y-2">
              {channels.map((ch) => {
                const isActive = ch.is_active;
                return (
                  <li key={ch.channel_id}>
                    <label
                      className={[
                        'flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors',
                        isActive
                          ? 'cursor-not-allowed border-edge bg-surface-subtle opacity-60'
                          : 'cursor-pointer border-edge hover:bg-surface-subtle has-[:checked]:border-brand has-[:checked]:bg-brand/5',
                      ].join(' ')}
                    >
                      <input
                        type="radio"
                        name="channel-select"
                        value={ch.channel_id}
                        checked={selected === ch.channel_id}
                        disabled={isActive}
                        onChange={() => { if (!isActive) setSelected(ch.channel_id); }}
                        className="accent-brand"
                      />
                      <span className={['text-sm font-medium', isActive ? 'text-content-3' : 'text-content'].join(' ')}>
                        {ch.title}
                      </span>
                      <span
                        className={[
                          'ml-auto shrink-0 text-xs font-medium rounded-full px-2 py-0.5',
                          isActive ? 'bg-ok-bg text-ok-text' : 'bg-surface-subtle text-content-3',
                        ].join(' ')}
                      >
                        {isActive ? t('channex.chanMgmt.active') : t('channex.chanMgmt.inactive')}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-edge px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm text-content-2 hover:text-content transition-colors"
          >
            {t('channex.bdcModal.cancel')}
          </button>
          {!loading && !error && channels.length > 0 && (
            <button
              type="button"
              disabled={!selected}
              onClick={() => { if (selected) onConfirm(selected); }}
              className={[
                'rounded-xl px-5 py-2 text-sm font-semibold transition-colors',
                selected
                  ? 'bg-brand text-white hover:opacity-80'
                  : 'cursor-not-allowed bg-surface-subtle text-content-3',
              ].join(' ')}
            >
              {t('channex.bdcModal.next')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

import { useState, useCallback } from 'react';
import { useChannexChannels } from '../../hooks/useChannexChannels';
import { activateChannel, deactivateChannel } from '../../api/channexHubApi';
import { useLanguage } from '../../../context/LanguageContext';

interface Props {
  tenantId: string;
}

const CHANNEL_LABELS: Record<string, string> = {
  ABB: 'Airbnb',
  BDC: 'Booking.com',
  BookingCom: 'Booking.com',
  AirBNB: 'Airbnb',
};

function channelLabel(code: string): string {
  return CHANNEL_LABELS[code] ?? code;
}

export default function ChannelManagementPanel({ tenantId }: Props) {
  const { t } = useLanguage();
  const { channels, loading, error: loadError, updateChannel } = useChannexChannels(tenantId);
  const [isOpen, setIsOpen] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errorModal, setErrorModal] = useState<string | null>(null);

  const handleToggle = useCallback(
    async (channelId: string, currentlyActive: boolean) => {
      setPendingId(channelId);
      try {
        if (currentlyActive) {
          await deactivateChannel(channelId, tenantId);
          updateChannel(channelId, { is_active: false, status: 'inactive' });
        } else {
          await activateChannel(channelId, tenantId);
          updateChannel(channelId, { is_active: true, status: 'active' });
        }
      } catch (err) {
        setErrorModal(
          err instanceof Error ? err.message : 'An unexpected error occurred.',
        );
      } finally {
        setPendingId(null);
      }
    },
    [tenantId, updateChannel],
  );

  return (
    <>
      <div className="rounded-2xl border border-edge bg-surface-raised overflow-hidden">
        {/* Accordion header */}
        <button
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-3 px-6 py-4 text-left hover:bg-surface-subtle transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-subtle border border-edge">
              <svg
                className="h-4 w-4 text-content-2"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="8" cy="8" r="6" />
                <path d="M8 5v3l2 1" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-semibold text-content">{t('channex.chanMgmt.title')}</h2>
              <p className="text-xs text-content-2">
                {loading
                  ? t('channex.chanMgmt.loading')
                  : t(channels.length === 1 ? 'channex.chanMgmt.count.one' : 'channex.chanMgmt.count.many', { n: channels.length })}
              </p>
            </div>
          </div>
          <svg
            className={[
              'h-4 w-4 shrink-0 text-content-2 transition-transform duration-200',
              isOpen ? 'rotate-180' : '',
            ].join(' ')}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>

        {/* Collapsible body */}
        {isOpen && (
          <div className="border-t border-edge px-6 pb-6 pt-4 space-y-3">
            {loading && (
              <p className="text-sm text-content-2">{t('channex.chanMgmt.loadingChannels')}</p>
            )}

            {!loading && loadError && (
              <div className="rounded-xl border border-danger-text/20 bg-danger-bg px-4 py-3 text-sm text-danger-text">
                {loadError}
              </div>
            )}

            {!loading && !loadError && channels.length === 0 && (
              <p className="text-sm text-content-3">
                {t('channex.chanMgmt.empty')}
              </p>
            )}

            {!loading && channels.map((ch) => {
              const isPending = pendingId === ch.channel_id;
              const isActive = ch.is_active;

              return (
                <div
                  key={ch.channel_id}
                  className="flex items-start justify-between gap-4 rounded-xl border border-edge bg-surface px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-content truncate">
                        {ch.title}
                      </span>
                      <span className="text-xs text-content-3 bg-surface-subtle border border-edge rounded px-1.5 py-0.5 shrink-0">
                        {channelLabel(ch.channel_code)}
                      </span>
                      <span
                        className={[
                          'text-xs font-medium rounded-full px-2 py-0.5 shrink-0',
                          isActive
                            ? 'bg-ok-bg text-ok-text'
                            : 'bg-surface-subtle text-content-3',
                        ].join(' ')}
                      >
                        {isActive ? t('channex.chanMgmt.active') : (ch.status ?? t('channex.chanMgmt.inactive'))}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-content-3 font-mono truncate">
                      {ch.channel_id}
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => void handleToggle(ch.channel_id, isActive)}
                    className={[
                      'shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                      isPending
                        ? 'cursor-not-allowed bg-surface-subtle text-content-3'
                        : isActive
                          ? 'bg-danger-bg text-danger-text hover:opacity-80'
                          : 'bg-ok-bg text-ok-text hover:opacity-80',
                    ].join(' ')}
                  >
                    {isPending ? (
                      <>
                        <div className="h-3 w-3 animate-spin rounded-full border-2 border-current/30 border-t-current" />
                        {isActive ? t('channex.chanMgmt.deactivating') : t('channex.chanMgmt.activating')}
                      </>
                    ) : isActive ? (
                      t('channex.chanMgmt.deactivate')
                    ) : (
                      t('channex.chanMgmt.activate')
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Error modal */}
      {errorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-surface-raised border border-edge p-6 shadow-xl">
            <h3 className="text-base font-semibold text-content mb-2">{t('channex.chanMgmt.err.title')}</h3>
            <p className="text-sm text-content-2 mb-1">
              {t('channex.chanMgmt.err.body')}
            </p>
            <p className="text-xs text-content-3 font-mono bg-surface-subtle rounded px-2 py-1 mb-4 break-all">
              {errorModal}
            </p>
            <button
              type="button"
              onClick={() => setErrorModal(null)}
              className="w-full rounded-xl bg-brand text-white py-2 text-sm font-semibold hover:opacity-80 transition-opacity"
            >
              {t('channex.chanMgmt.close')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

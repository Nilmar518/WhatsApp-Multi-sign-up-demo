import { useEffect, useState } from 'react';
import type { Reservation } from '../../api/channexHubApi';
import { markNoShow, type NoShowResult } from '../../api/channexHubApi';
import { useLanguage } from '../../../context/LanguageContext';

type ModalState = 'idle' | 'loading' | 'error' | 'success';

export interface NoShowConfirmModalProps {
  reservation: Reservation;
  tenantId: string;
  onClose: () => void;
  onSuccess: () => void;
}

// ─── Error renderer ───────────────────────────────────────────────────────────

function ChannexErrorBlock({ errors }: { errors: NoShowResult['errors'] }) {
  const { t } = useLanguage();
  if (!errors) return <p className="text-sm text-danger-text">{t('channex.noShow.err.unknown')}</p>;

  const details = errors.details;

  if (details && Object.keys(details).length > 0) {
    return (
      <ul className="space-y-1.5">
        {Object.entries(details).map(([field, messages]) =>
          messages.map((msg, i) => (
            <li key={`${field}-${i}`} className="text-sm text-danger-text">
              <span className="font-medium capitalize">{field.replace(/_/g, ' ')}:</span>{' '}
              {msg}
            </li>
          )),
        )}
      </ul>
    );
  }

  if (errors.title) {
    return <p className="text-sm text-danger-text">{errors.title}</p>;
  }

  return <p className="text-sm text-danger-text">{t('channex.noShow.err.unknown')}</p>;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function NoShowConfirmModal({
  reservation: r,
  tenantId,
  onClose,
  onSuccess,
}: NoShowConfirmModalProps) {
  const { t } = useLanguage();
  const [state, setState] = useState<ModalState>('idle');
  // Default unchecked → waivedFees: true (did NOT collect payment)
  const [collected, setCollected] = useState(false);
  const [errorData, setErrorData] = useState<NoShowResult['errors'] | null>(null);

  const waivedFees = !collected;

  // Close on Escape only when idle or error
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && (state === 'idle' || state === 'error')) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [state, onClose]);

  async function handleConfirm() {
    if (!r.channex_booking_id) return;
    setState('loading');
    setErrorData(null);

    const result = await markNoShow(
      r.channex_property_id,
      r.channex_booking_id,
      tenantId,
      waivedFees,
    );

    if (result.success) {
      setState('success');
    } else {
      setErrorData(result.errors);
      setState('error');
    }
  }

  const guestName =
    [r.guest_first_name, r.guest_last_name].filter(Boolean).join(' ') ||
    r.customer_name ||
    t('channex.noShow.guestFallback');

  return (
    /* Backdrop — higher z than ReservationDetailModal (z-50) */
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && state !== 'loading') onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-surface shadow-2xl border border-edge overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 bg-danger-bg px-5 py-4 border-b border-danger-text/20">
          <span className="text-xl">⚠️</span>
          <div>
            <h2 className="text-base font-semibold text-danger-text">{t('channex.noShow.title')}</h2>
            <p className="text-xs text-danger-text/80">{guestName} · {r.check_in} → {r.check_out}</p>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* ── IDLE ── */}
          {(state === 'idle' || state === 'loading') && (
            <>
              <p className="text-sm text-content">
                {t('channex.noShow.body')}
              </p>

              {/* Checkbox */}
              <label className="flex items-start gap-3 cursor-pointer rounded-xl border border-edge bg-surface-subtle px-4 py-3 hover:bg-surface-raised transition-colors">
                <input
                  type="checkbox"
                  checked={collected}
                  onChange={(e) => setCollected(e.target.checked)}
                  disabled={state === 'loading'}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
                />
                <span className="text-sm font-medium text-content">
                  {t('channex.noShow.charged')}
                </span>
              </label>

              {/* Dynamic help text */}
              <div className="rounded-lg bg-surface-subtle px-3 py-2 text-xs text-content-3">
                {collected ? t('channex.noShow.commCharged') : t('channex.noShow.commWaived')}
              </div>
            </>
          )}

          {/* ── ERROR ── */}
          {state === 'error' && (
            <div className="rounded-xl border border-danger-bg bg-danger-bg/40 px-4 py-3">
              <p className="mb-2 text-sm font-semibold text-danger-text">{t('channex.noShow.err.title')}</p>
              <ChannexErrorBlock errors={errorData ?? undefined} />
            </div>
          )}

          {/* ── SUCCESS ── */}
          {state === 'success' && (
            <div className="rounded-xl border border-ok-bg bg-ok-bg/40 px-4 py-3">
              <p className="text-sm font-semibold text-ok-text">{t('channex.noShow.success')}</p>
              <p className="mt-1 text-xs text-content-3">{t('channex.noShow.successDetail')}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-edge px-5 py-3 bg-surface-subtle">
          {/* IDLE */}
          {(state === 'idle' || state === 'loading') && (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={state === 'loading'}
                className="rounded-lg px-4 py-2 text-sm font-medium text-content-2 hover:text-content hover:bg-surface transition-colors disabled:opacity-50"
              >
                {t('channex.noShow.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={state === 'loading'}
                className="inline-flex items-center gap-2 rounded-lg bg-danger-text px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {state === 'loading' ? (
                  <>
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    {t('channex.noShow.sending')}
                  </>
                ) : (
                  t('channex.noShow.confirm')
                )}
              </button>
            </>
          )}

          {/* ERROR */}
          {state === 'error' && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-sm font-medium text-content-2 hover:text-content hover:bg-surface transition-colors"
              >
                {t('channex.noShow.close')}
              </button>
              <button
                type="button"
                onClick={() => { setErrorData(null); setState('idle'); }}
                className="rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-medium text-content hover:bg-surface-raised transition-colors"
              >
                {t('channex.noShow.retry')}
              </button>
            </>
          )}

          {/* SUCCESS */}
          {state === 'success' && (
            <button
              type="button"
              onClick={() => { onSuccess(); onClose(); }}
              className="rounded-lg bg-ok-text px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
            >
              {t('channex.noShow.understood')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

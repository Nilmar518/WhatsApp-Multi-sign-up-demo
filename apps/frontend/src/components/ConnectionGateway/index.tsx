import { useEffect, useState } from 'react';
import type { IntegrationStatus } from '../../types/integration';
import type { TranslationKey } from '../../i18n/es';
import ConnectButton from '../ConnectButton';
import ForceMigrationForm from '../ForceMigrationForm';
import { useWhatsAppConnect } from '../../hooks/useWhatsAppConnect';
import Button from '../ui/Button';
import Card from '../ui/Card';
import { useLanguage } from '../../context/LanguageContext';

interface Props {
  businessId: string;
  currentStatus: IntegrationStatus;
  /**
   * Phase 5 — called after the setup flow completes so App.tsx can surface
   * the hook's setupStep to StatusDisplay without lifting state all the way up.
   * Optional: if not provided, StatusDisplay continues to read from Firestore.
   */
  onSetupStepChange?: (step: ReturnType<typeof useWhatsAppConnect>['step']) => void;
}

type ModalView = 'choice' | 'standard' | 'force_migration';

/**
 * ConnectionGateway  (Phase 5 — hosts useWhatsAppConnect)
 *
 * This component is the owner of the useWhatsAppConnect hook instance.
 * It passes the hook's `exchangeToken` action and `setupStep` state down to
 * ConnectButton so the button can delegate all HTTP calls while retaining
 * ownership of the FB.login popup flow.
 *
 * Auto-close rules (in priority order):
 *   1. Hook reaches 'complete' — all steps succeeded, Firestore is settling
 *   2. Firestore status becomes 'ACTIVE' or 'PENDING_TOKEN'
 *
 * The modal stays open during:
 *   - Active in-flight steps (exchanging_token, registering_phone, etc.)
 *   - 'error' step — user should see the error message and can retry
 *   - MIGRATING — migration form must stay open for OTP input
 */
export default function ConnectionGateway({ businessId, currentStatus, onSetupStepChange }: Props) {
  const { t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<ModalView>('choice');
  const [fromFailedPopup, setFromFailedPopup] = useState(false);

  const {
    step: setupStep,
    error: setupError,
    exchangeToken,
    reset: resetSetup,
  } = useWhatsAppConnect(businessId);

  // Notify the parent whenever setupStep changes (so App.tsx can pass it to StatusDisplay)
  useEffect(() => {
    onSetupStepChange?.(setupStep);
  }, [setupStep, onSetupStepChange]);

  // Auto-close: hook completed all steps (Firestore will settle to ACTIVE shortly)
  useEffect(() => {
    if (isOpen && setupStep === 'complete') {
      setIsOpen(false);
    }
  }, [setupStep, isOpen]);

  // Auto-close: Firestore-driven success (ACTIVE or PENDING_TOKEN)
  // Keep open during MIGRATING so the user can progress through OTP steps.
  useEffect(() => {
    if (isOpen && (currentStatus === 'ACTIVE' || currentStatus === 'PENDING_TOKEN')) {
      setIsOpen(false);
    }
  }, [currentStatus, isOpen]);

  const open = () => {
    resetSetup();    // clear any previous error/step before re-opening
    setView('choice');
    setFromFailedPopup(false);
    setIsOpen(true);
  };

  const close = () => {
    setIsOpen(false);
    // Don't reset the hook on manual close — if setup is mid-flight (unlikely
    // since the overlay blocks interaction) we want to preserve step state.
  };

  /**
   * Called by ConnectButton when the Embedded Signup popup exits without a
   * usable payload (CANCEL, ERROR, or FINISH with no phone_number_id).
   * We skip WABA discovery here — the customer enters their phone number in
   * the Force Migration form and POST /migration/start handles discovery.
   */
  const handleRecovery = () => {
    setFromFailedPopup(true);
    setView('force_migration');
  };

  const isDisabled =
    currentStatus === 'CONNECTING' ||
    currentStatus === 'ACTIVE' ||
    currentStatus === 'PENDING_TOKEN' ||
    currentStatus === 'MIGRATING';

  const triggerLabel: Partial<Record<IntegrationStatus, string>> = {
    IDLE:          t('conn.connectWhatsApp'),
    CONNECTING:    t('conn.connecting'),
    PENDING_TOKEN: t('conn.awaitingToken'),
    MIGRATING:     t('conn.migrating'),
    ACTIVE:        t('conn.connected'),
    ERROR:         t('conn.retry'),
  };

  return (
    <>
      {/* ── Trigger button ──────────────────────────────────────────────── */}
      <Button
        variant="primary"
        onClick={open}
        disabled={isDisabled}
        className="w-full"
      >
        {triggerLabel[currentStatus] ?? t('conn.connectWhatsApp')}
      </Button>

      {/* ── Modal overlay ────────────────────────────────────────────────── */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}
        >
          <Card padding={false} className="w-full max-w-md p-6 space-y-5 relative">
            <button
              onClick={close}
              className="absolute top-4 right-4 text-content-3 hover:text-content-2 transition-colors text-xl leading-none"
              aria-label="Close"
            >
              ×
            </button>

            {/* ── Choice screen ────────────────────────────────────────── */}
            {view === 'choice' && (
              <>
                <div>
                  <h2 className="text-lg font-bold text-content">{t('conn.connectWhatsApp')}</h2>
                  <p className="text-sm text-content-2 mt-1">{t('conn.chooseMethod')}</p>
                </div>

                <div className="bg-caution-bg border border-yellow-200 rounded-xl px-4 py-3 text-xs text-caution-text leading-relaxed">
                  <strong className="font-semibold">{t('conn.headsUpTitle')}</strong>{' '}
                  {t('conn.headsUpBody')}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => { setFromFailedPopup(false); setView('standard'); }}
                    className="flex flex-col gap-2 p-4 rounded-xl border-2 border-edge hover:border-channel-wa hover:bg-ok-bg transition-colors text-left group"
                  >
                    <span className="text-2xl">📲</span>
                    <span className="font-semibold text-sm text-content group-hover:text-ok-text">
                      {t('conn.standard.title')}
                    </span>
                    <span className="text-xs text-content-2">
                      {t('conn.standard.desc')}
                    </span>
                  </button>

                  <button
                    onClick={() => { setFromFailedPopup(false); setView('force_migration'); }}
                    className="flex flex-col gap-2 p-4 rounded-xl border-2 border-edge hover:border-purple-400 hover:bg-purple-50 transition-colors text-left group"
                  >
                    <span className="text-2xl">⚡</span>
                    <span className="font-semibold text-sm text-content group-hover:text-purple-700">
                      Force Migration
                    </span>
                    <span className="text-xs text-content-2">
                      {t('conn.force.desc')}
                    </span>
                  </button>
                </div>
              </>
            )}

            {/* ── Standard Connect ──────────────────────────────────────── */}
            {view === 'standard' && (
              <>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setView('choice')}
                    className="text-content-3 hover:text-content-2 transition-colors text-sm"
                  >
                    {t('conn.back')}
                  </button>
                  <h2 className="text-base font-bold text-content">{t('conn.standard.title')}</h2>
                </div>
                <p className="text-xs text-content-2 -mt-2">
                  {t('conn.standard.sub')}
                </p>

                {/* Step progress bar — visible once the hook leaves idle  */}
                {setupStep !== 'idle' && setupStep !== 'error' && (
                  <SetupProgressBar step={setupStep} />
                )}

                <ConnectButton
                  businessId={businessId}
                  currentStatus={currentStatus}
                  onRecoveryNeeded={handleRecovery}
                  onExchangeToken={exchangeToken}
                  setupStep={setupStep}
                  setupError={setupError}
                />
              </>
            )}

            {/* ── Force Migration ───────────────────────────────────────── */}
            {view === 'force_migration' && (
              <>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setView('choice')}
                    className="text-content-3 hover:text-content-2 transition-colors text-sm"
                  >
                    {t('conn.back')}
                  </button>
                  <h2 className="text-base font-bold text-content">Force Migration</h2>
                </div>
                <ForceMigrationForm
                  businessId={businessId}
                  fromFailedPopup={fromFailedPopup}
                />
              </>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

// ─── SetupProgressBar ─────────────────────────────────────────────────────────

type SetupStep = ReturnType<typeof useWhatsAppConnect>['step'];

const STEPS: { key: SetupStep; labelKey: TranslationKey }[] = [
  { key: 'exchanging_token',     labelKey: 'conn.step.verify'    },
  { key: 'registering_phone',    labelKey: 'conn.step.activate'  },
  { key: 'verifying_status',     labelKey: 'conn.step.confirm'   },
  { key: 'subscribing_webhooks', labelKey: 'conn.step.subscribe' },
  { key: 'complete',             labelKey: 'conn.step.done'      },
];

function SetupProgressBar({ step }: { step: SetupStep }) {
  const { t } = useLanguage();
  const currentIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <div className="flex items-center gap-1">
      {STEPS.map((s, i) => {
        const isDone    = currentIndex > i;
        const isActive  = currentIndex === i;

        return (
          <div key={s.key} className="flex items-center gap-1 flex-1">
            <div className="flex flex-col items-center gap-0.5 flex-1">
              <div
                className={[
                  'w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold transition-colors',
                  isDone   ? 'bg-brand text-white'
                  : isActive ? 'bg-yellow-400 text-white animate-pulse'
                  : 'bg-surface-subtle text-content-3',
                ].join(' ')}
              >
                {isDone ? '✓' : i + 1}
              </div>
              <span className={[
                'text-[9px] leading-none whitespace-nowrap',
                isDone   ? 'text-ok-text font-medium'
                : isActive ? 'text-caution-text font-medium'
                : 'text-content-3',
              ].join(' ')}>
                {t(s.labelKey)}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={[
                'h-0.5 flex-1 mb-3 transition-colors',
                isDone ? 'bg-ok-text' : 'bg-surface-subtle',
              ].join(' ')} />
            )}
          </div>
        );
      })}
    </div>
  );
}

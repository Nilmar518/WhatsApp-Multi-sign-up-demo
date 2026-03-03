import { useEffect, useState } from 'react';
import type { IntegrationStatus } from '../../types/integration';
import ConnectButton from '../ConnectButton';
import ForceMigrationForm from '../ForceMigrationForm';

interface Props {
  businessId: string;
  currentStatus: IntegrationStatus;
}

type ModalView = 'choice' | 'standard' | 'force_migration';

export default function ConnectionGateway({ businessId, currentStatus }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<ModalView>('choice');
  const [fromFailedPopup, setFromFailedPopup] = useState(false);

  // Auto-close when the integration reaches a success state.
  // Keep open during MIGRATING so the user can progress through OTP steps.
  useEffect(() => {
    if (isOpen && (currentStatus === 'ACTIVE' || currentStatus === 'PENDING_TOKEN')) {
      setIsOpen(false);
    }
  }, [currentStatus, isOpen]);

  const open = () => {
    setView('choice');
    setFromFailedPopup(false);
    setIsOpen(true);
  };

  const close = () => setIsOpen(false);

  /**
   * Called by ConnectButton when the Embedded Signup popup exits without a
   * usable payload (CANCEL, ERROR, or FINISH with no phone_number_id).
   *
   * We skip the WABA discovery step entirely here — the customer just enters
   * their phone number in the Force Migration form and POST /migration/start
   * handles all backend discovery and provisioning automatically.
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

  const triggerLabel: Record<IntegrationStatus, string> = {
    IDLE: 'Connect WhatsApp',
    CONNECTING: 'Connecting...',
    PENDING_TOKEN: 'Awaiting Token...',
    MIGRATING: 'Migrating...',
    ACTIVE: 'Connected',
    ERROR: 'Retry Connection',
  };

  return (
    <>
      {/* ── Trigger button ──────────────────────────────────────────────── */}
      <button
        onClick={open}
        disabled={isDisabled}
        className={[
          'w-full py-3 px-6 rounded-xl font-semibold text-white transition-colors',
          isDisabled
            ? 'bg-gray-300 cursor-not-allowed'
            : currentStatus === 'ERROR'
              ? 'bg-red-500 hover:bg-red-600 active:bg-red-700'
              : 'bg-green-500 hover:bg-green-600 active:bg-green-700',
        ].join(' ')}
      >
        {triggerLabel[currentStatus]}
      </button>

      {/* ── Modal overlay ────────────────────────────────────────────────── */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5 relative">
            <button
              onClick={close}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors text-xl leading-none"
              aria-label="Close"
            >
              ×
            </button>

            {/* ── Choice screen ────────────────────────────────────────── */}
            {view === 'choice' && (
              <>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Connect WhatsApp</h2>
                  <p className="text-sm text-gray-500 mt-1">Choose how to register your number.</p>
                </div>

                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-900 leading-relaxed">
                  <strong className="font-semibold">Heads up:</strong> If your number is currently
                  active on WhatsApp on a phone, the standard signup will ask you to delete that
                  account.{' '}
                  <span className="font-medium">Use Force Migration to skip this step.</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => { setFromFailedPopup(false); setView('standard'); }}
                    className="flex flex-col gap-2 p-4 rounded-xl border-2 border-gray-200 hover:border-green-400 hover:bg-green-50 transition-colors text-left group"
                  >
                    <span className="text-2xl">📲</span>
                    <span className="font-semibold text-sm text-gray-800 group-hover:text-green-700">
                      Standard Connect
                    </span>
                    <span className="text-xs text-gray-500">
                      Meta Embedded Signup popup. Works for new or unregistered numbers.
                    </span>
                  </button>

                  <button
                    onClick={() => { setFromFailedPopup(false); setView('force_migration'); }}
                    className="flex flex-col gap-2 p-4 rounded-xl border-2 border-gray-200 hover:border-purple-400 hover:bg-purple-50 transition-colors text-left group"
                  >
                    <span className="text-2xl">⚡</span>
                    <span className="font-semibold text-sm text-gray-800 group-hover:text-purple-700">
                      Force Migration
                    </span>
                    <span className="text-xs text-gray-500">
                      Enter your number and verify via OTP. No popup required.
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
                    className="text-gray-400 hover:text-gray-600 transition-colors text-sm"
                  >
                    ← Back
                  </button>
                  <h2 className="text-base font-bold text-gray-900">Standard Connect</h2>
                </div>
                <p className="text-xs text-gray-500 -mt-2">
                  Opens the Meta Embedded Signup popup. If it fails or closes unexpectedly,
                  you'll be guided to Force Migration automatically.
                </p>
                <ConnectButton
                  businessId={businessId}
                  currentStatus={currentStatus}
                  onRecoveryNeeded={handleRecovery}
                />
              </>
            )}

            {/* ── Force Migration ───────────────────────────────────────── */}
            {view === 'force_migration' && (
              <>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setView('choice')}
                    className="text-gray-400 hover:text-gray-600 transition-colors text-sm"
                  >
                    ← Back
                  </button>
                  <h2 className="text-base font-bold text-gray-900">Force Migration</h2>
                </div>
                <ForceMigrationForm
                  businessId={businessId}
                  fromFailedPopup={fromFailedPopup}
                />
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

import { useEffect, useRef, useState } from 'react';
import type { IntegrationStatus } from '../../types/integration';
import type { SetupStep } from '../../hooks/useWhatsAppConnect';
import Button from '../ui/Button';

interface Props {
  businessId: string;
  currentStatus: IntegrationStatus;
  /**
   * Called when the Embedded Signup popup exits without a usable payload —
   * CANCEL, ERROR, or a FINISH event missing phone_number_id/waba_id (which
   * indicates a "number already registered" failure). ConnectionGateway uses
   * this to trigger automatic WABA discovery and pre-populate Force Migration.
   */
  onRecoveryNeeded?: () => void;
  /**
   * Phase 5 — receives the exchangeToken action from useWhatsAppConnect.
   * ConnectButton owns FB.login wiring; the hook owns all HTTP calls.
   */
  onExchangeToken: (
    code: string,
    wabaId: string,
    phoneNumberId: string,
    businessId: string,
  ) => Promise<void>;
  /** Current setup step from the hook — drives the button label and pending state. */
  setupStep: SetupStep;
  /** Hook-level error message — displayed below the button. */
  setupError: string | null;
}

/**
 * ConnectButton  (Phase 5 — delegates all HTTP to useWhatsAppConnect)
 *
 * This component is now responsible ONLY for:
 *   1. Validating the FB SDK and env config
 *   2. Opening the FB.login popup
 *   3. Parsing the WA_EMBEDDED_SIGNUP iframe messages
 *   4. Coordinating the pendingCode / finishPayload race
 *   5. Calling props.onExchangeToken() once both code and payload are available
 *   6. Triggering props.onRecoveryNeeded() on CANCEL / ERROR / missing payload
 *
 * All token exchange, phone registration, status verification, and webhook
 * subscription logic lives in useWhatsAppConnect (hooks/useWhatsAppConnect.ts).
 */
export default function ConnectButton({
  businessId,
  currentStatus,
  onRecoveryNeeded,
  onExchangeToken,
  setupStep,
  setupError,
}: Props) {
  // isPending covers the brief window BEFORE the FB.login popup opens and after
  // the code arrives — the hook's setupStep covers everything after that.
  const [isPending, setIsPending] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Keeps the latest Firestore status accessible inside long-running async
  // closures where the prop value captured at closure-creation would be stale.
  const currentStatusRef = useRef<IntegrationStatus>(currentStatus);
  useEffect(() => {
    currentStatusRef.current = currentStatus;
  }, [currentStatus]);

  // Gates the WA_EMBEDDED_SIGNUP FINISH handler to fire exactly once per
  // FB.login session.
  const isExchangingRef = useRef(false);

  const isInProgress =
    isPending ||
    setupStep === 'exchanging_token' ||
    setupStep === 'registering_phone' ||
    setupStep === 'verifying_status' ||
    setupStep === 'subscribing_webhooks';

  const isDisabled =
    currentStatus === 'CONNECTING' ||
    currentStatus === 'ACTIVE' ||
    currentStatus === 'PENDING_TOKEN' ||
    isInProgress;

  // Reset local error when the hook reports a new attempt started
  useEffect(() => {
    if (setupStep === 'exchanging_token') {
      setLocalError(null);
      setLimitReached(false);
    }
    if (setupStep === 'error' && setupError?.includes('limit')) {
      setLimitReached(true);
    }
  }, [setupStep, setupError]);

  const handleClick = () => {
    if (!import.meta.env.VITE_FB_APP_ID) {
      console.error(
        '[ConnectButton] VITE_FB_APP_ID is not set — FB.init will use a placeholder and logins will fail. ' +
        'Add VITE_FB_APP_ID=<your App ID> to apps/frontend/.env',
      );
    }

    if (!window.FB) {
      console.error('[ConnectButton] Facebook JS SDK not loaded. Check HTTPS origin and App ID configuration.');
      setLocalError('Facebook SDK not available. Ensure you are on an HTTPS URL registered in the Meta App Dashboard.');
      return;
    }

    setLocalError(null);
    setLimitReached(false);
    setIsPending(true);
    isExchangingRef.current = false;

    // Register the FINISH listener BEFORE FB.login() opens the popup.
    // If registered inside the FB.login callback there is a race: the popup can
    // dispatch WA_EMBEDDED_SIGNUP FINISH before the callback fires, causing the
    // message to be missed.
    let pendingCode: string | null = null;
    let finishPayload: { phone_number_id: string; waba_id: string } | null = null;

    const runExchange = async (
      code: string,
      phone_number_id: string,
      waba_id: string,
    ) => {
      try {
        // Delegate entirely to the hook — no HTTP fetch here
        await onExchangeToken(code, waba_id, phone_number_id, businessId);
      } finally {
        setIsPending(false);
      }
    };

    const onMessage = async (event: MessageEvent<string>) => {
      if (!event.origin.endsWith('facebook.com')) return;

      let data: {
        type?: string;
        event?: string;
        data?: { phone_number_id: string; waba_id: string };
      };
      try {
        data = JSON.parse(event.data) as typeof data;
      } catch {
        return;
      }

      if (data.type === 'WA_EMBEDDED_SIGNUP') {
        if (data.event === 'FINISH') {
          if (isExchangingRef.current) {
            console.warn('[ConnectButton] FINISH fired again — exchange already in flight, ignoring duplicate');
            return;
          }

          if (!data.data?.phone_number_id || !data.data?.waba_id) {
            console.warn('[ConnectButton] WA_EMBEDDED_SIGNUP FINISH — payload missing, triggering recovery');
            window.removeEventListener('message', onMessage);
            setIsPending(false);
            onRecoveryNeeded?.();
            return;
          }

          isExchangingRef.current = true;
          window.removeEventListener('message', onMessage);

          finishPayload = data.data;
          console.log(
            `[ConnectButton] WA_EMBEDDED_SIGNUP FINISH — waba_id=${finishPayload.waba_id} phone_number_id=${finishPayload.phone_number_id}`,
          );

          if (pendingCode) {
            await runExchange(pendingCode, finishPayload.phone_number_id, finishPayload.waba_id);
          } else {
            console.log('[ConnectButton] FINISH arrived before FB.login callback — waiting for code');
          }
        } else if (data.event === 'CANCEL' || data.event === 'ERROR') {
          console.log(`[ConnectButton] WA_EMBEDDED_SIGNUP ${data.event} — triggering recovery path`);
          window.removeEventListener('message', onMessage);
          setIsPending(false);
          onRecoveryNeeded?.();
        }
      }
    };

    window.addEventListener('message', onMessage);

    window.FB.login(
      (response) => {
        if (!response.authResponse?.code) {
          console.warn('[ConnectButton] Login cancelled or no code returned.');
          window.removeEventListener('message', onMessage);
          setIsPending(false);
          return;
        }

        pendingCode = response.authResponse.code;
        console.log(`[ConnectButton] FB.login code received — prefix=${pendingCode.slice(0, 8)}...`);

        if (finishPayload && isExchangingRef.current) {
          void runExchange(pendingCode, finishPayload.phone_number_id, finishPayload.waba_id);
        }
      },
      {
        config_id: import.meta.env.VITE_META_CONFIG_ID,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: 'MIGRATE_PHONE_NUMBER',
          sessionInfoVersion: '3',
        },
      },
    );
  };

  // ── Button label ─────────────────────────────────────────────────────────────

  const stepLabel: Partial<Record<SetupStep, string>> = {
    exchanging_token:    'Verifying account...',
    registering_phone:   'Activating number...',
    verifying_status:    'Confirming status...',
    subscribing_webhooks: 'Finalizing connection...',
    complete:            'Connected ✓',
  };

  const statusLabel: Partial<Record<IntegrationStatus, string>> = {
    IDLE:          'Connect WhatsApp',
    CONNECTING:    'Connecting...',
    PENDING_TOKEN: 'Awaiting Token...',
    MIGRATING:     'Migrating...',
    ACTIVE:        'Connected',
    ERROR:         'Retry Connection',
  };

  const buttonLabel =
    stepLabel[setupStep] ??
    (isPending ? 'Verifying...' : (statusLabel[currentStatus] ?? 'Connect WhatsApp'));

  const displayError = setupError ?? localError;

  return (
    <div className="space-y-2">
      <Button
        variant="primary"
        onClick={handleClick}
        disabled={isDisabled}
        className="w-full"
      >
        {buttonLabel}
      </Button>

      {limitReached && (
        <p className="text-xs text-amber-600 text-center font-medium">
          Registration limit reached for this account.
        </p>
      )}

      {displayError && !limitReached && (
        <p className="text-xs text-red-500 text-center">{displayError}</p>
      )}
    </div>
  );
}

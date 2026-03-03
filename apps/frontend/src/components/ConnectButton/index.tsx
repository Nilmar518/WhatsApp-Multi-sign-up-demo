import { useEffect, useRef, useState } from 'react';
import type { IntegrationStatus } from '../../types/integration';

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
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5_000;

/**
 * Remove Facebook Login State (CSRF nonces) from localStorage once the OAuth
 * flow is complete. These `fblst_` keys are written by the FB SDK at the start
 * of FB.login() for CSRF protection; they serve no purpose after the flow ends.
 */
function clearFacebookLoginState(): void {
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('fblst_')) toRemove.push(key);
  }
  toRemove.forEach((k) => {
    localStorage.removeItem(k);
    console.log(`[ConnectButton] Cleared FB login state from localStorage: ${k}`);
  });
}

/**
 * POST /api/auth/exchange-token with automatic retry.
 *
 * Retry policy:
 *   5xx / network error → retry (transient server failure, code not yet consumed)
 *   4xx               → return immediately (definitive; includes 410 Gone for
 *                        "code already used" — retrying a dead code is pointless)
 *   null              → all retries exhausted
 */
async function exchangeWithRetry(payload: object): Promise<Response | null> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch('/api/auth/exchange-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      // 4xx responses are definitive — do not retry
      if (res.ok || (res.status >= 400 && res.status < 500)) return res;
      console.warn(
        `[ConnectButton] Attempt ${attempt}/${MAX_RETRIES} — HTTP ${res.status}, retrying in ${RETRY_DELAY_MS}ms`,
      );
    } catch {
      console.warn(
        `[ConnectButton] Attempt ${attempt}/${MAX_RETRIES} — network error, retrying in ${RETRY_DELAY_MS}ms`,
      );
    }
    if (attempt < MAX_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
  return null;
}

export default function ConnectButton({ businessId, currentStatus, onRecoveryNeeded }: Props) {
  const [isPending, setIsPending] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Keeps the latest Firestore status accessible inside long-running async
  // closures where the prop value captured at closure-creation would be stale.
  const currentStatusRef = useRef<IntegrationStatus>(currentStatus);
  useEffect(() => {
    currentStatusRef.current = currentStatus;
  }, [currentStatus]);

  // Gates the WA_EMBEDDED_SIGNUP FINISH handler to fire exactly once per
  // FB.login session. Named isExchangingRef because it doubles as a "currently
  // exchanging" flag that other logic can read without causing a re-render.
  const isExchangingRef = useRef(false);

  const isDisabled =
    currentStatus === 'CONNECTING' ||
    currentStatus === 'ACTIVE' ||
    currentStatus === 'PENDING_TOKEN' ||
    isPending;

  const handleClick = () => {
    // Verify the FB SDK was initialised with a real App ID.
    // index.html uses %VITE_FB_APP_ID% — if the env var is unset the literal
    // placeholder is passed to FB.init, silently breaking all logins.
    if (!import.meta.env.VITE_FB_APP_ID) {
      console.error(
        '[ConnectButton] VITE_FB_APP_ID is not set — FB.init will use a placeholder and logins will fail. ' +
        'Add VITE_FB_APP_ID=<your App ID> to apps/frontend/.env',
      );
    }

    if (!window.FB) {
      console.error('[ConnectButton] Facebook JS SDK not loaded. Check HTTPS origin and App ID configuration.');
      setFetchError('Facebook SDK not available. Ensure you are on an HTTPS URL registered in the Meta App Dashboard.');
      return;
    }

    // Reset state for this attempt and arm the FINISH gate
    setLimitReached(false);
    setFetchError(null);
    setIsPending(true);
    isExchangingRef.current = false;

    // Register the FINISH listener BEFORE FB.login() opens the popup.
    // If registered inside the FB.login callback there is a race: the popup can
    // dispatch WA_EMBEDDED_SIGNUP FINISH before the callback fires, causing the
    // message to be missed, isPending to never clear, and the code to be wasted.
    //
    // The listener captures `pendingCode` by reference; FB.login's callback
    // sets it once the code arrives. If FINISH fires first the handler waits
    // in the FINISH branch for the code to be populated (see guard below).
    let pendingCode: string | null = null;
    let finishPayload: { phone_number_id: string; waba_id: string } | null = null;

    const runExchange = async (
      code: string,
      phone_number_id: string,
      waba_id: string,
    ) => {
      try {
        const res = await exchangeWithRetry({
          code,
          wabaId: waba_id,
          phoneNumberId: phone_number_id,
          businessId,
        });

        if (!res) {
          // All retries exhausted — check whether Firestore is already ACTIVE
          // (possible if a concurrent request succeeded while we were retrying)
          if (currentStatusRef.current === 'ACTIVE') {
            console.info(
              '[ConnectButton] Retries exhausted but Firestore is ACTIVE — treating as success',
            );
          } else {
            setFetchError(
              `Connection failed after ${MAX_RETRIES} attempts. Please retry.`,
            );
          }
        } else if (!res.ok) {
          if (res.status === 409) {
            setLimitReached(true);
          } else if (res.status === 410) {
            // 410 Gone: the single-use code was already consumed.
            // If Firestore is ACTIVE it was consumed successfully by
            // another request — treat as success. Otherwise ask to restart.
            if (currentStatusRef.current === 'ACTIVE') {
              console.info(
                '[ConnectButton] 410 Gone but Firestore is ACTIVE — treating as success',
              );
            } else {
              setFetchError(
                'This signup code has already been used. Please click "Retry Connection" to start the signup again.',
              );
            }
          } else if (currentStatusRef.current === 'ACTIVE') {
            // Non-2xx but Firestore already ACTIVE — another request won
            console.info(
              '[ConnectButton] Non-OK response but Firestore is ACTIVE — treating as success',
            );
          } else {
            setFetchError(
              'Connection failed. Please retry or contact support.',
            );
          }
        }
        // 200 OK: clear CSRF state from localStorage; Firestore onSnapshot drives the UI
        if (res?.ok) clearFacebookLoginState();
      } catch {
        setFetchError('Network error. Please check your connection and retry.');
      } finally {
        setIsPending(false);
      }
    };

    const onMessage = async (event: MessageEvent<string>) => {
      if (!event.origin.endsWith('facebook.com')) return;

      // Parse only — fetch errors handled in runExchange
      let data: {
        type?: string;
        event?: string;
        data?: { phone_number_id: string; waba_id: string };
      };
      try {
        data = JSON.parse(event.data) as typeof data;
      } catch {
        return; // Non-JSON iframe message — ignore
      }

      if (data.type === 'WA_EMBEDDED_SIGNUP') {
        if (data.event === 'FINISH') {
          // Gate: fire exactly once per FB.login session
          if (isExchangingRef.current) {
            console.warn(
              '[ConnectButton] FINISH fired again — exchange already in flight, ignoring duplicate',
            );
            return;
          }

          // FINISH without a usable payload means the popup failed silently
          // (e.g. "number already registered" error — Meta closes the popup
          // but sends no phone_number_id). Hand off to ConnectionGateway's
          // recovery path which will discover the WABA via API.
          if (!data.data?.phone_number_id || !data.data?.waba_id) {
            console.warn(
              '[ConnectButton] WA_EMBEDDED_SIGNUP FINISH — payload missing, triggering recovery',
            );
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

          // If the code hasn't arrived yet (FINISH fired before FB.login callback),
          // wait briefly; FB.login callback will call runExchange directly.
          if (pendingCode) {
            await runExchange(pendingCode, finishPayload.phone_number_id, finishPayload.waba_id);
          } else {
            console.log('[ConnectButton] FINISH arrived before FB.login callback — waiting for code');
          }
        } else if (data.event === 'CANCEL' || data.event === 'ERROR') {
          // User dismissed the popup or an unrecoverable error occurred.
          // Trigger recovery so ConnectionGateway can discover the WABA and
          // offer Force Migration as the next step.
          console.log(
            `[ConnectButton] WA_EMBEDDED_SIGNUP ${data.event} — triggering recovery path`,
          );
          window.removeEventListener('message', onMessage);
          setIsPending(false);
          onRecoveryNeeded?.();
        }
      }
    };

    // Listener is live before the popup opens
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

        // If FINISH already fired before this callback, run the exchange now
        if (finishPayload && isExchangingRef.current) {
          void runExchange(pendingCode, finishPayload.phone_number_id, finishPayload.waba_id);
        }
        // Otherwise the onMessage handler will call runExchange when FINISH arrives
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

  const label: Record<IntegrationStatus, string> = {
    IDLE: 'Connect WhatsApp',
    CONNECTING: 'Connecting...',
    PENDING_TOKEN: 'Awaiting Token...',
    MIGRATING: 'Migrating...',
    ACTIVE: 'Connected',
    ERROR: 'Retry Connection',
  };

  return (
    <div className="space-y-2">
      <button
        onClick={handleClick}
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
        {isPending ? 'Verifying...' : label[currentStatus]}
      </button>

      {limitReached && (
        <p className="text-xs text-amber-600 text-center font-medium">
          Registration limit reached for this account.
        </p>
      )}

      {fetchError && (
        <p className="text-xs text-red-500 text-center">{fetchError}</p>
      )}
    </div>
  );
}

import { useState } from 'react';

export type MessengerConnectStep = 'idle' | 'connecting' | 'complete' | 'error';

export interface UseMessengerConnectReturn {
  step: MessengerConnectStep;
  error: string | null;
  connect: (businessId: string) => void;
  reset: () => void;
}

/**
 * useMessengerConnect
 *
 * Manages the one-shot Messenger onboarding flow:
 *   1. Open a Facebook Login popup requesting page management scopes.
 *   2. Retrieve the short-lived user access token from the SDK response.
 *   3. POST it to /api/integrations/messenger/setup along with businessId.
 *
 * Once `step === 'complete'` the Firestore listener in the parent (via
 * useIntegrationId filtered to META_MESSENGER) will fire and the connect
 * screen will be replaced by the Messenger chat view automatically.
 */
export function useMessengerConnect(): UseMessengerConnectReturn {
  const [step, setStep] = useState<MessengerConnectStep>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleSetup = async (shortLivedToken: string, businessId: string) => {
    try {
      const res = await fetch('/api/integrations/messenger/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortLivedToken, businessId }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `Server error ${res.status}`);
      }

      setStep('complete');
    } catch (err: unknown) {
      setStep('error');
      setError(
        err instanceof Error ? err.message : 'Failed to connect Messenger. Please try again.',
      );
    }
  };

  const connect = (businessId: string) => {
    if (!window.FB) {
      setError(
        'Facebook SDK not available. Ensure you are on an HTTPS URL registered in the Meta App Dashboard.',
      );
      setStep('error');
      return;
    }

    setStep('connecting');
    setError(null);

    window.FB.login(
      (response) => {
        const token = (response as any)?.authResponse?.accessToken as string | undefined;

        if (!token) {
          setStep('error');
          setError('Facebook Login was cancelled or did not return an access token.');
          return;
        }

        void handleSetup(token, businessId);
      },
      {
        // Messenger-specific scopes — different from the WhatsApp embedded signup flow
        scope: 'pages_show_list,pages_messaging,pages_manage_metadata,public_profile',
        return_scopes: true,
      } as Record<string, unknown>,
    );
  };

  const reset = () => {
    setStep('idle');
    setError(null);
  };

  return { step, error, connect, reset };
}

import { useState } from 'react';

export type InstagramConnectStep = 'idle' | 'redirecting' | 'error';

export interface UseInstagramConnectReturn {
  step:    InstagramConnectStep;
  error:   string | null;
  connect: (businessId: string) => void;
  reset:   () => void;
}

/**
 * useInstagramConnect
 *
 * Initiates the "Instagram API with Instagram Login" OAuth 2.0 redirect flow.
 * No Facebook SDK required — replaces the previous FB.login() approach.
 *
 * Flow:
 *   1. connect(businessId) is called.
 *   2. Validates VITE_INSTAGRAM_APP_ID and VITE_IG_REDIRECT_URI are set.
 *   3. Sets step = 'redirecting', then navigates to api.instagram.com/oauth/authorize
 *      with the businessId carried in the OAuth `state` parameter.
 *   4. After user approval, Instagram redirects to the backend callback:
 *        GET {IG_OAUTH_REDIRECT_URI}?code=X&state={businessId}
 *   5. Backend exchanges the code, resolves the IG account, writes Firestore,
 *      and redirects the browser back to the frontend dashboard URL.
 *   6. The Firestore onSnapshot listener (useIntegrationId / META_INSTAGRAM)
 *      detects the new integration document and swaps the connect screen for
 *      the Instagram dashboard automatically.
 *
 * Required Vite env vars:
 *   VITE_INSTAGRAM_APP_ID   — Meta/Instagram App client_id (same as your Meta App ID)
 *   VITE_IG_REDIRECT_URI    — Must match exactly the redirect URI registered in the
 *                             Meta App Dashboard. Points to the backend callback, e.g.:
 *                             https://xxxx.ngrok-free.app/integrations/instagram/oauth-callback
 */
export function useInstagramConnect(): UseInstagramConnectReturn {
  const [step,  setStep]  = useState<InstagramConnectStep>('idle');
  const [error, setError] = useState<string | null>(null);

  const connect = (businessId: string) => {
    const appId       = import.meta.env.VITE_INSTAGRAM_APP_ID as string | undefined;
    const redirectUri = import.meta.env.VITE_IG_REDIRECT_URI  as string | undefined;

    if (!appId) {
      setError('VITE_INSTAGRAM_APP_ID is not configured. Add it to apps/frontend/.env.');
      setStep('error');
      return;
    }

    if (!redirectUri) {
      setError('VITE_IG_REDIRECT_URI is not configured. Add it to apps/frontend/.env.');
      setStep('error');
      return;
    }

    setStep('redirecting');
    setError(null);

    const params = new URLSearchParams({
      client_id:     appId,
      redirect_uri:  redirectUri,
      scope:         [
        'instagram_business_basic',
        'instagram_business_manage_messages',
        'instagram_business_manage_comments',
      ].join(','),
      response_type: 'code',
      // state is round-tripped back by Instagram to the backend callback,
      // letting the server know which businessId to link the IG account to.
      state: businessId,
    });

    window.location.href =
      `https://api.instagram.com/oauth/authorize?${params.toString()}`;
  };

  const reset = () => {
    setStep('idle');
    setError(null);
  };

  return { step, error, connect, reset };
}

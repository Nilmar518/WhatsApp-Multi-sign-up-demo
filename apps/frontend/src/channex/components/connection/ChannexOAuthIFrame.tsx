// apps/frontend/src/channex/components/connection/ChannexOAuthIFrame.tsx

import { useState, useEffect, useRef, useCallback } from 'react';

type IFrameStatus = 'IDLE' | 'FETCHING' | 'RENDERING' | 'CONNECTED' | 'ERROR';

interface Props {
  propertyId: string;
  channel: 'ABB' | 'BDC';
  getToken: (propertyId: string) => Promise<string>;
  onConnected?: () => void;
}

function buildIFrameUrl(token: string, propertyId: string, channel: 'ABB' | 'BDC'): string {
  const base =
    import.meta.env.VITE_CHANNEX_IFRAME_BASE_URL ?? 'https://staging.channex.io';
  const params = new URLSearchParams({
    oauth_session_key: token,
    app_mode: 'headless',
    redirect_to: '/channels',
    property_id: propertyId,
    channels: channel,
  });
  return `${base}/auth/exchange?${params.toString()}`;
}

export default function ChannexOAuthIFrame({ propertyId, channel, getToken, onConnected }: Props) {
  const [status, setStatus] = useState<IFrameStatus>('IDLE');
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [iframeKey, setIframeKey] = useState(0);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true; // required: resets ref after React 18 StrictMode's simulated unmount/remount cycle
    return () => { mountedRef.current = false; };
  }, []);

  const getTokenRef = useRef(getToken);
  useEffect(() => { getTokenRef.current = getToken; });

  const fetchToken = useCallback(async () => {
    if (!mountedRef.current) return;
    setStatus('FETCHING');
    setToken(null);
    setError(null);
    try {
      const t = await getTokenRef.current(propertyId);
      if (!mountedRef.current) return;
      setToken(t);
      setStatus('RENDERING');
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to get session token.');
      setStatus('ERROR');
    }
  }, [propertyId]); // getToken excluded from deps — accessed via ref

  useEffect(() => {
    void fetchToken();
  }, [fetchToken, iframeKey]);

  const handleIFrameError = useCallback(() => {
    if (!mountedRef.current) return;
    setStatus('ERROR');
    setError('The embedded panel failed to load. This may be caused by a browser security policy.');
  }, []);

  const handleIFrameLoad = useCallback(() => {
    if (!mountedRef.current) return;
    setStatus('CONNECTED');
    onConnected?.();
  }, [onConnected]);

  const handleRetry = useCallback(() => {
    setIframeKey((k) => k + 1);
  }, []);

  const iframeUrl = token ? buildIFrameUrl(token, propertyId, channel) : null;

  return (
    <div className="w-full h-full min-h-[600px] flex flex-col">

      {(status === 'IDLE' || status === 'FETCHING') && (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 py-16 text-content-3">
          <div
            className="w-8 h-8 border-2 border-edge border-t-notice-text rounded-full animate-spin"
            aria-label="Loading"
          />
          <p className="text-sm">Preparing secure connection panel...</p>
        </div>
      )}

      {status === 'ERROR' && (
        <div className="flex flex-col items-center justify-center flex-1 gap-4 py-12 px-6">
          <div className="max-w-md w-full bg-danger-bg border border-danger-text/20 rounded-xl px-5 py-4 text-sm text-danger-text">
            <p className="font-semibold mb-1">Connection panel unavailable</p>
            <p>{error ?? 'An unexpected error occurred.'}</p>
          </div>
          <button
            type="button"
            onClick={handleRetry}
            className="text-sm font-medium px-4 py-2 bg-notice-bg text-notice-text rounded-lg hover:opacity-80 transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {iframeUrl && (status === 'RENDERING' || status === 'CONNECTED') && (
        <div className="relative flex-1 flex flex-col">
          {status === 'RENDERING' && (
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-notice-bg overflow-hidden z-10">
              <div className="h-full bg-notice-text animate-pulse w-2/3" />
            </div>
          )}
          <iframe
            key={iframeKey}
            src={iframeUrl}
            title="Connect your account"
            className="w-full h-full min-h-[600px] border-none rounded-lg shadow-sm flex-1"
            onLoad={handleIFrameLoad}
            onError={handleIFrameError}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          />
        </div>
      )}
    </div>
  );
}

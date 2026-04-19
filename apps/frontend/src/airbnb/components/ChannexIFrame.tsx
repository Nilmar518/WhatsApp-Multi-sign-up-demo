import { useState, useEffect, useRef, useCallback } from 'react';
import { getOneTimeToken, getCopyLink } from '../api/channexApi';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * IFrame lifecycle states:
 *   IDLE       — component just mounted, no fetch started yet
 *   FETCHING   — calling GET /one-time-token from the backend
 *   RENDERING  — token received, iframe src is set and the frame is loading
 *   CONNECTED  — iframe fired the load event without errors
 *   ERROR      — token fetch failed OR iframe failed to load (CSP / network)
 */
type IFrameStatus = 'IDLE' | 'FETCHING' | 'RENDERING' | 'CONNECTED' | 'ERROR';

interface Props {
  /** The Channex property UUID obtained during Phase 2 provisioning. */
  propertyId: string;
  /** Optional callback fired when the IFrame reports a successful Airbnb connection. */
  onConnected?: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Constructs the Channex IFrame src URL.
 *
 * Parameters:
 *   - `app_mode=headless`  strips Channex global navigation (white-label effect)
 *   - `redirect_to=/channels`  lands the user on the channel connection page
 *   - `channels=ABB`  restricts the UI to Airbnb only (prevents accidental
 *     connection of unsupported OTAs — Channex supports 50+ channels)
 *
 * VITE_CHANNEX_IFRAME_BASE_URL must be set in apps/frontend/.env:
 *   VITE_CHANNEX_IFRAME_BASE_URL=https://staging.channex.io
 */
function buildIFrameUrl(token: string, propertyId: string): string {
  const base =
    import.meta.env.VITE_CHANNEX_IFRAME_BASE_URL ?? 'https://staging.channex.io';

  const params = new URLSearchParams({
    oauth_session_key: token,
    app_mode: 'headless',
    redirect_to: '/channels',
    property_id: propertyId,
    channels: 'ABB',
  });

  return `${base}/auth/exchange?${params.toString()}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * ChannexIFrame — embeds the Channex headless channel-connection UI inside Migo UIT.
 *
 * Flow:
 *   1. On mount: requests a single-use session token from GET /api/channex/properties/:id/one-time-token
 *   2. Constructs the IFrame src URL with `app_mode=headless` and `channels=ABB`
 *   3. Renders the IFrame — Channex manages the Airbnb OAuth redirect internally
 *      without navigating the host page (the user stays on Migo UIT)
 *   4. CSP fallback: if the IFrame fails to load (e.g. strict Content Security Policy
 *      blocks staging.channex.io), fetches a direct connection URL and renders an
 *      "Open in New Tab" button instead of the broken frame
 *
 * Token lifecycle:
 *   - 15-minute TTL, single-use; invalidated after the first IFrame exchange.
 *   - "Retry" button re-mounts the component via the `iframeKey` counter, which
 *     triggers a fresh useEffect and requests a brand-new token.
 */
export default function ChannexIFrame({ propertyId, onConnected }: Props) {
  const [status, setStatus] = useState<IFrameStatus>('IDLE');
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [showFallback, setShowFallback] = useState(false);

  // Incrementing this forces React to unmount+remount the <iframe> element,
  // which resets the src and triggers a fresh token fetch on retry.
  const [iframeKey, setIframeKey] = useState(0);

  // Guard against state updates after unmount (e.g. if parent unmounts mid-fetch).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ── Token fetch ──────────────────────────────────────────────────────────

  const fetchToken = useCallback(async () => {
    if (!mountedRef.current) return;

    setStatus('FETCHING');
    setToken(null);
    setError(null);
    setFallbackUrl(null);
    setShowFallback(false);

    try {
      const t = await getOneTimeToken(propertyId);
      if (!mountedRef.current) return;
      setToken(t);
      setStatus('RENDERING');
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to get session token.');
      setStatus('ERROR');
    }
  }, [propertyId]);

  // Fetch token on mount and whenever iframeKey changes (retry).
  useEffect(() => {
    void fetchToken();
  }, [fetchToken, iframeKey]);

  // ── CSP fallback ─────────────────────────────────────────────────────────

  const handleIFrameError = useCallback(async () => {
    // Note: the `onError` event on <iframe> is not consistently fired across
    // browsers for load failures (it fires for network errors but not for CSP
    // blocks in all browsers). We also expose a manual fallback toggle below
    // as a secondary escape hatch for cases where onError does not fire.
    if (!mountedRef.current) return;

    setStatus('ERROR');
    setError('The embedded panel failed to load. This may be caused by a browser security policy.');

    // Fetch the direct connection URL only once.
    if (fallbackUrl) return;

    try {
      const url = await getCopyLink(propertyId);
      if (!mountedRef.current) return;
      setFallbackUrl(url);
    } catch {
      // Copy-link fetch failed — the manual fallback will not have a URL.
      // The retry button is still available.
    }
  }, [propertyId, fallbackUrl]);

  const handleIFrameLoad = useCallback(() => {
    if (!mountedRef.current) return;
    setStatus('CONNECTED');
    onConnected?.();
  }, [onConnected]);

  const handleRetry = useCallback(() => {
    // Increment the key to force a full iframe unmount + token re-fetch.
    setIframeKey((k) => k + 1);
  }, []);

  const handleManualFallback = useCallback(async () => {
    setShowFallback(true);
    if (fallbackUrl) return;

    try {
      const url = await getCopyLink(propertyId);
      if (!mountedRef.current) return;
      setFallbackUrl(url);
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error
          ? `Could not generate fallback link: ${err.message}`
          : 'Could not generate fallback link.',
      );
    }
  }, [propertyId, fallbackUrl]);

  // ── Render ───────────────────────────────────────────────────────────────

  const iframeUrl = token ? buildIFrameUrl(token, propertyId) : null;
  console.log('IFrame URL:', iframeUrl);

  return (
    <div className="w-full h-full min-h-[600px] flex flex-col">

      {/* ── Loading state ────────────────────────────────────────────────── */}
      {(status === 'IDLE' || status === 'FETCHING') && (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 py-16 text-gray-400">
          <div
            className="w-8 h-8 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin"
            aria-label="Loading"
          />
          <p className="text-sm">Preparing secure connection panel...</p>
        </div>
      )}

      {/* ── Error state ──────────────────────────────────────────────────── */}
      {status === 'ERROR' && !showFallback && (
        <div className="flex flex-col items-center justify-center flex-1 gap-4 py-12 px-6">
          <div className="max-w-md w-full bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-sm text-red-700">
            <p className="font-semibold mb-1">Connection panel unavailable</p>
            <p className="text-red-600">{error ?? 'An unexpected error occurred.'}</p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleRetry}
              className="text-sm font-medium px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => void handleManualFallback()}
              className="text-sm font-medium px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Open in new tab instead
            </button>
          </div>
        </div>
      )}

      {/* ── CSP fallback: copy-link "Open in New Tab" ─────────────────────── */}
      {showFallback && (
        <div className="flex flex-col items-center justify-center flex-1 gap-4 py-12 px-6">
          <div className="max-w-md w-full bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-sm text-amber-800">
            <p className="font-semibold mb-1">Open in a new tab</p>
            <p>
              Your browser's security settings are blocking the embedded Airbnb
              connection panel. Click the button below to complete the process in a
              new tab — you'll be brought back here once it's done.
            </p>
          </div>

          {fallbackUrl ? (
            <a
              href={fallbackUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium px-5 py-2.5 bg-rose-500 text-white rounded-lg hover:bg-rose-600 transition-colors"
            >
              Connect Airbnb account →
            </a>
          ) : (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <div className="w-4 h-4 border-2 border-gray-200 border-t-gray-400 rounded-full animate-spin" />
              Generating link...
            </div>
          )}

          <button
            type="button"
            onClick={handleRetry}
            className="text-xs text-gray-400 underline hover:no-underline"
          >
            Try the embedded panel again
          </button>
        </div>
      )}

      {/* ── IFrame ───────────────────────────────────────────────────────── */}
      {iframeUrl && !showFallback && (status === 'RENDERING' || status === 'CONNECTED') && (
        <div className="relative flex-1 flex flex-col">
          {/* Thin loading bar while iframe is painting */}
          {status === 'RENDERING' && (
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-blue-100 overflow-hidden z-10">
              <div className="h-full bg-blue-500 animate-pulse w-2/3" />
            </div>
          )}

          {status === 'RENDERING' && (
            <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-medium">
                Having trouble loading? Open in a new tab instead.
              </p>
              <button
                type="button"
                onClick={() => void handleManualFallback()}
                className="shrink-0 rounded-lg border border-amber-300 bg-white px-4 py-2 text-xs font-semibold text-amber-900 transition hover:bg-amber-100"
              >
                Open in new tab
              </button>
            </div>
          )}

          <iframe
            key={iframeKey}
            src={iframeUrl}
            title="Connect your Airbnb account"
            className="w-full h-full min-h-[600px] border-none rounded-lg shadow-sm flex-1"
            onLoad={handleIFrameLoad}
            // onError fires for network-level failures (not always CSP blocks).
            // See handleManualFallback for the user-triggered fallback path.
            onError={() => void handleIFrameError()}
            // Sandbox permissions: allow-scripts and allow-same-origin are required
            // for the Channex OAuth flow to function. allow-popups and
            // allow-popups-to-escape-sandbox allow Airbnb's login popup.
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          />

          {/* Manual fallback escape hatch — visible after a successful paint and
              also available during rendering via the banner above. */}
          {status === 'CONNECTED' && (
            <div className="flex items-center justify-center pt-2 pb-1">
              <button
                type="button"
                onClick={() => void handleManualFallback()}
                className="text-xs text-gray-400 hover:text-gray-600 underline hover:no-underline transition-colors"
              >
                Having trouble? Open in new tab instead
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

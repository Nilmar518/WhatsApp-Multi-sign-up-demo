import { useCallback, useMemo, useState } from 'react';
import { getOneTimeToken, syncProperty } from '../api/channexApi';

interface Props {
  propertyId: string;
  tenantId: string;
  onConnected?: () => void;
}

function buildOAuthUrl(token: string, propertyId: string): string {
  const base = import.meta.env.VITE_CHANNEX_IFRAME_BASE_URL ?? 'https://staging.channex.io';

  const params = new URLSearchParams({
    oauth_session_key: token,
    app_mode: 'headless',
    redirect_to: '/channels',
    property_id: propertyId,
    channels: 'ABB',
  });

  return `${base}/auth/exchange?${params.toString()}`;
}

function openCenteredPopup(url: string) {
  const width = 800;
  const height = 700;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));

  window.open(
    url,
    'ChannexAuth',
    `popup=yes,width=${width},height=${height},left=${left},top=${top},noopener,noreferrer`,
  );
}

export default function ChannexOAuthPanel({ propertyId, tenantId, onConnected }: Props) {
  const [isOpeningPopup, setIsOpeningPopup] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isLocked = useMemo(() => isOpeningPopup || isSyncing, [isOpeningPopup, isSyncing]);

  const handleConnect = useCallback(async () => {
    setIsOpeningPopup(true);
    setError(null);
    setSuccess(null);

    try {
      const token = await getOneTimeToken(propertyId);
      const authUrl = buildOAuthUrl(token, propertyId);
      openCenteredPopup(authUrl);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to open Channex authorization window.');
    } finally {
      setIsOpeningPopup(false);
    }
  }, [propertyId]);

  const handleSync = useCallback(async () => {
    setIsSyncing(true);
    setError(null);
    setSuccess(null);

    const isSafeSyncError = (message: string): boolean => {
      const lower = message.toLowerCase();
      const hasExpectedStatus = lower.includes('422') || lower.includes('502');
      const hasSafeDuplicateSignal =
        lower.includes('already exists') ||
        lower.includes('already been taken') ||
        lower.includes('known') ||
        lower.includes('duplicate') ||
        (lower.includes('room type') && lower.includes('exist')) ||
        (lower.includes('rate plan') && lower.includes('exist'));

      return hasExpectedStatus && hasSafeDuplicateSignal;
    };

    try {
      await syncProperty(propertyId, tenantId);
      setSuccess('Listings synced successfully. Existing mappings were preserved.');
      // Firestore document is now connection_status='active'.
      // Signal the parent (AirbnbIntegration) to re-hydrate and advance the view.
      onConnected?.();
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Sync failed. Please ensure the Airbnb popup was completed and try again.';

      if (isSafeSyncError(message)) {
        console.info('[SYNC] Known sync response treated as success:', message);
        setError(null);
        setSuccess(
          'Listings are already created and known. Mapping data was kept in sync successfully.',
        );
        onConnected?.();
      } else {
        setError(message);
      }
    } finally {
      setIsSyncing(false);
    }
  }, [propertyId, tenantId, onConnected]);

  return (
    <div className="h-full w-full px-6 py-8">
      <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-600">Airbnb Connection</p>
        <h2 className="mt-2 text-2xl font-semibold text-slate-900">Connect your Airbnb Account</h2>

        <ol className="mt-4 space-y-2 text-sm leading-6 text-slate-600">
          <li>
            <span className="font-semibold text-slate-800">Step 1.</span> Click{' '}
            <span className="font-medium text-rose-600">Connect Airbnb Account</span> to open the
            secure Channex authorization popup. Complete the Airbnb login there.
          </li>
          <li>
            <span className="font-semibold text-slate-800">Step 2.</span> Return here and click{' '}
            <span className="font-medium text-emerald-600">Sync Listings &amp; Complete</span> to
            import your Airbnb listings and activate the integration.
          </li>
        </ol>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {/* Step 1 — Open Channex OAuth popup */}
          <button
            type="button"
            onClick={() => void handleConnect()}
            disabled={isLocked}
            className="inline-flex items-center justify-center rounded-xl bg-rose-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isOpeningPopup ? 'Opening secure window…' : 'Connect Airbnb Account'}
          </button>

          {/* Step 2 — Trigger auto-mapping and activate the integration */}
          <button
            type="button"
            onClick={() => void handleSync()}
            disabled={isLocked}
            className="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isSyncing ? (
              <>
                <svg
                  className="mr-2 h-4 w-4 animate-spin"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z" />
                </svg>
                Syncing listings…
              </>
            ) : (
              'Sync Listings & Complete'
            )}
          </button>
        </div>

        {error && (
          <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {success && (
          <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {success}
          </div>
        )}
      </div>
    </div>
  );
}
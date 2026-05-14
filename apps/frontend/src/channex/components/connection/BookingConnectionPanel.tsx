import { useState, useCallback, useEffect, useRef } from 'react';
import { useChannexProperties } from '../../hooks/useChannexProperties';
import {
  getBookingSessionToken,
  syncBookingListings,
  disconnectBookingChannel,
} from '../../api/channexHubApi';
import PropertyCard from '../shared/PropertyCard';
import PropertyDetail from '../shared/PropertyDetail';
import type { ChannexProperty } from '../../hooks/useChannexProperties';

interface Props {
  tenantId: string;
}

function buildPopupUrl(token: string, propertyId: string): string {
  const base =
    (import.meta as any).env?.VITE_CHANNEX_IFRAME_BASE_URL ?? 'https://staging.channex.io';
  const params = new URLSearchParams({
    oauth_session_key: token,
    app_mode: 'headless',
    redirect_to: '/channels',
    property_id: propertyId,
    channels: 'BDC',
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
    'ChannexBookingAuth',
    `popup=yes,width=${width},height=${height},left=${left},top=${top},noopener,noreferrer`,
  );
}

export default function BookingConnectionPanel({ tenantId }: Props) {
  const { properties: bookingProperties, loading } = useChannexProperties(tenantId, { source: 'booking' });
  const [selectedProperty, setSelectedProperty] = useState<ChannexProperty | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [synced, setSynced] = useState(false);
  const [isOpen, setIsOpen] = useState(true);
  const hasAutoCollapsed = useRef(false);

  const isLocked = connecting || syncing || disconnecting;

  // Auto-collapse once when properties first appear
  useEffect(() => {
    if (!loading && bookingProperties.length > 0 && !hasAutoCollapsed.current) {
      setIsOpen(false);
      hasAutoCollapsed.current = true;
    }
  }, [loading, bookingProperties.length]);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const { token, propertyId } = await getBookingSessionToken(tenantId);
      openCenteredPopup(buildPopupUrl(token, propertyId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed.');
    } finally {
      setConnecting(false);
    }
  }, [tenantId]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    setSynced(false);
    try {
      await syncBookingListings(tenantId);
      setSynced(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  }, [tenantId]);

  const handleDisconnect = useCallback(async () => {
    if (!window.confirm('Disconnect Booking.com? This will remove the channel from Channex.')) return;
    setDisconnecting(true);
    setError(null);
    try {
      await disconnectBookingChannel(tenantId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Disconnect failed.');
    } finally {
      setDisconnecting(false);
    }
  }, [tenantId]);

  if (selectedProperty) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setSelectedProperty(null)}
          className="mb-4 text-sm text-content-2 hover:text-content"
        >
          ← Back to Booking.com
        </button>
        <PropertyDetail property={selectedProperty} tenantId={tenantId} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-edge bg-surface-raised overflow-hidden">
        {/* Accordion header — always visible */}
        <button
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-3 px-6 py-4 text-left hover:bg-surface-subtle transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-notice-bg">
              <span className="text-xs font-bold text-notice-text">B</span>
            </div>
            <div>
              <h2 className="text-base font-semibold text-content">Booking.com Connection</h2>
              <p className="text-xs text-content-2">
                {bookingProperties.length > 0
                  ? `${bookingProperties.length} propert${bookingProperties.length === 1 ? 'y' : 'ies'} connected`
                  : 'Connect your Booking.com account and sync rooms via Channex.'}
              </p>
            </div>
          </div>
          <svg
            className={[
              'h-4 w-4 shrink-0 text-content-2 transition-transform duration-200',
              isOpen ? 'rotate-180' : '',
            ].join(' ')}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>

        {/* Collapsible body */}
        {isOpen && (
          <div className="border-t border-edge px-6 pb-6 pt-4">
            {error && (
              <div className="mb-4 rounded-xl border border-danger-text/20 bg-danger-bg px-4 py-3 text-sm text-danger-text">
                <span className="font-semibold">Error: </span>{error}
              </div>
            )}

            {synced && (
              <div className="mb-4 rounded-xl border border-ok-text/20 bg-ok-bg px-4 py-3 text-sm font-medium text-ok-text">
                Sync complete — rooms and rates imported from Booking.com.
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={isLocked}
                onClick={() => void handleConnect()}
                className={[
                  'inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors',
                  isLocked
                    ? 'cursor-not-allowed bg-surface-subtle text-content-3'
                    : 'bg-notice-bg text-notice-text hover:opacity-80',
                ].join(' ')}
              >
                {connecting ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-notice-text/30 border-t-notice-text" />
                    Opening…
                  </>
                ) : (
                  'Connect via Channex'
                )}
              </button>

              <button
                type="button"
                disabled={isLocked}
                onClick={() => void handleSync()}
                className={[
                  'inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors',
                  isLocked
                    ? 'cursor-not-allowed bg-surface-subtle text-content-3'
                    : 'bg-brand text-white hover:opacity-80',
                ].join(' ')}
              >
                {syncing ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Syncing…
                  </>
                ) : (
                  'Sync Rooms & Rates'
                )}
              </button>

              <button
                type="button"
                disabled={isLocked}
                onClick={() => void handleDisconnect()}
                className={[
                  'inline-flex items-center rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors',
                  isLocked
                    ? 'cursor-not-allowed bg-surface-subtle text-content-3'
                    : 'bg-danger-bg text-danger-text hover:opacity-80',
                ].join(' ')}
              >
                {disconnecting ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>
          </div>
        )}
      </div>

      {bookingProperties.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-content">
            Connected Booking.com Properties
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {bookingProperties.map((property) => (
              <PropertyCard
                key={property.firestoreDocId}
                property={property}
                onClick={setSelectedProperty}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

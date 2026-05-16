// apps/frontend/src/channex/components/connection/BookingConnectionPanel.tsx

import { useState, useCallback, useEffect, useRef } from 'react';
import { useChannexProperties } from '../../hooks/useChannexProperties';
import {
  getAirbnbSessionToken,
  syncBdcListings,
  type BdcSyncResult,
} from '../../api/channexHubApi';
import { useAllPropertyThreads } from '../../hooks/useChannexThreads';
import PropertyCard from '../shared/PropertyCard';
import PropertyDetail from '../shared/PropertyDetail';
import MessagesInbox from '../shared/MessagesInbox';
import ChannexOAuthIFrame from './ChannexOAuthIFrame';
import NoPropertyGuide from './NoPropertyGuide';
import BdcChannelSelectModal from './BdcChannelSelectModal';
import type { ChannexProperty } from '../../hooks/useChannexProperties';

interface Props {
  tenantId: string;
  onNavigateToProperties: () => void;
}

export default function BookingConnectionPanel({ tenantId, onNavigateToProperties }: Props) {
  const { properties: allProperties, loading } = useChannexProperties(tenantId);
  const { properties: bookingProperties } = useChannexProperties(tenantId, { source: 'booking' });
  const [selectedProperty, setSelectedProperty] = useState<ChannexProperty | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<BdcSyncResult | null>(null);
  const [isOpen, setIsOpen] = useState(true);
  const [showChannelModal, setShowChannelModal] = useState(false);
  const [iframeReloadToken, setIframeReloadToken] = useState(0);
  const hasAutoCollapsed = useRef(false);

  const baseProperty = allProperties[0] ?? null;
  const isLocked = syncing;
  const bookingPropertyIds = bookingProperties.map((p) => p.channex_property_id);
  const { threads: allThreads, loading: threadsLoading } = useAllPropertyThreads(tenantId, bookingPropertyIds);

  useEffect(() => {
    if (!loading && bookingProperties.length > 0 && !hasAutoCollapsed.current) {
      setIsOpen(false);
      hasAutoCollapsed.current = true;
    }
  }, [loading, bookingProperties.length]);

  const handleSyncConfirmed = useCallback(async (channelId: string) => {
    if (!baseProperty) return;
    setShowChannelModal(false);
    setSyncing(true);
    setError(null);
    setSyncResult(null);
    try {
      const result = await syncBdcListings(baseProperty.channex_property_id, tenantId, channelId);
      setSyncResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  }, [baseProperty, tenantId]);

  const handleReconnect = useCallback(() => {
    setError(null);
    setSyncResult(null);
    setIframeReloadToken((t) => t + 1);
  }, []);

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
        {/* Accordion header */}
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
            {loading && <p className="text-sm text-content-2">Loading properties…</p>}

            {!loading && !baseProperty && (
              <NoPropertyGuide channel="booking" onNavigateToProperties={onNavigateToProperties} />
            )}

            {!loading && baseProperty && (
              <>
                <ChannexOAuthIFrame
                  key={`${baseProperty.channex_property_id}-${iframeReloadToken}`}
                  propertyId={baseProperty.channex_property_id}
                  channel="BDC"
                  getToken={getAirbnbSessionToken}
                />

                {error && (
                  <div className="mt-3 rounded-xl border border-danger-text/20 bg-danger-bg px-4 py-3 text-sm text-danger-text">
                    <span className="font-semibold">Error: </span>{error}
                  </div>
                )}

                {syncResult && (
                  <div className="mt-3 rounded-xl border border-ok-text/20 bg-ok-bg px-4 py-3 text-sm font-medium text-ok-text">
                    Sync complete — {syncResult.roomTypesCreated} room type(s) and {syncResult.ratePlansCreated} rate plan(s) synced.
                  </div>
                )}

                <div className="mt-4 flex items-center justify-between border-t border-edge pt-4">
                  <button
                    type="button"
                    onClick={handleReconnect}
                    className="text-sm text-content-3 underline hover:no-underline"
                  >
                    Reconnect Booking.com
                  </button>
                  <button
                    type="button"
                    disabled={isLocked}
                    onClick={() => setShowChannelModal(true)}
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
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {showChannelModal && (
        <BdcChannelSelectModal
          tenantId={tenantId}
          onConfirm={handleSyncConfirmed}
          onClose={() => setShowChannelModal(false)}
        />
      )}

      {bookingProperties.length > 0 && (
        <>
          <div>
            <h3 className="mb-3 text-sm font-semibold text-content">Messages</h3>
            <MessagesInbox
              tenantId={tenantId}
              threads={allThreads}
              loading={threadsLoading}
            />
          </div>
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
        </>
      )}
    </div>
  );
}

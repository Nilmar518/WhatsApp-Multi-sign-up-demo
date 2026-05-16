import { useState, useCallback, useEffect, useRef } from 'react';
import { useChannexProperties } from '../../hooks/useChannexProperties';
import { syncAirbnbListings, getAirbnbSessionToken, type IsolatedSyncResult } from '../../api/channexHubApi';
import { useAllPropertyThreads } from '../../hooks/useChannexThreads';
import ChannexOAuthIFrame from './ChannexOAuthIFrame';
import NoPropertyGuide from './NoPropertyGuide';
import PropertyCard from '../shared/PropertyCard';
import PropertyDetail from '../shared/PropertyDetail';
import MessagesInbox from '../shared/MessagesInbox';
import type { ChannexProperty } from '../../hooks/useChannexProperties';

interface Props {
  tenantId: string;
  onNavigateToProperties: () => void;
}

export default function AirbnbConnectionPanel({ tenantId, onNavigateToProperties }: Props) {
  const { properties: allProperties, loading } = useChannexProperties(tenantId);
  const { properties: airbnbProperties } = useChannexProperties(tenantId, { source: 'airbnb' });

  const [syncResult, setSyncResult] = useState<IsolatedSyncResult | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [iframeReloadToken, setIframeReloadToken] = useState(0);
  const [selectedProperty, setSelectedProperty] = useState<ChannexProperty | null>(null);
  const [isOpen, setIsOpen] = useState(true);
  const hasAutoCollapsed = useRef(false);

  const baseProperty = allProperties[0] ?? null;
  const airbnbPropertyIds = airbnbProperties.map((p) => p.channex_property_id);
  const { threads: allThreads, loading: threadsLoading } = useAllPropertyThreads(tenantId, airbnbPropertyIds);

  // Auto-collapse once when properties first appear
  useEffect(() => {
    if (!loading && airbnbProperties.length > 0 && !hasAutoCollapsed.current) {
      setIsOpen(false);
      hasAutoCollapsed.current = true;
    }
  }, [loading, airbnbProperties.length]);

  const handleSync = useCallback(async () => {
    if (!baseProperty) return;
    setSyncing(true);
    setSyncError(null);
    setSyncResult(null);
    try {
      const result = await syncAirbnbListings(baseProperty.channex_property_id, tenantId);
      setSyncResult(result);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Sync failed. Please try again.');
    } finally {
      setSyncing(false);
    }
  }, [baseProperty, tenantId]);

  const handleReconnect = useCallback(() => {
    setSyncResult(null);
    setSyncError(null);
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
          ← Back to Airbnb
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
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-500">
              <span className="text-xs font-bold text-white">A</span>
            </div>
            <div>
              <h2 className="text-base font-semibold text-content">Airbnb Connection</h2>
              <p className="text-xs text-content-2">
                {airbnbProperties.length > 0
                  ? `${airbnbProperties.length} propert${airbnbProperties.length === 1 ? 'y' : 'ies'} connected`
                  : 'Connect your Airbnb account and sync listings to Channex.'}
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
              <NoPropertyGuide channel="airbnb" onNavigateToProperties={onNavigateToProperties} />
            )}

            {!loading && baseProperty && (
              <>
                <ChannexOAuthIFrame
                  key={`${baseProperty.channex_property_id}-${iframeReloadToken}`}
                  propertyId={baseProperty.channex_property_id}
                  channel="ABB"
                  getToken={getAirbnbSessionToken}
                />

                {syncError && (
                  <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    <span className="font-semibold">Error: </span>{syncError}
                  </div>
                )}

                {syncResult && (
                  <div
                    className={[
                      'mt-3 rounded-xl border px-4 py-3 text-sm',
                      syncResult.failed.length === 0
                        ? 'border-green-200 bg-green-50 text-green-800'
                        : 'border-yellow-200 bg-yellow-50 text-yellow-800',
                    ].join(' ')}
                  >
                    <p className="font-semibold">
                      {syncResult.succeeded.length}{' '}
                      {syncResult.succeeded.length === 1 ? 'property' : 'properties'} synced
                      {syncResult.failed.length > 0 && `, ${syncResult.failed.length} failed`}
                    </p>
                    {syncResult.succeeded.map((s) => (
                      <p key={s.channexPropertyId} className="mt-0.5">• {s.listingTitle}</p>
                    ))}
                    {syncResult.failed.map((f) => (
                      <p key={f.listingId} className="mt-0.5 text-red-700">
                        • {f.listingTitle}: {f.reason} (step {f.step})
                      </p>
                    ))}
                  </div>
                )}

                <div className="mt-4 flex items-center justify-between border-t border-edge pt-4">
                  <button
                    type="button"
                    onClick={handleReconnect}
                    className="text-sm text-content-3 underline hover:no-underline"
                  >
                    Reconnect Airbnb
                  </button>
                  <button
                    type="button"
                    disabled={syncing}
                    onClick={() => void handleSync()}
                    className={[
                      'inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors',
                      syncing
                        ? 'cursor-not-allowed bg-surface-subtle text-content-3'
                        : 'bg-rose-600 text-white hover:bg-rose-700',
                    ].join(' ')}
                  >
                    {syncing ? (
                      <>
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-rose-200 border-t-white" />
                        Syncing listings…
                      </>
                    ) : (
                      'Sync Listings'
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {airbnbProperties.length > 0 && (
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
            <h3 className="mb-3 text-sm font-semibold text-content">Connected Airbnb Properties</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {airbnbProperties.map((property) => (
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

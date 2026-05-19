// apps/frontend/src/channex/components/connection/BookingConnectionPanel.tsx

import { useState, useCallback, useEffect, useRef } from 'react';
import { useLanguage } from '../../../context/LanguageContext';
import { useChannexProperties } from '../../hooks/useChannexProperties';
import {
  getAirbnbSessionToken,
  syncBdcListings,
  getBdcPreview,
  type BdcSyncResult,
  type ListingPreviewProperty,
  type SyncNameOverrides,
} from '../../api/channexHubApi';
import { useAllPropertyThreads } from '../../hooks/useChannexThreads';
import PropertyCard from '../shared/PropertyCard';
import PropertyDetail from '../shared/PropertyDetail';
import MessagesInbox from '../shared/MessagesInbox';
import ChannexOAuthIFrame from './ChannexOAuthIFrame';
import ChannelManagementPanel from './ChannelManagementPanel';
import NoPropertyGuide from './NoPropertyGuide';
import BdcChannelSelectModal from './BdcChannelSelectModal';
import SyncNamingModal from './SyncNamingModal';
import type { ChannexProperty } from '../../hooks/useChannexProperties';

type SyncStep = 'idle' | 'channelSelect' | 'loadingPreview' | 'naming' | 'syncing';

interface Props {
  tenantId: string;
  onNavigateToProperties: () => void;
}

export default function BookingConnectionPanel({ tenantId, onNavigateToProperties }: Props) {
  const { t } = useLanguage();
  const { properties: allProperties, loading } = useChannexProperties(tenantId);
  const { properties: bookingProperties } = useChannexProperties(tenantId, { source: 'booking' });
  const [selectedProperty, setSelectedProperty] = useState<ChannexProperty | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<BdcSyncResult | null>(null);
  const [isOpen, setIsOpen] = useState(true);
  const [syncStep, setSyncStep] = useState<SyncStep>('idle');
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ListingPreviewProperty[] | null>(null);
  const [iframeReloadToken, setIframeReloadToken] = useState(0);
  const hasAutoCollapsed = useRef(false);

  const baseProperty = allProperties[0] ?? null;
  const bookingPropertyIds = bookingProperties.map((p) => p.channex_property_id);
  const { threads: allThreads, loading: threadsLoading } = useAllPropertyThreads(tenantId, bookingPropertyIds);

  useEffect(() => {
    if (!loading && bookingProperties.length > 0 && !hasAutoCollapsed.current) {
      setIsOpen(false);
      hasAutoCollapsed.current = true;
    }
  }, [loading, bookingProperties.length]);

  const handleChannelSelected = useCallback(async (channelId: string) => {
    if (!baseProperty) return;
    setSelectedChannelId(channelId);
    setSyncStep('loadingPreview');
    setPreviewError(null);
    try {
      const data = await getBdcPreview(baseProperty.channex_property_id, tenantId, channelId);
      setPreview(data);
      setSyncStep('naming');
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : t('channex.bdcConn.err.preview'));
      setSyncStep('idle');
    }
  }, [baseProperty, tenantId]);

  const handleNamingConfirmed = useCallback(async (nameOverrides: SyncNameOverrides) => {
    if (!baseProperty || !selectedChannelId) return;
    setSyncStep('syncing');
    setError(null);
    setSyncResult(null);
    try {
      const result = await syncBdcListings(
        baseProperty.channex_property_id,
        tenantId,
        selectedChannelId,
        nameOverrides,
      );
      setSyncResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('channex.bdcConn.err.sync'));
    } finally {
      setSyncStep('idle');
    }
  }, [baseProperty, tenantId, selectedChannelId]);

  const handleReconnect = useCallback(() => {
    setError(null);
    setSyncResult(null);
    setIframeReloadToken((t) => t + 1);
  }, []);

  const handleCloseModals = useCallback(() => {
    setSyncStep('idle');
    setPreview(null);
    setSelectedChannelId(null);
  }, []);

  const syncing = syncStep === 'syncing';

  if (selectedProperty) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setSelectedProperty(null)}
          className="mb-4 text-sm text-content-2 hover:text-content"
        >
          {t('channex.bdcConn.back')}
        </button>
        <PropertyDetail property={selectedProperty} tenantId={tenantId} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
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
              <h2 className="text-base font-semibold text-content">{t('channex.bdcConn.title')}</h2>
              <p className="text-xs text-content-2">
                {bookingProperties.length > 0
                  ? t(bookingProperties.length === 1 ? 'channex.bdcConn.prop.one' : 'channex.bdcConn.prop.many', { n: bookingProperties.length })
                  : t('channex.bdcConn.desc')}
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
            {loading && <p className="text-sm text-content-2">{t('channex.bdcConn.loadingProps')}</p>}

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

                {previewError && (
                  <div className="mt-3 rounded-xl border border-danger-text/20 bg-danger-bg px-4 py-3 text-sm text-danger-text">
                    {t('channex.bdcConn.previewErr', { error: previewError })}
                  </div>
                )}

                {error && (
                  <div className="mt-3 rounded-xl border border-danger-text/20 bg-danger-bg px-4 py-3 text-sm text-danger-text">
                    {t('channex.bdcConn.err', { error })}
                  </div>
                )}

                {syncResult && (
                  <div
                    className={[
                      'mt-3 rounded-xl border px-4 py-3 text-sm',
                      syncResult.failed.length === 0
                        ? 'border-ok-text/20 bg-ok-bg text-ok-text'
                        : 'border-yellow-200 bg-yellow-50 text-yellow-800',
                    ].join(' ')}
                  >
                    <p className="font-semibold">
                      {t(syncResult.succeeded.length === 1 ? 'channex.bdcConn.synced.one' : 'channex.bdcConn.synced.many', { n: syncResult.succeeded.length })}
                      {syncResult.failed.length > 0 && `, ${syncResult.failed.length} ${t('channex.bdcConn.failed')}`}
                    </p>
                    {syncResult.succeeded.map((s) => (
                      <p key={s.channexPropertyId} className="mt-0.5">• {s.otaRoomTitle}</p>
                    ))}
                    {syncResult.failed.map((f) => (
                      <p key={f.otaRoomId} className="mt-0.5 text-red-700">
                        • {f.otaRoomTitle}: {f.reason} (step {f.step})
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
                    {t('channex.bdcConn.reconnect')}
                  </button>
                  <button
                    type="button"
                    disabled={syncing || syncStep === 'loadingPreview'}
                    onClick={() => setSyncStep('channelSelect')}
                    className={[
                      'inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors',
                      syncing || syncStep === 'loadingPreview'
                        ? 'cursor-not-allowed bg-surface-subtle text-content-3'
                        : 'bg-brand text-white hover:opacity-80',
                    ].join(' ')}
                  >
                    {syncing ? (
                      <>
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        {t('channex.bdcConn.syncing')}
                      </>
                    ) : syncStep === 'loadingPreview' ? (
                      <>
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-content-3 border-t-content-2" />
                        {t('channex.bdcConn.loadingPreview')}
                      </>
                    ) : (
                      t('channex.bdcConn.sync')
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <ChannelManagementPanel tenantId={tenantId} />
      </div>

      {syncStep === 'channelSelect' && (
        <BdcChannelSelectModal
          tenantId={tenantId}
          channelType="booking"
          onConfirm={(channelId) => void handleChannelSelected(channelId)}
          onClose={handleCloseModals}
        />
      )}

      {syncStep === 'naming' && preview && (
        <SyncNamingModal
          preview={preview}
          onConfirm={(overrides) => void handleNamingConfirmed(overrides)}
          onClose={handleCloseModals}
        />
      )}

      {bookingProperties.length > 0 && (
        <>
          <div>
            <h3 className="mb-3 text-sm font-semibold text-content">{t('channex.bdcConn.messages')}</h3>
            <MessagesInbox
              tenantId={tenantId}
              threads={allThreads}
              loading={threadsLoading}
            />
          </div>
          <div>
            <h3 className="mb-3 text-sm font-semibold text-content">
              {t('channex.bdcConn.connectedProps')}
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

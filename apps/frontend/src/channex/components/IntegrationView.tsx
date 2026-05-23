import { useState, useMemo, useEffect, useCallback } from 'react';
import { useChannexProperties } from '../hooks/useChannexProperties';
import { useAllPropertyThreads } from '../hooks/useChannexThreads';
import { getPropertyBookings } from '../api/channexHubApi';
import PropertiesList from './PropertiesList';
import PropertyDetail from './shared/PropertyDetail';
import AggregatedReservationsPanel from './shared/AggregatedReservationsPanel';
import MessagesInbox from './shared/MessagesInbox';
import BookingConnectionPanel from './connection/BookingConnectionPanel';
import AirbnbConnectionPanel from './connection/AirbnbConnectionPanel';
import type { ChannexProperty } from '../hooks/useChannexProperties';
import { useLanguage } from '../../context/LanguageContext';
import Button from '../../components/ui/Button';

type IntegrationTab = 'properties' | 'reservations' | 'messages' | 'settings';

interface Props {
  tenantId: string;
  source: 'airbnb' | 'booking';
  onNavigateToProperties: () => void;
}

const today = new Date().toISOString().split('T')[0];

export default function IntegrationView({ tenantId, source, onNavigateToProperties }: Props) {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<IntegrationTab>('properties');
  const [selectedProperty, setSelectedProperty] = useState<ChannexProperty | null>(null);
  const [threadPropertyFilter, setThreadPropertyFilter] = useState('');
  const [threadFrom, setThreadFrom] = useState(today);
  const [threadTo, setThreadTo] = useState(today);
  const [activeThreadFrom, setActiveThreadFrom] = useState(today);
  const [activeThreadTo, setActiveThreadTo] = useState(today);
  const [bookingIdsInRange, setBookingIdsInRange] = useState<Set<string> | null>(null);
  const [loadingBookingIds, setLoadingBookingIds] = useState(false);

  const { properties, loading: propsLoading, error: propsError } =
    useChannexProperties(tenantId, { source });
  const propertyIds = properties.map((p) => p.channex_property_id);
  const { threads, loading: threadsLoading } = useAllPropertyThreads(tenantId, propertyIds);

  const TABS = useMemo<{ id: IntegrationTab; label: string }[]>(() => [
    { id: 'properties',   label: t('channex.integration.tab.properties') },
    { id: 'reservations', label: t('channex.integration.tab.reservations') },
    { id: 'messages',     label: t('channex.integration.tab.messages') },
    { id: 'settings',     label: t('channex.integration.tab.settings') },
  ], [t]);

  const propertyTitleById = Object.fromEntries(
    properties.map((p) => [p.channex_property_id, p.title]),
  );

  const filteredThreads = threads.filter((th) => {
    if (threadPropertyFilter && th.propertyId !== threadPropertyFilter) return false;
    if (bookingIdsInRange === null) return true;
    // Booking threads: check if their bookingId is in the fetched range
    if (th.bookingId) return bookingIdsInRange.has(th.bookingId);
    // Inquiry threads: filter by stored checkinDate
    if (th.checkinDate) {
      const date = th.checkinDate.slice(0, 10);
      return (!activeThreadFrom || date >= activeThreadFrom) && (!activeThreadTo || date <= activeThreadTo);
    }
    return false;
  });

  const hasThreadFilters = !!(threadPropertyFilter || activeThreadFrom !== today || activeThreadTo !== today);

  const fetchBookingIds = useCallback(async (from: string, to: string) => {
    if (!properties.length) return;
    setLoadingBookingIds(true);
    try {
      const results = await Promise.allSettled(
        properties.map((p) => getPropertyBookings(p.channex_property_id, tenantId, 1000, from, to)),
      );
      const ids = new Set<string>();
      for (const r of results) {
        if (r.status === 'fulfilled') {
          for (const b of r.value.bookings) {
            if (b.channex_booking_id) ids.add(b.channex_booking_id);
          }
        }
      }
      setBookingIdsInRange(ids);
    } finally {
      setLoadingBookingIds(false);
    }
  }, [properties, tenantId]);

  // Auto-load today's booking IDs when the messages tab opens
  useEffect(() => {
    if (activeTab === 'messages' && properties.length > 0 && bookingIdsInRange === null) {
      void fetchBookingIds(today, today);
    }
  }, [activeTab, properties, bookingIdsInRange, fetchBookingIds]);

  function handleApplyThreadFilters() {
    setActiveThreadFrom(threadFrom);
    setActiveThreadTo(threadTo);
    void fetchBookingIds(threadFrom, threadTo);
  }

  function handleClearThreadFilters() {
    setThreadPropertyFilter('');
    setThreadFrom(today);
    setThreadTo(today);
    setActiveThreadFrom(today);
    setActiveThreadTo(today);
    setBookingIdsInRange(null);
  }

  function handleTabChange(tab: IntegrationTab) {
    setActiveTab(tab);
    setSelectedProperty(null);
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-edge bg-surface-raised shadow-sm">
      {/* Tab bar */}
      <div className="flex items-end border-b border-edge px-3 sm:px-6">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => handleTabChange(tab.id)}
            className={[
              'flex-1 text-center px-1 sm:px-4 py-2.5 text-xs sm:text-sm font-medium border-b-2 -mb-px transition-colors truncate',
              activeTab === tab.id
                ? 'border-brand-light text-brand bg-surface-raised'
                : 'border-transparent text-content-2 hover:text-content hover:border-edge',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {/* Tab 1 — Propiedades */}
        {activeTab === 'properties' && (
          <div className="px-3 py-4 sm:px-6 sm:py-6">
            {selectedProperty ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => setSelectedProperty(null)}
                  className="mb-4"
                >
                  {t('channex.hub.backToProps')}
                </Button>
                <PropertyDetail property={selectedProperty} tenantId={tenantId} />
              </>
            ) : (
              <>
                {propsLoading && (
                  <p className="text-sm text-content-2">{t('channex.hub.loadingProps')}</p>
                )}
                {propsError && <p className="text-sm text-danger-text">{propsError}</p>}
                {!propsLoading && !propsError && (
                  <PropertiesList
                    properties={properties}
                    onSelect={setSelectedProperty}
                    onNew={() => {}}
                  />
                )}
              </>
            )}
          </div>
        )}

        {/* Tab 2 — Reservas */}
        {activeTab === 'reservations' && (
          <AggregatedReservationsPanel tenantId={tenantId} properties={properties} />
        )}

        {/* Tab 3 — Mensajes */}
        {activeTab === 'messages' && (
          <div className="flex flex-col h-full">
            <div className="flex flex-col gap-3 px-3 py-3 sm:px-6 sm:flex-row sm:flex-wrap sm:items-center border-b border-edge">
              {/* Property filter */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-content-2 uppercase tracking-wider shrink-0">
                  {t('channex.integration.filter.property')}
                </span>
                <select
                  value={threadPropertyFilter}
                  onChange={(e) => setThreadPropertyFilter(e.target.value)}
                  className="flex-1 sm:flex-none min-w-0 bg-surface border border-edge rounded-md text-sm text-content px-2 py-1 outline-none focus:border-brand"
                >
                  <option value="">{t('channex.integration.filter.allProps')}</option>
                  {properties.map((p) => (
                    <option key={p.channex_property_id} value={p.channex_property_id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </div>

              {/* Date range filter */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-content-2 uppercase tracking-wider shrink-0">
                    {t('channex.integration.filter.from')}
                  </span>
                  <input
                    type="date"
                    value={threadFrom}
                    onChange={(e) => setThreadFrom(e.target.value)}
                    className="bg-surface border border-edge rounded-md text-sm text-content px-2 py-1 outline-none focus:border-brand"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-content-2 uppercase tracking-wider shrink-0">
                    {t('channex.integration.filter.to')}
                  </span>
                  <input
                    type="date"
                    value={threadTo}
                    onChange={(e) => setThreadTo(e.target.value)}
                    className="bg-surface border border-edge rounded-md text-sm text-content px-2 py-1 outline-none focus:border-brand"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 self-start sm:self-auto sm:ml-auto">
                {hasThreadFilters && (
                  <button
                    type="button"
                    onClick={handleClearThreadFilters}
                    className="text-xs text-content-2 hover:text-content underline"
                  >
                    {t('channex.integration.filter.clear')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleApplyThreadFilters}
                  disabled={loadingBookingIds}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-brand text-white hover:bg-brand/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loadingBookingIds ? '…' : 'Aplicar'}
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto px-3 py-4 sm:px-6">
              <MessagesInbox
                tenantId={tenantId}
                threads={filteredThreads}
                loading={threadsLoading}
                propertyTitleById={threadPropertyFilter ? undefined : propertyTitleById}
              />
            </div>
          </div>
        )}

        {/* Tab 4 — Configuración */}
        {activeTab === 'settings' && (
          <div className="px-3 py-4 sm:px-6 sm:py-6">
            {source === 'booking' ? (
              <BookingConnectionPanel
                tenantId={tenantId}
                onNavigateToProperties={onNavigateToProperties}
                configOnly
              />
            ) : (
              <AirbnbConnectionPanel
                tenantId={tenantId}
                onNavigateToProperties={onNavigateToProperties}
                configOnly
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

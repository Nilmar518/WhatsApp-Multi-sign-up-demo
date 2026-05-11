import { useState } from 'react';
import AirbnbIntegration from '../integrations/airbnb/AirbnbIntegration';
import BookingIntegrationView from '../integrations/booking/BookingIntegrationView';
import { useChannexProperties } from './hooks/useChannexProperties';
import PropertiesList from './components/PropertiesList';
import PropertyDetail from './components/PropertyDetail';
import PropertySetupWizard from './components/PropertySetupWizard';
import type { ChannexProperty } from './hooks/useChannexProperties';

type SubTab = 'properties' | 'airbnb' | 'booking';

interface Props {
  businessId: string;
}

export default function ChannexHub({ businessId }: Props) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('properties');
  const [showWizard, setShowWizard] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<ChannexProperty | null>(null);

  const [forcedChannels, setForcedChannels] = useState<Set<SubTab>>(new Set());
  const [showConnectDropdown, setShowConnectDropdown] = useState(false);

  const { properties, loading, error } = useChannexProperties(businessId);

  const hasAirbnb = properties.some((p) => p.connected_channels.includes('airbnb') || p.connection_status === 'active');
  const hasBooking = properties.some((p) => p.connected_channels.includes('booking'));

  const subTabs: { id: SubTab; label: string }[] = [
    { id: 'properties', label: 'Properties' },
    ...(hasAirbnb || forcedChannels.has('airbnb') ? [{ id: 'airbnb' as SubTab, label: 'Airbnb' }] : []),
    ...(hasBooking || forcedChannels.has('booking') ? [{ id: 'booking' as SubTab, label: 'Booking.com' }] : []),
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="border-b border-gray-200 px-6 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">
          Channex Channel Manager
        </p>
        <h1 className="text-lg font-semibold text-gray-900">Migo UIT · Property Hub</h1>
      </div>

      {/* Sub-tab bar */}
      <div className="flex items-end gap-0 border-b border-gray-200 px-6">
        {subTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveSubTab(tab.id)}
            className={[
              'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeSubTab === tab.id
                ? 'border-indigo-500 text-indigo-700 bg-white'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}

        {/* "+" Connect integration button */}
        <div className="relative ml-auto flex items-center py-1.5">
          <button
            type="button"
            onClick={() => setShowConnectDropdown((v) => !v)}
            className="flex items-center gap-1 rounded-lg border border-dashed border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-500 hover:border-indigo-400 hover:text-indigo-600 transition-colors"
          >
            + Connect
          </button>

          {showConnectDropdown && (
            <>
              {/* Transparent backdrop — closes dropdown on outside click */}
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowConnectDropdown(false)}
              />
              <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                {([
                  { id: 'airbnb' as SubTab, label: 'Airbnb', icon: '🏠' },
                  { id: 'booking' as SubTab, label: 'Booking.com', icon: '🏨' },
                ] as const).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setForcedChannels((prev) => new Set([...prev, opt.id]));
                      setActiveSubTab(opt.id);
                      setShowConnectDropdown(false);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <span>{opt.icon}</span>
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {activeSubTab === 'properties' && (
          <>
            {showWizard ? (
              <div className="px-6 py-6">
                <PropertySetupWizard
                  tenantId={businessId}
                  onComplete={(prop) => {
                    setShowWizard(false);
                    setSelectedProperty(prop);
                  }}
                  onCancel={() => setShowWizard(false)}
                />
              </div>
            ) : selectedProperty ? (
              <div className="px-6 py-6">
                <button
                  type="button"
                  onClick={() => setSelectedProperty(null)}
                  className="mb-4 text-sm text-indigo-600 hover:text-indigo-800"
                >
                  ← Back to properties
                </button>
                <PropertyDetail property={selectedProperty} tenantId={businessId} />
              </div>
            ) : (
              <div className="px-6 py-6">
                {loading && (
                  <p className="text-sm text-gray-500">Loading properties…</p>
                )}
                {error && (
                  <p className="text-sm text-red-600">{error}</p>
                )}
                {!loading && !error && (
                  <PropertiesList
                    properties={properties}
                    onSelect={(prop) => setSelectedProperty(prop)}
                    onNew={() => setShowWizard(true)}
                  />
                )}
              </div>
            )}
          </>
        )}

        {activeSubTab === 'airbnb' && (
          <div className="h-full">
            <AirbnbIntegration businessId={businessId} />
          </div>
        )}

        {activeSubTab === 'booking' && (
          <div className="h-full">
            <BookingIntegrationView businessId={businessId} />
          </div>
        )}
      </div>
    </div>
  );
}

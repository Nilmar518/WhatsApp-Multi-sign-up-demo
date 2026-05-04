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

  const { properties, loading, error } = useChannexProperties(businessId);

  const hasAirbnb = properties.some((p) => p.connected_channels.includes('airbnb') || p.connection_status === 'active');
  const hasBooking = properties.some((p) => p.connected_channels.includes('booking'));

  const subTabs: { id: SubTab; label: string }[] = [
    { id: 'properties', label: 'Properties' },
    ...(hasAirbnb ? [{ id: 'airbnb' as SubTab, label: 'Airbnb' }] : []),
    ...(hasBooking ? [{ id: 'booking' as SubTab, label: 'Booking.com' }] : []),
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
                <PropertyDetail property={selectedProperty} />
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
            <AirbnbIntegration />
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

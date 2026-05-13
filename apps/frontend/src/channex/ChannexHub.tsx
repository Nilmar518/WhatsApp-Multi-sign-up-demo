import { useState, useEffect } from 'react';
import AirbnbIntegration from '../integrations/airbnb/AirbnbIntegration';
import BookingIntegrationView from '../integrations/booking/BookingIntegrationView';
import { useChannexProperties } from './hooks/useChannexProperties';
import PropertiesList from './components/PropertiesList';
import PropertyDetail from './components/PropertyDetail';
import PropertySetupWizard from './components/PropertySetupWizard';
import type { ChannexProperty } from './hooks/useChannexProperties';
import Button from '../components/ui/Button';
import { useLanguage } from '../context/LanguageContext';

type SubTab = 'properties' | 'airbnb' | 'booking';

interface Props {
  businessId: string;
  initialTab?: SubTab;
}

export default function ChannexHub({ businessId, initialTab = 'properties' }: Props) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>(initialTab);
  const [showWizard, setShowWizard] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<ChannexProperty | null>(null);
  const { t } = useLanguage();

  const SUB_TABS: { id: SubTab; label: string }[] = [
    { id: 'properties', label: t('channex.tab.properties') },
    { id: 'airbnb',     label: t('channex.tab.airbnb') },
    { id: 'booking',    label: t('channex.tab.booking') },
  ];

  // Sync active tab when the parent navigates to a different channex sub-route
  useEffect(() => {
    setActiveSubTab(initialTab);
  }, [initialTab]);

  const { properties, loading, error } = useChannexProperties(businessId);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-edge bg-surface-raised shadow-sm">
      {/* Header */}
      <div className="border-b border-edge px-6 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-content-2">
          {t('channex.manager')}
        </p>
        <h1 className="text-lg font-semibold text-content">{t('channex.propertyHub')}</h1>
      </div>

      {/* Sub-tab bar */}
      <div className="flex items-end gap-0 border-b border-edge px-6">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveSubTab(tab.id)}
            className={[
              'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeSubTab === tab.id
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
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => setSelectedProperty(null)}
                  className="mb-4"
                >
                  ← Back to properties
                </Button>
                <PropertyDetail property={selectedProperty} tenantId={businessId} />
              </div>
            ) : (
              <div className="px-6 py-6">
                {loading && (
                  <p className="text-sm text-content-2">Loading properties…</p>
                )}
                {error && (
                  <p className="text-sm text-danger-text">{error}</p>
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

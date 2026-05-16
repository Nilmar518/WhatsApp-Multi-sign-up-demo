import { useState, useEffect } from 'react';
import AirbnbConnectionPanel from './components/connection/AirbnbConnectionPanel';
import BookingConnectionPanel from './components/connection/BookingConnectionPanel';
import { useChannexProperties } from './hooks/useChannexProperties';
import PropertiesList from './components/PropertiesList';
import PropertyDetail from './components/shared/PropertyDetail';
import PropertySetupWizard from './components/PropertySetupWizard';
import type { ChannexProperty } from './hooks/useChannexProperties';
import Button from '../components/ui/Button';
import { useLanguage } from '../context/LanguageContext';
import { useMigoProperties } from './hooks/useMigoProperties';
import PoolsList from './components/pools/PoolsList';
import PoolDetail from './components/pools/PoolDetail';
import PoolCreateForm from './components/pools/PoolCreateForm';
import PoolEditModal from './components/pools/PoolEditModal';
import type { MigoProperty } from './api/migoPropertyApi';

type SubTab = 'properties' | 'airbnb' | 'booking' | 'pools';

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
    { id: 'pools',      label: t('channex.tab.pools') },
  ];

  // Sync active tab when the parent navigates to a different channex sub-route
  useEffect(() => {
    setActiveSubTab(initialTab);
  }, [initialTab]);

  const { properties, loading, error } = useChannexProperties(businessId);
  const { pools, loading: poolsLoading, error: poolsError } = useMigoProperties(businessId);
  const [showPoolCreate, setShowPoolCreate] = useState(false);
  const [selectedPool, setSelectedPool] = useState<MigoProperty | null>(null);
  const [editingPool, setEditingPool] = useState<MigoProperty | null>(null);

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
          <div className="px-6 py-6">
            <AirbnbConnectionPanel
              tenantId={businessId}
              onNavigateToProperties={() => setActiveSubTab('properties')}
            />
          </div>
        )}

        {activeSubTab === 'booking' && (
          <div className="px-6 py-6">
            <BookingConnectionPanel
              tenantId={businessId}
              onNavigateToProperties={() => setActiveSubTab('properties')}
            />
          </div>
        )}

        {activeSubTab === 'pools' && (
          <div className="px-6 py-6">
            {showPoolCreate ? (
              <PoolCreateForm
                tenantId={businessId}
                onCreated={(pool) => {
                  setShowPoolCreate(false);
                  setSelectedPool(pool);
                }}
                onCancel={() => setShowPoolCreate(false)}
              />
            ) : selectedPool ? (
              <PoolDetail
                pool={selectedPool}
                tenantId={businessId}
                onBack={() => setSelectedPool(null)}
                onUpdated={(updated) => setSelectedPool(updated)}
              />
            ) : (
              <>
                {poolsLoading && <p className="text-sm text-content-2">Loading pools…</p>}
                {poolsError && <p className="text-sm text-danger-text">{poolsError}</p>}
                {!poolsLoading && !poolsError && (
                  <PoolsList
                    pools={pools}
                    onSelect={(pool) => setSelectedPool(pool)}
                    onNew={() => setShowPoolCreate(true)}
                    onEdit={(pool) => setEditingPool(pool)}
                  />
                )}
              </>
            )}
          </div>
        )}
      </div>

      {editingPool && (
        <PoolEditModal
          pool={editingPool}
          onSaved={(updated) => {
            setEditingPool(null);
            if (selectedPool?.id === updated.id) setSelectedPool(updated);
          }}
          onClose={() => setEditingPool(null)}
        />
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import {
  AirbnbSidebar,
  ChannexOAuthPanel,
  DetailedReservationsView,
  InboxView,
  InventoryView,
  PropertyProvisioningForm,
} from './components';

type IntegrationState = 'loading' | 'unprovisioned' | 'connecting' | 'connected' | 'error';
type ActiveView = 'inbox' | 'inventory' | 'reservations' | 'settings';

type ConnectionStatus = 'pending' | 'active' | 'token_expired' | 'error';

interface TenantIntegrationDoc {
  channex_property_id?: string;
  channex_channel_id?: string;
  connection_status?: ConnectionStatus;
}

/** A single synced Airbnb listing — one doc in `properties/` subcollection. */
export interface ActiveProperty {
  channex_property_id: string;
  channex_channel_id: string;
  channex_room_type_id: string;
  channex_rate_plan_id: string;
  airbnb_listing_id: string;
  title: string;
  default_price: number | null;
  currency: string | null;
  capacity: number | null;
}


function PlaceholderPanel({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <div className="rounded-full bg-rose-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-rose-600">
        Airbnb
      </div>
      <h3 className="text-xl font-semibold text-gray-900">{title}</h3>
      <p className="max-w-md text-sm leading-6 text-gray-500">{description}</p>
    </div>
  );
}

export default function AirbnbIntegration({ businessId }: { businessId: string }) {
  const [integrationState, setIntegrationState] = useState<IntegrationState>('loading');
  const [hydrationError, setHydrationError] = useState<string | null>(null);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus | undefined>(undefined);
  const [properties, setProperties] = useState<ActiveProperty[]>([]);
  const [activeProperty, setActiveProperty] = useState<ActiveProperty | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>('inbox');
  const [firestoreDocId, setFirestoreDocId] = useState<string | null>(null);
  const [hydrateNonce, setHydrateNonce] = useState(0);

  const tenantId = businessId;

  // ── Subscribe to parent integration document ────────────────────────────────
  useEffect(() => {
    setIntegrationState('loading');
    setHydrationError(null);

    const docRef = doc(db, 'channex_integrations', tenantId);

    const unsubscribe = onSnapshot(
      docRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setPropertyId(null);
          setConnectionStatus(undefined);
          setFirestoreDocId(null);
          setIntegrationState('unprovisioned');
          return;
        }

        const data = snapshot.data() as TenantIntegrationDoc;
        const resolvedPropertyId = data.channex_property_id ?? null;
        const nextConnectionStatus = data.connection_status;

        if (!resolvedPropertyId) {
          setPropertyId(null);
          setConnectionStatus(undefined);
          setFirestoreDocId(null);
          setIntegrationState('unprovisioned');
          return;
        }

        setFirestoreDocId(snapshot.id);
        setPropertyId(resolvedPropertyId);
        setConnectionStatus(nextConnectionStatus);

        // If a channex_property_id exists but connection_status is missing,
        // treat it as 'connecting' (we have a provisioned property to connect).
        if (nextConnectionStatus === 'active') {
          setIntegrationState('connected');
        } else {
          setIntegrationState('connecting');
        }
      },
      (error) => {
        setPropertyId(null);
        setConnectionStatus(undefined);
        setFirestoreDocId(null);
        setIntegrationState('error');
        setHydrationError(error.message);
      },
    );

    return () => unsubscribe();
  }, [hydrateNonce, tenantId]);

  // ── Subscribe to properties subcollection (1:1 model) ──────────────────────
  useEffect(() => {
    if (!firestoreDocId) {
      setProperties([]);
      setActiveProperty(null);
      return;
    }

    const q = query(collection(db, 'channex_integrations', firestoreDocId, 'properties'), orderBy('title', 'asc'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const next: ActiveProperty[] = snapshot.docs.map((d) => {
          const data = d.data();
          return {
            channex_property_id: (data.channex_property_id as string | undefined) ?? d.id,
            channex_channel_id: (data.channex_channel_id as string | undefined) ?? '',
            channex_room_type_id: (data.channex_room_type_id as string | undefined) ?? '',
            channex_rate_plan_id: (data.channex_rate_plan_id as string | undefined) ?? '',
            airbnb_listing_id: (data.airbnb_listing_id as string | undefined) ?? '',
            title: (data.title as string | undefined) ?? 'Untitled Listing',
            default_price: (data.default_price as number | null | undefined) ?? null,
            currency: (data.currency as string | null | undefined) ?? null,
            capacity: (data.capacity as number | null | undefined) ?? null,
          };
        });
        setProperties(next);
        // Auto-select first listing; preserve selection if it still exists.
        setActiveProperty((prev) => {
          if (prev && next.some((property) => property.channex_property_id === prev.channex_property_id)) {
            return prev;
          }
          return next[0] ?? null;
        });
      },
      () => {
        setProperties([]);
      },
    );

    return () => unsubscribe();
  }, [firestoreDocId]);

  const handleReconnect = useCallback(() => {
    setIntegrationState('connecting');
  }, []);

  const handleSelectProperty = useCallback((prop: ActiveProperty) => {
    setActiveProperty(prop);
  }, []);

  const handleProvisioned = useCallback((id: string) => {
    setPropertyId(id);
    setActiveView('inbox');
    setIntegrationState('connecting');
  }, []);

  const handleOAuthCompleted = useCallback(() => {
    setIntegrationState('connected');
    setActiveView('inbox');
  }, []);

  const handleRetryHydration = useCallback(() => {
    setHydrateNonce((value) => value + 1);
  }, []);

  const handleExpandReservations = useCallback(() => {
    setActiveView('reservations');
  }, []);

  const detailPanel = useMemo(() => {
    switch (integrationState) {
      case 'loading':
        return (
          <div className="flex h-full items-center justify-center px-6 py-10">
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-rose-500" />
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Loading Airbnb Integration</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Hydrating the integration state from Firestore and Channex.
                </p>
              </div>
            </div>
          </div>
        );
      case 'unprovisioned':
        return (
          <div className="h-full overflow-auto px-6 py-6">
            <PropertyProvisioningForm tenantId={tenantId} onProvisioned={handleProvisioned} />
          </div>
        );
      case 'connecting':
        return propertyId ? (
          <div className="h-full overflow-auto px-6 py-6">
            <ChannexOAuthPanel propertyId={propertyId} tenantId={tenantId} onConnected={handleOAuthCompleted} />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center px-6 py-10 text-center">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Preparing connection flow</h3>
              <p className="mt-1 text-sm text-gray-500">
                Waiting for the Airbnb property ID before opening secure authorization.
              </p>
            </div>
          </div>
        );
      case 'connected':
        switch (activeView) {
          case 'inventory':
            return (
              <div className="h-full overflow-auto px-6 py-6">
                <InventoryView integrationDocId={firestoreDocId} activeProperty={activeProperty} />
              </div>
            );
          case 'reservations':
            return (
              <div className="h-full overflow-auto px-6 py-6">
                <DetailedReservationsView integrationDocId={firestoreDocId} activeProperty={activeProperty} />
              </div>
            );
          case 'settings':
            return (
              <div className="h-full overflow-auto px-6 py-6">
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Connection Management
                  </p>
                  <h3 className="mt-2 text-xl font-semibold text-slate-900">Airbnb Channel &amp; Listing Mapping</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Listing Mapping: Open the Channex panel to link your Migo rooms to your Airbnb listings.
                    Keep this section available for remapping and connection repair at any time.
                  </p>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-emerald-700">
                      {connectionStatus === 'active' ? 'Active' : 'Inactive'}
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                      Property: {propertyId ?? 'Unavailable'}
                    </span>
                  </div>
                </div>

                <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/60">
                  {propertyId ? (
                    <ChannexOAuthPanel
                      propertyId={propertyId}
                      tenantId={tenantId}
                      onConnected={handleOAuthCompleted}
                    />
                  ) : (
                    <PlaceholderPanel
                      title="Connection unavailable"
                      description="No Airbnb property ID is available for this tenant yet."
                    />
                  )}
                </div>
              </div>
            );
          case 'inbox':
          default:
            return (
              <div className="h-full overflow-auto px-6 py-6">
                <InboxView integrationDocId={firestoreDocId} activeProperty={activeProperty} />
              </div>
            );
        }
      case 'error':
      default:
        return (
          <div className="flex h-full items-center justify-center px-6 py-10 text-center">
            <div className="max-w-md rounded-2xl border border-red-200 bg-red-50 px-5 py-4">
              <h3 className="text-lg font-semibold text-red-800">Airbnb integration unavailable</h3>
              <p className="mt-2 text-sm leading-6 text-red-700">
                {hydrationError ?? 'The integration could not be loaded. Retry to hydrate the tenant state again.'}
              </p>
              <button
                type="button"
                onClick={handleRetryHydration}
                className="mt-4 inline-flex items-center justify-center rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
              >
                Retry
              </button>
            </div>
          </div>
        );
    }
  }, [activeProperty, activeView, connectionStatus, firestoreDocId, handleOAuthCompleted, handleProvisioned, handleRetryHydration, hydrationError, integrationState, propertyId, tenantId]);

  return (
    <section className="flex h-full min-h-[640px] w-full overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <AirbnbSidebar
        integrationDocId={firestoreDocId}
        propertyId={propertyId}
        integrationState={integrationState}
        properties={properties}
        activePropertyId={activeProperty?.channex_property_id ?? null}
        onSelectProperty={handleSelectProperty}
        onReconnect={handleReconnect}
        onExpandReservations={handleExpandReservations}
      />

      <main className="flex-1 min-w-0 bg-white">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Airbnb Integration</p>
            <h1 className="text-lg font-semibold text-gray-900">Native Migo UIT Shell</h1>
          </div>

          <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 p-1 text-xs font-medium text-gray-600">
            {(['inbox', 'inventory', 'reservations', 'settings'] as ActiveView[]).map((view) => (
              <button
                key={view}
                type="button"
                onClick={() => setActiveView(view)}
                className={[
                  'rounded-full px-3 py-1.5 transition-colors',
                  activeView === view ? 'bg-white text-gray-900 shadow-sm' : 'hover:text-gray-900',
                ].join(' ')}
              >
                {view}
              </button>
            ))}
          </div>
        </div>

        <div className="h-[calc(100%-65px)] min-h-0">{detailPanel}</div>
      </main>
    </section>
  );
}
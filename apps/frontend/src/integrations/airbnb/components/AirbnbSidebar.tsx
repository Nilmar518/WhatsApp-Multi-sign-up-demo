import ConnectionStatusBadge from '../../../airbnb/components/ConnectionStatusBadge';
import ReservationInbox from '../../../airbnb/components/ReservationInbox';
import type { ActiveProperty } from '../AirbnbIntegration';

type IntegrationState = 'loading' | 'unprovisioned' | 'connecting' | 'connected' | 'error';

interface Props {
  integrationDocId: string | null;
  propertyId: string | null;
  integrationState: IntegrationState;
  properties: ActiveProperty[];
  activePropertyId: string | null;
  onSelectProperty: (property: ActiveProperty) => void;
  onReconnect: () => void;
  onExpandReservations: () => void;
}

export default function AirbnbSidebar({
  integrationDocId,
  propertyId,
  integrationState,
  properties,
  activePropertyId,
  onSelectProperty,
  onReconnect,
  onExpandReservations,
}: Props) {
  return (
    <aside className="w-1/3 min-w-0 border-r border-edge bg-surface-subtle/70 p-5">
      <div className="space-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-content-2">Airbnb</p>
          <h2 className="mt-1 text-lg font-semibold text-content">Native Integration Shell</h2>
          <p className="mt-1 text-sm text-content-2">
            Native split-pane sidebar for status, reservations, and actions.
          </p>
        </div>

        {propertyId && (
          <div className="rounded-2xl border border-edge bg-surface-raised px-4 py-4 shadow-sm">
            <ConnectionStatusBadge propertyId={propertyId} onReconnect={onReconnect} />
          </div>
        )}

        {integrationState === 'connected' && propertyId && (
          <div className="overflow-hidden rounded-2xl border border-edge bg-surface-raised shadow-sm">
            <ReservationInbox
              propertyId={propertyId}
              integrationDocId={integrationDocId}
              activePropertyId={activePropertyId}
              onExpandClick={onExpandReservations}
            />
          </div>
        )}

        {integrationState === 'connected' && (
          <div className="rounded-2xl border border-edge bg-surface-raised p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-content-2">
                Synced Listings
              </p>
              <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-[11px] font-semibold text-content-2">
                {properties.length}
              </span>
            </div>

            {properties.length === 0 ? (
              <div className="rounded-xl border border-dashed border-edge bg-surface-subtle px-3 py-4 text-xs text-content-2">
                Sync in progress — listings will appear here shortly.
              </div>
            ) : (
              <div className="space-y-2">
                {properties.map((property) => {
                  const isActive = activePropertyId === property.channex_property_id;
                  return (
                    <button
                      key={property.channex_property_id}
                      type="button"
                      onClick={() => onSelectProperty(property)}
                      className={[
                        'w-full rounded-xl border px-3 py-2.5 text-left transition',
                        isActive
                          ? 'border-rose-200 bg-rose-50'
                          : 'border-edge bg-surface-raised hover:border-rose-200 hover:bg-rose-50/60',
                      ].join(' ')}
                    >
                      <div className="flex items-start gap-2">
                        <span className="mt-1 inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-content">{property.title}</p>
                          <p className="mt-0.5 truncate text-xs text-content-2">
                            {property.airbnb_listing_id}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
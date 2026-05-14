import { useState } from 'react';
import type { ChannexProperty } from '../../hooks/useChannexProperties';
import RoomRateManager from './RoomRateManager';
import ARICalendar from './ARICalendar';
import ReservationsPanel from './ReservationsPanel';
import { checkConnectionHealth, type ConnectionHealthResult } from '../../api/channexHubApi';
import Button from '../../../components/ui/Button';

type InnerTab = 'rooms' | 'ari' | 'reservations';

interface Props {
  property: ChannexProperty;
  tenantId: string;
}

function HealthRow({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className={`text-sm ${ok ? 'text-ok-text' : 'text-danger-text'}`}>
        {ok ? '✓' : '✗'}
      </span>
      <span className="text-sm text-content">{label}</span>
      {detail && <span className="ml-auto font-mono text-xs text-content-3">{detail}</span>}
    </div>
  );
}

export default function PropertyDetail({ property, tenantId }: Props) {
  const [innerTab, setInnerTab] = useState<InnerTab>('rooms');
  const [syncing, setSyncing] = useState(false);
  const [healthResult, setHealthResult] = useState<ConnectionHealthResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    setHealthResult(null);
    try {
      const result = await checkConnectionHealth(property.channex_property_id, tenantId);
      setHealthResult(result);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div>
      {/* Property header */}
      <div className="mb-5 rounded-2xl border border-edge bg-surface-raised px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-content">{property.title}</h2>
            <p className="mt-0.5 font-mono text-xs text-content-2">{property.channex_property_id}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-xs text-content-2">{property.currency} · {property.timezone}</p>
              <span
                className={`mt-1 inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase ${
                  property.connection_status === 'active'
                    ? 'bg-ok-bg text-ok-text'
                    : property.connection_status === 'pending'
                      ? 'bg-caution-bg text-caution-text'
                      : 'bg-danger-bg text-danger-text'
                }`}
              >
                {property.connection_status}
              </span>
            </div>
            <Button
              type="button"
              onClick={handleSync}
              disabled={syncing}
              variant="secondary"
              size="sm"
              className="flex items-center gap-1.5"
            >
              <span className={syncing ? 'animate-spin inline-block' : ''}>↻</span>
              {syncing ? 'Syncing…' : 'Sync'}
            </Button>
          </div>
        </div>

        {/* Health result panel */}
        {healthResult && (
          <div className="mt-4 animate-fade-in rounded-xl border border-edge bg-surface-subtle px-4 py-3">
            <HealthRow label="Property exists in Channex" ok={healthResult.propertyExists} />
            <HealthRow
              label="Rooms configured"
              ok={healthResult.roomsCount > 0}
              detail={`${healthResult.roomsCount} room${healthResult.roomsCount !== 1 ? 's' : ''}`}
            />
            <HealthRow label="Tenant group match" ok={healthResult.inTenantGroup} />
            <HealthRow
              label="Webhook subscribed"
              ok={healthResult.webhookSubscribed}
              detail={healthResult.webhookReregistered ? 're-registered' : undefined}
            />
            <HealthRow label="Messages App installed" ok={healthResult.messagesAppInstalled} />
            {healthResult.errors.length > 0 && (
              <div className="mt-2 rounded-lg bg-danger-bg px-3 py-2">
                {healthResult.errors.map((e, i) => (
                  <p key={i} className="text-xs text-danger-text">{e}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {syncError && (
          <div className="mt-3 rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-text animate-fade-in">
            {syncError}
          </div>
        )}
      </div>

      {/* Inner tabs */}
      <div className="mb-4 flex gap-0 border-b border-edge">
        {([
          { id: 'rooms' as InnerTab, label: 'Rooms & Rates' },
          { id: 'ari' as InnerTab, label: 'ARI Calendar' },
          { id: 'reservations' as InnerTab, label: 'Reservations' },
        ] as const).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setInnerTab(tab.id)}
            className={[
              'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              innerTab === tab.id
                ? 'border-brand-light text-brand'
                : 'border-transparent text-content-2 hover:text-content hover:border-edge',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {innerTab === 'rooms' && (
        <RoomRateManager
          propertyId={property.channex_property_id}
          currency={property.currency}
        />
      )}

      {innerTab === 'ari' && (
        <ARICalendar
          propertyId={property.channex_property_id}
          currency={property.currency}
          tenantId={tenantId}
        />
      )}

      {innerTab === 'reservations' && (
        <ReservationsPanel
          propertyId={property.channex_property_id}
          tenantId={tenantId}
        />
      )}
    </div>
  );
}

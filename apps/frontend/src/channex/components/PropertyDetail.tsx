import { useState } from 'react';
import type { ChannexProperty } from '../hooks/useChannexProperties';
import RoomRateManager from './RoomRateManager';
import ARICalendarFull from './ARICalendarFull';
import { checkConnectionHealth, type ConnectionHealthResult } from '../api/channexHubApi';

type InnerTab = 'rooms' | 'ari';

interface Props {
  property: ChannexProperty;
  tenantId: string;
}

function HealthRow({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className={`text-sm ${ok ? 'text-emerald-600' : 'text-red-500'}`}>
        {ok ? '✓' : '✗'}
      </span>
      <span className="text-sm text-slate-700">{label}</span>
      {detail && <span className="ml-auto font-mono text-xs text-slate-400">{detail}</span>}
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
      <div className="mb-5 rounded-2xl border border-slate-200 bg-white px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{property.title}</h2>
            <p className="mt-0.5 font-mono text-xs text-slate-500">{property.channex_property_id}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-xs text-slate-500">{property.currency} · {property.timezone}</p>
              <span
                className={`mt-1 inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase ${
                  property.connection_status === 'active'
                    ? 'bg-emerald-100 text-emerald-700'
                    : property.connection_status === 'pending'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-red-100 text-red-700'
                }`}
              >
                {property.connection_status}
              </span>
            </div>
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-60"
            >
              <span className={syncing ? 'animate-spin inline-block' : ''}>↻</span>
              {syncing ? 'Syncing…' : 'Sync'}
            </button>
          </div>
        </div>

        {/* Health result panel */}
        {healthResult && (
          <div className="mt-4 animate-fade-in rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
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
            {healthResult.errors.length > 0 && (
              <div className="mt-2 rounded-lg bg-red-50 px-3 py-2">
                {healthResult.errors.map((e, i) => (
                  <p key={i} className="text-xs text-red-600">{e}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {syncError && (
          <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 animate-fade-in">
            {syncError}
          </div>
        )}
      </div>

      {/* Inner tabs */}
      <div className="mb-4 flex gap-0 border-b border-slate-200">
        {([
          { id: 'rooms' as InnerTab, label: 'Rooms & Rates' },
          { id: 'ari' as InnerTab, label: 'ARI Calendar' },
        ] as const).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setInnerTab(tab.id)}
            className={[
              'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              innerTab === tab.id
                ? 'border-indigo-500 text-indigo-700'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300',
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
        <ARICalendarFull
          propertyId={property.channex_property_id}
          currency={property.currency}
          tenantId={tenantId}
        />
      )}
    </div>
  );
}

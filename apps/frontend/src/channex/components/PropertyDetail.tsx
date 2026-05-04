import { useState } from 'react';
import type { ChannexProperty } from '../hooks/useChannexProperties';
import RoomRateManager from './RoomRateManager';
import ARICalendarFull from './ARICalendarFull';

type InnerTab = 'rooms' | 'ari';

interface Props {
  property: ChannexProperty;
}

export default function PropertyDetail({ property }: Props) {
  const [innerTab, setInnerTab] = useState<InnerTab>('rooms');

  return (
    <div>
      {/* Property header */}
      <div className="mb-5 rounded-2xl border border-slate-200 bg-white px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{property.title}</h2>
            <p className="mt-0.5 font-mono text-xs text-slate-500">{property.channex_property_id}</p>
          </div>
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
        </div>
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
        />
      )}
    </div>
  );
}

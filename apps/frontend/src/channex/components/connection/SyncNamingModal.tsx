import { useState } from 'react';
import type { ListingPreviewProperty, SyncNameOverrides } from '../../api/channexHubApi';
import { useLanguage } from '../../../context/LanguageContext';

interface Props {
  preview: ListingPreviewProperty[];
  channel: 'airbnb' | 'booking';
  onConfirm: (overrides: SyncNameOverrides) => void;
  onClose: () => void;
}

export default function SyncNamingModal({ preview, channel, onConfirm, onClose }: Props) {
  const { t } = useLanguage();
  const [names, setNames] = useState<SyncNameOverrides>(() => {
    const initial: SyncNameOverrides = {};

    if (channel === 'booking') {
      // BDC: 1 property, N rooms — key = otaRoomId
      const prop = preview[0];
      if (prop) {
        for (const room of prop.rooms) {
          initial[room.id] = {
            roomName: room.roomName,
            rates: Object.fromEntries(room.rates.map((r) => [r.id, r.rateName])),
            migoPropertyId: room.migoPropertyId ?? '',
          };
        }
      }
    } else {
      // Airbnb: N properties, 1 room per property — key = prop.id
      for (const prop of preview) {
        initial[prop.id] = {
          propertyName: prop.propertyName,
          roomName: prop.rooms[0]?.roomName ?? prop.propertyName,
          rates: Object.fromEntries((prop.rooms[0]?.rates ?? []).map((r) => [r.id, r.rateName])),
        };
      }
    }
    return initial;
  });

  function setPropertyName(propId: string, value: string) {
    setNames((prev) => ({ ...prev, [propId]: { ...prev[propId], propertyName: value } }));
  }

  function setRoomName(key: string, value: string) {
    setNames((prev) => ({ ...prev, [key]: { ...prev[key], roomName: value } }));
  }

  function setRateName(key: string, rateId: string, value: string) {
    setNames((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        rates: { ...(prev[key]?.rates ?? {}), [rateId]: value },
      },
    }));
  }

  function setMigoPropertyId(key: string, value: string) {
    setNames((prev) => ({ ...prev, [key]: { ...prev[key], migoPropertyId: value } }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-edge bg-surface shadow-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-edge px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-content">{t('channex.syncNaming.title')}</h2>
            <p className="text-xs text-content-2 mt-0.5">{t('channex.syncNaming.desc')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-content-3 hover:text-content transition-colors"
            aria-label="Close"
          >
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 2l12 12M14 2L2 14" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-6">
          {channel === 'booking' ? (
            // BDC layout: read-only property header, editable room rows
            <>
              {preview[0] && (
                <div className="flex items-center gap-2 pb-2 border-b border-edge">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-brand/10 text-[10px] font-bold text-brand">B</span>
                  <span className="text-sm font-semibold text-content">{preview[0].propertyName || t('channex.syncNaming.hotel')}</span>
                </div>
              )}
              {(preview[0]?.rooms ?? []).map((room) => {
                const override = names[room.id] ?? {};
                return (
                  <div key={room.id} className="ml-2 border-l-2 border-edge pl-4 space-y-3">
                    {/* Room name */}
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-ok-bg text-[10px] font-bold text-ok-text">R</span>
                        <label htmlFor={`room-name-${room.id}`} className="text-xs font-semibold text-content-2 uppercase tracking-wide">{t('channex.syncNaming.room')}</label>
                      </div>
                      <input
                        id={`room-name-${room.id}`}
                        type="text"
                        value={override.roomName ?? ''}
                        onChange={(e) => setRoomName(room.id, e.target.value)}
                        className="w-full rounded-xl border border-edge bg-surface-subtle px-3 py-2 text-sm text-content focus:border-brand focus:outline-none"
                      />
                    </div>

                    {/* Migo Property ID */}
                    <div>
                      <label htmlFor={`migo-id-${room.id}`} className="text-xs font-semibold text-content-2 uppercase tracking-wide block mb-1">
                        {t('channex.syncNaming.migoRoomId')}
                      </label>
                      <input
                        id={`migo-id-${room.id}`}
                        type="text"
                        value={override.migoPropertyId ?? ''}
                        onChange={(e) => setMigoPropertyId(room.id, e.target.value)}
                        placeholder={t('channex.syncNaming.migoRoomIdPlaceholder')}
                        className="w-full rounded-xl border border-edge bg-surface-subtle px-3 py-2 text-sm text-content focus:border-brand focus:outline-none"
                      />
                    </div>

                    {/* Rate levels */}
                    {room.rates.length > 0 && (
                      <div className="ml-4 border-l-2 border-edge pl-4 space-y-2">
                        {room.rates.map((rate) => (
                          <div key={rate.id}>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-notice-bg text-[10px] font-bold text-notice-text">$</span>
                              <label htmlFor={`rate-${room.id}-${rate.id}`} className="text-xs font-semibold text-content-2 uppercase tracking-wide">{t('channex.syncNaming.rate')}</label>
                            </div>
                            <input
                              id={`rate-${room.id}-${rate.id}`}
                              type="text"
                              value={override.rates?.[rate.id] ?? ''}
                              onChange={(e) => setRateName(room.id, rate.id, e.target.value)}
                              className="w-full rounded-xl border border-edge bg-surface-subtle px-3 py-2 text-sm text-content focus:border-brand focus:outline-none"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          ) : (
            // Airbnb layout: one card per property (unchanged)
            preview.map((prop) => {
              const override = names[prop.id] ?? {};
              const room = prop.rooms[0];
              return (
                <div key={prop.id}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-brand/10 text-[10px] font-bold text-brand">P</span>
                    <label htmlFor={`prop-name-${prop.id}`} className="text-xs font-semibold text-content-2 uppercase tracking-wide">{t('channex.syncNaming.property')}</label>
                  </div>
                  <input
                    id={`prop-name-${prop.id}`}
                    type="text"
                    value={override.propertyName ?? ''}
                    onChange={(e) => setPropertyName(prop.id, e.target.value)}
                    className="w-full rounded-xl border border-edge bg-surface-subtle px-3 py-2 text-sm text-content focus:border-brand focus:outline-none"
                  />
                  {room && (
                    <div className="mt-3 ml-4 border-l-2 border-edge pl-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-ok-bg text-[10px] font-bold text-ok-text">R</span>
                        <label htmlFor={`prop-room-${prop.id}`} className="text-xs font-semibold text-content-2 uppercase tracking-wide">{t('channex.syncNaming.room')}</label>
                      </div>
                      <input
                        id={`prop-room-${prop.id}`}
                        type="text"
                        value={override.roomName ?? ''}
                        onChange={(e) => setRoomName(prop.id, e.target.value)}
                        className="w-full rounded-xl border border-edge bg-surface-subtle px-3 py-2 text-sm text-content focus:border-brand focus:outline-none"
                      />
                      {room.rates.length > 0 && (
                        <div className="mt-3 ml-4 border-l-2 border-edge pl-4 space-y-2">
                          {room.rates.map((rate) => (
                            <div key={rate.id}>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-notice-bg text-[10px] font-bold text-notice-text">$</span>
                                <label htmlFor={`prop-rate-${prop.id}-${rate.id}`} className="text-xs font-semibold text-content-2 uppercase tracking-wide">{t('channex.syncNaming.rate')}</label>
                              </div>
                              <input
                                id={`prop-rate-${prop.id}-${rate.id}`}
                                type="text"
                                value={override.rates?.[rate.id] ?? ''}
                                onChange={(e) => setRateName(prop.id, rate.id, e.target.value)}
                                className="w-full rounded-xl border border-edge bg-surface-subtle px-3 py-2 text-sm text-content focus:border-brand focus:outline-none"
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-edge px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm text-content-2 hover:text-content transition-colors"
          >
            {t('channex.syncNaming.cancel')}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(names)}
            className="rounded-xl bg-brand px-5 py-2 text-sm font-semibold text-white hover:opacity-80 transition-opacity"
          >
            {t('channex.syncNaming.sync')}
          </button>
        </div>
      </div>
    </div>
  );
}

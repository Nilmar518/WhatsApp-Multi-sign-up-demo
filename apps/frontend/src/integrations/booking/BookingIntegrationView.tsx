import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import {
  getSessionToken,
  syncBooking,
  disconnectBooking,
  type BookingRoom,
  type BookingRate,
  type RoomType,
} from './api/bookingApi';
import BookingReservations from './components/BookingReservations';
import BookingInbox from './components/BookingInbox';
import { useChannexProperties } from '../../channex/hooks/useChannexProperties';

// ─── Types ────────────────────────────────────────────────────────────────────

type ViewState = 'loading' | 'idle' | 'opening' | 'popup_open' | 'syncing' | 'connected' | 'error';
type ActiveTab = 'inbox' | 'reservations' | 'settings';

interface Props {
  businessId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildPopupUrl(token: string, propertyId: string): string {
  const base =
    (import.meta as any).env?.VITE_CHANNEX_IFRAME_BASE_URL ?? 'https://staging.channex.io';

  const params = new URLSearchParams({
    oauth_session_key: token,
    app_mode: 'headless',
    redirect_to: '/channels',
    property_id: propertyId,
    channels: 'BDC',
  });

  return `${base}/auth/exchange?${params.toString()}`;
}

function openCenteredPopup(url: string) {
  const width = 800;
  const height = 700;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));

  window.open(
    url,
    'ChannexBookingAuth',
    `popup=yes,width=${width},height=${height},left=${left},top=${top},noopener,noreferrer`,
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BookingIntegrationView({ businessId }: Props) {
  const [viewState, setViewState] = useState<ViewState>('loading');
  const [activeTab, setActiveTab] = useState<ActiveTab>('inbox');
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [channexPropertyId, setChannexPropertyId] = useState<string | null>(null);
  // Legacy flat lists — populated for old integrations that pre-date room_types.
  const [otaRooms, setOtaRooms] = useState<BookingRoom[]>([]);
  const [otaRates, setOtaRates] = useState<BookingRate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const tenantId = useMemo(() => businessId, [businessId]);
  const isLocked = viewState === 'opening' || viewState === 'syncing' || isDisconnecting;

  const { properties: existingProperties } = useChannexProperties(tenantId);
  const baseProperty = existingProperties[0] ?? null;

  // Rooms forwarded to BookingReservations: prefer the standardized room_types
  // array; fall back to legacy ota_rooms for integrations created before the
  // schema migration.
  const reservationRooms = useMemo<BookingRoom[]>(
    () =>
      roomTypes.length > 0
        ? roomTypes.map((rt) => ({ id: rt.id, title: rt.title }))
        : otaRooms,
    [roomTypes, otaRooms],
  );

  // ── Hydrate from Firestore on mount ──────────────────────────────────────
  useEffect(() => {
    const docRef = doc(db, 'channex_integrations', tenantId);
    const unsubscribe = onSnapshot(
      docRef,
      (snap) => {
        if (snap.exists() && snap.data()?.channex_channel_id) {
          const data = snap.data()!;
          setRoomTypes((data.room_types as RoomType[] | undefined) ?? []);
          setChannexPropertyId((data.channex_property_id as string | undefined) ?? null);
          setOtaRooms((data.ota_rooms as BookingRoom[] | undefined) ?? []);
          setOtaRates((data.ota_rates as BookingRate[] | undefined) ?? []);
          setViewState('connected');
        } else {
          setViewState((prev) => (prev === 'loading' ? 'idle' : prev));
        }
      },
      () => {
        setViewState((prev) => (prev === 'loading' ? 'idle' : prev));
      },
    );

    return () => unsubscribe();
  }, [tenantId]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleOpenPopup = useCallback(async () => {
    setViewState('opening');
    setError(null);

    try {
      const { token, propertyId } = await getSessionToken(tenantId);
      openCenteredPopup(buildPopupUrl(token, propertyId));
      setViewState('popup_open');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open Channex window.');
      setViewState('error');
    }
  }, [tenantId]);

  const handleSync = useCallback(async () => {
    setViewState('syncing');
    setError(null);

    try {
      const result = await syncBooking(tenantId);
      setOtaRooms(result.rooms);
      setOtaRates(result.rates);
      setViewState('connected');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed. Please try again.');
      setViewState('popup_open');
    }
  }, [tenantId]);

  const handleDisconnect = useCallback(async () => {
    setIsDisconnecting(true);
    setError(null);

    try {
      await disconnectBooking(tenantId);
      setRoomTypes([]);
      setChannexPropertyId(null);
      setOtaRooms([]);
      setOtaRates([]);
      setViewState('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Disconnection failed.');
    } finally {
      setIsDisconnecting(false);
    }
  }, [tenantId]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="text-2xl">🏨</span>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Booking.com</h2>
          <p className="text-sm text-gray-500">
            Connect your Booking.com property via Channex.io
          </p>
        </div>
        {viewState === 'connected' && (
          <span className="ml-auto flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Connected
          </span>
        )}
      </div>

      {/* Loading shimmer */}
      {viewState === 'loading' && (
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-blue-500" />
          Loading integration status…
        </div>
      )}

      {/* Connection panel */}
      {(viewState === 'idle' || viewState === 'opening' || viewState === 'popup_open' || viewState === 'error') && (
        <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
            Booking.com Connection
          </p>
          <h3 className="mt-2 text-xl font-semibold text-slate-900">
            Connect your Booking.com account
          </h3>

          {baseProperty && (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
              <p className="font-semibold text-emerald-800">
                Existing property detected
              </p>
              <p className="mt-0.5 text-emerald-700">
                We'll connect Booking.com to:{' '}
                <span className="font-medium">{baseProperty.title}</span>
              </p>
              <p className="mt-0.5 font-mono text-xs text-emerald-600 break-all">
                {baseProperty.channex_property_id}
              </p>
            </div>
          )}

          <ol className="mt-4 space-y-2 text-sm leading-6 text-slate-600">
            <li>
              <span className="font-semibold text-slate-800">Step 1.</span> Click{' '}
              <span className="font-medium text-blue-600">Connect via Channex</span> to open the
              secure Channex authorization popup. Complete the Booking.com connection there.
            </li>
            <li>
              <span className="font-semibold text-slate-800">Step 2.</span> Return here and click{' '}
              <span className="font-medium text-emerald-600">Sync &amp; Complete</span> to import
              your rooms and rate plans.
            </li>
          </ol>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleOpenPopup()}
              disabled={isLocked}
              className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {viewState === 'opening' ? (
                <>
                  <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  Opening secure window…
                </>
              ) : (
                'Connect via Channex'
              )}
            </button>

            {(viewState === 'popup_open' || viewState === 'error') && (
              <button
                type="button"
                onClick={() => void handleSync()}
                disabled={isLocked}
                className="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {viewState === 'syncing' ? (
                  <>
                    <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    Syncing…
                  </>
                ) : (
                  'Sync & Complete'
                )}
              </button>
            )}
          </div>

          {error && (
            <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>
      )}

      {/* Syncing overlay */}
      {viewState === 'syncing' && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-400">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500" />
          Fetching rooms and rates from Booking.com…
        </div>
      )}

      {/* Connected — tabbed dashboard */}
      {viewState === 'connected' && (
        <div className="space-y-4">
          {/* Tab bar */}
          <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
            {(['inbox', 'reservations', 'settings'] as ActiveTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={[
                  'flex-1 rounded-lg px-4 py-2 text-sm font-medium capitalize transition',
                  activeTab === tab
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700',
                ].join(' ')}
              >
                {tab === 'inbox' && 'Inbox'}
                {tab === 'reservations' && 'Reservations'}
                {tab === 'settings' && 'Settings'}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === 'inbox' && (
            <BookingInbox tenantId={tenantId} propertyId={channexPropertyId} />
          )}

          {activeTab === 'reservations' && (
            <BookingReservations
              tenantId={tenantId}
              propertyId={channexPropertyId}
              roomTypes={roomTypes}
              otaRooms={reservationRooms}
            />
          )}

          {activeTab === 'settings' && (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-6">

              {/* Room & Rate Plans — hierarchical view */}
              <div>
                <div className="flex items-baseline justify-between">
                  <h3 className="text-base font-semibold text-slate-900">Rooms &amp; Rate Plans</h3>
                  {roomTypes.length > 0 && (
                    <span className="text-xs text-slate-400">
                      {roomTypes.length} room{roomTypes.length !== 1 ? 's' : ''} &middot;{' '}
                      {roomTypes.reduce((n, rt) => n + rt.rate_plans.length, 0)} rate plan{roomTypes.reduce((n, rt) => n + rt.rate_plans.length, 0) !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  Synced from Channex. Use these IDs to configure availability and pricing.
                </p>
              </div>

              {/* Populated — nested room → rate plan tree */}
              {roomTypes.length > 0 ? (
                <div className="overflow-hidden rounded-xl border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 text-left font-medium">Title</th>
                        <th className="px-4 py-2.5 text-left font-medium">Channex ID</th>
                        <th className="px-4 py-2.5 text-left font-medium">Type</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {roomTypes.map((room) => (
                        <React.Fragment key={room.id}>
                          {/* Room row */}
                          <tr className="bg-slate-50/60">
                            <td className="px-4 py-2.5 font-medium text-slate-800">
                              {room.title}
                            </td>
                            <td className="px-4 py-2.5 font-mono text-xs text-slate-400">
                              {room.id}
                            </td>
                            <td className="px-4 py-2.5">
                              <span className="inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                                Room Type
                              </span>
                            </td>
                          </tr>

                          {/* Rate plan rows — indented under their room */}
                          {room.rate_plans.map((rp) => (
                            <tr key={rp.id} className="bg-white">
                              <td className="py-2.5 pl-10 pr-4 text-slate-600">
                                <span className="mr-2 text-slate-300">↳</span>
                                {rp.title}
                              </td>
                              <td className="px-4 py-2.5 font-mono text-xs text-slate-400">
                                {rp.id}
                              </td>
                              <td className="px-4 py-2.5">
                                <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                                  Rate Plan
                                </span>
                              </td>
                            </tr>
                          ))}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : otaRooms.length > 0 ? (
                /* Legacy fallback — flat tables for integrations created before schema migration */
                <div className="space-y-4">
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Rooms ({otaRooms.length})
                    </p>
                    <div className="overflow-hidden rounded-xl border border-slate-200">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-4 py-2 text-left font-medium">Room ID</th>
                            <th className="px-4 py-2 text-left font-medium">Title</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {otaRooms.map((room) => (
                            <tr key={room.id}>
                              <td className="px-4 py-2 font-mono text-xs text-slate-500">{room.id}</td>
                              <td className="px-4 py-2 text-slate-800">{room.title}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Rate Plans ({otaRates.length})
                    </p>
                    <div className="overflow-hidden rounded-xl border border-slate-200">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-4 py-2 text-left font-medium">Rate ID</th>
                            <th className="px-4 py-2 text-left font-medium">Title</th>
                            <th className="px-4 py-2 text-left font-medium">Room</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {otaRates.map((rate, i) => (
                            <tr key={`${rate.id}-${i}`}>
                              <td className="px-4 py-2 font-mono text-xs text-slate-500">{rate.id}</td>
                              <td className="px-4 py-2 text-slate-800">{rate.title}</td>
                              <td className="px-4 py-2 font-mono text-xs text-slate-500">{rate.room_id}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-blue-500" />
                  Waiting for pipeline to complete…
                </div>
              )}

              {/* Disconnect */}
              <div className="border-t border-slate-100 pt-4">
                {error && (
                  <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => void handleDisconnect()}
                  disabled={isDisconnecting}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 shadow-sm transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isDisconnecting ? (
                    <>
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-red-300 border-t-red-500" />
                      Disconnecting…
                    </>
                  ) : (
                    'Disconnect Booking.com'
                  )}
                </button>
                <p className="mt-1.5 text-xs text-slate-500">
                  Sends an XML drop signal to Booking.com, returning calendar control to your Extranet.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

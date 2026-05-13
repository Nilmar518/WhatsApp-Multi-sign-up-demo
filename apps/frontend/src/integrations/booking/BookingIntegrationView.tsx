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
import Button from '../../components/ui/Button';

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
          <h2 className="text-lg font-semibold text-content">Booking.com</h2>
          <p className="text-sm text-content-2">
            Connect your Booking.com property via Channex.io
          </p>
        </div>
        {viewState === 'connected' && (
          <span className="ml-auto flex items-center gap-1.5 rounded-full border border-ok-bg bg-ok-bg px-3 py-1 text-xs font-medium text-ok-text">
            <span className="h-1.5 w-1.5 rounded-full bg-ok-text" />
            Connected
          </span>
        )}
      </div>

      {/* Loading shimmer */}
      {viewState === 'loading' && (
        <div className="flex items-center gap-3 rounded-xl border border-edge bg-surface-subtle px-4 py-4 text-sm text-content-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-edge border-t-notice-text" />
          Loading integration status…
        </div>
      )}

      {/* Connection panel */}
      {(viewState === 'idle' || viewState === 'opening' || viewState === 'popup_open' || viewState === 'error') && (
        <div className="mx-auto max-w-2xl rounded-2xl border border-edge bg-surface-raised p-8 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-notice-text">
            Booking.com Connection
          </p>
          <h3 className="mt-2 text-xl font-semibold text-content">
            Connect your Booking.com account
          </h3>

          {baseProperty && (
            <div className="mt-4 rounded-xl border border-ok-bg bg-ok-bg px-4 py-3 text-sm">
              <p className="font-semibold text-ok-text">
                Existing property detected
              </p>
              <p className="mt-0.5 text-ok-text">
                We'll connect Booking.com to:{' '}
                <span className="font-medium">{baseProperty.title}</span>
              </p>
              <p className="mt-0.5 font-mono text-xs text-ok-text break-all">
                {baseProperty.channex_property_id}
              </p>
            </div>
          )}

          <ol className="mt-4 space-y-2 text-sm leading-6 text-content-2">
            <li>
              <span className="font-semibold text-content">Step 1.</span> Click{' '}
              <span className="font-medium text-notice-text">Connect via Channex</span> to open the
              secure Channex authorization popup. Complete the Booking.com connection there.
            </li>
            <li>
              <span className="font-semibold text-content">Step 2.</span> Return here and click{' '}
              <span className="font-medium text-ok-text">Sync &amp; Complete</span> to import
              your rooms and rate plans.
            </li>
          </ol>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="primary"
              size="lg"
              onClick={() => void handleOpenPopup()}
              disabled={isLocked}
            >
              {viewState === 'opening' ? (
                <>
                  <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  Opening secure window…
                </>
              ) : (
                'Connect via Channex'
              )}
            </Button>

            {(viewState === 'popup_open' || viewState === 'error') && (
              <Button
                type="button"
                variant="primary"
                size="lg"
                onClick={() => void handleSync()}
                disabled={isLocked}
                className="bg-ok-text hover:bg-ok-text/90"
              >
                Sync &amp; Complete
              </Button>
            )}
          </div>

          {error && (
            <div className="mt-5 rounded-xl border border-danger-bg bg-danger-bg px-4 py-3 text-sm text-danger-text">
              {error}
            </div>
          )}
        </div>
      )}

      {/* Syncing overlay */}
      {viewState === 'syncing' && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-content-3">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-edge border-t-notice-text" />
          Fetching rooms and rates from Booking.com…
        </div>
      )}

      {/* Connected — tabbed dashboard */}
      {viewState === 'connected' && (
        <div className="space-y-4">
          {/* Tab bar */}
          <div className="flex gap-1 rounded-xl border border-edge bg-surface-subtle p-1">
            {(['inbox', 'reservations', 'settings'] as ActiveTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={[
                  'flex-1 rounded-lg px-4 py-2 text-sm font-medium capitalize transition',
                  activeTab === tab
                    ? 'bg-surface-raised text-notice-text shadow-sm'
                    : 'text-content-2 hover:text-content',
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
            <div className="rounded-2xl border border-edge bg-surface-raised p-6 shadow-sm space-y-6">

              {/* Room & Rate Plans — hierarchical view */}
              <div>
                <div className="flex items-baseline justify-between">
                  <h3 className="text-base font-semibold text-content">Rooms &amp; Rate Plans</h3>
                  {roomTypes.length > 0 && (
                    <span className="text-xs text-content-3">
                      {roomTypes.length} room{roomTypes.length !== 1 ? 's' : ''} &middot;{' '}
                      {roomTypes.reduce((n, rt) => n + rt.rate_plans.length, 0)} rate plan{roomTypes.reduce((n, rt) => n + rt.rate_plans.length, 0) !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-content-2">
                  Synced from Channex. Use these IDs to configure availability and pricing.
                </p>
              </div>

              {/* Populated — nested room → rate plan tree */}
              {roomTypes.length > 0 ? (
                <div className="overflow-hidden rounded-xl border border-edge">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-subtle text-xs uppercase tracking-wide text-content-2">
                      <tr>
                        <th className="px-4 py-2.5 text-left font-medium">Title</th>
                        <th className="px-4 py-2.5 text-left font-medium">Channex ID</th>
                        <th className="px-4 py-2.5 text-left font-medium">Type</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-edge bg-surface-raised">
                      {roomTypes.map((room) => (
                        <React.Fragment key={room.id}>
                          {/* Room row */}
                          <tr className="bg-surface-subtle/60">
                            <td className="px-4 py-2.5 font-medium text-content">
                              {room.title}
                            </td>
                            <td className="px-4 py-2.5 font-mono text-xs text-content-3">
                              {room.id}
                            </td>
                            <td className="px-4 py-2.5">
                              <span className="inline-flex items-center rounded-md border border-notice/40 bg-notice-bg px-2 py-0.5 text-xs font-medium text-notice-text">
                                Room Type
                              </span>
                            </td>
                          </tr>

                          {/* Rate plan rows — indented under their room */}
                          {room.rate_plans.map((rp) => (
                            <tr key={rp.id} className="bg-surface-raised">
                              <td className="py-2.5 pl-10 pr-4 text-content-2">
                                <span className="mr-2 text-content-3">↳</span>
                                {rp.title}
                              </td>
                              <td className="px-4 py-2.5 font-mono text-xs text-content-3">
                                {rp.id}
                              </td>
                              <td className="px-4 py-2.5">
                                <span className="inline-flex items-center rounded-md border border-caution-bg bg-caution-bg px-2 py-0.5 text-xs font-medium text-caution-text">
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
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-3">
                      Rooms ({otaRooms.length})
                    </p>
                    <div className="overflow-hidden rounded-xl border border-edge">
                      <table className="w-full text-sm">
                        <thead className="bg-surface-subtle text-xs uppercase tracking-wide text-content-2">
                          <tr>
                            <th className="px-4 py-2 text-left font-medium">Room ID</th>
                            <th className="px-4 py-2 text-left font-medium">Title</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-edge bg-surface-raised">
                          {otaRooms.map((room) => (
                            <tr key={room.id}>
                              <td className="px-4 py-2 font-mono text-xs text-content-2">{room.id}</td>
                              <td className="px-4 py-2 text-content">{room.title}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-3">
                      Rate Plans ({otaRates.length})
                    </p>
                    <div className="overflow-hidden rounded-xl border border-edge">
                      <table className="w-full text-sm">
                        <thead className="bg-surface-subtle text-xs uppercase tracking-wide text-content-2">
                          <tr>
                            <th className="px-4 py-2 text-left font-medium">Rate ID</th>
                            <th className="px-4 py-2 text-left font-medium">Title</th>
                            <th className="px-4 py-2 text-left font-medium">Room</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-edge bg-surface-raised">
                          {otaRates.map((rate, i) => (
                            <tr key={`${rate.id}-${i}`}>
                              <td className="px-4 py-2 font-mono text-xs text-content-2">{rate.id}</td>
                              <td className="px-4 py-2 text-content">{rate.title}</td>
                              <td className="px-4 py-2 font-mono text-xs text-content-2">{rate.room_id}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-xl border border-edge bg-surface-subtle px-4 py-4 text-sm text-content-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-edge border-t-notice-text" />
                  Waiting for pipeline to complete…
                </div>
              )}

              {/* Disconnect */}
              <div className="border-t border-edge pt-4">
                {error && (
                  <div className="mb-4 rounded-xl border border-danger-bg bg-danger-bg px-4 py-3 text-sm text-danger-text">
                    {error}
                  </div>
                )}
                <Button
                  type="button"
                  variant="danger"
                  size="md"
                  onClick={() => void handleDisconnect()}
                  disabled={isDisconnecting}
                >
                  {isDisconnecting ? (
                    <>
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-danger-text/30 border-t-danger-text" />
                      Disconnecting…
                    </>
                  ) : (
                    'Disconnect Booking.com'
                  )}
                </Button>
                <p className="mt-1.5 text-xs text-content-2">
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

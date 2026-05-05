import { useState, useEffect, useRef, useCallback } from 'react';
import PropertyProvisioningForm from './components/PropertyProvisioningForm';
import ChannexIFrame from './components/ChannexIFrame';
import ConnectionStatusBadge from './components/ConnectionStatusBadge';
import ReservationInbox from './components/ReservationInbox';
import UnmappedRoomModal, { type UnmappedRoomEventData } from './components/UnmappedRoomModal';
import MappingReviewModal from './components/MappingReviewModal';
import MultiCalendarView from './components/MultiCalendarView';
import { syncStage, type StageSyncResult } from './api/channexApi';
import { useChannexProperties } from '../channex/hooks/useChannexProperties';
import ExistingPropertyCard from './components/ExistingPropertyCard';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Mirrors the backend CHANNEX_EVENTS discriminant values. */
type SSEEventType =
  | 'connection_status_change'
  | 'booking_new'
  | 'booking_unmapped_room';

interface SSEEventBase {
  type: SSEEventType;
  tenantId: string;
  propertyId: string;
  timestamp: string;
}

interface SSEStatusChangeEvent extends SSEEventBase {
  type: 'connection_status_change';
  status: string;
}

interface SSEBookingNewEvent extends SSEEventBase {
  type: 'booking_new';
  revisionId: string;
  otaReservationCode: string;
}

interface SSEUnmappedRoomEvent extends SSEEventBase {
  type: 'booking_unmapped_room';
  revisionId: string;
}

type SSEEvent = SSEStatusChangeEvent | SSEBookingNewEvent | SSEUnmappedRoomEvent;

// ─── Wizard ───────────────────────────────────────────────────────────────────

/**
 * 4-step onboarding + management wizard.
 *
 *   PROVISION → CONNECT → INVENTORY → BOOKINGS
 *
 *   PROVISION: Admin enters property details; backend creates the Channex property
 *              and returns a channexPropertyId.
 *   CONNECT:   ChannexIFrame loads the Airbnb OAuth flow. On completion the
 *              connection_status SSE event transitions this step to INVENTORY.
 *   INVENTORY: ARICalendar — admin sets availability, rates, and min-stay.
 *   BOOKINGS:  ReservationInbox — incoming Airbnb bookings from Firestore.
 *
 * The wizard can step BACKWARDS from any state to CONNECT when an
 * UnmappedRoomModal "Fix Mapping" action is triggered.
 */
type WizardStep = 'PROVISION' | 'CONNECT' | 'REVIEW' | 'INVENTORY' | 'BOOKINGS';

const STEP_LABELS: Record<WizardStep, string> = {
  PROVISION: '1. Property Setup',
  CONNECT:   '2. Connect Airbnb',
  REVIEW:    '3. Review Mappings',
  INVENTORY: '4. Availability & Rates',
  BOOKINGS:  '5. Reservations',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Reads `tenantId` from the URL query string.
 * Example: /airbnb?tenantId=demo-business-001
 * Falls back to 'demo-business-001' if absent so the page works without config.
 */
function resolveTenantId(): string {
  return (
    new URLSearchParams(window.location.search).get('tenantId') ??
    'demo-business-001'
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * AirbnbPage — top-level orchestrator for the Channex × Airbnb integration UI.
 *
 * Responsibilities:
 *   - Renders the 4-step wizard and manages step transitions
 *   - Maintains a persistent SSE connection to `/api/channex/events/:tenantId`
 *     for real-time status updates (connection_status_change, booking_new,
 *     booking_unmapped_room)
 *   - Surfaces the blocking UnmappedRoomModal on booking_unmapped_room events,
 *     which forces the admin back to the CONNECT step to fix the Room Type mapping
 *   - Stores `channexPropertyId` in state after PROVISION completes — this UUID
 *     is the pivot for all subsequent IFrame, ARI, and reservation operations
 *
 * SSE lifecycle:
 *   The EventSource is opened in a useEffect keyed on `tenantId`. On cleanup
 *   (unmount or tenantId change), `es.close()` is called — preventing ghost
 *   connections from persisting after navigation.
 *
 * Child components (to be implemented in later phases):
 *   - PropertyProvisioningForm (Phase 6 remaining / standalone PR)
 *   - ARICalendar              (Phase 7 — availability + rate grid)
 *   - ReservationInbox         (Phase 7 — Firestore reservation list)
 */
export default function AirbnbPage() {
  const tenantId = useRef(resolveTenantId()).current;

  // ── Wizard state ────────────────────────────────────────────────────────────
  const [step, setStep] = useState<WizardStep>('PROVISION');
  const [channexPropertyId, setChannexPropertyId] = useState<string | null>(null);

  // ── Existing properties check ────────────────────────────────────────────────
  const { properties: existingProperties, loading: propertiesLoading } =
    useChannexProperties(tenantId);

  // ── Stage & Review state ────────────────────────────────────────────────────
  const [stagedResult, setStagedResult] = useState<StageSyncResult | null>(null);
  const [stagingLoading, setStagingLoading] = useState(false);
  const [stagingError, setStagingError] = useState<string | null>(null);

  // ── SSE state ────────────────────────────────────────────────────────────────
  const [sseConnected, setSseConnected] = useState(false);
  const [unmappedRoomEvent, setUnmappedRoomEvent] =
    useState<UnmappedRoomEventData | null>(null);
  /** Latest booking_new confirmation code — shown in a transient toast. */
  const [newBookingCode, setNewBookingCode] = useState<string | null>(null);
  /** Forces a fresh ChannexIFrame mount when the admin repairs mapping. */
  const [iframeReloadToken, setIframeReloadToken] = useState(0);

  const bookingToastTimeoutRef = useRef<number | null>(null);

  // ── SSE connection ────────────────────────────────────────────────────────

  useEffect(() => {
    const url = `/api/channex/events/${encodeURIComponent(tenantId)}`;
    const es = new EventSource(url);

    es.onopen = () => {
      setSseConnected(true);
    };

    es.onmessage = (msgEvent: MessageEvent<string>) => {
      let parsed: SSEEvent;
      try {
        parsed = JSON.parse(msgEvent.data) as SSEEvent;
      } catch {
        return; // Malformed SSE data — ignore
      }

      switch (parsed.type) {
        case 'connection_status_change':
          // Phase 6+: update the ConnectionStatusBadge chip.
          // The status chip component (Phase 7) will subscribe to this via props.
          break;

        case 'booking_new':
          // Show a brief new-booking toast then auto-dismiss.
          setNewBookingCode(parsed.otaReservationCode);
          if (bookingToastTimeoutRef.current !== null) {
            window.clearTimeout(bookingToastTimeoutRef.current);
          }
          bookingToastTimeoutRef.current = window.setTimeout(() => {
            setNewBookingCode(null);
            bookingToastTimeoutRef.current = null;
          }, 6000);
          break;

        case 'booking_unmapped_room':
          // Trigger the blocking modal — admin MUST fix the mapping.
          setUnmappedRoomEvent({
            tenantId: parsed.tenantId,
            propertyId: parsed.propertyId,
            revisionId: parsed.revisionId,
            timestamp: parsed.timestamp,
          });
          break;
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects — do not close on transient errors.
      setSseConnected(false);
    };

    return () => {
      es.close();
      setSseConnected(false);
      if (bookingToastTimeoutRef.current !== null) {
        window.clearTimeout(bookingToastTimeoutRef.current);
        bookingToastTimeoutRef.current = null;
      }
    };
  }, [tenantId]);

  // ── Wizard transitions ────────────────────────────────────────────────────

  /** Called by PropertyProvisioningForm (placeholder) after successful POST. */
  const handleProvisioned = useCallback((propertyId: string) => {
    setChannexPropertyId(propertyId);
    setStep('CONNECT');
  }, []);

  /**
   * Called by ChannexIFrame when the Airbnb OAuth iframe fires its load event.
   * Does NOT advance the step — the user must click "Sync Listings" manually
   * after completing the OAuth flow inside the IFrame.
   */
  const handleIFrameConnected = useCallback(() => {
    // IFrame loaded successfully; show the "Sync Listings" CTA.
    // Step does not change here — user triggers sync manually.
  }, []);

  /**
   * Triggered when the user clicks "Sync Listings & Review" in the CONNECT step.
   * Calls POST /sync_stage to discover listings + create Channex entities,
   * then transitions to the REVIEW step with the staged data.
   */
  const handleSyncListings = useCallback(async () => {
    if (!channexPropertyId) return;

    setStagingLoading(true);
    setStagingError(null);

    try {
      const result = await syncStage(channexPropertyId, tenantId);
      setStagedResult(result);
      setStep('REVIEW');
    } catch (err) {
      setStagingError(
        err instanceof Error ? err.message : 'Failed to fetch Airbnb listings. Please try again.',
      );
    } finally {
      setStagingLoading(false);
    }
  }, [channexPropertyId, tenantId]);

  const handleReconnect = useCallback(() => {
    setStagedResult(null);
    setStagingError(null);
    setStep('CONNECT');
    setIframeReloadToken((token) => token + 1);
  }, []);

  /**
   * Called by UnmappedRoomModal's "Fix Mapping" button.
   * Dismisses the modal and drops the admin back to the CONNECT step.
   */
  const handleFixMapping = useCallback(() => {
    setUnmappedRoomEvent(null);
    setStagedResult(null);
    setStagingError(null);
    setStep('CONNECT');
    setIframeReloadToken((token) => token + 1);
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-rose-500 rounded-lg flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-bold">A</span>
          </div>
          <div>
            <h1 className="text-base font-semibold text-gray-900 leading-tight">
              Airbnb Integration
            </h1>
            <p className="text-xs text-gray-400">
              Tenant: {tenantId}
              {channexPropertyId && (
                <span className="ml-2 text-gray-300">
                  · Property: {channexPropertyId.slice(0, 8)}…
                </span>
              )}
            </p>
          </div>
        </div>

        {/* SSE connection indicator */}
        <div className="flex items-center gap-1.5">
          <div
            className={`w-2 h-2 rounded-full ${sseConnected ? 'bg-green-400' : 'bg-gray-300'}`}
          />
          <span className="text-xs text-gray-400">
            {sseConnected ? 'Live' : 'Connecting…'}
          </span>
        </div>
      </header>

      {/* ── Wizard step bar ─────────────────────────────────────────────────── */}
      <nav className="bg-white border-b border-gray-100 px-6 py-3">
        <ol className="flex items-center gap-0">
          {(Object.keys(STEP_LABELS) as WizardStep[]).map((s, idx) => {
            const steps = Object.keys(STEP_LABELS) as WizardStep[];
            const currentIdx = steps.indexOf(step);
            const isActive = s === step;
            const isPast = steps.indexOf(s) < currentIdx;

            return (
              <li key={s} className="flex items-center">
                <button
                  type="button"
                  onClick={() => isPast && setStep(s)}
                  disabled={!isPast}
                  className={[
                    'text-xs font-medium px-3 py-1.5 rounded-md transition-colors',
                    isActive
                      ? 'bg-rose-50 text-rose-600'
                      : isPast
                        ? 'text-gray-500 hover:text-gray-700 cursor-pointer'
                        : 'text-gray-300 cursor-default',
                  ].join(' ')}
                >
                  {STEP_LABELS[s]}
                </button>
                {idx < steps.length - 1 && (
                  <span className="text-gray-200 px-1">›</span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* ── Main content ────────────────────────────────────────────────────── */}
      <main className="flex-1 px-6 py-8 max-w-4xl mx-auto w-full">

        {/* STEP 1: PROVISION */}
        {step === 'PROVISION' && (
          propertiesLoading ? (
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-6 py-8 text-sm text-slate-500">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-rose-500" />
              Loading property information…
            </div>
          ) : existingProperties.length > 0 ? (
            <ExistingPropertyCard
              property={existingProperties[0]}
              onContinue={handleProvisioned}
            />
          ) : (
            <PropertyProvisioningForm onProvisioned={handleProvisioned} />
          )
        )}

        {/* STEP 2: CONNECT — Channex IFrame for Airbnb OAuth + Sync trigger */}
        {step === 'CONNECT' && channexPropertyId && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <ConnectionStatusBadge
                propertyId={channexPropertyId}
                onReconnect={handleReconnect}
              />
            </div>

            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">
                Connect Airbnb Account
              </h2>
              <p className="text-sm text-gray-500">
                Authorize Channex to manage your Airbnb listing in the secure panel
                below. When the connection is confirmed, click
                {' '}<strong>Sync Listings</strong> to continue.
              </p>
            </div>

            <ChannexIFrame
              key={`${channexPropertyId}-${iframeReloadToken}`}
              propertyId={channexPropertyId}
              onConnected={handleIFrameConnected}
            />

            {/* Staging error */}
            {stagingError && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                <span className="font-semibold">Error: </span>{stagingError}
              </div>
            )}

            {/* Sync Listings CTA */}
            <div className="flex items-center justify-end pt-2 border-t border-gray-100">
              <button
                type="button"
                disabled={stagingLoading}
                onClick={() => void handleSyncListings()}
                className={[
                  'inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors',
                  stagingLoading
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-rose-600 hover:bg-rose-700 text-white',
                ].join(' ')}
              >
                {stagingLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-rose-200 border-t-white rounded-full animate-spin" />
                    Fetching listings…
                  </>
                ) : (
                  <>
                    Sync Listings & Review
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                    </svg>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: REVIEW — MappingReviewModal */}
        {step === 'REVIEW' && stagedResult && (
          <div className="space-y-4">
            <MappingReviewModal
              staged={stagedResult}
              onComplete={() => setStep('INVENTORY')}
            />
            <div className="flex justify-start">
              <button
                type="button"
                onClick={handleReconnect}
                className="text-sm text-gray-400 hover:text-gray-600 underline hover:no-underline transition-colors"
              >
                ← Back to Airbnb connection
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: INVENTORY — Multi-room Gantt calendar + ARI push panel */}
        {step === 'INVENTORY' && (
          <MultiCalendarView propertyId={channexPropertyId ?? ''} />
        )}

        {/* STEP 5: BOOKINGS — ReservationInbox */}
        {step === 'BOOKINGS' && (
          <ReservationInbox propertyId={channexPropertyId ?? ''} />
        )}

      </main>

      {/* ── booking_new toast ─────────────────────────────────────────────────── */}
      {newBookingCode && (
        <div
          className="fixed bottom-6 right-6 z-40 bg-green-600 text-white text-sm font-medium px-5 py-3 rounded-xl shadow-lg flex items-center gap-2 animate-fade-in"
          role="status"
          aria-live="polite"
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
          New booking — {newBookingCode}
        </div>
      )}

      {/* ── UnmappedRoomModal (blocking) ────────────────────────────────────── */}
      {unmappedRoomEvent && (
        <UnmappedRoomModal
          event={unmappedRoomEvent}
          onFix={handleFixMapping}
        />
      )}
    </div>
  );
}

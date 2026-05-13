// ─── Types ────────────────────────────────────────────────────────────────────

export interface UnmappedRoomEventData {
  tenantId: string;
  propertyId: string;
  revisionId: string;
  timestamp: string;
}

interface Props {
  /**
   * The SSE event payload received from channex.booking_unmapped_room.
   * Provides context for the error message shown to the admin.
   */
  event: UnmappedRoomEventData;
  /**
   * Called when the admin clicks "Fix Mapping".
   * The parent (AirbnbPage) should switch the wizard to the CONNECT step so the
   * Channex IFrame reloads on /channels — where the admin can correct the mapping.
   */
  onFix: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * UnmappedRoomModal — full-screen blocking alert for booking_unmapped_room events.
 *
 * Triggered when Channex receives a booking for a listing that has no Room Type
 * mapping in Migo UIT. The booking CANNOT be processed (no availability to
 * decrement, no Room Type to route to) — the admin MUST resolve the mapping
 * discrepancy before any further bookings can be safely accepted.
 *
 * Blocking design:
 *   The modal has no dismiss ("X") button. The only exit is "Fix Mapping",
 *   which drops the admin into the Channex IFrame Channel-connection screen
 *   where the Airbnb listing ↔ Room Type mapping can be corrected.
 *
 * Overbooking risk context:
 *   Until the mapping is fixed, Channex is still accepting bookings from Airbnb.
 *   Each booking_unmapped_room event means one confirmed booking with no
 *   inventory deducted — classic overbooking risk. The modal copy makes this
 *   severity explicit so the admin prioritizes the fix immediately.
 */
export default function UnmappedRoomModal({ event, onFix }: Props) {
  const formattedTime = new Date(event.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    // Full-screen overlay — pointer-events on the backdrop are intentionally
    // blocked (no onClick to dismiss) because this is a critical-action gate.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="unmapped-room-title"
      aria-describedby="unmapped-room-description"
    >
      <div className="relative w-full max-w-lg mx-4 bg-surface-raised rounded-2xl shadow-2xl overflow-hidden">

        {/* ── Critical warning header ─────────────────────────────────────── */}
        <div className="bg-red-600 px-6 py-5 flex items-start gap-3">
          {/* Warning icon */}
          <div className="flex-shrink-0 mt-0.5">
            <svg
              className="w-6 h-6 text-white"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
              />
            </svg>
          </div>

          <div>
            <h2
              id="unmapped-room-title"
              className="text-lg font-bold text-white leading-snug"
            >
              Overbooking Risk Detected
            </h2>
            <p className="text-sm text-red-100 mt-0.5">
              Immediate action required
            </p>
          </div>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="px-6 py-5 space-y-4">
          <p
            id="unmapped-room-description"
            className="text-sm text-content leading-relaxed"
          >
            Airbnb sent a confirmed booking at{' '}
            <span className="font-semibold">{formattedTime}</span>, but the
            listing has no Room Type mapping in Channex. Migo App could not
            decrement availability — <span className="font-semibold text-red-700">
              this property may now be double-booked
            </span>.
          </p>

          {/* ── Event metadata ──────────────────────────────────────────── */}
          <div className="rounded-lg bg-surface-subtle border border-edge divide-y divide-edge text-xs font-mono">
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-content-2 font-sans">Property ID</span>
              <span className="text-content truncate max-w-[200px]">{event.propertyId}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-content-2 font-sans">Revision ID</span>
              <span className="text-content truncate max-w-[200px]">{event.revisionId}</span>
            </div>
          </div>

          {/* ── Resolution instructions ─────────────────────────────────── */}
          <div className="rounded-lg bg-caution-bg border border-caution-text/20 px-4 py-3 text-sm text-caution-text">
            <p className="font-semibold mb-1">How to fix this</p>
            <ol className="list-decimal list-inside space-y-1 text-caution-text">
              <li>Click <strong>Fix Mapping</strong> to open the channel settings</li>
              <li>Locate the Airbnb listing and assign a Room Type</li>
              <li>Save — Channex will re-sync availability within 60 seconds</li>
            </ol>
          </div>
        </div>

        {/* ── Actions ────────────────────────────────────────────────────── */}
        <div className="px-6 pb-6 flex items-center gap-3">
          <button
            type="button"
            onClick={onFix}
            className="flex-1 px-5 py-3 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white text-sm font-semibold rounded-xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
          >
            Fix Mapping
          </button>

          {/* Secondary: contact support link — does NOT dismiss the modal */}
          <a
            href="mailto:support@migo.com?subject=Unmapped+Room+Alert"
            className="flex-shrink-0 px-4 py-3 bg-surface-raised border border-edge hover:bg-surface-subtle text-content text-sm font-medium rounded-xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-edge focus-visible:ring-offset-2"
          >
            Contact Support
          </a>
        </div>
      </div>
    </div>
  );
}

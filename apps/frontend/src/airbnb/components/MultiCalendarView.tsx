import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  limit,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import {
  getListingCalendar,
  pushAvailability,
  pushRestrictions,
  type ListingCalendarDay,
} from '../api/channexApi';

// ─── Constants ────────────────────────────────────────────────────────────────

const WINDOW_DAYS = 30;
const COL_W      = 48;   // px — each date column
const ROOM_COL_W = 192;  // px — sticky room-name column
const ROW_H      = 60;   // px — each room row

// ─── Types ────────────────────────────────────────────────────────────────────

interface RoomRow {
  roomTypeId: string;
  ratePlanId: string;
  title: string;
  otaListingId: string;
}

interface ReservationRecord {
  reservation_id: string;
  ota_listing_id?: string | null;
  room_type_id?: string | null;
  booking_status: string;
  check_in: string;
  check_out: string;
  guest_first_name: string | null;
  guest_last_name: string | null;
  net_payout: number;
  currency: string;
}

interface PanelState {
  open: boolean;
  dateFrom: string;
  dateTo: string;
  /** 1 = available/open, 0 = blocked/closed */
  availability: 0 | 1;
  /** Rooms selected for this update — subset of checkedRoomIds at panel-open time */
  selectedRoomIds: Set<string>;
  /** Optional price override — empty string = no price change */
  price: string;
  saving: boolean;
  error: string | null;
}

interface Toast {
  msg: string;
  ok: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function generateDates(count: number): string[] {
  const result: string[] = [];
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  for (let i = 0; i < count; i++) {
    result.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return result;
}

/** Last occupied night = check_out minus one day */
function prevDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** "Apr 14" */
function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

/** "Apr 14 – Apr 18, 2026" */
function fmtDateRange(from: string, to: string): string {
  const year = new Date(`${to}T00:00:00Z`).getUTCFullYear();
  return `${fmtDate(from)} – ${fmtDate(to)}, ${year}`;
}

/** "Mon" */
function fmtWeekday(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short', timeZone: 'UTC',
  });
}

/** Night count, minimum 1 */
function nightCount(from: string, to: string): number {
  const ms = new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime();
  return Math.max(1, Math.round(ms / 86_400_000));
}

function fmtMoney(amount: number | string | null): string {
  if (amount == null || amount === '') return '';
  const n = Number(amount);
  return Number.isFinite(n) && n > 0 ? String(Math.round(n)) : '';
}

function fmtGuestName(r: ReservationRecord): string {
  const parts = [r.guest_first_name, r.guest_last_name].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : r.reservation_id;
}

function isUnavailableDay(day: ListingCalendarDay | undefined): boolean {
  if (!day) return false;
  const a = String(day.availability ?? '').toLowerCase();
  return a.includes('unavailable') || a.includes('closed') || a === '0' || Boolean(day.stop_sell);
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  /** Channex property UUID — pivot for all Firestore + ARI operations. */
  propertyId: string;
}

/**
 * MultiCalendarView — Gantt-style interactive availability calendar.
 *
 * Grid: Y-axis = synced rooms (from Firestore room_types[]), X-axis = 30-day rolling window.
 *
 * Selection model:
 *   • Left-column checkboxes choose which rooms receive ARI updates.
 *   • Click 1 sets selectionStart and clears selectionEnd.
 *   • Click 2 sets selectionEnd (auto-sorted chronologically) and opens the ARI panel.
 *   • Selection highlighting is date-based (monthly-style), not row-dependent.
 *
 * ARI panel:
 *   • Date range display, Available/Blocked radio, optional price input, room checkboxes.
 *   • Save → parallel pushAvailability (+ pushRestrictions if price is set) per room.
 *   • On success → grid auto-refreshes. On error → toast notification, selection preserved.
 */
export default function MultiCalendarView({ propertyId }: Props) {
  // ── Stable date window ────────────────────────────────────────────────────
  const dates = useRef(generateDates(WINDOW_DAYS)).current;
  const today = todayIso();

  // ── Integration document ──────────────────────────────────────────────────
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [integrationLoading, setIntegrationLoading] = useState(true);
  const [integrationError, setIntegrationError] = useState<string | null>(null);

  // Which rooms are ticked in the left-column checkboxes
  const [checkedRoomIds, setCheckedRoomIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!propertyId) return;
    setIntegrationLoading(true);
    setIntegrationError(null);

    const q = query(
      collection(db, 'channex_integrations'),
      where('channex_property_id', '==', propertyId),
      limit(1),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        if (snap.empty) {
          setIntegrationError('No integration document found for this property.');
          setIntegrationLoading(false);
          return;
        }
        const doc = snap.docs[0];
        const data = doc.data();
        setDocId(doc.id);
        setChannelId((data.channex_channel_id as string) ?? null);

        const rawRooms = ((data.room_types as RoomRow[] | undefined) ?? []).filter(
          (r) => r.otaListingId,
        );
        setRooms(rawRooms);
        // Default: all rooms checked
        setCheckedRoomIds(new Set(rawRooms.map((r) => r.roomTypeId)));
        setIntegrationLoading(false);
      },
      (err) => {
        setIntegrationError(err.message);
        setIntegrationLoading(false);
      },
    );
    return () => unsub();
  }, [propertyId]);

  // ── Listing calendar data ─────────────────────────────────────────────────
  // calendarData[otaListingId][isoDate] = ListingCalendarDay
  const [calendarData, setCalendarData] = useState<
    Record<string, Record<string, ListingCalendarDay>>
  >({});
  const [calendarLoading, setCalendarLoading] = useState(false);

  const refreshCalendar = useCallback(
    (roomList: RoomRow[], chId: string, pid: string) => {
      if (!roomList.length || !chId) return;
      setCalendarLoading(true);
      const dateFrom = dates[0];
      const dateTo = dates[dates.length - 1];

      void Promise.all(
        roomList.map(async (room) => {
          try {
            const res = await getListingCalendar(pid, chId, room.otaListingId, dateFrom, dateTo);
            const byDate: Record<string, ListingCalendarDay> = {};
            for (const day of res.days) {
              if (day.date) byDate[day.date] = day;
            }
            return { key: room.otaListingId, byDate };
          } catch {
            return { key: room.otaListingId, byDate: {} };
          }
        }),
      ).then((results) => {
        const next: Record<string, Record<string, ListingCalendarDay>> = {};
        for (const r of results) next[r.key] = r.byDate;
        setCalendarData(next);
        setCalendarLoading(false);
      });
    },
    [dates],
  );

  useEffect(() => {
    if (channelId && rooms.length && propertyId) {
      refreshCalendar(rooms, channelId, propertyId);
    }
  }, [channelId, rooms, propertyId, refreshCalendar]);

  // ── Reservations (real-time Firestore) ────────────────────────────────────
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);

  useEffect(() => {
    if (!docId) return;
    const ref = collection(db, 'channex_integrations', docId, 'reservations');
    const unsub = onSnapshot(ref, (snap) => {
      setReservations(snap.docs.map((d) => d.data() as ReservationRecord));
    });
    return () => unsub();
  }, [docId]);

  const reservationsByListing = useMemo(() => {
    const map: Record<string, ReservationRecord[]> = {};
    for (const r of reservations) {
      if (r.booking_status === 'cancelled') continue;
      const key = r.ota_listing_id ?? r.room_type_id ?? '__unknown';
      (map[key] ??= []).push(r);
    }
    return map;
  }, [reservations]);

  // ── 2-click selection ─────────────────────────────────────────────────────
  const [selectionStart, setSelectionStart] = useState<string | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<string | null>(null);

  const selectedRange = useMemo((): [string, string] | null => {
    if (!selectionStart) return null;
    if (!selectionEnd) return [selectionStart, selectionStart];
    return selectionStart <= selectionEnd
      ? [selectionStart, selectionEnd]
      : [selectionEnd, selectionStart];
  }, [selectionStart, selectionEnd]);

  const isInSelectedRange = (date: string): boolean =>
    !!selectedRange && date >= selectedRange[0] && date <= selectedRange[1];

  // ── Side panel ────────────────────────────────────────────────────────────
  const [panel, setPanel] = useState<PanelState>({
    open: false,
    dateFrom: '',
    dateTo: '',
    availability: 1,
    selectedRoomIds: new Set(),
    price: '',
    saving: false,
    error: null,
  });

  // ── Toast ─────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((msg: string, ok: boolean) => {
    setToast({ msg, ok });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  // ── Interaction handlers ──────────────────────────────────────────────────

  const handleCellClick = useCallback(
    (date: string) => {
      if (panel.saving) return; // block interaction during in-flight save

      if (!selectionStart || selectionEnd) {
        // Click 1 — start a fresh selection.
        setSelectionStart(date);
        setSelectionEnd(null);
        setPanel((p) => ({ ...p, open: false }));
      } else {
        // Click 2 — close range and ensure start <= end.
        const [from, to] = selectionStart <= date
          ? [selectionStart, date]
          : [date, selectionStart];
        setSelectionStart(from);
        setSelectionEnd(to);

        // Default price: first checked room's price on the start date
        const firstRoom = rooms.find((r) => checkedRoomIds.has(r.roomTypeId));
        const rawPrice = firstRoom
          ? (calendarData[firstRoom.otaListingId]?.[from]?.daily_price ?? '')
          : '';
        const defaultPrice = rawPrice !== '' ? fmtMoney(rawPrice) : '';

        setPanel({
          open: true,
          dateFrom: from,
          dateTo: to,
          availability: 1,
          selectedRoomIds: new Set(checkedRoomIds),
          price: defaultPrice,
          saving: false,
          error: null,
        });
      }
    },
    [selectionStart, selectionEnd, rooms, checkedRoomIds, calendarData, panel.saving],
  );

  const closePanel = useCallback(() => {
    setPanel((p) => ({ ...p, open: false }));
    setSelectionStart(null);
    setSelectionEnd(null);
  }, []);

  const toggleLeftCheckbox = useCallback((roomTypeId: string) => {
    setCheckedRoomIds((prev) => {
      const next = new Set(prev);
      if (next.has(roomTypeId)) next.delete(roomTypeId);
      else next.add(roomTypeId);
      return next;
    });
  }, []);

  const togglePanelRoom = useCallback((roomTypeId: string) => {
    setPanel((p) => {
      const next = new Set(p.selectedRoomIds);
      if (next.has(roomTypeId)) next.delete(roomTypeId);
      else next.add(roomTypeId);
      return { ...p, selectedRoomIds: next };
    });
  }, []);

  /**
   * Executes the bulk ARI update:
   *   • POST /availability for each selected room (always)
   *   • POST /restrictions for each selected room (only when a price is entered)
   *
   * On success: grid refreshes silently + panel closes.
   * On failure: toast notification + panel stays open, grid NOT refreshed.
   */
  const handleSave = useCallback(async () => {
    const selectedRooms = rooms.filter((r) => panel.selectedRoomIds.has(r.roomTypeId));
    if (!selectedRooms.length) return;

    setPanel((p) => ({ ...p, saving: true, error: null }));

    const priceFloat = parseFloat(panel.price.replace(/[^0-9.]/g, ''));
    const hasPrice = Number.isFinite(priceFloat) && priceFloat > 0;

    try {
      await Promise.all(
        selectedRooms.flatMap((room) => {
          const ops: Promise<{ status: 'ok' }>[] = [
            pushAvailability(propertyId, {
              room_type_id: room.roomTypeId,
              date_from: panel.dateFrom,
              date_to: panel.dateTo,
              availability: panel.availability,
            }),
          ];

          if (hasPrice) {
            ops.push(
              pushRestrictions(propertyId, {
                rate_plan_id: room.ratePlanId,
                date_from: panel.dateFrom,
                date_to: panel.dateTo,
                rate: priceFloat.toFixed(2),
              }),
            );
          }

          return ops;
        }),
      );

      // Success: refresh grid + close panel
      if (channelId) refreshCalendar(rooms, channelId, propertyId);
      setPanel((p) => ({ ...p, saving: false, open: false }));
      setSelectionStart(null);
      setSelectionEnd(null);

      const label = panel.availability === 1 ? 'opened' : 'blocked';
      const count = selectedRooms.length;
      showToast(
        `${count} room${count !== 1 ? 's' : ''} ${label} for ${fmtDateRange(panel.dateFrom, panel.dateTo)}`,
        true,
      );
    } catch (err) {
      // Error: toast + keep panel open + keep selection — do NOT refresh grid
      const msg = err instanceof Error ? err.message : 'Save failed. Please try again.';
      setPanel((p) => ({ ...p, saving: false, error: msg }));
      showToast(msg, false);
    }
  }, [rooms, panel, propertyId, channelId, refreshCalendar, showToast]);

  // ── Reservation bar geometry helper ──────────────────────────────────────
  /** Column index in [0, WINDOW_DAYS-1], null if completely off-screen right */
  const dateToClamped = (iso: string): number | null => {
    if (iso > dates[dates.length - 1]) return null;
    if (iso < dates[0]) return 0;
    const idx = dates.indexOf(iso);
    return idx >= 0 ? idx : null;
  };

  // ── Early returns ─────────────────────────────────────────────────────────

  if (integrationLoading) {
    return (
      <div className="rounded-2xl border border-edge bg-surface-raised p-8 text-center text-sm text-content-2">
        Loading rooms and availability…
      </div>
    );
  }

  if (integrationError) {
    return (
      <div className="rounded-2xl border border-danger-text/20 bg-danger-bg p-6 text-sm text-danger-text">
        <span className="font-semibold">Error: </span>{integrationError}
      </div>
    );
  }

  if (!rooms.length) {
    return (
      <div className="rounded-2xl border border-caution-text/20 bg-caution-bg p-6 text-sm text-caution-text">
        No synced rooms found. Complete the mapping step first.
      </div>
    );
  }

  const allChecked = rooms.every((r) => checkedRoomIds.has(r.roomTypeId));
  const someChecked = rooms.some((r) => checkedRoomIds.has(r.roomTypeId));
  const calendarWidth = ROOM_COL_W + WINDOW_DAYS * COL_W;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="relative space-y-4">

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-content">Availability &amp; Rates</h2>
          <p className="text-sm text-content-2">
            {selectionStart && !selectionEnd
              ? 'Click a second date to set the end of your selection.'
              : 'Tick rooms in the left column, then click two dates to select a range.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {calendarLoading && (
            <span className="inline-flex items-center gap-1.5 text-content-3">
              <span className="h-3 w-3 rounded-full border-2 border-edge border-t-content-2 animate-spin" />
              Refreshing…
            </span>
          )}
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700 border border-emerald-200">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> Available
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-subtle px-2.5 py-1 text-content-2 border border-edge">
            <span className="h-2 w-2 rounded-full bg-content-3" /> Blocked
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-notice-bg px-2.5 py-1 text-notice-text border border-notice-text/20">
            <span className="h-2 w-2 rounded-full bg-notice-text" /> Reservation
          </span>
        </div>
      </div>

      {/* ── Live selection hint ────────────────────────────────────────────── */}
      {selectionStart && !selectionEnd && (
        <div className="flex justify-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-caution-text/30 bg-caution-bg px-4 py-1.5 text-sm text-caution-text">
            <span className="h-2 w-2 rounded-full bg-caution-text animate-pulse" />
            Start: <strong>{fmtDate(selectionStart)}</strong>
            <span className="text-orange-500 text-xs">Click another date to finish the range.</span>
          </div>
        </div>
      )}

      {/* ── Main layout: Calendar + optional ARI panel ──────────────────────── */}
      <div className="flex gap-4 items-start">

        {/* ── Calendar grid ─────────────────────────────────────────────────── */}
        <div
          className="flex-1 overflow-x-auto rounded-2xl border border-edge bg-surface-raised shadow-sm select-none cursor-pointer"
          onMouseDown={(e) => e.preventDefault()}
        >
          <div style={{ minWidth: calendarWidth }}>

            {/* ── Header row ──────────────────────────────────────────────── */}
            <div className="flex border-b border-edge bg-surface-subtle" style={{ height: 48 }}>

              {/* Room column header with select-all checkbox */}
              <div
                className="flex-shrink-0 sticky left-0 z-20 flex items-center gap-2 bg-surface-subtle px-3 border-r border-edge"
                style={{ width: ROOM_COL_W }}
              >
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={(el) => {
                    if (el) el.indeterminate = !allChecked && someChecked;
                  }}
                  onChange={() =>
                    setCheckedRoomIds(
                      allChecked ? new Set() : new Set(rooms.map((r) => r.roomTypeId)),
                    )
                  }
                  className="h-3.5 w-3.5 rounded accent-rose-600 cursor-pointer flex-shrink-0"
                />
                <span className="text-xs font-semibold uppercase tracking-wider text-content-2 truncate">
                  Rooms
                </span>
              </div>

              {/* Date headers */}
              {dates.map((date) => {
                const isToday = date === today;
                return (
                  <div
                    key={date}
                    className={[
                      'flex-shrink-0 flex flex-col items-center justify-center border-r border-edge last:border-r-0',
                      isToday ? 'bg-brand-subtle' : '',
                    ].join(' ')}
                    style={{ width: COL_W }}
                  >
                    <span className={`text-[10px] font-medium ${isToday ? 'text-brand' : 'text-content-3'}`}>
                      {fmtWeekday(date)}
                    </span>
                    <span className={`text-[11px] font-bold leading-tight ${isToday ? 'text-brand' : 'text-content'}`}>
                      {new Date(`${date}T00:00:00Z`).getUTCDate()}
                    </span>
                    {isToday && <span className="mt-0.5 h-1 w-1 rounded-full bg-brand" />}
                  </div>
                );
              })}
            </div>

            {/* ── Room rows ───────────────────────────────────────────────── */}
            {rooms.map((room) => {
              const roomReservations = reservationsByListing[room.otaListingId] ?? [];
              const isChecked = checkedRoomIds.has(room.roomTypeId);

              return (
                <div
                  key={room.roomTypeId}
                  className="flex border-b border-edge last:border-b-0 relative"
                  style={{ height: ROW_H }}
                >
                  {/* ── Sticky room name cell with checkbox ─────────────── */}
                  <div
                    className={[
                      'flex-shrink-0 sticky left-0 z-10 flex items-center gap-2.5 border-r border-edge px-3 transition-colors',
                      isChecked ? 'bg-surface-raised' : 'bg-surface-subtle/80',
                    ].join(' ')}
                    style={{ width: ROOM_COL_W }}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleLeftCheckbox(room.roomTypeId)}
                      className="h-3.5 w-3.5 rounded accent-rose-600 cursor-pointer flex-shrink-0"
                    />
                    <div className="min-w-0">
                      <p
                        className={`text-xs font-semibold truncate leading-tight ${isChecked ? 'text-content' : 'text-content-2'}`}
                        title={room.title}
                      >
                        {room.title}
                      </p>
                      <p className="text-[10px] text-content-3 truncate mt-0.5">
                        {room.otaListingId}
                      </p>
                    </div>
                  </div>

                  {/* ── Date cells ──────────────────────────────────────── */}
                  {dates.map((date) => {
                    const dateString = date;
                    const dayNumber = new Date(`${dateString}T00:00:00Z`).getUTCDate();
                    const calDay = calendarData[room.otaListingId]?.[date];
                    const unavail = isUnavailableDay(calDay);
                    const isSelected = isInSelectedRange(dateString);
                    const price = fmtMoney(calDay?.daily_price ?? null);

                    return (
                      <div
                        key={dateString}
                        className={[
                          'relative flex flex-col p-2 border-r border-b border-edge cursor-pointer select-none transition-colors h-24',
                          isSelected
                            ? 'bg-notice-bg border-notice-text ring-2 ring-inset ring-notice-text z-10'
                            : 'bg-surface-raised hover:bg-surface-subtle',
                          panel.saving ? 'cursor-not-allowed' : '',
                          unavail && !isSelected ? 'bg-surface-subtle' : '',
                          !isChecked ? 'opacity-50' : '',
                        ].join(' ')}
                        style={{ width: COL_W }}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleCellClick(dateString)}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full pointer-events-none ${unavail ? 'bg-slate-300' : 'bg-emerald-400'}`}
                        />
                        <span className="pointer-events-none font-medium text-sm text-content leading-none mt-1">
                          {dayNumber}
                        </span>
                        <span className="pointer-events-none mt-1 text-xs text-content-2">
                          {price ? `USD ${price}` : 'USD —'}
                        </span>
                      </div>
                    );
                  })}

                  {/* ── Reservation bars (absolutely positioned) ──────── */}
                  {roomReservations.map((r) => {
                    const lastNight = prevDay(r.check_out);
                    const startCol  = dateToClamped(r.check_in);
                    const endCol    = dateToClamped(lastNight);

                    if (startCol === null || endCol === null) return null;
                    if (r.check_out <= dates[0]) return null;
                    if (startCol > WINDOW_DAYS - 1) return null;

                    const cs = Math.max(0, startCol);
                    const ce = Math.min(WINDOW_DAYS - 1, endCol);
                    if (ce < cs) return null;

                    const barLeft  = ROOM_COL_W + cs * COL_W + 2;
                    const barWidth = (ce - cs + 1) * COL_W - 4;

                    return (
                      <div
                        key={r.reservation_id}
                        title={`${fmtGuestName(r)} · ${r.check_in} – ${r.check_out}`}
                        className="absolute flex items-center overflow-hidden rounded-md bg-notice-text px-2 text-white shadow-sm pointer-events-none select-none"
                        style={{ left: barLeft, width: barWidth, top: 9, height: ROW_H - 18, zIndex: 5 }}
                      >
                        <span className="truncate text-[11px] font-medium">{fmtGuestName(r)}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── ARI Control Panel ───────────────────────────────────────────── */}
        {panel.open && (
          <div className="w-76 flex-shrink-0 rounded-2xl border border-edge bg-surface-raised shadow-lg flex flex-col overflow-hidden" style={{ width: 296 }}>

            {/* Panel header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-edge">
              <div>
                <h3 className="text-sm font-semibold text-content">Edit Availability</h3>
                <p className="text-xs text-content-3 mt-0.5">
                  {panel.selectedRoomIds.size} listing{panel.selectedRoomIds.size !== 1 ? 's' : ''} selected
                </p>
              </div>
              <button
                type="button"
                onClick={closePanel}
                disabled={panel.saving}
                className="text-content-3 hover:text-content-2 transition-colors rounded-md p-0.5 hover:bg-surface-subtle disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Panel scrollable body */}
            <fieldset disabled={panel.saving} className="flex-1 overflow-y-auto px-5 py-4 space-y-5 disabled:opacity-60">

              {/* ── Date range summary ──────────────────────────────────── */}
              <div className="rounded-xl border border-edge bg-surface-subtle px-4 py-3">
                <p className="text-sm font-semibold text-content">
                  {fmtDateRange(panel.dateFrom, panel.dateTo)}
                </p>
                <p className="text-xs text-content-2 mt-0.5">
                  {nightCount(panel.dateFrom, panel.dateTo)} night
                  {nightCount(panel.dateFrom, panel.dateTo) !== 1 ? 's' : ''}
                  {' '}·{' '}
                  {panel.selectedRoomIds.size} room{panel.selectedRoomIds.size !== 1 ? 's' : ''}
                </p>
              </div>

              {/* ── Availability radio ───────────────────────────────────── */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-content-3 mb-2">
                  Availability
                </p>
                <div className="space-y-2">
                  {([
                    {
                      value: 1 as const,
                      label: 'Available',
                      desc: 'Open for new bookings',
                      active: 'border-emerald-300 bg-emerald-50',
                      dot: 'bg-emerald-500',
                    },
                    {
                      value: 0 as const,
                      label: 'Blocked',
                      desc: 'Close dates on Airbnb',
                      active: 'border-slate-300 bg-slate-100',
                      dot: 'bg-slate-400',
                    },
                  ]).map(({ value, label, desc, active, dot }) => (
                    <label
                      key={value}
                      className={[
                        'flex items-center gap-3 rounded-xl border px-3.5 py-3 cursor-pointer transition-colors',
                        panel.availability === value ? active : 'border-edge bg-surface-raised hover:bg-surface-subtle',
                      ].join(' ')}
                    >
                      <input
                        type="radio"
                        name="availability"
                        value={value}
                        checked={panel.availability === value}
                        onChange={() => setPanel((p) => ({ ...p, availability: value }))}
                        className="sr-only"
                      />
                      <span className={`h-3 w-3 rounded-full flex-shrink-0 ${panel.availability === value ? dot : 'bg-slate-200'}`} />
                      <div>
                        <p className="text-sm font-semibold text-content">{label}</p>
                        <p className="text-xs text-content-2">{desc}</p>
                      </div>
                      {panel.availability === value && (
                        <svg className="w-4 h-4 text-content ml-auto flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                        </svg>
                      )}
                    </label>
                  ))}
                </div>
              </div>

              {/* ── Price input (optional) ───────────────────────────────── */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-content-3 mb-2">
                  Daily price <span className="normal-case font-normal text-content-3">(optional)</span>
                </p>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-content-3 font-medium select-none">
                    $
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Leave blank to keep current"
                    value={panel.price}
                    onChange={(e) => setPanel((p) => ({ ...p, price: e.target.value }))}
                    className="w-full rounded-xl border border-edge bg-surface-raised pl-7 pr-4 py-2.5 text-sm text-content placeholder:text-content-3 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-transparent transition"
                  />
                </div>
                {panel.price && (
                  <p className="mt-1 text-xs text-content-2">
                    Updates nightly rate via the Channex restrictions API.
                  </p>
                )}
              </div>

              {/* ── Room checkboxes ──────────────────────────────────────── */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-content-3">
                    Apply to rooms
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPanel((p) => ({ ...p, selectedRoomIds: new Set(rooms.map((r) => r.roomTypeId)) }))}
                      className="text-[11px] text-rose-600 hover:underline"
                    >
                      All
                    </button>
                    <span className="text-content-3">·</span>
                    <button
                      type="button"
                      onClick={() => setPanel((p) => ({ ...p, selectedRoomIds: new Set() }))}
                      className="text-[11px] text-content-2 hover:underline"
                    >
                      None
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  {rooms.map((room) => {
                    const calDay = calendarData[room.otaListingId]?.[panel.dateFrom];
                    const price  = fmtMoney(calDay?.daily_price ?? null);
                    const unavail = isUnavailableDay(calDay);
                    const sel = panel.selectedRoomIds.has(room.roomTypeId);

                    return (
                      <label
                        key={room.roomTypeId}
                        className={[
                          'flex items-center gap-2.5 rounded-lg px-3 py-2 cursor-pointer transition-colors',
                          sel ? 'bg-rose-50' : 'hover:bg-surface-subtle',
                        ].join(' ')}
                      >
                        <input
                          type="checkbox"
                          checked={sel}
                          onChange={() => togglePanelRoom(room.roomTypeId)}
                          className="h-4 w-4 rounded accent-rose-600 cursor-pointer flex-shrink-0"
                        />
                        <span
                          className={`h-2 w-2 rounded-full flex-shrink-0 ${unavail ? 'bg-slate-300' : 'bg-emerald-400'}`}
                        />
                        <span className="flex-1 text-xs font-medium text-content truncate" title={room.title}>
                          {room.title}
                        </span>
                        {price && (
                          <span className="text-[10px] text-content-3 flex-shrink-0">${price}</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* ── Inline error (persistent, complements the toast) ─────── */}
              {panel.error && (
                <div className="rounded-xl border border-danger-text/20 bg-danger-bg px-3.5 py-3 text-xs text-danger-text flex gap-2">
                  <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                  </svg>
                  <span><span className="font-semibold">Save failed: </span>{panel.error}</span>
                </div>
              )}
            </fieldset>

            {/* ── Panel footer ────────────────────────────────────────────── */}
            <div className="px-5 py-4 border-t border-edge">
              <button
                type="button"
                disabled={panel.saving || !panel.selectedRoomIds.size}
                onClick={() => void handleSave()}
                className={[
                  'w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-colors',
                  panel.saving || !panel.selectedRoomIds.size
                    ? 'bg-surface-subtle text-content-3 cursor-not-allowed'
                    : 'bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white',
                ].join(' ')}
              >
                {panel.saving ? (
                  <>
                    <span className="h-4 w-4 rounded-full border-2 border-rose-300 border-t-white animate-spin" />
                    Saving…
                  </>
                ) : (
                  `Save — ${panel.availability === 1 ? 'Open' : 'Block'} ${panel.selectedRoomIds.size} room${panel.selectedRoomIds.size !== 1 ? 's' : ''}`
                )}
              </button>
              {panel.saving && (
                <p className="text-center text-[11px] text-content-3 mt-2">
                  Sending to Channex, please wait…
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Toast notification ──────────────────────────────────────────────── */}
      {toast && (
        <div
          className={[
            'fixed bottom-6 right-6 z-50 flex items-start gap-3 rounded-2xl px-5 py-3.5 shadow-xl max-w-sm',
            'animate-[fadeInUp_0.2s_ease-out]',
            toast.ok
              ? 'bg-ok-bg text-ok-text'
              : 'bg-danger-bg text-danger-text',
          ].join(' ')}
          role="status"
          aria-live="polite"
        >
          {toast.ok ? (
            <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          ) : (
            <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9.303 3.376c.866 1.5-.217 3.374-1.948 3.374H4.645c-1.73 0-2.813-1.874-1.948-3.374L10.051 3.378c.866-1.5 3.032-1.5 3.898 0L21.303 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
          )}
          <p className="text-sm font-medium leading-snug">{toast.msg}</p>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="ml-auto -mr-1 flex-shrink-0 rounded-lg p-0.5 opacity-75 hover:opacity-100 transition-opacity"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

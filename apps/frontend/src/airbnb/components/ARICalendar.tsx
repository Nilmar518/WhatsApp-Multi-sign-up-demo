import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection,
  onSnapshot,
  query,
} from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { ListingCalendarDay } from '../api/channexApi';
import type { ActiveProperty } from '../../integrations/airbnb/AirbnbIntegration';

interface Props {
  integrationDocId: string | null;
  activeProperty: ActiveProperty | null;
}

interface ReservationRecord {
  reservation_id: string;
  ota_listing_id?: string | null;
  room_type_id?: string | null;
  booking_status: 'new' | 'modified' | 'cancelled';
  check_in: string;
  check_out: string;
  guest_first_name: string | null;
  guest_last_name: string | null;
  net_payout: number;
  currency: string;
}

interface ReservationSegment {
  reservation: ReservationRecord;
  colStart: number;
  colEnd: number;
  lane: number;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function parseIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function startOfMonthUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfMonthUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function dateDiffInDays(from: Date, to: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((to.getTime() - from.getTime()) / msPerDay);
}

function formatGuestName(reservation: ReservationRecord): string {
  const parts = [reservation.guest_first_name, reservation.guest_last_name].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : reservation.reservation_id;
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

async function fetchListingCalendarDays(
  activeProperty: ActiveProperty,
  dateFrom: string,
  dateTo: string,
): Promise<ListingCalendarDay[]> {
  const search = new URLSearchParams({
    date_from: dateFrom,
    date_to: dateTo,
  });

  const url =
    `/api/channex/properties/${encodeURIComponent(activeProperty.channex_property_id)}` +
    `/channels/${encodeURIComponent(activeProperty.channex_channel_id)}` +
    `/listings/${encodeURIComponent(activeProperty.airbnb_listing_id)}/calendar?${search.toString()}`;

  const response = await fetch(url);
  const body = await response
    .json()
    .catch(() => ({ message: 'Failed to parse calendar response.' })) as
      | ListingCalendarDay[]
      | { days?: ListingCalendarDay[]; calendar?: { days?: ListingCalendarDay[] }; message?: string | string[] };

  if (!response.ok) {
    const message = Array.isArray((body as { message?: string | string[] }).message)
      ? (body as { message: string[] }).message.join('; ')
      : (body as { message?: string }).message ?? `HTTP ${response.status}`;
    throw new Error(message);
  }

  if (Array.isArray(body)) {
    return body;
  }

  if (Array.isArray(body.days)) {
    return body.days;
  }

  if (Array.isArray(body.calendar?.days)) {
    return body.calendar.days;
  }

  return [];
}

async function pushAvailabilityUpdate(
  activeProperty: ActiveProperty,
  payload: {
    property_id: string;
    room_type_id: string;
    rate_plan_id: string;
    date_from: string;
    date_to: string;
    availability: number;
  },
): Promise<void> {
  const url = `/api/channex/properties/${encodeURIComponent(activeProperty.channex_property_id)}/availability`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      updates: [{
        room_type_id: payload.room_type_id,
        date_from: payload.date_from,
        date_to: payload.date_to,
        availability: payload.availability,
      }],
    }),
  });

  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ message: `HTTP ${response.status}` })) as { message?: string | string[] };
    const message = Array.isArray(body.message) ? body.message.join('; ') : (body.message ?? `HTTP ${response.status}`);
    throw new Error(message);
  }
}

function getReservationSegmentsForWeek(
  reservations: ReservationRecord[],
  weekDates: Date[],
): ReservationSegment[] {
  const weekStart = weekDates[0];
  const weekEnd = weekDates[6];
  const overlapping = reservations
    .filter((reservation) => reservation.booking_status !== 'cancelled')
    .map((reservation) => {
      const checkIn = parseIsoDate(reservation.check_in);
      const occupiedEnd = addDays(parseIsoDate(reservation.check_out), -1);

      if (occupiedEnd < weekStart || checkIn > weekEnd) {
        return null;
      }

      const segmentStart = checkIn > weekStart ? checkIn : weekStart;
      const segmentEnd = occupiedEnd < weekEnd ? occupiedEnd : weekEnd;
      const colStart = dateDiffInDays(weekStart, segmentStart) + 1;
      const colEnd = dateDiffInDays(weekStart, segmentEnd) + 1;

      return {
        reservation,
        colStart,
        colEnd,
      };
    })
    .filter(
      (segment): segment is Omit<ReservationSegment, 'lane'> => Boolean(segment),
    )
    .sort((a, b) => (a.colStart === b.colStart ? b.colEnd - a.colEnd : a.colStart - b.colStart));

  const laneEnds: number[] = [];

  return overlapping.map((segment) => {
    let lane = laneEnds.findIndex((endCol) => segment.colStart > endCol);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(segment.colEnd);
    } else {
      laneEnds[lane] = segment.colEnd;
    }

    return {
      ...segment,
      lane,
    };
  });
}

export default function ARICalendar({ integrationDocId, activeProperty }: Props) {
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => startOfMonthUtc(new Date()));
  const [calendarDays, setCalendarDays] = useState<Record<string, ListingCalendarDay>>({});
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [activeReservationId, setActiveReservationId] = useState<string | null>(null);
  const [selectionStart, setSelectionStart] = useState<string | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<string | null>(null);
  const [showARIControlPanel, setShowARIControlPanel] = useState(false);
  const [selectedAvailability, setSelectedAvailability] = useState<0 | 1>(1);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [reservationsLoading, setReservationsLoading] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [reservationsError, setReservationsError] = useState<string | null>(null);

  const monthStart = useMemo(() => startOfMonthUtc(visibleMonth), [visibleMonth]);
  const monthEnd = useMemo(() => endOfMonthUtc(visibleMonth), [visibleMonth]);
  const gridStart = useMemo(() => addDays(monthStart, -monthStart.getUTCDay()), [monthStart]);
  const gridEnd = useMemo(() => addDays(monthEnd, 6 - monthEnd.getUTCDay()), [monthEnd]);

  const calendarDates = useMemo(() => {
    const dates: Date[] = [];
    for (
      let cursor = new Date(gridStart);
      cursor <= gridEnd;
      cursor = addDays(cursor, 1)
    ) {
      dates.push(new Date(cursor));
    }
    return dates;
  }, [gridEnd, gridStart]);

  const weeks = useMemo(() => {
    const rows: Date[][] = [];
    for (let i = 0; i < calendarDates.length; i += 7) {
      rows.push(calendarDates.slice(i, i + 7));
    }
    return rows;
  }, [calendarDates]);

  useEffect(() => {
    if (!activeProperty?.channex_property_id || !activeProperty.channex_channel_id || !activeProperty.airbnb_listing_id) {
      setCalendarDays({});
      return;
    }

    let active = true;
    setCalendarLoading(true);
    setCalendarError(null);

    void fetchListingCalendarDays(activeProperty, isoDate(monthStart), isoDate(monthEnd))
      .then((days) => {
        if (!active) return;

        const byDate = days.reduce<Record<string, ListingCalendarDay>>((acc, day) => {
          if (day.date) acc[day.date] = day;
          return acc;
        }, {});

        setCalendarDays(byDate);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setCalendarError(error instanceof Error ? error.message : 'Failed to load listing calendar.');
      })
      .finally(() => {
        if (active) setCalendarLoading(false);
      });

    return () => {
      active = false;
    };
  }, [activeProperty?.channex_property_id, activeProperty?.channex_channel_id, activeProperty?.airbnb_listing_id, monthEnd, monthStart]);

  useEffect(() => {
    if (!integrationDocId || !activeProperty?.channex_property_id) {
      setReservations([]);
      return;
    }

    setReservationsLoading(true);
    setReservationsError(null);

    // 1:1 model: bookings live at properties/{channexPropertyId}/bookings — no
    // parent doc lookup needed; the integration doc ID is passed in directly.
    const bookingsRef = collection(
      db,
      'channex_integrations',
      integrationDocId,
      'properties',
      activeProperty.channex_property_id,
      'bookings',
    );

    const unsubscribe = onSnapshot(
      query(bookingsRef),
      (snapshot) => {
        const next = snapshot.docs
          .map((d) => d.data() as ReservationRecord)
          .sort((a, b) => a.check_in.localeCompare(b.check_in));
        setReservations(next);
        setReservationsLoading(false);
      },
      (error) => {
        setReservationsError(error.message);
        setReservationsLoading(false);
      },
    );

    return () => unsubscribe();
  }, [integrationDocId, activeProperty?.channex_property_id]);

  const monthLabel = useMemo(
    () =>
      visibleMonth.toLocaleString(undefined, {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }),
    [visibleMonth],
  );

  const totalNightsBooked = useMemo(
    () =>
      reservations.reduce((sum, reservation) => {
        if (reservation.booking_status === 'cancelled') return sum;
        const nights = dateDiffInDays(parseIsoDate(reservation.check_in), parseIsoDate(reservation.check_out));
        return sum + Math.max(nights, 0);
      }, 0),
    [reservations],
  );

  const activeReservation = useMemo(
    () => reservations.find((reservation) => reservation.reservation_id === activeReservationId) ?? null,
    [activeReservationId, reservations],
  );

  const selectedRange = useMemo((): [string, string] | null => {
    if (!selectionStart) return null;
    if (!selectionEnd) return [selectionStart, selectionStart];
    return selectionStart <= selectionEnd
      ? [selectionStart, selectionEnd]
      : [selectionEnd, selectionStart];
  }, [selectionEnd, selectionStart]);

  const isInSelectedRange = useCallback(
    (dateString: string): boolean =>
      Boolean(selectedRange && dateString >= selectedRange[0] && dateString <= selectedRange[1]),
    [selectedRange],
  );

  const handleCellClick = useCallback(
    (dateString: string) => {
      if (!selectionStart || selectionEnd) {
        setSelectionStart(dateString);
        setSelectionEnd(null);
        setShowARIControlPanel(false);
        setSaveError(null);
        return;
      }

      if (dateString >= selectionStart) {
        setSelectionEnd(dateString);
      } else {
        setSelectionEnd(selectionStart);
        setSelectionStart(dateString);
      }
      setShowARIControlPanel(true);
      setSaveError(null);
    },
    [selectionEnd, selectionStart],
  );

  const handleSaveARI = useCallback(async () => {
    if (!activeProperty || !selectionStart || !selectionEnd) return;

    const [dateFrom, dateTo] =
      selectionStart <= selectionEnd
        ? [selectionStart, selectionEnd]
        : [selectionEnd, selectionStart];

    setIsSaving(true);
    setSaveError(null);

    try {
      const payload = {
        property_id: activeProperty.channex_property_id,
        room_type_id: activeProperty.channex_room_type_id,
        rate_plan_id: activeProperty.channex_rate_plan_id,
        date_from: dateFrom,
        date_to: dateTo,
        availability: selectedAvailability,
      };

      await pushAvailabilityUpdate(activeProperty, payload);

      const refreshedDays = await fetchListingCalendarDays(activeProperty, isoDate(monthStart), isoDate(monthEnd));

      const byDate = refreshedDays.reduce<Record<string, ListingCalendarDay>>((acc, day) => {
        if (day.date) acc[day.date] = day;
        return acc;
      }, {});
      setCalendarDays(byDate);

      setShowARIControlPanel(false);
      setSelectionStart(null);
      setSelectionEnd(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to save availability update.');
    } finally {
      setIsSaving(false);
    }
  }, [
    activeProperty,
    monthEnd,
    monthStart,
    selectedAvailability,
    selectionEnd,
    selectionStart,
  ]);

  const moveMonth = (delta: number) => {
    setVisibleMonth((current) =>
      new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + delta, 1)),
    );
  };

  const canRenderCalendar = Boolean(
    activeProperty &&
      activeProperty.channex_property_id &&
      activeProperty.channex_channel_id &&
      activeProperty.airbnb_listing_id,
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-edge bg-surface-raised shadow-sm">
      <div className="border-b border-edge bg-surface-subtle px-6 py-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold text-content">Inventory and Rates</h2>
              <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-emerald-700">
                Mapped to Airbnb
              </span>
            </div>
            <p className="mt-1 text-sm text-content-2">
              Daily Channex ARI data with reservation overlays from Firestore.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs text-content-2 sm:grid-cols-4">
            <div className="rounded-xl border border-edge bg-surface-raised px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.12em] text-content-2">Listing</p>
              <p className="mt-1 truncate font-semibold text-content">
                {activeProperty?.title || 'Select listing'}
              </p>
            </div>
            <div className="rounded-xl border border-edge bg-surface-raised px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.12em] text-content-2">Capacity</p>
              <p className="mt-1 font-semibold text-content">
                {activeProperty?.capacity ?? '-'}
              </p>
            </div>
            <div className="rounded-xl border border-edge bg-surface-raised px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.12em] text-content-2">Default Price</p>
              <p className="mt-1 font-semibold text-content">
                {activeProperty?.default_price != null && activeProperty.currency
                  ? formatMoney(activeProperty.default_price, activeProperty.currency)
                  : '-'}
              </p>
            </div>
            <div className="rounded-xl border border-edge bg-surface-raised px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.12em] text-content-2">Booked Nights</p>
              <p className="mt-1 font-semibold text-content">{totalNightsBooked}</p>
            </div>
          </div>
        </div>

        {activeProperty && (
          <div className="mt-3 rounded-xl border border-edge bg-surface-raised px-4 py-3">
            <p className="text-sm font-semibold text-content">{activeProperty.title}</p>
            <p className="mt-1 text-xs text-content-2">Room Type ID: {activeProperty.channex_room_type_id}</p>
          </div>
        )}
      </div>

      {!canRenderCalendar && (
        <div className="px-6 py-10 text-center text-sm text-content-2">
          Select a synced listing from the sidebar to load the calendar view.
        </div>
      )}

      {canRenderCalendar && (
        <div className="space-y-4 px-4 py-4 sm:px-6 sm:py-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 rounded-xl border border-edge bg-surface-raised p-1">
              <button
                type="button"
                onClick={() => moveMonth(-1)}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-content transition hover:bg-surface-subtle"
              >
                Prev
              </button>
              <div className="min-w-36 px-2 text-center text-sm font-semibold text-content">
                {monthLabel}
              </div>
              <button
                type="button"
                onClick={() => moveMonth(1)}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-content transition hover:bg-surface-subtle"
              >
                Next
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> Available
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">
                <span className="h-2 w-2 rounded-full bg-slate-400" /> Unavailable
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-notice-bg px-2.5 py-1 text-notice-text">
                <span className="h-2 w-2 rounded-full bg-notice-text" /> Reservation
              </span>
            </div>
          </div>

          {calendarError && (
            <div className="rounded-xl border border-danger-text/20 bg-danger-bg px-4 py-3 text-sm text-danger-text">
              {calendarError}
            </div>
          )}

          {reservationsError && (
            <div className="rounded-xl border border-danger-text/20 bg-danger-bg px-4 py-3 text-sm text-danger-text">
              {reservationsError}
            </div>
          )}

          {(calendarLoading || reservationsLoading) && (
            <div className="rounded-xl border border-edge bg-surface-subtle px-4 py-3 text-sm text-content-2">
              Loading calendar and reservations...
            </div>
          )}

          {activeReservation && (
            <div className="rounded-xl border border-notice-text/20 bg-notice-bg px-4 py-3 text-sm text-notice-text">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{formatGuestName(activeReservation)}</p>
                  <p className="mt-1 text-xs">
                    {activeReservation.check_in} to {activeReservation.check_out} - {formatMoney(activeReservation.net_payout, activeReservation.currency)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveReservationId(null)}
                  className="rounded-md border border-notice-text/20 bg-surface-raised px-2 py-1 text-xs font-semibold text-notice-text"
                >
                  Close
                </button>
              </div>
            </div>
          )}

          <div
            className="overflow-hidden rounded-2xl border border-edge bg-surface-raised select-none"
            onMouseDown={(e) => e.preventDefault()}
          >
            <div className="grid grid-cols-7 border-b border-edge bg-surface-subtle">
              {WEEKDAY_LABELS.map((weekday) => (
                <div
                  key={weekday}
                  className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-[0.12em] text-content-2"
                >
                  {weekday}
                </div>
              ))}
            </div>

            <div className="divide-y divide-edge">
              {weeks.map((weekDates) => {
                const weekKey = isoDate(weekDates[0]);
                const segments = getReservationSegmentsForWeek(reservations, weekDates);

                return (
                  <div key={weekKey} className="relative">
                    <div className="grid grid-cols-7">
                      {weekDates.map((date) => {
                        const dateString = isoDate(date);
                        const day = calendarDays[dateString];
                        const isSelected = isInSelectedRange(dateString);
                        const dayNumber = date.getUTCDate();
                        const inMonth = date.getUTCMonth() === visibleMonth.getUTCMonth();
                        const unavailable =
                          String(day?.availability ?? '').toLowerCase().includes('unavailable') ||
                          String(day?.availability ?? '').toLowerCase().includes('closed') ||
                          Boolean(day?.stop_sell);

                        const displayPrice =
                          day?.daily_price != null && activeProperty?.currency
                            ? formatMoney(Number(day.daily_price), activeProperty.currency)
                            : day?.daily_price != null
                              ? String(day.daily_price)
                              : '-';

                        return (
                          <div
                            key={dateString}
                            className={[
                              'relative flex flex-col p-2 border border-edge cursor-pointer select-none transition-all',
                              isSelected
                                ? 'bg-notice-bg border-notice-text ring-2 ring-inset ring-notice-text z-10'
                                : 'bg-surface-raised hover:bg-surface-subtle',
                              !inMonth ? 'bg-surface-subtle/80' : '',
                              unavailable && !isSelected ? 'bg-surface-subtle/80' : '',
                            ].join(' ')}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => handleCellClick(dateString)}
                          >
                            <div className="flex items-center justify-between">
                              <span className="pointer-events-none font-medium text-sm text-content">
                                {dayNumber}
                              </span>
                              <span
                                className={[
                                  'h-2 w-2 rounded-full pointer-events-none',
                                  unavailable ? 'bg-slate-400' : 'bg-emerald-500',
                                ].join(' ')}
                              />
                            </div>

                            <div className="pointer-events-none mt-1 text-xs text-content-2">
                              {displayPrice}
                            </div>

                            {day?.min_stay_arrival != null && (
                              <div className="pointer-events-none mt-1 text-[11px] text-content-2">
                                Min stay: {day.min_stay_arrival}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="pointer-events-none absolute inset-x-1 top-8 grid grid-cols-7 gap-1">
                      {segments.map((segment) => {
                        const title = formatGuestName(segment.reservation);
                        return (
                          <button
                            key={`${weekKey}-${segment.reservation.reservation_id}-${segment.colStart}-${segment.colEnd}`}
                            type="button"
                            title={`${title} (${segment.reservation.check_in} - ${segment.reservation.check_out})`}
                            onClick={() => setActiveReservationId(segment.reservation.reservation_id)}
                            style={{
                              gridColumn: `${segment.colStart} / ${segment.colEnd + 1}`,
                              gridRow: segment.lane + 1,
                            }}
                            className="pointer-events-auto h-5 self-start truncate rounded-md bg-notice-text px-2 text-left text-[11px] font-medium text-white shadow-sm ring-1 ring-notice-text/20"
                          >
                            {title}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {showARIControlPanel && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20"
            onClick={() => {
              if (isSaving) return;
              setShowARIControlPanel(false);
            }}
          />
          <div className="fixed inset-y-0 right-0 z-50 w-80 border-l border-edge bg-surface-raised p-6 shadow-2xl">
            <div className="flex h-full flex-col">
              <div className="mb-6 flex items-center justify-between">
                <h2 className="text-lg font-bold text-content">Update Availability</h2>
                <button
                  onClick={() => {
                    if (isSaving) return;
                    setShowARIControlPanel(false);
                  }}
                  className="text-content-2 hover:text-content"
                  disabled={isSaving}
                >
                  ✕
                </button>
              </div>

              <div className="mb-6">
                <p className="text-sm text-content-2">Selected Dates</p>
                <p className="font-medium text-content">{selectionStart} to {selectionEnd}</p>
              </div>

              <div className="mb-8 flex flex-col gap-4">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="availability"
                    value="1"
                    checked={selectedAvailability === 1}
                    onChange={() => setSelectedAvailability(1)}
                    className="form-radio text-brand"
                  />
                  <span>Available (Open)</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="availability"
                    value="0"
                    checked={selectedAvailability === 0}
                    onChange={() => setSelectedAvailability(0)}
                    className="form-radio text-brand"
                  />
                  <span>Blocked (Closed)</span>
                </label>
              </div>

              {saveError && (
                <p className="mb-4 rounded-md border border-danger-text/20 bg-danger-bg px-3 py-2 text-sm text-danger-text">
                  {saveError}
                </p>
              )}

              <button
                onClick={() => void handleSaveARI()}
                disabled={isSaving}
                className="w-full rounded-lg bg-content py-3 font-medium text-surface-raised hover:bg-content-2 disabled:bg-content-3"
              >
                {isSaving ? 'Saving...' : 'Save Updates'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
import { useCallback, useEffect, useMemo, useState } from 'react';
import ARIGlossaryButton from './ARIGlossaryButton';
import {
  listRoomTypes,
  pushAvailabilityBatch,
  pushRestrictionsBatch,
  triggerFullSync,
  getARISnapshot,
  refreshARISnapshot,
  type StoredRoomType,
  type FullSyncResult,
  type ARIMonthSnapshot,
  type DayRatePlanSnapshot,
} from '../api/channexHubApi';
import Button from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Input';

interface Props {
  propertyId: string;
  currency: string;
  tenantId?: string;
}

interface BatchEntry {
  id: number;
  roomTypeId: string;
  ratePlanId: string;
  dateFrom: string;
  dateTo: string;
  availability?: number;
  rate?: string;
  minStay?: number;
  maxStay?: number;
  stopSell?: boolean;
  closedToArrival?: boolean;
  closedToDeparture?: boolean;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

let batchCounter = 0;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + n);
  return next;
}

function startOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function endOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

export default function ARICalendarFull({ propertyId, currency, tenantId }: Props) {
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => startOfMonthUtc(new Date()));
  const [roomTypes, setRoomTypes] = useState<StoredRoomType[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);

  const [selectionStart, setSelectionStart] = useState<string | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<string | null>(null);
  const [showPanel, setShowPanel] = useState(false);

  // ARI panel state
  const [selectedRoomTypeId, setSelectedRoomTypeId] = useState('');
  const [selectedRatePlanId, setSelectedRatePlanId] = useState('');
  const [availability, setAvailability] = useState<number | ''>('');
  const [rate, setRate] = useState('');
  const [minStay, setMinStay] = useState<number | ''>('');
  const [maxStay, setMaxStay] = useState<number | ''>('');
  const [stopSell, setStopSell] = useState(false);
  const [closedToArrival, setClosedToArrival] = useState(false);
  const [closedToDeparture, setClosedToDeparture] = useState(false);

  // Batch queue
  const [batchQueue, setBatchQueue] = useState<BatchEntry[]>([]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastTaskIds, setLastTaskIds] = useState<string[]>([]);

  // ARI snapshot state (Firestore cache for calendar display)
  const [snapshot, setSnapshot] = useState<ARIMonthSnapshot>({});
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [refreshingSnapshot, setRefreshingSnapshot] = useState(false);
  const [popupDate, setPopupDate] = useState<string | null>(null);

  // Full sync state
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [showSyncInfo, setShowSyncInfo] = useState(false);
  const [syncAvailability, setSyncAvailability] = useState(1);
  const [syncRate, setSyncRate] = useState('100');
  const [syncMinStay, setSyncMinStay] = useState(1);
  const [syncMaxStay, setSyncMaxStay] = useState(30);
  const [syncStopSell, setSyncStopSell] = useState(false);
  const [syncClosedToArrival, setSyncClosedToArrival] = useState(false);
  const [syncClosedToDeparture, setSyncClosedToDeparture] = useState(false);
  const [syncDays, setSyncDays] = useState(500);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<FullSyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    setLoadingRooms(true);
    listRoomTypes(propertyId)
      .then((data) => {
        const safeData = Array.isArray(data) ? data : [];
        setRoomTypes(safeData);
        const firstRoom = safeData.find((rt) => rt.rate_plans.length > 0);
        if (firstRoom) {
          setSelectedRoomTypeId(firstRoom.room_type_id);
          setSelectedRatePlanId(firstRoom.rate_plans[0].rate_plan_id);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingRooms(false));
  }, [propertyId]);

  const monthKey = useMemo(
    () => visibleMonth.toISOString().slice(0, 7), // YYYY-MM
    [visibleMonth],
  );

  useEffect(() => {
    if (!tenantId) return;
    setLoadingSnapshot(true);
    getARISnapshot(propertyId, tenantId, monthKey)
      .then(setSnapshot)
      .catch(() => setSnapshot({}))
      .finally(() => setLoadingSnapshot(false));
  }, [propertyId, tenantId, monthKey]);

  async function handleRefreshSnapshot() {
    if (!tenantId) return;
    setRefreshingSnapshot(true);
    try {
      await refreshARISnapshot(propertyId, tenantId, monthKey);
      const fresh = await getARISnapshot(propertyId, tenantId, monthKey);
      setSnapshot(fresh);
    } catch {
      // silently ignore — user can retry
    } finally {
      setRefreshingSnapshot(false);
    }
  }

  const monthStart = useMemo(() => startOfMonthUtc(visibleMonth), [visibleMonth]);
  const monthEnd = useMemo(() => endOfMonthUtc(visibleMonth), [visibleMonth]);
  const gridStart = useMemo(() => addDays(monthStart, -monthStart.getUTCDay()), [monthStart]);
  const gridEnd = useMemo(() => addDays(monthEnd, 6 - monthEnd.getUTCDay()), [monthEnd]);

  const calendarDates = useMemo(() => {
    const dates: Date[] = [];
    for (let cur = new Date(gridStart); cur <= gridEnd; cur = addDays(cur, 1)) {
      dates.push(new Date(cur));
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

  const selectedRange = useMemo((): [string, string] | null => {
    if (!selectionStart) return null;
    const end = selectionEnd ?? selectionStart;
    return selectionStart <= end ? [selectionStart, end] : [end, selectionStart];
  }, [selectionStart, selectionEnd]);

  const isSelected = useCallback(
    (ds: string) => Boolean(selectedRange && ds >= selectedRange[0] && ds <= selectedRange[1]),
    [selectedRange],
  );

  const handleCellClick = useCallback(
    (ds: string) => {
      if (!selectionStart || selectionEnd) {
        setSelectionStart(ds);
        setSelectionEnd(null);
        setPopupDate(ds);
        setSaveError(null);
        setLastTaskIds([]);
        if (batchQueue.length === 0) setShowPanel(false);
        return;
      }
      const end = ds >= selectionStart ? ds : selectionStart;
      const start = ds < selectionStart ? ds : selectionStart;
      setSelectionStart(start);
      setSelectionEnd(end);
      setPopupDate(null);
      setShowPanel(true);
      setSaveError(null);
    },
    [batchQueue.length, selectionEnd, selectionStart],
  );

  const ratePlansForRoom = useMemo(
    () => roomTypes.find((rt) => rt.room_type_id === selectedRoomTypeId)?.rate_plans ?? [],
    [roomTypes, selectedRoomTypeId],
  );

  const uniqueRooms = useMemo(() => {
    const seen = new Set<string>();
    return roomTypes.filter((rt) => {
      if (seen.has(rt.room_type_id)) return false;
      seen.add(rt.room_type_id);
      return true;
    });
  }, [roomTypes]);

  const allRatePlans = useMemo(
    () => roomTypes.flatMap((rt) => rt.rate_plans),
    [roomTypes],
  );

  function handleAddToBatch() {
    if (!selectedRoomTypeId || !selectedRange) return;
    const [dateFrom, dateTo] = selectedRange;
    setBatchQueue((prev) => [
      ...prev,
      {
        id: batchCounter++,
        roomTypeId: selectedRoomTypeId,
        ratePlanId: selectedRatePlanId,
        dateFrom,
        dateTo,
        ...(availability !== '' ? { availability: Number(availability) } : {}),
        ...(rate !== '' ? { rate: String(rate) } : {}),
        ...(minStay !== '' ? { minStay: Number(minStay) } : {}),
        ...(maxStay !== '' ? { maxStay: Number(maxStay) } : {}),
        ...(stopSell ? { stopSell } : {}),
        ...(closedToArrival ? { closedToArrival } : {}),
        ...(closedToDeparture ? { closedToDeparture } : {}),
      },
    ]);
    setAvailability('');
    setRate('');
    setMinStay('');
    setMaxStay('');
    setStopSell(false);
    setClosedToArrival(false);
    setClosedToDeparture(false);
  }

  async function handleSaveBatch() {
    if (batchQueue.length === 0) return;
    setSaving(true);
    setSaveError(null);
    const taskIds: string[] = [];

    try {
      const availUpdates = batchQueue
        .filter((e) => e.availability !== undefined)
        .map((e) => ({ room_type_id: e.roomTypeId, date_from: e.dateFrom, date_to: e.dateTo, availability: e.availability! }));

      if (availUpdates.length > 0) {
        const res = await pushAvailabilityBatch(propertyId, availUpdates);
        taskIds.push(res.taskId);
      }

      const restrictUpdates = batchQueue
        .filter((e) => e.ratePlanId && (e.rate !== undefined || e.minStay !== undefined || e.maxStay !== undefined || e.stopSell || e.closedToArrival || e.closedToDeparture))
        .map((e) => ({
          rate_plan_id: e.ratePlanId,
          date_from: e.dateFrom,
          date_to: e.dateTo,
          ...(e.rate !== undefined ? { rate: e.rate } : {}),
          ...(e.minStay !== undefined ? { min_stay_arrival: e.minStay } : {}),
          ...(e.maxStay !== undefined ? { max_stay: e.maxStay } : {}),
          ...(e.stopSell ? { stop_sell: true } : {}),
          ...(e.closedToArrival ? { closed_to_arrival: true } : {}),
          ...(e.closedToDeparture ? { closed_to_departure: true } : {}),
        }));

      if (restrictUpdates.length > 0) {
        const res = await pushRestrictionsBatch(propertyId, restrictUpdates);
        taskIds.push(res.taskId);
      }

      setLastTaskIds(taskIds);
      setBatchQueue([]);
      setShowPanel(false);
      setSelectionStart(null);
      setSelectionEnd(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  async function handleFullSync() {
    setSyncing(true);
    setSyncError(null);
    setSyncResult(null);
    try {
      const result = await triggerFullSync(propertyId, {
        defaultAvailability: syncAvailability,
        defaultRate: syncRate,
        defaultMinStayArrival: syncMinStay,
        defaultMaxStay: syncMaxStay,
        defaultStopSell: syncStopSell,
        defaultClosedToArrival: syncClosedToArrival,
        defaultClosedToDeparture: syncClosedToDeparture,
        days: syncDays,
      });
      setSyncResult(result);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Full sync failed.');
    } finally {
      setSyncing(false);
    }
  }

  const monthLabel = useMemo(
    () => visibleMonth.toLocaleString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    [visibleMonth],
  );

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-content">ARI Calendar</h3>
          <p className="text-xs text-content-2">Click a date to preview, click a second date to open the update panel.</p>
        </div>
        <div className="flex items-center gap-2">
          <ARIGlossaryButton />
          {tenantId && (
            <Button
              type="button"
              onClick={() => void handleRefreshSnapshot()}
              disabled={refreshingSnapshot || loadingSnapshot}
              variant="secondary"
              size="sm"
            >
              {refreshingSnapshot ? 'Refreshing…' : '↻ Refresh Calendar'}
            </Button>
          )}
          <Button
            type="button"
            onClick={() => { setShowSyncModal(true); setSyncResult(null); setSyncError(null); }}
            variant="outline"
            size="sm"
          >
            Full Sync ({syncDays} days)
          </Button>
        </div>
      </div>

      {/* Task ID display after save */}
      {lastTaskIds.length > 0 && (
        <div className="rounded-xl border border-ok-bg bg-ok-bg px-4 py-3">
          <p className="text-xs font-semibold text-ok-text uppercase tracking-[0.1em]">Task IDs</p>
          {lastTaskIds.map((id) => (
            <p key={id} className="mt-1 font-mono text-xs text-ok-text">{id}</p>
          ))}
        </div>
      )}

      {/* Day detail popup — one card per room type with its rate plans */}
      {popupDate && (() => {
        const day = snapshot[popupDate];
        const hasData = day && (
          Object.keys(day.roomTypes ?? {}).length > 0 ||
          Object.keys(day.ratePlans ?? {}).length > 0
        );

        // Build cards: each loaded room type with its availability + rate plans
        const cards = roomTypes.map((rt) => ({
          rt,
          availability: day?.roomTypes?.[rt.room_type_id]?.availability ?? null,
          plans: rt.rate_plans.map((rp) => ({
            rp,
            snap: day?.ratePlans?.[rp.rate_plan_id] ?? null,
          })),
        }));

        return (
          <div className="rounded-xl border border-edge bg-surface-raised px-4 py-3 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-content">{popupDate}</p>
              <button type="button" onClick={() => setPopupDate(null)} className="text-xs text-content-3 hover:text-content-2">✕</button>
            </div>

            {!hasData ? (
              <p className="text-xs text-content-3 italic">
                No hay datos — usa ↻ Refresh Calendar para cargar desde Channex.
              </p>
            ) : (
              <div className="space-y-2">
                {cards.map(({ rt, availability, plans }) => (
                  <div key={rt.room_type_id} className="rounded-lg border border-edge bg-surface-subtle p-2.5">
                    {/* Room type header */}
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-xs font-semibold text-content">{rt.title}</p>
                      {availability !== null && (
                        <span className={`text-xs font-bold ${availability === 0 ? 'text-caution-text' : 'text-ok-text'}`}>
                          {availability} u
                        </span>
                      )}
                    </div>

                    {/* Rate plans */}
                    {plans.map(({ rp, snap }) => (
                      <div key={rp.rate_plan_id} className="flex items-center justify-between py-0.5 text-xs border-t border-edge mt-1 pt-1">
                        <span className="text-content-2 truncate max-w-[40%]">{rp.title}</span>
                        <div className="flex items-center gap-1 flex-wrap justify-end">
                          {snap ? (
                            <>
                              {snap.rate && (
                                <span className="font-semibold text-content">{currency} {snap.rate}</span>
                              )}
                              {snap.minStayArrival != null && (
                                <span className="text-content-3">{snap.minStayArrival}n+</span>
                              )}
                              {snap.maxStay != null && (
                                <span className="text-content-3">max {snap.maxStay}n</span>
                              )}
                              {snap.stopSell && (
                                <span className="rounded bg-danger-bg px-1 py-0.5 text-[10px] font-bold text-danger-text">SS</span>
                              )}
                              {snap.closedToArrival && (
                                <span className="rounded bg-caution-bg px-1 py-0.5 text-[10px] font-bold text-caution-text">CTA</span>
                              )}
                              {snap.closedToDeparture && (
                                <span className="rounded bg-caution-bg px-1 py-0.5 text-[10px] font-bold text-caution-text">CTD</span>
                              )}
                            </>
                          ) : (
                            <span className="text-content-3 italic text-[10px]">sin datos</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
            <p className="mt-2 text-xs text-content-3">
              Haz click en otra fecha para definir un rango.
            </p>
          </div>
        );
      })()}

      {loadingRooms ? (
        <p className="text-sm text-content-2">Loading room types…</p>
      ) : (
        <>
          {/* Month navigation */}
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setVisibleMonth((m) => new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() - 1, 1)))}
              className="rounded-lg border border-edge px-3 py-1.5 text-sm text-content-2 hover:bg-surface-subtle">Prev</button>
            <span className="min-w-36 text-center text-sm font-semibold text-content">{monthLabel}</span>
            <button type="button" onClick={() => setVisibleMonth((m) => new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1)))}
              className="rounded-lg border border-edge px-3 py-1.5 text-sm text-content-2 hover:bg-surface-subtle">Next</button>
          </div>

          {/* Calendar grid */}
          <div className="overflow-hidden rounded-2xl border border-edge bg-surface-raised select-none" onMouseDown={(e) => e.preventDefault()}>
            <div className="grid grid-cols-7 border-b border-edge bg-surface-subtle">
              {WEEKDAY_LABELS.map((d) => (
                <div key={d} className="py-2 text-center text-xs font-semibold uppercase tracking-[0.12em] text-content-2">{d}</div>
              ))}
            </div>
            <div className="divide-y divide-edge">
              {weeks.map((weekDates) => (
                <div key={isoDate(weekDates[0])} className="grid grid-cols-7">
                  {weekDates.map((date) => {
                    const ds = isoDate(date);
                    const inMonth = date.getUTCMonth() === visibleMonth.getUTCMonth();
                    const sel = isSelected(ds);
                    const isPopup = ds === popupDate;

                    // Aggregate across ALL room types and rate plans for this date
                    const daySnap = snapshot[ds];
                    const rpValues: DayRatePlanSnapshot[] = Object.values(daySnap?.ratePlans ?? {});
                    const rtValues = Object.values(daySnap?.roomTypes ?? {});
                    const anyStopSell = rpValues.some((rp) => rp.stopSell);
                    const totalAvail = rtValues.length > 0
                      ? rtValues.reduce((s, rt) => s + rt.availability, 0)
                      : null;
                    const minRate = rpValues.reduce((min: number | null, rp) => {
                      if (!rp.rate) return min;
                      const r = parseFloat(rp.rate);
                      return min === null || r < min ? r : min;
                    }, null);

                    const isBlocked = anyStopSell;
                    const isClosed = !isBlocked && totalAvail !== null && totalAvail === 0;

                    let cellBg = '';
                    if (!sel && inMonth) {
                      if (isBlocked) cellBg = 'bg-danger-bg';
                      else if (isClosed) cellBg = 'bg-caution-bg';
                      else if (totalAvail !== null && totalAvail > 0) cellBg = 'bg-ok-bg/60';
                    }

                    return (
                      <div
                        key={ds}
                        onClick={() => handleCellClick(ds)}
                        className={[
                          'flex flex-col items-start p-1.5 border border-edge cursor-pointer min-h-[56px] transition-colors',
                          sel ? 'bg-brand-subtle ring-2 ring-inset ring-brand-light z-10' : `hover:bg-surface-subtle ${cellBg}`,
                          !inMonth ? 'bg-surface-subtle/70' : '',
                          isPopup && !sel ? 'ring-2 ring-inset ring-brand-light z-10' : '',
                        ].join(' ')}
                        onMouseDown={(e) => e.preventDefault()}
                      >
                        <span className={`text-sm font-medium ${inMonth ? 'text-content' : 'text-content-3'}`}>
                          {date.getUTCDate()}
                        </span>
                        {inMonth && minRate !== null && (
                          <span className="text-[10px] font-semibold text-content-2 leading-tight">
                            {currency}&nbsp;{minRate.toFixed(2)}
                          </span>
                        )}
                        {inMonth && totalAvail !== null && (
                          <span className={`text-[10px] leading-tight ${totalAvail === 0 ? 'text-caution-text' : 'text-ok-text'}`}>
                            {totalAvail}u
                          </span>
                        )}
                        {inMonth && isBlocked && (
                          <span className="text-[9px] font-bold text-danger-text leading-tight">SS</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ARI Control Panel (side-sheet) */}
      {showPanel && selectedRange && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => { if (!saving) setShowPanel(false); }} />
          <div className="fixed inset-y-0 right-0 z-50 w-96 border-l border-edge bg-surface-raised p-6 shadow-2xl overflow-y-auto">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-base font-bold text-content">Update ARI</h2>
              <button type="button" onClick={() => { if (!saving) setShowPanel(false); }} className="text-content-3 hover:text-content-2 disabled:opacity-50" disabled={saving}>✕</button>
            </div>

            <div className="mb-4 rounded-xl bg-surface-subtle px-3 py-2 text-sm">
              <span className="text-content-2">Range: </span>
              <span className="font-semibold text-content">{selectedRange[0]} → {selectedRange[1]}</span>
            </div>

            <div className="space-y-4">
              {/* Room Type selector */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-content-2">Room Type</label>
                <Select
                  value={selectedRoomTypeId}
                  onChange={(e) => {
                    setSelectedRoomTypeId(e.target.value);
                    const room = roomTypes.find((rt) => rt.room_type_id === e.target.value);
                    setSelectedRatePlanId(room?.rate_plans[0]?.rate_plan_id ?? '');
                  }}
                >
                  <option value="">— select —</option>
                  {uniqueRooms.map((rt) => (
                    <option key={rt.room_type_id} value={rt.room_type_id}>{rt.title}</option>
                  ))}
                </Select>
              </div>

              {/* Rate Plan selector */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-content-2">Rate Plan</label>
                <Select
                  value={selectedRatePlanId}
                  onChange={(e) => setSelectedRatePlanId(e.target.value)}
                >
                  <option value="">— select —</option>
                  {ratePlansForRoom.map((rp) => (
                    <option key={rp.rate_plan_id} value={rp.rate_plan_id}>{rp.title}</option>
                  ))}
                </Select>
              </div>

              <hr className="border-edge" />

              {/* Availability */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-content-2">
                  Availability (units) — leave blank to skip
                </label>
                <Input
                  type="number"
                  min={0}
                  value={availability}
                  onChange={(e) => setAvailability(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="e.g. 7"
                />
              </div>

              <hr className="border-edge" />

              {/* Rate */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-content-2">
                  Rate ({currency}) — leave blank to skip
                </label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  placeholder="e.g. 333"
                />
              </div>

              {/* Min Stay */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-content-2">
                  Min Stay (nights) — leave blank to skip
                </label>
                <Input
                  type="number"
                  min={1}
                  value={minStay}
                  onChange={(e) => setMinStay(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="e.g. 3"
                />
              </div>

              {/* Max Stay */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-content-2">
                  Max Stay (nights) — leave blank to skip
                </label>
                <Input
                  type="number"
                  min={1}
                  value={maxStay}
                  onChange={(e) => setMaxStay(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="e.g. 14"
                />
              </div>

              {/* Restriction checkboxes */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-content-2">Restrictions</p>
                {[
                  { id: 'stop_sell', label: 'Stop Sell', value: stopSell, set: setStopSell },
                  { id: 'cta', label: 'Closed to Arrival', value: closedToArrival, set: setClosedToArrival },
                  { id: 'ctd', label: 'Closed to Departure', value: closedToDeparture, set: setClosedToDeparture },
                ].map(({ id, label, value, set }) => (
                  <label key={id} className="flex cursor-pointer items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={value}
                      onChange={(e) => set(e.target.checked)}
                      className="h-4 w-4 rounded border-edge text-brand focus:ring-brand"
                    />
                    <span className="text-sm text-content">{label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Batch queue preview */}
            {batchQueue.length > 0 && (
              <div className="mt-3 rounded-xl bg-surface-subtle border border-edge p-3">
                <p className="text-xs font-semibold text-content-2 mb-2">Batch queue ({batchQueue.length} updates)</p>
                {batchQueue.map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between text-xs text-content py-0.5">
                    <span>
                      {entry.dateFrom === entry.dateTo ? entry.dateFrom : `${entry.dateFrom} → ${entry.dateTo}`}
                      {' · '}
                      {uniqueRooms.find((r) => r.room_type_id === entry.roomTypeId)?.title}
                      {entry.ratePlanId ? ` / ${allRatePlans.find((rp) => rp.rate_plan_id === entry.ratePlanId)?.title ?? '—'}` : ''}
                    </span>
                    <button type="button" onClick={() => setBatchQueue((q) => q.filter((e) => e.id !== entry.id))} className="text-danger-text hover:text-danger-text">✕</button>
                  </div>
                ))}
              </div>
            )}

            {saveError && (
              <div className="mt-4 rounded-xl border border-danger-bg bg-danger-bg px-3 py-2 text-sm text-danger-text">{saveError}</div>
            )}

            <div className="mt-4 flex gap-2">
              <Button
                type="button"
                onClick={handleAddToBatch}
                disabled={!selectedRoomTypeId}
                variant="outline"
                size="sm"
                className="flex-1"
              >
                + Add to Batch
              </Button>
              {batchQueue.length > 0 && (
                <Button
                  type="button"
                  onClick={() => void handleSaveBatch()}
                  disabled={saving}
                  variant="primary"
                  size="sm"
                  className="flex-1"
                >
                  {saving ? 'Saving…' : `Save (${batchQueue.length})`}
                </Button>
              )}
            </div>
          </div>
        </>
      )}

      {/* Full Sync modal */}
      {showSyncModal && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => { if (!syncing) { setShowSyncModal(false); setShowSyncInfo(false); } }} />
          <div className="fixed inset-x-4 top-[5%] z-50 mx-auto max-w-lg rounded-2xl border border-edge bg-surface-raised p-6 shadow-2xl overflow-y-auto max-h-[90vh]">

            {/* Header */}
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-bold text-content">Full Sync</h3>
                <p className="mt-0.5 text-xs text-content-3">
                  Sends {syncDays} days of ARI to Channex in 2 API calls (availability + restrictions).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSyncInfo((v) => !v)}
                title="Field descriptions"
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-sm font-bold transition-colors ${showSyncInfo ? 'border-brand-light bg-brand-subtle text-brand' : 'border-edge bg-surface-subtle text-content-2 hover:border-brand-light hover:bg-brand-subtle hover:text-brand'}`}
              >
                i
              </button>
            </div>

            {/* Info panel */}
            {showSyncInfo && (
              <div className="mt-3 rounded-xl border border-brand-light bg-brand-subtle p-4 text-xs text-content space-y-2">
                <p className="font-semibold text-brand mb-1">Field reference</p>
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                  <span className="font-semibold text-content-2">Availability</span>
                  <span>Number of rooms/units available per day for each Room Type.</span>
                  <span className="font-semibold text-content-2">Rate</span>
                  <span>Base nightly price applied to every Rate Plan for all {syncDays} days.</span>
                  <span className="font-semibold text-content-2">Min Stay</span>
                  <span>Minimum nights a guest must book (min_stay_arrival). 1 = no restriction.</span>
                  <span className="font-semibold text-content-2">Max Stay</span>
                  <span>Maximum nights a guest can book. Required by Channex — cannot be empty or null.</span>
                  <span className="font-semibold text-content-2">Stop Sell</span>
                  <span>Closes all inventory — no new bookings accepted. Usually false for go-live.</span>
                  <span className="font-semibold text-content-2">Closed to Arrival</span>
                  <span>Blocks guests from checking in on any synced date (CTA). Usually false.</span>
                  <span className="font-semibold text-content-2">Closed to Departure</span>
                  <span>Blocks guests from checking out on any synced date (CTD). Usually false.</span>
                  <span className="font-semibold text-content-2">Days</span>
                  <span>How many days forward from today to sync.</span>
                </div>
              </div>
            )}

            {/* Numeric fields */}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-content-2">Availability</label>
                <Input
                  type="number" min={0}
                  value={syncAvailability}
                  onChange={(e) => setSyncAvailability(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-content-2">Rate ({currency})</label>
                <Input
                  value={syncRate}
                  onChange={(e) => setSyncRate(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-content-2">Min Stay (nights)</label>
                <Input
                  type="number" min={1}
                  value={syncMinStay}
                  onChange={(e) => setSyncMinStay(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-content-2">Max Stay (nights)</label>
                <Input
                  type="number" min={1}
                  value={syncMaxStay}
                  onChange={(e) => setSyncMaxStay(Number(e.target.value))}
                />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-xs font-semibold text-content-2">Days forward</label>
                <Input
                  type="number" min={1}
                  value={syncDays}
                  onChange={(e) => setSyncDays(Number(e.target.value))}
                />
              </div>
            </div>

            {/* Boolean toggles */}
            <div className="mt-4 space-y-2">
              <p className="text-xs font-semibold text-content-2 uppercase tracking-wide">Restrictions</p>
              {(
                [
                  { label: 'Stop Sell', desc: 'Close all inventory', value: syncStopSell, set: setSyncStopSell },
                  { label: 'Closed to Arrival', desc: 'Block check-in on all dates', value: syncClosedToArrival, set: setSyncClosedToArrival },
                  { label: 'Closed to Departure', desc: 'Block check-out on all dates', value: syncClosedToDeparture, set: setSyncClosedToDeparture },
                ] as const
              ).map(({ label, desc, value, set }) => (
                <label key={label} className="flex cursor-pointer items-center justify-between rounded-xl border border-edge bg-surface-subtle px-4 py-2.5 hover:bg-surface-raised">
                  <div>
                    <span className="text-sm font-medium text-content">{label}</span>
                    <span className="ml-2 text-xs text-content-3">{desc}</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={value}
                    onClick={() => (set as (v: boolean) => void)(!value)}
                    className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none ${value ? 'bg-brand' : 'bg-edge'}`}
                  >
                    <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                </label>
              ))}
            </div>

            {syncError && (
              <div className="mt-3 rounded-xl border border-danger-bg bg-danger-bg px-3 py-2 text-sm text-danger-text">{syncError}</div>
            )}
            {syncResult && (
              <div className="mt-3 rounded-xl border border-ok-bg bg-ok-bg px-4 py-3 space-y-1">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ok-text">Task IDs</p>
                <p className="font-mono text-xs text-ok-text">Availability: {syncResult.availabilityTaskId || '—'}</p>
                <p className="font-mono text-xs text-ok-text">Restrictions: {syncResult.restrictionsTaskId || '—'}</p>
              </div>
            )}

            <div className="mt-5 flex justify-end gap-3">
              <Button type="button" onClick={() => { setShowSyncModal(false); setShowSyncInfo(false); }} disabled={syncing} variant="ghost" size="sm">Cancel</Button>
              <Button
                type="button"
                onClick={() => void handleFullSync()}
                disabled={syncing}
                variant="primary"
                size="sm"
              >
                {syncing ? 'Syncing…' : 'Run Full Sync'}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

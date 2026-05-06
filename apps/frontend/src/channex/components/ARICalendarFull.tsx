import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listRoomTypes,
  pushAvailabilityBatch,
  pushRestrictionsBatch,
  triggerFullSync,
  type StoredRoomType,
  type FullSyncResult,
} from '../api/channexHubApi';

interface Props {
  propertyId: string;
  currency: string;
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

export default function ARICalendarFull({ propertyId, currency }: Props) {
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

  // Full sync state
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncAvailability, setSyncAvailability] = useState(1);
  const [syncRate, setSyncRate] = useState('100');
  const [syncDays, setSyncDays] = useState(500);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<FullSyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    setLoadingRooms(true);
    listRoomTypes(propertyId)
      .then((data) => {
        setRoomTypes(data);
        const firstRoom = data.find((rt) => rt.rate_plans.length > 0);
        if (firstRoom) {
          setSelectedRoomTypeId(firstRoom.room_type_id);
          setSelectedRatePlanId(firstRoom.rate_plans[0].rate_plan_id);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingRooms(false));
  }, [propertyId]);

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
        setSaveError(null);
        setLastTaskIds([]);
        if (batchQueue.length === 0) setShowPanel(false);
        return;
      }
      const end = ds >= selectionStart ? ds : selectionStart;
      const start = ds < selectionStart ? ds : selectionStart;
      setSelectionStart(start);
      setSelectionEnd(end);
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
          <h3 className="text-base font-semibold text-slate-900">ARI Calendar</h3>
          <p className="text-xs text-slate-500">Click a date to start a range, click another to end and open the update panel.</p>
        </div>
        <button
          type="button"
          onClick={() => { setShowSyncModal(true); setSyncResult(null); setSyncError(null); }}
          className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
        >
          Full Sync ({syncDays} days)
        </button>
      </div>

      {/* Task ID display after save */}
      {lastTaskIds.length > 0 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-xs font-semibold text-emerald-700 uppercase tracking-[0.1em]">Task IDs (save for certification form)</p>
          {lastTaskIds.map((id) => (
            <p key={id} className="mt-1 font-mono text-xs text-emerald-800">{id}</p>
          ))}
        </div>
      )}

      {loadingRooms ? (
        <p className="text-sm text-slate-500">Loading room types…</p>
      ) : (
        <>
          {/* Month navigation */}
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setVisibleMonth((m) => new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() - 1, 1)))}
              className="rounded-lg border px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">Prev</button>
            <span className="min-w-36 text-center text-sm font-semibold text-slate-900">{monthLabel}</span>
            <button type="button" onClick={() => setVisibleMonth((m) => new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1)))}
              className="rounded-lg border px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">Next</button>
          </div>

          {/* Calendar grid */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white select-none" onMouseDown={(e) => e.preventDefault()}>
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
              {WEEKDAY_LABELS.map((d) => (
                <div key={d} className="py-2 text-center text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{d}</div>
              ))}
            </div>
            <div className="divide-y divide-slate-200">
              {weeks.map((weekDates) => (
                <div key={isoDate(weekDates[0])} className="grid grid-cols-7">
                  {weekDates.map((date) => {
                    const ds = isoDate(date);
                    const inMonth = date.getUTCMonth() === visibleMonth.getUTCMonth();
                    const sel = isSelected(ds);
                    return (
                      <div
                        key={ds}
                        onClick={() => handleCellClick(ds)}
                        className={[
                          'flex flex-col items-start p-2 border border-slate-200 cursor-pointer min-h-[52px] transition-colors',
                          sel ? 'bg-indigo-100 ring-2 ring-inset ring-indigo-500 z-10' : 'hover:bg-slate-50',
                          !inMonth ? 'bg-slate-50/70 text-slate-300' : '',
                        ].join(' ')}
                        onMouseDown={(e) => e.preventDefault()}
                      >
                        <span className="text-sm font-medium text-slate-700">{date.getUTCDate()}</span>
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
          <div className="fixed inset-y-0 right-0 z-50 w-96 border-l border-gray-200 bg-white p-6 shadow-2xl overflow-y-auto">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">Update ARI</h2>
              <button type="button" onClick={() => { if (!saving) setShowPanel(false); }} className="text-gray-400 hover:text-gray-700 disabled:opacity-50" disabled={saving}>✕</button>
            </div>

            <div className="mb-4 rounded-xl bg-slate-50 px-3 py-2 text-sm">
              <span className="text-slate-500">Range: </span>
              <span className="font-semibold text-slate-900">{selectedRange[0]} → {selectedRange[1]}</span>
            </div>

            <div className="space-y-4">
              {/* Room Type selector */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Room Type</label>
                <select
                  value={selectedRoomTypeId}
                  onChange={(e) => {
                    setSelectedRoomTypeId(e.target.value);
                    const room = roomTypes.find((rt) => rt.room_type_id === e.target.value);
                    setSelectedRatePlanId(room?.rate_plans[0]?.rate_plan_id ?? '');
                  }}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">— select —</option>
                  {uniqueRooms.map((rt) => (
                    <option key={rt.room_type_id} value={rt.room_type_id}>{rt.title}</option>
                  ))}
                </select>
              </div>

              {/* Rate Plan selector */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Rate Plan</label>
                <select
                  value={selectedRatePlanId}
                  onChange={(e) => setSelectedRatePlanId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">— select —</option>
                  {ratePlansForRoom.map((rp) => (
                    <option key={rp.rate_plan_id} value={rp.rate_plan_id}>{rp.title}</option>
                  ))}
                </select>
              </div>

              <hr className="border-slate-200" />

              {/* Availability */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">
                  Availability (units) — leave blank to skip
                </label>
                <input
                  type="number"
                  min={0}
                  value={availability}
                  onChange={(e) => setAvailability(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="e.g. 7"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <hr className="border-slate-200" />

              {/* Rate */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">
                  Rate ({currency}) — leave blank to skip
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  placeholder="e.g. 333"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Min Stay */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">
                  Min Stay (nights) — leave blank to skip
                </label>
                <input
                  type="number"
                  min={1}
                  value={minStay}
                  onChange={(e) => setMinStay(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="e.g. 3"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Max Stay */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">
                  Max Stay (nights) — leave blank to skip
                </label>
                <input
                  type="number"
                  min={1}
                  value={maxStay}
                  onChange={(e) => setMaxStay(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="e.g. 14"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Restriction checkboxes */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Restrictions</p>
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
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-sm text-slate-700">{label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Batch queue preview */}
            {batchQueue.length > 0 && (
              <div className="mt-3 rounded-xl bg-slate-50 border border-slate-200 p-3">
                <p className="text-xs font-semibold text-slate-600 mb-2">Batch queue ({batchQueue.length} updates)</p>
                {batchQueue.map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between text-xs text-slate-700 py-0.5">
                    <span>
                      {entry.dateFrom === entry.dateTo ? entry.dateFrom : `${entry.dateFrom} → ${entry.dateTo}`}
                      {' · '}
                      {uniqueRooms.find((r) => r.room_type_id === entry.roomTypeId)?.title}
                      {entry.ratePlanId ? ` / ${allRatePlans.find((rp) => rp.rate_plan_id === entry.ratePlanId)?.title ?? '—'}` : ''}
                    </span>
                    <button type="button" onClick={() => setBatchQueue((q) => q.filter((e) => e.id !== entry.id))} className="text-red-400 hover:text-red-600">✕</button>
                  </div>
                ))}
              </div>
            )}

            {saveError && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{saveError}</div>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={handleAddToBatch}
                disabled={!selectedRoomTypeId}
                className="flex-1 rounded-xl border border-indigo-300 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
              >
                + Add to Batch
              </button>
              {batchQueue.length > 0 && (
                <button
                  type="button"
                  onClick={() => void handleSaveBatch()}
                  disabled={saving}
                  className="flex-1 rounded-xl bg-indigo-600 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {saving ? 'Saving…' : `Save (${batchQueue.length})`}
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* Full Sync modal */}
      {showSyncModal && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => { if (!syncing) setShowSyncModal(false); }} />
          <div className="fixed inset-x-4 top-1/3 z-50 mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <h3 className="text-base font-bold text-slate-900">Full Sync</h3>
            <p className="mt-1 text-sm text-slate-500">
              Sends {syncDays} days of ARI for all room types and rate plans in 2 Channex API calls. This is Test #1 of the certification.
            </p>
            <div className="mt-4 grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Availability</label>
                <input
                  type="number"
                  min={0}
                  value={syncAvailability}
                  onChange={(e) => setSyncAvailability(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Rate ({currency})</label>
                <input
                  value={syncRate}
                  onChange={(e) => setSyncRate(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Days</label>
                <input
                  type="number"
                  min={1}
                  value={syncDays}
                  onChange={(e) => setSyncDays(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
            </div>
            {syncError && (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{syncError}</div>
            )}
            {syncResult && (
              <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 space-y-1">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-emerald-700">Task IDs</p>
                <p className="font-mono text-xs text-emerald-800">Availability: {syncResult.availabilityTaskId}</p>
                <p className="font-mono text-xs text-emerald-800">Restrictions: {syncResult.restrictionsTaskId}</p>
              </div>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setShowSyncModal(false)} disabled={syncing} className="text-sm text-slate-500">Cancel</button>
              <button
                type="button"
                onClick={() => void handleFullSync()}
                disabled={syncing}
                className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {syncing ? 'Syncing…' : 'Run Full Sync'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

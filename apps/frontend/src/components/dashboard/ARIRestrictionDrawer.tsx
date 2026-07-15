import { useState, useEffect, useMemo, useRef } from 'react';
import { X, Calendar } from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import {
  listRoomTypes,
  pushAvailabilityBatch,
  pushRestrictionsBatch,
  type StoredRoomType,
  type ARIMonthSnapshot,
  type DayRatePlanSnapshot,
} from '../../channex/api/channexHubApi';
import type { ChannexProperty } from '../../channex/hooks/useChannexProperties';
import { Toasts, useToasts } from '../ui';

const ALL_ROOMS = '__ALL__';

function expandRange(dateFrom: string, dateTo: string): string[] {
  if (!dateFrom || !dateTo) return [];
  const dates: string[] = [];
  let cur = new Date(`${dateFrom}T00:00:00Z`);
  const end = new Date(`${dateTo}T00:00:00Z`);
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 86400000);
  }
  return dates;
}

interface BatchEntry {
  id: number;
  dateFrom: string;
  dateTo: string;
  propertyId: string;
  roomTypeId: string;
  ratePlanId: string;
  availability?: number;
  rate?: string;
  minStay?: number;
  maxStay?: number;
  stopSell?: boolean;
  closedToArrival?: boolean;
  closedToDeparture?: boolean;
}

interface ARIRestrictionDrawerProps {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  dateFrom: string;
  dateTo: string;
  initialPropertyId: string | null;
  initialRoomTypeId?: string;
  properties: ChannexProperty[];
}

export default function ARIRestrictionDrawer({
  open,
  onClose,
  tenantId,
  dateFrom,
  dateTo,
  initialPropertyId,
  initialRoomTypeId,
  properties,
}: ARIRestrictionDrawerProps) {
  const [drawerPropertyId, setDrawerPropertyId] = useState(initialPropertyId ?? '');
  const [roomTypes, setRoomTypes] = useState<StoredRoomType[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [selectedRoomTypeId, setSelectedRoomTypeId] = useState('');
  const [selectedRatePlanId, setSelectedRatePlanId] = useState('');
  const [availability, setAvailability] = useState<number | ''>('');
  const [rate, setRate] = useState('');
  const [minStay, setMinStay] = useState<number | ''>('');
  const [maxStay, setMaxStay] = useState<number | ''>('');
  const [stopSell, setStopSell] = useState(false);
  const [closedToArrival, setClosedToArrival] = useState(false);
  const [closedToDeparture, setClosedToDeparture] = useState(false);
  const [batchQueue, setBatchQueue] = useState<BatchEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [snapshots, setSnapshots] = useState<Record<string, ARIMonthSnapshot>>({});
  const { toasts, showToast, dismissToast } = useToasts();

  const batchCounterRef = useRef(0);
  const batchQueueRef = useRef(batchQueue);
  batchQueueRef.current = batchQueue;

  const [visible, setVisible] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const isDragging = useRef(false);
  const dragStartY = useRef(0);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    setDragOffset(0);
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  function close() {
    setVisible(false);
    closeTimer.current = setTimeout(onClose, 320);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    isDragging.current = true;
    dragStartY.current = e.clientY;
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDragging.current) return;
    setDragOffset(Math.max(0, e.clientY - dragStartY.current));
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    isDragging.current = false;
    if (e.clientY - dragStartY.current > 80) {
      close();
    } else {
      setDragOffset(0);
    }
  }

  useEffect(() => {
    if (batchQueueRef.current.length > 0) return;
    setDrawerPropertyId(initialPropertyId ?? '');
  }, [initialPropertyId]);

  useEffect(() => {
    if (!drawerPropertyId) {
      setRoomTypes([]);
      setSelectedRoomTypeId('');
      setSelectedRatePlanId('');
      return;
    }
    setLoadingRooms(true);
    listRoomTypes(drawerPropertyId)
      .then((data) => {
        const safe = Array.isArray(data) ? data : [];
        setRoomTypes(safe);
        const targetId = initialRoomTypeId ?? safe.find((rt) => rt.rate_plans.length > 0)?.room_type_id;
        const targetRoom = safe.find((rt) => rt.room_type_id === targetId);
        if (targetRoom) {
          setSelectedRoomTypeId(targetRoom.room_type_id);
          setSelectedRatePlanId(targetRoom.rate_plans[0]?.rate_plan_id ?? '');
        }
      })
      .catch(() => {})
      .finally(() => setLoadingRooms(false));
  }, [drawerPropertyId, initialRoomTypeId]);

  const ratePlansForRoom = useMemo(
    () => roomTypes.find((rt) => rt.room_type_id === selectedRoomTypeId)?.rate_plans ?? [],
    [roomTypes, selectedRoomTypeId],
  );

  const allRatePlans = useMemo(
    () => roomTypes.flatMap((rt) => rt.rate_plans),
    [roomTypes],
  );

  const prefilledPropertyTitle = useMemo(
    () => initialPropertyId ? properties.find(p => p.channex_property_id === initialPropertyId)?.title ?? null : null,
    [initialPropertyId, properties],
  );
  const prefilledRoomTitle = useMemo(
    () => initialRoomTypeId ? roomTypes.find(rt => rt.room_type_id === initialRoomTypeId)?.title ?? null : null,
    [initialRoomTypeId, roomTypes],
  );

  // Meses cubiertos por el rango — un rango puede cruzar el borde de mes.
  const monthKeys = useMemo(() => {
    if (!dateFrom || !dateTo) return [];
    const keys: string[] = [];
    let cur = dateFrom.slice(0, 7);
    const last = dateTo.slice(0, 7);
    while (cur <= last) {
      keys.push(cur);
      const [y, m] = cur.split('-').map(Number);
      cur = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
    }
    return keys;
  }, [dateFrom, dateTo]);

  useEffect(() => {
    if (!drawerPropertyId || !tenantId || monthKeys.length === 0) { setSnapshots({}); return; }
    setSnapshots({});
    const unsubs = monthKeys.map((key) =>
      onSnapshot(
        doc(db, 'channex_integrations', tenantId, 'properties', drawerPropertyId, 'ari_snapshots', key),
        (snap) => setSnapshots((prev) => ({ ...prev, [key]: snap.exists() ? (snap.data() as ARIMonthSnapshot) : {} })),
        () => setSnapshots((prev) => ({ ...prev, [key]: {} })),
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [drawerPropertyId, tenantId, monthKeys]);

  // Las claves son fechas ISO, así que los meses se pueden aplanar sin colisión.
  const snapshot = useMemo<ARIMonthSnapshot>(
    () => Object.assign({}, ...Object.values(snapshots)),
    [snapshots],
  );

  const rangeDates = useMemo(() => expandRange(dateFrom, dateTo), [dateFrom, dateTo]);

  // Stop-sell scoped a los rate plans de cada habitación (antes se miraba toda la
  // propiedad, y una SS en otra habitación disparaba el aviso en ésta).
  const blockedDatesByRoom = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const rt of roomTypes) {
      const rpIds = new Set(rt.rate_plans.map((rp) => rp.rate_plan_id));
      const dates = rangeDates.filter((ds) =>
        Object.entries(snapshot[ds]?.ratePlans ?? {}).some(
          ([rpId, rp]) => rpIds.has(rpId) && (rp as DayRatePlanSnapshot).stopSell,
        ),
      );
      if (dates.length > 0) map.set(rt.room_type_id, dates);
    }
    return map;
  }, [roomTypes, rangeDates, snapshot]);

  const targetRooms = useMemo(
    () => selectedRoomTypeId === ALL_ROOMS
      ? roomTypes
      : roomTypes.filter((rt) => rt.room_type_id === selectedRoomTypeId),
    [roomTypes, selectedRoomTypeId],
  );

  const blockedRooms = useMemo(
    () => targetRooms
      .map((rt) => ({ title: rt.title, dates: blockedDatesByRoom.get(rt.room_type_id) ?? [] }))
      .filter((r) => r.dates.length > 0),
    [targetRooms, blockedDatesByRoom],
  );

  // Si alguien más toca estas fechas mientras editás, el snapshot se actualiza solo
  // (el banner de abajo y el checkbox se recalculan) y ActivityToaster tira el aviso.
  const isRangeBlocked = blockedRooms.length > 0;

  const drawerPropertyTitle = useMemo(
    () => properties.find((p) => p.channex_property_id === drawerPropertyId)?.title ?? 'la propiedad',
    [properties, drawerPropertyId],
  );

  function formatBlockedDates(dates: string[]): string {
    if (dates.length === rangeDates.length && rangeDates.length > 1) return 'todo el rango';
    return dates.map((d) => d.slice(8, 10) + '/' + d.slice(5, 7)).join(', ');
  }

  function handleAddToBatch() {
    if (!drawerPropertyId || !selectedRoomTypeId || targetRooms.length === 0) return;

    const hasValue =
      availability !== '' ||
      rate !== '' ||
      minStay !== '' ||
      maxStay !== '' ||
      stopSell ||
      closedToArrival ||
      closedToDeparture;
    if (!hasValue) return;

    const entries: BatchEntry[] = targetRooms.map((rt) => {
      const ratePlanId = selectedRoomTypeId === ALL_ROOMS
        ? rt.rate_plans[0]?.rate_plan_id ?? ''
        : selectedRatePlanId;
      // Con la SS ya puesta, tildar el checkbox significa reabrir (stopSell=false).
      const roomBlocked = (blockedDatesByRoom.get(rt.room_type_id) ?? []).length > 0;
      return {
        id: batchCounterRef.current++,
        dateFrom,
        dateTo,
        propertyId: drawerPropertyId,
        roomTypeId: rt.room_type_id,
        ratePlanId,
        ...(availability !== '' ? { availability: Number(availability) } : {}),
        ...(rate !== '' ? { rate: String(rate) } : {}),
        ...(minStay !== '' ? { minStay: Number(minStay) } : {}),
        ...(maxStay !== '' ? { maxStay: Number(maxStay) } : {}),
        ...(stopSell ? { stopSell: !roomBlocked } : {}),
        ...(closedToArrival ? { closedToArrival } : {}),
        ...(closedToDeparture ? { closedToDeparture } : {}),
      };
    });

    setBatchQueue((prev) => [...prev, ...entries]);
    showToast(
      entries.length === 1
        ? `Agregado al grupo de cambios: ${targetRooms[0].title}`
        : `Agregados al grupo de cambios: ${entries.length} habitaciones`,
      'notice',
    );
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
    const pushed = batchQueue;
    const entryCount = pushed.length;
    setSaving(true);

    try {
      // Agrupar entries por propertyId
      const byProperty = new Map<string, typeof batchQueue>();
      for (const entry of batchQueue) {
        const group = byProperty.get(entry.propertyId) ?? [];
        group.push(entry);
        byProperty.set(entry.propertyId, group);
      }

      for (const [propId, entries] of byProperty) {
        const availUpdates = entries
          .filter((e) => e.availability !== undefined)
          .map((e) => ({
            room_type_id: e.roomTypeId,
            date_from: e.dateFrom,
            date_to: e.dateTo,
            availability: e.availability as number,
          }));

        if (availUpdates.length > 0) {
          await pushAvailabilityBatch(propId, availUpdates);
        }

        const restrictUpdates = entries
          .filter(
            (e) =>
              e.ratePlanId &&
              (e.rate !== undefined ||
                e.minStay !== undefined ||
                e.maxStay !== undefined ||
                e.stopSell !== undefined ||
                e.closedToArrival ||
                e.closedToDeparture),
          )
          .map((e) => ({
            rate_plan_id: e.ratePlanId,
            date_from: e.dateFrom,
            date_to: e.dateTo,
            ...(e.rate !== undefined ? { rate: e.rate } : {}),
            ...(e.minStay !== undefined ? { min_stay_arrival: e.minStay } : {}),
            ...(e.maxStay !== undefined ? { max_stay: e.maxStay } : {}),
            ...(e.stopSell !== undefined ? { stop_sell: e.stopSell } : {}),
            ...(e.closedToArrival ? { closed_to_arrival: true } : {}),
            ...(e.closedToDeparture ? { closed_to_departure: true } : {}),
          }));

        if (restrictUpdates.length > 0) {
          await pushRestrictionsBatch(propId, restrictUpdates);
        }
      }

      setBatchQueue([]);
      showToast(
        `Cambios guardados · ${entryCount} ${entryCount === 1 ? 'cambio enviado' : 'cambios enviados'} a Channex`,
        'ok',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error al guardar los cambios.', 'danger');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={close}
      />

      {/* Bottom sheet panel */}
      <div
        className="relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl bg-surface shadow-2xl"
        style={{
          transform: !visible
            ? 'translateY(100%)'
            : dragOffset > 0
            ? `translateY(${dragOffset}px)`
            : 'translateY(0)',
          transition: isDragging.current ? 'none' : 'transform 0.32s cubic-bezier(0.32,0.72,0,1)',
        }}
      >
        {/* Drag handle */}
        <div
          className="flex shrink-0 cursor-grab select-none justify-center pb-2 pt-3 touch-none active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="h-1.5 w-12 rounded-full bg-edge" />
        </div>

        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-edge bg-surface-raised px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-bold text-content">Gestionar calendario</span>
            <span className="flex items-center gap-1 rounded-md bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand">
              <Calendar size={10} />
              {dateFrom === dateTo ? dateFrom : `${dateFrom} → ${dateTo}`}
            </span>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-lg p-1.5 text-content-3 transition-colors hover:bg-surface-subtle hover:text-content"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="relative flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
          {loadingRooms && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-surface/95 backdrop-blur-sm">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-edge border-t-brand" />
              <span className="text-[12px] font-medium text-content-2">Cargando habitaciones...</span>
            </div>
          )}
          {isRangeBlocked && (
            <div className="flex items-start gap-2 rounded-lg bg-danger-bg px-3 py-2">
              <span className="mt-px text-[11px] font-bold text-danger-text">SS</span>
              <div className="text-[12px] font-medium text-danger-text">
                <p>Ventas cerradas en {drawerPropertyTitle}:</p>
                <ul className="mt-1 list-disc pl-4">
                  {blockedRooms.map((r) => (
                    <li key={r.title}>
                      <strong>{r.title}</strong> — {formatBlockedDates(r.dates)}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 font-normal">Tildá el checkbox de abajo para reabrirlas.</p>
              </div>
            </div>
          )}

          {/* Pre-filled banner */}
          {(initialPropertyId || initialRoomTypeId) && (
            <div className="flex items-start gap-2 rounded-lg bg-brand/10 px-3 py-2.5">
              <Calendar size={12} className="mt-0.5 shrink-0 text-brand" />
              <div>
                <p className="text-[11px] font-semibold text-brand">Seleccionado desde el calendario</p>
                {(prefilledPropertyTitle || prefilledRoomTitle) && (
                  <p className="mt-0.5 text-[11px] text-brand/80">
                    {[prefilledPropertyTitle, prefilledRoomTitle].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Property selector */}
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-content-2">
              Propiedad
            </label>
            <select
              value={drawerPropertyId}
              onChange={(e) => setDrawerPropertyId(e.target.value)}
              className="w-full rounded-lg border border-edge bg-surface px-3 py-2 text-[13px] text-content focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand/50 disabled:opacity-50"
            >
              <option value="">Seleccioná una propiedad</option>
              {properties.map((p) => (
                <option key={p.channex_property_id} value={p.channex_property_id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>

          {/* Room type selector */}
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-content-2">
              Habitacion
            </label>
            <select
              value={selectedRoomTypeId}
              disabled={!drawerPropertyId || loadingRooms}
              onChange={(e) => {
                setSelectedRoomTypeId(e.target.value);
                const room = roomTypes.find((rt) => rt.room_type_id === e.target.value);
                setSelectedRatePlanId(room?.rate_plans[0]?.rate_plan_id ?? '');
              }}
              className="w-full rounded-lg border border-edge bg-surface px-3 py-2 text-[13px] text-content focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand/50 disabled:opacity-50"
            >
              {!loadingRooms && roomTypes.length === 0 && drawerPropertyId && (
                <option value="" disabled>Sin habitaciones</option>
              )}
              {roomTypes.map((rt) => (
                <option key={rt.room_type_id} value={rt.room_type_id}>
                  {rt.title}
                </option>
              ))}
              {roomTypes.length > 1 && (
                <option value={ALL_ROOMS}>Todas las habitaciones ({roomTypes.length})</option>
              )}
            </select>
          </div>

          {/* Rate plan selector */}
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-content-2">
              Tarifa
            </label>
            {selectedRoomTypeId === ALL_ROOMS ? (
              <p className="rounded-lg border border-dashed border-edge px-3 py-2 text-[12px] text-content-3">
                Se aplica la tarifa principal de cada habitación.
              </p>
            ) : (
              <select
                value={selectedRatePlanId}
                disabled={!selectedRoomTypeId}
                onChange={(e) => setSelectedRatePlanId(e.target.value)}
                className="w-full rounded-lg border border-edge bg-surface px-3 py-2 text-[13px] text-content focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand/50 disabled:opacity-50"
              >
                {ratePlansForRoom.map((rp) => (
                  <option key={rp.rate_plan_id} value={rp.rate_plan_id}>
                    {rp.title}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Availability + Rate */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-content-2">
                Disponibilidad
              </label>
              <input
                type="number"
                min={0}
                value={availability}
                onChange={(e) =>
                  setAvailability(e.target.value === '' ? '' : Number(e.target.value))
                }
                placeholder="ej. 3"
                className="w-full rounded-lg border border-edge bg-surface px-3 py-2 text-[13px] text-content focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand/50"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-content-2">
                Tarifa
              </label>
              <input
                type="number"
                min={0}
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder="ej. 150"
                className="w-full rounded-lg border border-edge bg-surface px-3 py-2 text-[13px] text-content focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand/50"
              />
            </div>
          </div>

          {/* Min Stay + Max Stay */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-content-2">
                Min Stay
              </label>
              <input
                type="number"
                min={1}
                value={minStay}
                onChange={(e) =>
                  setMinStay(e.target.value === '' ? '' : Number(e.target.value))
                }
                placeholder="ej. 2"
                className="w-full rounded-lg border border-edge bg-surface px-3 py-2 text-[13px] text-content focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand/50"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-content-2">
                Max Stay
              </label>
              <input
                type="number"
                min={1}
                value={maxStay}
                onChange={(e) =>
                  setMaxStay(e.target.value === '' ? '' : Number(e.target.value))
                }
                placeholder="ej. 7"
                className="w-full rounded-lg border border-edge bg-surface px-3 py-2 text-[13px] text-content focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand/50"
              />
            </div>
          </div>

          {/* Restriction checkboxes */}
          <div className="flex flex-col gap-3">
            {(
              [
                [
                  'stopSell',
                  stopSell,
                  setStopSell,
                  isRangeBlocked ? 'Abrir ventas (quitar SS)' : 'Bloqueo de ventas (SS)',
                  isRangeBlocked
                    ? 'Este rango tiene ventas cerradas. Activá para reabrirlas.'
                    : 'Activa si no tenes mas habitaciones libres o queres pausar reservas.',
                ],
                // TODO: habilitar cuando se necesiten — botones CTA y CTD
                // [
                //   'cta',
                //   closedToArrival,
                //   setClosedToArrival,
                //   'Sin llegadas (CTA)',
                //   'Activa si ese dia no podes recibir huespedes.',
                // ],
                // [
                //   'ctd',
                //   closedToDeparture,
                //   setClosedToDeparture,
                //   'Sin salidas (CTD)',
                //   'Activa si ese dia no podes procesar salidas.',
                // ],
              ] as [string, boolean, (v: boolean) => void, string, string][]
            ).map(([key, val, setter, label, hint]) => (
              <label key={key} className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={val}
                  onChange={(e) => setter(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-edge text-brand focus:ring-brand/30"
                />
                <div>
                  <p className="text-[13px] font-medium text-content">{label}</p>
                  <p className="mt-0.5 text-[11px] text-content-3">{hint}</p>
                </div>
              </label>
            ))}
          </div>

          {/* Add to batch */}
          <button
            type="button"
            onClick={handleAddToBatch}
            disabled={!drawerPropertyId || !selectedRoomTypeId}
            className="w-full rounded-xl border border-brand/40 bg-brand/10 py-2.5 text-[13px] font-semibold text-brand transition-colors hover:bg-brand/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            + Agregar al grupo de cambios
          </button>

          {/* Batch queue */}
          {batchQueue.length > 0 && (
            <div className="rounded-xl border border-edge bg-surface-subtle p-3">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-content-3">
                Grupo de cambios ({batchQueue.length})
              </p>
              <div className="flex flex-col gap-1.5">
                {batchQueue.map((entry) => (
                  <div key={entry.id} className="flex items-start justify-between gap-2 text-[12px]">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-content">
                        {roomTypes.find((r) => r.room_type_id === entry.roomTypeId)?.title ?? '—'}
                        {' / '}
                        {allRatePlans.find((rp) => rp.rate_plan_id === entry.ratePlanId)?.title ?? '—'}
                      </p>
                      <p className="text-content-3">
                        {entry.dateFrom === entry.dateTo
                          ? entry.dateFrom
                          : `${entry.dateFrom} → ${entry.dateTo}`}
                        {entry.rate ? ` · $${entry.rate}` : ''}
                        {entry.availability !== undefined ? ` · Avail: ${entry.availability}` : ''}
                        {entry.stopSell ? ' · SS' : ''}
                        {entry.closedToArrival ? ' · CTA' : ''}
                        {entry.closedToDeparture ? ' · CTD' : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setBatchQueue((q) => q.filter((e) => e.id !== entry.id))}
                      className="shrink-0 text-danger-text/60 transition-colors hover:text-danger-text"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-edge bg-surface-raised px-4 py-3">
          <button
            type="button"
            onClick={handleSaveBatch}
            disabled={batchQueue.length === 0 || saving}
            className="w-full rounded-xl bg-brand py-2.5 text-[14px] font-bold text-white transition-colors hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? 'Guardando...' : `Guardar (${batchQueue.length})`}
          </button>
        </div>
      </div>

      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

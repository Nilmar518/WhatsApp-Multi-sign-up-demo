# Dashboard Calendar — Modo Restricciones + ARI Drawer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un modo "restricciones" al `DashboardCalendar` del dashboard principal (`/`). Un toggle en el header del calendario activa el modo de selección de rango; al completar el rango se abre `ARIRestrictionDrawer` (nuevo componente), un drawer lateral con el panel ARI completo: property selector, room type, rate plan, disponibilidad, tarifa, min/max stay, stop sell, CTA, CTD y batch queue.

**Spec:** `docs/superpowers/specs/2026-05-31-dashboard-calendar-restrictions-design.md`

**Architecture:** Tres archivos únicos. `ARICalendar.tsx` no se toca. Sin cambios de backend — usa `pushAvailabilityBatch` y `pushRestrictionsBatch` de `channexHubApi.ts`.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, hooks existentes (`useChannexProperties`, `listRoomTypes`), API existente (`pushAvailabilityBatch`, `pushRestrictionsBatch`).

---

## File Map

| Acción | Archivo | Responsabilidad |
|--------|---------|-----------------|
| MODIFICAR | `apps/frontend/src/components/dashboard/DashboardCalendar.tsx` | Toggle mode, range selection, nueva UX en modo edit |
| CREAR | `apps/frontend/src/components/dashboard/ARIRestrictionDrawer.tsx` | Drawer ARI completo con batch queue |
| MODIFICAR | `apps/frontend/src/components/dashboard/NewDashboardView.tsx` | Estado de modo/drawer/range, wiring entre calendario y drawer |

---

## Task 1: Modificar DashboardCalendar — Props de modo y toggle

**Archivo:** `apps/frontend/src/components/dashboard/DashboardCalendar.tsx`

### Contexto
El componente actual recibe `bookings`, `selectedDate`, `onDateSelect`. Necesita tres props opcionales nuevas para el modo restricciones.

- [ ] **Step 1: Agregar props nuevas a la interface**

```typescript
// Agregar a DashboardCalendarProps:
mode?: 'view' | 'edit';
onModeChange?: (mode: 'view' | 'edit') => void;
onRangeComplete?: (from: string, to: string) => void;
```

Actualizar la destructuring en la firma del componente:
```typescript
export default function DashboardCalendar({
  bookings,
  selectedDate,
  onDateSelect,
  mode = 'view',
  onModeChange,
  onRangeComplete,
}: DashboardCalendarProps)
```

- [ ] **Step 2: Agregar estado local `rangeStart`**

```typescript
const [rangeStart, setRangeStart] = useState<string | null>(null);
```

Agregar después de la declaración de `viewDate`.

- [ ] **Step 3: Agregar toggle de modo en el header del calendario**

Reemplazar el `<h2>` del mes por un layout con el título a la izquierda/centro y el toggle a la derecha:

```tsx
{/* ANTES: */}
<h2 className="text-[15px] font-bold text-content tracking-tight">
  {MONTH_NAMES[month]} {year}
</h2>

{/* DESPUÉS: wrapper flex con h2 + toggle */}
<h2 className="text-[15px] font-bold text-content tracking-tight">
  {MONTH_NAMES[month]} {year}
</h2>
{onModeChange && (
  <button
    type="button"
    onClick={() => {
      const next = mode === 'view' ? 'edit' : 'view';
      if (next === 'view') setRangeStart(null);
      onModeChange(next);
    }}
    className={[
      'flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors',
      mode === 'edit'
        ? 'bg-caution text-white'
        : 'bg-surface-subtle text-content-2 hover:text-content hover:bg-surface-raised border border-edge',
    ].join(' ')}
  >
    {mode === 'edit' ? '✏️ Restricciones' : 'Restricciones'}
  </button>
)}
```

- [ ] **Step 4: Cambiar el fondo del header en modo edit**

El `<div>` del header (el que contiene los botones prev/next y el título) debe mostrar un fondo diferenciado en modo edit:

```tsx
<div className={[
  'flex items-center justify-between px-4 py-3 border-b border-edge/60',
  mode === 'edit' ? 'bg-caution-bg/40' : '',
].join(' ')}>
```

- [ ] **Step 5: Cambiar el comportamiento del clic en celda según el modo**

Reemplazar el handler `onClick` de cada celda de día:

```tsx
{/* ANTES: */}
onClick={() => onDateSelect(cell)}

{/* DESPUÉS: */}
onClick={() => {
  if (mode === 'view') {
    onDateSelect(cell);
    return;
  }
  // modo edit — selección de rango
  if (!rangeStart) {
    setRangeStart(cell);
    return;
  }
  if (cell === rangeStart) {
    // mismo día → rango de un día
    onRangeComplete?.(cell, cell);
    setRangeStart(null);
    return;
  }
  if (cell >= rangeStart) {
    onRangeComplete?.(rangeStart, cell);
  } else {
    // clic en fecha anterior → nuevo inicio
    setRangeStart(cell);
    return;
  }
  setRangeStart(null);
}}
```

- [ ] **Step 6: Agregar highlight visual del rango en construcción**

En el cálculo de clases de la celda, agregar lógica para `rangeStart` en modo edit:

```tsx
const isRangeStart = mode === 'edit' && rangeStart === cell;
// Agregar al className join:
isRangeStart
  ? 'bg-brand/20 border border-brand text-brand'
  : /* clases existentes */
```

La clase `isSelected` existente se mantiene intacta para el modo view.

- [ ] **Step 7: Verificar en el navegador (modo view)**

1. Abrir `/` — confirmar que el calendario se ve igual que antes
2. Los dots de reservas se muestran correctamente
3. Clic en un día → selecciona la fecha, las cards de abajo se actualizan
4. No hay ningún botón de toggle visible (porque `onModeChange` no está pasado aún — lo estará en Task 3)

---

## Task 2: Crear ARIRestrictionDrawer

**Archivo:** `apps/frontend/src/components/dashboard/ARIRestrictionDrawer.tsx`

Este componente es un slide-over lateral con el panel ARI completo y batch queue.

- [ ] **Step 1: Crear la interface BatchEntry y los imports**

```typescript
import { useState, useEffect, useMemo } from 'react';
import { X, Calendar } from 'lucide-react';
import {
  listRoomTypes,
  pushAvailabilityBatch,
  pushRestrictionsBatch,
  type StoredRoomType,
} from '../../channex/api/channexHubApi';
import type { ChannexProperty } from '../../channex/hooks/useChannexProperties';

let batchCounter = 0;

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
  properties: ChannexProperty[];
}
```

- [ ] **Step 2: Declarar estado interno**

```typescript
export default function ARIRestrictionDrawer({
  open, onClose, tenantId, dateFrom, dateTo, initialPropertyId, properties,
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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastTaskIds, setLastTaskIds] = useState<string[]>([]);
```

- [ ] **Step 3: Sincronizar `drawerPropertyId` cuando cambia `initialPropertyId` desde afuera**

```typescript
useEffect(() => {
  setDrawerPropertyId(initialPropertyId ?? '');
}, [initialPropertyId]);
```

- [ ] **Step 4: Cargar room types cuando cambia `drawerPropertyId`**

```typescript
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
      const first = safe.find((rt) => rt.rate_plans.length > 0);
      if (first) {
        setSelectedRoomTypeId(first.room_type_id);
        setSelectedRatePlanId(first.rate_plans[0].rate_plan_id);
      }
    })
    .catch(() => {})
    .finally(() => setLoadingRooms(false));
}, [drawerPropertyId]);
```

- [ ] **Step 5: Derivar `ratePlansForRoom` y `allRatePlans`**

```typescript
const ratePlansForRoom = useMemo(
  () => roomTypes.find((rt) => rt.room_type_id === selectedRoomTypeId)?.rate_plans ?? [],
  [roomTypes, selectedRoomTypeId],
);

const allRatePlans = useMemo(
  () => roomTypes.flatMap((rt) => rt.rate_plans),
  [roomTypes],
);
```

- [ ] **Step 6: Implementar `handleAddToBatch`**

```typescript
function handleAddToBatch() {
  if (!drawerPropertyId || !selectedRoomTypeId) return;
  setBatchQueue((prev) => [
    ...prev,
    {
      id: batchCounter++,
      dateFrom,
      dateTo,
      propertyId: drawerPropertyId,
      roomTypeId: selectedRoomTypeId,
      ratePlanId: selectedRatePlanId,
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
  setLastTaskIds([]);
  setSaveError(null);
}
```

- [ ] **Step 7: Implementar `handleSaveBatch`**

```typescript
async function handleSaveBatch() {
  if (batchQueue.length === 0) return;
  setSaving(true);
  setSaveError(null);
  const taskIds: string[] = [];

  try {
    const availUpdates = batchQueue
      .filter((e) => e.availability !== undefined)
      .map((e) => ({
        room_type_id: e.roomTypeId,
        date_from: e.dateFrom,
        date_to: e.dateTo,
        availability: e.availability!,
      }));

    if (availUpdates.length > 0) {
      const res = await pushAvailabilityBatch(drawerPropertyId, availUpdates);
      taskIds.push(res.taskId);
    }

    const restrictUpdates = batchQueue
      .filter((e) => e.ratePlanId && (
        e.rate !== undefined || e.minStay !== undefined || e.maxStay !== undefined ||
        e.stopSell || e.closedToArrival || e.closedToDeparture
      ))
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
      const res = await pushRestrictionsBatch(drawerPropertyId, restrictUpdates);
      taskIds.push(res.taskId);
    }

    setLastTaskIds(taskIds);
    setBatchQueue([]);
  } catch (err) {
    setSaveError(err instanceof Error ? err.message : 'Error al guardar.');
  } finally {
    setSaving(false);
  }
}
```

- [ ] **Step 8: Renderizar el overlay y el drawer**

```tsx
if (!open) return null;

return (
  <>
    {/* Overlay */}
    <div
      className="fixed inset-0 bg-black/40 z-40"
      onClick={onClose}
    />

    {/* Drawer */}
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:max-w-sm bg-surface border-l border-edge shadow-xl flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-edge bg-surface-raised flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-bold text-content">Restricciones</span>
          <span className="flex items-center gap-1 rounded-md bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand">
            <Calendar size={10} />
            {dateFrom === dateTo ? dateFrom : `${dateFrom} → ${dateTo}`}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-content-3 hover:text-content hover:bg-surface-subtle transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">

        {/* Property selector */}
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-content-2">
            Propiedad
          </label>
          <select
            value={drawerPropertyId}
            onChange={(e) => setDrawerPropertyId(e.target.value)}
            className="w-full rounded-lg border border-edge bg-surface px-3 py-2 text-[13px] text-content
                       focus:outline-none focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
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
            Habitación
          </label>
          <select
            value={selectedRoomTypeId}
            disabled={!drawerPropertyId || loadingRooms}
            onChange={(e) => {
              setSelectedRoomTypeId(e.target.value);
              const room = roomTypes.find((rt) => rt.room_type_id === e.target.value);
              setSelectedRatePlanId(room?.rate_plans[0]?.rate_plan_id ?? '');
            }}
            className="w-full rounded-lg border border-edge bg-surface px-3 py-2 text-[13px] text-content
                       disabled:opacity-50 focus:outline-none focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
          >
            {roomTypes.map((rt) => (
              <option key={rt.room_type_id} value={rt.room_type_id}>{rt.title}</option>
            ))}
          </select>
        </div>

        {/* Rate plan selector */}
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-content-2">
            Tarifa
          </label>
          <select
            value={selectedRatePlanId}
            disabled={!selectedRoomTypeId}
            onChange={(e) => setSelectedRatePlanId(e.target.value)}
            className="w-full rounded-lg border border-edge bg-surface px-3 py-2 text-[13px] text-content
                       disabled:opacity-50 focus:outline-none focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
          >
            {ratePlansForRoom.map((rp) => (
              <option key={rp.rate_plan_id} value={rp.rate_plan_id}>{rp.title}</option>
            ))}
          </select>
        </div>

        {/* ARI fields: availability + rate */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-content-2">
              Disponibilidad
            </label>
            <input
              type="number" min={0}
              value={availability}
              onChange={(e) => setAvailability(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="ej. 3"
              className="w-full rounded-lg border border-edge bg-surface px-3 py-2 text-[13px] text-content
                         focus:outline-none focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-content-2">
              Tarifa
            </label>
            <input
              type="number" min={0}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="ej. 150"
              className="w-full rounded-lg border border-edge bg-surface px-3 py-2 text-[13px] text-content
                         focus:outline-none focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
            />
          </div>
        </div>

        {/* Min stay + Max stay */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-content-2">
              Min Stay
            </label>
            <input
              type="number" min={1}
              value={minStay}
              onChange={(e) => setMinStay(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="ej. 2"
              className="w-full rounded-lg border border-edge bg-surface px-3 py-2 text-[13px] text-content
                         focus:outline-none focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-content-2">
              Max Stay
            </label>
            <input
              type="number" min={1}
              value={maxStay}
              onChange={(e) => setMaxStay(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="ej. 7"
              className="w-full rounded-lg border border-edge bg-surface px-3 py-2 text-[13px] text-content
                         focus:outline-none focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
            />
          </div>
        </div>

        {/* Restriction checkboxes */}
        <div className="flex flex-col gap-3">
          {([
            ['stopSell', stopSell, setStopSell, 'Bloqueo de ventas (SS)', 'Activá si no tenés más habitaciones libres o querés pausar reservas.'],
            ['cta', closedToArrival, setClosedToArrival, 'Sin llegadas (CTA)', 'Activá si ese día no podés recibir huéspedes.'],
            ['ctd', closedToDeparture, setClosedToDeparture, 'Sin salidas (CTD)', 'Activá si ese día no podés procesar salidas.'],
          ] as [string, boolean, (v: boolean) => void, string, string][]).map(([key, val, setter, label, hint]) => (
            <label key={key} className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={val}
                onChange={(e) => setter(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-edge text-brand focus:ring-brand/30"
              />
              <div>
                <p className="text-[13px] font-medium text-content">{label}</p>
                <p className="text-[11px] text-content-3 mt-0.5">{hint}</p>
              </div>
            </label>
          ))}
        </div>

        {/* Add to batch button */}
        <button
          type="button"
          onClick={handleAddToBatch}
          disabled={!drawerPropertyId || !selectedRoomTypeId}
          className="w-full rounded-xl border border-brand/40 bg-brand/10 py-2.5 text-[13px] font-semibold
                     text-brand hover:bg-brand/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          + Agregar al batch
        </button>

        {/* Batch queue */}
        {batchQueue.length > 0 && (
          <div className="rounded-xl border border-edge bg-surface-subtle p-3">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-content-3">
              Cola de cambios ({batchQueue.length})
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
                      {entry.dateFrom === entry.dateTo ? entry.dateFrom : `${entry.dateFrom} → ${entry.dateTo}`}
                      {entry.rate ? ` · $${entry.rate}` : ''}
                      {entry.stopSell ? ' · SS' : ''}
                      {entry.closedToArrival ? ' · CTA' : ''}
                      {entry.closedToDeparture ? ' · CTD' : ''}
                      {entry.availability !== undefined ? ` · Avail: ${entry.availability}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setBatchQueue((q) => q.filter((e) => e.id !== entry.id))}
                    className="shrink-0 text-danger-text/60 hover:text-danger-text transition-colors"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Save error */}
        {saveError && (
          <p className="rounded-lg bg-danger-bg px-3 py-2 text-[12px] font-medium text-danger-text">
            {saveError}
          </p>
        )}

        {/* Task IDs banner */}
        {lastTaskIds.length > 0 && (
          <div className="rounded-lg bg-ok-bg px-3 py-2 text-[12px] font-medium text-ok-text">
            Guardado · Task {lastTaskIds.join(', ')}
          </div>
        )}
      </div>

      {/* Footer: Save button */}
      <div className="flex-shrink-0 border-t border-edge px-4 py-3 bg-surface-raised">
        <button
          type="button"
          onClick={handleSaveBatch}
          disabled={batchQueue.length === 0 || saving}
          className="w-full rounded-xl bg-brand py-2.5 text-[14px] font-bold text-white
                     hover:bg-brand/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Guardando…' : `Guardar (${batchQueue.length})`}
        </button>
      </div>
    </div>
  </>
);
```

- [ ] **Step 9: Verificar el drawer en aislamiento**

1. Importar `ARIRestrictionDrawer` temporalmente en `NewDashboardView` y renderizarlo con `open={true}`, `dateFrom="2026-06-01"`, `dateTo="2026-06-07"`, `initialPropertyId={null}`
2. Confirmar que el overlay oscuro aparece y el drawer se muestra a la derecha
3. Confirmar que el selector de propiedad muestra las propiedades del tenant
4. Seleccionar una propiedad → room types y rate plans se cargan correctamente
5. Llenar campos → "Agregar al batch" → entry aparece en la cola
6. "Guardar" → task IDs aparecen en banner verde
7. Deshacer el render temporal (se conecta correctamente en Task 3)

---

## Task 3: Modificar NewDashboardView — Estado de modo y wiring

**Archivo:** `apps/frontend/src/components/dashboard/NewDashboardView.tsx`

- [ ] **Step 1: Agregar estado nuevo**

```typescript
const [calendarMode, setCalendarMode] = useState<'view' | 'edit'>('view');
const [restrictionRange, setRestrictionRange] = useState<{ from: string; to: string } | null>(null);
const [showARIDrawer, setShowARIDrawer] = useState(false);
```

- [ ] **Step 2: Agregar handlers**

```typescript
function handleRangeComplete(from: string, to: string) {
  setRestrictionRange({ from, to });
  setShowARIDrawer(true);
}

function handleModeChange(mode: 'view' | 'edit') {
  setCalendarMode(mode);
  if (mode === 'view') {
    setShowARIDrawer(false);
    setRestrictionRange(null);
  }
}
```

- [ ] **Step 3: Pasar props nuevas a DashboardCalendar**

```tsx
{/* ANTES: */}
<DashboardCalendar
  bookings={filteredBookings}
  selectedDate={selectedDate}
  onDateSelect={setSelectedDate}
/>

{/* DESPUÉS: */}
<DashboardCalendar
  bookings={filteredBookings}
  selectedDate={selectedDate}
  onDateSelect={setSelectedDate}
  mode={calendarMode}
  onModeChange={handleModeChange}
  onRangeComplete={handleRangeComplete}
/>
```

- [ ] **Step 4: Agregar import de ARIRestrictionDrawer y montarlo condicionalmente**

Agregar import:
```typescript
import ARIRestrictionDrawer from './ARIRestrictionDrawer';
```

Agregar al final del JSX, justo antes del cierre del `<div>` raíz (después de `NoConversationModal`):
```tsx
{showARIDrawer && restrictionRange && (
  <ARIRestrictionDrawer
    open={showARIDrawer}
    onClose={() => setShowARIDrawer(false)}
    tenantId={businessId}
    dateFrom={restrictionRange.from}
    dateTo={restrictionRange.to}
    initialPropertyId={selectedPropertyId || null}
    properties={properties}
  />
)}
```

- [ ] **Step 5: Verificar el flujo completo**

**Flujo 1 — Con propiedad seleccionada:**
1. En el dashboard, seleccionar "Casa del Sol" en el dropdown de propiedades
2. Click en botón "Restricciones" del header del calendario → header cambia a fondo amber
3. Click en día 10 → día 10 se resalta con borde brand (rangeStart)
4. Click en día 15 → drawer se abre con "10 Jun → 15 Jun" y propiedad pre-seleccionada "Casa del Sol"
5. Room types y rate plans se cargan automáticamente
6. Ingresar tarifa: 200, Min Stay: 2 → "Agregar al batch"
7. Entry aparece en la cola con el rango correcto
8. "Guardar (1)" → task ID en banner verde

**Flujo 2 — Sin propiedad seleccionada ("Todas las propiedades"):**
1. Dejar el filtro en "Todas las propiedades"
2. Activar modo restricciones → seleccionar rango → drawer abre
3. El selector de propiedad está vacío (placeholder "Seleccioná una propiedad")
4. Room type y rate plan deshabilitados hasta seleccionar propiedad
5. Seleccionar propiedad → room types cargan → flujo normal

**Flujo 3 — Regreso a modo view:**
1. Estando en modo edit con el drawer abierto
2. Click en "Restricciones" (toggle off) → drawer cierra, range se limpia, calendar vuelve a comportamiento normal
3. Click en un día → selecciona fecha para cards (comportamiento original)

---

## Self-Review

| Requerimiento | Tarea |
|--------------|-------|
| Toggle modo view/edit en DashboardCalendar | Task 1 ✅ |
| Selección de rango en modo edit | Task 1 ✅ |
| Dots de reservas visibles en ambos modos | Task 1 ✅ (no se toca dotsMap) |
| ARIRestrictionDrawer aislado de ARICalendar | Task 2 ✅ |
| Property selector en drawer (opción B) | Task 2 ✅ |
| Room type / rate plan con estructura anidada | Task 2 ✅ (rate_plans[]) |
| Batch queue con dateFrom/dateTo por entry | Task 2 ✅ |
| Save llama pushAvailabilityBatch + pushRestrictionsBatch | Task 2 ✅ |
| Wiring NewDashboardView → Calendar → Drawer | Task 3 ✅ |
| Filtro de propiedad afecta initialPropertyId del drawer | Task 3 ✅ |
| Sin cambios en ARICalendar.tsx | Confirmado ✅ |
| Sin cambios de backend | Confirmado ✅ |

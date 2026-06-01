# Per-Room Calendar in Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuando la propiedad seleccionada tiene más de 1 room type, el dashboard principal muestra calendarios independientes por room: el calendario principal pasa a mostrar Room 1, y se agregan calendarios para Room 2..N debajo. Cada calendar tiene sus propias reservation cards y puede abrir el drawer de restricciones con propiedad + room pre-seleccionados. Al final se muestra una sección de reservas sin room mapeado.

**Spec:** `docs/superpowers/specs/2026-06-01-per-room-calendar-design.md`

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Firebase Firestore (`onSnapshot`), hooks existentes.

**Sin cambios de backend.** Sin cambios en `DashboardCalendar.tsx` ni `ReservationCard.tsx`.

---

## File Map

| Acción | Archivo | Responsabilidad |
|--------|---------|-----------------|
| MODIFICAR | `apps/frontend/src/components/dashboard/NewDashboardView.tsx` | Cargar room types, snapshot raw, splits, render condicional per-room |
| CREAR | `apps/frontend/src/components/dashboard/RoomCalendarSection.tsx` | Calendar + reservas + drawer por room |
| MODIFICAR | `apps/frontend/src/components/dashboard/ARIRestrictionDrawer.tsx` | Prop `initialRoomTypeId`, deshabilitar selectors pre-filled |

---

## Helper compartido (añadir en NewDashboardView antes de los hooks)

```typescript
function computeSSdates(snapshot: ARIMonthSnapshot, ratePlanIds: Set<string>): Set<string> {
  const ss = new Set<string>();
  for (const [date, day] of Object.entries(snapshot)) {
    for (const [rpId, rp] of Object.entries(day.ratePlans ?? {})) {
      if ((ratePlanIds.size === 0 || ratePlanIds.has(rpId)) && rp.stopSell) ss.add(date);
    }
  }
  return ss;
}
```

---

## Task 1: Modificar ARIRestrictionDrawer — prop `initialRoomTypeId`

**Archivo:** `apps/frontend/src/components/dashboard/ARIRestrictionDrawer.tsx`

### Contexto
El drawer actualmente recibe `initialPropertyId: string | null` y auto-selecciona la propiedad. Necesita la misma lógica para `initialRoomTypeId`.

- [ ] **Step 1: Agregar `initialRoomTypeId?: string` a la interface de props**

```typescript
interface ARIRestrictionDrawerProps {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  dateFrom: string;
  dateTo: string;
  initialPropertyId: string | null;
  initialRoomTypeId?: string;         // ← nuevo
  properties: ChannexProperty[];
}
```

Actualizar la destructuring del componente para incluir `initialRoomTypeId`.

- [ ] **Step 2: Actualizar el useEffect de carga de room types para respetar `initialRoomTypeId`**

Buscar el `useEffect` que llama a `listRoomTypes(drawerPropertyId)`. Cambiar la lógica de auto-selección:

```typescript
// ANTES:
const first = safe.find((rt) => rt.rate_plans.length > 0);
if (first) {
  setSelectedRoomTypeId(first.room_type_id);
  setSelectedRatePlanId(first.rate_plans[0].rate_plan_id);
}

// DESPUÉS:
const targetId = initialRoomTypeId ?? safe.find((rt) => rt.rate_plans.length > 0)?.room_type_id;
const targetRoom = safe.find((rt) => rt.room_type_id === targetId);
if (targetRoom) {
  setSelectedRoomTypeId(targetRoom.room_type_id);
  setSelectedRatePlanId(targetRoom.rate_plans[0]?.rate_plan_id ?? '');
}
```

Agregar `initialRoomTypeId` al array de dependencias del useEffect.

- [ ] **Step 3: Deshabilitar el selector de room type cuando `initialRoomTypeId` está definido**

```tsx
// ANTES:
<select
  value={selectedRoomTypeId}
  disabled={!drawerPropertyId || loadingRooms}
  ...

// DESPUÉS:
<select
  value={selectedRoomTypeId}
  disabled={!drawerPropertyId || loadingRooms || !!initialRoomTypeId}
  ...
```

- [ ] **Step 4: Deshabilitar el selector de propiedad cuando `initialPropertyId` es no-vacío**

```tsx
// ANTES:
<select value={drawerPropertyId} onChange={(e) => setDrawerPropertyId(e.target.value)} ...

// DESPUÉS:
<select
  value={drawerPropertyId}
  onChange={(e) => setDrawerPropertyId(e.target.value)}
  disabled={!!initialPropertyId}
  ...
```

- [ ] **Step 5: TypeScript check**

```
cd "D:\migo\repos\WhatsApp Multi sign up demo" && pnpm --filter @migo-uit/frontend exec tsc --noEmit 2>&1 | head -20
```

---

## Task 2: Crear RoomCalendarSection

**Archivo:** `apps/frontend/src/components/dashboard/RoomCalendarSection.tsx`

Este componente encapsula todo lo que necesita un calendar por room: su propio estado, snapshot, SS dates, reservation cards y drawer de restricciones.

- [ ] **Step 1: Crear el archivo con imports, interface y estado**

```typescript
import { useState, useEffect, useMemo } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import type { Reservation, ARIMonthSnapshot, StoredRoomType } from '../../channex/api/channexHubApi';
import type { ChannexProperty } from '../../channex/hooks/useChannexProperties';
import type { ChannexThread } from '../../channex/hooks/useChannexThreads';
import DashboardCalendar from './DashboardCalendar';
import ReservationCard from './ReservationCard';
import ARIRestrictionDrawer from './ARIRestrictionDrawer';
import { Hotel } from 'lucide-react';

type CardStatus = 'checkin' | 'inprogress' | 'checkout' | 'cancelled';
const STATUS_ORDER: Record<CardStatus, number> = { checkin: 0, inprogress: 1, checkout: 2, cancelled: 3 };

function isoToday(): string {
  return new Date().toISOString().split('T')[0];
}

function getCardStatus(r: Reservation, date: string): CardStatus {
  if (r.booking_status === 'cancelled') return 'cancelled';
  if (r.check_in === date) return 'checkin';
  if (r.check_out === date) return 'checkout';
  return 'inprogress';
}

interface RoomCalendarSectionProps {
  roomType: StoredRoomType;
  bookings: Reservation[];
  tenantId: string;
  propertyId: string;
  propertyTitle: string;
  properties: ChannexProperty[];
  threads: ChannexThread[];
  onViewDetail: (r: Reservation) => void;
  onNoThread: (r: Reservation) => void;
}
```

- [ ] **Step 2: Implementar el componente con estado, snapshot y SS dates**

```typescript
export default function RoomCalendarSection({
  roomType, bookings, tenantId, propertyId, propertyTitle,
  properties, threads, onViewDetail, onNoThread,
}: RoomCalendarSectionProps) {
  const [selectedDate, setSelectedDate] = useState<string>(isoToday);
  const [calendarMode, setCalendarMode] = useState<'view' | 'edit'>('view');
  const [restrictionRange, setRestrictionRange] = useState<{ from: string; to: string } | null>(null);
  const [showARIDrawer, setShowARIDrawer] = useState(false);
  const [monthKey, setMonthKey] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [snapshot, setSnapshot] = useState<ARIMonthSnapshot>({});

  // Suscripción Firestore al snapshot ARI
  useEffect(() => {
    if (!propertyId || !tenantId) { setSnapshot({}); return; }
    const ref = doc(db, 'channex_integrations', tenantId, 'properties', propertyId, 'ari_snapshots', monthKey);
    const unsub = onSnapshot(ref, snap => {
      setSnapshot(snap.exists() ? (snap.data() as ARIMonthSnapshot) : {});
    }, () => setSnapshot({}));
    return () => unsub();
  }, [tenantId, propertyId, monthKey]);

  // SS dates filtradas por los rate plans de este room type
  const ssDateSet = useMemo(() => {
    const ids = new Set(roomType.rate_plans.map(rp => rp.rate_plan_id));
    const ss = new Set<string>();
    for (const [date, day] of Object.entries(snapshot)) {
      for (const [rpId, rp] of Object.entries(day.ratePlans ?? {})) {
        if (ids.has(rpId) && rp.stopSell) ss.add(date);
      }
    }
    return ss;
  }, [snapshot, roomType]);

  // Reservas para la fecha seleccionada, ordenadas por status
  const selectedDateBookings = useMemo(() =>
    bookings.filter(r => r.check_in <= selectedDate && r.check_out >= selectedDate),
    [bookings, selectedDate]);

  const sortedBookings = useMemo(() =>
    [...selectedDateBookings].sort((a, b) =>
      STATUS_ORDER[getCardStatus(a, selectedDate)] - STATUS_ORDER[getCardStatus(b, selectedDate)]),
    [selectedDateBookings, selectedDate]);

  const selectedDateLabel = useMemo(() => {
    const [y, m, d] = selectedDate.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('es', {
      weekday: 'long', day: 'numeric', month: 'long',
    });
  }, [selectedDate]);

  function handleModeChange(mode: 'view' | 'edit') {
    setCalendarMode(mode);
    if (mode === 'view') { setShowARIDrawer(false); setRestrictionRange(null); }
  }

  function handleRangeComplete(from: string, to: string) {
    setRestrictionRange({ from, to });
    setShowARIDrawer(true);
  }

  function handleViewMonthChange(key: string) {
    setMonthKey(key);
  }
```

- [ ] **Step 3: Renderizar el componente**

```tsx
  return (
    <div className="flex flex-col gap-4">
      {/* Room header divider */}
      <div className="flex items-center gap-3 px-1">
        <span className="h-px flex-1 bg-edge" />
        <span className="text-[11px] font-bold uppercase tracking-widest text-content-3">
          {roomType.title}
        </span>
        <span className="h-px flex-1 bg-edge" />
      </div>

      {/* Calendar */}
      <DashboardCalendar
        bookings={bookings}
        selectedDate={selectedDate}
        onDateSelect={setSelectedDate}
        mode={calendarMode}
        onModeChange={handleModeChange}
        onRangeComplete={handleRangeComplete}
        stopSellDates={ssDateSet}
        onViewMonthChange={handleViewMonthChange}
      />

      {/* Reservation cards */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-bold text-content capitalize">{selectedDateLabel}</h3>
          {sortedBookings.length > 0 && (
            <span className="text-[11px] text-content-3 font-medium">
              {sortedBookings.length} {sortedBookings.length === 1 ? 'reserva' : 'reservas'}
            </span>
          )}
        </div>

        {sortedBookings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-10 h-10 rounded-xl bg-surface-subtle flex items-center justify-center mb-2">
              <Hotel size={16} className="text-content-3" />
            </div>
            <p className="text-[12px] font-semibold text-content-2">Sin reservas este día</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {sortedBookings.map(r => (
              <ReservationCard
                key={r.id ?? r.channex_booking_id ?? r.reservation_id}
                reservation={r}
                selectedDate={selectedDate}
                threads={threads}
                onViewDetail={onViewDetail}
                onNoThread={onNoThread}
              />
            ))}
          </div>
        )}
      </div>

      {/* ARI Restriction Drawer para este room */}
      {showARIDrawer && restrictionRange && (
        <ARIRestrictionDrawer
          open={showARIDrawer}
          onClose={() => setShowARIDrawer(false)}
          tenantId={tenantId}
          dateFrom={restrictionRange.from}
          dateTo={restrictionRange.to}
          initialPropertyId={propertyId}
          initialRoomTypeId={roomType.room_type_id}
          properties={properties}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: TypeScript check**

```
cd "D:\migo\repos\WhatsApp Multi sign up demo" && pnpm --filter @migo-uit/frontend exec tsc --noEmit 2>&1 | head -20
```

---

## Task 3: Modificar NewDashboardView — per-room logic + render

**Archivo:** `apps/frontend/src/components/dashboard/NewDashboardView.tsx`

- [ ] **Step 1: Actualizar imports**

Agregar a los imports existentes:
```typescript
import { listRoomTypes, type StoredRoomType, type ARIMonthSnapshot, type DayRatePlanSnapshot } from '../../channex/api/channexHubApi';
import RoomCalendarSection from './RoomCalendarSection';
```

Asegurarse que `ARIMonthSnapshot` está importado (puede ya estar, verificar).

- [ ] **Step 2: Agregar estado**

Después del `useState` de `stopSellDates` (que vamos a reemplazar):
```typescript
const [roomTypes, setRoomTypes] = useState<StoredRoomType[]>([]);
const [ariSnapshot, setAriSnapshot] = useState<ARIMonthSnapshot>({});
```

Eliminar: `const [stopSellDates, setStopSellDates] = useState<Set<string>>(new Set());`

- [ ] **Step 3: Agregar helper `computeSSdates` antes del componente**

Antes de `export default function NewDashboardView`:

```typescript
function computeSSdates(snapshot: ARIMonthSnapshot, ratePlanIds: Set<string>): Set<string> {
  const ss = new Set<string>();
  for (const [date, day] of Object.entries(snapshot)) {
    for (const [rpId, rp] of Object.entries(day.ratePlans ?? {})) {
      if ((ratePlanIds.size === 0 || ratePlanIds.has(rpId)) && rp.stopSell) ss.add(date);
    }
  }
  return ss;
}
```

- [ ] **Step 4: Agregar useEffect para cargar room types**

Después del useEffect de bookings:
```typescript
useEffect(() => {
  if (!selectedPropertyId) { setRoomTypes([]); return; }
  listRoomTypes(selectedPropertyId)
    .then(data => setRoomTypes(Array.isArray(data) ? data : []))
    .catch(() => setRoomTypes([]));
}, [selectedPropertyId]);
```

- [ ] **Step 5: Reemplazar el useEffect del snapshot ARI**

Encontrar el `useEffect` que usa `setStopSellDates` y reemplazarlo:

```typescript
useEffect(() => {
  if (!selectedPropertyId || !businessId) { setAriSnapshot({}); return; }
  const ref = doc(db, 'channex_integrations', businessId, 'properties',
    selectedPropertyId, 'ari_snapshots', calendarMonthKey);
  const unsub = onSnapshot(ref, snap => {
    setAriSnapshot(snap.exists() ? (snap.data() as ARIMonthSnapshot) : {});
  }, () => setAriSnapshot({}));
  return () => unsub();
}, [selectedPropertyId, businessId, calendarMonthKey]);
```

- [ ] **Step 6: Agregar derivaciones per-room**

Después de las derivaciones existentes (`filteredBookings`, `selectedDateBookings`, `sortedBookings`):

```typescript
const showPerRoom = !!selectedPropertyId && roomTypes.length > 1;

const mainCalendarBookings = useMemo(() =>
  showPerRoom && roomTypes[0]
    ? filteredBookings.filter(b => b.room_type_id === roomTypes[0].room_type_id)
    : filteredBookings,
  [filteredBookings, showPerRoom, roomTypes]);

const allSSdates = useMemo(() => computeSSdates(ariSnapshot, new Set()), [ariSnapshot]);

const room1SSdates = useMemo(() => {
  if (!showPerRoom || !roomTypes[0]) return allSSdates;
  const ids = new Set(roomTypes[0].rate_plans.map(rp => rp.rate_plan_id));
  return computeSSdates(ariSnapshot, ids);
}, [ariSnapshot, roomTypes, showPerRoom, allSSdates]);

const mainSSdates = showPerRoom ? room1SSdates : allSSdates;

const unmappedBookings = useMemo(() => {
  if (!showPerRoom) return [];
  const known = new Set(roomTypes.map(rt => rt.room_type_id));
  return filteredBookings.filter(b => !b.room_type_id || !known.has(b.room_type_id));
}, [filteredBookings, roomTypes, showPerRoom]);
```

- [ ] **Step 7: Actualizar las derivaciones existentes para usar `mainCalendarBookings`**

Cambiar `selectedDateBookings` y `sortedBookings` para usar `mainCalendarBookings` en lugar de `filteredBookings`:

```typescript
const selectedDateBookings = useMemo(
  () => mainCalendarBookings.filter((r) => r.check_in <= selectedDate && r.check_out >= selectedDate),
  [mainCalendarBookings, selectedDate],
);
```

`sortedBookings` no necesita cambio (sigue usando `selectedDateBookings`).

- [ ] **Step 8: Actualizar el JSX del DashboardCalendar**

```tsx
<DashboardCalendar
  bookings={mainCalendarBookings}   // ← antes era filteredBookings
  selectedDate={selectedDate}
  onDateSelect={setSelectedDate}
  mode={calendarMode}
  onModeChange={handleModeChange}
  onRangeComplete={handleRangeComplete}
  stopSellDates={mainSSdates}        // ← antes era stopSellDates
  onViewMonthChange={handleViewMonthChange}
/>
```

- [ ] **Step 9: Actualizar el ARIRestrictionDrawer del calendar principal**

Cuando `showPerRoom`, pasar `initialRoomTypeId` de Room 1:

```tsx
{showARIDrawer && restrictionRange && (
  <ARIRestrictionDrawer
    open={showARIDrawer}
    onClose={() => setShowARIDrawer(false)}
    tenantId={businessId}
    dateFrom={restrictionRange.from}
    dateTo={restrictionRange.to}
    initialPropertyId={selectedPropertyId || null}
    initialRoomTypeId={showPerRoom ? roomTypes[0]?.room_type_id : undefined}
    properties={properties}
  />
)}
```

- [ ] **Step 10: Agregar heading para Room 1 cuando `showPerRoom`**

Antes del `DashboardCalendar`, si `showPerRoom && roomTypes[0]`:
```tsx
{showPerRoom && roomTypes[0] && (
  <div className="flex items-center gap-3 px-1">
    <span className="h-px flex-1 bg-edge" />
    <span className="text-[11px] font-bold uppercase tracking-widest text-content-3">
      {roomTypes[0].title}
    </span>
    <span className="h-px flex-1 bg-edge" />
  </div>
)}
```

- [ ] **Step 11: Agregar per-room sections y unmapped section al final del JSX**

Justo antes de `{detailReservation && <ReservationDetailModal ...}`:

```tsx
{/* Calendarios por room (2, 3, ..., N) */}
{showPerRoom && roomTypes.slice(1).map(rt => (
  <RoomCalendarSection
    key={rt.room_type_id}
    roomType={rt}
    bookings={filteredBookings.filter(b => b.room_type_id === rt.room_type_id)}
    tenantId={businessId}
    propertyId={selectedPropertyId}
    propertyTitle={properties.find(p => p.channex_property_id === selectedPropertyId)?.title ?? ''}
    properties={properties}
    threads={threads}
    onViewDetail={setDetailReservation}
    onNoThread={setNoConvReservation}
  />
))}

{/* Reservas sin habitación mapeada */}
{showPerRoom && unmappedBookings.length > 0 && (() => {
  const propTitle = properties.find(p => p.channex_property_id === selectedPropertyId)?.title ?? '';
  const unmappedForDate = unmappedBookings.filter(
    r => r.check_in <= selectedDate && r.check_out >= selectedDate
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-3 px-1">
          <span className="h-px flex-1 bg-caution/40" />
          <span className="text-[11px] font-bold uppercase tracking-widest text-caution-text">
            Sin habitacion mapeada
          </span>
          <span className="h-px flex-1 bg-caution/40" />
        </div>
        <p className="text-center text-[11px] text-content-3 px-2">
          Reservas sin habitacion especifica para <strong>{propTitle}</strong>.
          Por favor revisa cada reserva para asignar la habitacion correspondiente.
        </p>
      </div>
      {unmappedForDate.length > 0 ? (
        <div className="flex flex-col gap-3">
          {unmappedForDate.map(r => (
            <ReservationCard
              key={r.id ?? r.channex_booking_id ?? r.reservation_id}
              reservation={r}
              selectedDate={selectedDate}
              threads={threads}
              onViewDetail={setDetailReservation}
              onNoThread={setNoConvReservation}
            />
          ))}
        </div>
      ) : (
        <p className="text-center text-[11px] text-content-3 py-4">
          Sin reservas sin mapear para este dia
        </p>
      )}
    </div>
  );
})()}
```

- [ ] **Step 12: TypeScript check + verificar que no hay imports sin usar**

```
cd "D:\migo\repos\WhatsApp Multi sign up demo" && pnpm --filter @migo-uit/frontend exec tsc --noEmit 2>&1 | head -30
```

Si `DayRatePlanSnapshot` ya no se usa directamente en `NewDashboardView` después del refactor, eliminar su import.

---

## Task 4: Verificación final en navegador

- [ ] **Flujo 1 — Sin propiedad seleccionada:** dashboard igual al actual, sin per-room section
- [ ] **Flujo 2 — Propiedad con 1 room:** dashboard igual al actual
- [ ] **Flujo 3 — Propiedad con 2+ rooms:**
  1. Calendar principal muestra solo bookings del Room 1, con SS de Room 1
  2. Heading "Room 1" aparece antes del calendar principal
  3. Per-room sections aparecen para Room 2, 3, ...
  4. Restricciones del calendar principal abre drawer con Room 1 pre-seleccionado y bloqueado
  5. Restricciones de Room 2 abre drawer con Room 2 pre-seleccionado y bloqueado
  6. Sección unmapped aparece al fondo (si hay bookings sin room_type_id)

---

## Self-Review

| Requerimiento | Tarea |
|---|---|
| `initialRoomTypeId` prop en drawer | Task 1 ✅ |
| Selectors bloqueados cuando pre-filled | Task 1 ✅ |
| `RoomCalendarSection` con snapshot propio | Task 2 ✅ |
| SS dates filtradas por room type | Task 2 ✅ |
| Restriction drawer con room pre-seleccionado | Task 2 ✅ |
| Room types cargados en NewDashboardView | Task 3 ✅ |
| `ariSnapshot` raw (reemplaza `stopSellDates`) | Task 3 ✅ |
| Calendar principal usa Room 1 bookings cuando `showPerRoom` | Task 3 ✅ |
| Room 1 SS dates filtradas | Task 3 ✅ |
| Sección unmapped al fondo | Task 3 ✅ |
| Sin cambios en `DashboardCalendar.tsx` | Confirmado ✅ |
| Sin cambios en `ReservationCard.tsx` | Confirmado ✅ |

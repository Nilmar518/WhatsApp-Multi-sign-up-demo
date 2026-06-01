# Design Spec: Per-Room Calendar in Dashboard

**Fecha:** 2026-06-01
**Status:** Aprobado

---

## Resumen

Cuando el usuario selecciona una propiedad con más de un room type, el dashboard muestra:
1. El calendario principal muestra solo las reservas del Room 1
2. Calendarios adicionales (uno por room) para Room 2, 3, ..., N
3. Una sección final de "reservas sin habitación mapeada" para bookings sin `room_type_id` válido

Cuando hay 1 room o "Todas las propiedades": comportamiento actual sin cambio.

---

## Condición de activación

```typescript
const showPerRoom = !!selectedPropertyId && roomTypes.length > 1;
```

- `selectedPropertyId` vacío → comportamiento actual (todo intacto)
- `roomTypes.length === 0 || 1` → comportamiento actual (todo intacto)
- `roomTypes.length >= 2` → modo per-room

---

## Layout cuando `showPerRoom`

```
[Calendario principal → Room 1]
[Reservas del Room 1 para la fecha seleccionada]

[Calendario Room 2]
[Reservas del Room 2 para la fecha seleccionada]

[Calendario Room 3]
[Reservas del Room 3 para la fecha seleccionada]

━━━ Reservas sin habitación específica para: [Nombre propiedad] ━━━
[Booking cards de reservas sin room_type_id mapeado]
```

---

## Filtrado de bookings por room

```typescript
// Bookings mapeados a un room específico:
const bookingsForRoom = (roomTypeId: string) =>
  filteredBookings.filter(b => b.room_type_id === roomTypeId);

// Bookings sin mapeo válido (unmapped):
const knownRoomIds = new Set(roomTypes.map(rt => rt.room_type_id));
const unmappedBookings = filteredBookings.filter(
  b => !b.room_type_id || !knownRoomIds.has(b.room_type_id)
);
```

---

## Arquitectura de componentes

### Archivos a modificar/crear

| Acción | Archivo | Responsabilidad |
|--------|---------|-----------------|
| MODIFICAR | `NewDashboardView.tsx` | Cargar room types, computar splits, render condicional |
| CREAR | `RoomCalendarSection.tsx` | Calendar + reservas + drawer por room |
| MODIFICAR | `ARIRestrictionDrawer.tsx` | Agregar prop `initialRoomTypeId`, lock selectors cuando pre-filled |

---

## Componente 1: NewDashboardView (modificado)

### Nuevo estado

```typescript
const [roomTypes, setRoomTypes] = useState<StoredRoomType[]>([]);
const [loadingRoomTypes, setLoadingRoomTypes] = useState(false);
const [ariSnapshot, setAriSnapshot] = useState<ARIMonthSnapshot>({});
```

`ariSnapshot` reemplaza `stopSellDates` — se guarda el snapshot raw y se deriva lo que cada sección necesite.

### Nuevo useEffect: cargar room types

```typescript
useEffect(() => {
  if (!selectedPropertyId) {
    setRoomTypes([]);
    return;
  }
  setLoadingRoomTypes(true);
  listRoomTypes(selectedPropertyId)
    .then(data => setRoomTypes(Array.isArray(data) ? data : []))
    .catch(() => setRoomTypes([]))
    .finally(() => setLoadingRoomTypes(false));
}, [selectedPropertyId]);
```

### Cambio en suscripción ARI snapshot

En lugar de computar `stopSellDates` en el useEffect, guardar el snapshot raw:

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

### SS dates por room (useMemo)

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

const allSSdates = useMemo(() => computeSSdates(ariSnapshot, new Set()), [ariSnapshot]);
// Para Room 1 cuando showPerRoom:
const room1SSdates = useMemo(() => {
  if (!showPerRoom || !roomTypes[0]) return allSSdates;
  const ids = new Set(roomTypes[0].rate_plans.map(rp => rp.rate_plan_id));
  return computeSSdates(ariSnapshot, ids);
}, [ariSnapshot, roomTypes, showPerRoom, allSSdates]);
```

### Derivaciones condicionales

```typescript
const showPerRoom = !!selectedPropertyId && roomTypes.length > 1;

// Bookings para el calendar principal
const mainCalendarBookings = useMemo(() =>
  showPerRoom && roomTypes[0]
    ? filteredBookings.filter(b => b.room_type_id === roomTypes[0].room_type_id)
    : filteredBookings,
  [filteredBookings, showPerRoom, roomTypes]);

// stopSellDates que se pasan al DashboardCalendar principal
const mainSSdates = showPerRoom ? room1SSdates : allSSdates;

// unmapped (solo se computa cuando showPerRoom)
const unmappedBookings = useMemo(() => {
  if (!showPerRoom) return [];
  const known = new Set(roomTypes.map(rt => rt.room_type_id));
  return filteredBookings.filter(b => !b.room_type_id || !known.has(b.room_type_id));
}, [filteredBookings, roomTypes, showPerRoom]);
```

### selectedDateBookings y sortedBookings

En modo per-room, el calendar principal ya tiene sus propias reservas filtradas. Las derivadas `selectedDateBookings` y `sortedBookings` siguen usando `mainCalendarBookings` (no `filteredBookings`).

### Cambios al render

El `<DashboardCalendar>` recibe `mainCalendarBookings` en vez de `filteredBookings`.
Cuando `showPerRoom`, el drawer de restricciones recibe además `initialRoomTypeId={roomTypes[0]?.room_type_id}`.

Después del bloque de reservation cards del calendar principal:

```tsx
{/* Per-room calendars */}
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

{/* Unmapped section */}
{showPerRoom && unmappedBookings.length > 0 && (
  <UnmappedBookingsSection
    bookings={unmappedBookings}
    propertyTitle={...}
    selectedDate={selectedDate}
    threads={threads}
    onViewDetail={setDetailReservation}
    onNoThread={setNoConvReservation}
  />
)}
```

---

## Componente 2: RoomCalendarSection (nuevo)

**Archivo:** `src/components/dashboard/RoomCalendarSection.tsx`

### Props

```typescript
interface RoomCalendarSectionProps {
  roomType: StoredRoomType;
  bookings: Reservation[];            // pre-filtradas para este room
  tenantId: string;
  propertyId: string;
  propertyTitle: string;
  properties: ChannexProperty[];
  threads: ChannexThread[];
  onViewDetail: (r: Reservation) => void;
  onNoThread: (r: Reservation) => void;
}
```

### Estado interno

```typescript
const [selectedDate, setSelectedDate] = useState(isoToday);
const [calendarMode, setCalendarMode] = useState<'view' | 'edit'>('view');
const [restrictionRange, setRestrictionRange] = useState<{ from: string; to: string } | null>(null);
const [showARIDrawer, setShowARIDrawer] = useState(false);
const [monthKey, setMonthKey] = useState(() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
});
const [snapshot, setSnapshot] = useState<ARIMonthSnapshot>({});
```

### SS dates por room

```typescript
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
```

### Suscripción snapshot

```typescript
useEffect(() => {
  const ref = doc(db, 'channex_integrations', tenantId, 'properties',
    propertyId, 'ari_snapshots', monthKey);
  const unsub = onSnapshot(ref, snap => {
    setSnapshot(snap.exists() ? (snap.data() as ARIMonthSnapshot) : {});
  }, () => setSnapshot({}));
  return () => unsub();
}, [tenantId, propertyId, monthKey]);
```

### Reservation cards

```typescript
const selectedDateBookings = useMemo(() =>
  bookings.filter(r => r.check_in <= selectedDate && r.check_out >= selectedDate),
  [bookings, selectedDate]);

const sortedBookings = useMemo(() =>
  [...selectedDateBookings].sort((a, b) =>
    STATUS_ORDER[getCardStatus(a, selectedDate)] - STATUS_ORDER[getCardStatus(b, selectedDate)]),
  [selectedDateBookings, selectedDate]);
```

### Layout

```
┌──────────────────────────────────────────────┐
│  Room: [roomType.title]                      │  ← header con nombre del room
└──────────────────────────────────────────────┘
[DashboardCalendar con bookings de este room + ssDateSet]
[Reservation cards para selectedDate]
[ARIRestrictionDrawer con initialPropertyId + initialRoomTypeId pre-set]
```

El header del section:
```tsx
<div className="flex items-center gap-2 px-1">
  <span className="h-px flex-1 bg-edge" />
  <span className="text-[12px] font-bold uppercase tracking-widest text-content-3">
    {roomType.title}
  </span>
  <span className="h-px flex-1 bg-edge" />
</div>
```

---

## Componente 3: Sección unmapped (inline o componente pequeño)

Puede ser inline en `NewDashboardView` o un pequeño sub-componente. No necesita calendar propio, solo lista de cards.

### Header

```tsx
<div className="flex flex-col gap-1">
  <div className="flex items-center gap-2">
    <span className="h-px flex-1 bg-edge" />
    <span className="text-[11px] font-bold uppercase tracking-widest text-caution-text">
      Sin habitación mapeada
    </span>
    <span className="h-px flex-1 bg-edge" />
  </div>
  <p className="text-center text-[11px] text-content-3">
    Reservas sin habitación específica para <strong>{propertyTitle}</strong>.
    Por favor revisá cada reserva para asignar la habitación correspondiente.
  </p>
</div>
```

Luego lista las `unmappedBookings` con el mismo `ReservationCard` pero sin filtrar por fecha (o filtrado por `selectedDate` del calendario principal).

**Decisión de filtrado:** mostrar las unmapped del `selectedDate` del calendar principal (para consistencia), NO todas.

---

## Componente 4: ARIRestrictionDrawer (modificado)

### Nueva prop

```typescript
initialRoomTypeId?: string;
```

### Comportamiento

Cuando `initialRoomTypeId` está definido:
1. Después de cargar los room types (`listRoomTypes`), auto-selecciona `initialRoomTypeId` y el primer rate plan de ese room
2. El selector de room type se muestra deshabilitado con el valor pre-llenado
3. El selector de property también se deshabilita cuando `initialPropertyId` está definido (ya existente)

Cambio en el `useEffect` de carga de rooms:

```typescript
useEffect(() => {
  ...
  listRoomTypes(drawerPropertyId).then(data => {
    const safe = Array.isArray(data) ? data : [];
    setRoomTypes(safe);
    // Pre-seleccionar initialRoomTypeId si está definido
    const targetRoomId = initialRoomTypeId ?? safe.find(rt => rt.rate_plans.length > 0)?.room_type_id;
    const targetRoom = safe.find(rt => rt.room_type_id === targetRoomId);
    if (targetRoom) {
      setSelectedRoomTypeId(targetRoom.room_type_id);
      setSelectedRatePlanId(targetRoom.rate_plans[0]?.rate_plan_id ?? '');
    }
  });
  ...
}, [drawerPropertyId, initialRoomTypeId]);
```

El selector de room type cuando `initialRoomTypeId` está definido:
```tsx
<select disabled={!!initialRoomTypeId} ...>
```

El selector de property cuando `initialPropertyId` está definido (ya es editable, solo cambiar el `disabled`):
```tsx
<select disabled={!!initialPropertyId} ...>
```

---

## Import de listRoomTypes en NewDashboardView

```typescript
import { listRoomTypes, type StoredRoomType, type ARIMonthSnapshot } from '../../channex/api/channexHubApi';
```

---

## Fuera de scope

- Sincronizar meses entre calendarios (cada uno navega independientemente)
- Mostrar availability numérica en las celdas del DashboardCalendar
- Reordenar rooms (se muestran en el orden devuelto por `listRoomTypes`)
- Editar/asignar room type a bookings unmapped desde el dashboard

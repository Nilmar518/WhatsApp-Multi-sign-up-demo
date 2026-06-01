# Design Spec: Dashboard Calendar — Modo Restricciones + ARI Drawer

**Fecha:** 2026-05-31  
**Estado:** Aprobado

---

## Resumen

El `DashboardCalendar` del dashboard principal (`/`) es actualmente informativo (solo muestra dots de reservas). Esta feature agrega un **modo restricciones** con toggle en el header del calendario que, al activarse, permite seleccionar un rango de fechas y abre un drawer lateral con el panel ARI completo (disponibilidad, tarifa, min/max stay, stop sell, CTA, CTD) con batch queue.

---

## Arquitectura

**Sin tocar `ARICalendar.tsx`.** El drawer es un componente nuevo aislado.

| Acción | Archivo |
|--------|---------|
| MODIFICAR | `apps/frontend/src/components/dashboard/DashboardCalendar.tsx` |
| CREAR | `apps/frontend/src/components/dashboard/ARIRestrictionDrawer.tsx` |
| MODIFICAR | `apps/frontend/src/components/dashboard/NewDashboardView.tsx` |

**Sin cambios de backend.** Usa `pushAvailabilityBatch` y `pushRestrictionsBatch` de `channexHubApi.ts`.

---

## Flujo de estado (NewDashboardView)

```typescript
// Estado nuevo a agregar
const [calendarMode, setCalendarMode] = useState<'view' | 'edit'>('view');
const [restrictionRange, setRestrictionRange] = useState<{ from: string; to: string } | null>(null);
const [showARIDrawer, setShowARIDrawer] = useState(false);

// Handlers
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

---

## Componente 1: DashboardCalendar (modificado)

### Props nuevas
```typescript
interface DashboardCalendarProps {
  bookings: Reservation[];
  selectedDate: string;
  onDateSelect: (date: string) => void;
  // nuevas:
  mode?: 'view' | 'edit';
  onModeChange?: (mode: 'view' | 'edit') => void;
  onRangeComplete?: (from: string, to: string) => void;
}
```

### Toggle de modo (header del calendario)

```
◀   Mayo 2026   ▶          [ 👁 Ver  |  ✏️ Restricciones ]
```

- Pill toggle a la derecha del título del mes
- En **modo view** (default): comportamiento actual intacto. Clic en día → `onDateSelect`.
- En **modo edit**: header cambia a `bg-caution-bg/40` border `border-caution/50` para indicar estado activo. Los clics ya no llaman a `onDateSelect`.

### Selección de rango (estado local del componente)

```typescript
const [rangeStart, setRangeStart] = useState<string | null>(null);
```

- Primer clic en modo edit → `rangeStart = fecha`, celda resaltada con borde brand
- Segundo clic en fecha ≥ rangeStart → `onRangeComplete(rangeStart, fecha)` + limpia `rangeStart`
- Segundo clic en fecha < rangeStart → nuevo `rangeStart = fecha` (reset)
- Clic en la misma celda → `onRangeComplete(fecha, fecha)` (rango de un día)

Los dots de reservas permanecen visibles en modo edit (dan contexto).

---

## Componente 2: ARIRestrictionDrawer (nuevo)

### Props
```typescript
interface ARIRestrictionDrawerProps {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  dateFrom: string;
  dateTo: string;
  initialPropertyId: string | null;  // '' o null = "Todas las propiedades"
  properties: ChannexProperty[];
}
```

### Layout

```
┌──────────────────────────────────────────┐
│  ✏️ Restricciones   📅 1 Jun → 7 Jun  ✕  │  ← header fijo
├──────────────────────────────────────────┤
│  Propiedad  [ Casa del Sol ▼ ]           │  ← vacío si initialPropertyId=null
│  Habitación [ Twin Room ▼ ]              │  ← deshabilitado sin propiedad
│  Tarifa     [ Best Available Rate ▼ ]    │
├──────────────────────────────────────────┤
│  Disponibilidad [___]   Tarifa [___]     │
│  Min Stay [___]         Max Stay [___]   │
│                                          │
│  [ ] Bloqueo de ventas (Stop Sell)       │
│      Activá si no tenés más habitaciones │
│  [ ] Sin llegadas (CTA)                  │
│      Activá si no podés recibir huéspedes│
│  [ ] Sin salidas (CTD)                   │
│      Activá si no podés procesar salidas │
├──────────────────────────────────────────┤
│        [+ Agregar al batch]              │
├──────────────────────────────────────────┤
│  Cola de cambios (2)                     │
│  Casa del Sol / Twin / BAR               │
│  1 Jun → 7 Jun · Rate: 200             ✕ │
│  Casa del Sol / Twin / BAR               │
│  10 Jun → 12 Jun · SS activo           ✕ │
├──────────────────────────────────────────┤
│        [  Guardar (2)  ]                 │
│  ✓ Task IDs: abc123, def456             │  ← banner verde post-save
└──────────────────────────────────────────┘
```

### Posición y dimensiones
- `fixed inset-y-0 right-0` 
- Mobile: `w-full`
- sm+: `max-w-sm` (384px)
- Overlay: `fixed inset-0 bg-black/40` detrás del drawer
- Scroll interno: el drawer tiene `overflow-y-auto` para contenido largo

### Selector de propiedad
- Si `initialPropertyId` tiene valor → pre-populated, editable por el usuario
- Si `initialPropertyId` es `''` o `null` → placeholder "Seleccioná una propiedad", room type y rate plan deshabilitados hasta que se elija
- Cambio de propiedad → `listRoomTypes(propertyId)` → auto-selecciona primer room type + primer rate plan

### Estado interno
```typescript
const [drawerPropertyId, setDrawerPropertyId] = useState(initialPropertyId ?? '');
const [roomTypes, setRoomTypes] = useState<StoredRoomType[]>([]);
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

### BatchEntry
```typescript
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
```

### Comportamiento de batch
- "Agregar al batch" captura el rango actual (`dateFrom`/`dateTo` de las props), la propiedad y todos los campos con valor
- Limpia los campos del formulario (no cierra el drawer, no cambia `drawerPropertyId`)
- El usuario puede re-seleccionar un rango en el calendario, el drawer mantiene la queue
- Batch queue se pierde si el drawer se cierra (unmount — aceptable)

### Save
```typescript
// pseudocódigo
const availUpdates = batchQueue
  .filter(e => e.availability !== undefined)
  .map(e => ({ room_type_id: e.roomTypeId, date_from: e.dateFrom, date_to: e.dateTo, availability: e.availability! }));

const restrictUpdates = batchQueue
  .filter(e => e.ratePlanId && (e.rate || e.minStay || e.maxStay || e.stopSell || e.closedToArrival || e.closedToDeparture))
  .map(e => ({
    rate_plan_id: e.ratePlanId,
    date_from: e.dateFrom,
    date_to: e.dateTo,
    ...(e.rate ? { rate: e.rate } : {}),
    ...(e.minStay ? { min_stay_arrival: e.minStay } : {}),
    ...(e.maxStay ? { max_stay: e.maxStay } : {}),
    ...(e.stopSell ? { stop_sell: true } : {}),
    ...(e.closedToArrival ? { closed_to_arrival: true } : {}),
    ...(e.closedToDeparture ? { closed_to_departure: true } : {}),
  }));
```
Post-save exitoso: limpia queue, muestra task IDs en banner verde.

---

## Componente 3: NewDashboardView (modificado)

Pasa las props nuevas a `DashboardCalendar` y monta `ARIRestrictionDrawer` condicionalmente.

```tsx
<DashboardCalendar
  bookings={filteredBookings}
  selectedDate={selectedDate}
  onDateSelect={setSelectedDate}
  mode={calendarMode}
  onModeChange={handleModeChange}
  onRangeComplete={handleRangeComplete}
/>

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

---

## Fuera de scope

- Full Sync modal (solo disponible en ARICalendar dentro de Properties)
- Manual booking desde el drawer
- Actualización del snapshot ARI en el DashboardCalendar (los dots siguen siendo solo de reservas)
- Deep-link / navegación cruzada con PropertyDetail

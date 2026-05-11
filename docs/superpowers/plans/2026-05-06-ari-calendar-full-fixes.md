# ARICalendarFull — Fixes Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corregir 4 bugs/gaps en `ARICalendarFull.tsx` para que el panel ARI del tab Properties sea completamente funcional para la sesión de certificación Channex.

**Architecture:** Un único componente (`ARICalendarFull.tsx`) recibe todas las correcciones. Ningún archivo de backend ni de API client requiere cambios — los tipos ya son correctos en `channexHubApi.ts`. Los cambios son aditivos (se agrega estado y UI) salvo el fix de estructura de datos que corrige lógica existente.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, `channexHubApi.ts` (fetch wrapper hacia el backend NestJS)

---

## Contexto de los bugs

El Firestore cambió la estructura de `room_types` de **plana** (una entrada por combo room-type+rate-plan) a **anidada** (`rate_plans: StoredRatePlan[]` dentro de cada room type). Esto rompió los selectores. Adicionalmente hay tres gaps funcionales.

**Estructura actual en Firestore (nueva):**
```
room_types: [
  {
    room_type_id: "uuid-twin",
    title: "Twin Room",
    rate_plans: [
      { rate_plan_id: "uuid-bar", title: "Best Available Rate", rate: 100, currency: "USD", occupancy: 2, is_primary: true },
      { rate_plan_id: "uuid-bb",  title: "Bed and Breakfast",   rate: 120, currency: "USD", occupancy: 2, is_primary: true }
    ],
    ...
  },
  {
    room_type_id: "uuid-double",
    title: "Double Room",
    rate_plans: [ ... ]
  }
]
```

**Tipos en `channexHubApi.ts` (ya correctos, no modificar):**
```typescript
interface StoredRatePlan {
  rate_plan_id: string;
  title: string;
  currency: string;
  rate: number;
  occupancy: number;
  is_primary?: boolean;
}

interface StoredRoomType {
  room_type_id: string;
  title: string;
  default_occupancy: number;
  occ_adults: number;
  occ_children: number;
  occ_infants: number;
  count_of_rooms: number;
  source?: string;
  rate_plans: StoredRatePlan[];
}
```

---

## Mapa de archivos

| Archivo | Acción | Cambio |
|---------|--------|--------|
| `apps/frontend/src/channex/components/ARICalendarFull.tsx` | Modificar | 4 fixes descritos abajo |
| `docs/channex/08-plan-de-pruebas-certificacion.md` | Ya creado | Plan de pruebas en español |

---

## Task 1: Fix — Selectores de Room Type y Rate Plan (estructura anidada)

**Archivo:** `apps/frontend/src/channex/components/ARICalendarFull.tsx`

**Problema:** Tres puntos usan `rt.rate_plan_id` (campo de la estructura plana antigua) en vez de `rt.rate_plans[n].rate_plan_id`.

- [ ] **Step 1: Corregir el auto-select al cargar room types (línea ~90)**

Reemplazar el bloque `useEffect` de carga de room types:

```typescript
// ANTES (líneas ~85-98):
useEffect(() => {
  setLoadingRooms(true);
  listRoomTypes(propertyId)
    .then((data) => {
      setRoomTypes(data);
      const firstWithRate = data.find((rt) => rt.rate_plan_id);
      if (firstWithRate) {
        setSelectedRoomTypeId(firstWithRate.room_type_id);
        setSelectedRatePlanId(firstWithRate.rate_plan_id ?? '');
      }
    })
    .catch(() => {})
    .finally(() => setLoadingRooms(false));
}, [propertyId]);

// DESPUÉS:
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
```

- [ ] **Step 2: Corregir `ratePlansForRoom` (línea ~153)**

```typescript
// ANTES:
const ratePlansForRoom = useMemo(
  () => roomTypes.filter((rt) => rt.room_type_id === selectedRoomTypeId && rt.rate_plan_id),
  [roomTypes, selectedRoomTypeId],
);

// DESPUÉS — devuelve StoredRatePlan[] del room type seleccionado:
const ratePlansForRoom = useMemo(
  () => roomTypes.find((rt) => rt.room_type_id === selectedRoomTypeId)?.rate_plans ?? [],
  [roomTypes, selectedRoomTypeId],
);
```

- [ ] **Step 3: Agregar `allRatePlans` para el preview del batch queue**

Justo después del `useMemo` de `uniqueRooms`, agregar:

```typescript
// Para buscar el título de un rate plan en el preview del batch
// (ratePlansForRoom solo tiene los del room type seleccionado actualmente)
const allRatePlans = useMemo(
  () => roomTypes.flatMap((rt) => rt.rate_plans),
  [roomTypes],
);
```

- [ ] **Step 4: Corregir el onChange del selector de Room Type (línea ~358)**

```typescript
// ANTES:
onChange={(e) => {
  setSelectedRoomTypeId(e.target.value);
  const firstRate = roomTypes.find((rt) => rt.room_type_id === e.target.value && rt.rate_plan_id);
  setSelectedRatePlanId(firstRate?.rate_plan_id ?? '');
}}

// DESPUÉS:
onChange={(e) => {
  setSelectedRoomTypeId(e.target.value);
  const room = roomTypes.find((rt) => rt.room_type_id === e.target.value);
  setSelectedRatePlanId(room?.rate_plans[0]?.rate_plan_id ?? '');
}}
```

- [ ] **Step 5: Corregir el selector de Rate Plan para iterar `StoredRatePlan[]` (línea ~375)**

```typescript
// ANTES:
{ratePlansForRoom.map((rt) => (
  <option key={rt.rate_plan_id!} value={rt.rate_plan_id!}>{rt.title}</option>
))}

// DESPUÉS (ratePlansForRoom ahora es StoredRatePlan[]):
{ratePlansForRoom.map((rp) => (
  <option key={rp.rate_plan_id} value={rp.rate_plan_id}>{rp.title}</option>
))}
```

- [ ] **Step 6: Corregir el preview del batch queue para usar `allRatePlans` (línea ~464)**

```typescript
// ANTES:
<span>
  {uniqueRooms.find((r) => r.room_type_id === entry.roomTypeId)?.title}
  {' / '}
  {ratePlansForRoom.find((r) => r.rate_plan_id === entry.ratePlanId)?.title ?? '—'}
</span>

// DESPUÉS:
<span>
  {uniqueRooms.find((r) => r.room_type_id === entry.roomTypeId)?.title}
  {' / '}
  {allRatePlans.find((rp) => rp.rate_plan_id === entry.ratePlanId)?.title ?? '—'}
</span>
```

- [ ] **Step 7: Verificar en el navegador**

1. Abrir ChannexHub → Properties → seleccionar la property de certificación → tab ARI Calendar
2. Confirmar que el dropdown de Room Type muestra "Twin Room" y "Double Room"
3. Al cambiar Room Type, confirmar que Rate Plan se actualiza con los planes del room seleccionado
4. Seleccionar un rango de fechas, elegir Twin Room / Best Available Rate / Rate: 333 → Add to Batch
5. Confirmar que el batch preview muestra "Twin Room / Best Available Rate"

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/channex/components/ARICalendarFull.tsx
git commit -m "fix(ari-calendar): adapt room type / rate plan selectors to nested rate_plans structure"
```

---

## Task 2: Fix — Batch persiste entre selecciones de fechas + fechas por entry

**Archivo:** `apps/frontend/src/channex/components/ARICalendarFull.tsx`

**Problema:** Cada entry en el batch usaba la misma `selectedRange` al momento del Save. Al seleccionar fechas nuevas se borraba el batch. Los tests #4, #5, #6, #7, #8, #9, #10 requieren entries con distintos rangos de fechas en un solo Save.

**Solución:** 
1. `BatchEntry` lleva sus propias `dateFrom`/`dateTo`
2. `handleAddToBatch` captura el rango actual en el entry
3. `handleCellClick` NO borra el batch al empezar una nueva selección
4. `handleSaveBatch` usa las fechas de cada entry (no `selectedRange`)

- [ ] **Step 1: Agregar `dateFrom` y `dateTo` a `BatchEntry`**

```typescript
// ANTES:
interface BatchEntry {
  id: number;
  roomTypeId: string;
  ratePlanId: string;
  availability?: number;
  rate?: string;
  minStay?: number;
  stopSell?: boolean;
  closedToArrival?: boolean;
  closedToDeparture?: boolean;
}

// DESPUÉS:
interface BatchEntry {
  id: number;
  dateFrom: string;      // rango propio del entry
  dateTo: string;
  roomTypeId: string;
  ratePlanId: string;
  availability?: number;
  rate?: string;
  minStay?: number;
  maxStay?: number;      // ver Task 3
  stopSell?: boolean;
  closedToArrival?: boolean;
  closedToDeparture?: boolean;
}
```

- [ ] **Step 2: Actualizar `handleAddToBatch` para capturar el rango actual**

```typescript
// ANTES:
function handleAddToBatch() {
  if (!selectedRoomTypeId) return;
  setBatchQueue((prev) => [
    ...prev,
    {
      id: batchCounter++,
      roomTypeId: selectedRoomTypeId,
      ratePlanId: selectedRatePlanId,
      ...(availability !== '' ? { availability: Number(availability) } : {}),
      ...(rate !== '' ? { rate: String(rate) } : {}),
      ...(minStay !== '' ? { minStay: Number(minStay) } : {}),
      ...(stopSell ? { stopSell } : {}),
      ...(closedToArrival ? { closedToArrival } : {}),
      ...(closedToDeparture ? { closedToDeparture } : {}),
    },
  ]);
  setAvailability('');
  setRate('');
  setMinStay('');
  setStopSell(false);
  setClosedToArrival(false);
  setClosedToDeparture(false);
}

// DESPUÉS:
function handleAddToBatch() {
  if (!selectedRoomTypeId || !selectedRange) return;
  setBatchQueue((prev) => [
    ...prev,
    {
      id: batchCounter++,
      dateFrom: selectedRange[0],
      dateTo: selectedRange[1],
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
  // Resetear solo los campos del formulario, no el batch ni la selección
  setAvailability('');
  setRate('');
  setMinStay('');
  setMaxStay('');
  setStopSell(false);
  setClosedToArrival(false);
  setClosedToDeparture(false);
}
```

- [ ] **Step 3: Actualizar `handleCellClick` para no borrar el batch**

```typescript
// ANTES:
const handleCellClick = useCallback(
  (ds: string) => {
    if (!selectionStart || selectionEnd) {
      setSelectionStart(ds);
      setSelectionEnd(null);
      setShowPanel(false);
      setSaveError(null);
      setLastTaskIds([]);
      setBatchQueue([]);   // ← ESTO borraba el batch
      return;
    }
    const end = ds >= selectionStart ? ds : selectionStart;
    const start = ds < selectionStart ? ds : selectionStart;
    setSelectionStart(start);
    setSelectionEnd(end);
    setShowPanel(true);
    setSaveError(null);
  },
  [selectionEnd, selectionStart],
);

// DESPUÉS:
const handleCellClick = useCallback(
  (ds: string) => {
    if (!selectionStart || selectionEnd) {
      setSelectionStart(ds);
      setSelectionEnd(null);
      setSaveError(null);
      setLastTaskIds([]);
      // No borramos el batchQueue — el usuario puede acumular entries
      // con distintos rangos de fechas
      // Solo cerramos el panel si no hay batch pendiente
      if (batchQueue.length === 0) {
        setShowPanel(false);
      }
      return;
    }
    const end = ds >= selectionStart ? ds : selectionStart;
    const start = ds < selectionStart ? ds : selectionStart;
    setSelectionStart(start);
    setSelectionEnd(end);
    setShowPanel(true);
    setSaveError(null);
  },
  [selectionEnd, selectionStart, batchQueue.length],
);
```

- [ ] **Step 4: Actualizar `handleSaveBatch` para usar las fechas de cada entry**

```typescript
// ANTES:
async function handleSaveBatch() {
  if (!selectedRange || batchQueue.length === 0) return;
  const [dateFrom, dateTo] = selectedRange;   // ← fecha única para todos
  setSaving(true);
  setSaveError(null);
  const taskIds: string[] = [];

  try {
    const availUpdates = batchQueue
      .filter((e) => e.availability !== undefined)
      .map((e) => ({ room_type_id: e.roomTypeId, date_from: dateFrom, date_to: dateTo, availability: e.availability! }));

    if (availUpdates.length > 0) {
      const res = await pushAvailabilityBatch(propertyId, availUpdates);
      taskIds.push(res.taskId);
    }

    const restrictUpdates = batchQueue
      .filter((e) => e.ratePlanId && (e.rate !== undefined || e.minStay !== undefined || e.stopSell || e.closedToArrival || e.closedToDeparture))
      .map((e) => ({
        rate_plan_id: e.ratePlanId,
        date_from: dateFrom,
        date_to: dateTo,
        ...(e.rate !== undefined ? { rate: e.rate } : {}),
        ...(e.minStay !== undefined ? { min_stay_arrival: e.minStay } : {}),
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

// DESPUÉS — cada entry usa su propio dateFrom/dateTo:
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
      const res = await pushAvailabilityBatch(propertyId, availUpdates);
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
```

- [ ] **Step 5: Actualizar el preview del batch queue para mostrar el rango de fechas de cada entry**

El batch preview actualmente solo muestra el room type y rate plan. Con fechas por entry, conviene mostrarlo:

```typescript
// ANTES (línea ~460-469):
{batchQueue.map((entry) => (
  <div key={entry.id} className="flex items-center justify-between text-xs text-slate-700 py-0.5">
    <span>
      {uniqueRooms.find((r) => r.room_type_id === entry.roomTypeId)?.title}
      {' / '}
      {ratePlansForRoom.find((r) => r.rate_plan_id === entry.ratePlanId)?.title ?? '—'}
    </span>
    <button type="button" onClick={() => setBatchQueue((q) => q.filter((e) => e.id !== entry.id))} className="text-red-400 hover:text-red-600">✕</button>
  </div>
))}

// DESPUÉS:
{batchQueue.map((entry) => (
  <div key={entry.id} className="flex items-center justify-between text-xs text-slate-700 py-0.5 gap-2">
    <div className="min-w-0">
      <p className="truncate font-medium">
        {uniqueRooms.find((r) => r.room_type_id === entry.roomTypeId)?.title}
        {' / '}
        {allRatePlans.find((rp) => rp.rate_plan_id === entry.ratePlanId)?.title ?? '—'}
      </p>
      <p className="text-slate-400">{entry.dateFrom} → {entry.dateTo}</p>
    </div>
    <button
      type="button"
      onClick={() => setBatchQueue((q) => q.filter((e) => e.id !== entry.id))}
      className="shrink-0 text-red-400 hover:text-red-600"
    >
      ✕
    </button>
  </div>
))}
```

- [ ] **Step 6: Verificar flujo de batch multi-fecha en el navegador**

Flujo de prueba (simular Test #4):
1. Clic Nov 1 → clic Nov 10 → panel se abre con rango Nov 01–10
2. Seleccionar Twin Room / Best Available Rate / Rate: 241 → "Add to Batch"
3. El batch preview muestra el entry con su rango Nov 01–10
4. Clic Nov 10 → clic Nov 16 → panel actualiza rango a Nov 10–16 (batch NO se borra)
5. Seleccionar Double Room / Best Available Rate / Rate: 312.66 → "Add to Batch"
6. Clic Nov 1 → clic Nov 20 → panel actualiza a Nov 01–20 (batch tiene 2 entries)
7. Double Room / B&B / Rate: 111 → "Add to Batch"
8. "Save (3)" → verificar task ID en banner verde

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/channex/components/ARICalendarFull.tsx
git commit -m "fix(ari-calendar): persist batch across date selections, each entry carries own date range"
```

---

## Task 3: Fix — Agregar campo Max Stay al panel

**Archivo:** `apps/frontend/src/channex/components/ARICalendarFull.tsx`

**Problema:** El campo `max_stay` existe en el backend y en los tipos (`ARIRestrictionUpdate.max_stay?: number | null`) pero no hay estado ni UI para él en el panel.

- [ ] **Step 1: Agregar estado `maxStay`**

Junto a los demás estados del panel ARI (cerca de línea ~66), agregar:

```typescript
const [maxStay, setMaxStay] = useState<number | ''>('');
```

- [ ] **Step 2: Agregar campo UI de Max Stay en el panel (después de Min Stay)**

En el JSX del panel, después del bloque de Min Stay y antes del bloque de "Restrictions" (checkboxes), insertar:

```tsx
{/* Max Stay */}
<div>
  <label className="mb-1 block text-xs font-semibold text-slate-600">
    Max Stay (noches) — dejar vacío para omitir
  </label>
  <input
    type="number"
    min={0}
    value={maxStay}
    onChange={(e) => setMaxStay(e.target.value === '' ? '' : Number(e.target.value))}
    placeholder="ej. 7"
    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
  />
</div>
```

- [ ] **Step 3: Resetear `maxStay` en `handleAddToBatch`**

Ya incluido en Task 2 Step 2 (`setMaxStay('')`). Confirmar que está presente.

- [ ] **Step 4: Verificar en el navegador**

1. Abrir el panel ARI → confirmar que aparece el campo "Max Stay" entre Min Stay y las restriction checkboxes
2. Seleccionar un rango, ingresar Max Stay: 4, hacer Add to Batch
3. Hacer Save → verificar en logs del backend que `max_stay: 4` llega en el payload

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/channex/components/ARICalendarFull.tsx
git commit -m "feat(ari-calendar): add Max Stay field to ARI control panel"
```

---

## Task 4: Fix — Botón Full Sync sin label hardcodeado

**Archivo:** `apps/frontend/src/channex/components/ARICalendarFull.tsx`

**Problema:** El botón dice "Full Sync (500 days)" de forma estática, pero el modal permite configurar los días. La etiqueta debe reflejar el valor actual de `syncDays`.

- [ ] **Step 1: Actualizar el label del botón Full Sync**

```typescript
// ANTES (línea ~270):
<button
  type="button"
  onClick={() => { setShowSyncModal(true); setSyncResult(null); setSyncError(null); }}
  className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
>
  Full Sync (500 days)
</button>

// DESPUÉS:
<button
  type="button"
  onClick={() => { setShowSyncModal(true); setSyncResult(null); setSyncError(null); }}
  className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
>
  Full Sync ({syncDays} días)
</button>
```

- [ ] **Step 2: Verificar en el navegador**

1. El botón muestra "Full Sync (500 días)" por defecto
2. Abrir el modal, cambiar Days a 365, cerrar → el botón ahora muestra "Full Sync (365 días)"
3. Confirmar que al reabrir el modal los valores persisten

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/channex/components/ARICalendarFull.tsx
git commit -m "fix(ari-calendar): full sync button label reflects configured days dynamically"
```

---

## Task 5: Documento de gaps futuros — Airbnb/Booking.com integrations

**Archivo a crear:** `docs/channex/09-gaps-integraciones-ari.md`

Este documento queda como referencia para cuando se quiera agregar el panel ARI completo a las vistas de Airbnb y Booking.com.

- [ ] **Step 1: Crear el documento de gaps**

```bash
# Crear el archivo con el contenido siguiente
```

Contenido completo del archivo:

```markdown
# Gaps ARI — Integraciones Airbnb y Booking.com

> Estado: pendiente. El panel ARI completo (`ARICalendarFull`) está funcional
> en el tab Properties del ChannexHub. Este doc registra lo que falta para
> replicarlo a las vistas de integración de cada OTA.
> Fecha de registro: 2026-05-06

---

## Situación actual

| Superficie | Componente | Estado ARI |
|-----------|------------|-----------|
| ChannexHub → Properties → ARI Calendar | `ARICalendarFull.tsx` | ✅ Completo |
| ChannexHub → Airbnb → inventory | `ARICalendar.tsx` (viejo) | ❌ Solo disponibilidad binaria |
| ChannexHub → Booking.com → (sin vista ARI) | — | ❌ No existe |

---

## Gap A — `ARICalendar.tsx` (Airbnb integration)

Archivo: `apps/frontend/src/airbnb/components/ARICalendar.tsx`  
Usado por: `apps/frontend/src/integrations/airbnb/components/InventoryView.tsx`

Capacidades faltantes vs `ARICalendarFull`:
- Sin selector de Room Type (hardcodeado a `activeProperty.channex_room_type_id`)
- Sin selector de Rate Plan (hardcodeado a `activeProperty.channex_rate_plan_id`)
- Disponibilidad solo binaria `0 | 1` (estado `selectedAvailability: 0 | 1`)
- Sin campos de restrictions (rate, min stay, max stay, stop sell, CTA, CTD)
- Sin batch UI (Add to Batch / Save N)
- Sin Full Sync modal
- Sin display de task IDs

**Enfoque recomendado cuando se implemente:**
Reemplazar `ARICalendar.tsx` en `InventoryView.tsx` por `ARICalendarFull.tsx`.
El componente ya acepta `propertyId` y `currency` que `InventoryView` puede proveer
desde `activeProperty.channex_property_id` y `activeProperty.currency`.

Ajuste necesario: `ARICalendarFull` necesita recibir la propiedad de `integrationDocId`
si se quiere mostrar reservas en overlay (actualmente `ARICalendar` lee reservas de
Firestore). Esto es opcional — se puede omitir el overlay de reservas en una primera
integración.

---

## Gap B — Booking.com (sin vista ARI)

No existe ningún componente ARI para la integración de Booking.com.

**Enfoque recomendado cuando se implemente:**
Crear `apps/frontend/src/integrations/booking/components/BookingARIView.tsx` que
envuelva `ARICalendarFull` con el `channex_property_id` del documento de Booking.com
en Firestore. El backend ya soporta multi-canal — no requiere cambios.
```

- [ ] **Step 2: Commit**

```bash
git add docs/channex/09-gaps-integraciones-ari.md
git commit -m "docs(channex): register ARI gaps for Airbnb and Booking.com integration views"
```

---

## Self-Review

**Cobertura de spec:**

| Requerimiento | Tarea |
|--------------|-------|
| Fix selectores (estructura anidada) | Task 1 ✅ |
| Batch persiste entre selecciones de fechas | Task 2 ✅ |
| Cada entry lleva sus propias fechas | Task 2 ✅ |
| Campo Max Stay en el panel | Task 3 ✅ |
| Full Sync label dinámico | Task 4 ✅ |
| Documento gaps futuros | Task 5 ✅ |
| Plan de pruebas en español | `docs/channex/08-plan-de-pruebas-certificacion.md` ✅ |

**Consistencia de tipos:**
- `BatchEntry.maxStay?: number` — agregado en Task 2 Step 1, usado en Task 2 Step 2, Task 3 Step 1 y Task 3 Step 2
- `allRatePlans` — definido en Task 1 Step 3, usado en Task 1 Step 6 y Task 2 Step 5
- `handleSaveBatch` — no requiere `selectedRange` después del Task 2 (guard removido a `batchQueue.length === 0`)

**Placeholders:** ninguno. Todos los steps tienen código concreto.

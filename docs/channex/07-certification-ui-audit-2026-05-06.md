# Channex Certification — UI Audit
**Fecha:** 2026-05-06  
**Rama:** `nilmar/518-57-feature-airbnb-integration-via-channexio-onboarding-oauth`  
**Scope:** Verificación del estado actual del código vs. los 11 test cases de certificación.  
**Enfoque:** Sesión en vivo — el evaluador observa la UI; los scripts quedan excluidos.

---

## Resumen ejecutivo

| Capa | Estado | Observación |
|------|--------|-------------|
| **Backend** | ✅ Completo | Batch, fullSync, rate limiter, todos los campos implementados |
| **API client (frontend)** | ✅ Completo | `pushAvailabilityBatch`, `pushRestrictionsBatch`, `fullSync` existen |
| **UI — ARICalendar** | ❌ Crítico | No tiene panel de restricciones, no tiene batch, no muestra task IDs |

El backend y el cliente API están listos. El cuello de botella es la interfaz de usuario (`ARICalendar.tsx`), que actualmente sólo puede manejar un push de disponibilidad binaria (0/1) — sin rates, sin restricciones, sin batch, sin fullSync.

---

## Estado del Backend

### ✅ Todo implementado correctamente

| Capacidad | Archivo | Estado |
|-----------|---------|--------|
| `pushAvailability(updates[])` | `channex-ari.service.ts:296` | ✅ Array, rate-limited |
| `pushRestrictions(updates[])` | `channex-ari.service.ts:323` | ✅ Array, rate-limited |
| `fullSync(propertyId, options)` | `channex-ari.service.ts:357` | ✅ 2 calls, lee Firestore |
| Rate limiter 10/min | `channex-ari-rate-limiter.service.ts` | ✅ Sliding window |
| `availability: number` (no binario) | `channex.types.ts` | ✅ Acepta enteros |
| `rate`, `min_stay_arrival`, `max_stay` | DTOs de restrictions | ✅ Todos presentes |
| `stop_sell`, `closed_to_arrival`, `closed_to_departure` | DTOs de restrictions | ✅ Todos presentes |
| Endpoint `POST /full-sync` | `channex-ari.controller.ts:183` | ✅ Correcto |
| Endpoint `POST /availability` | `channex-ari.controller.ts:128` | ✅ Batch |
| Endpoint `POST /restrictions` | `channex-ari.controller.ts:153` | ✅ Batch |
| Endpoint `POST /room-types/:id/rate-plans` | `channex-ari.controller.ts:99` | ✅ Crea en Channex + Firestore |
| Webhook ACK-first + HMAC | `channex-webhook.controller.ts` | ✅ Completo |
| BullMQ worker — 3 revision types | `workers/channex-booking.worker.ts` | ✅ new/modification/cancellation |
| `POST /booking_revisions/:id/ack` | worker | ✅ Implementado |

---

## Estado del API Client (Frontend)

### ✅ Todo implementado correctamente

Archivo: `apps/frontend/src/channex/api/channexHubApi.ts`

| Función | Estado |
|---------|--------|
| `pushAvailabilityBatch(propertyId, updates[])` | ✅ |
| `pushRestrictionsBatch(propertyId, updates[])` | ✅ |
| `triggerFullSync(propertyId, options)` | ✅ |
| `listRoomTypes(propertyId)` | ✅ |
| `createRoomType` / `createRatePlan` | ✅ |

Archivo: `apps/frontend/src/airbnb/api/channexApi.ts`  
— Copia análoga con `pushAvailability`, `pushAvailabilityBatch`, `pushRestrictions`, `pushRestrictionsBatch`, `fullSync`. ✅

---

## Gaps de UI — ARICalendar.tsx

El componente actual (`apps/frontend/src/airbnb/components/ARICalendar.tsx`) es la única superficie de UI para los tests ARI. **No puede ejecutar ningún test de certificación** en su estado actual.

---

### Gap UI-1 — No hay panel de restricciones/rates
**Severidad:** 🔴 Crítico  
**Tests afectados:** #2, #3, #4, #5, #6, #7, #8

**Estado actual:** El panel lateral (`showARIControlPanel`) sólo tiene dos radio buttons: "Available (Open)" / "Blocked (Closed)". Llama únicamente a `pushAvailabilityUpdate` con `availability: 0 | 1`.

**Qué necesita:** Un panel ARI completo con los siguientes campos (todos opcionales entre sí):
- Selector de Room Type (Twin Room / Double Room)
- Selector de Rate Plan (BAR / B&B)
- Campo de Rate (precio decimal, e.g. `333.00`)
- Campo de Min Stay (entero)
- Max Stay (entero)
- Checkboxes: Stop Sell, Closed to Arrival, Closed to Departure
- Campo de Availability (entero, aplica si se seleccionó room type, no rate plan)

---

### Gap UI-2 — No hay batch ("Add to Batch" / "Save N")
**Severidad:** 🔴 Crítico  
**Tests afectados:** #3, #4, #5, #6, #7, #8, #9, #10

**Estado actual:** Cada "Save" despacha inmediatamente una llamada al backend. No hay forma de acumular varios cambios y enviarlos en un solo call.

**Qué necesita:**
- Botón **"+ Add to Batch"** que guarda el entry actual en estado local (sin llamar al backend todavía)
- Contador visible: **"Save (N)"** que muestra cuántos items hay en el batch pendiente
- Al hacer "Save (N)", llama a `pushAvailabilityBatch` o `pushRestrictionsBatch` con todos los items acumulados en una sola llamada
- Separación interna: los items de availability van a un batch, los de restrictions a otro (se despachan separados)

---

### Gap UI-3 — Disponibilidad es binaria (0/1), no entero
**Severidad:** 🔴 Crítico  
**Tests afectados:** #9, #10

**Estado actual:** `selectedAvailability` tiene tipo `0 | 1` y sólo permite radio buttons "Open/Blocked".  
**Línea:** `ARICalendar.tsx:214` — `useState<0 | 1>(1)`

**Qué necesita:** Un campo numérico de disponibilidad que acepte enteros positivos (0, 1, 2, 3, 7...). El backend ya acepta `number` — el problema es sólo en la UI.

---

### Gap UI-4 — No hay Full Sync button
**Severidad:** 🔴 Crítico  
**Tests afectados:** #1

**Estado actual:** No existe ningún botón de Full Sync en la UI.  
El endpoint `POST /channex/properties/:propertyId/full-sync` existe en el backend y la función `triggerFullSync()` existe en el API client, pero nadie los llama.

**Qué necesita:** Un botón "Full Sync (500 days)" visible en la vista de inventario, posiblemente en la cabecera del ARICalendar. Al presionarlo:
1. Abre un modal o sección con campos: Availability (default: 1), Rate (default: "100.00"), Days (default: 500)
2. Llama a `triggerFullSync`
3. Muestra los **dos task IDs** devueltos en un banner/emerald box (el certificador los necesita)

---

### Gap UI-5 — Los task IDs no se muestran en la UI
**Severidad:** 🟡 Requerido  
**Tests afectados:** #1–#10 (todos)

**Estado actual:** Después de cualquier push (availability o restrictions), la UI no muestra el `taskId` devuelto por el backend. El formulario de certificación pide este ID para cada test.

**Qué necesita:** Después de cada "Save" o "Full Sync" exitoso, mostrar el task ID en la UI. Puede ser:
- Un toast o banner al final del panel que diga "Task ID: `<uuid>`" con botón de copiar
- Para Full Sync: dos IDs (availability + restrictions) en un bloque destacado

---

### Gap UI-6 — No hay selector de Room Type en el panel ARI
**Severidad:** 🔴 Crítico  
**Tests afectados:** #2–#10

**Estado actual:** El panel usa `activeProperty.channex_room_type_id` hardcodeado — sólo opera sobre el room type principal del listing Airbnb seleccionado. No hay forma de elegir "Twin Room" vs "Double Room".

**Qué necesita:** Un selector (dropdown) que cargue los room types de Firestore via `listRoomTypes(propertyId)` y permita elegir cuál actualizar. Cuando se elige un room type, el selector de rate plan se filtra a los rate plans de ese room type.

---

### Gap UI-7 — No hay selector de Rate Plan en el panel ARI
**Severidad:** 🔴 Crítico  
**Tests afectados:** #2–#8

**Estado actual:** `activeProperty.channex_rate_plan_id` es un solo ID fijo. No hay UI para elegir entre BAR y B&B.

**Qué necesita:** Dropdown de rate plans filtrado por el room type seleccionado (Gap UI-6). Cuando se selecciona un rate plan, el panel muestra los campos de restrictions (rate, min_stay, stop_sell, etc.).

---

## Test #11 — Webhook (verificación adicional)

**Backend:** ✅ Completo — ACK-first, HMAC, BullMQ, 3 tipos de revisión.

**UI para el formulario:** El formulario pide 4 UUIDs:
- `booking_id` 
- `revision_id` para `booking_new`
- `revision_id` para `booking_modification`  
- `revision_id` para `booking_cancellation`

Estos IDs los genera Channex durante la reunión. El evaluador hace test push manual. El backend los procesa y los guarda en Firestore. Necesitamos poder recuperarlos visualmente.

**Gap adicional:** La vista "reservations" existe pero no muestra explícitamente los `revision_id`. Habría que confirmar si `DetailedReservationsView` expone estos campos, o si habrá que leerlos de los logs del backend.

---

## Resumen de gaps por test

| Test | Descripción | Backend | API Client | UI Ready |
|------|-------------|---------|------------|----------|
| #1 Full Sync 500 días | 2 calls, todos los rooms/rates | ✅ | ✅ | ❌ Sin botón ni task ID display |
| #2 Single date / single rate | 1 call, rate solo | ✅ | ✅ | ❌ Sin campo rate, sin task ID |
| #3 Single date / multi-rate batch | 1 call, 3 entries | ✅ | ✅ | ❌ Sin batch UI, sin rate panel |
| #4 Multi-date / multi-rate batch | 1 call, 3 ranges | ✅ | ✅ | ❌ Sin batch UI |
| #5 Min Stay | 1 call, 3 entries | ✅ | ✅ | ❌ Sin campo min stay |
| #6 Stop Sell | 1 call, 3 entries | ✅ | ✅ | ❌ Sin checkbox stop_sell |
| #7 Multiple restrictions | 1 call, 4 entries | ✅ | ✅ | ❌ Sin CTA/CTD/max_stay |
| #8 Half-year | 1 call, 2 ranges | ✅ | ✅ | ❌ Sin rango largo + restricciones |
| #9 Availability count (dates) | 1 call, 2 entries | ✅ | ✅ | ❌ Binario, sin batch, sin task ID |
| #10 Availability count (ranges) | 1 call, 2 entries | ✅ | ✅ | ❌ Igual que #9 |
| #11 Webhook | Manual por evaluador | ✅ | N/A | ⚠️ Verificar revision IDs en UI |

---

## Lista priorizada de implementación (UI)

| # | Gap | Tests que desbloquea |
|---|-----|---------------------|
| 1 | Selector de Room Type + Rate Plan | #2–#10 |
| 2 | Panel de restricciones (rate, min_stay, stop_sell, CTA, CTD, max_stay) | #2–#8 |
| 3 | Availability como entero (no binario) | #9, #10 |
| 4 | Batch UI (Add to Batch / Save N) | #3–#10 |
| 5 | Botón Full Sync con modal | #1 |
| 6 | Mostrar task ID después de cada push | #1–#10 |
| 7 | Verificar revision IDs en reservations view | #11 |

---

## Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| `apps/frontend/src/airbnb/components/ARICalendar.tsx` | Reescribir el panel ARI completo: selectors, batch, restrictions, integer availability, task ID display, full sync |
| `apps/frontend/src/integrations/airbnb/components/InventoryView.tsx` | Posiblemente agregar el botón Full Sync a nivel de vista (fuera del calendar) |
| `apps/frontend/src/integrations/airbnb/components/DetailedReservationsView.tsx` | Verificar si expone `revision_id` para Test #11 |

**Ningún archivo de backend requiere cambios.**

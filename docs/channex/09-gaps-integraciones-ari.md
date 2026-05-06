# Gaps ARI — Integraciones Airbnb y Booking.com

**Fecha:** 2026-05-06  
**Rama:** `nilmar/518-57-feature-airbnb-integration-via-channexio-onboarding-oauth`  
**Contexto:** Durante la preparación para la certificación Channex se identificó que el panel ARI completo (batch, rates, restricciones, max stay, full sync) fue implementado en `ARICalendarFull.tsx` bajo la ruta **ChannexHub → Properties**. Las vistas de las integraciones (Airbnb, Booking.com) tienen su propio componente `ARICalendar.tsx` que **no** fue actualizado.

---

## Componentes afectados

| Componente | Ruta | Estado |
|-----------|------|--------|
| `ARICalendarFull.tsx` | `apps/frontend/src/channex/components/` | ✅ Completo — usado en Properties |
| `ARICalendar.tsx` | `apps/frontend/src/airbnb/components/` | ❌ Desactualizado — usado en Airbnb integration |
| (sin componente propio) | `apps/frontend/src/integrations/booking/` | ❌ No existe panel ARI para Booking.com |

---

## Gap A — ARICalendar.tsx (Airbnb) no tiene panel completo

**Archivo:** `apps/frontend/src/airbnb/components/ARICalendar.tsx`

### A-1 Disponibilidad binaria (0/1) en vez de entero
- **Estado actual:** `selectedAvailability` es `0 | 1`, panel sólo muestra "Available / Blocked"
- **Solución:** Cambiar a `number | ''` con campo numérico, igual que `ARICalendarFull`

### A-2 Sin selectores de Room Type / Rate Plan
- **Estado actual:** Usa `activeProperty.channex_room_type_id` y `channex_rate_plan_id` hardcodeados
- **Solución:** Cargar `listRoomTypes(propertyId)` y mostrar dropdowns de Room Type / Rate Plan anidados (misma lógica que `ARICalendarFull`)

### A-3 Sin campos de Rate, Min Stay, Max Stay
- **Estado actual:** Panel no tiene campos de precio ni estadías mínima/máxima
- **Solución:** Agregar los mismos campos que `ARICalendarFull`: rate (decimal), min_stay_arrival (entero), max_stay (entero)

### A-4 Sin checkboxes de restricciones
- **Estado actual:** Stop Sell, Closed to Arrival, Closed to Departure no existen en este panel
- **Solución:** Agregar sección "Restrictions" con los mismos 3 checkboxes

### A-5 Sin batch (Add to Batch / Save N)
- **Estado actual:** Cada "Save" despacha inmediatamente, sin acumulación
- **Solución:** Implementar `BatchEntry` con `dateFrom`/`dateTo` por entrada, botón "+ Add to Batch", contador "Save (N)" — mismo patrón que `ARICalendarFull`

### A-6 Sin Full Sync
- **Estado actual:** No existe botón de Full Sync en la vista Airbnb
- **Solución:** Agregar botón que abra modal con campos Availability / Rate / Days y llame a `triggerFullSync`

### A-7 Task IDs no se muestran
- **Estado actual:** Después de push, la UI no muestra el `taskId` devuelto
- **Solución:** Banner emerald post-save igual que `ARICalendarFull`

---

## Gap B — Booking.com no tiene panel ARI

**Archivo:** No existe

La integración Booking.com (`apps/frontend/src/integrations/booking/`) no tiene ningún componente de gestión de inventario ARI.

### B-1 Crear BookingARICalendar o reutilizar ARICalendarFull
- **Opción 1:** Extraer `ARICalendarFull` a un componente compartido en `apps/frontend/src/channex/components/` y parametrizarlo por `propertyId` — tanto Properties como Airbnb y Booking.com lo reutilizan
- **Opción 2:** Copiar `ARICalendarFull` y adaptarlo para cada integración
- **Recomendación:** Opción 1 — ya existe como componente reutilizable, sólo falta conectarlo desde las vistas de integración

---

## Enfoque recomendado para implementar

El refactor más limpio es **promover `ARICalendarFull` como componente canónico compartido**:

1. Mover `ARICalendarFull.tsx` a `apps/frontend/src/channex/components/shared/ARICalendarFull.tsx` (o mantener ubicación actual)
2. En `apps/frontend/src/airbnb/components/ARICalendar.tsx`: reemplazar el panel actual con una instancia de `ARICalendarFull` pasándole `propertyId` y `currency`
3. En `apps/frontend/src/integrations/booking/`: crear vista de inventario que incluya `ARICalendarFull`
4. Eliminar `ARICalendar.tsx` una vez migrado (si no tiene otros usos)

**Pre-requisito:** La property de Airbnb debe tener un `channex_property_id` guardado en Firestore para que `listRoomTypes(propertyId)` funcione. Verificar que el OAuth onboarding de Airbnb guarda este ID.

---

## Tests de certificación afectados

Estos gaps no bloquean la certificación actual (que se ejecuta desde **Properties**, no desde las integraciones), pero deben resolverse antes de que Airbnb o Booking.com estén en producción.

| Test | Descripción | ¿Afecta Airbnb? | ¿Afecta Booking.com? |
|------|-------------|-----------------|----------------------|
| #1 Full Sync | Botón y modal | ❌ (sin botón) | ❌ (sin panel) |
| #2–#8 Rates + restricciones | Panel ARI completo | ❌ (sin panel) | ❌ (sin panel) |
| #9–#10 Availability count | Entero, no binario | ❌ (binario) | ❌ (sin panel) |

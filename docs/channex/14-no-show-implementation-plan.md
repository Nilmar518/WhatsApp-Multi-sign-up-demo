# No Show — Plan de Implementación

**Referencia:** `docs/channex/13-no-show-spec.md`  
**Fecha:** 2026-05-18  
**Estado:** 🔜 Pendiente

---

## Orden de ejecución

Las tareas siguen una dependencia lineal: backend primero, luego frontend. Cada bloque puede verificarse de forma aislada antes de avanzar al siguiente.

---

## Bloque 1 — Backend: capa de servicio Channex

**Archivo:** `apps/backend/src/channex/channex.service.ts`

- [ ] Agregar método `markNoShow(channexBookingId: string, waivedFees: boolean): Promise<unknown>`
  - `POST /api/v1/bookings/{channexBookingId}/no_show`
  - Body: `{ no_show_report: { waived_fees: waivedFees } }`
  - Usar `DefensiveLoggerService.request<T>()` (mismo patrón que el resto de llamadas Channex)
  - Retornar la respuesta cruda de Channex — el servicio de ARI interpretará éxito/error

---

## Bloque 2 — Backend: capa de negocio ARI

**Archivo:** `apps/backend/src/channex/channex-ari.service.ts`

- [ ] Agregar método `markBookingNoShow(propertyId: string, channexBookingId: string, tenantId: string, waivedFees: boolean)`
  - Llamar `this.channex.markNoShow(channexBookingId, waivedFees)`
  - En éxito: buscar el documento de la reserva en Firestore por `channex_booking_id === channexBookingId` y `propertyId`
  - Actualizar: `booking_status = 'no_show'`, `updated_at`, `no_show_waived_fees`, `no_show_reported_at`
  - Retornar `{ success: true, data: channexResponse }`
  - En error de Channex (4xx): retornar `{ success: false, errors: channexErrorBody }` — **no lanzar excepción HTTP**, dejar que el controller decida el status code

---

## Bloque 3 — Backend: controller

**Archivo:** `apps/backend/src/channex/channex-ari.controller.ts`

- [ ] Agregar endpoint:
  ```
  POST /channex/properties/:propertyId/bookings/:channexBookingId/no-show
  Body: { tenantId: string, waivedFees: boolean }
  ```
- [ ] Si `ariService.markBookingNoShow()` devuelve `success: false` → responder `422` con el cuerpo de `errors`
- [ ] Si `success: true` → responder `200` con `{ success: true, data }`
- [ ] Validar que `tenantId` esté presente en el body (BadRequestException si falta)

---

## Bloque 4 — Frontend: API client

**Archivo:** `apps/frontend/src/channex/api/channexHubApi.ts`

- [ ] Agregar interfaz `NoShowResult`:
  ```ts
  export interface NoShowResult {
    success: boolean;
    data?: unknown;
    errors?: {
      code?: string;
      title?: string;
      details?: Record<string, string[]>;
    };
  }
  ```
- [ ] Agregar función `markNoShow(propertyId, channexBookingId, tenantId, waivedFees): Promise<NoShowResult>`
  - `POST /api/channex/properties/{propertyId}/bookings/{channexBookingId}/no-show`
  - No lanzar error en 422 — retornar el body directamente para que el modal muestre el detalle

---

## Bloque 5 — Frontend: modal de confirmación

**Archivo nuevo:** `apps/frontend/src/channex/components/shared/NoShowConfirmModal.tsx`

- [ ] Props:
  ```ts
  interface NoShowConfirmModalProps {
    reservation: Reservation;
    onClose: () => void;
    onSuccess: () => void;
  }
  ```
- [ ] Máquina de estados interna: `'idle' | 'loading' | 'error' | 'success'`
- [ ] Estado `idle`:
  - Header con fondo rojo, ícono de advertencia, título "Reportar No Show"
  - Nombre del huésped + check-in/check-out como referencia
  - Advertencia: "Esta acción es irreversible y será comunicada a Booking.com."
  - Checkbox: "Se cobró el importe de la reserva al huésped"
  - Texto de ayuda dinámico según valor del checkbox (ver spec §2)
  - Botones: Cancelar | Confirmar No Show
- [ ] Estado `loading`:
  - Botón "Confirmar" → spinner + "Enviando…"
  - Checkbox y botón Cancelar: `disabled`
- [ ] Estado `error`:
  - Renderizar `errors.details` como lista (campo → mensajes)
  - Fallback: `errors.title` → fallback: "Error desconocido"
  - Botones: Cerrar | Reintentar (vuelve a `idle` preservando `waivedFees`)
- [ ] Estado `success`:
  - Mensaje: "No show registrado correctamente."
  - Botón único: "Entendido" → llama `onSuccess()` + `onClose()`
- [ ] Cerrar con Escape solo en estados `idle` y `error` (no durante `loading`)

---

## Bloque 6 — Frontend: integrar en `ReservationDetailModal`

**Archivo:** `apps/frontend/src/channex/components/shared/ReservationDetailModal.tsx`

- [ ] Agregar estado: `const [showNoShowConfirm, setShowNoShowConfirm] = useState(false)`
- [ ] El botón "No show" existente → `onClick={() => setShowNoShowConfirm(true)}` (reemplazar el `console.warn` placeholder)
- [ ] Renderizar `<NoShowConfirmModal />` cuando `showNoShowConfirm && r !== null`
- [ ] `onClose` del confirm modal → `setShowNoShowConfirm(false)`
- [ ] `onSuccess` del confirm modal → `setShowNoShowConfirm(false)` + llamar prop `onNoShowComplete?.()` (ver Bloque 7)

---

## Bloque 7 — Frontend: refrescar lista en `ReservationsPanel`

**Archivo:** `apps/frontend/src/channex/components/shared/ReservationsPanel.tsx`

- [ ] Agregar prop a `ReservationDetailModal`: `onNoShowComplete?: () => void`
- [ ] En `ReservationsPanel`, pasar `onNoShowComplete={() => { setSelectedReservation(null); load(true); }}`
  - Cierra el modal de detalle y recarga silenciosamente la lista

---

## Criterios de aceptación

- [ ] El botón "No show" solo aparece cuando `channel === 'booking_com'` y `status !== 'cancelled'`
- [ ] El checkbox por defecto está **desmarcado** (`waived_fees: true` — no cobró)
- [ ] El modal bloquea toda interacción durante `loading`
- [ ] Un error 422 de Channex (ej: check-in < 1 día) se muestra formateado, no como crash
- [ ] Tras éxito, la reserva en Firestore refleja `booking_status: 'no_show'`
- [ ] Tras éxito, la lista de reservas se recarga automáticamente
- [ ] El componente `NoShowConfirmModal` no importa nada específico de Booking.com — es agnóstico al canal

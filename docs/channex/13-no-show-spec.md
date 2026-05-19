# No Show — Spec Técnico

**Feature:** Marcar reserva como No Show desde el panel de Reservations (Booking.com)  
**Scope:** BDC únicamente — el botón existe en el modal genérico `ReservationDetailModal` pero solo se renderiza cuando `reservation.channel === 'booking_com'`  
**Fecha:** 2026-05-18

---

## 1. Contexto de negocio

Booking.com permite que el hotelero reporte un huésped como "No Show" cuando este no se presentó al check-in. La acción tiene una consecuencia financiera clave controlada por el campo `waived_fees`:

| `waived_fees` | Significado | Consecuencia |
|---|---|---|
| `false` | El hotelero **sí cobró** al huésped (tenía garantía de pago) | Booking.com **cobra su comisión** normal |
| `true` | El hotelero **no cobró** al huésped (no pudo o decidió no hacerlo) | Booking.com **condona su comisión** |

> **Regla de Channex/BDC:** Solo se puede ejecutar esta acción **mínimo 1 día después del check-in**. Si se intenta antes, Channex devuelve `422 Unprocessable Content` con el detalle `"Not able to cancel booking earlier than 1 day after the check in."`.

---

## 2. Flujo UX

```
ReservationDetailModal
  └── [Botón "No show"] (visible solo si channel === 'booking_com' y status !== 'cancelled')
        └── abre NoShowConfirmModal
              ├── IDLE: advertencia + checkbox waived_fees + botones Cancelar / Confirmar
              ├── LOADING: spinner, inputs bloqueados, botones deshabilitados
              ├── ERROR: mensaje formateado de Channex + botón Reintentar / Cancelar
              └── SUCCESS: confirmación + botón "Entendido" → cierra modal + refresca lista
```

### Estado IDLE

- **Header en rojo:** "⚠️ Reportar No Show"
- **Cuerpo:**
  - Nombre del huésped + fechas de la reserva (referencia visual)
  - Texto de advertencia: "Esta acción es irreversible y será comunicada a Booking.com."
  - **Checkbox:** "Se cobró el importe de la reserva al huésped"
    - ☑ Marcado → `waived_fees: false` → BDC cobrará su comisión
    - ☐ Desmarcado → `waived_fees: true` → BDC condonará su comisión
  - Texto de ayuda según estado del checkbox (actualiza dinámicamente):
    - Marcado: "Booking.com cobrará su comisión sobre esta reserva."
    - Desmarcado: "Booking.com condonará su comisión. Solo aplica si no recibiste pago del huésped."
- **Footer:** `[Cancelar]` `[Confirmar No Show]`

### Estado LOADING

- Botón "Confirmar" muestra spinner + texto "Enviando…"
- Checkbox y botón Cancelar deshabilitados
- Sin timeout — espera hasta que el servidor responda

### Estado ERROR

- Muestra el bloque de error de Channex formateado:
  - Si viene `errors.details`: itera cada campo con sus mensajes como lista
  - Fallback: `errors.title` o mensaje genérico
- Botones: `[Cerrar]` `[Reintentar]` (vuelve a IDLE con los mismos valores)

### Estado SUCCESS

- Texto: "No show registrado correctamente."
- Botón único: "Entendido" → cierra `NoShowConfirmModal` → cierra `ReservationDetailModal` → recarga la lista de reservas

---

## 3. API Contract

### Backend — nuevo endpoint

```
POST /channex/properties/:propertyId/bookings/:channexBookingId/no-show

Body:
{
  "tenantId": "string",
  "waivedFees": boolean
}

Response 200:
{
  "success": true,
  "data": { ...channex_response }
}

Response 4xx/5xx:
{
  "success": false,
  "errors": {
    "code": "validation_error",
    "title": "Validation Error",
    "details": {
      "booking_id": ["Not able to cancel booking earlier than 1 day after the check in."]
    }
  }
}
```

### Channex API — llamada downstream

```
POST https://app.channex.io/api/v1/bookings/{channexBookingId}/no_show
Authorization: Bearer {CHANNEX_API_KEY}
Content-Type: application/json

{
  "no_show_report": {
    "waived_fees": boolean
  }
}
```

**Nota importante sobre el `channexBookingId`:** El campo a usar es `reservation.channex_booking_id` (UUID de Channex), **no** `ota_unique_id` (ej: "BDC-5628772431"). El endpoint de Channex espera el UUID interno.

---

## 4. Cambios en Firestore

En éxito, se actualiza el documento de la reserva:

```
channex_integrations/{tenantId}/bookings/{pms_booking_id}
  booking_status: 'no_show'
  updated_at: <ISO timestamp>
  no_show_waived_fees: boolean
  no_show_reported_at: <ISO timestamp>
```

---

## 5. Componentes involucrados

| Archivo | Cambio |
|---|---|
| `channex.service.ts` | Nuevo método `markNoShow(bookingId, waivedFees)` → llama Channex API |
| `channex-ari.service.ts` | Nuevo método `markBookingNoShow(propertyId, bookingId, tenantId, waivedFees)` → llama service + actualiza Firestore |
| `channex-ari.controller.ts` | Nuevo endpoint `POST /:propertyId/bookings/:channexBookingId/no-show` |
| `channexHubApi.ts` | Nueva función `markNoShow(propertyId, channexBookingId, tenantId, waivedFees)` |
| `NoShowConfirmModal.tsx` | **Nuevo** — modal de confirmación con máquina de estados (idle/loading/error/success) |
| `ReservationDetailModal.tsx` | Agrega estado `showNoShowConfirm`, abre `NoShowConfirmModal` en el handler `onNoShow` |
| `ReservationsPanel.tsx` | Pasa callback `onNoShowComplete` para refrescar lista tras éxito |

---

## 6. Casos borde y validaciones

| Caso | Manejo |
|---|---|
| Check-in no ha pasado aún (< 1 día) | Error 422 de Channex → se muestra el detalle formateado |
| `channex_booking_id` es `null` (reserva manual) | El botón "No show" no aplica — no mostrar (verificar en el modal) |
| Reserva ya cancelada | El botón ya está oculto por condición `status !== 'cancelled'` |
| Timeout de red | Error genérico → estado ERROR → usuario puede reintentar |
| Doble clic en Confirmar | Bloqueado por estado LOADING (botón disabled) |

---

## 7. Referencia de error Channex

```json
{
  "errors": {
    "code": "validation_error",
    "title": "Validation Error",
    "details": {
      "booking_id": [
        "Not able to cancel booking earlier than 1 day after the check in."
      ]
    }
  }
}
```

**Renderizado en UI:** iterar `errors.details` → por cada campo, mostrar sus mensajes como ítems de lista. Si `details` está vacío o ausente, mostrar `errors.title`. Si nada de lo anterior, mostrar "Error desconocido, intenta nuevamente."

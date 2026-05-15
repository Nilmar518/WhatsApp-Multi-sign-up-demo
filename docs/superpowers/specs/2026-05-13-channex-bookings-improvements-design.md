# Channex Bookings Improvements — Design Spec

**Fecha:** 2026-05-13
**Origen:** Reunión de certificación con Channex (Evan). Aprobada la certificación con observaciones de mejora.
**Rama:** feat/channex-bookings-improvements

---

## Contexto

Durante la reunión de certificación, Evan identificó tres gaps en el PoC:

1. Las propiedades creadas en Channex tienen `allow_availability_autoupdate_on_cancellation` y `allow_availability_autoupdate_on_modification` en `true`, lo que provoca que Channex reabra disponibilidad automáticamente cuando llega una cancelación o modificación desde un OTA — riesgo directo de overbooking.
2. Los bookings OTA están almacenados en una sub-colección anidada 4 niveles (`properties/{id}/bookings/`) que impide queries cross-property y no tiene identificador interno del PMS.
3. No existe forma de registrar reservas manuales (walk-ins, mantenimiento, reservas directas) desde el PMS — el único mecanismo actual es manipular disponibilidad ARI a cero, sin dejar ningún registro del motivo o del huésped.

---

## Enfoque: Incremental por fases

Tres fases independientes. Cada una es deployable y testeable por separado. Sin eliminar funcionalidad existente.

---

## Fase 1 — Fix de settings de auto-update (urgente)

### Problema

La documentación de Channex define:

| Campo | Default documentado | Valor real en la cuenta |
|---|---|---|
| `allow_availability_autoupdate_on_confirmation` | `true` (read-only) | `true` |
| `allow_availability_autoupdate_on_modification` | `false` | `true` ← bug |
| `allow_availability_autoupdate_on_cancellation` | `false` | `true` ← bug |

No se mandan explícitamente al crear propiedades, por lo que Channex aplica sus propios defaults — que en la práctica difieren de los documentados.

### Cambios

**`apps/backend/src/channex/channex.types.ts`**

Agregar los dos campos faltantes a `ChannexPropertyPayload.settings`:

```typescript
settings?: {
  min_stay_type?: 'arrival' | 'both' | 'through';
  allow_availability_autoupdate_on_confirmation?: boolean;
  allow_availability_autoupdate_on_modification?: boolean;  // ← agregar
  allow_availability_autoupdate_on_cancellation?: boolean;  // ← agregar
};
```

**`apps/backend/src/channex/channex-property.service.ts`** (propiedades Airbnb)

```typescript
settings: {
  min_stay_type: 'arrival',
  allow_availability_autoupdate_on_confirmation: true,
  allow_availability_autoupdate_on_modification: false,  // ← agregar
  allow_availability_autoupdate_on_cancellation: false,  // ← agregar
},
```

**`apps/backend/src/booking/booking.service.ts`** (shell property Booking.com)

```typescript
settings: {
  min_stay_type: 'arrival',
  allow_availability_autoupdate_on_modification: false,  // ← agregar
  allow_availability_autoupdate_on_cancellation: false,  // ← agregar
},
```

### Resultado

Nuevas propiedades creadas desde el PMS nunca abrirán disponibilidad automáticamente ante cancelaciones o modificaciones de OTAs. El PMS mantiene control total sobre la disponibilidad.

> **Nota:** Las propiedades ya existentes en Channex deben actualizarse manualmente desde la UI de Channex o via `PUT /api/v1/properties/{id}`. Este fix aplica solo a propiedades creadas desde este punto en adelante.

---

## Fase 2 — Migración de colección bookings

### Motivación

La colección actual está anidada bajo la propiedad:
```
channex_integrations/{tenantId}/properties/{propertyId}/bookings/{channex_booking_id}
```

Problemas:
- Para listar todos los bookings de un tenant hay que conocer todos sus `propertyId` primero.
- El document ID es el `channex_booking_id` (UUID de Channex) — no existe un ID interno del PMS.
- No soporta bookings manuales (no tienen `channex_booking_id`).
- Firestore no permite queries cross-subcollection sin Collection Group indexes.

### Nueva estructura

```
channex_integrations/{tenantId}/bookings/{firestoreAutoId}
```

El document ID es generado por Firestore (`bookingsRef.doc()`) — UUID interno del PMS, nunca colisiona con IDs externos.

### Schema `FirestoreReservationDoc` — cambios

```typescript
export interface FirestoreReservationDoc {
  // ── IDs — CAMBIO PRINCIPAL ────────────────────────────
  pms_booking_id: string;            // auto-ID de Firestore — identificador interno del PMS
  channex_booking_id: string | null; // booking_id del webhook OTA; null en reservas manuales

  // ── Campo nuevo para queries sin conocer propertyId ───
  propertyId: string;                // antes implícito en la ruta, ahora campo explícito

  // ── Sync ARI (solo reservas manuales) ────────────────
  ari_synced?: boolean;              // true si se pusheó availability a Channex exitosamente
  ari_task_id?: string | null;       // task ID retornado por Channex al hacer el push

  // ── Todo lo demás sin cambios ─────────────────────────
  reservation_id: string | null;     // ota_reservation_code (código Airbnb/BDC visible al huésped)
  booking_status: string;
  channel: string;
  channex_property_id: string;
  room_type_id: string | null;
  ota_listing_id?: string | null;
  check_in: string;
  check_out: string;
  gross_amount: number;
  currency: string;
  ota_fee: number;
  net_payout: number;
  additional_taxes: number;
  payment_collect: string;
  payment_type: string;
  guest_first_name: string | null;
  guest_last_name: string | null;
  whatsapp_number: string | null;
  created_at: string;
  updated_at: string;
  booking_unique_id?: string | null;
  booking_revision_id?: string | null;
  live_feed_event_id?: string | null;
  ota_code?: string | null;
  customer_name?: string | null;
  arrival_date?: string | null;
  departure_date?: string | null;
  count_of_nights?: number | null;
  count_of_rooms?: number | null;
  amount_raw?: string | number | null;
}
```

### Patrón de idempotencia en el worker

`channex-booking.worker.ts` — al escribir un booking OTA:

```typescript
const bookingsRef = db
  .collection(INTEGRATIONS_COLLECTION)
  .doc(firestoreDocId)
  .collection('bookings');

// Idempotencia: buscar si ya existe un doc con este channex_booking_id
const existing = await bookingsRef
  .where('channex_booking_id', '==', bookingId)
  .limit(1)
  .get();

if (!existing.empty) {
  // Actualizar el mismo doc — modificación o cancelación del mismo booking
  await existing.docs[0].ref.set(reservationDoc, { merge: true });
} else {
  // Crear nuevo con auto-ID de Firestore
  const newRef = bookingsRef.doc();
  reservationDoc.pms_booking_id = newRef.id;
  reservationDoc.propertyId = propertyId;
  await newRef.set(reservationDoc);
}
```

### Lectura con fallback (coexistencia temporal)

`channex-ari.service.ts` — `getPropertyBookings()`:

```typescript
// 1. Leer de la nueva colección plana
const newSnap = await db
  .collection(INTEGRATIONS_COLLECTION)
  .doc(tenantId)
  .collection('bookings')
  .orderBy('check_in', 'desc')
  .limit(limit)
  .get();

if (!newSnap.empty) {
  return newSnap.docs.map(d => d.data() as FirestoreReservationDoc);
}

// 2. Fallback: leer de la colección vieja (datos históricos)
const oldSnap = await db
  .collection(INTEGRATIONS_COLLECTION)
  .doc(tenantId)
  .collection('properties')
  .doc(propertyId)
  .collection('bookings')
  .orderBy('check_in', 'desc')
  .limit(limit)
  .get();

return oldSnap.docs.map(d => d.data() as FirestoreReservationDoc);
```

La colección vieja no se elimina — los documentos históricos permanecen como están y se leen como fallback hasta que la nueva colección tenga datos suficientes.

### Índice Firestore requerido

```json
{
  "collectionGroup": "bookings",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "channex_booking_id", "order": "ASCENDING" }
  ]
}
```

Agregar a `firestore.indexes.json` o crear manualmente en Firebase Console.

---

## Fase 3 — Módulo de reservas manuales

### Backend

**Nuevo endpoint — crear reserva manual:**
```
POST /channex/properties/:propertyId/bookings/manual
```

DTO:
```typescript
class CreateManualBookingDto {
  tenantId: string;
  roomTypeId: string;        // para el push de availability (no se necesita ratePlanId)
  checkIn: string;           // YYYY-MM-DD
  checkOut: string;          // YYYY-MM-DD
  bookingType: 'walkin' | 'maintenance' | 'owner_stay' | 'direct';
  guestName?: string;
  guestPhone?: string;
  notes?: string;
  grossAmount?: number;      // 0 por default para maintenance blocks
  currency?: string;
}
```

Lógica del servicio (`ChannexARIService` o nuevo `ManualBookingService`):
1. Construir `FirestoreReservationDoc` con `channex_booking_id: null`, `channel: bookingType`, `pms_booking_id: newRef.id`
2. Crear doc en `channex_integrations/{tenantId}/bookings/{autoId}`
3. Push ARI: `availability = 0` para el rango `checkIn → checkOut` en Channex (usando `pushAvailability`)
4. Guardar `ariSynced: true` y `ariTaskId` en el doc
5. Retornar el doc completo

**Nuevo endpoint — cancelar reserva manual:**
```
PATCH /channex/properties/:propertyId/bookings/manual/:pmsBookingId/cancel
```

Lógica:
1. Leer el doc por `pmsBookingId`
2. Verificar que `channex_booking_id` es `null` (solo se cancelan manuales desde aquí)
3. Actualizar `booking_status: 'cancelled'`
4. Push ARI: `availability = 1` de vuelta a Channex para esas fechas
5. Retornar el doc actualizado

> **Asunción:** el push de `availability = 1` al cancelar asume que el room type tiene 1 unidad (vacation rental). Si la propiedad tiene múltiples unidades, el servicio debe leer la disponibilidad real del room type antes de incrementar. Para el PoC actual (propiedades de 1 unidad), availability = 1 al cancelar es correcto.

### Frontend — ARICalendarFull

En el panel lateral (`showPanel`) que se abre al seleccionar un rango de fechas, agregar debajo del batch de ARI un separador y el nuevo botón:

```
┌─────────────────────────────────┐
│  Update ARI                     │ ← sección existente sin cambios
│  [Room Type] [Rate Plan]        │
│  [Availability] [Rate] ...      │
│  [+ Add to Batch] [Save (n)]    │
├─────────────────────────────────┤
│  Registrar Reserva              │ ← sección nueva
│  [+ Nueva Reserva]              │
└─────────────────────────────────┘
```

Al hacer click en "Nueva Reserva", se abre un modal con:
- Tipo: Walk-in / Mantenimiento / Uso propietario / Directa (select)
- Nombre del huésped (input, opcional para mantenimiento)
- Teléfono (input, opcional)
- Precio (input, opcional, 0 por default)
- Notas (textarea, opcional)
- Rango ya preseleccionado del calendario (read-only)
- Botones: [Cancelar] [Confirmar Reserva]

Al confirmar:
1. `POST /channex/properties/:propertyId/bookings/manual`
2. Cerrar modal
3. Refrescar `ReservationsPanel`
4. Mostrar toast de éxito

### Frontend — ReservationsPanel

Una sola query a la nueva colección `bookings/` devuelve tanto OTA como manuales. Diferenciación por `channel`:

```typescript
const CHANNEL_LABELS: Record<string, string> = {
  airbnb: 'Airbnb',
  booking_com: 'Booking.com',
  walkin: 'Walk-in',           // ← nuevo
  maintenance: 'Mantenimiento', // ← nuevo
  owner_stay: 'Propietario',   // ← nuevo
  direct: 'Directa',           // ← nuevo
};

const CHANNEL_BADGE_STYLES: Record<string, string> = {
  airbnb: 'bg-danger-bg text-danger-text',
  booking_com: 'bg-notice-bg text-notice-text',
  walkin: 'bg-surface-subtle text-content-2',       // ← nuevo
  maintenance: 'bg-caution-bg text-caution-text',   // ← nuevo
  owner_stay: 'bg-brand-subtle text-brand',          // ← nuevo
  direct: 'bg-ok-bg text-ok-text',                  // ← nuevo
};
```

Las `ReservationCard` de reservas manuales muestran un botón de cancelar (solo cuando `channex_booking_id === null` y `booking_status !== 'cancelled'`).

### API client — `channexHubApi.ts`

Dos funciones nuevas:

```typescript
export async function createManualBooking(
  propertyId: string,
  body: CreateManualBookingPayload,
): Promise<FirestoreReservationDoc>

export async function cancelManualBooking(
  propertyId: string,
  pmsBookingId: string,
  tenantId: string,
): Promise<FirestoreReservationDoc>
```

---

## Restricciones transversales

- **Sin commits:** el código se entrega en archivos, sin git operations.
- **Sin borrar funcionalidad:** toda lógica existente se preserva. Los cambios son aditivos o ajustes puntuales.
- **Sin nuevas dependencias:** todo se resuelve con los módulos NestJS ya disponibles (`ChannexARIService`, `FirebaseService`, `DefensiveLoggerService`).
- **Colección vieja no se elimina:** `properties/{id}/bookings/` permanece como fallback de lectura.

---

## Archivos a modificar por fase

### Fase 1
| Archivo | Cambio |
|---|---|
| `channex.types.ts` | Agregar 2 campos a `ChannexPropertyPayload.settings` |
| `channex-property.service.ts` | Mandar `on_modification: false`, `on_cancellation: false` |
| `booking.service.ts` | Mandar `on_modification: false`, `on_cancellation: false` |

### Fase 2
| Archivo | Cambio |
|---|---|
| `booking-revision.transformer.ts` | Agregar `pms_booking_id`, `propertyId`, `channex_booking_id` al output |
| `channex-booking.worker.ts` | Escribir en nueva colección con idempotencia por query |
| `channex-ari.service.ts` | `getPropertyBookings` con fallback a colección vieja |
| `channex-ari.controller.ts` | Sin cambios (ya expone el endpoint correcto) |
| `firestore.indexes.json` | Agregar índice sobre `channex_booking_id` |

### Fase 3
| Archivo | Cambio |
|---|---|
| `channex-ari.service.ts` | Métodos `createManualBooking`, `cancelManualBooking` |
| `channex-ari.controller.ts` | Endpoints `POST .../bookings/manual`, `PATCH .../bookings/manual/:id/cancel` |
| `dto/create-manual-booking.dto.ts` | DTO nuevo |
| `channexHubApi.ts` | `createManualBooking`, `cancelManualBooking` |
| `ARICalendarFull.tsx` | Botón + modal de nueva reserva en el panel lateral |
| `ReservationsPanel.tsx` | Labels/badges para tipos manuales, botón cancelar |

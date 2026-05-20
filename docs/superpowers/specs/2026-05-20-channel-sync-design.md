# Channel Sync — Design Spec

**Date:** 2026-05-20
**Status:** Approved

## Problem

`propertyChannelCode` siempre devuelve `null` en `GET /properties/:id/bookings`, lo que impide que el botón de no-show aparezca en el modal de detalle de reserva.

Dos causas raíz:

1. **Fix 2 (principal):** `channex-bdc-sync.service.ts:persistToFirestore` escribe el doc de la propiedad con `channex_channel_id` pero **nunca escribe** en `channex_integrations/{tenantId}/channels/{channexChannelId}` — el subcollection que luego lee `getPropertyBookings` para resolver `propertyChannelCode`.

2. **Fix 1 (operacional):** `getChannelsForTenant` es Firestore-first con cache permanente. No hay mecanismo para re-sincronizar si Channex tiene canales que Firestore no conoce. El operador necesita un botón explícito de sync.

---

## Firestore Channel Schema (`StoredChannelDoc`)

```ts
interface StoredChannelDoc {
  channel_id:  string;   // UUID de Channex
  title:       string;   // e.g. "Booking.com - Hostal Central"
  channel_code: string;  // e.g. "BookingCom", "AirBNB"
  status:      string;   // "active" | "inactive"
  is_active:   boolean;
  synced_at:   string;   // ISO timestamp
  updated_at?: string;   // ISO timestamp
}
```

Ruta en Firestore: `channex_integrations/{tenantId}/channels/{channelId}`

---

## Fix 2 — Registrar canal al final de Sync Rooms/Rates

### Alcance

Aplica a **ambos** flujos de sync:
- `channex-bdc-sync.service.ts` → método `persistToFirestore`
- `channex-sync.service.ts` → dos métodos: `finalizeFirestoreDocument` (~línea 997) y `persistIsolatedSyncResults` (~línea 1591)

### Comportamiento esperado

Al final de `persistToFirestore` (o equivalente en Airbnb), antes de retornar:

1. Llamar a `channex.getChannel(channexChannelId)` — ya existe en `ChannexService`, retorna el `ChannexChannelItem` completo con `attributes.title`, `attributes.channel`, `attributes.is_active`, `attributes.status`.
2. Hacer `set` (con merge) en `channels/{channexChannelId}` con el `StoredChannelDoc` completo.

### Comportamiento de errores

Si `getChannel` falla (red, rate limit), **no interrumpir el sync**. Loguear el error con `[BDC_SYNC] WARN` o `[AIRBNB_SYNC] WARN` y continuar. El canal se puede registrar manualmente vía el botón de sync del Fix 1.

---

## Fix 1 — Botón "Sincronizar canales" en `ChannelManagementPanel`

### Lógica de reconciliación (backend)

Nuevo método `syncChannelsForTenant(tenantId)` en `ChannexChannelManagementService`:

1. Fetch live desde Channex: `getChannelsByGroup(groupId)` → `channexChannels[]`
2. Fetch desde Firestore: subcollection `channels` → `firestoreChannels[]`
3. Calcular diff por `channel_id`:
   - **En Channex pero no en Firestore** → batch `set` de los faltantes (registrar con todos los campos del `StoredChannelDoc`)
   - **En Firestore pero no en Channex** → NO borrar; retornar lista de IDs extras como señal de error
4. Retornar:

```ts
interface ChannelSyncResult {
  added:            number;
  alreadyInSync:    number;
  extraInFirestore: string[];  // channel_ids que están en FS pero no en Channex
}
```

### Endpoint

```
POST /channex/properties/channels/sync?tenantId=X
```

Response `200 OK`:
```json
{ "added": 1, "alreadyInSync": 0, "extraInFirestore": [] }
```

Si `extraInFirestore.length > 0` → el frontend muestra el modal de error con mensaje específico; el backend retorna igualmente `200` con los extras listados (no es un error de HTTP — el sync de los canales faltantes sí se completó).

### Frontend — `ChannelManagementPanel`

**Cambios en el componente:**
- Nuevo botón "Sincronizar" en el header del acordeón (derecha, antes del chevron).
- Estado local: `syncState: 'idle' | 'syncing' | 'done' | 'error'`
- Al hacer click: llama a nueva función `syncChannels(tenantId)` en `channexHubApi.ts` → `POST /channex/properties/channels/sync`.
- En `done`: refresca los canales en pantalla llamando a `refetch()` expuesto por el hook `useChannexChannels` (agregar función `refetch` al hook como parte de esta tarea).
- Si `extraInFirestore.length > 0`: abre el modal de error existente con el mensaje de contacto a administrador.
- Si la petición HTTP falla: abre el modal de error existente con el mensaje de error.

**Textos nuevos (i18n):**
```
channex.chanMgmt.syncBtn         → "Sincronizar"
channex.chanMgmt.syncing         → "Sincronizando..."
channex.chanMgmt.syncDone        → "Canales sincronizados"
channex.chanMgmt.syncErr.extra   → "Se detectaron canales en el sistema que ya no existen en Channex. Por favor contacte a un administrador."
```

---

## Archivos afectados

### Backend
| Archivo | Cambio |
|---|---|
| `channex-channel-management.service.ts` | Agregar método `syncChannelsForTenant` |
| `channex-property.controller.ts` | Agregar endpoint `POST channels/sync` |
| `channex-bdc-sync.service.ts` | En `persistToFirestore`: llamar `getChannel` y escribir `channels/{id}` |
| `channex-sync.service.ts` | En equivalente de Airbnb: llamar `getChannel` y escribir `channels/{id}` |

### Frontend
| Archivo | Cambio |
|---|---|
| `ChannelManagementPanel.tsx` | Agregar botón sync + lógica de estado + llamada API |
| `channexHubApi.ts` | Agregar función `syncChannels(tenantId)` |
| `hooks/useChannexChannels.ts` | Agregar función `refetch` al hook |
| `i18n/es.ts` | Agregar 4 claves nuevas |
| `i18n/en.ts` | Agregar 4 claves nuevas |

---

## Lo que NO cambia

- Lógica de activate/deactivate en `ChannelManagementPanel` — sin modificaciones.
- `getChannelsForTenant` — sigue siendo Firestore-first para lecturas normales.
- `BdcChannelSelectModal` y `SyncNamingModal` — sin modificaciones.
- Schema de `StoredChannelDoc` — sin cambios.
- Lógica de `getPropertyBookings` / `getBookingById` — ya resuelta por el fix en el frontend (acepta `'booking_com'`).

---

## Criterios de éxito

1. Después de hacer "Sincronizar habitaciones y tarifas" en Booking.com, el documento `channels/{channexChannelId}` existe en Firestore con `channel_code` correcto.
2. `GET /properties/:id/bookings` devuelve `propertyChannelCode: "BookingCom"` (o `"booking_com"`) — no `null`.
3. El botón de no-show aparece en el modal de detalle de reservas de Booking.com.
4. El botón "Sincronizar" en `ChannelManagementPanel` registra canales faltantes sin romper los existentes.
5. Si Firestore tiene canales que Channex no conoce, aparece el mensaje de error de administrador.

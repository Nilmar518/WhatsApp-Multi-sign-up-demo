# Design: Booking CRS Application Install en Sync Pipeline

**Fecha:** 2026-05-18  
**Estado:** Aprobado  
**Archivos afectados:** `channex.service.ts`, `channex-sync.service.ts`, `channex-bdc-sync.service.ts`

---

## Contexto

Channex gestiona tanto Airbnb como Booking.com bajo la misma infraestructura. Durante el paso de instalación de aplicaciones del sync (provisioning), actualmente se instala el **Channex Messages App** por propiedad aislada. Ahora se requiere instalar también la aplicación **Booking CRS** en el mismo paso, para todas las integraciones (Airbnb y BDC), ya que es agnóstica al canal.

La infraestructura genérica `installApplication(propertyId, applicationId)` ya existe en `ChannexService`. Solo se necesita registrar el nuevo UUID y añadir la llamada al pipeline.

---

## Requerimientos

- Instalar Booking CRS en cada propiedad aislada creada durante el sync, para **ambas** pipelines (Airbnb y BDC).
- Si la instalación falla, es **non-fatal**: el listing/room sigue marcándose como succeeded o failed según los pasos anteriores. No se introduce un paso de rollback adicional.
- El `application_id` de Booking CRS es `bdcd403b-b62e-46c4-997e-3dced2ae7a37` (confirmado por network trace, `application_code: booking_crs`).
- Idempotente: un 422 de Channex (ya instalado) no debe lanzar error.

---

## Arquitectura

### `channex.service.ts`

1. Añadir `booking_crs: 'bdcd403b-b62e-46c4-997e-3dced2ae7a37'` al objeto estático `APP_IDS`.
2. Añadir `installBookingCrsApp(propertyId: string): Promise<void>` — wrapper idéntico a `installMessagesApp()`, llama a `installApplication(propertyId, APP_IDS.booking_crs)`.

### `channex-sync.service.ts` (pipeline Airbnb)

En `autoSyncProperty`, dentro del loop per-listing, añadir **Step G** inmediatamente después de Step F (Messages App). El step tiene su propio `try/catch` — fallo aquí no aborta el listing:

```
F  installMessagesApp(newPropertyId)        → ya existe (dentro del try fatal)
G  installBookingCrsApp(newPropertyId)      → nuevo, NON-FATAL (try/catch propio, solo log warn)
```

`IsolatedListingFailure.step` type union **no cambia** — Booking CRS nunca puede ser el step de fallo de un listing.

### `channex-bdc-sync.service.ts` (pipeline BDC)

En `syncBdc`, dentro del loop per-room, añadir **Step F** inmediatamente después de Step E (Messages App actual). Igualmente non-fatal:

```
E  installApplication(messages)             → ya existe (dentro del try fatal)
F  installBookingCrsApp(newPropertyId)      → nuevo, NON-FATAL (try/catch propio, solo log warn)
```

`IsolatedBdcFailure.step` type union **no cambia**.

---

## Data Flow

```
Per isolated property:
  [existing steps A–E/F]
        ↓
  installMessagesApp(propertyId)       → POST /api/v1/applications/install (messages UUID)
        ↓
  installBookingCrsApp(propertyId)     → POST /api/v1/applications/install (booking_crs UUID)
        ↓
  succeed or fail (both apps attempted before decision)
```

---

## Error Handling

- Booking CRS install tiene su **propio bloque `try/catch`**, fuera del try fatal del loop. Un fallo solo emite `logger.warn` y continúa — el listing no falla ni hace rollback. Mismo patrón que `registerPropertyWebhook`.
- Un 422 de Channex (ya instalado) es absorbido por `installApplication()` con log `WARN` — mismo comportamiento que Messages App.
- El type union de `step` en ambos failure interfaces **no se amplía** porque este step no es fatal.

---

## Testing

- Verificar en local (ngrok activo) que el log `[CHANNEX] Installing application="bdcd403b-..."` aparece para cada propiedad aislada.
- Verificar que un segundo sync sobre las mismas propiedades no falla (idempotencia vía 422 silenciado).
- Verificar que si Channex devuelve error real (5xx), el listing aparece en `failed[]` con el step correcto.

---

## Archivos modificados

| Archivo | Tipo de cambio |
|---|---|
| `apps/backend/src/channex/channex.service.ts` | + `APP_IDS.booking_crs` + `installBookingCrsApp()` |
| `apps/backend/src/channex/channex-sync.service.ts` | + Step G en `autoSyncProperty`, ampliar type union |
| `apps/backend/src/channex/channex-bdc-sync.service.ts` | + Step F en `syncBdc`, ampliar type union |

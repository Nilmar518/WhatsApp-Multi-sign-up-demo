# Channex Certification Runbook

> Guía para ejecutar los 11 test cases de certificación con los datos exactos que pide el formulario.
> Todo se crea desde cero, se prueba, y se borra al finalizar.
> Actualizado: 2026-04-30

---

## TL;DR — Cómo correr las pruebas

```bash
# 1. Levantar el backend
cd apps/backend && pnpm dev

# 2. Correr el script de certificación (desde la raíz del repo)
cd apps/backend
bash ../../scripts/channex-cert.sh

# 3. Ver los task IDs para el formulario
cat scripts/cert-task-ids.txt

# 4. Cleanup al terminar
bash ../../scripts/channex-cert.sh cleanup
```

El script crea todo desde cero en Channex staging **y** en Firestore, corre los 11 tests con los datos exactos del formulario, guarda todos los task IDs, y tiene un comando de cleanup para borrar todo y volver a empezar.

---

## Scripts

| Archivo | Propósito |
|---------|-----------|
| `scripts/channex-cert.sh` | Script principal — setup, tests, cleanup |
| `scripts/channex-cert-firestore.js` | Helper Node — actualiza `room_types[]` en Firestore |
| `scripts/channex-cert-firestore-delete.js` | Helper Node — borra el documento de Firestore en cleanup |
| `scripts/cert-ids.env` | IDs generados en setup (auto-creado, usado por cleanup) |
| `scripts/cert-task-ids.txt` | Task IDs de cada test (para pegar en el formulario) |

---

## Qué crea el script

### Entidades Channex staging (exactas del formulario, sección 2)

| Entidad | Nombre | Detalles |
|---------|--------|----------|
| Property | `Test Property - Migo UIT` | USD, America/New_York |
| Room Type | `Twin Room` | Occupancy 2 |
| Room Type | `Double Room` | Occupancy 2 |
| Rate Plan | `Best Available Rate` | Twin, $100 base |
| Rate Plan | `Bed and Breakfast` | Twin, $120 base |
| Rate Plan | `Best Available Rate` | Double, $100 base |
| Rate Plan | `Bed and Breakfast` | Double, $120 base |

### Firestore (`channex_integrations`)

El documento `cert-test-tenant__{channexPropertyId}` se crea con los 4 `room_types[]` incluyendo todos los `rate_plan_id`. El `fullSync` (Test #1) lee esto para armar las 2 llamadas batch.

---

## Tests ejecutados con datos exactos del formulario

| Test | Datos | API call | Sección formulario |
|------|-------|----------|--------------------|
| #1 Full Sync | 500 días, Twin+Double, 4 rate plans | 2 calls | Sección 4 |
| #2 Single date/rate | Twin BAR, Nov 22, $333 | 1 call | Sección 5-6 |
| #3 Batch rates, fechas distintas | Twin BAR Nov 21 $333, Double BAR Nov 25 $444, Double B&B Nov 29 $456.23 | 1 call | Sección 8-9 |
| #4 Batch rates, rangos distintos | Twin BAR Nov 1-10 $241, Double BAR Nov 10-16 $312.66, Double B&B Nov 1-20 $111 | 1 call | Sección 11-12 |
| #5 Min Stay | Twin BAR Nov 23 min=3, Double BAR Nov 25 min=2, Double B&B Nov 15 min=5 | 1 call | Sección 14-15 |
| #6 Stop Sell | Twin BAR Nov 14, Double BAR Nov 16, Double B&B Nov 20 | 1 call | Sección 17-18 |
| #7 Multiple restrictions | CTA/CTD/max_stay/min_stay en 4 combinaciones | 1 call | Sección 20-21 |
| #8 Half-year | Twin BAR + Double BAR Dic 2026-May 2027, rate+CTA+CTD+min_stay | 1 call | Sección 23-24 |
| #9 Availability (fechas) | Twin Nov 21 → 7, Double Nov 25 → 0 | 1 call | Sección 26-27 |
| #10 Availability (rangos) | Twin Nov 10-16 → 3, Double Nov 17-24 → 4 | 1 call | Sección 29-30 |
| #11 Webhook | Test push manual por el evaluador durante la reunión | N/A | Sección 32 |

---

## Prerequisitos

### Backend corriendo

```bash
cd apps/backend && pnpm dev
# Debe responder en http://localhost:3001
```

### ngrok activo

```bash
ngrok http 3001
# CHANNEX_WEBHOOK_CALLBACK_URL en .env.secrets debe coincidir con la URL de ngrok
```

### Dependencias del sistema

```bash
jq --version   # parser JSON para el script
node --version # para los helpers de Firestore
```

---

## Flujo del script paso a paso

```
1. Crea propiedad vía POST /channex/properties (backend)
   → Channex crea la property
   → Firestore escribe channex_integrations/{doc}

2. Crea Twin Room vía POST /channex/properties/:id/room-types (backend)
   → Channex crea el room type
   → Firestore hace arrayUnion en room_types[]

3. Crea Double Room (igual que arriba)

4. Crea 4 Rate Plans vía POST https://staging.channex.io/api/v1/rate_plans (directo)
   → No hay endpoint de backend para rate plans
   → Toma los IDs de las respuestas

5. Actualiza Firestore con los 4 rate plan IDs
   → node scripts/channex-cert-firestore.js
   → Escribe room_types[] con 4 entradas (Twin/BAR, Twin/B&B, Double/BAR, Double/B&B)
   → Necesario para que fullSync (Test #1) funcione

6. Crea webhook subscription (directo a Channex)

7. Corre Tests #1–#10 contra localhost:3001

8. Guarda todos los task IDs en scripts/cert-task-ids.txt
```

---

## Cleanup

```bash
# Desde el directorio apps/backend
bash ../../scripts/channex-cert.sh cleanup
```

Borra en orden:
1. Webhook subscription (Channex)
2. Rate plans — 4 (Channex)
3. Room types — 2 (Channex)
4. Property (Channex)
5. Documento `channex_integrations/{doc}` (Firestore)

Para repetir las pruebas: volver a correr `bash ../../scripts/channex-cert.sh`.

---

## Test #11 — Webhook (manual)

El script verifica que el webhook está activo. Durante la reunión, el evaluador de Channex hace el test push manualmente. Los logs del backend deben mostrar:

```
[ChannexWebhookController] ✓ Webhook received
[BookingRevisionWorker] Processing revision...
```

El formulario (sección 32) pide:
- Booking ID
- Revision ID para `booking_new`
- Revision ID para `booking_modification`
- Revision ID para `booking_cancellation`

Estos IDs los provee el evaluador de Channex durante la reunión.

---

## Sección 33 — Rate Limits (respuesta para el formulario)

**¿Pueden mantenerse dentro de los rate limits?** → Sí
- Implementamos `ChannexARIRateLimiter` (10 req/min por propiedad por tipo de endpoint)
- Rate limiter en memoria, sliding window

**¿Solo envían cambios delta?** → Sí
- Los pushes son disparados por acciones del usuario desde el PMS
- No existe timer de full-sync automático
- El `fullSync` solo se ejecuta manualmente en el go-live inicial

---

## Hoja de task IDs para el formulario

El script genera `scripts/cert-task-ids.txt` con este formato:

```
#1 Full Sync
  availabilityTaskId: <uuid>
  restrictionsTaskId: <uuid>
#2 Single date, single rate:
  taskId: <uuid>
...
```

Copiar y pegar en las secciones correspondientes del formulario de Channex.

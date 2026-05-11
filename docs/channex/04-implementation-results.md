# ARI Dispatch Layer — Implementation Results

> Resumen de los cambios implementados para cubrir los gaps de certificación Channex.
> Implementado: 2026-04-30

---

## Archivos modificados / creados

### Backend — `apps/backend/src/channex/`

| Archivo | Acción | Cambio principal |
|---------|--------|-----------------|
| `channex.types.ts` | Modificado | `ChannexARIResponse` incluye `data[0].id` (task ID); `AvailabilityEntryDto.availability` es `number`; nuevas interfaces `FullSyncOptions` y `FullSyncResult` |
| `channex.service.ts` | Modificado | `pushAvailability` y `pushRestrictions` retornan `Promise<string>` con el task ID de Channex |
| `channex-ari-rate-limiter.service.ts` | Creado | Rate limiter in-memory: 10 calls/min por propiedad por tipo de endpoint |
| `dto/ari-batch.dto.ts` | Creado | `AriAvailabilityBatchDto`, `AriRestrictionsBatchDto`, `AriFullSyncDto` |
| `channex-ari.service.ts` | Modificado | `pushAvailability(updates[])`, `pushRestrictions(updates[])` en array; rate limiter inyectado; nuevo método `fullSync()` |
| `channex-ari.controller.ts` | Modificado | Endpoints reciben `{ updates: [] }`; nuevo endpoint `POST /full-sync` |
| `channex.module.ts` | Modificado | `ChannexARIRateLimiter` registrado como provider |

### Frontend — `apps/frontend/src/airbnb/`

| Archivo | Acción | Cambio principal |
|---------|--------|-----------------|
| `api/channexApi.ts` | Modificado | `pushAvailability` y `pushRestrictions` wrappean en `{ updates: [payload] }`; tipo `availability: number`; nuevas funciones `pushAvailabilityBatch`, `pushRestrictionsBatch`, `fullSync` |
| `components/ARICalendar.tsx` | Modificado | Raw fetch actualizado a formato `{ updates: [{ ... }] }` |

---

## Nuevos endpoints disponibles

### `POST /channex/properties/:propertyId/availability`

Body actualizado:
```json
{
  "updates": [
    {
      "room_type_id": "<uuid>",
      "date_from": "2026-11-01",
      "date_to": "2026-11-10",
      "availability": 1
    }
  ]
}
```

Response:
```json
{ "status": "ok", "taskId": "<channex-task-uuid>" }
```

### `POST /channex/properties/:propertyId/restrictions`

Body actualizado:
```json
{
  "updates": [
    {
      "rate_plan_id": "<uuid>",
      "date_from": "2026-11-01",
      "date_to": "2026-11-10",
      "rate": "150.00",
      "min_stay_arrival": 2,
      "stop_sell": false
    }
  ]
}
```

Response:
```json
{ "status": "ok", "taskId": "<channex-task-uuid>" }
```

### `POST /channex/properties/:propertyId/full-sync` ← NUEVO

Body:
```json
{
  "defaultAvailability": 1,
  "defaultRate": "100.00",
  "days": 500
}
```

Response:
```json
{
  "availabilityTaskId": "<channex-task-uuid>",
  "restrictionsTaskId": "<channex-task-uuid>"
}
```

---

## Nuevas funciones en `channexApi.ts`

```typescript
// Batch — múltiples updates en una sola llamada
pushAvailabilityBatch(propertyId, updates[])   → { status, taskId }
pushRestrictionsBatch(propertyId, updates[])   → { status, taskId }

// Full sync — 500 días en 2 llamadas (certificación Test #1)
fullSync(propertyId, { defaultAvailability, defaultRate, days? })
  → { availabilityTaskId, restrictionsTaskId }
```

---

## Comportamiento retrocompatible

Los componentes existentes (`MultiCalendarView.tsx`) siguen llamando a `pushAvailability(propertyId, singlePayload)` sin cambios — la función internamente wrappea en `{ updates: [payload] }`. No se rompe nada existente.

---

## Gaps cubiertos

| Gap | Tests cubiertos | Estado |
|-----|----------------|--------|
| Batching | Tests #2–#8 | ✅ Implementado |
| Full Sync 500 días | Test #1 | ✅ Implementado |
| Rate limiter 10 req/min | Sección 33 | ✅ Implementado |
| Integer availability | Tests #9, #10 | ✅ Implementado |
| min_stay_through | N/A (Airbnb usa min_stay_arrival) | ✅ Decisión documentada |

---

## Compilación

- Backend TypeScript: sin errores
- Frontend TypeScript: 1 error pre-existente en `BookingIntegrationView.tsx` (sin relación con ARI)

---

## Ambiente de staging

| Variable | Valor |
|---------|-------|
| `CHANNEX_BASE_URL` | `https://staging.channex.io/api/v1` |
| `CHANNEX_API_KEY` | Configurado en `.env.secrets` |
| `CHANNEX_WEBHOOK_CALLBACK_URL` | ngrok configurado |

---

## Siguiente paso: Preparación para reunión de certificación

Ver `05-certification-runbook.md` (por crear) con los comandos exactos para ejecutar cada test case y recolectar los task IDs para el formulario.

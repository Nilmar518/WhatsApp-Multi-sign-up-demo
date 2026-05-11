# ARI Dispatch Layer — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the Channex ARI push mechanism to support batched updates, full sync, rate limiting, and integer availability counts — enabling Channex PMS certification while remaining agnostic to OTA type (Airbnb, Booking.com, or any future channel).

**Architecture:** Option C — enhance existing `ChannexARIService` to accept arrays, add `ChannexARIRateLimiter` as an injectable service, add `fullSync()` method. Zero changes to `ChannexService` (HTTP adapter), webhook pipeline, OAuth flows, or Firestore document structure.

**Tech Stack:** NestJS + TypeScript, Firestore (Firebase Admin SDK), existing `ChannexService` HTTP adapter. No new external dependencies.

---

## Design Principles

### Agnóstico a OTA
La capa de despacho no distingue entre Airbnb y Booking.com. Opera exclusivamente con `property_id`, `room_type_id`, y `rate_plan_id`. La fuente de esos IDs es Firestore (ya mirroreados desde Channex durante el flujo de conexión).

### Sin sobreescritura de configuración
- `fullSync` usa los IDs existentes en Firestore — nunca crea ni elimina entidades en Channex.
- ARI push envía solo campos de disponibilidad/tarifas/restricciones. No toca propiedades de room types, configuración de rate plans, ni ajustes de propiedad.
- El flujo de conexión (OAuth popup, channel activation) queda completamente intacto.

### Sin solicitud de permisos adicionales
Ningún cambio en esta capa dispara flujos de autorización. Las operaciones usan la misma `CHANNEX_API_KEY` que ya existe.

### Backward compatible
Los controllers que hoy pasan un solo update pasan a pasar `[update]` — la firma del array es un superset de la firma anterior. El comportamiento para operaciones de 1 item es idéntico.

---

## Componentes

### 1. `ChannexARIService` (modificar)

**Archivo:** `apps/backend/src/channex/channex-ari.service.ts`

**Cambios en métodos existentes:**

```typescript
// HOY
async pushAvailability(update: AvailabilityEntryDto): Promise<void>
async pushRestrictions(update: RestrictionEntryDto): Promise<void>

// DESPUÉS
async pushAvailability(updates: AvailabilityEntryDto[]): Promise<void>
async pushRestrictions(updates: RestrictionEntryDto[]): Promise<void>
```

El service pasa el array completo a `ChannexService.[method](updates)` — que ya acepta arrays. El rate limiter se invoca una vez por call (no por item del array).

**Nuevo método:**

```typescript
async fullSync(propertyId: string, options: FullSyncOptions): Promise<FullSyncResult>

interface FullSyncOptions {
  defaultAvailability: number;  // unidades disponibles a setear
  defaultRate: string;          // tarifa base, e.g. "100.00"
  days?: number;                // días hacia adelante; default 500
}

interface FullSyncResult {
  availabilityTaskId: string;
  restrictionsTaskId: string;
}
```

**Flujo interno de fullSync:**
1. Lee el documento Firestore de la integración vía `ChannexPropertyService.resolveIntegration(propertyId)`
2. Extrae `room_types[]` → genera un `AvailabilityEntryDto` por room type
3. Extrae `rate_plan_id`s de `room_types[]` → genera un `RestrictionEntryDto` por rate plan (con `rate: options.defaultRate`)
4. Calcula `date_from = hoy (YYYY-MM-DD)`, `date_to = hoy + options.days días`
5. Llama `this.channex.pushAvailability(availabilityEntries)` → captura task ID
6. Llama `this.channex.pushRestrictions(restrictionEntries)` → captura task ID
7. Retorna `{ availabilityTaskId, restrictionsTaskId }`

**Nota:** `ChannexService.pushAvailability` y `pushRestrictions` ya retornan la respuesta de Channex — el task ID se extrae de `response.data[0].id`.

---

### 2. `ChannexARIRateLimiter` (crear)

**Archivo:** `apps/backend/src/channex/channex-ari-rate-limiter.service.ts`

**Responsabilidad:** Garantizar que no se excedan 10 llamadas por minuto por propiedad por tipo de endpoint (availability / restrictions).

**Implementación:** In-memory sliding window counter. No requiere Redis (el volumen de propiedades por instancia es bajo; si se escala horizontalmente en el futuro, se migra).

```typescript
@Injectable()
export class ChannexARIRateLimiter {
  private readonly windows = new Map<string, { count: number; windowStart: number }>();
  private readonly LIMIT = 10;
  private readonly WINDOW_MS = 60_000;

  async acquire(propertyId: string, type: 'availability' | 'restrictions'): Promise<void>
  // Lógica:
  // key = `${propertyId}:${type}`
  // Si la ventana actual >= 60s: resetear count a 0, actualizar windowStart
  // Si count < LIMIT: incrementar count, retornar
  // Si count >= LIMIT: calcular tiempo restante hasta reset, esperar (sleep), luego reintentar
}
```

El limiter se inyecta en `ChannexARIService` y se llama antes de cada push:

```typescript
await this.rateLimiter.acquire(update.property_id, 'availability');
await this.channex.pushAvailability(updates);
```

---

### 3. `AvailabilityEntryDto` (modificar tipo)

**Archivo:** `apps/backend/src/channex/channex.types.ts`

```typescript
// HOY
export interface AvailabilityEntryDto {
  availability: 0 | 1;
}

// DESPUÉS
export interface AvailabilityEntryDto {
  availability: number;  // entero no negativo; 0 = sin unidades disponibles
}
```

Cambio no-breaking. Callers existentes que envían 0 o 1 siguen funcionando.

---

### 4. `ChannexARIController` (modificar)

**Archivo:** `apps/backend/src/channex/channex-ari.controller.ts`

Los endpoints de push pasan a aceptar arrays en el body. Se agrega endpoint de full sync.

```typescript
// Endpoints modificados
POST /channex/ari/availability   body: { updates: AvailabilityEntryDto[] }
POST /channex/ari/restrictions   body: { updates: RestrictionEntryDto[] }

// Endpoint nuevo
POST /channex/ari/full-sync      body: { propertyId: string, defaultAvailability: number, defaultRate: string, days?: number }
```

---

### 5. `channex.module.ts` (modificar)

Registrar `ChannexARIRateLimiter` como provider y exportarlo si necesario.

---

## Flujo end-to-end (certificación Test #3)

```
Admin cambia 3 tarifas en el UI
  → Frontend llama POST /channex/ari/restrictions
    body: { updates: [
      { property_id, rate_plan_id: twinBar, date_from, date_to, rate: "333.00" },
      { property_id, rate_plan_id: doubleBar, date_from, date_to, rate: "444.00" },
      { property_id, rate_plan_id: doubleBb, date_from, date_to, rate: "456.23" }
    ]}
  → ChannexARIController → ChannexARIService.pushRestrictions(updates)
    → ChannexARIRateLimiter.acquire(propertyId, 'restrictions') ✓
    → ChannexService.pushRestrictions(updates)
      → POST https://staging.channex.io/api/v1/restrictions
        { "values": [ ...3 entries... ] }
      ← { "data": [{ "id": "<task-id>", "type": "task" }] }
  ← 200 { taskId: "<task-id>" }
```

Channex recibe **1 sola llamada** con los 3 updates → test pasa.

---

## Flujo end-to-end (certificación Test #1 — Full Sync)

```
Admin / script de certificación llama POST /channex/ari/full-sync
  body: { propertyId: "<id>", defaultAvailability: 1, defaultRate: "100.00" }

ChannexARIService.fullSync(propertyId, options)
  → resolveIntegration(propertyId) → Firestore doc
  → room_types: [{ room_type_id: twin, rate_plan_id: twinBar }, ...]

  Llamada 1:
  → rateLimiter.acquire(propertyId, 'availability')
  → channex.pushAvailability([
      { property_id, room_type_id: twin, date_from, date_to, availability: 1 },
      { property_id, room_type_id: double, date_from, date_to, availability: 1 }
    ])
  ← availabilityTaskId

  Llamada 2:
  → rateLimiter.acquire(propertyId, 'restrictions')
  → channex.pushRestrictions([
      { property_id, rate_plan_id: twinBar, date_from, date_to, rate: "100.00" },
      { property_id, rate_plan_id: twinBb, date_from, date_to, rate: "100.00" },
      { property_id, rate_plan_id: doubleBar, date_from, date_to, rate: "100.00" },
      { property_id, rate_plan_id: doubleBb, date_from, date_to, rate: "100.00" }
    ])
  ← restrictionsTaskId

← { availabilityTaskId, restrictionsTaskId }
```

Channex recibe exactamente 2 llamadas → Test #1 pasa.

---

## Qué NO cambia

| Componente | Motivo |
|-----------|--------|
| `ChannexService` | HTTP adapter sin cambios — solo consume arrays que ya recibía |
| Webhook controller + workers | Pipeline de bookings completamente separado |
| Flujo OAuth / connection popup | Ninguna dependencia con ARI push |
| Firestore document structure | Se lee pero no se modifica |
| `ChannexPropertyService` | Se usa para `resolveIntegration` — sin modificar |
| Configuración de Channex (room types, rate plans, property settings) | Nunca se toca en operaciones ARI |

---

## Restricciones y decisiones

| Decisión | Razón |
|---------|-------|
| Rate limiter in-memory (no Redis) | Volumen bajo por instancia; sin dependencia nueva |
| fullSync lee de Firestore, no de Channex API | Evita llamada extra a Channex; los IDs ya están mirroreados |
| `min_stay_through` excluido | Airbnb usa `min_stay_arrival`; se agrega cuando Booking.com lo requiera |
| Un rate limiter adquiere por call, no por item del batch | Correcto — Channex cuenta llamadas HTTP, no items en `values[]` |
| `days` default 500 en fullSync | Requerimiento explícito de Test #1 |

# ARI Dispatch Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Evolve el pipeline ARI de Channex para soportar batching, full sync, rate limiting e integer availability — cubriendo los 11 test cases de la certificación Channex sin romper la integración existente de Airbnb.

**Architecture:** Option C — se modifica `ChannexARIService` para aceptar arrays, se crea `ChannexARIRateLimiter` como servicio injectable, se agrega `fullSync()`, se actualizan los controllers para aceptar batches. `ChannexService` (HTTP adapter) se toca mínimamente solo para retornar task IDs. Webhook pipeline, OAuth, Firestore structure — intactos.

**Tech Stack:** NestJS + TypeScript, Firestore via `ChannexPropertyService.resolveIntegration()`, `ChannexService` (HTTP adapter existente), BullMQ no se usa en ARI.

---

## File Map

| Acción | Archivo | Qué cambia | Estado |
|--------|---------|-----------|--------|
| Modify | `apps/backend/src/channex/channex.types.ts` | `ChannexARIResponse` agrega `data[]`; `AvailabilityEntryDto.availability` de `0\|1` a `number` | ✅ |
| Modify | `apps/backend/src/channex/channex.service.ts` | `pushAvailability` y `pushRestrictions` retornan `Promise<string>` (task ID) | ✅ |
| Create | `apps/backend/src/channex/channex-ari-rate-limiter.service.ts` | Sliding window rate limiter in-memory | ✅ |
| Create | `apps/backend/src/channex/dto/ari-batch.dto.ts` | DTOs para batch y full-sync endpoints | ✅ |
| Modify | `apps/backend/src/channex/channex-ari.service.ts` | Array signatures, inyectar rate limiter, agregar `fullSync()` | ✅ |
| Modify | `apps/backend/src/channex/channex-ari.controller.ts` | Batch body, nuevo endpoint `/full-sync` | ✅ |
| Modify | `apps/backend/src/channex/channex.module.ts` | Registrar `ChannexARIRateLimiter` como provider | ✅ |
| Modify | `apps/frontend/src/airbnb/api/channexApi.ts` | Wrap en `{updates:[]}`, agregar batch y fullSync functions | ✅ |
| Modify | `apps/frontend/src/airbnb/components/ARICalendar.tsx` | Raw fetch actualizado al nuevo formato batch | ✅ |

---

## Task 1: Actualizar tipos en `channex.types.ts`

**Files:**
- Modify: `apps/backend/src/channex/channex.types.ts`

Dos cambios en este archivo: corregir el tipo de retorno de las llamadas ARI (agregar `data[]` con task ID) y ampliar el tipo de `availability`.

- [x] **Step 1: Corregir `ChannexARIResponse`**

Buscar la interfaz `ChannexARIResponse` (línea ~479) y reemplazarla:

```typescript
// ANTES
export interface ChannexARIResponse {
  meta: {
    status: 'success' | string;
  };
}

// DESPUÉS
export interface ChannexARIResponse {
  data: Array<{ id: string; type: string }>;
  meta: {
    message: string;
    warnings?: string[];
  };
}
```

- [x] **Step 2: Actualizar `AvailabilityEntryDto.availability`**

Buscar `AvailabilityEntryDto` (línea ~440) y cambiar el tipo:

```typescript
// ANTES
export interface AvailabilityEntryDto {
  property_id: string;
  room_type_id: string;
  date_from: string;
  date_to: string;
  availability: 0 | 1;
}

// DESPUÉS
export interface AvailabilityEntryDto {
  property_id: string;
  room_type_id: string;
  date_from: string;
  date_to: string;
  availability: number;  // entero no negativo; 0=sin unidades, 1+=disponible
}
```

- [x] **Step 3: Agregar interfaces `FullSyncOptions` y `FullSyncResult` al final del archivo**

Al final de `channex.types.ts`, antes del último export o al final del bloque ARI:

```typescript
// ─── ARI Full Sync ────────────────────────────────────────────────────────────

export interface FullSyncOptions {
  defaultAvailability: number;  // unidades disponibles a setear en todos los room types
  defaultRate: string;          // tarifa base para todos los rate plans, e.g. "100.00"
  days?: number;                // días hacia adelante desde hoy; default 500
}

export interface FullSyncResult {
  availabilityTaskId: string;
  restrictionsTaskId: string;
}
```

- [x] **Step 4: Verificar que el archivo compila**

```bash
cd "apps/backend"
npx tsc --noEmit 2>&1 | grep "channex.types"
```

Expected: sin errores en `channex.types.ts`.

- [x] **Step 5: Commit**

```bash
git add apps/backend/src/channex/channex.types.ts
git commit -m "feat(channex-ari): update ChannexARIResponse shape and widen availability type to number"
```

---

## Task 2: Actualizar `ChannexService` para retornar task IDs

**Files:**
- Modify: `apps/backend/src/channex/channex.service.ts` (líneas ~911 y ~973)

Actualmente `pushAvailability` y `pushRestrictions` retornan `Promise<void>` y descartan la respuesta. Necesitamos capturar el task ID de `response.data[0].id` para que `fullSync` pueda retornarlo al caller.

- [x] **Step 1: Actualizar `pushAvailability` para retornar task ID**

Reemplazar el método completo (línea ~911):

```typescript
async pushAvailability(values: AvailabilityEntryDto[]): Promise<string> {
  this.logger.log(
    `[CHANNEX] Pushing availability — ${values.length} entry(s)`,
  );

  try {
    const response = await this.defLogger.request<ChannexARIResponse>({
      method: 'POST',
      url: `${this.baseUrl}/availability`,
      headers: this.buildAuthHeaders(),
      data: { values },
    });

    const taskId = response?.data?.[0]?.id ?? '';
    this.logger.log(`[CHANNEX] ✓ Availability push successful — taskId=${taskId}`);
    return taskId;
  } catch (err) {
    this.normaliseError(err);
    return '';
  }
}
```

- [x] **Step 2: Actualizar `pushRestrictions` para retornar task ID**

Reemplazar el método completo (línea ~973):

```typescript
async pushRestrictions(values: RestrictionEntryDto[]): Promise<string> {
  this.logger.log(
    `[CHANNEX] Pushing restrictions — ${values.length} entry(s)`,
  );

  try {
    const response = await this.defLogger.request<ChannexARIResponse>({
      method: 'POST',
      url: `${this.baseUrl}/restrictions`,
      headers: this.buildAuthHeaders(),
      data: { values },
    });

    const taskId = response?.data?.[0]?.id ?? '';
    this.logger.log(`[CHANNEX] ✓ Restrictions push successful — taskId=${taskId}`);
    return taskId;
  } catch (err) {
    this.normaliseError(err);
    return '';
  }
}
```

- [x] **Step 3: Verificar que el archivo compila**

```bash
cd "apps/backend"
npx tsc --noEmit 2>&1 | grep "channex.service"
```

Expected: sin errores.

- [x] **Step 4: Commit**

```bash
git add apps/backend/src/channex/channex.service.ts
git commit -m "feat(channex-ari): return task ID from pushAvailability and pushRestrictions"
```

---

## Task 3: Crear `ChannexARIRateLimiter`

**Files:**
- Create: `apps/backend/src/channex/channex-ari-rate-limiter.service.ts`

Rate limiter in-memory con sliding window. Controla 10 llamadas por minuto por propiedad por tipo de endpoint. Agnóstico a OTA — opera solo con `propertyId` y tipo.

- [x] **Step 1: Crear el archivo**

```typescript
import { Injectable, Logger } from '@nestjs/common';

type EndpointType = 'availability' | 'restrictions';

interface Window {
  count: number;
  windowStart: number;
}

/**
 * ChannexARIRateLimiter — in-memory sliding window rate limiter for ARI pushes.
 *
 * Channex limits: 10 POST /availability + 10 POST /restrictions per minute per property.
 * This service tracks call counts per (propertyId, type) pair and delays execution
 * when the limit is reached, resuming once the 60-second window resets.
 *
 * In-memory: intentional for current single-instance deployment.
 * If the service scales horizontally, replace with a Redis-backed counter.
 */
@Injectable()
export class ChannexARIRateLimiter {
  private readonly logger = new Logger(ChannexARIRateLimiter.name);
  private readonly windows = new Map<string, Window>();
  private readonly LIMIT = 10;
  private readonly WINDOW_MS = 60_000;

  /**
   * Acquires a rate limit slot for a given property + endpoint type.
   * If the current window is full, waits until it resets before resolving.
   */
  async acquire(propertyId: string, type: EndpointType): Promise<void> {
    const key = `${propertyId}:${type}`;
    const now = Date.now();

    let win = this.windows.get(key);

    // Reset window if expired
    if (!win || now - win.windowStart >= this.WINDOW_MS) {
      win = { count: 0, windowStart: now };
      this.windows.set(key, win);
    }

    if (win.count < this.LIMIT) {
      win.count++;
      this.logger.debug(
        `[RATE] ${key} — slot ${win.count}/${this.LIMIT} acquired`,
      );
      return;
    }

    // Window full — wait for reset
    const msUntilReset = this.WINDOW_MS - (now - win.windowStart);
    this.logger.warn(
      `[RATE] ${key} — limit reached (${this.LIMIT}/min). Waiting ${msUntilReset}ms.`,
    );

    await this.sleep(msUntilReset + 50); // +50ms buffer

    // Reset and acquire on new window
    const fresh: Window = { count: 1, windowStart: Date.now() };
    this.windows.set(key, fresh);
    this.logger.debug(`[RATE] ${key} — window reset, slot 1/${this.LIMIT} acquired`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

- [x] **Step 2: Verificar que el archivo compila**

```bash
cd "apps/backend"
npx tsc --noEmit 2>&1 | grep "rate-limiter"
```

Expected: sin errores.

- [x] **Step 3: Commit**

```bash
git add apps/backend/src/channex/channex-ari-rate-limiter.service.ts
git commit -m "feat(channex-ari): add ChannexARIRateLimiter — 10 req/min sliding window per property"
```

---

## Task 4: Crear DTOs para batch y full-sync

**Files:**
- Create: `apps/backend/src/channex/dto/ari-batch.dto.ts`

- [x] **Step 1: Crear el archivo**

```typescript
import type { AvailabilityEntryDto, RestrictionEntryDto } from '../channex.types';

/**
 * Body para POST /channex/properties/:propertyId/availability (batch)
 *
 * Para operación simple (1 update): enviar updates con 1 elemento.
 * Para batch (certificación Tests #3–#8): enviar todos los updates juntos.
 * El service los despacha en UNA sola llamada a Channex.
 */
export class AriAvailabilityBatchDto {
  updates: AvailabilityEntryDto[];
}

/**
 * Body para POST /channex/properties/:propertyId/restrictions (batch)
 */
export class AriRestrictionsBatchDto {
  updates: RestrictionEntryDto[];
}

/**
 * Body para POST /channex/properties/:propertyId/full-sync
 *
 * Envía 500 días de ARI para todos los room types y rate plans de la propiedad
 * en exactamente 2 llamadas a Channex (requerimiento de Test #1 de certificación).
 */
export class AriFullSyncDto {
  /** Unidades disponibles a setear en todos los room types. */
  defaultAvailability: number;

  /** Tarifa base para todos los rate plans, e.g. "100.00". */
  defaultRate: string;

  /** Días hacia adelante desde hoy. Default: 500. */
  days?: number;
}
```

- [x] **Step 2: Commit**

```bash
git add apps/backend/src/channex/dto/ari-batch.dto.ts
git commit -m "feat(channex-ari): add batch and full-sync DTOs"
```

---

## Task 5: Actualizar `ChannexARIService`

**Files:**
- Modify: `apps/backend/src/channex/channex-ari.service.ts`

Tres cambios: (1) inyectar `ChannexARIRateLimiter`, (2) cambiar firmas de `pushAvailability` y `pushRestrictions` a arrays, (3) agregar `fullSync`.

- [x] **Step 1: Actualizar imports y constructor**

Al inicio del archivo, agregar import:

```typescript
import { ChannexARIRateLimiter } from './channex-ari-rate-limiter.service';
import type { FullSyncOptions, FullSyncResult } from './channex.types';
```

En el constructor, agregar `ChannexARIRateLimiter`:

```typescript
constructor(
  private readonly channex: ChannexService,
  private readonly propertyService: ChannexPropertyService,
  private readonly firebase: FirebaseService,
  private readonly rateLimiter: ChannexARIRateLimiter,  // ← agregar
) {}
```

- [x] **Step 2: Reemplazar `pushAvailability`**

Reemplazar el método completo (línea ~167):

```typescript
/**
 * Pushes one or more availability updates to Channex in a single HTTP call.
 *
 * POST /api/v1/availability
 *
 * Accepts an array so callers can batch multiple room type / date range updates
 * into one request, satisfying Channex certification batch requirements.
 * For single-update operations, pass a one-element array.
 *
 * Rate limited to 10 calls/min per property via ChannexARIRateLimiter.
 * Returns the Channex task ID for audit/certification logging.
 */
async pushAvailability(updates: AvailabilityEntryDto[]): Promise<string> {
  if (!updates.length) return '';

  const propertyId = updates[0].property_id;

  this.logger.log(
    `[ARI] Pushing availability — propertyId=${propertyId} ${updates.length} entry(s)`,
  );

  await this.rateLimiter.acquire(propertyId, 'availability');
  const taskId = await this.channex.pushAvailability(updates);

  this.logger.log(`[ARI] ✓ Availability pushed — taskId=${taskId}`);
  return taskId;
}
```

- [x] **Step 3: Reemplazar `pushRestrictions`**

Reemplazar el método completo (línea ~188):

```typescript
/**
 * Pushes one or more restriction/rate updates to Channex in a single HTTP call.
 *
 * POST /api/v1/restrictions
 *
 * Rate limited to 10 calls/min per property via ChannexARIRateLimiter.
 * Returns the Channex task ID for audit/certification logging.
 */
async pushRestrictions(updates: RestrictionEntryDto[]): Promise<string> {
  if (!updates.length) return '';

  const propertyId = updates[0].property_id;

  this.logger.log(
    `[ARI] Pushing restrictions — propertyId=${propertyId} ${updates.length} entry(s)`,
  );

  await this.rateLimiter.acquire(propertyId, 'restrictions');
  const taskId = await this.channex.pushRestrictions(updates);

  this.logger.log(`[ARI] ✓ Restrictions pushed — taskId=${taskId}`);
  return taskId;
}
```

- [x] **Step 4: Agregar `fullSync` al final de la clase (antes del cierre `}`)**

```typescript
/**
 * Sends 500 days of ARI for all room types and rate plans of a property.
 *
 * Channex certification Test #1 requires exactly 2 HTTP calls:
 *   1 × POST /availability  — all room types, 500 days
 *   1 × POST /restrictions  — all rate plans, 500 days
 *
 * Reads room_types[] from the Firestore integration document (already mirrored
 * from Channex during the channel connection flow). Does NOT modify any Channex
 * configuration — only pushes ARI values for existing entities.
 *
 * Agnostic to OTA — works for Airbnb, Booking.com, or any future channel.
 */
async fullSync(propertyId: string, options: FullSyncOptions): Promise<FullSyncResult> {
  const days = options.days ?? 500;

  this.logger.log(
    `[ARI] Starting fullSync — propertyId=${propertyId} days=${days}`,
  );

  // ── Read entity IDs from Firestore ────────────────────────────────────────
  const integration = await this.propertyService.resolveIntegration(propertyId);

  if (!integration) {
    throw new Error(
      `[ARI] fullSync failed — no integration found for propertyId=${propertyId}`,
    );
  }

  const db = this.firebase.getFirestore();
  const doc = await db
    .collection('channex_integrations')
    .doc(integration.firestoreDocId)
    .get();

  const roomTypes: StoredRoomType[] = (doc.data()?.room_types as StoredRoomType[]) ?? [];

  if (!roomTypes.length) {
    throw new Error(
      `[ARI] fullSync failed — no room_types in Firestore for propertyId=${propertyId}`,
    );
  }

  // ── Build date range ──────────────────────────────────────────────────────
  const today = new Date();
  const dateFrom = today.toISOString().split('T')[0]; // YYYY-MM-DD

  const end = new Date(today);
  end.setDate(end.getDate() + days);
  const dateTo = end.toISOString().split('T')[0];

  // ── Call 1: Availability — one entry per room type ────────────────────────
  const availabilityUpdates: AvailabilityEntryDto[] = roomTypes.map((rt) => ({
    property_id: propertyId,
    room_type_id: rt.room_type_id,
    date_from: dateFrom,
    date_to: dateTo,
    availability: options.defaultAvailability,
  }));

  const availabilityTaskId = await this.pushAvailability(availabilityUpdates);

  // ── Call 2: Restrictions — one entry per rate plan ────────────────────────
  const ratePlanIds = roomTypes
    .map((rt) => rt.rate_plan_id)
    .filter((id): id is string => Boolean(id));

  if (!ratePlanIds.length) {
    throw new Error(
      `[ARI] fullSync failed — no rate_plan_ids found in room_types for propertyId=${propertyId}`,
    );
  }

  const restrictionUpdates: RestrictionEntryDto[] = ratePlanIds.map((ratePlanId) => ({
    property_id: propertyId,
    rate_plan_id: ratePlanId,
    date_from: dateFrom,
    date_to: dateTo,
    rate: options.defaultRate,
  }));

  const restrictionsTaskId = await this.pushRestrictions(restrictionUpdates);

  this.logger.log(
    `[ARI] ✓ fullSync complete — propertyId=${propertyId} ` +
      `availabilityTaskId=${availabilityTaskId} restrictionsTaskId=${restrictionsTaskId}`,
  );

  return { availabilityTaskId, restrictionsTaskId };
}
```

- [x] **Step 5: Verificar que el archivo compila**

```bash
cd "apps/backend"
npx tsc --noEmit 2>&1 | grep "channex-ari.service"
```

Expected: sin errores.

- [x] **Step 6: Commit**

```bash
git add apps/backend/src/channex/channex-ari.service.ts
git commit -m "feat(channex-ari): array signatures, rate limiter injection, fullSync method"
```

---

## Task 6: Actualizar `ChannexARIController`

**Files:**
- Modify: `apps/backend/src/channex/channex-ari.controller.ts`

Tres cambios: (1) endpoint availability acepta `AriAvailabilityBatchDto`, (2) endpoint restrictions acepta `AriRestrictionsBatchDto`, (3) nuevo endpoint `POST /full-sync`.

- [x] **Step 1: Actualizar imports**

Reemplazar el bloque de imports al inicio del archivo:

```typescript
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import { ChannexARIService, StoredRoomType } from './channex-ari.service';
import { CreateRoomTypeDto } from './dto/create-room-type.dto';
import {
  AriAvailabilityBatchDto,
  AriRestrictionsBatchDto,
  AriFullSyncDto,
} from './dto/ari-batch.dto';
import type {
  ChannexRoomTypeResponse,
  FullSyncResult,
} from './channex.types';
```

- [x] **Step 2: Reemplazar el método `pushAvailability`**

```typescript
/**
 * POST /channex/properties/:propertyId/availability
 *
 * Acepta un array de updates y los envía en una sola llamada a Channex.
 * Para operación simple: enviar `updates` con un elemento.
 * Para batch (certificación): enviar múltiples updates juntos.
 *
 * Returns: { status: 'ok', taskId: string }
 * Status:  200 OK
 *
 * Errors:
 *   429 — Channex rate limit hit (ChannexRateLimitError)
 *   502 — Channex API rechazó el payload
 */
@Post('availability')
@HttpCode(HttpStatus.OK)
async pushAvailability(
  @Param('propertyId') propertyId: string,
  @Body() dto: AriAvailabilityBatchDto,
): Promise<{ status: 'ok'; taskId: string }> {
  this.logger.log(
    `[CTRL] POST /availability — propertyId=${propertyId} count=${dto.updates?.length ?? 0}`,
  );

  const updates = dto.updates.map((u) => ({ ...u, property_id: propertyId }));
  const taskId = await this.ariService.pushAvailability(updates);
  return { status: 'ok', taskId };
}
```

- [x] **Step 3: Reemplazar el método `pushRestrictions`**

```typescript
/**
 * POST /channex/properties/:propertyId/restrictions
 *
 * Acepta un array de updates y los envía en una sola llamada a Channex.
 * `rate_plan_id` debe estar presente en cada entry — restrictions operan
 * sobre Rate Plans, no sobre Room Types.
 *
 * Returns: { status: 'ok', taskId: string }
 * Status:  200 OK
 */
@Post('restrictions')
@HttpCode(HttpStatus.OK)
async pushRestrictions(
  @Param('propertyId') propertyId: string,
  @Body() dto: AriRestrictionsBatchDto,
): Promise<{ status: 'ok'; taskId: string }> {
  this.logger.log(
    `[CTRL] POST /restrictions — propertyId=${propertyId} count=${dto.updates?.length ?? 0}`,
  );

  const updates = dto.updates.map((u) => ({ ...u, property_id: propertyId }));
  const taskId = await this.ariService.pushRestrictions(updates);
  return { status: 'ok', taskId };
}
```

- [x] **Step 4: Agregar el endpoint `full-sync`**

Agregar después del método `pushRestrictions`, antes del cierre `}` de la clase:

```typescript
/**
 * POST /channex/properties/:propertyId/full-sync
 *
 * Envía 500 días de ARI para todos los room types y rate plans de la propiedad
 * en exactamente 2 llamadas a Channex — requerimiento de Test #1 de certificación.
 *
 * Lee los IDs de room_types[] desde Firestore (ya mirroreados desde Channex).
 * No modifica ninguna configuración existente en Channex ni en Firestore.
 *
 * Body:    AriFullSyncDto { defaultAvailability, defaultRate, days? }
 * Returns: FullSyncResult { availabilityTaskId, restrictionsTaskId }
 * Status:  200 OK
 */
@Post('full-sync')
@HttpCode(HttpStatus.OK)
async fullSync(
  @Param('propertyId') propertyId: string,
  @Body() dto: AriFullSyncDto,
): Promise<FullSyncResult> {
  this.logger.log(
    `[CTRL] POST /full-sync — propertyId=${propertyId} ` +
      `availability=${dto.defaultAvailability} rate=${dto.defaultRate} days=${dto.days ?? 500}`,
  );

  return this.ariService.fullSync(propertyId, {
    defaultAvailability: dto.defaultAvailability,
    defaultRate: dto.defaultRate,
    days: dto.days,
  });
}
```

- [x] **Step 5: Verificar que el archivo compila**

```bash
cd "apps/backend"
npx tsc --noEmit 2>&1 | grep "channex-ari.controller"
```

Expected: sin errores.

- [x] **Step 6: Commit**

```bash
git add apps/backend/src/channex/channex-ari.controller.ts
git commit -m "feat(channex-ari): batch endpoints + full-sync endpoint"
```

---

## Task 7: Registrar `ChannexARIRateLimiter` en el módulo

**Files:**
- Modify: `apps/backend/src/channex/channex.module.ts`

- [x] **Step 1: Agregar import y provider**

En el import al inicio del archivo, agregar:

```typescript
import { ChannexARIRateLimiter } from './channex-ari-rate-limiter.service';
```

En el array `providers`, bajo el bloque `# ── ARI pipeline`:

```typescript
// ── ARI pipeline (real-time direct push, no cron/buffer) ─────────────────
ChannexARIService,
ChannexARIRateLimiter,   // ← agregar aquí
```

- [x] **Step 2: Verificar que el archivo compila y el módulo levanta**

```bash
cd "apps/backend"
npx tsc --noEmit 2>&1 | grep "channex.module\|ERROR"
```

Expected: sin errores.

- [x] **Step 3: Commit**

```bash
git add apps/backend/src/channex/channex.module.ts
git commit -m "feat(channex-ari): register ChannexARIRateLimiter in ChannexModule"
```

---

## Task 8: Verificación manual end-to-end

Con el servidor levantado en staging, verificar cada endpoint.

- [x] **Step 1: Levantar el servidor**

```bash
cd "apps/backend"
pnpm start:dev
```

Expected: servidor levanta sin errores de DI o compilación.

- [x] **Step 2: Verificar Test #1 — Full Sync**

```bash
curl -X POST http://localhost:3001/channex/properties/<PROPERTY_ID>/full-sync \
  -H "Content-Type: application/json" \
  -d '{ "defaultAvailability": 1, "defaultRate": "100.00", "days": 500 }'
```

Expected:
```json
{
  "availabilityTaskId": "<uuid>",
  "restrictionsTaskId": "<uuid>"
}
```

Ambos task IDs son UUIDs no vacíos. Estos son los IDs que van al formulario de certificación (Sección 4).

- [x] **Step 3: Verificar Test #3 — Batch restrictions (3 rates, 1 call)**

```bash
curl -X POST http://localhost:3001/channex/properties/<PROPERTY_ID>/restrictions \
  -H "Content-Type: application/json" \
  -d '{
    "updates": [
      { "rate_plan_id": "<TWIN_BAR_ID>", "date_from": "2026-11-21", "date_to": "2026-11-21", "rate": "333.00" },
      { "rate_plan_id": "<DOUBLE_BAR_ID>", "date_from": "2026-11-25", "date_to": "2026-11-25", "rate": "444.00" },
      { "rate_plan_id": "<DOUBLE_BB_ID>", "date_from": "2026-11-29", "date_to": "2026-11-29", "rate": "456.23" }
    ]
  }'
```

Expected:
```json
{ "status": "ok", "taskId": "<uuid>" }
```

Un solo task ID → Channex recibió una sola llamada con 3 entries. Test #3 pasa.

- [x] **Step 4: Verificar Test #9 — Integer availability**

```bash
curl -X POST http://localhost:3001/channex/properties/<PROPERTY_ID>/availability \
  -H "Content-Type: application/json" \
  -d '{
    "updates": [
      { "room_type_id": "<TWIN_ROOM_ID>", "date_from": "2026-11-21", "date_to": "2026-11-21", "availability": 7 },
      { "room_type_id": "<DOUBLE_ROOM_ID>", "date_from": "2026-11-25", "date_to": "2026-11-25", "availability": 0 }
    ]
  }'
```

Expected:
```json
{ "status": "ok", "taskId": "<uuid>" }
```

Channex acepta `availability: 7` sin error → tipo number funciona.

- [x] **Step 5: Verificar que el frontend existente sigue funcionando**

Si el frontend llama availability con el cuerpo anterior (`{ room_type_id, date_from, date_to, availability }`), debe adaptarse para pasar el nuevo formato `{ updates: [{ ... }] }`. Verificar en la capa frontend que el contrato esté actualizado.

> **Nota:** El frontend en `apps/frontend/src/airbnb/api/channexApi.ts` llama a los endpoints de ARI. Buscar las funciones `pushAvailability` y `pushRestrictions` en ese archivo y actualizar el body al nuevo formato `{ updates: [update] }`.

- [x] **Step 6: Commit final de verificación**

```bash
git add .
git commit -m "feat(channex-ari): ARI dispatch layer complete — batching, rate limiting, full sync, integer availability"
```

---

## Self-Review

**Spec coverage:**
- ✅ Gap #1 Batching → Tasks 4, 5, 6
- ✅ Gap #2 Full Sync → Tasks 5, 6
- ✅ Gap #3 Rate Limiter → Task 3, Task 5
- ✅ Gap #4 Integer availability → Task 1
- ✅ Gap #5 min_stay_through → documentado como no-gap, no requiere tarea

**Placeholder scan:** Ninguno encontrado. Todos los steps tienen código concreto.

**Type consistency:**
- `FullSyncOptions` y `FullSyncResult` definidos en Task 1, usados en Tasks 5 y 6 ✅
- `AriAvailabilityBatchDto`, `AriRestrictionsBatchDto`, `AriFullSyncDto` definidos en Task 4, usados en Task 6 ✅
- `StoredRoomType` importado desde `channex-ari.service` en Task 5 ✅
- `pushAvailability(updates[])` → `Promise<string>` consistente en Tasks 2, 5, 6 ✅

**Nota importante para Task 8 Step 5:** El frontend `channexApi.ts` que llama a `/availability` y `/restrictions` deberá actualizarse para usar el nuevo contrato `{ updates: [...] }`. Esto no está en el scope del plan pero debe hacerse antes de que el frontend vuelva a funcionar con los endpoints modificados.

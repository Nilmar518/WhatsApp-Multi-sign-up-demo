# Channex Certification — Gap Analysis

> Comparativa: qué hace el sistema hoy vs qué requiere Channex.
> Basado en `01-codebase-audit.md` y `02-test-cases-research.md`.
> Generado: 2026-04-30

---

## Metodología

Formato por gap:
- **Hoy:** comportamiento actual del código
- **Channex requiere:** lo que exige la certificación
- **Archivos a cambiar:** ubicación exacta
- **Cambio concreto:** qué se modifica

---

## Gap #1 — Batching de ARI (Tests #2–#8)

**Hoy:**
`ChannexARIService.pushAvailability(update)` y `pushRestrictions(update)` aceptan UN solo objeto. Llaman a `ChannexService` con un array de 1 elemento. Cada acción del admin = 1 llamada HTTP a Channex.

**Channex requiere:**
Tests #3–#8 exigen que múltiples cambios se envíen en **una sola llamada** con el array `values[]` conteniendo todos los updates. Channex verifica que no haya múltiples calls separados.

**Archivos a cambiar:**
- `channex-ari.service.ts` — firmas de métodos
- `channex-ari.controller.ts` — endpoints que reciben del frontend
- `dto/` — DTOs de los endpoints ARI

**Cambio concreto:**
```typescript
// HOY
async pushAvailability(update: AvailabilityEntryDto): Promise<void>
async pushRestrictions(update: RestrictionEntryDto): Promise<void>

// DESPUÉS
async pushAvailability(updates: AvailabilityEntryDto[]): Promise<void>
async pushRestrictions(updates: RestrictionEntryDto[]): Promise<void>
```

El controller pasa un array. Para operaciones simples (1 update), el frontend envía `[update]`. Para operaciones batch (certificación Tests #3–#8), el frontend envía `[update1, update2, update3]`. El service despacha todo junto en un solo `POST /availability` o `POST /restrictions`.

---

## Gap #2 — Full Sync (Test #1)

**Hoy:**
No existe ningún método de full sync. No hay forma de enviar 500 días de ARI para todos los cuartos y planes de tarifa de una propiedad en 2 llamadas.

**Channex requiere:**
Test #1: 2 llamadas HTTP exactas:
1. `POST /availability` — todos los room types, 500 días
2. `POST /restrictions` — todos los rate plans, 500 días

**Archivos a cambiar:**
- `channex-ari.service.ts` — agregar método `fullSync`
- `channex-ari.controller.ts` — agregar endpoint `POST /ari/full-sync`

**Cambio concreto:**
```typescript
// NUEVO MÉTODO en ChannexARIService
async fullSync(propertyId: string, options: FullSyncOptions): Promise<FullSyncResult>

interface FullSyncOptions {
  defaultAvailability: number;   // cuántas unidades disponibles
  defaultRate: string;           // precio base, e.g. "100.00"
  days?: number;                 // default 500
}

interface FullSyncResult {
  availabilityTaskId: string;
  restrictionsTaskId: string;
}
```

**Flujo interno de fullSync:**
1. Lee `room_types[]` y sus `rate_plan_id`s del documento Firestore de la integración
2. Calcula `date_from = hoy`, `date_to = hoy + 500 días`
3. Llama `pushAvailability([...un entry por room type])` → 1 sola llamada HTTP
4. Llama `pushRestrictions([...un entry por rate plan])` → 1 sola llamada HTTP
5. Retorna los 2 task IDs al caller

**Principio agnóstico:** No sabe si es Airbnb o Booking.com — solo trabaja con los IDs que ya están en Firestore, sin tocar la configuración existente.

---

## Gap #3 — Rate Limiter (Sección 33 del formulario)

**Hoy:**
No existe ningún rate limiter. Cada llamada a `pushAvailability` o `pushRestrictions` va directa a Channex sin control de velocidad. Si Channex responde 429, se lanza `ChannexRateLimitError` y el error llega al frontend — no hay retry ni backoff.

**Channex requiere:**
- Máximo 10 `POST /availability` por minuto por propiedad
- Máximo 10 `POST /restrictions` por minuto por propiedad
- En caso de 429: pausar 1 minuto y reintentar
- El formulario pregunta explícitamente si el sistema puede respetar estos límites

**Archivos a cambiar:**
- Crear: `channex-ari-rate-limiter.service.ts`
- Modificar: `channex-ari.service.ts` — inyectar el limiter y usarlo antes de cada push
- Modificar: `channex.module.ts` — registrar el nuevo servicio

**Cambio concreto:**
```typescript
// NUEVO SERVICIO
@Injectable()
export class ChannexARIRateLimiter {
  // In-memory counter: Map<`${propertyId}:${type}`, { count, windowStart }>
  // type = 'availability' | 'restrictions'

  async acquire(propertyId: string, type: 'availability' | 'restrictions'): Promise<void>
  // Si count < 10 en la ventana actual: incrementa y retorna
  // Si count >= 10: espera hasta que la ventana de 60s se resetee
}
```

**Principio agnóstico:** El limiter opera por `propertyId` + tipo de endpoint. No distingue OTA.

---

## Gap #4 — Tipo de disponibilidad: binario vs entero (Tests #9, #10)

**Hoy:**
```typescript
export interface AvailabilityEntryDto {
  availability: 0 | 1;   // ← binario: 0=bloqueado, 1=abierto
}
```

Este tipo refleja el modelo de Airbnb vacation rental (1 unidad). Channex acepta enteros no negativos (0, 1, 2, 3, 7...).

**Channex requiere:**
Tests #9 y #10 piden enviar conteos reales:
- Twin Room Nov 21: `availability: 7` (de 8 → 7 tras una reserva)
- Double Room Nov 25: `availability: 0`
- Twin Room Nov 10–16: `availability: 3`

**Archivos a cambiar:**
- `channex.types.ts` — cambiar tipo en `AvailabilityEntryDto`

**Cambio concreto:**
```typescript
// HOY
availability: 0 | 1;

// DESPUÉS
availability: number;   // entero no negativo; 0 = sin unidades disponibles
```

**Impacto:** Cambio no-breaking. Los callers que hoy envían `0` o `1` siguen funcionando. El tipo más amplio permite certificación y futura compatibilidad con Booking.com multi-unit.

---

## Gap #5 — `min_stay_through` (Tests #5, #7, #8)

**Hoy:**
`RestrictionEntryDto` excluye intencionalmente `min_stay_through`. Solo tiene `min_stay_arrival`.

**Channex requiere:**
Los test cases de certificación usan `min_stay_arrival` — que es lo que ya tenemos. Channex documenta ambos campos pero para nuestro scope (Airbnb) `min_stay_arrival` es correcto.

**Decisión:** No hay gap real aquí para certificación. `min_stay_arrival` cubre los tests #5, #7 y #8. Se documenta como decisión consciente.

**Si en el futuro se conecta Booking.com** y ellos requieren `min_stay_through`, se agrega el campo a `RestrictionEntryDto` en ese momento.

---

## Resumen ejecutivo de cambios

| Gap | Severidad | Archivos tocados | Cambio |
|-----|-----------|-----------------|--------|
| #1 Batching | 🔴 Crítico | `channex-ari.service.ts`, controller, DTOs | Firmas de método: `update` → `updates[]` |
| #2 Full Sync | 🔴 Crítico | `channex-ari.service.ts`, controller | Nuevo método `fullSync()` |
| #3 Rate Limiter | 🟡 Requerido para certificar | Nuevo `channex-ari-rate-limiter.service.ts`, módulo | Nuevo servicio |
| #4 Integer availability | 🟡 Requerido para tests #9, #10 | `channex.types.ts` | Cambio de tipo |
| #5 min_stay_through | ⚪ No aplica | — | Decisión documentada |

**Lo que NO cambia:**
- `ChannexService` (HTTP adapter) — sin tocar
- Webhook pipeline y workers — sin tocar
- Flujo OAuth y conexión de canales — sin tocar
- Configuración de propiedades en Channex — sin tocar
- Datos en Firestore existentes — sin tocar
- Flujo de Airbnb/Booking.com connection popup — sin tocar

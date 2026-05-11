# Channex PMS Certification — Plan de Acción

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completar la certificación PMS de Channex documentando el estado actual de la integración, fetcheando la documentación técnica de cada test case, identificando gaps, ejecutando los tests contra el sandbox de Channex, y generando las respuestas listas para el formulario de certificación.

**Architecture:** Flujo de 5 fases secuenciales. Las Fases 1-3 son puras investigación/documentación (sin credenciales). La Fase 4 requiere `CHANNEX_API_KEY` y una propiedad de prueba en staging. La Fase 5 consolida todo en respuestas finales. Cada fase produce un `.md` como artefacto persistente.

**Tech Stack:** Node.js 18+ (scripts de extracción), NestJS/TypeScript (aplicación existente), Channex Staging API (`https://staging.channex.io/api/v1`), Firestore (almacenamiento de estado).

---

## Contexto de la Conversación

Esta documentación fue generada a partir de una sesión en Claude Code el 2026-04-30. El formulario de certificación fue extraído con el script `booking-skills/src/form-extractor.js` usando la técnica `FB_PUBLIC_LOAD_DATA_` y mapeado a Markdown con `booking-skills/src/form-mapper.js`.

**Formulario original:** https://docs.google.com/forms/d/e/1FAIpQLSeYvdsAglcIj0MEE7AhN1bv-UK1K-ss7NX06nU5DyuwiwU0dA/viewform

**Form mapeado:** `booking-skills/output/form-2026-04-30.md`

---

## Estructura de archivos que genera este plan

```
docs/channex/
  01-codebase-audit.md        ← Fase 1: qué hay implementado vs qué pide Channex
  02-test-cases-research.md   ← Fase 2: qué hace cada test case (desde docs.channex.io)
  03-gap-analysis.md          ← Fase 3: qué falta o está en riesgo para certificar
  04-test-results.md          ← Fase 4: IDs devueltos por Channex al ejecutar cada test
  05-certification-answers.md ← Fase 5: respuestas listas para copiar/pegar en el form
```

---

## Fase 1 — Codebase Audit

**Objetivo:** Mapear completamente el módulo `apps/backend/src/channex/` contra los requisitos del formulario de certificación. Producir un documento que cualquier desarrollador pueda leer para entender qué está hecho, qué está en riesgo y qué está ausente.

### Task 1: Escribir `docs/channex/01-codebase-audit.md`

**Files:**
- Create: `docs/channex/01-codebase-audit.md`

- [ ] **Step 1: Crear el audit document con el mapeo completo**

Crear `docs/channex/01-codebase-audit.md` con el siguiente contenido exacto (basado en el análisis del código leído en esta sesión):

```markdown
# Codebase Audit — Channex PMS Integration

**Fecha:** 2026-04-30
**Rama analizada:** main
**Directorio:** apps/backend/src/channex/

---

## Resumen ejecutivo

La integración con Channex está implementada como un módulo NestJS separado con
servicios bien delimitados. El módulo cubre la mayoría de los casos de certificación
de Channex, con dos áreas de riesgo identificadas (Rate Limits y Full Sync).

---

## Archivos del módulo Channex

| Archivo | Responsabilidad |
|---|---|
| `channex.service.ts` | Adaptador HTTP a Channex REST API — thin wrapper sin lógica de negocio |
| `channex-ari.service.ts` | Room Type CRUD + ARI push (availability/restrictions) en tiempo real |
| `channex-ari.controller.ts` | Endpoints: POST room-types, POST availability, POST restrictions |
| `channex-property.service.ts` | Provisioning y ciclo de vida de propiedades en Channex |
| `channex-property.controller.ts` | Endpoints de gestión de propiedades |
| `channex-sync.service.ts` | Auto-mapping: Stage/Review/Commit pipeline (Airbnb OAuth → Channex) |
| `channex-webhook.controller.ts` | Recibe webhooks de Channex → BullMQ queue |
| `channex-events.controller.ts` | SSE events para estado de conexión |
| `channex-oauth.service.ts` | One-time token + copy-link para iframe de OAuth |
| `channex-messaging-bridge.service.ts` | Bridge de mensajería Channex ↔ WhatsApp |
| `workers/channex-booking.worker.ts` | BullMQ consumer: procesa booking_new/modified/cancelled |
| `workers/channex-message.worker.ts` | BullMQ consumer: procesa mensajes de huéspedes |
| `channex.types.ts` | Tipos TypeScript de todos los payloads de Channex |
| `cron/` | Cron jobs (revisar contenido) |
| `dto/` | DTOs de validación para endpoints |
| `transformers/` | booking-revision.transformer.ts — Channex → Firestore schema |

---

## Mapeo contra requisitos del formulario de certificación

### Sección 1: PMS Functionality

| Pregunta del form | Estado | Evidencia en código |
|---|---|---|
| Multiple Room Types per Property | ✅ YES | `createRoomType()`, `getRoomTypes()`, `room_types[]` en Firestore |
| Multiple Rate Plans per Room Type | ✅ YES | `createRatePlan()`, `getRatePlans()` |
| Restrictions: Availability | ✅ YES | `pushAvailability()` → POST /availability |
| Restrictions: Rate | ✅ YES | `pushRestrictions()` con campo `rate` |
| Restrictions: Min Stay Through | ⚠️ VERIFICAR | `RestrictionEntryDto` necesita confirmar campo |
| Restrictions: Min Stay Arrival | ⚠️ VERIFICAR | `RestrictionEntryDto` necesita confirmar campo |
| Restrictions: Max Stay | ⚠️ VERIFICAR | `RestrictionEntryDto` necesita confirmar campo |
| Restrictions: Closed To Arrival | ⚠️ VERIFICAR | `RestrictionEntryDto` necesita confirmar campo |
| Restrictions: Closed To Departure | ⚠️ VERIFICAR | `RestrictionEntryDto` necesita confirmar campo |
| Restrictions: Stop Sell | ✅ YES | `ARIRestrictionPayload` tiene campo `stop_sell: boolean` |
| Credit card details with bookings | ❌ NO | PCI no aplica — Airbnb maneja pagos |
| PCI Certified | ❌ NO | No aplica para PMS de Airbnb (Airbnb retiene PCI) |

### Test Cases — Estado de implementación

| Test Case | Descripción | Estado | Notas |
|---|---|---|---|
| TC#1 Full Sync | 500 días availability + rates para todos los rooms/rates | ⚠️ RIESGO | La API soporta rangos (date_from/date_to). Falta un endpoint/script que construya el payload de 500 días para todos los rate plans |
| TC#2 Single Date — Single Rate | 1 fecha, 1 rate plan | ✅ Implementado | `pushRestrictions()` acepta rango de 1 día |
| TC#3 Single Date — Multiple Rates | 1 fecha, N rate plans | ✅ Implementado | Llamadas secuenciales o `values[]` array |
| TC#4 Multiple Dates — Multiple Rates | Rango de fechas, N rate plans | ✅ Implementado | date_from/date_to + values[] |
| TC#5 Min Stay Update | Restricción min_stay_arrival | ⚠️ VERIFICAR | Depende de campos en RestrictionEntryDto |
| TC#6 Stop Sell Update | stop_sell: true | ✅ Implementado | Campo `stop_sell` en ARIRestrictionPayload |
| TC#7 Multiple Restrictions Update | Varias restricciones en 1 payload | ✅ Implementado | `values[]` array en pushRestrictions |
| TC#8 Half-year Update | ~180 días | ✅ Implementado | date_from/date_to cubre 180 días |
| TC#9 Single Date Availability | 1 día, availability | ✅ Implementado | `pushAvailability()` con rango de 1 día |
| TC#10 Multiple Date Availability | Rango de fechas, availability | ✅ Implementado | date_from/date_to |
| TC#11 Booking Receiving | New + Modified + Cancelled bookings | ✅ Implementado | BullMQ worker maneja los 3 tipos |

### Áreas de Riesgo Identificadas

#### 🔴 RIESGO 1: Full Sync (TC#1)
El form especifica: "1 x 500 days for Availability (All Rooms)" y "1 x 500 days Rates & restrictions (All Rates)".
Channex espera exactamente 2 API calls — no más, no menos.
El código actual envía pushes individuales desde el frontend.
**Necesita:** Un endpoint o script de Full Sync que construya los 2 payloads exactos.

#### 🟡 RIESGO 2: Rate Limits sin queue
La arquitectura anterior (Redis/BullMQ para ARI) fue eliminada intencionalmente.
Los pushes de ARI son ahora síncronos desde el controller.
Channex tiene un límite de 10 req/min por propiedad.
Si múltiples sesiones de admin hacen pushes simultáneamente, puede alcanzar el límite.
`ChannexRateLimitError` está definido pero no hay retry automático para ARI pushes.
**Necesita:** Confirmar que la lógica de actualización solo envía cambios (no polling completo).

#### 🟡 RIESGO 3: RestrictionEntryDto — campos por confirmar
El DTO de restricciones necesita verificación de qué campos soporta actualmente:
- `min_stay_through` (distinto de `min_stay_arrival`)
- `max_stay`
- `closed_to_arrival` (CTA)
- `closed_to_departure` (CTD)

---

## Configuración actual

| Variable | Valor (staging) | Variable |
|---|---|---|
| Base URL | `https://staging.channex.io/api/v1` | `CHANNEX_BASE_URL` |
| API Key | `.env.secrets` → `CHANNEX_API_KEY` | GCP Secret Manager |
| Rate limit conocido | 10 req/min por propiedad | Hardcoded en comentarios |

---

## Frontend: endpoints consumidos

Todos bajo `/api/channex/*` (proxy Vite → localhost:3001):

| Función frontend | Endpoint backend |
|---|---|
| `provisionProperty()` | POST /channex/properties |
| `getConnectionStatus()` | GET /channex/properties/:id/status |
| `getOneTimeToken()` | GET /channex/properties/:id/one-time-token |
| `getCopyLink()` | GET /channex/properties/:id/copy-link |
| `pushAvailability()` | POST /channex/properties/:id/availability |
| `pushRestrictions()` | POST /channex/properties/:id/restrictions |
| `deleteProperty()` | DELETE /channex/properties/:id |
| `syncProperty()` | POST /channex/properties/:id/sync |
| `syncStage()` | POST /channex/properties/:id/sync_stage |
| `commitMapping()` | POST /channex/properties/:id/commit_mapping |
| `getListingCalendar()` | GET /channex/properties/:id/channels/:cid/listings/:lid/calendar |
| `linkGuestPhone()` | POST /channex/guests/:code/phone |
```

- [ ] **Step 2: Verificar que el archivo fue creado**

```bash
node -e "require('fs').accessSync('docs/channex/01-codebase-audit.md'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd "D:\migo\repos\WhatsApp Multi sign up demo"
git add docs/channex/01-codebase-audit.md docs/superpowers/plans/2026-04-30-channex-certification.md
git commit -m "docs(channex): add codebase audit and certification action plan"
```

---

## Fase 2 — Documentation Research

**Objetivo:** Fetchear cada URL de `docs.channex.io` mencionada en el form, extraer el contenido técnico relevante (qué API call hacer, qué payload, qué respuesta esperar), y guardar todo en `docs/channex/02-test-cases-research.md`.

**URLs a fetchear** (extraídas del form mapeado):

1. Setup — Property API: `https://docs.channex.io/api-v.1-documentation/hotels-collection#properties-list`
2. Setup — Room Type API: `https://docs.channex.io/api-v.1-documentation/room-types-collection#room-types-list`
3. Setup — Rate Plans API: `https://docs.channex.io/api-v.1-documentation/rate-plans-collection#rate-plans-list`
4. TC Overview: `https://docs.channex.io/api-v.1-documentation/pms-certification-tests#execute-test-scenarios`
5. TC#1 Full Sync: `https://docs.channex.io/api-v.1-documentation/pms-certification-tests#id-1.-full-data-update-full-sync`
6. TC#2 Single Date/Single Rate: `https://docs.channex.io/api-v.1-documentation/pms-certification-tests#id-2.-single-date-update-for-single-rate`
7. TC#3 Single Date/Multiple Rates: `https://docs.channex.io/api-v.1-documentation/pms-certification-tests#id-3.-single-date-update-for-multiple-rates`
8. TC#4 Multiple Dates/Multiple Rates: `https://docs.channex.io/api-v.1-documentation/pms-certification-tests#id-4.-multiple-date-update-for-multiple-rates`
9. TC#5 Min Stay: `https://docs.channex.io/api-v.1-documentation/pms-certification-tests#id-5.-min-stay-update`
10. TC#6 Stop Sell: `https://docs.channex.io/api-v.1-documentation/pms-certification-tests#id-6.-stop-sell-update`
11. TC#7 Multiple Restrictions: `https://docs.channex.io/api-v.1-documentation/pms-certification-tests#id-7.-multiple-restrictions-update`
12. TC#8 Half-year: `https://docs.channex.io/api-v.1-documentation/pms-certification-tests#id-8.-half-year-update`
13. TC#9 Single Date Availability: `https://docs.channex.io/api-v.1-documentation/pms-certification-tests#id-9.-single-date-availability-update`
14. TC#10 Multiple Date Availability: `https://docs.channex.io/api-v.1-documentation/pms-certification-tests#id-10.-multiple-date-availability-update`
15. TC#11 Booking Receiving: `https://docs.channex.io/api-v.1-documentation/pms-certification-tests#id-11.-booking-receiving`
16. Rate Limits: `https://docs.channex.io/api-v.1-documentation/rate-limits-coming-soon`

### Task 2: Script `scripts/fetch-channex-docs.js` en booking-skills

**Files:**
- Create: `D:\migo\repos\booking-skills\src\fetch-channex-docs.js`
- Output: `D:\migo\repos\WhatsApp Multi sign up demo\docs\channex\02-test-cases-research.md`

- [ ] **Step 1: Crear el script de fetching**

Crear `D:\migo\repos\booking-skills\src\fetch-channex-docs.js`:

```js
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = 'D:\\migo\\repos\\WhatsApp Multi sign up demo\\docs\\channex';

const URLS = [
  { label: 'Setup — Property API', url: 'https://docs.channex.io/api-v.1-documentation/hotels-collection' },
  { label: 'Setup — Room Type API', url: 'https://docs.channex.io/api-v.1-documentation/room-types-collection' },
  { label: 'Setup — Rate Plans API', url: 'https://docs.channex.io/api-v.1-documentation/rate-plans-collection' },
  { label: 'TC Overview — Execute Test Scenarios', url: 'https://docs.channex.io/api-v.1-documentation/pms-certification-tests' },
  { label: 'Rate Limits', url: 'https://docs.channex.io/api-v.1-documentation/rate-limits-coming-soon' },
];

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Migo-Docs-Fetcher/1.0)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function extractText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function main() {
  const lines = [];
  lines.push('# Channex Documentation Research');
  lines.push('');
  lines.push(`**Extraído:** ${new Date().toISOString()}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const { label, url } of URLS) {
    console.log(`⏳ Fetching: ${label}`);
    try {
      const html = await fetchPage(url);
      const text = extractText(html);
      const excerpt = text.slice(0, 4000);

      lines.push(`## ${label}`);
      lines.push('');
      lines.push(`**URL:** ${url}`);
      lines.push('');
      lines.push('```');
      lines.push(excerpt);
      lines.push('```');
      lines.push('');
      lines.push('---');
      lines.push('');
      console.log(`  ✅ OK (${text.length} chars)`);
    } catch (e) {
      lines.push(`## ${label}`);
      lines.push('');
      lines.push(`**URL:** ${url}`);
      lines.push('');
      lines.push(`> ❌ Error: ${e.message}`);
      lines.push('');
      lines.push('---');
      lines.push('');
      console.log(`  ❌ Error: ${e.message}`);
    }
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = join(OUTPUT_DIR, '02-test-cases-research.md');
  writeFileSync(outPath, lines.join('\n'), 'utf-8');
  console.log(`\n✅ Guardado → ${outPath}`);
}

main().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Agregar script a package.json de booking-skills**

En `D:\migo\repos\booking-skills\package.json`, agregar en scripts:
```json
"fetch-docs": "node src/fetch-channex-docs.js",
```

- [ ] **Step 3: Ejecutar el script**

```bash
cd "D:\migo\repos\booking-skills"
node src/fetch-channex-docs.js
```

Expected output:
```
⏳ Fetching: Setup — Property API
  ✅ OK (XXXX chars)
...
✅ Guardado → D:\migo\repos\WhatsApp Multi sign up demo\docs\channex\02-test-cases-research.md
```

- [ ] **Step 4: Verificar el archivo generado**

```bash
node -e "
const md = require('fs').readFileSync('D:\\\\migo\\\\repos\\\\WhatsApp Multi sign up demo\\\\docs\\\\channex\\\\02-test-cases-research.md', 'utf-8');
const sections = (md.match(/^## /gm) || []).length;
console.log('Secciones:', sections);
console.log('Tamaño:', md.length, 'chars');
"
```

Expected: secciones >= 5, tamaño > 5000.

- [ ] **Step 5: Commit en booking-skills**

```bash
cd "D:\migo\repos\booking-skills"
git add src/fetch-channex-docs.js package.json
git commit -m "feat: add Channex docs fetcher script"
```

- [ ] **Step 6: Commit en WhatsApp project**

```bash
cd "D:\migo\repos\WhatsApp Multi sign up demo"
git add docs/channex/02-test-cases-research.md
git commit -m "docs(channex): add Channex documentation research"
```

---

## Fase 3 — Gap Analysis

**Objetivo:** Con el audit (Fase 1) y la documentación real (Fase 2), escribir manualmente `docs/channex/03-gap-analysis.md` — qué falta implementar antes de ejecutar los tests.

### Task 3: Escribir `docs/channex/03-gap-analysis.md`

**Files:**
- Create: `docs/channex/03-gap-analysis.md`

- [ ] **Step 1: Leer `02-test-cases-research.md` completo**

Leer el archivo generado en Fase 2 y extraer para cada test case:
- Qué endpoint exacto llama el PMS
- Qué campos del payload son obligatorios
- Qué responde Channex (el ID de tipo `task` que hay que reportar)

- [ ] **Step 2: Cruzar con el audit de Fase 1**

Para cada test case, determinar:
- `✅ READY` — el código existente puede ejecutar este test sin cambios
- `⚠️ NEEDS_WORK` — el código existe pero falta un endpoint/script para ejecutarlo
- `❌ MISSING` — no existe implementación

- [ ] **Step 3: Crear el documento de gap analysis**

El documento debe tener esta estructura:
```markdown
# Gap Analysis — Channex Certification

**Fecha:** YYYY-MM-DD
**Basado en:** 01-codebase-audit.md + 02-test-cases-research.md

## Resumen

| Test Case | Estado | Acción requerida |
|---|---|---|
| TC#1 Full Sync | ⚠️ NEEDS_WORK | Crear script/endpoint de full sync 500 días |
| TC#2 Single Date/Single Rate | ✅ READY | ninguna |
...

## Detalle por gap

### TC#1 Full Sync — NEEDS_WORK
**Qué pide Channex:** [extraído de docs]
**Qué tenemos:** pushAvailability + pushRestrictions síncronos
**Qué falta:** Endpoint POST /channex/properties/:id/full-sync que:
  1. Construya availability payload: roomTypeId, dateFrom=today, dateTo=today+500
  2. Construya restrictions payload: ratePlanId, dateFrom=today, dateTo=today+500, rate=defaultRate
  3. Llame pushAvailability y pushRestrictions y retorne ambos task IDs
```

- [ ] **Step 4: Commit**

```bash
git add docs/channex/03-gap-analysis.md
git commit -m "docs(channex): add gap analysis for certification"
```

---

## Fase 4 — Test Execution

**Prerequisitos antes de esta fase:**
1. `CHANNEX_API_KEY` disponible en `.env.secrets`
2. Propiedad de prueba creada en Channex staging:
   - Nombre: "Test Property - Migo UIT"
   - Moneda: USD
   - 2 Room Types: "Twin Room" (2 occ) + "Double Room" (2 occ)
   - 4 Rate Plans: Twin BAR (100 USD) + Twin B&B (120 USD) + Double BAR (100 USD) + Double B&B (120 USD)
3. IDs de Channex obtenidos via GET /properties, /room_types, /rate_plans

### Task 4: Configurar la propiedad de prueba y obtener IDs

**Files:**
- Create: `docs/channex/04-test-results.md`

- [ ] **Step 1: Crear propiedad de prueba via API**

Ejecutar con curl o Postman contra `https://staging.channex.io/api/v1`:

```bash
curl -X POST https://staging.channex.io/api/v1/properties \
  -H "user-api-key: $CHANNEX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "property": {
      "title": "Test Property - Migo UIT",
      "currency": "USD",
      "timezone": "America/Caracas",
      "property_type": "Hotel",
      "email": "test@migo.com",
      "phone": "+584241234567",
      "zip_code": "1060",
      "country": "VE",
      "state": "Caracas",
      "city": "Caracas",
      "address": "Test Address 123"
    }
  }'
```

Guardar `property_id` en `docs/channex/04-test-results.md`.

- [ ] **Step 2: Crear los 2 Room Types**

```bash
# Twin Room
curl -X POST https://staging.channex.io/api/v1/room_types \
  -H "user-api-key: $CHANNEX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"room_type": {"property_id": "<PROPERTY_ID>", "title": "Twin Room", "count_of_rooms": 1, "default_occupancy": 2, "occ_adults": 2}}'

# Double Room
curl -X POST https://staging.channex.io/api/v1/room_types \
  -H "user-api-key: $CHANNEX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"room_type": {"property_id": "<PROPERTY_ID>", "title": "Double Room", "count_of_rooms": 1, "default_occupancy": 2, "occ_adults": 2}}'
```

Guardar IDs en `04-test-results.md`.

- [ ] **Step 3: Crear los 4 Rate Plans**

```bash
# Twin BAR
curl -X POST https://staging.channex.io/api/v1/rate_plans \
  -H "user-api-key: $CHANNEX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"rate_plan": {"property_id": "<PROPERTY_ID>", "room_type_id": "<TWIN_ROOM_ID>", "title": "Best Available Rate", "currency": "USD", "options": [{"rate": 100}]}}'

# Twin B&B
curl -X POST https://staging.channex.io/api/v1/rate_plans \
  -H "user-api-key: $CHANNEX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"rate_plan": {"property_id": "<PROPERTY_ID>", "room_type_id": "<TWIN_ROOM_ID>", "title": "Bed and Breakfast Rate", "currency": "USD", "options": [{"rate": 120}]}}'

# Double BAR
curl -X POST https://staging.channex.io/api/v1/rate_plans \
  -H "user-api-key: $CHANNEX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"rate_plan": {"property_id": "<PROPERTY_ID>", "room_type_id": "<DOUBLE_ROOM_ID>", "title": "Best Available Rate", "currency": "USD", "options": [{"rate": 100}]}}'

# Double B&B
curl -X POST https://staging.channex.io/api/v1/rate_plans \
  -H "user-api-key: $CHANNEX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"rate_plan": {"property_id": "<PROPERTY_ID>", "room_type_id": "<DOUBLE_ROOM_ID>", "title": "Bed and Breakfast Rate", "currency": "USD", "options": [{"rate": 120}]}}'
```

- [ ] **Step 4: Ejecutar TC#1 Full Sync**

Dos llamadas exactas. Fechas: today → today+500 días.

```bash
# Availability (todos los room types — 1 entry por room type, 1 sola llamada)
DATE_FROM=$(date +%Y-%m-%d)
DATE_TO=$(date -d "+500 days" +%Y-%m-%d)  # Linux; en Windows: ajustar

curl -X POST https://staging.channex.io/api/v1/availability \
  -H "user-api-key: $CHANNEX_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"values\": [
    {\"property_id\": \"<PROPERTY_ID>\", \"room_type_id\": \"<TWIN_ROOM_ID>\", \"date_from\": \"$DATE_FROM\", \"date_to\": \"$DATE_TO\", \"availability\": 1},
    {\"property_id\": \"<PROPERTY_ID>\", \"room_type_id\": \"<DOUBLE_ROOM_ID>\", \"date_from\": \"$DATE_FROM\", \"date_to\": \"$DATE_TO\", \"availability\": 1}
  ]}"

# Restrictions (todos los rate plans — 1 entry por rate plan, 1 sola llamada)
curl -X POST https://staging.channex.io/api/v1/restrictions \
  -H "user-api-key: $CHANNEX_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"values\": [
    {\"property_id\": \"<PROPERTY_ID>\", \"rate_plan_id\": \"<TWIN_BAR_ID>\", \"date_from\": \"$DATE_FROM\", \"date_to\": \"$DATE_TO\", \"rate\": \"100\"},
    {\"property_id\": \"<PROPERTY_ID>\", \"rate_plan_id\": \"<TWIN_BB_ID>\", \"date_from\": \"$DATE_FROM\", \"date_to\": \"$DATE_TO\", \"rate\": \"120\"},
    {\"property_id\": \"<PROPERTY_ID>\", \"rate_plan_id\": \"<DOUBLE_BAR_ID>\", \"date_from\": \"$DATE_FROM\", \"date_to\": \"$DATE_TO\", \"rate\": \"100\"},
    {\"property_id\": \"<PROPERTY_ID>\", \"rate_plan_id\": \"<DOUBLE_BB_ID>\", \"date_from\": \"$DATE_FROM\", \"date_to\": \"$DATE_TO\", \"rate\": \"120\"}
  ]}"
```

Guardar los `id` de tipo `task` de cada respuesta en `04-test-results.md`.

- [ ] **Step 5: Ejecutar TC#2 a TC#10**

Para cada test case, ejecutar el API call correspondiente según la documentación extraída en Fase 2.
Guardar los task IDs en `04-test-results.md` bajo la sección del test case correspondiente.

- [ ] **Step 6: Ejecutar TC#11 Booking Receiving**

Configurar un webhook en Channex que apunte al backend local (via ngrok).
Hacer una reserva de prueba y verificar que el worker procesa correctamente los 3 tipos de revisión: New, Modified, Cancelled.
Guardar los Booking ID y Revision IDs en `04-test-results.md`.

- [ ] **Step 7: Commit de resultados**

```bash
git add docs/channex/04-test-results.md
git commit -m "docs(channex): add test execution results"
```

---

## Fase 5 — Certification Answers

**Objetivo:** Generar `docs/channex/05-certification-answers.md` con todas las respuestas listas para copiar/pegar en el formulario Google.

### Task 5: Escribir `docs/channex/05-certification-answers.md`

- [ ] **Step 1: Crear el documento con el template de respuestas**

```markdown
# Channex Certification — Respuestas Finales

**Formulario:** https://docs.google.com/forms/d/e/1FAIpQLSeYvdsAglcIj0MEE7AhN1bv-UK1K-ss7NX06nU5DyuwiwU0dA/viewform
**Fecha:** YYYY-MM-DD

---

## Información General

**Product name:** Migo UIT
**Contact Person Name:** [COMPLETAR]
**Contact Person Email:** [COMPLETAR]

## Sección 1: PMS Functionality

**Multiple Room Types:** Yes
**Multiple Rate Plans:** Yes
**Restrictions soportadas:** [Availability, Rate, Min Stay Arrival, Stop Sell, ...]
**Credit card details:** No
**PCI Certified:** No

## Sección 2: Setup Testing Property

**Property ID at Channex:** [ID from 04-test-results.md]
**Twin Room ID:** [ID]
**Twin Room BAR ID:** [ID]
**Twin Room B&B ID:** [ID]
**Double Room ID:** [ID]
**Double Room BAR ID:** [ID]
**Double Room B&B ID:** [ID]

## Test Cases

### TC#1 Full Sync
[Task IDs from 04-test-results.md]

### TC#2 Single Date/Single Rate
**Applicable:** Yes
**Results:** [Task IDs]

[... continuar para TC#3 a TC#11 ...]

## Sección 33: Rate Limits

**Can you stay in rate limits:** Yes
**Only send updated changes:** Yes
```

- [ ] **Step 2: Rellenar todas las respuestas con los datos reales de las fases anteriores**

- [ ] **Step 3: Commit final**

```bash
git add docs/channex/05-certification-answers.md
git commit -m "docs(channex): add final certification answers"
```

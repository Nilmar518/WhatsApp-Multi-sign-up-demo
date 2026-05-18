# Booking CRS Application Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instalar la aplicación Booking CRS (`booking_crs`) en cada propiedad aislada de Channex durante el sync, para ambas pipelines (Airbnb y BDC), como paso non-fatal inmediatamente después de la instalación del Messages App.

**Architecture:** Se añade `booking_crs` UUID al objeto estático `ChannexService.APP_IDS` y un wrapper `installBookingCrsApp()` en `ChannexService`. Cada pipeline llama ese wrapper en su propio bloque `try/catch` (non-fatal) después de instalar el Messages App. Si falla, se emite `logger.warn` y el listing/room sigue en `succeeded[]`.

**Tech Stack:** NestJS, TypeScript, Channex REST API (`POST /api/v1/applications/install`).

---

## File Map

| Archivo | Acción |
|---|---|
| `apps/backend/src/channex/channex.service.ts` | Modify: añadir `booking_crs` a `APP_IDS` + nuevo método `installBookingCrsApp()` |
| `apps/backend/src/channex/channex-sync.service.ts` | Modify: Step G non-fatal en `autoSyncProperty` |
| `apps/backend/src/channex/channex-bdc-sync.service.ts` | Modify: Step F non-fatal en `syncBdc` |

---

## Task 1: Registrar Booking CRS en ChannexService

**Files:**
- Modify: `apps/backend/src/channex/channex.service.ts:1895-1897` (APP_IDS)
- Modify: `apps/backend/src/channex/channex.service.ts:1777-1779` (añadir wrapper después de installMessagesApp)

- [ ] **Step 1.1: Añadir `booking_crs` a `APP_IDS`**

Localizar el bloque `APP_IDS` en `channex.service.ts` (líneas 1895-1897):

```typescript
// ANTES:
static readonly APP_IDS = {
  channex_messages: 'd5c07f16-52f7-4afb-a884-dfe2d1cd7103',
} as const;

// DESPUÉS:
static readonly APP_IDS = {
  channex_messages: 'd5c07f16-52f7-4afb-a884-dfe2d1cd7103',
  booking_crs:      'bdcd403b-b62e-46c4-997e-3dced2ae7a37',
} as const;
```

- [ ] **Step 1.2: Añadir `installBookingCrsApp()` wrapper después de `installMessagesApp()`**

Insertar entre `installMessagesApp()` (línea 1779) y el comentario de `installApplication()` (línea 1781):

```typescript
async installBookingCrsApp(propertyId: string): Promise<void> {
  return this.installApplication(propertyId, ChannexService.APP_IDS.booking_crs);
}
```

El bloque resultante (líneas ~1777-1783) debe quedar:

```typescript
async installMessagesApp(propertyId: string): Promise<void> {
  return this.installApplication(propertyId, ChannexService.APP_IDS.channex_messages);
}

async installBookingCrsApp(propertyId: string): Promise<void> {
  return this.installApplication(propertyId, ChannexService.APP_IDS.booking_crs);
}

/**
 * Installs a Channex Application on a specific property by application UUID.
 * ...
 */
```

- [ ] **Step 1.3: Verificar compilación**

```bash
pnpm --filter @migo-uit/backend build
```

Esperado: 0 errores TypeScript.

- [ ] **Step 1.4: Commit**

```bash
git add apps/backend/src/channex/channex.service.ts
git commit -m "feat(channex): register booking_crs app ID and add installBookingCrsApp wrapper"
```

---

## Task 2: Step G non-fatal en el Airbnb sync pipeline

**Files:**
- Modify: `apps/backend/src/channex/channex-sync.service.ts:419-425`

Contexto actual (líneas 419-438 de `channex-sync.service.ts`):

```typescript
        // ── Step F: Install Channex Messages App ──────────────────────────
        currentStep = 'F';
        await this.channex.installMessagesApp(newPropertyId);
        this.logger.log(
          `[SYNC:1:1] ✓ F — Messages App installed — newPropertyId=${newPropertyId}`,
        );

        succeeded.push({
          listingId: seed.listingId,
          ...
        });
```

- [ ] **Step 2.1: Insertar Step G entre el log de Step F y `succeeded.push()`**

El bloque quedará así (reemplazar las líneas 419-425 + el inicio de succeeded.push):

```typescript
        // ── Step F: Install Channex Messages App ──────────────────────────
        currentStep = 'F';
        await this.channex.installMessagesApp(newPropertyId);
        this.logger.log(
          `[SYNC:1:1] ✓ F — Messages App installed — newPropertyId=${newPropertyId}`,
        );

        // ── Step G: Install Booking CRS App (non-fatal) ───────────────────
        try {
          await this.channex.installBookingCrsApp(newPropertyId);
          this.logger.log(
            `[SYNC:1:1] ✓ G — Booking CRS installed — newPropertyId=${newPropertyId}`,
          );
        } catch (err) {
          this.logger.warn(
            `[SYNC:1:1] Booking CRS install failed (non-fatal) — newPropertyId=${newPropertyId}: ${(err as Error).message}`,
          );
        }

        succeeded.push({
          listingId: seed.listingId,
```

> **Nota:** El bloque `try/catch` propio hace que cualquier fallo de Booking CRS no afecte al `IsolatedListingFailure` ni al rollback. El type union `'A' | 'B' | 'C' | 'D' | 'E' | 'F'` de `IsolatedListingFailure.step` no se modifica.

- [ ] **Step 2.2: Verificar compilación**

```bash
pnpm --filter @migo-uit/backend build
```

Esperado: 0 errores TypeScript.

- [ ] **Step 2.3: Commit**

```bash
git add apps/backend/src/channex/channex-sync.service.ts
git commit -m "feat(channex): install Booking CRS app in Airbnb isolated sync pipeline (Step G, non-fatal)"
```

---

## Task 3: Step F non-fatal en el BDC sync pipeline

**Files:**
- Modify: `apps/backend/src/channex/channex-bdc-sync.service.ts:264-274`

Contexto actual (líneas 264-274 de `channex-bdc-sync.service.ts`):

```typescript
        // ── Step E: Install Messages App on isolated property ────────────────
        currentStep = 'E';
        await this.channex.installApplication(
          newPropertyId,
          ChannexService.APP_IDS.channex_messages,
        );
        this.logger.log(
          `[BDC_SYNC] ✓ E — Messages App installed — newPropertyId=${newPropertyId}`,
        );

        succeeded.push({ otaRoomId, otaRoomTitle: first.otaRoomTitle, ... });
```

- [ ] **Step 3.1: Insertar Step F entre el log de Step E y `succeeded.push()`**

El bloque quedará así:

```typescript
        // ── Step E: Install Messages App on isolated property ────────────────
        currentStep = 'E';
        await this.channex.installApplication(
          newPropertyId,
          ChannexService.APP_IDS.channex_messages,
        );
        this.logger.log(
          `[BDC_SYNC] ✓ E — Messages App installed — newPropertyId=${newPropertyId}`,
        );

        // ── Step F: Install Booking CRS App (non-fatal) ──────────────────────
        try {
          await this.channex.installBookingCrsApp(newPropertyId);
          this.logger.log(
            `[BDC_SYNC] ✓ F — Booking CRS installed — newPropertyId=${newPropertyId}`,
          );
        } catch (err) {
          this.logger.warn(
            `[BDC_SYNC] Booking CRS install failed (non-fatal) — newPropertyId=${newPropertyId}: ${(err as Error).message}`,
          );
        }

        succeeded.push({ otaRoomId, otaRoomTitle: first.otaRoomTitle, channexPropertyId: newPropertyId, roomTypeId, ratePlanIds, webhookId });
```

> **Nota:** El type union `'A' | 'B' | 'C' | 'D' | 'E'` de `IsolatedBdcFailure.step` no se modifica.

- [ ] **Step 3.2: Verificar compilación**

```bash
pnpm --filter @migo-uit/backend build
```

Esperado: 0 errores TypeScript.

- [ ] **Step 3.3: Commit**

```bash
git add apps/backend/src/channex/channex-bdc-sync.service.ts
git commit -m "feat(channex): install Booking CRS app in BDC isolated sync pipeline (Step F, non-fatal)"
```

---

## Verificación manual (post-implementación)

- [ ] Arrancar el backend: `pnpm --filter @migo-uit/backend dev`
- [ ] Ejecutar un sync de Airbnb o BDC desde el frontend
- [ ] En los logs del servidor, buscar para cada propiedad aislada:
  ```
  [SYNC:1:1] ✓ G — Booking CRS installed — newPropertyId=<uuid>
  # o para BDC:
  [BDC_SYNC] ✓ F — Booking CRS installed — newPropertyId=<uuid>
  ```
- [ ] Ejecutar el mismo sync por segunda vez y verificar que la respuesta de Channex es 422 (ya instalado), que el log muestra `Application already installed (422)` y que el sync completa sin errores.

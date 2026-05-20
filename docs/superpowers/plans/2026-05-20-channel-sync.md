# Channel Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Garantizar que el documento `channels/{channelId}` en Firestore siempre esté registrado después de un sync de rooms/rates, y agregar un botón manual de reconciliación de canales en `ChannelManagementPanel`.

**Architecture:** Fix 2 escribe el canal en Firestore al final de `persistToFirestore` (BDC) y los dos métodos Airbnb equivalentes, usando `getChannelDetails` de `ChannexService` (ya inyectado). Fix 1 agrega `syncChannelsForTenant` al servicio de gestión de canales, un endpoint POST, y el botón con spinner en el panel frontend.

**Tech Stack:** NestJS (backend), React + TypeScript (frontend), Firestore (admin SDK), pnpm workspaces.

---

## Mapa de archivos

| Archivo | Operación | Responsabilidad del cambio |
|---|---|---|
| `apps/backend/src/channex/channex.service.ts` | Modify | Extender retorno de `getChannelDetails` con `title` y `status` |
| `apps/backend/src/channex/channex-bdc-sync.service.ts` | Modify | Escribir `channels/{id}` al final de `persistToFirestore` |
| `apps/backend/src/channex/channex-sync.service.ts` | Modify | Escribir `channels/{id}` en `finalizeFirestoreDocument` y `persistIsolatedSyncResults` |
| `apps/backend/src/channex/channex-channel-management.service.ts` | Modify | Agregar `syncChannelsForTenant` |
| `apps/backend/src/channex/channex-property.controller.ts` | Modify | Agregar `POST channels/sync` antes del grupo de rutas parametrizadas |
| `apps/frontend/src/channex/api/channexHubApi.ts` | Modify | Agregar `syncChannels(tenantId)` y tipo `ChannelSyncResult` |
| `apps/frontend/src/channex/hooks/useChannexChannels.ts` | Modify | Agregar función `refetch` al hook |
| `apps/frontend/src/i18n/es.ts` | Modify | 4 claves nuevas para el botón sync |
| `apps/frontend/src/i18n/en.ts` | Modify | 4 claves nuevas para el botón sync |
| `apps/frontend/src/channex/components/connection/ChannelManagementPanel.tsx` | Modify | Botón sync + estado + lógica |

---

## Task 1: Extender `getChannelDetails` para retornar `title` y `status`

**Files:**
- Modify: `apps/backend/src/channex/channex.service.ts` (~línea 685)

El método ya llama `GET /api/v1/channels/{channelId}`. La respuesta incluye `attributes.title` y `attributes.status` pero no se extraen. Se agregan a la interfaz interna y al objeto retornado.

- [ ] **Step 1: Modificar la interfaz interna y el retorno de `getChannelDetails`**

En `channex.service.ts`, reemplazar la firma y el cuerpo del método:

```ts
// ANTES (línea 685):
async getChannelDetails(channelId: string): Promise<{
  id: string;
  channel: string;
  settings: Record<string, unknown>;
  isActive: boolean;
  properties: string[];
}>

// DESPUÉS:
async getChannelDetails(channelId: string): Promise<{
  id: string;
  channel: string;
  title: string;
  status: string;
  settings: Record<string, unknown>;
  isActive: boolean;
  properties: string[];
}>
```

Dentro del método, reemplazar la interfaz interna `FullChannelDetailsResponse`:

```ts
interface FullChannelDetailsResponse {
  data: {
    id: string;
    attributes: {
      channel: string;
      title?: string;
      status?: string;
      is_active: boolean;
      settings: Record<string, unknown>;
      properties?: string[];
    };
    relationships?: {
      properties?: { data?: Array<{ id: string }> };
    };
  };
}
```

Y el objeto `return`:

```ts
return {
  id: response.data.id,
  channel: attrs?.channel ?? '',
  title: attrs?.title ?? '',
  status: attrs?.status ?? 'unknown',
  settings: attrs?.settings ?? {},
  isActive: attrs?.is_active ?? false,
  properties: Array.from(new Set([...fromAttributes, ...fromRelationships])),
};
```

- [ ] **Step 2: Verificar que el backend compila sin errores**

```bash
cd apps/backend
pnpm build --noEmit
```

Expected: sin errores de TypeScript.

---

## Task 2: Fix 2 — BDC sync: escribir `channels/{id}` en `persistToFirestore`

**Files:**
- Modify: `apps/backend/src/channex/channex-bdc-sync.service.ts` (~línea 524)

Al final de `persistToFirestore`, después de actualizar el root doc, agregar el bloque try/catch que escribe el canal. El método ya tiene `channexChannelId`, `tenantId`, `db`, y `now` en scope.

- [ ] **Step 1: Agregar escritura del canal al final de `persistToFirestore`**

Localizar el bloque que actualiza el root doc (termina en `this.logger.log('[BDC_SYNC] ✓ Firestore updated...')`). Agregar inmediatamente después, antes del cierre del método:

```ts
// Register channel doc so getPropertyBookings can resolve propertyChannelCode
try {
  const ch = await this.channex.getChannelDetails(channexChannelId);
  await db
    .collection(COLLECTION)
    .doc(tenantId)
    .collection('channels')
    .doc(channexChannelId)
    .set({
      channel_id: channexChannelId,
      title: ch.title,
      channel_code: ch.channel,
      status: ch.status,
      is_active: ch.isActive,
      synced_at: now,
      updated_at: now,
    });
  this.logger.log(
    `[BDC_SYNC] ✓ Channel doc registered — channelId=${channexChannelId} channel_code=${ch.channel}`,
  );
} catch (err) {
  this.logger.warn(
    `[BDC_SYNC] WARN — Could not register channel doc (non-fatal): ${(err as Error).message}`,
  );
}
```

- [ ] **Step 2: Verificar compilación**

```bash
cd apps/backend
pnpm build --noEmit
```

Expected: sin errores.

- [ ] **Step 3: Verificar manualmente**

Con el backend corriendo (`pnpm dev`), ejecutar un sync completo de BDC. En los logs del servidor deben aparecer:

```
[BDC_SYNC] ✓ Channel doc registered — channelId=<uuid> channel_code=BookingCom
```

Verificar en Firestore (Firebase console o emulator) que el documento `channex_integrations/{tenantId}/channels/{channexChannelId}` existe con `channel_code: "BookingCom"`.

---

## Task 3: Fix 2 — Airbnb sync: escribir `channels/{id}` en los dos métodos Airbnb

**Files:**
- Modify: `apps/backend/src/channex/channex-sync.service.ts` (~línea 997 y ~línea 1591)

### Sub-tarea A: `finalizeFirestoreDocument`

El `tenantId` actualmente sólo existe dentro del closure de la transacción. Se extrae al scope del método para poder usarlo después de que la transacción complete.

- [ ] **Step 1: Exponer `tenantId` fuera del closure de la transacción**

Localizar el método `finalizeFirestoreDocument` (~línea 997). Antes de `await db.runTransaction(...)`, declarar:

```ts
let resolvedTenantId = '';
```

Dentro del closure (donde hoy dice `const tenantId = data.tenant_id as string;`), cambiar a:

```ts
resolvedTenantId = (data.tenant_id as string) ?? '';
```

(El nombre de la variable interna puede dejarse como `tenantId` en el resto del closure; sólo necesitamos asignar a `resolvedTenantId`.)

- [ ] **Step 2: Agregar escritura del canal tras la transacción**

Inmediatamente después de `await db.runTransaction(...)` y antes del `this.logger.log('[COMMIT] ✓ Firestore finalized...')`:

```ts
if (resolvedTenantId) {
  const db2 = this.firebase.getFirestore();
  const now = new Date().toISOString();
  try {
    const ch = await this.channex.getChannelDetails(channelId);
    await db2
      .collection(COLLECTION)
      .doc(resolvedTenantId)
      .collection('channels')
      .doc(channelId)
      .set({
        channel_id: channelId,
        title: ch.title,
        channel_code: ch.channel,
        status: ch.status,
        is_active: ch.isActive,
        synced_at: now,
        updated_at: now,
      });
    this.logger.log(
      `[AIRBNB_SYNC] ✓ Channel doc registered — channelId=${channelId} channel_code=${ch.channel}`,
    );
  } catch (err) {
    this.logger.warn(
      `[AIRBNB_SYNC] WARN — Could not register channel doc (non-fatal): ${(err as Error).message}`,
    );
  }
}
```

### Sub-tarea B: `persistIsolatedSyncResults`

En este método `tenantId` ya está disponible en línea 1612 como `const tenantId = parentData.tenant_id as string`. El bloque se agrega al final del método.

- [ ] **Step 3: Agregar escritura del canal al final de `persistIsolatedSyncResults`**

Al final del método (después del último `this.firebase.set` o `this.firebase.update` del root doc, antes del cierre), agregar:

```ts
// Register channel doc
if (tenantId) {
  const now2 = new Date().toISOString();
  try {
    const ch = await this.channex.getChannelDetails(channelId);
    await db
      .collection(COLLECTION)
      .doc(tenantId)
      .collection('channels')
      .doc(channelId)
      .set({
        channel_id: channelId,
        title: ch.title,
        channel_code: ch.channel,
        status: ch.status,
        is_active: ch.isActive,
        synced_at: now2,
        updated_at: now2,
      });
    this.logger.log(
      `[AIRBNB_SYNC] ✓ Channel doc registered (isolated) — channelId=${channelId} channel_code=${ch.channel}`,
    );
  } catch (err) {
    this.logger.warn(
      `[AIRBNB_SYNC] WARN — Could not register channel doc (non-fatal): ${(err as Error).message}`,
    );
  }
}
```

- [ ] **Step 4: Verificar compilación**

```bash
cd apps/backend
pnpm build --noEmit
```

Expected: sin errores.

---

## Task 4: Fix 1 Backend — `syncChannelsForTenant` + endpoint

**Files:**
- Modify: `apps/backend/src/channex/channex-channel-management.service.ts`
- Modify: `apps/backend/src/channex/channex-property.controller.ts`

### Sub-tarea A: Método `syncChannelsForTenant`

- [ ] **Step 1: Agregar interfaz y método a `ChannexChannelManagementService`**

Al final de `channex-channel-management.service.ts`, antes del cierre de la clase (`}`), agregar:

```ts
async syncChannelsForTenant(tenantId: string): Promise<{
  added: number;
  alreadyInSync: number;
  extraInFirestore: string[];
}> {
  this.logger.log(`[CHANNEL_MGMT] syncChannelsForTenant — tenantId=${tenantId}`);
  const db = this.firebase.getFirestore();
  const channelsCol = db
    .collection(COLLECTION)
    .doc(tenantId)
    .collection(CHANNELS_SUBCOLLECTION);

  const groupId = await this.groupService.getGroupId(tenantId);
  if (!groupId) {
    throw new NotFoundException(
      `No Channex group found for tenant: ${tenantId}. Provision a property first.`,
    );
  }

  const [channexChannels, firestoreSnap] = await Promise.all([
    this.channex.getChannelsByGroup(groupId),
    channelsCol.get(),
  ]);

  const channexIds = new Set(channexChannels.map((c) => c.id));
  const firestoreIds = new Set(firestoreSnap.docs.map((d) => d.id));

  const extraInFirestore = [...firestoreIds].filter((id) => !channexIds.has(id));
  const missingInFirestore = channexChannels.filter((c) => !firestoreIds.has(c.id));

  if (missingInFirestore.length > 0) {
    const now = new Date().toISOString();
    const batch = db.batch();
    for (const ch of missingInFirestore) {
      const doc: StoredChannelDoc = {
        channel_id: ch.id,
        title: ch.attributes.title,
        channel_code: ch.attributes.channel,
        status: ch.attributes.status ?? (ch.attributes.is_active ? 'active' : 'inactive'),
        is_active: ch.attributes.is_active ?? false,
        synced_at: now,
      };
      batch.set(channelsCol.doc(ch.id), doc);
    }
    await batch.commit();
    this.logger.log(
      `[CHANNEL_MGMT] ✓ syncChannelsForTenant — added=${missingInFirestore.length} extraInFirestore=${extraInFirestore.length}`,
    );
  }

  return {
    added: missingInFirestore.length,
    alreadyInSync: channexChannels.length - missingInFirestore.length,
    extraInFirestore,
  };
}
```

### Sub-tarea B: Endpoint `POST channels/sync`

- [ ] **Step 2: Agregar endpoint en `channex-property.controller.ts`**

El endpoint `POST channels/sync` **debe declararse antes** de `POST channels/:channelId/activate` para que NestJS lo resuelva como ruta literal. Localizar el bloque de `@Get('channels/live')` (línea ~463) e insertar el nuevo endpoint inmediatamente después de ese `@Get`, antes del primer `@Post('channels/:channelId/...')`:

```ts
/**
 * POST /channex/properties/channels/sync?tenantId=X
 *
 * Reconciles Channex channels vs Firestore:
 *   - Registers any channels present in Channex but missing in Firestore.
 *   - Returns `extraInFirestore` if Firestore has channels unknown to Channex
 *     (manual admin action required — this endpoint never deletes).
 *
 * Returns: { added, alreadyInSync, extraInFirestore }
 * Status:  200 OK
 */
@Post('channels/sync')
@HttpCode(HttpStatus.OK)
async syncChannels(
  @Query('tenantId') tenantId: string,
): Promise<{ added: number; alreadyInSync: number; extraInFirestore: string[] }> {
  this.logger.log(`[CTRL] POST /channex/properties/channels/sync — tenantId=${tenantId}`);

  if (!tenantId) {
    throw new BadRequestException('tenantId query parameter is required.');
  }

  return this.channelMgmtService.syncChannelsForTenant(tenantId);
}
```

- [ ] **Step 3: Verificar compilación**

```bash
cd apps/backend
pnpm build --noEmit
```

Expected: sin errores.

- [ ] **Step 4: Verificar el endpoint manualmente**

Con el backend corriendo, ejecutar:

```bash
curl -X POST "http://localhost:3001/channex/properties/channels/sync?tenantId=<tu-tenantId>"
```

Expected response:
```json
{ "added": 1, "alreadyInSync": 0, "extraInFirestore": [] }
```

(Los números exactos dependen del estado de Firestore del tenant.)

---

## Task 5: Fix 1 Frontend — API + hook refetch + i18n + UI

**Files:**
- Modify: `apps/frontend/src/channex/api/channexHubApi.ts`
- Modify: `apps/frontend/src/channex/hooks/useChannexChannels.ts`
- Modify: `apps/frontend/src/i18n/es.ts`
- Modify: `apps/frontend/src/i18n/en.ts`
- Modify: `apps/frontend/src/channex/components/connection/ChannelManagementPanel.tsx`

### Sub-tarea A: Función API en `channexHubApi.ts`

- [ ] **Step 1: Agregar tipo `ChannelSyncResult` y función `syncChannels`**

Al final de la sección `// ─── Channel Management ───` en `channexHubApi.ts`, después de `deactivateChannel`:

```ts
export interface ChannelSyncResult {
  added: number;
  alreadyInSync: number;
  extraInFirestore: string[];
}

export async function syncChannels(tenantId: string): Promise<ChannelSyncResult> {
  const params = new URLSearchParams({ tenantId });
  return apiFetch(`${BASE}/properties/channels/sync?${params}`, { method: 'POST' });
}
```

### Sub-tarea B: Agregar `refetch` a `useChannexChannels`

- [ ] **Step 2: Exponer `refetch` en el hook**

Reemplazar el hook completo en `hooks/useChannexChannels.ts`:

```ts
import { useState, useEffect, useCallback } from 'react';
import { getChannels, type StoredChannel } from '../api/channexHubApi';

interface Result {
  channels: StoredChannel[];
  loading: boolean;
  error: string | null;
  updateChannel: (channelId: string, patch: Partial<StoredChannel>) => void;
  refetch: () => void;
}

export function useChannexChannels(tenantId: string): Result {
  const [channels, setChannels] = useState<StoredChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!tenantId) {
      setChannels([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    getChannels(tenantId)
      .then(setChannels)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load channels.'),
      )
      .finally(() => setLoading(false));
  }, [tenantId, tick]);

  const updateChannel = useCallback((channelId: string, patch: Partial<StoredChannel>) => {
    setChannels((prev) =>
      prev.map((ch) => (ch.channel_id === channelId ? { ...ch, ...patch } : ch)),
    );
  }, []);

  const refetch = useCallback(() => setTick((n) => n + 1), []);

  return { channels, loading, error, updateChannel, refetch };
}
```

### Sub-tarea C: Claves i18n

- [ ] **Step 3: Agregar claves en `es.ts`**

Inmediatamente después de `'channex.chanMgmt.close': 'Cerrar',` (línea 625):

```ts
  'channex.chanMgmt.syncBtn':          'Sincronizar',
  'channex.chanMgmt.syncing':          'Sincronizando…',
  'channex.chanMgmt.syncDone':         'Canales sincronizados',
  'channex.chanMgmt.syncErr.extra':    'Se detectaron canales en el sistema que ya no existen en Channex. Por favor contacte a un administrador.',
```

- [ ] **Step 4: Agregar claves en `en.ts`**

Inmediatamente después de `'channex.chanMgmt.close': 'Close',` (línea 639):

```ts
  'channex.chanMgmt.syncBtn':          'Sync channels',
  'channex.chanMgmt.syncing':          'Syncing…',
  'channex.chanMgmt.syncDone':         'Channels synced',
  'channex.chanMgmt.syncErr.extra':    'Channels were found in the system that no longer exist in Channex. Please contact an administrator.',
```

### Sub-tarea D: UI en `ChannelManagementPanel.tsx`

- [ ] **Step 5: Actualizar `ChannelManagementPanel.tsx`**

Reemplazar el contenido completo del archivo:

```tsx
import { useState, useCallback } from 'react';
import { useChannexChannels } from '../../hooks/useChannexChannels';
import { activateChannel, deactivateChannel, syncChannels, type ChannelSyncResult } from '../../api/channexHubApi';
import { useLanguage } from '../../../context/LanguageContext';

interface Props {
  tenantId: string;
}

const CHANNEL_LABELS: Record<string, string> = {
  ABB: 'Airbnb',
  BDC: 'Booking.com',
  BookingCom: 'Booking.com',
  AirBNB: 'Airbnb',
};

function channelLabel(code: string): string {
  return CHANNEL_LABELS[code] ?? code;
}

export default function ChannelManagementPanel({ tenantId }: Props) {
  const { t } = useLanguage();
  const { channels, loading, error: loadError, updateChannel, refetch } = useChannexChannels(tenantId);
  const [isOpen, setIsOpen] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncDone, setSyncDone] = useState(false);

  const handleToggle = useCallback(
    async (channelId: string, currentlyActive: boolean) => {
      setPendingId(channelId);
      try {
        if (currentlyActive) {
          await deactivateChannel(channelId, tenantId);
          updateChannel(channelId, { is_active: false, status: 'inactive' });
        } else {
          await activateChannel(channelId, tenantId);
          updateChannel(channelId, { is_active: true, status: 'active' });
        }
      } catch (err) {
        setErrorModal(
          err instanceof Error ? err.message : 'An unexpected error occurred.',
        );
      } finally {
        setPendingId(null);
      }
    },
    [tenantId, updateChannel],
  );

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncDone(false);
    try {
      const result: ChannelSyncResult = await syncChannels(tenantId);
      if (result.extraInFirestore.length > 0) {
        setErrorModal(t('channex.chanMgmt.syncErr.extra'));
      } else {
        setSyncDone(true);
        setTimeout(() => setSyncDone(false), 3000);
      }
      refetch();
    } catch (err) {
      setErrorModal(
        err instanceof Error ? err.message : 'An unexpected error occurred.',
      );
    } finally {
      setSyncing(false);
    }
  }, [tenantId, refetch, t]);

  return (
    <>
      <div className="rounded-2xl border border-edge bg-surface-raised overflow-hidden">
        {/* Accordion header */}
        <button
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-3 px-6 py-4 text-left hover:bg-surface-subtle transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-subtle border border-edge">
              <svg
                className="h-4 w-4 text-content-2"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="8" cy="8" r="6" />
                <path d="M8 5v3l2 1" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-semibold text-content">{t('channex.chanMgmt.title')}</h2>
              <p className="text-xs text-content-2">
                {loading
                  ? t('channex.chanMgmt.loading')
                  : t(channels.length === 1 ? 'channex.chanMgmt.count.one' : 'channex.chanMgmt.count.many', { n: channels.length })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
            {syncDone && (
              <span className="text-xs text-ok-text font-medium">
                {t('channex.chanMgmt.syncDone')}
              </span>
            )}
            <button
              type="button"
              disabled={syncing}
              onClick={(e) => { e.stopPropagation(); void handleSync(); }}
              className={[
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                syncing
                  ? 'cursor-not-allowed bg-surface-subtle text-content-3'
                  : 'bg-surface-subtle border border-edge text-content-2 hover:bg-edge hover:text-content',
              ].join(' ')}
            >
              {syncing ? (
                <>
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-current/30 border-t-current" />
                  {t('channex.chanMgmt.syncing')}
                </>
              ) : (
                t('channex.chanMgmt.syncBtn')
              )}
            </button>
            <svg
              className={[
                'h-4 w-4 text-content-2 transition-transform duration-200',
                isOpen ? 'rotate-180' : '',
              ].join(' ')}
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 6l4 4 4-4" />
            </svg>
          </div>
        </button>

        {/* Collapsible body */}
        {isOpen && (
          <div className="border-t border-edge px-6 pb-6 pt-4 space-y-3">
            {loading && (
              <p className="text-sm text-content-2">{t('channex.chanMgmt.loadingChannels')}</p>
            )}

            {!loading && loadError && (
              <div className="rounded-xl border border-danger-text/20 bg-danger-bg px-4 py-3 text-sm text-danger-text">
                {loadError}
              </div>
            )}

            {!loading && !loadError && channels.length === 0 && (
              <p className="text-sm text-content-3">
                {t('channex.chanMgmt.empty')}
              </p>
            )}

            {!loading && channels.map((ch) => {
              const isPending = pendingId === ch.channel_id;
              const isActive = ch.is_active;

              return (
                <div
                  key={ch.channel_id}
                  className="flex items-start justify-between gap-4 rounded-xl border border-edge bg-surface px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-content truncate">
                        {ch.title}
                      </span>
                      <span className="text-xs text-content-3 bg-surface-subtle border border-edge rounded px-1.5 py-0.5 shrink-0">
                        {channelLabel(ch.channel_code)}
                      </span>
                      <span
                        className={[
                          'text-xs font-medium rounded-full px-2 py-0.5 shrink-0',
                          isActive
                            ? 'bg-ok-bg text-ok-text'
                            : 'bg-surface-subtle text-content-3',
                        ].join(' ')}
                      >
                        {isActive ? t('channex.chanMgmt.active') : (ch.status ?? t('channex.chanMgmt.inactive'))}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-content-3 font-mono truncate">
                      {ch.channel_id}
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => void handleToggle(ch.channel_id, isActive)}
                    className={[
                      'shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                      isPending
                        ? 'cursor-not-allowed bg-surface-subtle text-content-3'
                        : isActive
                          ? 'bg-danger-bg text-danger-text hover:opacity-80'
                          : 'bg-ok-bg text-ok-text hover:opacity-80',
                    ].join(' ')}
                  >
                    {isPending ? (
                      <>
                        <div className="h-3 w-3 animate-spin rounded-full border-2 border-current/30 border-t-current" />
                        {isActive ? t('channex.chanMgmt.deactivating') : t('channex.chanMgmt.activating')}
                      </>
                    ) : isActive ? (
                      t('channex.chanMgmt.deactivate')
                    ) : (
                      t('channex.chanMgmt.activate')
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Error modal (reutilizado para sync errors) */}
      {errorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-surface-raised border border-edge p-6 shadow-xl">
            <h3 className="text-base font-semibold text-content mb-2">{t('channex.chanMgmt.err.title')}</h3>
            <p className="text-sm text-content-2 mb-1">
              {t('channex.chanMgmt.err.body')}
            </p>
            <p className="text-xs text-content-3 font-mono bg-surface-subtle rounded px-2 py-1 mb-4 break-all">
              {errorModal}
            </p>
            <button
              type="button"
              onClick={() => setErrorModal(null)}
              className="w-full rounded-xl bg-brand text-white py-2 text-sm font-semibold hover:opacity-80 transition-opacity"
            >
              {t('channex.chanMgmt.close')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 6: Verificar compilación TypeScript del frontend**

```bash
cd apps/frontend
pnpm tsc --noEmit
```

Expected: sin errores.

- [ ] **Step 7: Verificar flujo completo en el browser**

1. Abrir `https://localhost:5173` y navegar al tab de Booking.com o Airbnb.
2. En el panel "Conexiones de Canales", verificar que aparece el botón "Sincronizar".
3. Hacer click en "Sincronizar" → debe aparecer el spinner y luego el mensaje "Canales sincronizados" durante 3 segundos.
4. Si `extraInFirestore` no está vacío, debe aparecer el modal de error con el mensaje de administrador.
5. Después del sync, la lista de canales debe refrescarse (los nuevos canales aparecen si antes estaban ausentes).

---

## Criterios de verificación end-to-end

Después de completar los 5 tasks, hacer una verificación completa:

1. Ejecutar sync de BDC completo desde el UI.
2. Verificar en Firestore: `channex_integrations/{tenantId}/channels/{channexChannelId}` existe con `channel_code: "BookingCom"`.
3. Llamar `GET http://localhost:3001/channex/properties/{propertyId}/bookings?tenantId={tenantId}`.
4. Verificar que la respuesta incluye `"propertyChannelCode": "BookingCom"` (ya no `null`).
5. Abrir el modal de detalle de una reserva de Booking.com → el botón de no-show debe ser visible.

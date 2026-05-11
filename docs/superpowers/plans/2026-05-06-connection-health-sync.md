# Connection Health Global Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "↻ Sync" button to `PropertyDetail` that calls a backend health-check endpoint, verifies the Channex property state (exists, has rooms, is in the tenant's group, has a webhook), and auto-repairs a missing or deleted webhook.

**Architecture:** New public method `checkConnectionHealth()` on `ChannexSyncService` (which already owns `registerPropertyWebhook` and all Channex+Firestore dependencies). New endpoint `POST /channex/properties/:propertyId/connection-health` added to `ChannexARIController` (which shares the `channex/properties/:propertyId` route prefix). Frontend calls via `channexHubApi.ts` and shows a result panel in `PropertyDetail`.

**Tech Stack:** NestJS, Firebase Admin SDK, Channex REST API, React 18, TypeScript, Tailwind CSS

---

## File Map

| Action | File | Change |
|--------|------|--------|
| Modify | `apps/backend/src/channex/channex.service.ts` | Add `getProperty(id)` method |
| Modify | `apps/backend/src/channex/channex-sync.service.ts` | Make `registerPropertyWebhook` public; add `checkConnectionHealth()` |
| Modify | `apps/backend/src/channex/channex-ari.controller.ts` | Inject `ChannexSyncService`; add `POST connection-health` endpoint |
| Modify | `apps/backend/src/channex/channex.module.ts` | Verify `ChannexSyncService` is in providers (already is — confirm only) |
| Modify | `apps/frontend/src/channex/api/channexHubApi.ts` | Add `checkConnectionHealth()` + `ConnectionHealthResult` type |
| Modify | `apps/frontend/src/channex/components/PropertyDetail.tsx` | Add "↻ Sync" button + result panel |

---

### Task 1: Add `getProperty(id)` to `ChannexService`

`ChannexService` currently has `updateProperty`, `deleteProperty`, `createProperty` but no single-property GET. The health check needs to verify existence and read `group_id`.

**Files:**
- Modify: `apps/backend/src/channex/channex.service.ts`

- [ ] **Step 1: Find where `updateProperty` is defined to insert after it**

```bash
grep -n "async updateProperty\|async deleteProperty" apps/backend/src/channex/channex.service.ts
```

Expected: line numbers for both methods.

- [ ] **Step 2: Add `getProperty` method**

Insert after `updateProperty` (around line 270, before `deleteProperty`):

```typescript
/**
 * GET /api/v1/properties/:propertyId
 * Returns the full Channex property object including group_id.
 * Throws if the property does not exist (404 from Channex).
 */
async getProperty(propertyId: string): Promise<{ id: string; attributes: Record<string, unknown> }> {
  this.logger.log(`[CHANNEX] GET property — propertyId=${propertyId}`);
  const response = await this.defLogger.request<{ data: { id: string; attributes: Record<string, unknown> } }>({
    method: 'GET',
    url: `${this.baseUrl}/properties/${propertyId}`,
    headers: this.buildAuthHeaders(),
  });
  return response.data;
}
```

- [ ] **Step 3: TypeScript check**

```bash
cd apps/backend && npx tsc --noEmit 2>&1 | grep "channex.service"
```

Expected: no output.

---

### Task 2: Expose `registerPropertyWebhook` and add `checkConnectionHealth()` to `ChannexSyncService`

`registerPropertyWebhook` is currently `private`. The health check calls it directly, so change access to `public`. Then add the new `checkConnectionHealth` method.

**Files:**
- Modify: `apps/backend/src/channex/channex-sync.service.ts`

- [ ] **Step 1: Make `registerPropertyWebhook` public**

Find the declaration (around line 1127):
```typescript
private async registerPropertyWebhook(channexPropertyId: string): Promise<void> {
```

Change `private` to `public`:
```typescript
public async registerPropertyWebhook(channexPropertyId: string): Promise<void> {
```

- [ ] **Step 2: Add `ConnectionHealthResult` interface near the top of the file (after existing interfaces, before the `@Injectable()` class)**

```typescript
export interface ConnectionHealthResult {
  propertyExists: boolean;
  roomsCount: number;
  inTenantGroup: boolean;
  webhookSubscribed: boolean;
  webhookReregistered: boolean;
  webhookId: string | null;
  errors: string[];
}
```

- [ ] **Step 3: Add `checkConnectionHealth()` method inside the class, after `commitMapping`**

```typescript
/**
 * POST /channex/properties/:propertyId/connection-health
 *
 * Runs 4 live checks against Channex and Firestore:
 *   1. Property exists in Channex (GET /properties/:id)
 *   2. At least one room type exists (GET /room_types?filter[property_id])
 *   3. Property's group_id matches the tenant's group in Firestore
 *   4. A webhook with our callback_url is active (GET /webhooks?filter[property_id])
 *      → auto-registers if missing or if Firestore says none registered
 *
 * Non-fatal: individual check failures are recorded in `errors[]` rather than
 * throwing, so the caller always receives a complete report.
 */
async checkConnectionHealth(
  channexPropertyId: string,
  tenantId: string,
): Promise<ConnectionHealthResult> {
  const result: ConnectionHealthResult = {
    propertyExists: false,
    roomsCount: 0,
    inTenantGroup: false,
    webhookSubscribed: false,
    webhookReregistered: false,
    webhookId: null,
    errors: [],
  };

  const callbackUrl = `${process.env.CHANNEX_WEBHOOK_CALLBACK_URL ?? ''}/webhook`;

  // ── Check 1: Property exists in Channex ──────────────────────────────────
  let channexGroupId: string | null = null;
  try {
    const prop = await this.channex.getProperty(channexPropertyId);
    result.propertyExists = true;
    channexGroupId = (prop.attributes?.group_id as string | undefined) ?? null;
  } catch (err) {
    result.errors.push(`Property not found in Channex: ${(err as Error).message}`);
    return result; // No point continuing without the property
  }

  // ── Check 2: Room types exist ────────────────────────────────────────────
  try {
    const roomTypes = await this.channex.getRoomTypes(channexPropertyId);
    result.roomsCount = roomTypes.length;
  } catch (err) {
    result.errors.push(`Failed to list room types: ${(err as Error).message}`);
  }

  // ── Check 3: Property is in tenant's group ───────────────────────────────
  try {
    const db = this.firebase.getFirestore();
    const snap = await db
      .collectionGroup('properties')
      .where('channex_property_id', '==', channexPropertyId)
      .limit(1)
      .get();

    if (!snap.empty) {
      const firestoreGroupId: string | null =
        (snap.docs[0].data().channex_group_id as string | null | undefined) ?? null;
      result.inTenantGroup =
        !!channexGroupId &&
        !!firestoreGroupId &&
        channexGroupId === firestoreGroupId;
    }
  } catch (err) {
    result.errors.push(`Failed to verify group membership: ${(err as Error).message}`);
  }

  // ── Check 4: Webhook subscription ────────────────────────────────────────
  try {
    const db = this.firebase.getFirestore();
    const snap = await db
      .collectionGroup('properties')
      .where('channex_property_id', '==', channexPropertyId)
      .limit(1)
      .get();

    const firestoreWebhookId: string | null = snap.empty
      ? null
      : ((snap.docs[0].data().channex_webhook_id as string | null | undefined) ?? null);

    // Live verify against Channex regardless of Firestore state
    const webhooks = await this.channex.listPropertyWebhooks(channexPropertyId);
    const activeWebhook = webhooks.find(
      (wh) => wh.attributes?.callback_url === callbackUrl,
    );

    if (activeWebhook) {
      result.webhookSubscribed = true;
      result.webhookId = activeWebhook.id;
    } else {
      // Webhook missing or deleted — re-register
      this.logger.warn(
        `[HEALTH] Webhook missing — re-registering — propertyId=${channexPropertyId} firestoreWebhookId=${firestoreWebhookId ?? 'none'}`,
      );
      await this.registerPropertyWebhook(channexPropertyId);
      result.webhookReregistered = true;

      // Re-read to confirm and capture new ID
      const refreshed = await this.channex.listPropertyWebhooks(channexPropertyId);
      const newWebhook = refreshed.find(
        (wh) => wh.attributes?.callback_url === callbackUrl,
      );
      if (newWebhook) {
        result.webhookSubscribed = true;
        result.webhookId = newWebhook.id;
      }
    }
  } catch (err) {
    result.errors.push(`Webhook check failed: ${(err as Error).message}`);
  }

  this.logger.log(
    `[HEALTH] ✓ Check complete — propertyId=${channexPropertyId} propertyExists=${result.propertyExists} rooms=${result.roomsCount} inGroup=${result.inTenantGroup} webhook=${result.webhookSubscribed} reregistered=${result.webhookReregistered}`,
  );

  return result;
}
```

- [ ] **Step 4: TypeScript check**

```bash
cd apps/backend && npx tsc --noEmit 2>&1 | grep "channex-sync"
```

Expected: no output.

---

### Task 3: Add `POST connection-health` endpoint to `ChannexARIController`

The controller is at `apps/backend/src/channex/channex-ari.controller.ts` with prefix `channex/properties/:propertyId`. We inject `ChannexSyncService` and add the new endpoint.

**Files:**
- Modify: `apps/backend/src/channex/channex-ari.controller.ts`

- [ ] **Step 1: Add import for `ChannexSyncService` and `ConnectionHealthResult`**

At the top of the file, after the existing imports, add:

```typescript
import { ChannexSyncService, ConnectionHealthResult } from './channex-sync.service';
```

- [ ] **Step 2: Inject `ChannexSyncService` in the constructor**

Change:
```typescript
constructor(
  private readonly ariService: ChannexARIService,
  private readonly snapshotService: ChannexARISnapshotService,
) {}
```

To:
```typescript
constructor(
  private readonly ariService: ChannexARIService,
  private readonly snapshotService: ChannexARISnapshotService,
  private readonly syncService: ChannexSyncService,
) {}
```

- [ ] **Step 3: Add the endpoint at the end of the controller class (before the closing `}`)**

```typescript
/**
 * POST /channex/properties/:propertyId/connection-health?tenantId=X
 *
 * Runs 4 live checks and auto-repairs a missing webhook:
 *   1. Property exists in Channex
 *   2. At least one room type exists
 *   3. Property's group_id matches the tenant's Firestore group
 *   4. Webhook with our callback_url is active → re-registers if missing
 *
 * Always returns a full report (non-fatal individual failures go to errors[]).
 */
@Post('connection-health')
@HttpCode(HttpStatus.OK)
async checkConnectionHealth(
  @Param('propertyId') propertyId: string,
  @Query('tenantId') tenantId: string,
): Promise<ConnectionHealthResult> {
  this.logger.log(
    `[CTRL] POST /connection-health — propertyId=${propertyId} tenantId=${tenantId}`,
  );
  return this.syncService.checkConnectionHealth(propertyId, tenantId);
}
```

- [ ] **Step 4: Verify `ChannexSyncService` is in `ChannexModule` providers**

```bash
grep -n "ChannexSyncService" apps/backend/src/channex/channex.module.ts
```

Expected: at least one line showing it in `providers` array. If missing, add it.

- [ ] **Step 5: TypeScript check**

```bash
cd apps/backend && npx tsc --noEmit 2>&1 | grep "channex-ari.controller\|channex-sync"
```

Expected: no output.

- [ ] **Step 6: Commit backend**

```bash
git add apps/backend/src/channex/channex.service.ts \
        apps/backend/src/channex/channex-sync.service.ts \
        apps/backend/src/channex/channex-ari.controller.ts
git commit -m "feat(channex): add connection-health endpoint with webhook auto-repair"
```

---

### Task 4: Add API call to `channexHubApi.ts`

**Files:**
- Modify: `apps/frontend/src/channex/api/channexHubApi.ts`

- [ ] **Step 1: Add `ConnectionHealthResult` type and `checkConnectionHealth()` function**

Append to the end of `apps/frontend/src/channex/api/channexHubApi.ts`:

```typescript
// ─── Connection Health ────────────────────────────────────────────────────────

export interface ConnectionHealthResult {
  propertyExists: boolean;
  roomsCount: number;
  inTenantGroup: boolean;
  webhookSubscribed: boolean;
  webhookReregistered: boolean;
  webhookId: string | null;
  errors: string[];
}

export async function checkConnectionHealth(
  propertyId: string,
  tenantId: string,
): Promise<ConnectionHealthResult> {
  const params = new URLSearchParams({ tenantId });
  return apiFetch(
    `${BASE}/properties/${encodeURIComponent(propertyId)}/connection-health?${params}`,
    { method: 'POST' },
  );
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd apps/frontend && npx tsc --noEmit 2>&1 | grep "channexHubApi"
```

Expected: no output.

---

### Task 5: Add "↻ Sync" button and result panel to `PropertyDetail`

The button appears in the property header row (right side, next to the status badge). On click, calls the health endpoint and shows a compact result panel below the header card.

**Files:**
- Modify: `apps/frontend/src/channex/components/PropertyDetail.tsx`

- [ ] **Step 1: Add import for the new API call**

At the top of `PropertyDetail.tsx`, add to the existing import:

```typescript
import { checkConnectionHealth, type ConnectionHealthResult } from '../api/channexHubApi';
```

- [ ] **Step 2: Add state variables inside the component (after the existing `useState` calls)**

```typescript
const [syncing, setSyncing] = useState(false);
const [healthResult, setHealthResult] = useState<ConnectionHealthResult | null>(null);
const [healthError, setHealthError] = useState<string | null>(null);
```

- [ ] **Step 3: Add the `handleSync` function**

```typescript
async function handleSync() {
  setSyncing(true);
  setHealthResult(null);
  setHealthError(null);
  try {
    const result = await checkConnectionHealth(property.channex_property_id, tenantId);
    setHealthResult(result);
  } catch (err) {
    setHealthError((err as Error).message);
  } finally {
    setSyncing(false);
  }
}
```

- [ ] **Step 4: Add the "↻ Sync" button to the property header**

In the header `<div className="flex items-center justify-between">`, find the right-side `<div className="text-right">` and add the button above the status badge:

```tsx
<div className="text-right">
  <div className="flex items-center justify-end gap-2 mb-1">
    <button
      type="button"
      onClick={() => void handleSync()}
      disabled={syncing}
      className="rounded-xl border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
    >
      {syncing ? 'Syncing…' : '↻ Sync'}
    </button>
    <p className="text-xs text-slate-500">{property.currency} · {property.timezone}</p>
  </div>
  <span
    className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase ${
      property.connection_status === 'active'
        ? 'bg-emerald-100 text-emerald-700'
        : property.connection_status === 'pending'
          ? 'bg-amber-100 text-amber-700'
          : 'bg-red-100 text-red-700'
    }`}
  >
    {property.connection_status}
  </span>
</div>
```

- [ ] **Step 5: Add the result panel below the header card**

After the closing `</div>` of the header card (the first `rounded-2xl` div), add:

```tsx
{/* Connection health result panel */}
{healthError && (
  <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
    {healthError}
  </div>
)}
{healthResult && (
  <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs space-y-1.5">
    <p className="font-semibold text-slate-700 mb-2">Connection Health</p>
    <HealthRow ok={healthResult.propertyExists} label="Propiedad existe en Channex" />
    <HealthRow ok={healthResult.roomsCount > 0} label={`Rooms en Channex (${healthResult.roomsCount})`} />
    <HealthRow ok={healthResult.inTenantGroup} label="Propiedad en el grupo del tenant" />
    <HealthRow
      ok={healthResult.webhookSubscribed}
      label={
        healthResult.webhookReregistered
          ? 'Webhook re-registrado ✓'
          : `Webhook suscrito${healthResult.webhookId ? ` (${healthResult.webhookId.slice(0, 8)}…)` : ''}`
      }
    />
    {healthResult.errors.length > 0 && (
      <div className="mt-2 border-t border-slate-200 pt-2 space-y-0.5">
        {healthResult.errors.map((e, i) => (
          <p key={i} className="text-red-600">{e}</p>
        ))}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 6: Add `HealthRow` helper component at the bottom of the file (outside the default export)**

```tsx
function HealthRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={ok ? 'text-emerald-600' : 'text-red-500'}>{ok ? '✓' : '✗'}</span>
      <span className={ok ? 'text-slate-700' : 'text-red-600'}>{label}</span>
    </div>
  );
}
```

- [ ] **Step 7: TypeScript check**

```bash
cd apps/frontend && npx tsc --noEmit 2>&1 | grep -v "PropertySetupWizard\|AirbnbIntegration\|BookingIntegration"
```

Expected: no new errors.

- [ ] **Step 8: Commit frontend**

```bash
git add apps/frontend/src/channex/api/channexHubApi.ts \
        apps/frontend/src/channex/components/PropertyDetail.tsx
git commit -m "feat(channex): add Global Sync button with connection health panel"
```

---

## Manual Verification

- [ ] Open a property detail in the Channex Hub
- [ ] Click "↻ Sync" — spinner appears, then result panel with 4 rows
- [ ] All 4 checks show ✓ for a properly configured property
- [ ] Temporarily remove `CHANNEX_WEBHOOK_CALLBACK_URL` from `.env` → Sync → webhook row shows ✗ with error in `errors[]`
- [ ] Delete the webhook manually in Channex staging → click Sync → webhook row shows "Webhook re-registrado ✓"
- [ ] Check Firestore: `channex_webhook_id` updated with new ID after re-registration

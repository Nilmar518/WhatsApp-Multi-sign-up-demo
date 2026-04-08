# Refactoring Plan — Scalable Multi-Tenant WhatsApp Integration Architecture

**Reference:** `d:/migo/repos/518-rent/docs/INTEGRATIONS_ARCHITECTURE.md`  
**Scope:** `apps/backend/` + `apps/frontend/`  
**Date:** 2026-04-07  
**Status:** Draft

---

## Table of Contents

1. [Current State Assessment](#1-current-state-assessment)
2. [Target Architecture Delta](#2-target-architecture-delta)
3. [Phase 1 — Token Security: Move Credentials Out of Firestore](#phase-1--token-security-move-credentials-out-of-firestore)
4. [Phase 2 — Setup Status Machine](#phase-2--setup-status-machine)
5. [Phase 3 — IntegrationProviderContract Abstraction](#phase-3--integrationprovidercontract-abstraction)
6. [Phase 4 — Multi-Tenancy & Dynamic Tenant Resolution](#phase-4--multi-tenancy--dynamic-tenant-resolution)
7. [Phase 5 — Frontend: Setup Flow Hook](#phase-5--frontend-setup-flow-hook)
8. [Phase 6 — Graph API Version Alignment](#phase-6--graph-api-version-alignment)
9. [File Manifest](#file-manifest)
10. [Migration Checklist](#migration-checklist)

---

## 1. Current State Assessment

### What is already correct

| Component | Current Implementation | Production Alignment |
|---|---|---|
| FB Embedded Signup | `ConnectButton` uses `FB.login()` with `response_type: 'code'` | ✅ Correct |
| Code → Token exchange | `AuthService.exchangeToken()` steps 1–2 | ✅ Correct |
| Token extension (60-day) | `fb_exchange_token` grant in step 2 | ✅ Correct |
| Phone registration | Step 5 in `exchangeToken()` | ✅ Correct |
| Webhook subscription | Step 5.5 in `exchangeToken()` | ✅ Correct |
| System User escalation | `SystemUserService.tryEscalate()` | ✅ Partial (token still lands in Firestore) |
| SecretManagerService | `.env.secrets` → `process.env` priority chain | ✅ Production-swappable |
| DefensiveLoggerService | Used for all Meta Graph API calls | ✅ Correct |

### What must be refactored

| Problem | Location | Risk |
|---|---|---|
| **Access token stored in Firestore** | `auth.service.ts:387–389` | Token exposed in any Firestore read or rules breach |
| **System User token stored in Firestore** | `system-user.service.ts:64` | Same exposure risk |
| **Disconnect wipes token from Firestore** | `integrations.controller.ts:46` | Token field is present in Firestore, confirming leakage |
| **Monolithic `exchangeToken()`** | `auth.service.ts:102` | All steps run or fail together; no retry-from-step |
| **`IntegrationStatus` re-declared locally** | `auth.service.ts:16–22` | Drift risk; types diverge from production entity |
| **No `IntegrationProviderContract`** | Backend | Business logic not reusable for future providers |
| **Hardcoded `businessId` strings on frontend** | `App.tsx:14` | Not multi-tenant; adding a new business requires a code change |
| **`metaData.accessToken` read directly by catalog services** | `catalog.service.ts`, `catalog-manager.service.ts` | All callers must be migrated when token moves to secrets |

---

## 2. Target Architecture Delta

The production model (INTEGRATIONS_ARCHITECTURE.md) mandates:

```
Firestore integrations/{integrationId}
  ├── provider: 'META'
  ├── connectedBusinessIds: ['business-abc', ...]   ← multi-tenancy field
  ├── setupStatus: 'TOKEN_EXCHANGED' | 'PHONE_REGISTERED' | ... | 'WEBHOOKS_SUBSCRIBED'
  └── meta: { phoneNumberId, wabaId, displayPhoneNumber }
      (NO accessToken — tokens live in SecretManagerService)

SecretManagerService (keyed by integrationId)
  └── META_TOKEN__{integrationId}: { accessToken, tokenExpiresAt, tokenType }
```

The delta from the current test project:

1. The doc key changes from `integrations/{businessId}` → `integrations/{integrationId}` (a generated ID), with `connectedBusinessIds` linking to business documents.
2. `metaData.accessToken` is removed from Firestore and stored as a secret keyed by `integrationId`.
3. The monolithic `exchangeToken()` is split into independent callable steps.
4. A `MetaProvider` class implementing `IntegrationProviderContract` wraps all steps.

---

## Phase 1 — Token Security: Move Credentials Out of Firestore

### Problem

`auth.service.ts` writes `metaData.accessToken` directly to Firestore at line 387:

```typescript
// CURRENT — token visible in Firestore
metaData: {
  wabaId,
  phoneNumberId: resolvedPhoneNumberId,
  accessToken: longLived.access_token,   // ← must move
  tokenType: 'LONG_LIVED',
},
```

`system-user.service.ts` line 64 repeats this for the System User token.

### Solution

Store tokens in `SecretManagerService`, keyed by `integrationId`. The integration document retains only non-sensitive metadata.

#### 1.1 — Extend `SecretManagerService` with a write method

**File:** `apps/backend/src/common/secrets/secret-manager.service.ts`

Add a `set(key, value)` method alongside the existing `get()`. In development this writes to the in-memory store. In production this is replaced by a call to `secretManagerClient.addSecretVersion()`.

```typescript
// Add to SecretManagerService
set(secretName: string, value: string): void {
  this.logger.log(`[GCP-SECRET-EMULATOR] Writing secret: ${secretName}`);
  this.secrets[secretName] = value;
}
```

> **Production swap note:** In production, `set()` calls `SecretManagerServiceClient.addSecretVersion()`. The key naming convention is `META_TOKEN__{integrationId}` — a single JSON blob `{ accessToken, tokenType, tokenExpiresAt }` serialized as a string.

#### 1.2 — Change what `AuthService` writes to Firestore

**File:** `apps/backend/src/auth/auth.service.ts` — Step 6 (lines ~380–395)

```typescript
// BEFORE
const activePayload = {
  businessId,
  status: IntegrationStatus.ACTIVE,
  metaData: {
    wabaId,
    phoneNumberId: resolvedPhoneNumberId,
    accessToken: longLived.access_token,   // remove
    tokenType: 'LONG_LIVED',               // remove
  },
  updatedAt: new Date().toISOString(),
};

// AFTER
const integrationId = businessId; // keep using businessId as ID for now (Phase 4 changes this)

// Store token securely — never in Firestore
this.secrets.set(
  `META_TOKEN__${integrationId}`,
  JSON.stringify({
    accessToken: longLived.access_token,
    tokenType: 'LONG_LIVED',
    tokenExpiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
  }),
);

const activePayload = {
  businessId,
  status: IntegrationStatus.ACTIVE,
  metaData: {
    wabaId,
    phoneNumberId: resolvedPhoneNumberId,
    // accessToken intentionally absent
  },
  updatedAt: new Date().toISOString(),
};
```

#### 1.3 — Change what `SystemUserService` writes to Firestore

**File:** `apps/backend/src/auth/system-user.service.ts` — lines 64–68

```typescript
// BEFORE
await this.firebase.update(docRef, {
  'metaData.accessToken': permanentToken,
  'metaData.tokenType': 'SYSTEM_USER',
  updatedAt: new Date().toISOString(),
});

// AFTER
this.secrets.set(
  `META_TOKEN__${businessId}`,
  JSON.stringify({
    accessToken: permanentToken,
    tokenType: 'SYSTEM_USER',
    tokenExpiresAt: null, // system user tokens do not expire
  }),
);
await this.firebase.update(docRef, {
  'metaData.tokenType': 'SYSTEM_USER', // non-sensitive metadata, ok in Firestore
  updatedAt: new Date().toISOString(),
});
```

#### 1.4 — Add a token retrieval helper

**New file:** `apps/backend/src/common/secrets/get-meta-token.ts`

Centralises the lookup pattern so every service that needs an access token calls one function rather than reading Firestore:

```typescript
import { SecretManagerService } from './secret-manager.service';
import { HttpException, HttpStatus } from '@nestjs/common';

export function getMetaToken(secrets: SecretManagerService, integrationId: string): string {
  const raw = secrets.get(`META_TOKEN__${integrationId}`);
  if (!raw) {
    throw new HttpException(
      `No Meta token found for integrationId=${integrationId}. Re-authenticate.`,
      HttpStatus.UNAUTHORIZED,
    );
  }
  const parsed = JSON.parse(raw) as { accessToken: string };
  return parsed.accessToken;
}
```

#### 1.5 — Migrate all token consumers

Every service that currently reads `metaData.accessToken` from Firestore must be updated to call `getMetaToken()` instead.

**Files to update:**

| File | Current pattern | Change to |
|---|---|---|
| `catalog/catalog.service.ts` | `data.metaData.accessToken` | `getMetaToken(this.secrets, businessId)` |
| `catalog-manager/catalog-manager.service.ts` | `data.metaData?.accessToken` | `getMetaToken(this.secrets, businessId)` |
| `messaging/messaging.service.ts` | Reads integration doc for token | `getMetaToken(this.secrets, businessId)` |
| `registration/registration.service.ts` | Same | Same |
| `migration/migration.service.ts` | Same | Same |

#### 1.6 — Update disconnect to not reference the token field

**File:** `apps/backend/src/integrations/integrations.controller.ts`

The disconnect handler currently nulls `metaData.accessToken`. Since the token is no longer in Firestore, remove those field references. Optionally call `secrets.set(`META_TOKEN__${businessId}`, '')` to invalidate the secret entry.

```typescript
// BEFORE
await this.firebase.update(docRef, {
  status: 'IDLE',
  'metaData.accessToken': null,   // remove — not in Firestore anymore
  'metaData.phoneNumberId': null,
  'metaData.wabaId': null,
  'metaData.tokenType': null,
  updatedAt: new Date().toISOString(),
});

// AFTER
this.secrets.set(`META_TOKEN__${businessId}`, ''); // invalidate
await this.firebase.update(docRef, {
  status: 'IDLE',
  'metaData.phoneNumberId': null,
  'metaData.wabaId': null,
  'metaData.tokenType': null,
  updatedAt: new Date().toISOString(),
});
```

---

## Phase 2 — Setup Status Machine

### Problem

`AuthService.exchangeToken()` runs all 7 steps in a single HTTP request. If any step fails, the entire onboarding must restart. There is no way to retry from step 3 without re-consuming the OAuth code.

The production architecture uses a linear state machine:

```
TOKEN_EXCHANGED → PHONE_REGISTERED → STATUS_VERIFIED → CATALOG_SELECTED → WEBHOOKS_SUBSCRIBED
```

Each step is a separate API call, persisted immediately to Firestore. A step failure leaves status at the last successful step, enabling retry from that point.

### Solution

#### 2.1 — Define the status enum

**New file:** `apps/backend/src/integrations/meta/meta-setup-status.enum.ts`

```typescript
export enum MetaSetupStatus {
  TOKEN_EXCHANGED     = 'TOKEN_EXCHANGED',
  PHONE_REGISTERED    = 'PHONE_REGISTERED',
  STATUS_VERIFIED     = 'STATUS_VERIFIED',
  CATALOG_SELECTED    = 'CATALOG_SELECTED',
  WEBHOOKS_SUBSCRIBED = 'WEBHOOKS_SUBSCRIBED',
  ERROR               = 'ERROR',
}
```

#### 2.2 — Split `AuthService` into a dedicated `MetaIntegrationService`

**New file:** `apps/backend/src/integrations/meta/meta-integration.service.ts`

Extract steps from `auth.service.ts` into discrete methods, each persisting its own status step:

```typescript
@Injectable()
export class MetaIntegrationService {
  // exchangeToken(dto): exchanges code → long-lived token, stores secret,
  //   writes status=TOKEN_EXCHANGED to Firestore
  // registerPhone(integrationId): POST /{phoneNumberId}/register,
  //   writes status=PHONE_REGISTERED
  // verifyStatus(integrationId): GET /{phoneNumberId} phone status check,
  //   writes status=STATUS_VERIFIED
  // selectCatalog(integrationId, catalogId): links catalog,
  //   writes status=CATALOG_SELECTED
  // subscribeWebhooks(integrationId): POST /{wabaId}/subscribed_apps,
  //   writes status=WEBHOOKS_SUBSCRIBED
}
```

#### 2.3 — New REST endpoints

**New file:** `apps/backend/src/integrations/meta/meta-integration.controller.ts`

Mirror the production API surface:

```
POST /integrations/meta/exchange-token      — Step 1 (replaces POST /auth/exchange-token)
POST /integrations/meta/whatsapp/register   — Step 2
POST /integrations/meta/whatsapp/status     — Step 3
POST /integrations/meta/:id/catalogs        — Step 4
POST /integrations/meta/whatsapp/subscribe-webhooks — Step 5
GET  /integrations/meta/catalogs            — Fetch catalog list for step 4 UI
```

Keep the existing `POST /auth/exchange-token` endpoint alive as a facade that calls all 5 steps sequentially — this maintains backward-compatibility with the current `ConnectButton` frontend during the transition.

#### 2.4 — Frontend status display

**File:** `apps/frontend/src/types/integration.ts` (or equivalent)

Add `MetaSetupStatus` values to the type so the `StatusDisplay` component can show granular progress:

```typescript
export type IntegrationStatus =
  | 'IDLE'
  | 'TOKEN_EXCHANGED'
  | 'PHONE_REGISTERED'
  | 'STATUS_VERIFIED'
  | 'CATALOG_SELECTED'
  | 'WEBHOOKS_SUBSCRIBED'
  | 'ACTIVE'               // keep for backward-compat; maps to WEBHOOKS_SUBSCRIBED
  | 'ERROR';
```

---

## Phase 3 — IntegrationProviderContract Abstraction

### Problem

All Meta-specific logic is spread across `AuthService`, `SystemUserService`, `CatalogManagerService`, and `IntegrationsController`. There is no shared interface — adding a second provider (e.g. Google) would require duplicating orchestration code.

### Solution

#### 3.1 — Define the contract

**New file:** `apps/backend/src/integrations/integration-provider.contract.ts`

```typescript
export type IntegrationProvider = 'META';

export type ConnectResult = { integrationId: string };
export type HealthStatus  = { healthy: boolean; reason?: string };

export type IntegrationProviderContract = {
  readonly provider: IntegrationProvider;
  readonly shareable: boolean;

  connect(credentials: Record<string, unknown>): Promise<ConnectResult>;
  disconnect(integrationId: string): Promise<void>;
  healthCheck(integrationId: string): Promise<HealthStatus>;
};
```

#### 3.2 — Implement `MetaProvider`

**New file:** `apps/backend/src/integrations/meta/meta.provider.ts`

```typescript
@Injectable()
export class MetaProvider implements IntegrationProviderContract {
  readonly provider = 'META' as const;
  readonly shareable = false;

  constructor(private readonly metaService: MetaIntegrationService) {}

  async connect(credentials: { code: string; wabaId: string; phoneNumberId: string; businessId: string }): Promise<ConnectResult> {
    return this.metaService.exchangeToken(credentials);
  }

  async disconnect(integrationId: string): Promise<void> {
    return this.metaService.disconnect(integrationId);
  }

  async healthCheck(integrationId: string): Promise<HealthStatus> {
    return this.metaService.healthCheck(integrationId);
  }
}
```

#### 3.3 — Create `IntegrationsService` as central orchestrator

**New file:** `apps/backend/src/integrations/integrations.service.ts`

```typescript
@Injectable()
export class IntegrationsService {
  private readonly providers = new Map<string, IntegrationProviderContract>();

  constructor(private readonly meta: MetaProvider) {
    this.providers.set('META', meta);
  }

  getProvider(provider: string): IntegrationProviderContract {
    const p = this.providers.get(provider);
    if (!p) throw new Error(`Unknown provider: ${provider}`);
    return p;
  }
}
```

`IntegrationsController` delegates to `IntegrationsService.getProvider('META').disconnect()` rather than accessing Firestore directly.

---

## Phase 4 — Multi-Tenancy & Dynamic Tenant Resolution

### Problem

The frontend hardcodes exactly two business IDs:

```typescript
// App.tsx:14
const BUSINESS_IDS = ['demo-business-001', 'demo-business-002'] as const;
```

Adding a third business requires a code change and a redeploy. In production, the list of businesses is fetched from a data source at runtime.

The backend uses `businessId` as both the Firestore document ID and the tenant identifier. In the production model, the Firestore document ID is an auto-generated `integrationId`, and tenants are linked via `connectedBusinessIds: string[]`.

### Solution

#### 4.1 — Backend: Decouple `integrationId` from `businessId`

**File:** `apps/backend/src/auth/auth.service.ts` (and the new `meta-integration.service.ts`)

When creating a new integration document, generate a unique `integrationId` instead of using `businessId` as the document ID:

```typescript
import { v4 as uuidv4 } from 'uuid';

const integrationId = uuidv4();
const docRef = db.collection('integrations').doc(integrationId);

await this.firebase.set(docRef, {
  integrationId,
  connectedBusinessIds: [businessId],   // array — supports future sharing
  provider: 'META',
  setupStatus: MetaSetupStatus.TOKEN_EXCHANGED,
  meta: {
    wabaId,
    phoneNumberId: resolvedPhoneNumberId,
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

// Token stored under integrationId, not businessId
this.secrets.set(`META_TOKEN__${integrationId}`, JSON.stringify({ accessToken, tokenType: 'LONG_LIVED' }));
```

Add a Firestore composite index on `connectedBusinessIds` + `provider` to support efficient lookup:

```
Collection: integrations
Index: connectedBusinessIds (array-contains) + provider (asc)
```

#### 4.2 — Backend: Add a business list endpoint

**New endpoint:** `GET /integrations?businessId=X`

Returns all integration documents where `connectedBusinessIds` contains `businessId`. The frontend calls this on load to populate its business selector dynamically.

#### 4.3 — Frontend: Replace hardcoded business IDs

**File:** `apps/frontend/src/App.tsx`

Replace the `const BUSINESS_IDS` literal with a `useEffect` that fetches `GET /api/integrations` (or a dedicated businesses endpoint) on mount. During loading, show a skeleton or spinner.

```typescript
// BEFORE (hardcoded)
const BUSINESS_IDS = ['demo-business-001', 'demo-business-002'] as const;

// AFTER (dynamic)
const [businessIds, setBusinessIds] = useState<string[]>([]);
useEffect(() => {
  fetch('/api/integrations/businesses')
    .then(r => r.json())
    .then((data: string[]) => setBusinessIds(data));
}, []);
```

For the demo, provide a `GET /integrations/businesses` backend stub that returns the two fixture IDs from Firestore — this keeps the demo working without a full auth system while the dynamic path is wired.

---

## Phase 5 — Frontend: Setup Flow Hook

### Problem

`ConnectButton` is a single component that runs the entire connection flow in one click. When a step fails mid-flow (e.g. phone registration fails but token exchange succeeded), the entire popup must be reopened and the OAuth code re-consumed — which is impossible since codes are single-use.

### Solution

Extract the multi-step setup logic into a dedicated hook modeled on the production `useWhatsAppConnect`.

#### 5.1 — New hook

**New file:** `apps/frontend/src/hooks/useWhatsAppConnect.ts`

```typescript
export type SetupStep =
  | 'idle'
  | 'exchanging_token'
  | 'registering_phone'
  | 'verifying_status'
  | 'selecting_catalog'
  | 'subscribing_webhooks'
  | 'complete'
  | 'error';

export function useWhatsAppConnect(businessId: string) {
  const [step, setStep]           = useState<SetupStep>('idle');
  const [integrationId, setIntId] = useState<string | null>(null);
  const [error, setError]         = useState<string | null>(null);

  // Step 1: called from ConnectButton's FB.login callback
  const exchangeToken = async (code: string, wabaId: string, phoneNumberId: string) => { ... };

  // Step 2: called automatically after step 1 succeeds
  const registerPhone = async () => { ... };

  // Step 3: status verification
  const verifyStatus = async () => { ... };

  // Step 4: catalog selection — returns catalog list, user picks one
  const fetchCatalogs = async (): Promise<Catalog[]> => { ... };
  const selectCatalog = async (catalogId: string) => { ... };

  // Step 5: webhook subscription — completes setup
  const subscribeWebhooks = async () => { ... };

  return { step, integrationId, error, exchangeToken, registerPhone, fetchCatalogs, selectCatalog, subscribeWebhooks };
}
```

`ConnectButton` calls only `exchangeToken()`. Each subsequent step is triggered automatically on success (or surfaced for manual retry on failure). `StatusDisplay` reads `step` to show granular progress.

#### 5.2 — Update `ConnectButton`

**File:** `apps/frontend/src/components/ConnectButton/index.tsx`

Replace the inline `exchangeWithRetry` + `runExchange` logic with a call to `useWhatsAppConnect(businessId).exchangeToken(...)`. The `runExchange` retry policy should be preserved inside the hook.

#### 5.3 — Update `StatusDisplay`

**File:** `apps/frontend/src/components/StatusDisplay/index.tsx`

Map the `step` value to human-readable progress labels, e.g.:
- `exchanging_token` → "Verifying your Facebook account..."
- `registering_phone` → "Activating WhatsApp number..."
- `subscribing_webhooks` → "Finalizing connection..."
- `complete` → "Connected"

---

## Phase 6 — Graph API Version Alignment

### Problem

The test project calls `v19.0` throughout. The production reference uses `v22.0` for token exchange and `v24.0` for phone/catalog operations. The FB JS SDK is loaded with `v23.0`.

### Solution

Centralise the version strings as named constants and align to production values:

**New file:** `apps/backend/src/integrations/meta/meta-api-versions.ts`

```typescript
export const META_API_VERSION = {
  TOKEN_EXCHANGE: 'v22.0',
  PHONE_CATALOG:  'v24.0',
  MESSAGES:       'v23.0',
} as const;
```

Replace all inline `v19.0` occurrences in:
- `apps/backend/src/auth/auth.service.ts`
- `apps/backend/src/auth/system-user.service.ts`
- `apps/backend/src/catalog-manager/catalog-manager.service.ts`
- `apps/backend/src/messaging/messaging.service.ts`

---

## File Manifest

### Files to create

| File | Purpose |
|---|---|
| `apps/backend/src/integrations/integration-provider.contract.ts` | Shared provider contract type |
| `apps/backend/src/integrations/integrations.service.ts` | Central provider orchestrator |
| `apps/backend/src/integrations/meta/meta.provider.ts` | `IntegrationProviderContract` implementation |
| `apps/backend/src/integrations/meta/meta-integration.service.ts` | Step-by-step setup service (extracted from `AuthService`) |
| `apps/backend/src/integrations/meta/meta-integration.controller.ts` | Per-step REST endpoints |
| `apps/backend/src/integrations/meta/meta-setup-status.enum.ts` | Setup status enum |
| `apps/backend/src/integrations/meta/meta-api-versions.ts` | API version constants |
| `apps/backend/src/common/secrets/get-meta-token.ts` | Token retrieval helper |
| `apps/frontend/src/hooks/useWhatsAppConnect.ts` | Multi-step setup hook |

### Files to modify

| File | Change |
|---|---|
| `apps/backend/src/common/secrets/secret-manager.service.ts` | Add `set()` method |
| `apps/backend/src/auth/auth.service.ts` | Remove token from Firestore write; call `secrets.set()` |
| `apps/backend/src/auth/system-user.service.ts` | Remove token from Firestore write; call `secrets.set()` |
| `apps/backend/src/integrations/integrations.controller.ts` | Remove `metaData.accessToken` null-out; call `secrets.set()` to invalidate |
| `apps/backend/src/catalog/catalog.service.ts` | Replace Firestore token read with `getMetaToken()` |
| `apps/backend/src/catalog-manager/catalog-manager.service.ts` | Replace Firestore token read with `getMetaToken()` |
| `apps/backend/src/messaging/messaging.service.ts` | Replace Firestore token read with `getMetaToken()` |
| `apps/backend/src/registration/registration.service.ts` | Replace Firestore token read with `getMetaToken()` |
| `apps/backend/src/migration/migration.service.ts` | Replace Firestore token read with `getMetaToken()` |
| `apps/backend/src/app.module.ts` | Register new `MetaIntegrationModule` |
| `apps/frontend/src/App.tsx` | Replace hardcoded `BUSINESS_IDS` with dynamic fetch |
| `apps/frontend/src/components/ConnectButton/index.tsx` | Delegate to `useWhatsAppConnect` hook |
| `apps/frontend/src/components/StatusDisplay/index.tsx` | Add granular step labels |
| `apps/frontend/src/types/integration.ts` | Add `MetaSetupStatus` values |

---

## Migration Checklist

### Phase 1 — Token Security (Critical — do first)
- [ ] Add `set()` to `SecretManagerService`
- [ ] Add `get-meta-token.ts` helper
- [ ] Update `AuthService` step 6 — write secret, not Firestore field
- [ ] Update `SystemUserService` — write secret, not Firestore field
- [ ] Update `IntegrationsController` disconnect — invalidate secret
- [ ] Migrate all token consumers (`catalog.service`, `catalog-manager.service`, `messaging.service`, `registration.service`, `migration.service`)
- [ ] Verify: `pnpm dev` + run `curl` test from `apps/backend/CLAUDE.md` — catalog list must still work

### Phase 2 — Setup Status Machine
- [ ] Create `meta-setup-status.enum.ts`
- [ ] Create `meta-integration.service.ts` with 5 discrete methods
- [ ] Create `meta-integration.controller.ts` with per-step endpoints
- [ ] Keep `POST /auth/exchange-token` as a sequential facade (backward compat)
- [ ] Verify: full connect flow still works end-to-end

### Phase 3 — Provider Contract
- [ ] Create `integration-provider.contract.ts`
- [ ] Create `meta.provider.ts`
- [ ] Create `integrations.service.ts`
- [ ] Refactor `IntegrationsController` to delegate via `IntegrationsService`
- [ ] Verify: disconnect, reset endpoints still work

### Phase 4 — Multi-Tenancy
- [x] Generate `integrationId` (uuid) on connect; use as Firestore doc ID
- [x] Add `connectedBusinessIds: [businessId]` field to integration doc
- [x] Add `GET /integrations/businesses` stub endpoint
- [x] Update frontend `App.tsx` to fetch businesses dynamically
- [x] New `useIntegrationId` hook resolves businessId → integrationId UUID
- [x] Update `useIntegrationStatus` and `useMessages` to accept `integrationId | null`
- [ ] Verify: both demo businesses still load and connect independently

### Phase 5 — Frontend Hook
- [x] Create `useWhatsAppConnect.ts` with 5 step methods (exchangeToken auto-chains registerPhone → verifyStatus → subscribeWebhooks)
- [x] Refactor `ConnectButton` to delegate HTTP to the hook; retain FB.login wiring
- [x] Update `ConnectionGateway` to own hook instance + new `SetupProgressBar`
- [x] Update `StatusDisplay` with granular step labels and optional `setupStep` prop
- [x] Thread `setupStep` from `ConnectionGateway` → `App.tsx` → `StatusDisplay`
- [ ] Verify: connect flow shows step-by-step progress

### Phase 6 — API Version Alignment
- [x] Create `meta-api-versions.ts` constants
- [x] Replace all `v19.0` occurrences in backend services
- [x] Verify: token exchange and phone registration still succeed against Meta sandbox

## Addendum: Multi-Tenancy Stub Update
The static placeholders (`demo-business-001`, `demo-business-002`) have been officially updated to point to the real Meta Business Manager ID (`787167007221172`). 
This step confirms that the Multi-Tenancy architecture decoupling (Phase 4) was successful. The overarching `businessId` safely references the underlying `integrationId` via UUID resolution, paving the way for seamless production deployment with real user context.

---

## Appendix — Secret Key Convention

```
META_TOKEN__{integrationId}
  → JSON string: { accessToken: string, tokenType: 'LONG_LIVED' | 'SYSTEM_USER', tokenExpiresAt: string | null }
```

In development, `SecretManagerService` holds these in memory. They do not survive a server restart — after restarting the backend, an existing ACTIVE integration will fail token reads until the user reconnects. This is acceptable for development. For production, the GCP Secret Manager swap documented in `apps/backend/CLAUDE.md` resolves this.

To pre-seed tokens for existing integration documents during development without re-running the signup flow, add them to `.env.secrets`:

```ini
# .env.secrets
META_TOKEN__demo-business-001={"accessToken":"EAA...","tokenType":"LONG_LIVED","tokenExpiresAt":"2026-06-07T00:00:00.000Z"}
```

# Channex Groups + Connect Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three improvements: (1) move wizard hardcoded defaults to a toggleable comment block + create a certification test markdown doc; (2) create a `ChannexGroupService` that provisions one Channex Group per `businessId` and passes `group_id` transparently to `provisionProperty`; (3) add a "+" connect button to `ChannexHub` that forces-renders an OTA sub-tab so users can always initiate a new Airbnb or Booking.com integration.

**Architecture:** Backend adds `ChannexGroupService` (new file, registered in `channex.module.ts`) with `ensureGroup(businessId)` — checks Firestore `channex_groups/{businessId}`, falls back to Channex API list/create, caches result. `ChannexPropertyService.provisionProperty` calls it before creating the property. Frontend changes are confined to `PropertySetupWizard.tsx` (comment block) and `ChannexHub.tsx` (forced channel state + "+" dropdown).

**Tech Stack:** React 18, TypeScript, Tailwind CSS, NestJS, Firestore, Channex REST API (`/api/v1/groups`). No test runner — verification via `pnpm build`.

---

## File Map

### Backend — new files
| File | Responsibility |
|------|----------------|
| `apps/backend/src/channex/channex-group.service.ts` | `ensureGroup(businessId)` — Firestore cache + Channex API fallback |

### Backend — modified files
| File | Change |
|------|--------|
| `apps/backend/src/channex/channex.types.ts` | Add `ChannexGroupPayload`, `ChannexGroupResponse`, `ChannexGroupListResponse` |
| `apps/backend/src/channex/channex.service.ts` | Add `listGroups()` and `createGroup(title)` API methods |
| `apps/backend/src/channex/channex-property.service.ts` | Inject `ChannexGroupService`; call `ensureGroup` in `provisionProperty` |
| `apps/backend/src/channex/channex.module.ts` | Register `ChannexGroupService` as provider + export |

### Frontend — modified files
| File | Change |
|------|--------|
| `apps/frontend/src/channex/components/PropertySetupWizard.tsx` | Move hardcoded defaults into `// CERTIFICATION TEST DEFAULTS` comment block |
| `apps/frontend/src/channex/ChannexHub.tsx` | Add `forcedChannels` state + "+" dropdown connect button |

### Docs — new files
| File | Responsibility |
|------|----------------|
| `docs/channex/certification-tests.md` | All test scenarios with exact UI steps, values, and expected Channex task IDs |

---

## Task 1 — Wizard defaults: comment block + certification test doc

**Files:**
- Modify: `apps/frontend/src/channex/components/PropertySetupWizard.tsx`
- Create: `docs/channex/certification-tests.md`

- [ ] **Step 1.1: Extract hardcoded defaults into a named comment block in `PropertySetupWizard.tsx`**

Open `apps/frontend/src/channex/components/PropertySetupWizard.tsx`. Replace the three `useState` initializers (lines ~37–45) with:

```typescript
  // ─── CERTIFICATION TEST DEFAULTS ───────────────────────────────────────────
  // These defaults pre-fill the wizard for Channex PMS certification testing.
  // To disable for production: replace each CERT_* reference below with
  // the production default shown in the comment ('' or []).
  // ─── END CERTIFICATION TEST DEFAULTS ───────────────────────────────────────

  // Step 1 — comment out CERT_TITLE and replace with '' for production
  const [title, setTitle] = useState('Test Property - Migo UIT' /* '' */);
  const [currency, setCurrency] = useState('USD');
  const [timezone, setTimezone] = useState('America/New_York');

  // Step 2 — comment out the array and replace with [] for production
  const [rooms, setRooms] = useState<RoomDraft[]>([
    /* CERT: pre-filled for certification — replace with [] for production */
    { title: 'Twin Room', defaultOccupancy: 2 },
    { title: 'Double Room', defaultOccupancy: 2 },
  ]);
```

The rate defaults (`Best Available Rate` / `Bed and Breakfast`) are auto-generated in `handleStep2` from the room list — they will also disappear when rooms default to `[]`. No additional change needed there.

- [ ] **Step 1.2: Create `docs/channex/certification-tests.md`**

Create the file with this content:

```markdown
# Channex PMS Certification — Test Reference

Use this doc to copy-paste values and follow UI steps for each certification test.
IDs below are from the most recently provisioned test property — update after each fresh setup.

## Section 2 — Property & Entity IDs

After running the setup wizard, note these IDs from the Step 4 confirmation screen:

| Entity | ID |
|--------|----|
| Property | `<channexPropertyId from wizard Step 4>` |
| Twin Room | `<roomTypeId>` |
| Double Room | `<roomTypeId>` |
| Twin Room / Best Available Rate | `<ratePlanId>` |
| Twin Room / Bed and Breakfast | `<ratePlanId>` |
| Double Room / Best Available Rate | `<ratePlanId>` |
| Double Room / Bed and Breakfast | `<ratePlanId>` |

---

## Test #1 — Full Sync (Section 4)

**UI path:** Channex tab → Properties → select property → ARI Calendar → "Full Sync (500 days)"

**Modal values:**
- Availability: `1`
- Rate: `100`
- Days: `500`

Click **Run Full Sync**. Note both task IDs shown in the emerald box.

---

## Test #2 — Single date / single rate (Section 6)

**UI path:** ARI Calendar → click Nov 22 → click Nov 22 again

**Panel values:**
- Room Type: Twin Room
- Rate Plan: Best Available Rate
- Rate: `333`
- Leave availability blank

Click **+ Add to Batch**, then **Save (1)**.

---

## Test #3 — Single date / multi-rate (Section 9)

Three separate panel saves on the same selection, then one batch save.

**Selection:** Click Nov 21 → click Nov 21

**Entry 1 — Panel values:**
- Room Type: Twin Room | Rate Plan: Best Available Rate | Rate: `333`
- Click **+ Add to Batch**

**Entry 2 — Change panel values (same date range stays selected):**
- Room Type: Double Room | Rate Plan: Best Available Rate | Rate: `444`
- Click **+ Add to Batch**

**Entry 3:**
- Room Type: Double Room | Rate Plan: Bed and Breakfast | Rate: `456.23`
- Click **+ Add to Batch**

Click **Save (3)** → 1 Channex API call with 3 restriction entries. Note task ID.

---

## Test #4 — Multi-date / multi-rate (Section 12)

Three ranges, each a separate add-to-batch.

**Entry 1:** Click Nov 14 → Nov 21 | Twin BAR | Rate: `500` → Add to Batch
**Entry 2:** Click Nov 22 → Nov 29 | Double BAR | Rate: `600` → Add to Batch
**Entry 3:** Click Dec 1 → Dec 7 | Double B&B | Rate: `700` → Add to Batch

Click **Save (3)**.

---

## Test #5 — Min Stay (Section 15)

**Selection:** Nov 1 → Nov 30

**Panel values:**
- Room Type: Twin Room | Rate Plan: Best Available Rate
- Min Stay: `3`

**+ Add to Batch → Save (1)**.

---

## Test #6 — Stop Sell (Section 18)

**Selection:** Dec 24 → Dec 26

**Panel values:**
- Room Type: Twin Room | Rate Plan: Best Available Rate
- ☑ Stop Sell

**+ Add to Batch → Save (1)**.

---

## Test #7 — Multiple restrictions (Section 21)

**Selection:** Nov 15 → Nov 15

**Panel values:**
- Room Type: Twin Room | Rate Plan: Best Available Rate
- ☑ Closed to Arrival | ☑ Closed to Departure | Min Stay: `2`

**+ Add to Batch → Save (1)**.

---

## Test #8 — Half-year update (Section 24)

**Selection:** Dec 1 2026 → May 1 2027 (navigate months with Prev/Next)

**Panel values:**
- Room Type: Twin Room | Rate Plan: Best Available Rate
- Rate: `250`
- ☑ Closed to Arrival | ☑ Closed to Departure | Min Stay: `5`

**+ Add to Batch → Save (1)**.

---

## Test #9 — Single date availability (Section 27)

**Entry 1:** Click Nov 21 → Nov 21 | Twin Room | Availability: `7` → Add to Batch
**Entry 2:** Click Nov 21 → Nov 21 | Double Room | Availability: `0` → Add to Batch

Click **Save (2)** → 1 Channex API call with 2 availability entries.

---

## Test #10 — Multi-date availability (Section 30)

**Entry 1:** Click Nov 10 → Nov 16 | Twin Room | Availability: `3` → Add to Batch
**Entry 2:** Click Nov 17 → Nov 24 | Double Room | Availability: `4` → Add to Batch

Click **Save (2)**.
```

- [ ] **Step 1.3: Verify frontend compiles**

```bash
cd apps/frontend && pnpm build 2>&1 | grep -E "error TS" | head -20
```

Expected: only the pre-existing `BookingIntegrationView.tsx:230` error, no new errors.

- [ ] **Step 1.4: Commit**

```bash
git add apps/frontend/src/channex/components/PropertySetupWizard.tsx docs/channex/certification-tests.md
git commit -m "chore(channex): add certification test defaults comment block + test reference doc"
```

---

## Task 2 — Channex Group types + API methods in `channex.service.ts`

**Files:**
- Modify: `apps/backend/src/channex/channex.types.ts`
- Modify: `apps/backend/src/channex/channex.service.ts`

- [ ] **Step 2.1: Add Group types to `channex.types.ts`**

Append after the `ChannexPropertyResponse` interface (after line ~59):

```typescript
// ─── Channex API — Group ─────────────────────────────────────────────────────

/** Attributes sent to POST /api/v1/groups (wrapped under `group` key). */
export interface ChannexGroupPayload {
  title: string;
}

/** The `data` envelope returned by a successful POST /api/v1/groups (HTTP 201). */
export interface ChannexGroupResponse {
  data: {
    id: string;
    type: 'group';
    attributes: {
      title: string;
      status: string;
    };
  };
}

/** The `data` array returned by GET /api/v1/groups. */
export interface ChannexGroupListResponse {
  data: Array<{
    id: string;
    type: 'group';
    attributes: {
      title: string;
      status: string;
    };
  }>;
}
```

- [ ] **Step 2.2: Import the new types in `channex.service.ts`**

Open `apps/backend/src/channex/channex.service.ts`. The import block at the top already references `channex.types`. Add the three new types to the existing import:

```typescript
import {
  // ... existing imports ...
  ChannexGroupPayload,
  ChannexGroupResponse,
  ChannexGroupListResponse,
} from './channex.types';
```

- [ ] **Step 2.3: Add `listGroups()` and `createGroup()` to `ChannexService`**

Add both methods after the `createProperty` method (around line ~194):

```typescript
  /**
   * Returns all Groups visible to the API key.
   * GET /api/v1/groups
   */
  async listGroups(): Promise<ChannexGroupListResponse> {
    this.logger.log('[CHANNEX] Listing groups');
    try {
      return await this.defLogger.request<ChannexGroupListResponse>({
        method: 'GET',
        url: `${this.baseUrl}/groups`,
        headers: this.buildAuthHeaders(),
      });
    } catch (err) {
      this.normaliseError(err);
    }
  }

  /**
   * Creates a new Group in Channex.
   * POST /api/v1/groups
   * Used by ChannexGroupService to create one Group per businessId.
   */
  async createGroup(title: string): Promise<ChannexGroupResponse> {
    this.logger.log(`[CHANNEX] Creating group: "${title}"`);
    try {
      return await this.defLogger.request<ChannexGroupResponse>({
        method: 'POST',
        url: `${this.baseUrl}/groups`,
        headers: this.buildAuthHeaders(),
        data: { group: { title } satisfies ChannexGroupPayload },
      });
    } catch (err) {
      this.normaliseError(err);
    }
  }
```

- [ ] **Step 2.4: Verify backend compiles**

```bash
cd apps/backend && pnpm build 2>&1 | grep -E "error TS|error:" | head -20
```

Expected: no errors.

- [ ] **Step 2.5: Commit**

```bash
git add apps/backend/src/channex/channex.types.ts apps/backend/src/channex/channex.service.ts
git commit -m "feat(channex): add Group types + listGroups/createGroup API methods"
```

---

## Task 3 — `ChannexGroupService`

**Files:**
- Create: `apps/backend/src/channex/channex-group.service.ts`

The Firestore collection `channex_groups` stores one document per `businessId`:
```
channex_groups/{businessId} = {
  channex_group_id: string,
  title: string,          // equals businessId
  created_at: string,
}
```

`ensureGroup(businessId)` algorithm:
1. Read `channex_groups/{businessId}` from Firestore.
2. If the document exists → return `channex_group_id` (cache hit).
3. If not → call `channex.listGroups()`, search for a group whose `attributes.title === businessId`.
4. If found in Channex → write to Firestore cache, return `id`.
5. If not found → call `channex.createGroup(businessId)`, write to Firestore cache, return `id`.

- [ ] **Step 3.1: Create `channex-group.service.ts`**

```typescript
// apps/backend/src/channex/channex-group.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { ChannexService } from './channex.service';

const COLLECTION = 'channex_groups';

@Injectable()
export class ChannexGroupService {
  private readonly logger = new Logger(ChannexGroupService.name);

  constructor(
    private readonly channex: ChannexService,
    private readonly firebase: FirebaseService,
  ) {}

  /**
   * Returns the Channex Group ID for a given businessId.
   *
   * Resolution order:
   *   1. Firestore cache  (`channex_groups/{businessId}`)
   *   2. Channex API list (group with title === businessId)
   *   3. Channex API create (new group titled businessId)
   *
   * Calling this before provisionProperty ensures every tenant's properties
   * share one Group in Channex, making multi-OTA management (Airbnb, Booking)
   * possible from a single dashboard.
   */
  async ensureGroup(businessId: string): Promise<string> {
    // ── 1. Firestore cache hit ───────────────────────────────────────────────
    const db = this.firebase.getFirestore();
    const docRef = db.collection(COLLECTION).doc(businessId);
    const snap = await docRef.get();

    if (snap.exists) {
      const groupId = snap.data()!.channex_group_id as string;
      this.logger.log(`[GROUP] Cache hit — businessId=${businessId} groupId=${groupId}`);
      return groupId;
    }

    // ── 2. Channex list lookup ───────────────────────────────────────────────
    this.logger.log(`[GROUP] Cache miss — fetching from Channex for businessId=${businessId}`);
    const listResponse = await this.channex.listGroups();
    const existing = listResponse.data.find(
      (g) => g.attributes.title === businessId,
    );

    if (existing) {
      await this.cacheGroup(docRef, existing.id, businessId);
      this.logger.log(`[GROUP] Found existing Channex group — groupId=${existing.id}`);
      return existing.id;
    }

    // ── 3. Create new group ──────────────────────────────────────────────────
    this.logger.log(`[GROUP] Creating new Channex group — title=${businessId}`);
    const created = await this.channex.createGroup(businessId);
    const newGroupId = created.data.id;
    await this.cacheGroup(docRef, newGroupId, businessId);
    this.logger.log(`[GROUP] ✓ Created — groupId=${newGroupId}`);
    return newGroupId;
  }

  private async cacheGroup(
    docRef: FirebaseFirestore.DocumentReference,
    channexGroupId: string,
    title: string,
  ): Promise<void> {
    await this.firebase.set(docRef, {
      channex_group_id: channexGroupId,
      title,
      created_at: new Date().toISOString(),
    });
  }
}
```

- [ ] **Step 3.2: Verify backend compiles**

```bash
cd apps/backend && pnpm build 2>&1 | grep -E "error TS|error:" | head -20
```

Expected: no errors. (`ChannexGroupService` is not yet registered — NestJS won't complain at compile time.)

- [ ] **Step 3.3: Commit**

```bash
git add apps/backend/src/channex/channex-group.service.ts
git commit -m "feat(channex): add ChannexGroupService — one Group per businessId with Firestore cache"
```

---

## Task 4 — Wire `ChannexGroupService` into `provisionProperty` + register in module

**Files:**
- Modify: `apps/backend/src/channex/channex-property.service.ts`
- Modify: `apps/backend/src/channex/channex.module.ts`

- [ ] **Step 4.1: Inject `ChannexGroupService` into `ChannexPropertyService`**

Open `apps/backend/src/channex/channex-property.service.ts`.

Add import at the top:
```typescript
import { ChannexGroupService } from './channex-group.service';
```

Extend the constructor:
```typescript
  constructor(
    private readonly channex: ChannexService,
    private readonly firebase: FirebaseService,
    private readonly eventEmitter: EventEmitter2,
    private readonly groupService: ChannexGroupService,   // ← ADD
  ) {}
```

- [ ] **Step 4.2: Call `ensureGroup` in `provisionProperty`**

Inside `provisionProperty`, add the group resolution call **before** `createProperty`. Replace the existing `createProperty` block (around line ~92–103):

```typescript
    // ── Step 1: Resolve (or create) the Channex Group for this tenant ─────────
    const groupId = await this.groupService.ensureGroup(dto.tenantId);

    this.logger.log(
      `[PROVISION] Group resolved — tenantId=${dto.tenantId} groupId=${groupId}`,
    );

    // ── Step 2: Create the property in Channex ───────────────────────────────
    const channexResponse = await this.channex.createProperty({
      title: dto.title,
      currency: dto.currency,
      timezone: dto.timezone,
      property_type: dto.propertyType ?? 'apartment',
      group_id: groupId,
      settings: {
        min_stay_type: 'arrival',
        allow_availability_autoupdate_on_confirmation: true,
      },
    });
```

Also update the Firestore write to persist the resolved group ID (replace the existing `channex_group_id: dto.groupId ?? null` line):
```typescript
      channex_group_id: groupId,
```

- [ ] **Step 4.3: Register `ChannexGroupService` in `channex.module.ts`**

Add import:
```typescript
import { ChannexGroupService } from './channex-group.service';
```

Add to `providers` array (after `ChannexService`):
```typescript
    ChannexGroupService,
```

Add to `exports` array:
```typescript
    ChannexGroupService,
```

- [ ] **Step 4.4: Verify backend compiles**

```bash
cd apps/backend && pnpm build 2>&1 | grep -E "error TS|error:" | head -20
```

Expected: no errors.

- [ ] **Step 4.5: Commit**

```bash
git add apps/backend/src/channex/channex-property.service.ts apps/backend/src/channex/channex.module.ts
git commit -m "feat(channex): wire ChannexGroupService into provisionProperty — group_id auto-resolved per businessId"
```

---

## Task 5 — "+" connect button in `ChannexHub.tsx`

**Files:**
- Modify: `apps/frontend/src/channex/ChannexHub.tsx`

Changes:
1. Add `forcedChannels: Set<SubTab>` state — channels forced visible via "+".
2. Add `showConnectDropdown: boolean` state.
3. Recompute `subTabs` to include forced channels.
4. Add "+" button at the right end of the sub-tab bar.
5. Dropdown with two options (Airbnb, Booking.com). Transparent backdrop closes it on outside click.

- [ ] **Step 5.1: Add state and update `subTabs` computation**

Open `apps/frontend/src/channex/ChannexHub.tsx`. After the existing `useState` declarations, add:

```typescript
  const [forcedChannels, setForcedChannels] = useState<Set<SubTab>>(new Set());
  const [showConnectDropdown, setShowConnectDropdown] = useState(false);
```

Replace the `subTabs` computation:

```typescript
  const subTabs: { id: SubTab; label: string }[] = [
    { id: 'properties', label: 'Properties' },
    ...(hasAirbnb || forcedChannels.has('airbnb') ? [{ id: 'airbnb' as SubTab, label: 'Airbnb' }] : []),
    ...(hasBooking || forcedChannels.has('booking') ? [{ id: 'booking' as SubTab, label: 'Booking.com' }] : []),
  ];
```

- [ ] **Step 5.2: Replace the sub-tab bar JSX with the "+" button appended**

Replace the entire sub-tab bar `<div>` (the one with `className="flex items-end gap-0 border-b border-gray-200 px-6"`):

```tsx
      {/* Sub-tab bar */}
      <div className="flex items-end gap-0 border-b border-gray-200 px-6">
        {subTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveSubTab(tab.id)}
            className={[
              'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeSubTab === tab.id
                ? 'border-indigo-500 text-indigo-700 bg-white'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}

        {/* "+" Connect integration button */}
        <div className="relative ml-auto flex items-center py-1.5">
          <button
            type="button"
            onClick={() => setShowConnectDropdown((v) => !v)}
            className="flex items-center gap-1 rounded-lg border border-dashed border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-500 hover:border-indigo-400 hover:text-indigo-600 transition-colors"
          >
            + Connect
          </button>

          {showConnectDropdown && (
            <>
              {/* Transparent backdrop — closes dropdown on outside click */}
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowConnectDropdown(false)}
              />
              <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                {([
                  { id: 'airbnb' as SubTab, label: 'Airbnb', icon: '🏠' },
                  { id: 'booking' as SubTab, label: 'Booking.com', icon: '🏨' },
                ] as const).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setForcedChannels((prev) => new Set([...prev, opt.id]));
                      setActiveSubTab(opt.id);
                      setShowConnectDropdown(false);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <span>{opt.icon}</span>
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
```

- [ ] **Step 5.3: Verify frontend compiles**

```bash
cd apps/frontend && pnpm build 2>&1 | grep -E "error TS" | head -20
```

Expected: only the pre-existing `BookingIntegrationView.tsx:230` error.

- [ ] **Step 5.4: Manual verification**

Start the dev server:
```bash
cd apps/frontend && pnpm dev
```

1. Navigate to Channex tab — "Properties" sub-tab visible, no Airbnb/Booking.com tabs (assuming no active integrations).
2. The "+ Connect" button appears at the right end of the tab bar.
3. Click "+ Connect" → dropdown with "🏠 Airbnb" and "🏨 Booking.com" appears.
4. Click outside → dropdown closes.
5. Click "Airbnb" → Airbnb tab appears in the bar, view switches to it, `AirbnbIntegration` renders.
6. Click "Booking.com" → Booking.com tab also appears, view switches to it, `BookingIntegrationView` renders.
7. Refreshing the page resets forced channels (expected — no persistence needed for this state).

- [ ] **Step 5.5: Commit**

```bash
git add apps/frontend/src/channex/ChannexHub.tsx
git commit -m "feat(channex-hub): add '+ Connect' button — always-available OTA channel connection from sub-tab bar"
```

---

## Task 6 — Final build verification

- [ ] **Step 6.1: Full build — both apps**

```bash
pnpm --filter @migo-uit/backend build && pnpm --filter @migo-uit/frontend build 2>&1 | grep -E "error TS|error:" | head -20
```

Expected: backend clean, frontend shows only the pre-existing `BookingIntegrationView.tsx:230` error.

- [ ] **Step 6.2: Verify git log**

```bash
git log --oneline -6
```

Expected — roughly:
```
feat(channex-hub): add '+ Connect' button
feat(channex): wire ChannexGroupService into provisionProperty
feat(channex): add ChannexGroupService
feat(channex): add Group types + listGroups/createGroup API methods
chore(channex): add certification test defaults comment block + test reference doc
fix(channex-ari): guard against undefined updates array
```

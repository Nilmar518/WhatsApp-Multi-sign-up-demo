# ARI Calendar Snapshot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store pushed ARI data in Firestore so the calendar can display availability counts, rates, and restriction status per day without consuming Channex API quota on reads; add a "Refresh from Channex" button to pull real state on demand.

**Architecture:** Firestore sub-collection `ari_snapshots/{YYYY-MM}` under each property stores a monthly document keyed by room_type_id/rate_plan_id × date. Every successful ARI push writes optimistically to that store. A separate `POST /ari-refresh` endpoint calls Channex `GET /availability` and `GET /restrictions` and overwrites the snapshot. The calendar reads from Firestore — zero Channex quota on render.

**Tech Stack:** NestJS (TypeScript), Firebase Admin SDK (Firestore), React + Tailwind CSS, Channex REST API v1.

---

## Firestore Document Shape

Path: `channex_integrations/{tenantId}/properties/{propertyId}/ari_snapshots/{YYYY-MM}`

```typescript
// Written and read by ChannexARISnapshotService
interface ARIMonthSnapshot {
  month: string;           // "2026-11"
  updated_at: string;      // ISO timestamp
  source: 'push' | 'pull'; // 'push' = optimistic after our push; 'pull' = refreshed from Channex
  availability: {
    [room_type_id: string]: {
      [date: string]: number; // "2026-11-01": 3
    };
  };
  restrictions: {
    [rate_plan_id: string]: {
      [date: string]: {
        rate?: string;
        min_stay_arrival?: number;
        max_stay?: number | null;
        stop_sell?: boolean;
        closed_to_arrival?: boolean;
        closed_to_departure?: boolean;
      };
    };
  };
}
```

---

## File Map

| Action | File |
|--------|------|
| **Create** | `apps/backend/src/channex/channex-ari-snapshot.service.ts` |
| **Modify** | `apps/backend/src/channex/channex.service.ts` — add `fetchAvailability()` + `fetchRestrictions()` |
| **Modify** | `apps/backend/src/channex/channex-ari.service.ts` — inject SnapshotService, call after each push |
| **Modify** | `apps/backend/src/channex/channex-ari.controller.ts` — add GET `/ari-snapshot` + POST `/ari-refresh` |
| **Modify** | `apps/backend/src/channex/channex.module.ts` — register SnapshotService |
| **Modify** | `apps/frontend/src/channex/api/channexHubApi.ts` — add types + API functions |
| **Modify** | `apps/frontend/src/channex/components/ARICalendarFull.tsx` — display snapshot + refresh button + day detail |

---

## Task 1 — Add Channex read methods to ChannexService

**Files:**
- Modify: `apps/backend/src/channex/channex.service.ts`
- Modify: `apps/backend/src/channex/channex.types.ts`

These are the two new response types. Add them to `channex.types.ts` just before the `ChannexARIResponse` interface:

- [ ] **Step 1: Add read response types to channex.types.ts**

Find the line `// ─── Channex API — ARI` in `apps/backend/src/channex/channex.types.ts` (around line 461) and add before `AvailabilityEntryDto`:

```typescript
/**
 * Response from GET /api/v1/availability
 * data[room_type_id][date] = availability integer
 */
export interface ChannexAvailabilityReadResponse {
  data: Record<string, Record<string, number>>;
}

/**
 * Response from GET /api/v1/restrictions
 * data[rate_plan_id][date][restriction_key] = value
 */
export interface ChannexRestrictionsReadResponse {
  data: Record<string, Record<string, {
    rate?: string;
    min_stay_arrival?: number;
    max_stay?: number | null;
    stop_sell?: boolean;
    closed_to_arrival?: boolean;
    closed_to_departure?: boolean;
  }>>;
}
```

- [ ] **Step 2: Add `fetchAvailability` to ChannexService**

In `apps/backend/src/channex/channex.service.ts`, import the new types at the top where other types are imported:

```typescript
import type {
  // ... existing imports ...
  ChannexAvailabilityReadResponse,
  ChannexRestrictionsReadResponse,
} from './channex.types';
```

Add this method after `pushRestrictions` (around line 1036):

```typescript
/**
 * Reads current availability per room type for a date range.
 * GET /api/v1/availability
 * Rate limit: shared 10/min per property with push endpoints.
 *
 * @param propertyId  Channex property UUID
 * @param dateFrom    ISO date string "YYYY-MM-DD"
 * @param dateTo      ISO date string "YYYY-MM-DD"
 * @returns Map of room_type_id → date → availability count
 */
async fetchAvailability(
  propertyId: string,
  dateFrom: string,
  dateTo: string,
): Promise<Record<string, Record<string, number>>> {
  this.logger.log(
    `[CHANNEX] Fetching availability — propertyId=${propertyId} ${dateFrom}→${dateTo}`,
  );

  try {
    const params = new URLSearchParams({
      'filter[property_id]': propertyId,
      'filter[date][gte]': dateFrom,
      'filter[date][lte]': dateTo,
    });

    const response = await this.defLogger.request<ChannexAvailabilityReadResponse>({
      method: 'GET',
      url: `${this.baseUrl}/availability?${params.toString()}`,
      headers: this.buildAuthHeaders(),
    });

    return response?.data ?? {};
  } catch (err) {
    this.normaliseError(err);
    return {};
  }
}

/**
 * Reads current restrictions + rates per rate plan for a date range.
 * GET /api/v1/restrictions
 * Rate limit: shared 10/min per property with push endpoints.
 *
 * @param propertyId  Channex property UUID
 * @param dateFrom    ISO date string "YYYY-MM-DD"
 * @param dateTo      ISO date string "YYYY-MM-DD"
 * @returns Map of rate_plan_id → date → restriction fields
 */
async fetchRestrictions(
  propertyId: string,
  dateFrom: string,
  dateTo: string,
): Promise<ChannexRestrictionsReadResponse['data']> {
  this.logger.log(
    `[CHANNEX] Fetching restrictions — propertyId=${propertyId} ${dateFrom}→${dateTo}`,
  );

  try {
    const params = new URLSearchParams({
      'filter[property_id]': propertyId,
      'filter[date][gte]': dateFrom,
      'filter[date][lte]': dateTo,
      'filter[restrictions]': 'rate,min_stay_arrival,max_stay,stop_sell,closed_to_arrival,closed_to_departure',
    });

    const response = await this.defLogger.request<ChannexRestrictionsReadResponse>({
      method: 'GET',
      url: `${this.baseUrl}/restrictions?${params.toString()}`,
      headers: this.buildAuthHeaders(),
    });

    return response?.data ?? {};
  } catch (err) {
    this.normaliseError(err);
    return {};
  }
}
```

- [ ] **Step 3: TypeScript check**

```bash
cd apps/backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/channex/channex.types.ts apps/backend/src/channex/channex.service.ts
git commit -m "feat(channex): add fetchAvailability + fetchRestrictions GET methods to ChannexService"
```

---

## Task 2 — Create ChannexARISnapshotService

**Files:**
- Create: `apps/backend/src/channex/channex-ari-snapshot.service.ts`

This service owns all snapshot reads and writes. It resolves the Firestore document path internally so callers only need `propertyId`.

- [ ] **Step 1: Create the file**

Create `apps/backend/src/channex/channex-ari-snapshot.service.ts` with this exact content:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { ChannexService } from './channex.service';
import { ChannexPropertyService } from './channex-property.service';
import type { AvailabilityEntryDto, RestrictionEntryDto } from './channex.types';

const INTEGRATIONS_COLLECTION = 'channex_integrations';
const SNAPSHOTS_SUBCOLLECTION = 'ari_snapshots';

export interface ARIDayRestrictions {
  rate?: string;
  min_stay_arrival?: number;
  max_stay?: number | null;
  stop_sell?: boolean;
  closed_to_arrival?: boolean;
  closed_to_departure?: boolean;
}

export interface ARIMonthSnapshot {
  month: string;
  updated_at: string;
  source: 'push' | 'pull';
  availability: Record<string, Record<string, number>>;
  restrictions: Record<string, Record<string, ARIDayRestrictions>>;
}

/** Expands a date range into individual ISO date strings. */
function expandRange(dateFrom: string, dateTo: string): string[] {
  const dates: string[] = [];
  const cur = new Date(dateFrom + 'T00:00:00Z');
  const end = new Date(dateTo + 'T00:00:00Z');
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

/** Groups date strings by YYYY-MM month key. */
function groupByMonth(dates: string[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const d of dates) {
    const month = d.slice(0, 7);
    (result[month] ??= []).push(d);
  }
  return result;
}

@Injectable()
export class ChannexARISnapshotService {
  private readonly logger = new Logger(ChannexARISnapshotService.name);

  constructor(
    private readonly firebase: FirebaseService,
    private readonly channex: ChannexService,
    private readonly propertyService: ChannexPropertyService,
  ) {}

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async resolveDocRef(propertyId: string) {
    const integration = await this.propertyService.resolveIntegration(propertyId);
    if (!integration) return null;
    return this.firebase
      .getFirestore()
      .collection(INTEGRATIONS_COLLECTION)
      .doc(integration.firestoreDocId)
      .collection('properties')
      .doc(propertyId)
      .collection(SNAPSHOTS_SUBCOLLECTION);
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Returns the Firestore snapshot for a given month.
   * Returns null if the property is unknown or no snapshot exists yet.
   *
   * @param propertyId  Channex property UUID
   * @param month       "YYYY-MM"
   */
  async getSnapshot(propertyId: string, month: string): Promise<ARIMonthSnapshot | null> {
    const col = await this.resolveDocRef(propertyId);
    if (!col) return null;

    const snap = await col.doc(month).get();
    if (!snap.exists) return null;

    return snap.data() as ARIMonthSnapshot;
  }

  /**
   * Writes availability updates into the monthly snapshot documents.
   * Called optimistically after a successful pushAvailability to Channex.
   * Uses a Firestore transaction per affected month to avoid partial overwrites.
   *
   * @param propertyId  Channex property UUID
   * @param updates     Same array passed to Channex (without property_id injected)
   */
  async applyAvailabilityUpdates(
    propertyId: string,
    updates: Pick<AvailabilityEntryDto, 'room_type_id' | 'date_from' | 'date_to' | 'availability'>[],
  ): Promise<void> {
    const col = await this.resolveDocRef(propertyId);
    if (!col) return;

    const db = this.firebase.getFirestore();

    // Group all updates by month so we do one transaction per month doc.
    const monthMap: Record<string, { roomTypeId: string; date: string; availability: number }[]> = {};

    for (const u of updates) {
      const dates = expandRange(u.date_from, u.date_to);
      const byMonth = groupByMonth(dates);
      for (const [month, days] of Object.entries(byMonth)) {
        (monthMap[month] ??= []).push(
          ...days.map((d) => ({ roomTypeId: u.room_type_id, date: d, availability: u.availability })),
        );
      }
    }

    await Promise.all(
      Object.entries(monthMap).map(([month, entries]) => {
        const docRef = col.doc(month);
        return db.runTransaction(async (tx) => {
          const snap = await tx.get(docRef);
          const existing = (snap.data() as ARIMonthSnapshot | undefined) ?? {
            month,
            updated_at: '',
            source: 'push' as const,
            availability: {},
            restrictions: {},
          };

          for (const { roomTypeId, date, availability } of entries) {
            existing.availability[roomTypeId] ??= {};
            existing.availability[roomTypeId][date] = availability;
          }
          existing.updated_at = new Date().toISOString();
          existing.source = 'push';

          tx.set(docRef, existing);
        });
      }),
    );

    this.logger.log(
      `[SNAPSHOT] ✓ Availability applied — propertyId=${propertyId} months=${Object.keys(monthMap).join(',')}`,
    );
  }

  /**
   * Writes restriction/rate updates into the monthly snapshot documents.
   * Called optimistically after a successful pushRestrictions to Channex.
   *
   * @param propertyId  Channex property UUID
   * @param updates     Same array passed to Channex
   */
  async applyRestrictionUpdates(
    propertyId: string,
    updates: Pick<RestrictionEntryDto, 'rate_plan_id' | 'date_from' | 'date_to' | 'rate' | 'min_stay_arrival' | 'max_stay' | 'stop_sell' | 'closed_to_arrival' | 'closed_to_departure'>[],
  ): Promise<void> {
    const col = await this.resolveDocRef(propertyId);
    if (!col) return;

    const db = this.firebase.getFirestore();

    const monthMap: Record<string, { ratePlanId: string; date: string; fields: ARIDayRestrictions }[]> = {};

    for (const u of updates) {
      const dates = expandRange(u.date_from, u.date_to);
      const byMonth = groupByMonth(dates);
      const fields: ARIDayRestrictions = {};
      if (u.rate !== undefined) fields.rate = u.rate;
      if (u.min_stay_arrival !== undefined) fields.min_stay_arrival = u.min_stay_arrival;
      if (u.max_stay !== undefined) fields.max_stay = u.max_stay;
      if (u.stop_sell !== undefined) fields.stop_sell = u.stop_sell;
      if (u.closed_to_arrival !== undefined) fields.closed_to_arrival = u.closed_to_arrival;
      if (u.closed_to_departure !== undefined) fields.closed_to_departure = u.closed_to_departure;

      for (const [month, days] of Object.entries(byMonth)) {
        (monthMap[month] ??= []).push(
          ...days.map((d) => ({ ratePlanId: u.rate_plan_id, date: d, fields })),
        );
      }
    }

    await Promise.all(
      Object.entries(monthMap).map(([month, entries]) => {
        const docRef = col.doc(month);
        return db.runTransaction(async (tx) => {
          const snap = await tx.get(docRef);
          const existing = (snap.data() as ARIMonthSnapshot | undefined) ?? {
            month,
            updated_at: '',
            source: 'push' as const,
            availability: {},
            restrictions: {},
          };

          for (const { ratePlanId, date, fields } of entries) {
            existing.restrictions[ratePlanId] ??= {};
            existing.restrictions[ratePlanId][date] = {
              ...(existing.restrictions[ratePlanId][date] ?? {}),
              ...fields,
            };
          }
          existing.updated_at = new Date().toISOString();
          existing.source = 'push';

          tx.set(docRef, existing);
        });
      }),
    );

    this.logger.log(
      `[SNAPSHOT] ✓ Restrictions applied — propertyId=${propertyId} months=${Object.keys(monthMap).join(',')}`,
    );
  }

  /**
   * Pulls current ARI state from Channex for a date range and overwrites
   * the corresponding monthly snapshot documents in Firestore.
   *
   * Consumes 2 Channex API calls (GET availability + GET restrictions).
   * Only call this from the explicit "Refresh from Channex" user action —
   * never call automatically on every calendar render.
   *
   * @param propertyId  Channex property UUID
   * @param dateFrom    ISO date string "YYYY-MM-DD"
   * @param dateTo      ISO date string "YYYY-MM-DD"
   * @returns Array of months that were updated ("YYYY-MM" strings)
   */
  async refreshFromChannex(
    propertyId: string,
    dateFrom: string,
    dateTo: string,
  ): Promise<string[]> {
    const col = await this.resolveDocRef(propertyId);
    if (!col) return [];

    this.logger.log(
      `[SNAPSHOT] Refreshing from Channex — propertyId=${propertyId} ${dateFrom}→${dateTo}`,
    );

    const [availabilityData, restrictionsData] = await Promise.all([
      this.channex.fetchAvailability(propertyId, dateFrom, dateTo),
      this.channex.fetchRestrictions(propertyId, dateFrom, dateTo),
    ]);

    // Build per-month maps from the flat Channex response
    const monthsAvail: Record<string, ARIMonthSnapshot['availability']> = {};
    for (const [roomTypeId, days] of Object.entries(availabilityData)) {
      for (const [date, avail] of Object.entries(days)) {
        const month = date.slice(0, 7);
        monthsAvail[month] ??= {};
        monthsAvail[month][roomTypeId] ??= {};
        monthsAvail[month][roomTypeId][date] = avail;
      }
    }

    const monthsRestrict: Record<string, ARIMonthSnapshot['restrictions']> = {};
    for (const [ratePlanId, days] of Object.entries(restrictionsData)) {
      for (const [date, fields] of Object.entries(days)) {
        const month = date.slice(0, 7);
        monthsRestrict[month] ??= {};
        monthsRestrict[month][ratePlanId] ??= {};
        monthsRestrict[month][ratePlanId][date] = fields;
      }
    }

    const allMonths = new Set([
      ...Object.keys(monthsAvail),
      ...Object.keys(monthsRestrict),
    ]);

    const db = this.firebase.getFirestore();
    await Promise.all(
      [...allMonths].map((month) => {
        const docRef = col.doc(month);
        return db.runTransaction(async (tx) => {
          const snap = await tx.get(docRef);
          const existing = (snap.data() as ARIMonthSnapshot | undefined) ?? {
            month,
            updated_at: '',
            source: 'pull' as const,
            availability: {},
            restrictions: {},
          };

          // Merge: overwrite only the dates returned by Channex, keep the rest
          for (const [roomTypeId, days] of Object.entries(monthsAvail[month] ?? {})) {
            existing.availability[roomTypeId] ??= {};
            Object.assign(existing.availability[roomTypeId], days);
          }
          for (const [ratePlanId, days] of Object.entries(monthsRestrict[month] ?? {})) {
            existing.restrictions[ratePlanId] ??= {};
            for (const [date, fields] of Object.entries(days)) {
              existing.restrictions[ratePlanId][date] = {
                ...(existing.restrictions[ratePlanId][date] ?? {}),
                ...fields,
              };
            }
          }
          existing.updated_at = new Date().toISOString();
          existing.source = 'pull';

          tx.set(docRef, existing);
        });
      }),
    );

    const updatedMonths = [...allMonths].sort();
    this.logger.log(
      `[SNAPSHOT] ✓ Refresh complete — propertyId=${propertyId} months=${updatedMonths.join(',')}`,
    );
    return updatedMonths;
  }
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd apps/backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/channex/channex-ari-snapshot.service.ts
git commit -m "feat(channex): add ChannexARISnapshotService — Firestore ARI snapshot read/write/refresh"
```

---

## Task 3 — Wire snapshot writes into pushAvailability / pushRestrictions

**Files:**
- Modify: `apps/backend/src/channex/channex-ari.service.ts`

After each successful Channex push, write optimistically to Firestore. The snapshot write is fire-and-forget (we don't fail the push if the snapshot write fails).

- [ ] **Step 1: Inject ChannexARISnapshotService**

At the top of `channex-ari.service.ts`, add the import:

```typescript
import { ChannexARISnapshotService } from './channex-ari-snapshot.service';
```

In the constructor (around line 92), add the new dependency:

```typescript
constructor(
  private readonly channex: ChannexService,
  private readonly propertyService: ChannexPropertyService,
  private readonly firebase: FirebaseService,
  private readonly rateLimiter: ChannexARIRateLimiter,
  private readonly snapshot: ChannexARISnapshotService,
) {}
```

- [ ] **Step 2: Write snapshot after pushAvailability**

Replace the current `pushAvailability` method body (around line 296):

```typescript
async pushAvailability(updates: AvailabilityEntryDto[]): Promise<string> {
  if (!updates.length) return '';

  const propertyId = updates[0].property_id;

  this.logger.log(
    `[ARI] Pushing availability — propertyId=${propertyId} ${updates.length} entry(s)`,
  );

  await this.rateLimiter.acquire(propertyId, 'availability');
  const taskId = await this.channex.pushAvailability(updates);

  this.logger.log(`[ARI] ✓ Availability pushed — taskId=${taskId}`);

  // Optimistic snapshot write — fire-and-forget, never fail the push
  this.snapshot.applyAvailabilityUpdates(propertyId, updates).catch((err: unknown) => {
    this.logger.error(
      `[ARI] Snapshot write failed after availability push — propertyId=${propertyId} err=${String(err)}`,
    );
  });

  return taskId;
}
```

- [ ] **Step 3: Write snapshot after pushRestrictions**

Replace the current `pushRestrictions` method body (around line 323):

```typescript
async pushRestrictions(updates: RestrictionEntryDto[]): Promise<string> {
  if (!updates.length) return '';

  const propertyId = updates[0].property_id;

  this.logger.log(
    `[ARI] Pushing restrictions — propertyId=${propertyId} ${updates.length} entry(s)`,
  );

  await this.rateLimiter.acquire(propertyId, 'restrictions');
  const taskId = await this.channex.pushRestrictions(updates);

  this.logger.log(`[ARI] ✓ Restrictions pushed — taskId=${taskId}`);

  // Optimistic snapshot write — fire-and-forget, never fail the push
  this.snapshot.applyRestrictionUpdates(propertyId, updates).catch((err: unknown) => {
    this.logger.error(
      `[ARI] Snapshot write failed after restrictions push — propertyId=${propertyId} err=${String(err)}`,
    );
  });

  return taskId;
}
```

- [ ] **Step 4: TypeScript check**

```bash
cd apps/backend && npx tsc --noEmit
```

Expected: no errors. (Will fail on DI until Task 4 registers the service — that's OK, run the TS check only, not the app.)

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/channex/channex-ari.service.ts
git commit -m "feat(channex): write ARI snapshot optimistically after each push (availability + restrictions)"
```

---

## Task 4 — Register service + add controller endpoints

**Files:**
- Modify: `apps/backend/src/channex/channex.module.ts`
- Modify: `apps/backend/src/channex/channex-ari.controller.ts`

- [ ] **Step 1: Register ChannexARISnapshotService in the module**

In `apps/backend/src/channex/channex.module.ts`, add the import:

```typescript
import { ChannexARISnapshotService } from './channex-ari-snapshot.service';
```

Add to the `providers` array after `ChannexARIRateLimiter`:

```typescript
ChannexARISnapshotService,
```

- [ ] **Step 2: Add DTOs and imports to the controller**

At the top of `apps/backend/src/channex/channex-ari.controller.ts`, add to the NestJS imports:

```typescript
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
```

Add these imports after the existing DTO imports:

```typescript
import { ChannexARISnapshotService, type ARIMonthSnapshot } from './channex-ari-snapshot.service';
```

Add two new DTO classes at the bottom of the existing DTOs section (before the `@Controller` decorator):

```typescript
class AriSnapshotQueryDto {
  @IsString()
  month: string; // "YYYY-MM"
}

class AriRefreshDto {
  @IsString()
  dateFrom: string; // "YYYY-MM-DD"

  @IsString()
  dateTo: string; // "YYYY-MM-DD"
}
```

Update the constructor to inject the new service:

```typescript
constructor(
  private readonly ariService: ChannexARIService,
  private readonly snapshotService: ChannexARISnapshotService,
) {}
```

- [ ] **Step 3: Add GET /ari-snapshot endpoint**

Add after the `fullSync` method in the controller:

```typescript
/**
 * GET /channex/properties/:propertyId/ari-snapshot?month=YYYY-MM
 *
 * Returns the Firestore ARI snapshot for the given month.
 * Reads from Firestore — no Channex API call, no rate limit consumed.
 *
 * Returns: ARIMonthSnapshot | null
 * Status: 200 OK
 */
@Get('ari-snapshot')
async getARISnapshot(
  @Param('propertyId') propertyId: string,
  @Query() query: AriSnapshotQueryDto,
): Promise<ARIMonthSnapshot | null> {
  this.logger.log(`[CTRL] GET /ari-snapshot — propertyId=${propertyId} month=${query.month}`);
  return this.snapshotService.getSnapshot(propertyId, query.month);
}

/**
 * POST /channex/properties/:propertyId/ari-refresh
 *
 * Pulls current ARI from Channex (GET /availability + GET /restrictions)
 * and overwrites the Firestore snapshot for the given date range.
 * Consumes 2 Channex API calls — only call from explicit user action.
 *
 * Body:    { dateFrom: "YYYY-MM-DD", dateTo: "YYYY-MM-DD" }
 * Returns: { updatedMonths: string[] }
 * Status: 200 OK
 */
@Post('ari-refresh')
@HttpCode(HttpStatus.OK)
async refreshARISnapshot(
  @Param('propertyId') propertyId: string,
  @Body() dto: AriRefreshDto,
): Promise<{ updatedMonths: string[] }> {
  this.logger.log(
    `[CTRL] POST /ari-refresh — propertyId=${propertyId} ${dto.dateFrom}→${dto.dateTo}`,
  );
  const updatedMonths = await this.snapshotService.refreshFromChannex(
    propertyId,
    dto.dateFrom,
    dto.dateTo,
  );
  return { updatedMonths };
}
```

- [ ] **Step 4: TypeScript check**

```bash
cd apps/backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Smoke test — verify the endpoints exist**

Start the backend (`pnpm dev` from the repo root or `apps/backend`), then in another terminal:

```bash
# Should return null (no snapshot yet) — 200 OK
curl "http://localhost:3001/channex/properties/e120bb53-798a-42f9-b92a-f910809093ff/ari-snapshot?month=2026-11"

# Should trigger a Channex pull and return { updatedMonths: [...] }
curl -X POST "http://localhost:3001/channex/properties/e120bb53-798a-42f9-b92a-f910809093ff/ari-refresh" \
  -H "Content-Type: application/json" \
  -d '{"dateFrom":"2026-11-01","dateTo":"2026-11-30"}'
```

Check backend logs for:
```
[CTRL] POST /ari-refresh — propertyId=... 2026-11-01→2026-11-30
[CHANNEX] Fetching availability — propertyId=...
[CHANNEX] Fetching restrictions — propertyId=...
[SNAPSHOT] ✓ Refresh complete — propertyId=... months=2026-11
```

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/channex/channex.module.ts apps/backend/src/channex/channex-ari.controller.ts
git commit -m "feat(channex): add GET /ari-snapshot and POST /ari-refresh endpoints"
```

---

## Task 5 — Frontend API client types + functions

**Files:**
- Modify: `apps/frontend/src/channex/api/channexHubApi.ts`

- [ ] **Step 1: Add types and API functions**

At the end of `apps/frontend/src/channex/api/channexHubApi.ts` (after the `triggerFullSync` function), add:

```typescript
// ─── ARI Snapshot ─────────────────────────────────────────────────────────────

export interface ARIDayRestrictions {
  rate?: string;
  min_stay_arrival?: number;
  max_stay?: number | null;
  stop_sell?: boolean;
  closed_to_arrival?: boolean;
  closed_to_departure?: boolean;
}

export interface ARIMonthSnapshot {
  month: string;
  updated_at: string;
  source: 'push' | 'pull';
  availability: Record<string, Record<string, number>>;
  restrictions: Record<string, Record<string, ARIDayRestrictions>>;
}

/**
 * Returns the Firestore ARI snapshot for a given month.
 * Reads from Firestore — no Channex API quota consumed.
 *
 * @param propertyId  Channex property UUID
 * @param month       "YYYY-MM"
 */
export async function getARISnapshot(
  propertyId: string,
  month: string,
): Promise<ARIMonthSnapshot | null> {
  return apiFetch<ARIMonthSnapshot | null>(
    `${BASE}/properties/${encodeURIComponent(propertyId)}/ari-snapshot?month=${encodeURIComponent(month)}`,
  );
}

/**
 * Pulls current ARI from Channex and overwrites the Firestore snapshot.
 * Consumes 2 Channex API calls — only call from explicit "Refresh" button.
 *
 * @param propertyId  Channex property UUID
 * @param dateFrom    ISO date "YYYY-MM-DD"
 * @param dateTo      ISO date "YYYY-MM-DD"
 */
export async function refreshARISnapshot(
  propertyId: string,
  dateFrom: string,
  dateTo: string,
): Promise<{ updatedMonths: string[] }> {
  return apiFetch(`${BASE}/properties/${encodeURIComponent(propertyId)}/ari-refresh`, {
    method: 'POST',
    body: JSON.stringify({ dateFrom, dateTo }),
  });
}
```

- [ ] **Step 2: TypeScript check (frontend)**

```bash
cd apps/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/channex/api/channexHubApi.ts
git commit -m "feat(frontend/channex): add ARIMonthSnapshot types + getARISnapshot + refreshARISnapshot API functions"
```

---

## Task 6 — Calendar: load snapshot + display inline on cells

**Files:**
- Modify: `apps/frontend/src/channex/components/ARICalendarFull.tsx`

This task adds snapshot loading and the inline cell display. The click/detail popup is Task 7.

- [ ] **Step 1: Add imports**

At the top of `ARICalendarFull.tsx`, update the import from `channexHubApi`:

```typescript
import {
  listRoomTypes,
  pushAvailabilityBatch,
  pushRestrictionsBatch,
  triggerFullSync,
  getARISnapshot,
  refreshARISnapshot,
  type StoredRoomType,
  type FullSyncResult,
  type ARIMonthSnapshot,
} from '../api/channexHubApi';
```

- [ ] **Step 2: Add snapshot state variables**

After the existing state declarations (after `const [syncError, setSyncError]`), add:

```typescript
// Snapshot state
const [snapshot, setSnapshot] = useState<ARIMonthSnapshot | null>(null);
const [loadingSnapshot, setLoadingSnapshot] = useState(false);
const [refreshing, setRefreshing] = useState(false);
```

- [ ] **Step 3: Add snapshot load effect**

After the existing `useEffect` for `listRoomTypes`, add:

```typescript
useEffect(() => {
  const month = visibleMonth.toISOString().slice(0, 7); // "YYYY-MM"
  setLoadingSnapshot(true);
  getARISnapshot(propertyId, month)
    .then((data) => setSnapshot(data))
    .catch(() => setSnapshot(null))
    .finally(() => setLoadingSnapshot(false));
}, [propertyId, visibleMonth]);
```

- [ ] **Step 4: Add handleRefresh function**

After `handleFullSync`, add:

```typescript
async function handleRefresh() {
  setRefreshing(true);
  const month = visibleMonth.toISOString().slice(0, 7);
  const firstDay = month + '-01';
  const lastDay = new Date(
    Date.UTC(visibleMonth.getUTCFullYear(), visibleMonth.getUTCMonth() + 1, 0),
  ).toISOString().slice(0, 10);

  try {
    await refreshARISnapshot(propertyId, firstDay, lastDay);
    const updated = await getARISnapshot(propertyId, month);
    setSnapshot(updated);
  } catch {
    // Non-fatal — calendar continues with stale data
  } finally {
    setRefreshing(false);
  }
}
```

- [ ] **Step 5: Add helper memos for per-cell data**

After the `allRatePlans` memo, add:

```typescript
/** Returns min rate across all rate plans for a date, or null if no data. */
const getMinRate = useCallback(
  (ds: string): string | null => {
    if (!snapshot) return null;
    let min: number | null = null;
    for (const days of Object.values(snapshot.restrictions)) {
      const r = days[ds]?.rate;
      if (r !== undefined) {
        const n = parseFloat(r);
        if (!isNaN(n) && (min === null || n < min)) min = n;
      }
    }
    return min !== null ? min.toFixed(2) : null;
  },
  [snapshot],
);

/** Returns total availability across all room types for a date. */
const getDayAvailability = useCallback(
  (ds: string): number | null => {
    if (!snapshot) return null;
    let total: number | null = null;
    for (const days of Object.values(snapshot.availability)) {
      const v = days[ds];
      if (v !== undefined) total = (total ?? 0) + v;
    }
    return total;
  },
  [snapshot],
);

/** Returns true if any rate plan has stop_sell or any room type has availability=0. */
const isDayBlocked = useCallback(
  (ds: string): boolean => {
    if (!snapshot) return false;
    for (const days of Object.values(snapshot.restrictions)) {
      if (days[ds]?.stop_sell) return true;
    }
    for (const days of Object.values(snapshot.availability)) {
      if (days[ds] === 0) return true;
    }
    return false;
  },
  [snapshot],
);

/** Returns true if any rate plan has closed_to_arrival or closed_to_departure for this date. */
const isDayRestricted = useCallback(
  (ds: string): boolean => {
    if (!snapshot) return false;
    for (const days of Object.values(snapshot.restrictions)) {
      if (days[ds]?.closed_to_arrival || days[ds]?.closed_to_departure) return true;
    }
    return false;
  },
  [snapshot],
);
```

- [ ] **Step 6: Add "Refresh Calendar" button to the header**

Find the header bar section (the `Full Sync ({syncDays} days)` button area) and add a Refresh button next to it:

```tsx
{/* Header bar */}
<div className="flex items-center justify-between">
  <div>
    <h3 className="text-base font-semibold text-slate-900">ARI Calendar</h3>
    <p className="text-xs text-slate-500">Click a date to start a range, click another to end and open the update panel.</p>
  </div>
  <div className="flex items-center gap-2">
    <button
      type="button"
      onClick={() => void handleRefresh()}
      disabled={refreshing || loadingSnapshot}
      className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
    >
      {refreshing ? 'Refreshing…' : 'Refresh Calendar'}
    </button>
    <button
      type="button"
      onClick={() => { setShowSyncModal(true); setSyncResult(null); setSyncError(null); }}
      className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
    >
      Full Sync ({syncDays} days)
    </button>
  </div>
</div>
```

- [ ] **Step 7: Update calendar cells to show inline snapshot data**

Replace the existing cell `<div>` in the calendar grid (the inner map that renders each date cell) with this version that displays availability and rate data:

```tsx
{weekDates.map((date) => {
  const ds = isoDate(date);
  const inMonth = date.getUTCMonth() === visibleMonth.getUTCMonth();
  const sel = isSelected(ds);
  const avail = getDayAvailability(ds);
  const minRate = getMinRate(ds);
  const blocked = isDayBlocked(ds);
  const restricted = isDayRestricted(ds);

  const snapshotBg = !inMonth
    ? ''
    : blocked
    ? 'bg-rose-50'
    : restricted
    ? 'bg-amber-50'
    : avail !== null && avail > 0
    ? 'bg-emerald-50/60'
    : '';

  return (
    <div
      key={ds}
      onClick={() => handleCellClick(ds)}
      className={[
        'flex flex-col items-start p-1.5 border border-slate-200 cursor-pointer min-h-[56px] transition-colors',
        sel ? 'bg-indigo-100 ring-2 ring-inset ring-indigo-500 z-10' : `hover:bg-slate-100 ${snapshotBg}`,
        !inMonth ? 'opacity-40' : '',
      ].join(' ')}
      onMouseDown={(e) => e.preventDefault()}
    >
      <span className="text-sm font-medium text-slate-700">{date.getUTCDate()}</span>
      {inMonth && avail !== null && (
        <span className={`text-[10px] font-semibold leading-tight ${blocked ? 'text-rose-600' : 'text-slate-500'}`}>
          {blocked ? 'blocked' : `avail ${avail}`}
        </span>
      )}
      {inMonth && minRate !== null && (
        <span className="text-[10px] text-slate-400 leading-tight">${minRate}</span>
      )}
    </div>
  );
})}
```

- [ ] **Step 8: TypeScript check**

```bash
cd apps/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add apps/frontend/src/channex/components/ARICalendarFull.tsx
git commit -m "feat(ari-calendar): load snapshot from Firestore, display availability + rate inline on cells, add Refresh Calendar button"
```

---

## Task 7 — Calendar: day detail popup on single click

**Files:**
- Modify: `apps/frontend/src/channex/components/ARICalendarFull.tsx`

When the user clicks a day for the first time (before completing a range), show a read-only detail card for that specific day — all room types and all rate plans.

- [ ] **Step 1: Add detailDay state**

After the `lastTaskIds` state declaration, add:

```typescript
const [detailDay, setDetailDay] = useState<string | null>(null);
```

- [ ] **Step 2: Update handleCellClick to set detailDay**

Replace the current `handleCellClick` with:

```typescript
const handleCellClick = useCallback(
  (ds: string) => {
    if (!selectionStart || selectionEnd) {
      // First click: start range + show detail for this day
      setSelectionStart(ds);
      setSelectionEnd(null);
      setDetailDay(ds);
      setSaveError(null);
      setLastTaskIds([]);
      if (batchQueue.length === 0) setShowPanel(false);
      return;
    }
    // Second click: complete range, open update panel, clear detail
    const end = ds >= selectionStart ? ds : selectionStart;
    const start = ds < selectionStart ? ds : selectionStart;
    setSelectionStart(start);
    setSelectionEnd(end);
    setDetailDay(null);
    setShowPanel(true);
    setSaveError(null);
  },
  [batchQueue.length, selectionEnd, selectionStart],
);
```

- [ ] **Step 3: Add the day detail popup JSX**

Add this block immediately before the `{/* ARI Control Panel */}` block (after the calendar grid closing `</>`):

```tsx
{/* Day Detail Popup */}
{detailDay && snapshot && !showPanel && (
  <>
    <div className="fixed inset-0 z-40" onClick={() => setDetailDay(null)} />
    <div className="fixed inset-x-4 top-1/4 z-50 mx-auto max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-900">{detailDay}</h3>
        <button
          type="button"
          onClick={() => setDetailDay(null)}
          className="text-slate-400 hover:text-slate-600"
        >
          ✕
        </button>
      </div>
      <div className="space-y-3">
        {uniqueRooms.map((rt) => {
          const avail = snapshot.availability[rt.room_type_id]?.[detailDay];
          return (
            <div key={rt.room_type_id} className="rounded-xl bg-slate-50 p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">{rt.title}</span>
                {avail !== undefined && (
                  <span className={`text-xs font-medium ${avail === 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                    {avail === 0 ? 'unavailable' : `${avail} unit${avail !== 1 ? 's' : ''}`}
                  </span>
                )}
              </div>
              {rt.rate_plans.map((rp) => {
                const r = snapshot.restrictions[rp.rate_plan_id]?.[detailDay];
                if (!r && avail === undefined) return null;
                return (
                  <div key={rp.rate_plan_id} className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-600 pl-1 border-l-2 border-slate-200">
                    <span className="font-medium">{rp.title}</span>
                    {r?.rate && <span>${parseFloat(r.rate).toFixed(2)}</span>}
                    {r?.min_stay_arrival !== undefined && <span>min {r.min_stay_arrival}n</span>}
                    {r?.max_stay !== undefined && r.max_stay !== null && <span>max {r.max_stay}n</span>}
                    {r?.stop_sell && <span className="text-rose-600 font-semibold">Stop Sell</span>}
                    {r?.closed_to_arrival && <span className="text-amber-600">CTA</span>}
                    {r?.closed_to_departure && <span className="text-amber-600">CTD</span>}
                  </div>
                );
              })}
            </div>
          );
        })}
        {!uniqueRooms.length && (
          <p className="text-xs text-slate-500">No room type data for this day.</p>
        )}
      </div>
      <p className="mt-3 text-[10px] text-slate-400">Click another day to select a range, or click elsewhere to close.</p>
    </div>
  </>
)}
```

- [ ] **Step 4: Clear detailDay when the update panel opens**

In `handleSaveBatch`, inside the `try` block after `setShowPanel(false)`, add:

```typescript
setDetailDay(null);
```

- [ ] **Step 5: TypeScript check**

```bash
cd apps/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/channex/components/ARICalendarFull.tsx
git commit -m "feat(ari-calendar): show day detail popup on first click — availability + rates + restrictions per room type"
```

---

## Task 8 — End-to-end verification

- [ ] **Step 1: Start the stack**

```bash
# From the repo root
pnpm dev
```

Navigate to `https://localhost:5173` → ChannexHub → Properties → select the test property → ARI Calendar tab.

- [ ] **Step 2: Verify inline cell data is absent (clean state)**

The calendar cells should show no inline data (no snapshot exists yet). Cells are plain white.

- [ ] **Step 3: Click "Refresh Calendar"**

Press "Refresh Calendar". Check backend logs:
```
[CTRL] POST /ari-refresh — propertyId=... 2026-05-01→2026-05-31
[CHANNEX] Fetching availability — propertyId=...
[CHANNEX] Fetching restrictions — propertyId=...
[SNAPSHOT] ✓ Refresh complete — propertyId=... months=2026-05
```

Calendar cells for May 2026 should now show availability counts and rates.

- [ ] **Step 4: Verify cell colors**

- Days with availability > 0 and no stop_sell → faint green background
- Days with stop_sell → faint rose background
- Days with CTA/CTD → faint amber background
- Days outside the visible month → 40% opacity

- [ ] **Step 5: Verify day detail popup**

Click a day that has data. A popup should appear showing each room type with its availability count and each rate plan's rate, min stay, and restriction flags.

Click a different day — popup should update to the new day.
Click elsewhere → popup closes.
Click a second day → popup closes, Update ARI panel opens.

- [ ] **Step 6: Verify optimistic write after push**

Select Nov 22 → Nov 22. Set Rate = `999`. Click "+ Add to Batch". Click "Save (1)". After success, click "Refresh Calendar" (to pull from Channex for the current month — navigate to November first).

Alternatively, navigate to November first, push the $999 rate, then check the cell — it should update after the next "Refresh Calendar" press.

> **Note:** The optimistic write happens immediately after push and updates the Firestore snapshot, so in practice the cell updates without requiring a refresh if the current visible month matches the pushed month.

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "test(ari-calendar): end-to-end snapshot verification complete"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Calendar displays blocked dates (stop_sell/availability=0 → rose background)
- ✅ Calendar displays prices per room (min rate shown in cell)
- ✅ Single click shows day detail popup (all room types × rate plans)
- ✅ Data sourced from Firestore (no Channex quota on render)
- ✅ Refresh from Channex button (explicit user action, 2 API calls)
- ✅ Optimistic write after every push (availability + restrictions)
- ✅ fullSync also writes to snapshot (via pushAvailability/pushRestrictions which now write)

**Placeholder scan:** None found.

**Type consistency:**
- `ARIMonthSnapshot` is defined in `channex-ari-snapshot.service.ts` (backend) and mirrored in `channexHubApi.ts` (frontend) with identical shapes.
- `ARIDayRestrictions` is defined in both places identically.
- All method signatures in the controller (`getARISnapshot`, `refreshARISnapshot`) match the service (`getSnapshot`, `refreshFromChannex`).
- Frontend `getARISnapshot(propertyId, month)` calls `GET /ari-snapshot?month=...` which the controller handles with `@Query() query: AriSnapshotQueryDto`.

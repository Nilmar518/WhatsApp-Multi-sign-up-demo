# MigoProperty Pool — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a `MigoProperty` entity that groups OTA listings (Airbnb, Booking.com) into a shared unit-count pool, with atomic availability tracking and cross-platform ARI fan-out.

**Architecture:** New top-level Firestore collection `migo_properties` owns the pool count (`current_availability`). Channex property docs gain a `migo_property_id` backref. The booking worker decrements/increments the pool on every booking event. A new `pushAriToMigoProperty` method fans out ARI pushes to all connected platforms in parallel.

**Tech Stack:** NestJS 10, Firestore (firebase-admin), EventEmitter2 (SSE), class-validator, TypeScript

---

## File Map

**New files:**
```
apps/backend/src/migo-property/
  migo-property.module.ts
  migo-property.service.ts
  migo-property.controller.ts
  dto/
    create-migo-property.dto.ts
    update-migo-property.dto.ts
    assign-connection.dto.ts
    toggle-sync.dto.ts
    migo-property-ari.dto.ts
apps/backend/src/channex/channex-migo-ari.controller.ts
```

**Modified files:**
```
apps/backend/src/channex/channex.types.ts
apps/backend/src/channex/channex-ari.service.ts
apps/backend/src/channex/workers/channex-booking.worker.ts
apps/backend/src/channex/channex-events.controller.ts
apps/backend/src/channex/channex.module.ts
apps/backend/src/app.module.ts
firestore.indexes.json
```

---

## Task 1: Add types and Firestore index

**Files:**
- Modify: `apps/backend/src/channex/channex.types.ts`
- Modify: `firestore.indexes.json`

- [ ] **Step 1: Add MIGO_PROPERTY_EVENTS and alert event type to channex.types.ts**

Append at the end of the file (after the existing `ChannexInstallApplicationResponse` section):

```typescript
// ─── MigoProperty Pool — SSE Events ──────────────────────────────────────────

export const MIGO_PROPERTY_EVENTS = {
  AVAILABILITY_ALERT: 'migo_property.availability_alert',
} as const;

/**
 * Emitted when `current_availability` drops to or below `alert_threshold`.
 * Forwarded to the frontend via the existing /channex/events/:tenantId SSE stream.
 * The frontend uses this to show an alert prompting the admin to close dates.
 */
export interface MigoPropertyAvailabilityAlertEvent {
  tenantId: string;
  migoPropertyId: string;
  title: string;
  current_availability: number;
  timestamp: string;
}
```

- [ ] **Step 2: Add composite index to firestore.indexes.json**

Replace the file content:

```json
{
  "indexes": [
    {
      "collectionGroup": "bookings",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "channex_booking_id", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "bookings",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "channex_booking_id", "order": "ASCENDING" },
        { "fieldPath": "propertyId", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "bookings",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "check_in", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "migo_properties",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "tenant_id", "order": "ASCENDING" },
        { "fieldPath": "created_at", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": [
    {
      "collectionGroup": "properties",
      "fieldPath": "channex_property_id",
      "indexes": [
        { "order": "ASCENDING", "queryScope": "COLLECTION" },
        { "order": "ASCENDING", "queryScope": "COLLECTION_GROUP" }
      ]
    },
    {
      "collectionGroup": "properties",
      "fieldPath": "tenant_id",
      "indexes": [
        { "order": "ASCENDING", "queryScope": "COLLECTION" },
        { "order": "ASCENDING", "queryScope": "COLLECTION_GROUP" }
      ]
    }
  ]
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/channex/channex.types.ts firestore.indexes.json
git commit -m "feat(migo-property): add MIGO_PROPERTY_EVENTS types and Firestore index"
```

---

## Task 2: Create DTOs

**Files:**
- Create: `apps/backend/src/migo-property/dto/create-migo-property.dto.ts`
- Create: `apps/backend/src/migo-property/dto/update-migo-property.dto.ts`
- Create: `apps/backend/src/migo-property/dto/assign-connection.dto.ts`
- Create: `apps/backend/src/migo-property/dto/toggle-sync.dto.ts`
- Create: `apps/backend/src/migo-property/dto/migo-property-ari.dto.ts`

- [ ] **Step 1: Create create-migo-property.dto.ts**

```typescript
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class CreateMigoPropertyDto {
  @IsString()
  @IsNotEmpty()
  tenantId: string;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsInt()
  @Min(1)
  total_units: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  alert_threshold?: number;
}
```

- [ ] **Step 2: Create update-migo-property.dto.ts**

```typescript
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class UpdateMigoPropertyDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  title?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  total_units?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  alert_threshold?: number;
}
```

- [ ] **Step 3: Create assign-connection.dto.ts**

```typescript
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AssignConnectionDto {
  @IsString()
  @IsNotEmpty()
  channexPropertyId: string;

  @IsString()
  @IsNotEmpty()
  platform: string;

  @IsString()
  @IsNotEmpty()
  listingTitle: string;

  @IsBoolean()
  @IsOptional()
  isSyncEnabled?: boolean;
}
```

- [ ] **Step 4: Create toggle-sync.dto.ts**

```typescript
import { IsBoolean } from 'class-validator';

export class ToggleSyncDto {
  @IsBoolean()
  isSyncEnabled: boolean;
}
```

- [ ] **Step 5: Create migo-property-ari.dto.ts**

```typescript
import { IsBoolean, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class MigoPropertyAriDto {
  @IsString()
  @IsNotEmpty()
  dateFrom: string;

  @IsString()
  @IsNotEmpty()
  dateTo: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  availability?: number;

  @IsString()
  @IsOptional()
  rate?: string;

  @IsBoolean()
  @IsOptional()
  stopSell?: boolean;

  @IsInt()
  @Min(1)
  @IsOptional()
  minStayArrival?: number;

  @IsBoolean()
  @IsOptional()
  closedToArrival?: boolean;

  @IsBoolean()
  @IsOptional()
  closedToDeparture?: boolean;
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/migo-property/
git commit -m "feat(migo-property): add DTOs"
```

---

## Task 3: Implement MigoPropertyService

**Files:**
- Create: `apps/backend/src/migo-property/migo-property.service.ts`

- [ ] **Step 1: Write the service**

```typescript
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FieldValue } from 'firebase-admin/firestore';
import { FirebaseService } from '../firebase/firebase.service';
import { CreateMigoPropertyDto } from './dto/create-migo-property.dto';
import { UpdateMigoPropertyDto } from './dto/update-migo-property.dto';
import { AssignConnectionDto } from './dto/assign-connection.dto';
import {
  MIGO_PROPERTY_EVENTS,
  type MigoPropertyAvailabilityAlertEvent,
} from '../channex/channex.types';

const COLLECTION = 'migo_properties';

export interface PlatformConnection {
  platform: string;
  channex_property_id: string;
  listing_title: string;
  is_sync_enabled: boolean;
}

export interface MigoPropertyDoc {
  id: string;
  tenant_id: string;
  title: string;
  total_units: number;
  current_availability: number;
  alert_threshold: number;
  platform_connections: PlatformConnection[];
  created_at: string;
  updated_at: string;
}

@Injectable()
export class MigoPropertyService {
  private readonly logger = new Logger(MigoPropertyService.name);

  constructor(
    private readonly firebase: FirebaseService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async createPropertyType(dto: CreateMigoPropertyDto): Promise<MigoPropertyDoc> {
    const db = this.firebase.getFirestore();
    const ref = db.collection(COLLECTION).doc();
    const now = new Date().toISOString();
    const doc: MigoPropertyDoc = {
      id: ref.id,
      tenant_id: dto.tenantId,
      title: dto.title,
      total_units: dto.total_units,
      current_availability: dto.total_units,
      alert_threshold: dto.alert_threshold ?? 0,
      platform_connections: [],
      created_at: now,
      updated_at: now,
    };
    await this.firebase.set(ref, doc as unknown as Record<string, unknown>);
    this.logger.log(
      `[MIGO-PROPERTY] Created — id=${ref.id} title="${dto.title}" units=${dto.total_units}`,
    );
    return doc;
  }

  async listPropertyTypes(tenantId: string): Promise<MigoPropertyDoc[]> {
    const db = this.firebase.getFirestore();
    const snap = await db
      .collection(COLLECTION)
      .where('tenant_id', '==', tenantId)
      .orderBy('created_at', 'desc')
      .get();
    return snap.docs.map((d) => d.data() as MigoPropertyDoc);
  }

  async getPropertyType(migoPropertyId: string): Promise<MigoPropertyDoc> {
    const db = this.firebase.getFirestore();
    const snap = await db.collection(COLLECTION).doc(migoPropertyId).get();
    if (!snap.exists) {
      throw new NotFoundException(`MigoProperty not found: ${migoPropertyId}`);
    }
    return snap.data() as MigoPropertyDoc;
  }

  async updatePropertyType(
    migoPropertyId: string,
    dto: UpdateMigoPropertyDto,
  ): Promise<MigoPropertyDoc> {
    const doc = await this.getPropertyType(migoPropertyId);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.total_units !== undefined) patch.total_units = dto.total_units;
    if (dto.alert_threshold !== undefined) patch.alert_threshold = dto.alert_threshold;
    const db = this.firebase.getFirestore();
    await this.firebase.update(db.collection(COLLECTION).doc(migoPropertyId), patch);
    return { ...doc, ...patch } as MigoPropertyDoc;
  }

  async deletePropertyType(migoPropertyId: string): Promise<void> {
    const doc = await this.getPropertyType(migoPropertyId);
    if (doc.platform_connections.length > 0) {
      const ids = doc.platform_connections
        .map((c) => c.channex_property_id)
        .join(', ');
      throw new BadRequestException(
        `Cannot delete property type with active connections: ${ids}`,
      );
    }
    const db = this.firebase.getFirestore();
    await db.collection(COLLECTION).doc(migoPropertyId).delete();
    this.logger.log(`[MIGO-PROPERTY] Deleted — id=${migoPropertyId}`);
  }

  async assignConnection(
    migoPropertyId: string,
    dto: AssignConnectionDto,
  ): Promise<MigoPropertyDoc> {
    const db = this.firebase.getFirestore();

    // Validate the Channex property exists in our system
    const propSnap = await db
      .collectionGroup('properties')
      .where('channex_property_id', '==', dto.channexPropertyId)
      .limit(1)
      .get();
    if (propSnap.empty) {
      throw new NotFoundException(
        `Channex property not found: ${dto.channexPropertyId}`,
      );
    }

    const doc = await this.getPropertyType(migoPropertyId);
    const alreadyConnected = doc.platform_connections.some(
      (c) => c.channex_property_id === dto.channexPropertyId,
    );
    if (alreadyConnected) return doc; // idempotent

    const newConnection: PlatformConnection = {
      platform: dto.platform,
      channex_property_id: dto.channexPropertyId,
      listing_title: dto.listingTitle,
      is_sync_enabled: dto.isSyncEnabled ?? true,
    };

    const updatedConnections = [...doc.platform_connections, newConnection];
    const now = new Date().toISOString();

    await this.firebase.update(db.collection(COLLECTION).doc(migoPropertyId), {
      platform_connections: updatedConnections,
      updated_at: now,
    });

    // Write backref on the Channex property doc
    await this.firebase.update(propSnap.docs[0].ref, {
      migo_property_id: migoPropertyId,
    });

    this.logger.log(
      `[MIGO-PROPERTY] Connection assigned — migoPropertyId=${migoPropertyId} ` +
        `channexPropertyId=${dto.channexPropertyId}`,
    );

    return { ...doc, platform_connections: updatedConnections, updated_at: now };
  }

  async removeConnection(
    migoPropertyId: string,
    channexPropertyId: string,
  ): Promise<MigoPropertyDoc> {
    const doc = await this.getPropertyType(migoPropertyId);
    const updatedConnections = doc.platform_connections.filter(
      (c) => c.channex_property_id !== channexPropertyId,
    );
    const now = new Date().toISOString();
    const db = this.firebase.getFirestore();

    await this.firebase.update(db.collection(COLLECTION).doc(migoPropertyId), {
      platform_connections: updatedConnections,
      updated_at: now,
    });

    // Clear backref on the Channex property doc (best-effort)
    const propSnap = await db
      .collectionGroup('properties')
      .where('channex_property_id', '==', channexPropertyId)
      .limit(1)
      .get();
    if (!propSnap.empty) {
      await this.firebase.update(propSnap.docs[0].ref, { migo_property_id: null });
    }

    this.logger.log(
      `[MIGO-PROPERTY] Connection removed — migoPropertyId=${migoPropertyId} ` +
        `channexPropertyId=${channexPropertyId}`,
    );

    return { ...doc, platform_connections: updatedConnections, updated_at: now };
  }

  async toggleSync(
    migoPropertyId: string,
    channexPropertyId: string,
    enabled: boolean,
  ): Promise<MigoPropertyDoc> {
    const doc = await this.getPropertyType(migoPropertyId);
    const updatedConnections = doc.platform_connections.map((c) =>
      c.channex_property_id === channexPropertyId
        ? { ...c, is_sync_enabled: enabled }
        : c,
    );
    const now = new Date().toISOString();
    const db = this.firebase.getFirestore();
    await this.firebase.update(db.collection(COLLECTION).doc(migoPropertyId), {
      platform_connections: updatedConnections,
      updated_at: now,
    });
    return { ...doc, platform_connections: updatedConnections, updated_at: now };
  }

  /**
   * Decrements `current_availability` by 1 atomically.
   * After the write, reads the new value to check the alert threshold.
   * If `current_availability <= alert_threshold`, emits an SSE alert event.
   * Never throws — a missing doc is logged and silently skipped so the booking
   * job is not failed due to an unrelated pool update.
   */
  async decrementAvailability(migoPropertyId: string): Promise<void> {
    const db = this.firebase.getFirestore();
    const ref = db.collection(COLLECTION).doc(migoPropertyId);
    const initial = await ref.get();
    if (!initial.exists) {
      this.logger.warn(
        `[MIGO-PROPERTY] decrementAvailability — doc not found: ${migoPropertyId}`,
      );
      return;
    }
    await this.firebase.update(ref, {
      current_availability: FieldValue.increment(-1),
    });
    const updated = await ref.get();
    const data = updated.data() as MigoPropertyDoc;
    const newAvailability = data.current_availability;

    if (newAvailability <= (data.alert_threshold ?? 0)) {
      const alertPayload: MigoPropertyAvailabilityAlertEvent = {
        tenantId: data.tenant_id,
        migoPropertyId,
        title: data.title,
        current_availability: newAvailability,
        timestamp: new Date().toISOString(),
      };
      this.eventEmitter.emit(MIGO_PROPERTY_EVENTS.AVAILABILITY_ALERT, alertPayload);
      this.logger.warn(
        `[MIGO-PROPERTY] Availability alert — id=${migoPropertyId} ` +
          `title="${data.title}" availability=${newAvailability}`,
      );
    }
  }

  /**
   * Increments `current_availability` by 1 atomically.
   * Called on `booking_cancellation` events by the booking worker.
   */
  async incrementAvailability(migoPropertyId: string): Promise<void> {
    const db = this.firebase.getFirestore();
    const ref = db.collection(COLLECTION).doc(migoPropertyId);
    const snap = await ref.get();
    if (!snap.exists) {
      this.logger.warn(
        `[MIGO-PROPERTY] incrementAvailability — doc not found: ${migoPropertyId}`,
      );
      return;
    }
    await this.firebase.update(ref, {
      current_availability: FieldValue.increment(1),
    });
    this.logger.log(
      `[MIGO-PROPERTY] Availability incremented — id=${migoPropertyId}`,
    );
  }

  async resetAvailability(migoPropertyId: string): Promise<MigoPropertyDoc> {
    const doc = await this.getPropertyType(migoPropertyId);
    const now = new Date().toISOString();
    const db = this.firebase.getFirestore();
    await this.firebase.update(db.collection(COLLECTION).doc(migoPropertyId), {
      current_availability: doc.total_units,
      updated_at: now,
    });
    return { ...doc, current_availability: doc.total_units, updated_at: now };
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/backend && pnpm tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/migo-property/migo-property.service.ts
git commit -m "feat(migo-property): implement MigoPropertyService"
```

---

## Task 4: Create MigoPropertyModule and wire into AppModule

**Files:**
- Create: `apps/backend/src/migo-property/migo-property.module.ts`
- Modify: `apps/backend/src/app.module.ts`

- [ ] **Step 1: Create migo-property.module.ts**

```typescript
import { Module } from '@nestjs/common';
import { MigoPropertyService } from './migo-property.service';
import { MigoPropertyController } from './migo-property.controller';

@Module({
  providers: [MigoPropertyService],
  controllers: [MigoPropertyController],
  exports: [MigoPropertyService],
})
export class MigoPropertyModule {}
```

Note: `MigoPropertyController` is created in Task 5 — the module won't compile until then.

- [ ] **Step 2: Add MigoPropertyModule to AppModule**

In `apps/backend/src/app.module.ts`, add the import at the top:

```typescript
import { MigoPropertyModule } from './migo-property/migo-property.module';
```

And add to the `imports` array (after `ChannexModule`):

```typescript
// Pool of physical units, cross-platform availability tracking
MigoPropertyModule,
```

- [ ] **Step 3: Commit (after Task 5 compiles)**

This commit is deferred to after Task 5.

---

## Task 5: Implement MigoPropertyController

**Files:**
- Create: `apps/backend/src/migo-property/migo-property.controller.ts`

- [ ] **Step 1: Write the controller**

```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { MigoPropertyService, type MigoPropertyDoc } from './migo-property.service';
import { CreateMigoPropertyDto } from './dto/create-migo-property.dto';
import { UpdateMigoPropertyDto } from './dto/update-migo-property.dto';
import { AssignConnectionDto } from './dto/assign-connection.dto';
import { ToggleSyncDto } from './dto/toggle-sync.dto';

@Controller('migo-properties')
export class MigoPropertyController {
  private readonly logger = new Logger(MigoPropertyController.name);

  constructor(private readonly migoPropertyService: MigoPropertyService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateMigoPropertyDto): Promise<MigoPropertyDoc> {
    this.logger.log(`[CTRL] POST /migo-properties title="${dto.title}"`);
    return this.migoPropertyService.createPropertyType(dto);
  }

  @Get()
  async list(@Query('tenantId') tenantId: string): Promise<MigoPropertyDoc[]> {
    this.logger.log(`[CTRL] GET /migo-properties tenantId=${tenantId}`);
    return this.migoPropertyService.listPropertyTypes(tenantId);
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<MigoPropertyDoc> {
    this.logger.log(`[CTRL] GET /migo-properties/${id}`);
    return this.migoPropertyService.getPropertyType(id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateMigoPropertyDto,
  ): Promise<MigoPropertyDoc> {
    this.logger.log(`[CTRL] PATCH /migo-properties/${id}`);
    return this.migoPropertyService.updatePropertyType(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    this.logger.log(`[CTRL] DELETE /migo-properties/${id}`);
    return this.migoPropertyService.deletePropertyType(id);
  }

  @Post(':id/connections')
  @HttpCode(HttpStatus.CREATED)
  async assignConnection(
    @Param('id') id: string,
    @Body() dto: AssignConnectionDto,
  ): Promise<MigoPropertyDoc> {
    this.logger.log(
      `[CTRL] POST /migo-properties/${id}/connections channexPropertyId=${dto.channexPropertyId}`,
    );
    return this.migoPropertyService.assignConnection(id, dto);
  }

  @Delete(':id/connections/:channexId')
  @HttpCode(HttpStatus.OK)
  async removeConnection(
    @Param('id') id: string,
    @Param('channexId') channexId: string,
  ): Promise<MigoPropertyDoc> {
    this.logger.log(`[CTRL] DELETE /migo-properties/${id}/connections/${channexId}`);
    return this.migoPropertyService.removeConnection(id, channexId);
  }

  @Patch(':id/connections/:channexId')
  async toggleSync(
    @Param('id') id: string,
    @Param('channexId') channexId: string,
    @Body() dto: ToggleSyncDto,
  ): Promise<MigoPropertyDoc> {
    this.logger.log(
      `[CTRL] PATCH /migo-properties/${id}/connections/${channexId} isSyncEnabled=${dto.isSyncEnabled}`,
    );
    return this.migoPropertyService.toggleSync(id, channexId, dto.isSyncEnabled);
  }

  @Post(':id/availability/reset')
  @HttpCode(HttpStatus.OK)
  async resetAvailability(@Param('id') id: string): Promise<MigoPropertyDoc> {
    this.logger.log(`[CTRL] POST /migo-properties/${id}/availability/reset`);
    return this.migoPropertyService.resetAvailability(id);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/backend && pnpm tsc --noEmit
```

Expected: zero errors (module + controller + service all resolve).

- [ ] **Step 3: Commit Tasks 4 + 5 together**

```bash
git add apps/backend/src/migo-property/ apps/backend/src/app.module.ts
git commit -m "feat(migo-property): add MigoPropertyModule, controller, and AppModule wiring"
```

---

## Task 6: Add pushAriToMigoProperty to ChannexARIService

**Files:**
- Modify: `apps/backend/src/channex/channex-ari.service.ts`

- [ ] **Step 1: Add the import at the top of channex-ari.service.ts**

Add after the existing imports:

```typescript
import { MigoPropertyAriDto } from '../migo-property/dto/migo-property-ari.dto';
```

- [ ] **Step 2: Add the fan-out method at the end of the ChannexARIService class (before the closing brace)**

```typescript
  // ─── MigoProperty ARI fan-out ─────────────────────────────────────────────

  /**
   * Pushes ARI updates to ALL platform connections of a MigoProperty where
   * `is_sync_enabled === true`. Runs in parallel via Promise.allSettled so a
   * single platform failure does not abort the others.
   *
   * Reads `migo_properties` directly via FirebaseService — does NOT inject
   * MigoPropertyService to avoid a circular module dependency.
   *
   * Returns a summary: succeeded (channex_property_id[]) + failed (with error
   * messages). The controller returns 207 Multi-Status when any platform fails.
   */
  async pushAriToMigoProperty(
    migoPropertyId: string,
    dto: MigoPropertyAriDto,
  ): Promise<{
    succeeded: string[];
    failed: Array<{ channexPropertyId: string; error: string }>;
  }> {
    const db = this.firebase.getFirestore();
    const snap = await db.collection('migo_properties').doc(migoPropertyId).get();

    if (!snap.exists) {
      throw new HttpException(
        `MigoProperty not found: ${migoPropertyId}`,
        HttpStatus.NOT_FOUND,
      );
    }

    const migoDoc = snap.data() as {
      platform_connections: Array<{
        channex_property_id: string;
        is_sync_enabled: boolean;
      }>;
    };

    const enabledConnections = migoDoc.platform_connections.filter(
      (c) => c.is_sync_enabled,
    );

    if (!enabledConnections.length) {
      this.logger.log(
        `[ARI] pushAriToMigoProperty — no enabled connections for migoPropertyId=${migoPropertyId}`,
      );
      return { succeeded: [], failed: [] };
    }

    const hasRestrictionFields =
      dto.rate !== undefined ||
      dto.stopSell !== undefined ||
      dto.minStayArrival !== undefined ||
      dto.closedToArrival !== undefined ||
      dto.closedToDeparture !== undefined;

    const results = await Promise.allSettled(
      enabledConnections.map(async (conn) => {
        const { channex_property_id } = conn;

        // Resolve tenant + read room types from Firestore (one call covers both restrictions + availability)
        const integration = await this.propertyService.resolveIntegration(channex_property_id);
        if (!integration) {
          throw new Error(
            `No integration found for channex_property_id=${channex_property_id}`,
          );
        }

        const propDoc = await db
          .collection(INTEGRATIONS_COLLECTION)
          .doc(integration.firestoreDocId)
          .collection('properties')
          .doc(channex_property_id)
          .get();

        const roomTypes: StoredRoomType[] =
          (propDoc.data()?.room_types as StoredRoomType[]) ?? [];

        if (hasRestrictionFields) {
          const ratePlanIds = roomTypes.flatMap((rt) =>
            rt.rate_plans.map((rp) => rp.rate_plan_id),
          );

          if (ratePlanIds.length) {
            const restrictionUpdates: RestrictionEntryDto[] = ratePlanIds.map(
              (rpId) => ({
                property_id: channex_property_id,
                rate_plan_id: rpId,
                date_from: dto.dateFrom,
                date_to: dto.dateTo,
                ...(dto.rate !== undefined ? { rate: dto.rate } : {}),
                ...(dto.stopSell !== undefined ? { stop_sell: dto.stopSell } : {}),
                ...(dto.minStayArrival !== undefined
                  ? { min_stay_arrival: dto.minStayArrival }
                  : {}),
                ...(dto.closedToArrival !== undefined
                  ? { closed_to_arrival: dto.closedToArrival }
                  : {}),
                ...(dto.closedToDeparture !== undefined
                  ? { closed_to_departure: dto.closedToDeparture }
                  : {}),
              }),
            );
            await this.pushRestrictions(restrictionUpdates);
          }
        }

        if (dto.availability !== undefined && roomTypes.length) {
          const availabilityUpdates: AvailabilityEntryDto[] = roomTypes.map((rt) => ({
            property_id: channex_property_id,
            room_type_id: rt.room_type_id,
            date_from: dto.dateFrom,
            date_to: dto.dateTo,
            availability: dto.availability!,
          }));
          await this.pushAvailability(availabilityUpdates);
        }
      }),
    );

    const succeeded: string[] = [];
    const failed: Array<{ channexPropertyId: string; error: string }> = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        succeeded.push(enabledConnections[index].channex_property_id);
      } else {
        failed.push({
          channexPropertyId: enabledConnections[index].channex_property_id,
          error: (result.reason as Error).message,
        });
      }
    });

    this.logger.log(
      `[ARI] pushAriToMigoProperty complete — migoPropertyId=${migoPropertyId} ` +
        `succeeded=${succeeded.length} failed=${failed.length}`,
    );

    return { succeeded, failed };
  }
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/backend && pnpm tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/channex/channex-ari.service.ts
git commit -m "feat(migo-property): add pushAriToMigoProperty fan-out to ChannexARIService"
```

---

## Task 7: Create ChannexMigoAriController and register in ChannexModule

**Files:**
- Create: `apps/backend/src/channex/channex-migo-ari.controller.ts`
- Modify: `apps/backend/src/channex/channex.module.ts`

- [ ] **Step 1: Create channex-migo-ari.controller.ts**

```typescript
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import { ChannexARIService } from './channex-ari.service';
import { MigoPropertyAriDto } from '../migo-property/dto/migo-property-ari.dto';

/**
 * ChannexMigoAriController — ARI fan-out endpoint for MigoProperty pools.
 *
 * Route prefix: channex/ari
 *
 * Kept separate from ChannexARIController (which has prefix channex/properties/:propertyId)
 * to avoid route conflicts and maintain a clean prefix for pool-level operations.
 *
 * Returns 207 Multi-Status when at least one platform connection fails so the
 * caller can identify which connections need retry.
 */
@Controller('channex/ari')
export class ChannexMigoAriController {
  private readonly logger = new Logger(ChannexMigoAriController.name);

  constructor(private readonly ariService: ChannexARIService) {}

  /**
   * POST /channex/ari/migo-property/:migoPropertyId
   *
   * Fans out ARI updates to all platform connections of the MigoProperty where
   * `is_sync_enabled === true`. Runs in parallel. Partial failures are reported
   * in the response body — HTTP 207 if any failed, 200 if all succeeded.
   *
   * Body:    MigoPropertyAriDto (dateFrom, dateTo, availability?, rate?, stopSell?, …)
   * Returns: { succeeded: string[], failed: { channexPropertyId, error }[] }
   */
  @Post('migo-property/:migoPropertyId')
  @HttpCode(HttpStatus.OK)
  async pushAriToMigoProperty(
    @Param('migoPropertyId') migoPropertyId: string,
    @Body() dto: MigoPropertyAriDto,
  ): Promise<{
    status: number;
    succeeded: string[];
    failed: Array<{ channexPropertyId: string; error: string }>;
  }> {
    this.logger.log(
      `[CTRL] POST /channex/ari/migo-property/${migoPropertyId}`,
    );

    const result = await this.ariService.pushAriToMigoProperty(migoPropertyId, dto);
    const status = result.failed.length > 0 ? 207 : 200;

    return { status, ...result };
  }
}
```

- [ ] **Step 2: Register in ChannexModule**

In `apps/backend/src/channex/channex.module.ts`:

Add the import at the top:
```typescript
import { ChannexMigoAriController } from './channex-migo-ari.controller';
```

Add to the `controllers` array:
```typescript
controllers: [
  ChannexPropertyController,
  ChannexWebhookController,
  ChannexARIController,
  ChannexMigoAriController,   // ← add this
  ChannexEventsController,
  ChannexMessagingBridgeController,
],
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/backend && pnpm tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/channex/channex-migo-ari.controller.ts \
        apps/backend/src/channex/channex.module.ts
git commit -m "feat(migo-property): add ChannexMigoAriController and register in ChannexModule"
```

---

## Task 8: Update ChannexBookingWorker to decrement/increment pool availability

**Files:**
- Modify: `apps/backend/src/channex/workers/channex-booking.worker.ts`
- Modify: `apps/backend/src/channex/channex.module.ts`

- [ ] **Step 1: Inject MigoPropertyService into the booking worker**

In `channex-booking.worker.ts`, add the import at the top:

```typescript
import { MigoPropertyService } from '../../migo-property/migo-property.service';
```

Update the constructor to add `MigoPropertyService`:

```typescript
constructor(
  private readonly channex: ChannexService,
  private readonly propertyService: ChannexPropertyService,
  private readonly firebase: FirebaseService,
  private readonly eventEmitter: EventEmitter2,
  private readonly migoPropertyService: MigoPropertyService,
) {}
```

- [ ] **Step 2: Add pool availability update after booking persistence in processInternal**

In `processInternal`, find the block that reads the property doc (around line 216):

```typescript
const propertyDocSnap = await propertyDocRef.get();
reservationDoc.ota_listing_id =
  (propertyDocSnap.data()?.airbnb_listing_id as string | undefined) ?? null;
```

After that block (and after the `if (bookingUniqueId)` and booking persistence blocks), add the pool availability step. Place it just before `if (revisionId) { await this.channex.acknowledgeBookingRevision(revisionId); }`:

```typescript
// ── Pool availability update (MigoProperty) ──────────────────────────────────
// The migo_property_id backref is stored on the Channex property doc.
// We already read the property doc above, so no extra Firestore call.
const migoPropertyId =
  (propertyDocSnap.data()?.migo_property_id as string | null) ?? null;

if (migoPropertyId) {
  if (event === 'booking_new') {
    // Fire-and-forget: availability failure must not fail the booking job
    this.migoPropertyService.decrementAvailability(migoPropertyId).catch((err) => {
      this.logger.error(
        `[BOOKING-WORKER] decrementAvailability failed — ` +
          `migoPropertyId=${migoPropertyId}: ${(err as Error).message}`,
      );
    });
  } else if (event === 'booking_cancellation') {
    this.migoPropertyService.incrementAvailability(migoPropertyId).catch((err) => {
      this.logger.error(
        `[BOOKING-WORKER] incrementAvailability failed — ` +
          `migoPropertyId=${migoPropertyId}: ${(err as Error).message}`,
      );
    });
  }
}
```

The full sequence in `processInternal` after this change (for reference):

```
1. resolveIntegration(propertyId)         ← existing
2. handle reservation_request/alteration  ← existing
3. handle booking_unmapped_room           ← existing
4. extract booking data                   ← existing
5. transform to FirestoreReservationDoc   ← existing
6. read propertyDocSnap                   ← existing
7. upsert booking to Firestore            ← existing
8. pool availability update               ← NEW (fire-and-forget)
9. acknowledgeBookingRevision             ← existing
10. emit booking_new SSE                  ← existing
```

- [ ] **Step 3: Import MigoPropertyModule in ChannexModule**

In `apps/backend/src/channex/channex.module.ts`, add the import:

```typescript
import { MigoPropertyModule } from '../migo-property/migo-property.module';
```

Add to the `imports` array:

```typescript
@Module({
  imports: [MigoPropertyModule],   // ← add this
  providers: [...],
  controllers: [...],
  exports: [...],
})
```

`MigoPropertyModule` exports `MigoPropertyService`, which NestJS DI then makes available to `ChannexBookingWorker` automatically.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd apps/backend && pnpm tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/channex/workers/channex-booking.worker.ts \
        apps/backend/src/channex/channex.module.ts
git commit -m "feat(migo-property): wire booking worker to decrement/increment pool availability"
```

---

## Task 9: Update ChannexEventsController to forward availability alerts

**Files:**
- Modify: `apps/backend/src/channex/channex-events.controller.ts`

- [ ] **Step 1: Add the import**

In `channex-events.controller.ts`, update the import from `channex.types`:

```typescript
import {
  CHANNEX_EVENTS,
  MIGO_PROPERTY_EVENTS,
  type ChannexBaseEvent,
  type MigoPropertyAvailabilityAlertEvent,
} from './channex.types';
```

- [ ] **Step 2: Add the availability alert handler inside the Observable**

In the `stream` method, after the existing handler declarations, add:

```typescript
const availabilityAlertHandler = (
  payload: MigoPropertyAvailabilityAlertEvent,
): void => {
  if (payload.tenantId !== tenantId) return;

  this.logger.debug(
    `[SSE] Forwarding type=availability_alert tenantId=${tenantId}`,
  );

  subscriber.next({
    data: { type: 'availability_alert', ...payload },
  } as MessageEvent);
};
```

Add the subscription:

```typescript
this.emitter.on(CHANNEX_EVENTS.CONNECTION_STATUS_CHANGE, statusHandler);
this.emitter.on(CHANNEX_EVENTS.BOOKING_NEW, bookingHandler);
this.emitter.on(CHANNEX_EVENTS.BOOKING_UNMAPPED_ROOM, unmappedHandler);
this.emitter.on(MIGO_PROPERTY_EVENTS.AVAILABILITY_ALERT, availabilityAlertHandler);  // ← add
```

Add the teardown:

```typescript
return () => {
  this.logger.log(`[SSE] Client disconnected — tenantId=${tenantId}`);
  this.emitter.off(CHANNEX_EVENTS.CONNECTION_STATUS_CHANGE, statusHandler);
  this.emitter.off(CHANNEX_EVENTS.BOOKING_NEW, bookingHandler);
  this.emitter.off(CHANNEX_EVENTS.BOOKING_UNMAPPED_ROOM, unmappedHandler);
  this.emitter.off(MIGO_PROPERTY_EVENTS.AVAILABILITY_ALERT, availabilityAlertHandler); // ← add
};
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/backend && pnpm tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/channex/channex-events.controller.ts
git commit -m "feat(migo-property): forward availability_alert events via SSE"
```

---

## Task 10: End-to-end smoke test with curl

The backend must be running (`pnpm --filter @migo-uit/backend dev`) and a Channex integration must exist for `<tenantId>` with at least one `channex_property_id`.

Substitute `TENANT_ID`, `CHANNEX_PROPERTY_ID`, `MIGO_ID`, and `CHANNEX_ID` with real values.

- [ ] **Step 1: Create a property type (Studio Full, 5 units)**

```bash
curl -X POST http://localhost:3001/migo-properties \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "TENANT_ID",
    "title": "Studio Full",
    "total_units": 5,
    "alert_threshold": 1
  }'
```

Expected response: `201` with `{ id: "MIGO_ID", current_availability: 5, platform_connections: [] }`

- [ ] **Step 2: Assign an Airbnb channel connection**

```bash
curl -X POST http://localhost:3001/migo-properties/MIGO_ID/connections \
  -H "Content-Type: application/json" \
  -d '{
    "channexPropertyId": "CHANNEX_PROPERTY_ID",
    "platform": "airbnb",
    "listingTitle": "Studio Full",
    "isSyncEnabled": true
  }'
```

Expected response: `201` with `platform_connections` array containing the new entry.
Also verify in Firestore: `channex_integrations/{tenantId}/properties/{channexPropertyId}` now has `migo_property_id: "MIGO_ID"`.

- [ ] **Step 3: List property types for the tenant**

```bash
curl "http://localhost:3001/migo-properties?tenantId=TENANT_ID"
```

Expected: `200` with array containing "Studio Full".

- [ ] **Step 4: Toggle sync off for the connection**

```bash
curl -X PATCH http://localhost:3001/migo-properties/MIGO_ID/connections/CHANNEX_PROPERTY_ID \
  -H "Content-Type: application/json" \
  -d '{ "isSyncEnabled": false }'
```

Expected: `200` with `is_sync_enabled: false` in the connection entry.

- [ ] **Step 5: Push ARI fan-out (stop_sell) to all enabled connections**

Re-enable sync first if you toggled it off. Then:

```bash
curl -X POST http://localhost:3001/channex/ari/migo-property/MIGO_ID \
  -H "Content-Type: application/json" \
  -d '{
    "dateFrom": "2026-06-01",
    "dateTo": "2026-06-30",
    "stopSell": true
  }'
```

Expected: `200` with `{ status: 200, succeeded: ["CHANNEX_PROPERTY_ID"], failed: [] }`.
Verify in Channex dashboard that the listing shows stop_sell for June.

- [ ] **Step 6: Reset availability**

```bash
curl -X POST http://localhost:3001/migo-properties/MIGO_ID/availability/reset
```

Expected: `200` with `current_availability: 5`.

- [ ] **Step 7: Simulate a booking webhook and verify decrement**

Send a simulated booking_new webhook (or trigger a real one via Airbnb test booking).
After processing, verify in Firestore: `migo_properties/MIGO_ID.current_availability` is 4.
If `alert_threshold: 1` and availability drops to 1, the SSE stream should emit `availability_alert`.

- [ ] **Step 8: Remove a connection and verify backref cleared**

```bash
curl -X DELETE http://localhost:3001/migo-properties/MIGO_ID/connections/CHANNEX_PROPERTY_ID
```

Expected: `200` with empty `platform_connections`.
Verify in Firestore: `migo_property_id` is `null` on the Channex property doc.

- [ ] **Step 9: Delete the property type**

```bash
curl -X DELETE http://localhost:3001/migo-properties/MIGO_ID
```

Expected: `204 No Content`.

- [ ] **Step 10: Final compile + commit**

```bash
cd apps/backend && pnpm tsc --noEmit
git add -A
git commit -m "feat(migo-property): complete MigoProperty pool implementation"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** All 7 spec sections covered (Firestore model ✓, MigoPropertyService ✓, controller ✓, booking worker ✓, ARI fan-out ✓, SSE event ✓, index ✓)
- [x] **No placeholders:** All steps contain actual code
- [x] **Type consistency:** `MigoPropertyDoc`, `PlatformConnection`, `MigoPropertyAriDto` defined once in Task 2-3 and referenced consistently in Tasks 6-9
- [x] **No circular deps:** `MigoPropertyModule` imports nothing from `ChannexModule`; `ChannexModule` imports `MigoPropertyModule`
- [x] **Backref written in `assignConnection`, cleared in `removeConnection`** — verified in Task 3
- [x] **Fire-and-forget pattern in booking worker** — availability failure does not abort the booking job
- [x] **`FieldValue.increment` import** — `firebase-admin/firestore` (consistent with existing `channex-sync.service.ts`)

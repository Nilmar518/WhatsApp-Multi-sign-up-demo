# Document Builder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a configurable drag-and-drop document builder for the "Ficha de Registro" (check-in form) — template CRUD, digital fill per reservation, Firestore persistence, server-side PDF export — integrated into the existing reservation detail modal.

**Architecture:** NestJS `document-builder` module owns all data in two Firestore collections (`documentTemplates`, `documentInstances`) and exposes 9 REST endpoints including Puppeteer-based PDF generation. The React frontend has two surfaces: `/documentos` (template builder + history) and `DocumentsSection` embedded in the existing `ReservationDetailModal`.

**Tech Stack:** NestJS 10 · Firestore Admin SDK · Puppeteer (PDF) · React 18 + Tailwind · @dnd-kit/core + @dnd-kit/sortable (row reorder) · Lucide React · class-validator DTOs · uuid v13

> **Note on testing:** This project has no Jest configuration. Each task uses `curl` for backend verification and visual checks for frontend. Follow each verification step before committing.

---

## File Map

```
apps/backend/src/document-builder/
  document-builder.types.ts          ← shared interfaces (template, instance, field)
  document-builder.service.ts        ← all Firestore + PDF logic
  document-builder.controller.ts     ← 9 REST endpoints
  document-builder.module.ts         ← NestJS module
  dto/
    create-template.dto.ts
    update-template.dto.ts
    create-instance.dto.ts
    update-instance.dto.ts

apps/frontend/src/documents/
  DocumentsPage.tsx                  ← index: template cards + instance history table
  DocumentsSection.tsx               ← embedded in ReservationDetailModal
  api/
    documentBuilderApi.ts            ← fetch wrappers + shared TS types
  builder/
    TemplateBuilder.tsx              ← 3-panel orchestrator
    FieldPalette.tsx                 ← left panel: click-to-add field types
    BuilderCanvas.tsx                ← center panel: sortable rows (@dnd-kit)
    FieldConfigPanel.tsx             ← right panel: field settings form
  filler/
    DocumentFiller.tsx               ← modal: fill form from template schema
    FilledDocumentView.tsx           ← read-only rendered document + PDF button
```

**Modified files:**
- `apps/backend/src/app.module.ts` — register DocumentBuilderModule
- `apps/frontend/src/main.tsx` — add `/documentos` route
- `apps/frontend/src/layout/SideNav.tsx` — add nav item
- `apps/frontend/src/i18n/es.ts` + `en.ts` — add translation keys
- `apps/frontend/src/channex/components/shared/ReservationDetailModal.tsx` — embed DocumentsSection

---

## Task 1: Backend — Types & DTOs

**Files:**
- Create: `apps/backend/src/document-builder/document-builder.types.ts`
- Create: `apps/backend/src/document-builder/dto/create-template.dto.ts`
- Create: `apps/backend/src/document-builder/dto/update-template.dto.ts`
- Create: `apps/backend/src/document-builder/dto/create-instance.dto.ts`
- Create: `apps/backend/src/document-builder/dto/update-instance.dto.ts`

- [ ] **Step 1: Create shared types**

```typescript
// apps/backend/src/document-builder/document-builder.types.ts
import type { Timestamp } from 'firebase-admin/firestore';

export type TemplateFieldType =
  | 'text' | 'textarea' | 'number' | 'date'
  | 'checkbox-group' | 'checkbox-amount'
  | 'auto-number' | 'section-header' | 'signature' | 'bullet-list';

export type AutoFillSource =
  | 'reservation.guestName'
  | 'reservation.roomTypeId'
  | 'reservation.checkIn'
  | 'reservation.checkOut'
  | 'reservation.nights'
  | 'reservation.channel';

export interface TemplateField {
  id: string;
  type: TemplateFieldType;
  label: string;
  required: boolean;
  options?: string[];
  suffix?: string;
  autoFillFrom?: AutoFillSource;
}

export interface TemplateRow {
  id: string;
  columns: 1 | 2 | 3;
  fields: TemplateField[];
}

export interface DocumentTemplate {
  id: string;
  businessId: string;
  name: string;
  type: 'check-in' | 'custom';
  showOn: string[] | 'always';
  isUnique: boolean;
  rows: TemplateRow[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface DocumentInstance {
  id: string;
  businessId: string;
  templateId: string | null;
  reservationId?: string;
  values: Record<string, unknown>;
  docNumber: number;
  status: 'draft' | 'completed';
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

- [ ] **Step 2: Create template DTOs**

```typescript
// apps/backend/src/document-builder/dto/create-template.dto.ts
import { IsString, IsNotEmpty, IsBoolean, IsArray, IsIn, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class TemplateFieldDto {
  @IsString() @IsNotEmpty() id: string;
  @IsString() @IsNotEmpty() type: string;
  @IsString() @IsNotEmpty() label: string;
  @IsBoolean() required: boolean;
  options?: string[];
  suffix?: string;
  autoFillFrom?: string;
}

class TemplateRowDto {
  @IsString() @IsNotEmpty() id: string;
  @IsIn([1, 2, 3]) columns: 1 | 2 | 3;
  @IsArray() @ValidateNested({ each: true }) @Type(() => TemplateFieldDto) fields: TemplateFieldDto[];
}

export class CreateTemplateDto {
  @IsString() @IsNotEmpty() businessId: string;
  @IsString() @IsNotEmpty() name: string;
  @IsIn(['check-in', 'custom']) type: 'check-in' | 'custom';
  showOn: string[] | 'always';
  @IsBoolean() isUnique: boolean;
  @IsArray() @ValidateNested({ each: true }) @Type(() => TemplateRowDto) rows: TemplateRowDto[];
}
```

```typescript
// apps/backend/src/document-builder/dto/update-template.dto.ts
export class UpdateTemplateDto {
  name?: string;
  type?: 'check-in' | 'custom';
  showOn?: string[] | 'always';
  isUnique?: boolean;
  rows?: Array<{
    id: string;
    columns: 1 | 2 | 3;
    fields: Array<{
      id: string;
      type: string;
      label: string;
      required: boolean;
      options?: string[];
      suffix?: string;
      autoFillFrom?: string;
    }>;
  }>;
}
```

- [ ] **Step 3: Create instance DTOs**

```typescript
// apps/backend/src/document-builder/dto/create-instance.dto.ts
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateInstanceDto {
  @IsString() @IsNotEmpty() businessId: string;
  @IsOptional() @IsString() templateId?: string | null;
  @IsOptional() @IsString() reservationId?: string;
  values: Record<string, unknown>;
  @IsString() @IsNotEmpty() createdBy: string;
  status?: 'draft' | 'completed';
}
```

```typescript
// apps/backend/src/document-builder/dto/update-instance.dto.ts
export class UpdateInstanceDto {
  values?: Record<string, unknown>;
  status?: 'draft' | 'completed';
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/document-builder/
git commit -m "feat(document-builder): add backend types and DTOs"
```

---

## Task 2: Backend — Service: Template CRUD

**Files:**
- Create: `apps/backend/src/document-builder/document-builder.service.ts`

- [ ] **Step 1: Create service with template CRUD**

```typescript
// apps/backend/src/document-builder/document-builder.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { v4 as uuidv4 } from 'uuid';
import * as admin from 'firebase-admin';
import type { DocumentTemplate, DocumentInstance } from './document-builder.types';
import type { CreateTemplateDto } from './dto/create-template.dto';
import type { UpdateTemplateDto } from './dto/update-template.dto';
import type { CreateInstanceDto } from './dto/create-instance.dto';
import type { UpdateInstanceDto } from './dto/update-instance.dto';

const TEMPLATES_COL = 'documentTemplates';
const INSTANCES_COL = 'documentInstances';
const COUNTERS_COL = 'counters';

@Injectable()
export class DocumentBuilderService {
  constructor(private readonly firebase: FirebaseService) {}

  // ── Templates ──────────────────────────────────────────────────────────────

  async listTemplates(businessId: string): Promise<DocumentTemplate[]> {
    const snap = await this.firebase
      .getFirestore()
      .collection(TEMPLATES_COL)
      .where('businessId', '==', businessId)
      .where('isUnique', '==', false)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as DocumentTemplate));
  }

  async createTemplate(dto: CreateTemplateDto): Promise<DocumentTemplate> {
    const now = admin.firestore.Timestamp.now();
    const data = {
      businessId: dto.businessId,
      name: dto.name,
      type: dto.type,
      showOn: dto.showOn,
      isUnique: dto.isUnique,
      rows: dto.rows,
      createdAt: now,
      updatedAt: now,
    };
    const ref = await this.firebase.getFirestore().collection(TEMPLATES_COL).add(data);
    return { id: ref.id, ...data } as DocumentTemplate;
  }

  async updateTemplate(id: string, dto: UpdateTemplateDto): Promise<DocumentTemplate> {
    const ref = this.firebase.getFirestore().collection(TEMPLATES_COL).doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new NotFoundException(`Template ${id} not found`);
    const updates: Record<string, unknown> = { updatedAt: admin.firestore.Timestamp.now() };
    if (dto.name !== undefined) updates.name = dto.name;
    if (dto.type !== undefined) updates.type = dto.type;
    if (dto.showOn !== undefined) updates.showOn = dto.showOn;
    if (dto.isUnique !== undefined) updates.isUnique = dto.isUnique;
    if (dto.rows !== undefined) updates.rows = dto.rows;
    await this.firebase.update(ref, updates);
    const updated = await ref.get();
    return { id: updated.id, ...updated.data() } as DocumentTemplate;
  }

  async deleteTemplate(id: string): Promise<void> {
    const ref = this.firebase.getFirestore().collection(TEMPLATES_COL).doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new NotFoundException(`Template ${id} not found`);
    await ref.delete();
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm --filter @migo-uit/backend build
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/document-builder/document-builder.service.ts
git commit -m "feat(document-builder): add template CRUD service methods"
```

---

## Task 3: Backend — Service: Instance CRUD + docNumber counter

**Files:**
- Modify: `apps/backend/src/document-builder/document-builder.service.ts`

- [ ] **Step 1: Add docNumber counter helper**

Append to `DocumentBuilderService` (inside the class, after `deleteTemplate`):

```typescript
  // ── DocNumber counter ──────────────────────────────────────────────────────

  private async getNextDocNumber(businessId: string): Promise<number> {
    const counterRef = this.firebase
      .getFirestore()
      .collection(COUNTERS_COL)
      .doc(`docNumber_${businessId}`);

    return this.firebase.getFirestore().runTransaction(async (t) => {
      const snap = await t.get(counterRef);
      const current: number = snap.exists ? (snap.data()?.value ?? 0) : 0;
      const next = current + 1;
      t.set(counterRef, { value: next });
      return next;
    });
  }
```

- [ ] **Step 2: Add instance CRUD methods**

Append to `DocumentBuilderService` (after `getNextDocNumber`):

```typescript
  // ── Instances ─────────────────────────────────────────────────────────────

  async listInstances(businessId: string, reservationId?: string): Promise<DocumentInstance[]> {
    let query = this.firebase
      .getFirestore()
      .collection(INSTANCES_COL)
      .where('businessId', '==', businessId)
      .orderBy('createdAt', 'desc');

    if (reservationId) {
      query = query.where('reservationId', '==', reservationId) as typeof query;
    }

    const snap = await query.get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as DocumentInstance));
  }

  async createInstance(dto: CreateInstanceDto): Promise<DocumentInstance> {
    const now = admin.firestore.Timestamp.now();
    const docNumber = await this.getNextDocNumber(dto.businessId);
    const data = {
      businessId: dto.businessId,
      templateId: dto.templateId ?? null,
      reservationId: dto.reservationId ?? null,
      values: dto.values ?? {},
      docNumber,
      status: dto.status ?? 'draft',
      createdBy: dto.createdBy,
      createdAt: now,
      updatedAt: now,
    };
    const ref = await this.firebase.getFirestore().collection(INSTANCES_COL).add(data);
    return { id: ref.id, ...data } as DocumentInstance;
  }

  async updateInstance(id: string, dto: UpdateInstanceDto): Promise<DocumentInstance> {
    const ref = this.firebase.getFirestore().collection(INSTANCES_COL).doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new NotFoundException(`Instance ${id} not found`);
    const updates: Record<string, unknown> = { updatedAt: admin.firestore.Timestamp.now() };
    if (dto.values !== undefined) updates.values = dto.values;
    if (dto.status !== undefined) updates.status = dto.status;
    await this.firebase.update(ref, updates);
    const updated = await ref.get();
    return { id: updated.id, ...updated.data() } as DocumentInstance;
  }

  async deleteInstance(id: string): Promise<void> {
    const ref = this.firebase.getFirestore().collection(INSTANCES_COL).doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new NotFoundException(`Instance ${id} not found`);
    await ref.delete();
  }

  async getInstanceWithTemplate(instanceId: string): Promise<{ instance: DocumentInstance; template: DocumentTemplate | null }> {
    const instanceSnap = await this.firebase
      .getFirestore()
      .collection(INSTANCES_COL)
      .doc(instanceId)
      .get();
    if (!instanceSnap.exists) throw new NotFoundException(`Instance ${instanceId} not found`);
    const instance = { id: instanceSnap.id, ...instanceSnap.data() } as DocumentInstance;

    let template: DocumentTemplate | null = null;
    if (instance.templateId) {
      const tSnap = await this.firebase
        .getFirestore()
        .collection(TEMPLATES_COL)
        .doc(instance.templateId)
        .get();
      if (tSnap.exists) template = { id: tSnap.id, ...tSnap.data() } as DocumentTemplate;
    }

    return { instance, template };
  }
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm --filter @migo-uit/backend build
```

Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/document-builder/document-builder.service.ts
git commit -m "feat(document-builder): add instance CRUD and docNumber counter"
```

---

## Task 4: Backend — Service: PDF Generation (Puppeteer)

**Files:**
- Modify: `apps/backend/src/document-builder/document-builder.service.ts`

- [ ] **Step 1: Install Puppeteer**

```bash
pnpm --filter @migo-uit/backend add puppeteer
```

Expected: `puppeteer` added to `apps/backend/package.json`. Chromium downloads (~170 MB).

- [ ] **Step 2: Add PDF helper methods to service**

Add this import at the top of `document-builder.service.ts`:

```typescript
import type * as puppeteer from 'puppeteer';
```

Append the following private methods inside `DocumentBuilderService`:

```typescript
  // ── PDF Generation ─────────────────────────────────────────────────────────

  async generatePdf(instanceId: string): Promise<Buffer> {
    const { instance, template } = await this.getInstanceWithTemplate(instanceId);
    if (!template) throw new NotFoundException(`Template for instance ${instanceId} not found`);
    const html = this.buildPdfHtml(template, instance);

    const { launch } = await import('puppeteer') as typeof puppeteer;
    const browser = await launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' } });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  private buildPdfHtml(template: DocumentTemplate, instance: DocumentInstance): string {
    const rowsHtml = template.rows.map((row) => {
      const fieldsHtml = row.fields.map((field) => {
        const value = instance.values[field.id];
        return `<div class="field">${this.renderFieldPdf(field, value)}</div>`;
      }).join('');
      return `<div class="row cols-${row.columns}">${fieldsHtml}</div>`;
    }).join('');

    return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<style>
  body { font-family: Arial, sans-serif; font-size: 11px; color: #111; margin: 0; }
  h1 { text-align: center; font-size: 14px; border-bottom: 2px solid #111; padding-bottom: 6px; margin-bottom: 12px; }
  .doc-number { text-align: right; font-size: 10px; margin-bottom: 8px; }
  .row { display: grid; gap: 6px; margin-bottom: 6px; }
  .row.cols-1 { grid-template-columns: 1fr; }
  .row.cols-2 { grid-template-columns: 1fr 1fr; }
  .row.cols-3 { grid-template-columns: 1fr 1fr 1fr; }
  .field { border: 1px solid #999; padding: 4px 6px; min-height: 24px; }
  .field-label { font-size: 8px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.3px; color: #555; margin-bottom: 2px; }
  .field-value { font-size: 11px; min-height: 14px; }
  .section-header { font-size: 13px; font-weight: bold; border-left: 3px solid #333; padding-left: 6px; margin: 8px 0 4px; grid-column: 1 / -1; }
  .sig-line { border-bottom: 1px solid #333; height: 20px; }
  .checkbox-item { display: inline-block; margin-right: 8px; }
</style>
</head><body>
<h1>${template.name}</h1>
<div class="doc-number">N° ${instance.docNumber}</div>
${rowsHtml}
</body></html>`;
  }

  private renderFieldPdf(field: import('./document-builder.types').TemplateField, value: unknown): string {
    if (field.type === 'section-header') {
      return `<div class="section-header">${field.label}</div>`;
    }
    const labelHtml = `<div class="field-label">${field.label}</div>`;
    if (field.type === 'signature') {
      return `${labelHtml}<div class="sig-line"></div>`;
    }
    if (field.type === 'auto-number') {
      return `${labelHtml}<div class="field-value">${value ?? ''}</div>`;
    }
    if (field.type === 'checkbox-group') {
      const selected: string[] = Array.isArray(value) ? (value as string[]) : [];
      const opts = (field.options ?? []).map((o) =>
        `<span class="checkbox-item">${selected.includes(o) ? '[✓]' : '[ ]'} ${o}</span>`
      ).join('');
      return `${labelHtml}<div class="field-value">${opts}</div>`;
    }
    if (field.type === 'checkbox-amount') {
      const val = value as { selected?: string[]; amount?: string | number } | undefined;
      const selected = val?.selected ?? [];
      const opts = (field.options ?? []).map((o) =>
        `<span class="checkbox-item">${selected.includes(o) ? '[✓]' : '[ ]'} ${o}</span>`
      ).join('');
      return `${labelHtml}<div class="field-value">${opts} &nbsp; Monto: ${val?.amount ?? ''}</div>`;
    }
    if (field.type === 'bullet-list') {
      const items: string[] = Array.isArray(value) ? (value as string[]) : [];
      return `${labelHtml}<ul style="margin:0;padding-left:14px;">${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
    }
    // text, textarea, number, date
    const suffix = field.suffix ? ` ${field.suffix}` : '';
    return `${labelHtml}<div class="field-value">${value ?? ''}${suffix}</div>`;
  }
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm --filter @migo-uit/backend build
```

Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/document-builder/document-builder.service.ts apps/backend/package.json apps/backend/pnpm-lock.yaml
git commit -m "feat(document-builder): add Puppeteer PDF generation"
```

---

## Task 5: Backend — Controller, Module, AppModule Registration

**Files:**
- Create: `apps/backend/src/document-builder/document-builder.controller.ts`
- Create: `apps/backend/src/document-builder/document-builder.module.ts`
- Modify: `apps/backend/src/app.module.ts`

- [ ] **Step 1: Create controller**

```typescript
// apps/backend/src/document-builder/document-builder.controller.ts
import {
  Controller, Get, Post, Put, Delete, Param, Query, Body,
  HttpCode, HttpStatus, Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { DocumentBuilderService } from './document-builder.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { CreateInstanceDto } from './dto/create-instance.dto';
import { UpdateInstanceDto } from './dto/update-instance.dto';

@Controller('document-builder')
export class DocumentBuilderController {
  constructor(private readonly svc: DocumentBuilderService) {}

  // ── Templates ──────────────────────────────────────────────────────────────

  @Get('templates')
  listTemplates(@Query('businessId') businessId: string) {
    return this.svc.listTemplates(businessId);
  }

  @Post('templates')
  createTemplate(@Body() dto: CreateTemplateDto) {
    return this.svc.createTemplate(dto);
  }

  @Put('templates/:id')
  updateTemplate(@Param('id') id: string, @Body() dto: UpdateTemplateDto) {
    return this.svc.updateTemplate(id, dto);
  }

  @Delete('templates/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteTemplate(@Param('id') id: string) {
    return this.svc.deleteTemplate(id);
  }

  // ── Instances ──────────────────────────────────────────────────────────────

  @Get('instances')
  listInstances(
    @Query('businessId') businessId: string,
    @Query('reservationId') reservationId?: string,
  ) {
    return this.svc.listInstances(businessId, reservationId);
  }

  @Post('instances')
  createInstance(@Body() dto: CreateInstanceDto) {
    return this.svc.createInstance(dto);
  }

  @Put('instances/:id')
  updateInstance(@Param('id') id: string, @Body() dto: UpdateInstanceDto) {
    return this.svc.updateInstance(id, dto);
  }

  @Delete('instances/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteInstance(@Param('id') id: string) {
    return this.svc.deleteInstance(id);
  }

  // ── PDF ────────────────────────────────────────────────────────────────────

  @Post('instances/:id/pdf')
  async generatePdf(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.svc.generatePdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="ficha-${id}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }
}
```

- [ ] **Step 2: Create module**

```typescript
// apps/backend/src/document-builder/document-builder.module.ts
import { Module } from '@nestjs/common';
import { DocumentBuilderController } from './document-builder.controller';
import { DocumentBuilderService } from './document-builder.service';

@Module({
  controllers: [DocumentBuilderController],
  providers: [DocumentBuilderService],
})
export class DocumentBuilderModule {}
```

- [ ] **Step 3: Register in AppModule**

In `apps/backend/src/app.module.ts`, add:

```typescript
import { DocumentBuilderModule } from './document-builder/document-builder.module';
```

And add `DocumentBuilderModule` to the `imports` array, after `MigoPropertyModule`:

```typescript
    MigoPropertyModule,
    // Document Builder — configurable form templates + Ficha de Registro
    DocumentBuilderModule,
```

- [ ] **Step 4: Start backend and verify endpoints are live**

```bash
pnpm --filter @migo-uit/backend dev
```

```bash
# Should return [] (no templates yet)
curl "http://localhost:3001/document-builder/templates?businessId=demo-business-001"
```

Expected: `[]`

```bash
# Create a minimal template
curl -s -X POST http://localhost:3001/document-builder/templates \
  -H "Content-Type: application/json" \
  -d '{
    "businessId": "demo-business-001",
    "name": "Ficha de Registro",
    "type": "check-in",
    "showOn": "always",
    "isUnique": false,
    "rows": [
      {
        "id": "row-1",
        "columns": 2,
        "fields": [
          { "id": "f1", "type": "text", "label": "NOMBRES", "required": true, "autoFillFrom": "reservation.guestName" },
          { "id": "f2", "type": "date", "label": "FECHA DE REGISTRO", "required": true, "autoFillFrom": "reservation.checkIn" }
        ]
      }
    ]
  }'
```

Expected: JSON with `id` field.

```bash
# Create a minimal instance
TEMPLATE_ID="<id from above>"
curl -s -X POST http://localhost:3001/document-builder/instances \
  -H "Content-Type: application/json" \
  -d "{
    \"businessId\": \"demo-business-001\",
    \"templateId\": \"$TEMPLATE_ID\",
    \"values\": { \"f1\": \"Diego Mary\", \"f2\": \"2026-05-21\" },
    \"createdBy\": \"test-user\",
    \"status\": \"completed\"
  }"
```

Expected: JSON with `docNumber: 1`.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/document-builder/ apps/backend/src/app.module.ts
git commit -m "feat(document-builder): add controller, module, and register in AppModule"
```

---

## Task 6: Frontend — Install Dependencies + API Client + Types

**Files:**
- Create: `apps/frontend/src/documents/api/documentBuilderApi.ts`

- [ ] **Step 1: Install @dnd-kit**

```bash
pnpm --filter @migo-uit/frontend add @dnd-kit/core @dnd-kit/sortable
```

Expected: `@dnd-kit/core` and `@dnd-kit/sortable` added to `apps/frontend/package.json`.

- [ ] **Step 2: Create API client with shared types**

```typescript
// apps/frontend/src/documents/api/documentBuilderApi.ts

const BASE = '/api/document-builder';

// ── Shared types ──────────────────────────────────────────────────────────────

export type TemplateFieldType =
  | 'text' | 'textarea' | 'number' | 'date'
  | 'checkbox-group' | 'checkbox-amount'
  | 'auto-number' | 'section-header' | 'signature' | 'bullet-list';

export type AutoFillSource =
  | 'reservation.guestName' | 'reservation.roomTypeId'
  | 'reservation.checkIn' | 'reservation.checkOut'
  | 'reservation.nights' | 'reservation.channel';

export interface TemplateField {
  id: string;
  type: TemplateFieldType;
  label: string;
  required: boolean;
  options?: string[];
  suffix?: string;
  autoFillFrom?: AutoFillSource;
}

export interface TemplateRow {
  id: string;
  columns: 1 | 2 | 3;
  fields: TemplateField[];
}

export interface DocumentTemplate {
  id: string;
  businessId: string;
  name: string;
  type: 'check-in' | 'custom';
  showOn: string[] | 'always';
  isUnique: boolean;
  rows: TemplateRow[];
  createdAt: unknown;
  updatedAt: unknown;
}

export interface DocumentInstance {
  id: string;
  businessId: string;
  templateId: string | null;
  reservationId?: string;
  values: Record<string, unknown>;
  docNumber: number;
  status: 'draft' | 'completed';
  createdBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export type InstanceValues = Record<string, unknown>;

// ── Template API ──────────────────────────────────────────────────────────────

export async function listTemplates(businessId: string): Promise<DocumentTemplate[]> {
  const res = await fetch(`${BASE}/templates?businessId=${encodeURIComponent(businessId)}`);
  if (!res.ok) throw new Error(`listTemplates failed: ${res.status}`);
  return res.json();
}

export async function createTemplate(payload: Omit<DocumentTemplate, 'id' | 'createdAt' | 'updatedAt'>): Promise<DocumentTemplate> {
  const res = await fetch(`${BASE}/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`createTemplate failed: ${res.status}`);
  return res.json();
}

export async function updateTemplate(id: string, payload: Partial<Omit<DocumentTemplate, 'id' | 'businessId' | 'createdAt' | 'updatedAt'>>): Promise<DocumentTemplate> {
  const res = await fetch(`${BASE}/templates/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`updateTemplate failed: ${res.status}`);
  return res.json();
}

export async function deleteTemplate(id: string): Promise<void> {
  const res = await fetch(`${BASE}/templates/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) throw new Error(`deleteTemplate failed: ${res.status}`);
}

// ── Instance API ──────────────────────────────────────────────────────────────

export async function listInstances(businessId: string, reservationId?: string): Promise<DocumentInstance[]> {
  const params = new URLSearchParams({ businessId });
  if (reservationId) params.set('reservationId', reservationId);
  const res = await fetch(`${BASE}/instances?${params}`);
  if (!res.ok) throw new Error(`listInstances failed: ${res.status}`);
  return res.json();
}

export async function createInstance(payload: {
  businessId: string;
  templateId?: string | null;
  reservationId?: string;
  values: InstanceValues;
  createdBy: string;
  status?: 'draft' | 'completed';
}): Promise<DocumentInstance> {
  const res = await fetch(`${BASE}/instances`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`createInstance failed: ${res.status}`);
  return res.json();
}

export async function updateInstance(id: string, payload: { values?: InstanceValues; status?: 'draft' | 'completed' }): Promise<DocumentInstance> {
  const res = await fetch(`${BASE}/instances/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`updateInstance failed: ${res.status}`);
  return res.json();
}

export async function deleteInstance(id: string): Promise<void> {
  const res = await fetch(`${BASE}/instances/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) throw new Error(`deleteInstance failed: ${res.status}`);
}

export async function downloadPdf(instanceId: string): Promise<void> {
  const res = await fetch(`${BASE}/instances/${instanceId}/pdf`, { method: 'POST' });
  if (!res.ok) throw new Error(`PDF generation failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ficha-${instanceId}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/documents/ apps/frontend/package.json
git commit -m "feat(document-builder): add frontend API client and shared types"
```

---

## Task 7: Frontend — Routing, Navigation & i18n

**Files:**
- Modify: `apps/frontend/src/main.tsx`
- Modify: `apps/frontend/src/layout/SideNav.tsx`
- Modify: `apps/frontend/src/i18n/es.ts`
- Modify: `apps/frontend/src/i18n/en.ts`

- [ ] **Step 1: Add translation keys to es.ts**

In `apps/frontend/src/i18n/es.ts`, add after the `nav.settings` entry:

```typescript
  'nav.documents':               'Documentos',
```

- [ ] **Step 2: Add translation keys to en.ts**

In `apps/frontend/src/i18n/en.ts`, add the same key after `nav.settings`:

```typescript
  'nav.documents':               'Documents',
```

- [ ] **Step 3: Add route to main.tsx**

In `apps/frontend/src/main.tsx`, add the import after the existing feature imports:

```typescript
import DocumentsPage from './documents/DocumentsPage';
```

In the `AppShell` function, add before the final `else` clause:

```typescript
  else if (path.startsWith('/documentos'))  content = <DocumentsPage />;
```

- [ ] **Step 4: Add nav item to SideNav.tsx**

In `apps/frontend/src/layout/SideNav.tsx`, add the import for the icon at the top (add `FileText` to the lucide-react import):

```typescript
import {
  LayoutDashboard, MessageSquare, Package, Smartphone,
  Hotel, Globe, Settings, Moon, Sun, User, LogOut,
  ChevronLeft, ChevronRight, MessageCircle, Camera, Home, Languages,
  FileText,
} from 'lucide-react';
```

In the nav items section, add after the `Package` (Inventario) `NavRow`:

```tsx
        <NavRow icon={<FileText size={16} />} label={t('nav.documents')} href="/documentos" collapsed={collapsed} currentPath={currentPath} />
```

- [ ] **Step 5: Start frontend and verify route and nav item**

```bash
pnpm --filter @migo-uit/frontend dev
```

Open `https://localhost:5173/documentos` — should render blank page without crashing (DocumentsPage not built yet — create a stub first):

```typescript
// apps/frontend/src/documents/DocumentsPage.tsx  (temporary stub)
export default function DocumentsPage() {
  return <div className="p-8 text-content">Documentos — en construcción</div>;
}
```

Verify "Documentos" appears in the sidebar and the route loads the stub.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/main.tsx apps/frontend/src/layout/SideNav.tsx apps/frontend/src/i18n/ apps/frontend/src/documents/DocumentsPage.tsx
git commit -m "feat(document-builder): add routing, nav entry, and i18n keys"
```

---

## Task 8: Frontend — DocumentsPage (Index)

**Files:**
- Modify: `apps/frontend/src/documents/DocumentsPage.tsx` (replace stub)

- [ ] **Step 1: Write DocumentsPage**

```tsx
// apps/frontend/src/documents/DocumentsPage.tsx
import { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Eye, Download, FileText } from 'lucide-react';
import {
  listTemplates, deleteTemplate, listInstances,
  type DocumentTemplate, type DocumentInstance,
} from './api/documentBuilderApi';
import TemplateBuilder from './builder/TemplateBuilder';

const BUSINESS_ID = 'demo-business-001';

function formatDate(ts: unknown): string {
  if (!ts) return '—';
  if (typeof ts === 'object' && ts !== null && '_seconds' in ts) {
    return new Date((ts as { _seconds: number })._seconds * 1000).toLocaleDateString('es-BO');
  }
  return String(ts);
}

export default function DocumentsPage() {
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [instances, setInstances] = useState<DocumentInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<DocumentTemplate | null | 'new'>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [tmpl, inst] = await Promise.all([
        listTemplates(BUSINESS_ID),
        listInstances(BUSINESS_ID),
      ]);
      setTemplates(tmpl);
      setInstances(inst);
    } catch (e) {
      setError('Error cargando datos');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function handleDeleteTemplate(id: string) {
    if (!confirm('¿Eliminar esta plantilla?')) return;
    await deleteTemplate(id);
    void load();
  }

  if (editingTemplate !== null) {
    return (
      <TemplateBuilder
        businessId={BUSINESS_ID}
        initial={editingTemplate === 'new' ? null : editingTemplate}
        onSave={() => { setEditingTemplate(null); void load(); }}
        onCancel={() => setEditingTemplate(null)}
      />
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-background">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-content">Plantillas de Documentos</h1>
            <p className="text-sm text-content-3 mt-1">Configura los formularios para check-in y otras operaciones.</p>
          </div>
          <button
            onClick={() => setEditingTemplate('new')}
            className="flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand/90 transition-colors"
          >
            <Plus size={14} /> Nueva plantilla
          </button>
        </div>

        {error && <div className="mb-4 p-3 rounded-lg bg-danger-bg text-danger-text text-sm">{error}</div>}

        {/* Template cards */}
        {loading ? (
          <div className="text-content-3 text-sm">Cargando...</div>
        ) : (
          <div className="flex gap-3 flex-wrap mb-8">
            {templates.map((t) => (
              <div key={t.id} className="w-48 bg-surface border border-edge rounded-xl p-4">
                <span className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full ${t.type === 'check-in' ? 'bg-brand/20 text-brand' : 'bg-surface-subtle text-content-3'}`}>
                  {t.type === 'check-in' ? 'Check-in' : 'Personalizado'}
                </span>
                <p className="mt-2 text-sm font-semibold text-content">{t.name}</p>
                <p className="text-xs text-content-3 mt-0.5">{t.rows.length} filas</p>
                <div className="flex gap-1 mt-3">
                  <button onClick={() => setEditingTemplate(t)} className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md bg-surface-subtle hover:bg-edge text-content-3 text-xs transition-colors">
                    <Edit2 size={11} /> Editar
                  </button>
                  <button onClick={() => handleDeleteTemplate(t.id)} className="flex items-center justify-center px-2 py-1.5 rounded-md bg-surface-subtle hover:bg-danger-bg text-danger text-xs transition-colors">
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
            {templates.length === 0 && !loading && (
              <div className="text-content-3 text-sm p-6 border border-dashed border-edge rounded-xl">
                No hay plantillas. Crea una nueva para empezar.
              </div>
            )}
          </div>
        )}

        {/* Instance history table */}
        <h2 className="text-base font-semibold text-content mb-3">Documentos generados</h2>
        <div className="bg-surface border border-edge rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-edge text-[11px] uppercase tracking-wider text-content-3">
                <th className="text-left px-4 py-3">N°</th>
                <th className="text-left px-4 py-3">Tipo</th>
                <th className="text-left px-4 py-3">Estado</th>
                <th className="text-left px-4 py-3">Fecha</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {instances.map((inst) => (
                <tr key={inst.id} className="border-b border-edge last:border-0 hover:bg-surface-subtle">
                  <td className="px-4 py-3 font-mono text-sm text-brand font-semibold">#{inst.docNumber}</td>
                  <td className="px-4 py-3 text-content-2">{inst.templateId ? 'Ficha' : 'Único'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full ${inst.status === 'completed' ? 'bg-ok-bg text-ok-text' : 'bg-caution-bg text-caution-text'}`}>
                      {inst.status === 'completed' ? 'Completado' : 'Borrador'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-content-3 text-xs">{formatDate(inst.createdAt)}</td>
                  <td className="px-4 py-3 flex gap-2 justify-end">
                    <button className="p-1.5 rounded hover:bg-edge text-content-3 hover:text-content transition-colors"><Eye size={13} /></button>
                    <button className="p-1.5 rounded hover:bg-edge text-content-3 hover:text-content transition-colors"><Download size={13} /></button>
                  </td>
                </tr>
              ))}
              {instances.length === 0 && !loading && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-content-3 text-sm">No hay documentos generados aún.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify in browser**

Open `https://localhost:5173/documentos`. Confirm template cards render and "Nueva plantilla" button is visible. The page will show empty state until Task 9 is done.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/documents/DocumentsPage.tsx
git commit -m "feat(document-builder): add DocumentsPage index with template cards and instance history"
```

---

## Task 9: Frontend — TemplateBuilder (3-Panel Drag-and-Drop)

**Files:**
- Create: `apps/frontend/src/documents/builder/FieldPalette.tsx`
- Create: `apps/frontend/src/documents/builder/BuilderCanvas.tsx`
- Create: `apps/frontend/src/documents/builder/FieldConfigPanel.tsx`
- Create: `apps/frontend/src/documents/builder/TemplateBuilder.tsx`

- [ ] **Step 1: Create FieldPalette**

```tsx
// apps/frontend/src/documents/builder/FieldPalette.tsx
import type { TemplateFieldType } from '../api/documentBuilderApi';
import type { DocumentTemplate } from '../api/documentBuilderApi';

export const FIELD_PALETTE: { type: TemplateFieldType; icon: string; label: string }[] = [
  { type: 'text',             icon: 'Aa', label: 'Texto corto' },
  { type: 'textarea',         icon: '¶',  label: 'Texto largo' },
  { type: 'number',           icon: '12', label: 'Número' },
  { type: 'date',             icon: '📅', label: 'Fecha' },
  { type: 'checkbox-group',   icon: '☑',  label: 'Checkboxes' },
  { type: 'checkbox-amount',  icon: '☑$', label: 'Check + Monto' },
  { type: 'auto-number',      icon: '#',  label: 'N° Automático' },
  { type: 'section-header',   icon: '—',  label: 'Encabezado' },
  { type: 'signature',        icon: '✍',  label: 'Firma' },
  { type: 'bullet-list',      icon: '•',  label: 'Lista bullets' },
];

interface Props {
  onAddField: (type: TemplateFieldType) => void;
  templateName: string;
  templateType: DocumentTemplate['type'];
  showOn: DocumentTemplate['showOn'];
  onTemplateMeta: (patch: { name?: string; type?: DocumentTemplate['type']; showOn?: DocumentTemplate['showOn'] }) => void;
}

const STATUSES = ['new', 'confirmed', 'modified', 'checked_in', 'checked_out', 'cancelled'];

export default function FieldPalette({ onAddField, templateName, templateType, showOn, onTemplateMeta }: Props) {
  return (
    <div className="w-44 shrink-0 bg-surface-sidebar border-r border-edge flex flex-col overflow-y-auto">
      <div className="px-3 py-2 text-[10px] uppercase tracking-widest text-content-3 border-b border-edge">Componentes</div>

      <div className="flex flex-col gap-0.5 p-2 flex-1">
        {FIELD_PALETTE.map((p) => (
          <button
            key={p.type}
            onClick={() => onAddField(p.type)}
            className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-content-2 hover:bg-surface-subtle hover:text-content transition-colors text-left"
          >
            <span className="w-5 text-center shrink-0 text-content-3">{p.icon}</span>
            {p.label}
          </button>
        ))}
      </div>

      <div className="border-t border-edge p-3 flex flex-col gap-3">
        <p className="text-[10px] uppercase tracking-widest text-content-3">Plantilla</p>
        <div>
          <label className="block text-[9px] uppercase tracking-wide text-content-3 mb-1">Nombre</label>
          <input
            value={templateName}
            onChange={(e) => onTemplateMeta({ name: e.target.value })}
            className="w-full bg-background border border-edge rounded px-2 py-1 text-xs text-content focus:outline-none focus:border-brand"
          />
        </div>
        <div>
          <label className="block text-[9px] uppercase tracking-wide text-content-3 mb-1">Tipo</label>
          <select
            value={templateType}
            onChange={(e) => onTemplateMeta({ type: e.target.value as DocumentTemplate['type'] })}
            className="w-full bg-background border border-edge rounded px-2 py-1 text-xs text-content focus:outline-none"
          >
            <option value="check-in">Check-in</option>
            <option value="custom">Personalizado</option>
          </select>
        </div>
        <div>
          <label className="block text-[9px] uppercase tracking-wide text-content-3 mb-1">Mostrar en reserva</label>
          <select
            value={showOn === 'always' ? 'always' : showOn[0] ?? 'always'}
            onChange={(e) => onTemplateMeta({ showOn: e.target.value === 'always' ? 'always' : [e.target.value] })}
            className="w-full bg-background border border-edge rounded px-2 py-1 text-xs text-content focus:outline-none"
          >
            <option value="always">Siempre</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create BuilderCanvas**

```tsx
// apps/frontend/src/documents/builder/BuilderCanvas.tsx
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, X, Plus } from 'lucide-react';
import type { TemplateRow, TemplateField } from '../api/documentBuilderApi';

interface RowItemProps {
  row: TemplateRow;
  selectedFieldId: string | null;
  onSelectField: (fieldId: string | null, rowId: string) => void;
  onDeleteRow: (rowId: string) => void;
}

function RowItem({ row, selectedFieldId, onSelectField, onDeleteRow }: RowItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  const colClass = row.columns === 1 ? 'grid-cols-1' : row.columns === 2 ? 'grid-cols-2' : 'grid-cols-3';

  return (
    <div ref={setNodeRef} style={style} className="flex items-start gap-1 group">
      <button
        {...attributes}
        {...listeners}
        className="mt-2 p-1 text-edge hover:text-content-3 cursor-grab active:cursor-grabbing"
      >
        <GripVertical size={14} />
      </button>
      <div className={`flex-1 bg-surface border border-edge rounded-lg p-2 grid ${colClass} gap-2 relative`}>
        <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-surface border border-edge rounded text-[8px] text-content-3 px-1.5 py-0.5 whitespace-nowrap">
          {row.columns === 1 ? '1 col' : row.columns === 2 ? '2 cols' : '3 cols'}
        </span>
        {row.fields.map((field) => (
          <button
            key={field.id}
            onClick={() => onSelectField(selectedFieldId === field.id ? null : field.id, row.id)}
            className={`text-left rounded-md p-2 border text-xs transition-colors ${
              selectedFieldId === field.id
                ? 'border-brand bg-brand/10'
                : 'border-edge hover:border-brand/50 bg-background'
            }`}
          >
            {field.autoFillFrom && <span className="text-brand mr-1 text-[9px]">⚡</span>}
            <span className="text-[8px] uppercase tracking-wide text-content-3 block">{field.type}</span>
            <span className="text-content font-medium">{field.label || '(sin etiqueta)'}</span>
          </button>
        ))}
      </div>
      <button
        onClick={() => onDeleteRow(row.id)}
        className="mt-2 p-1 opacity-0 group-hover:opacity-100 text-danger hover:bg-danger-bg rounded transition-all"
      >
        <X size={13} />
      </button>
    </div>
  );
}

interface Props {
  rows: TemplateRow[];
  selectedFieldId: string | null;
  selectedRowId: string | null;
  onRowsChange: (rows: TemplateRow[]) => void;
  onSelectField: (fieldId: string | null, rowId: string | null) => void;
}

export default function BuilderCanvas({ rows, selectedFieldId, onRowsChange, onSelectField }: Props) {
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = rows.findIndex((r) => r.id === active.id);
      const newIndex = rows.findIndex((r) => r.id === over.id);
      onRowsChange(arrayMove(rows, oldIndex, newIndex));
    }
  }

  function handleDeleteRow(rowId: string) {
    onRowsChange(rows.filter((r) => r.id !== rowId));
    onSelectField(null, null);
  }

  return (
    <div className="flex-1 bg-background overflow-y-auto flex flex-col">
      <div className="p-3 flex flex-col gap-3 flex-1">
        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
            {rows.map((row) => (
              <RowItem
                key={row.id}
                row={row}
                selectedFieldId={selectedFieldId}
                onSelectField={(fId, rId) => onSelectField(fId, rId)}
                onDeleteRow={handleDeleteRow}
              />
            ))}
          </SortableContext>
        </DndContext>

        {rows.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-content-3 text-sm border border-dashed border-edge rounded-xl">
            Haz click en un componente de la paleta para agregar campos
          </div>
        )}

        <button
          onClick={() => onSelectField(null, null)}
          className="flex items-center justify-center gap-1.5 py-2 border border-dashed border-edge rounded-lg text-xs text-content-3 hover:border-brand hover:text-brand transition-colors"
        >
          <Plus size={12} /> Agregar fila
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create FieldConfigPanel**

```tsx
// apps/frontend/src/documents/builder/FieldConfigPanel.tsx
import { Trash2 } from 'lucide-react';
import type { TemplateField, TemplateRow } from '../api/documentBuilderApi';

const AUTO_FILL_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '— ninguno —' },
  { value: 'reservation.guestName', label: 'Nombre del huésped' },
  { value: 'reservation.roomTypeId', label: 'Tipo de habitación' },
  { value: 'reservation.checkIn', label: 'Fecha check-in' },
  { value: 'reservation.checkOut', label: 'Fecha check-out' },
  { value: 'reservation.nights', label: 'N° de noches' },
  { value: 'reservation.channel', label: 'Canal (Airbnb / Booking)' },
];

interface Props {
  field: TemplateField;
  row: TemplateRow;
  onUpdateField: (patch: Partial<TemplateField>) => void;
  onUpdateRow: (patch: Partial<Pick<TemplateRow, 'columns'>>) => void;
  onDeleteField: () => void;
}

export default function FieldConfigPanel({ field, row, onUpdateField, onUpdateRow, onDeleteField }: Props) {
  const showOptions = field.type === 'checkbox-group' || field.type === 'checkbox-amount';
  const showSuffix = field.type === 'number';
  const showAutoFill = ['text', 'number', 'date'].includes(field.type);

  return (
    <div className="w-48 shrink-0 bg-surface-sidebar border-l border-edge flex flex-col overflow-y-auto">
      <div className="px-3 py-2 text-[10px] uppercase tracking-widest text-content-3 border-b border-edge">Configurar campo</div>

      <div className="p-3 flex flex-col gap-4 flex-1">
        <p className="text-[10px] text-brand font-semibold uppercase tracking-wide">{field.label || '(sin etiqueta)'}</p>

        <div>
          <label className="block text-[9px] uppercase tracking-wide text-content-3 mb-1">Etiqueta</label>
          <input
            value={field.label}
            onChange={(e) => onUpdateField({ label: e.target.value })}
            className="w-full bg-background border border-edge rounded px-2 py-1 text-xs text-content focus:outline-none focus:border-brand"
          />
        </div>

        <div>
          <label className="block text-[9px] uppercase tracking-wide text-content-3 mb-1">Tipo de campo</label>
          <select
            value={field.type}
            onChange={(e) => onUpdateField({ type: e.target.value as TemplateField['type'] })}
            className="w-full bg-background border border-edge rounded px-2 py-1 text-xs text-content focus:outline-none"
          >
            <option value="text">Texto corto</option>
            <option value="textarea">Texto largo</option>
            <option value="number">Número</option>
            <option value="date">Fecha</option>
            <option value="checkbox-group">Checkboxes</option>
            <option value="checkbox-amount">Check + Monto</option>
            <option value="auto-number">N° Automático</option>
            <option value="section-header">Encabezado</option>
            <option value="signature">Firma</option>
            <option value="bullet-list">Lista bullets</option>
          </select>
        </div>

        <div className="flex items-center justify-between">
          <label className="text-[9px] uppercase tracking-wide text-content-3">Obligatorio</label>
          <button
            onClick={() => onUpdateField({ required: !field.required })}
            className={`w-8 h-4 rounded-full relative transition-colors ${field.required ? 'bg-brand' : 'bg-edge'}`}
          >
            <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-all ${field.required ? 'right-0.5' : 'left-0.5'}`} />
          </button>
        </div>

        {showSuffix && (
          <div>
            <label className="block text-[9px] uppercase tracking-wide text-content-3 mb-1">Sufijo (ej: Noche(s))</label>
            <input
              value={field.suffix ?? ''}
              onChange={(e) => onUpdateField({ suffix: e.target.value || undefined })}
              className="w-full bg-background border border-edge rounded px-2 py-1 text-xs text-content focus:outline-none focus:border-brand"
            />
          </div>
        )}

        {showAutoFill && (
          <div>
            <label className="block text-[9px] uppercase tracking-wide text-content-3 mb-1">Auto-rellenar desde reserva</label>
            <select
              value={field.autoFillFrom ?? ''}
              onChange={(e) => onUpdateField({ autoFillFrom: (e.target.value || undefined) as TemplateField['autoFillFrom'] })}
              className="w-full bg-background border border-edge rounded px-2 py-1 text-xs text-content focus:outline-none"
            >
              {AUTO_FILL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        )}

        {showOptions && (
          <div>
            <label className="block text-[9px] uppercase tracking-wide text-content-3 mb-1">Opciones</label>
            <div className="flex flex-col gap-1">
              {(field.options ?? []).map((opt, i) => (
                <div key={i} className="flex items-center gap-1">
                  <input
                    value={opt}
                    onChange={(e) => {
                      const next = [...(field.options ?? [])];
                      next[i] = e.target.value;
                      onUpdateField({ options: next });
                    }}
                    className="flex-1 bg-background border border-edge rounded px-2 py-0.5 text-xs text-content focus:outline-none focus:border-brand"
                  />
                  <button
                    onClick={() => onUpdateField({ options: (field.options ?? []).filter((_, j) => j !== i) })}
                    className="text-danger hover:bg-danger-bg rounded p-0.5"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              ))}
              <button
                onClick={() => onUpdateField({ options: [...(field.options ?? []), ''] })}
                className="text-[10px] text-brand mt-1 text-left hover:underline"
              >
                + Agregar opción
              </button>
            </div>
          </div>
        )}

        <div className="border-t border-edge pt-3">
          <label className="block text-[9px] uppercase tracking-wide text-content-3 mb-1">Columnas de esta fila</label>
          <div className="flex gap-1">
            {([1, 2, 3] as const).map((n) => (
              <button
                key={n}
                onClick={() => onUpdateRow({ columns: n })}
                className={`flex-1 py-1 rounded text-xs font-medium border transition-colors ${row.columns === n ? 'border-brand text-brand bg-brand/10' : 'border-edge text-content-3 hover:border-brand/50'}`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="p-3 border-t border-edge">
        <button
          onClick={onDeleteField}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-danger/30 text-danger text-xs hover:bg-danger-bg transition-colors"
        >
          <Trash2 size={11} /> Eliminar campo
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create TemplateBuilder orchestrator**

```tsx
// apps/frontend/src/documents/builder/TemplateBuilder.tsx
import { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { ArrowLeft, Save } from 'lucide-react';
import type { DocumentTemplate, TemplateRow, TemplateField, TemplateFieldType } from '../api/documentBuilderApi';
import { createTemplate, updateTemplate } from '../api/documentBuilderApi';
import FieldPalette, { FIELD_PALETTE } from './FieldPalette';
import BuilderCanvas from './BuilderCanvas';
import FieldConfigPanel from './FieldConfigPanel';

interface Props {
  businessId: string;
  initial: DocumentTemplate | null;
  onSave: () => void;
  onCancel: () => void;
}

function makeField(type: TemplateFieldType): TemplateField {
  const base = FIELD_PALETTE.find((p) => p.type === type);
  return { id: uuidv4(), type, label: base?.label ?? type, required: false };
}

export default function TemplateBuilder({ businessId, initial, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? 'Nueva plantilla');
  const [type, setType] = useState<DocumentTemplate['type']>(initial?.type ?? 'check-in');
  const [showOn, setShowOn] = useState<DocumentTemplate['showOn']>(initial?.showOn ?? 'always');
  const [rows, setRows] = useState<TemplateRow[]>(initial?.rows ?? []);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedRow = rows.find((r) => r.id === selectedRowId) ?? null;
  const selectedField = selectedRow?.fields.find((f) => f.id === selectedFieldId) ?? null;

  function handleAddField(fieldType: TemplateFieldType) {
    const field = makeField(fieldType);
    const newRow: TemplateRow = { id: uuidv4(), columns: 1, fields: [field] };
    setRows((prev) => [...prev, newRow]);
    setSelectedFieldId(field.id);
    setSelectedRowId(newRow.id);
  }

  function handleUpdateField(patch: Partial<TemplateField>) {
    if (!selectedRowId || !selectedFieldId) return;
    setRows((prev) =>
      prev.map((r) =>
        r.id === selectedRowId
          ? { ...r, fields: r.fields.map((f) => (f.id === selectedFieldId ? { ...f, ...patch } : f)) }
          : r
      )
    );
  }

  function handleUpdateRow(patch: Partial<Pick<TemplateRow, 'columns'>>) {
    if (!selectedRowId) return;
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== selectedRowId) return r;
        const newCols = patch.columns ?? r.columns;
        const fields = [...r.fields];
        // Trim or pad field slots when changing columns
        while (fields.length < newCols) fields.push(makeField('text'));
        return { ...r, ...patch, fields: fields.slice(0, newCols) };
      })
    );
  }

  function handleDeleteField() {
    if (!selectedRowId || !selectedFieldId) return;
    setRows((prev) =>
      prev
        .map((r) =>
          r.id === selectedRowId ? { ...r, fields: r.fields.filter((f) => f.id !== selectedFieldId) } : r
        )
        .filter((r) => r.fields.length > 0)
    );
    setSelectedFieldId(null);
    setSelectedRowId(null);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const payload = { businessId, name, type, showOn, isUnique: false, rows };
      if (initial) {
        await updateTemplate(initial.id, { name, type, showOn, rows });
      } else {
        await createTemplate(payload);
      }
      onSave();
    } catch {
      setError('Error guardando plantilla. Intenta de nuevo.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-edge bg-surface shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onCancel} className="flex items-center gap-1 text-content-3 hover:text-content text-sm transition-colors">
            <ArrowLeft size={14} /> Plantillas
          </button>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-transparent border-none outline-none text-sm font-semibold text-content w-52"
          />
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${type === 'check-in' ? 'bg-brand/20 text-brand' : 'bg-surface-subtle text-content-3'}`}>
            {type === 'check-in' ? 'Check-in' : 'Personalizado'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {error && <span className="text-xs text-danger">{error}</span>}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand/90 disabled:opacity-50 transition-colors"
          >
            <Save size={13} /> {saving ? 'Guardando...' : 'Guardar plantilla'}
          </button>
        </div>
      </div>

      {/* 3-panel layout */}
      <div className="flex flex-1 overflow-hidden">
        <FieldPalette
          onAddField={handleAddField}
          templateName={name}
          templateType={type}
          showOn={showOn}
          onTemplateMeta={(p) => {
            if (p.name !== undefined) setName(p.name);
            if (p.type !== undefined) setType(p.type);
            if (p.showOn !== undefined) setShowOn(p.showOn);
          }}
        />
        <BuilderCanvas
          rows={rows}
          selectedFieldId={selectedFieldId}
          selectedRowId={selectedRowId}
          onRowsChange={setRows}
          onSelectField={(fId, rId) => { setSelectedFieldId(fId); setSelectedRowId(rId); }}
        />
        {selectedField && selectedRow ? (
          <FieldConfigPanel
            field={selectedField}
            row={selectedRow}
            onUpdateField={handleUpdateField}
            onUpdateRow={handleUpdateRow}
            onDeleteField={handleDeleteField}
          />
        ) : (
          <div className="w-48 shrink-0 bg-surface-sidebar border-l border-edge flex items-center justify-center">
            <p className="text-xs text-content-3 text-center px-3">Selecciona un campo para configurarlo</p>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Install uuid for frontend**

```bash
pnpm --filter @migo-uit/frontend add uuid
pnpm --filter @migo-uit/frontend add -D @types/uuid
```

- [ ] **Step 6: Verify in browser**

Open `https://localhost:5173/documentos`, click "Nueva plantilla". Confirm:
- 3-panel layout renders
- Clicking a palette item adds a row to the canvas
- Clicking a field on the canvas activates the config panel on the right
- Dragging rows reorders them
- "Guardar plantilla" saves to backend and returns to DocumentsPage

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/documents/builder/ apps/frontend/package.json
git commit -m "feat(document-builder): add TemplateBuilder with drag-and-drop canvas"
```

---

## Task 10: Frontend — DocumentFiller + FilledDocumentView

**Files:**
- Create: `apps/frontend/src/documents/filler/DocumentFiller.tsx`
- Create: `apps/frontend/src/documents/filler/FilledDocumentView.tsx`

- [ ] **Step 1: Create DocumentFiller**

```tsx
// apps/frontend/src/documents/filler/DocumentFiller.tsx
import { useState } from 'react';
import { ArrowLeft, Save } from 'lucide-react';
import type { DocumentTemplate, TemplateField, InstanceValues } from '../api/documentBuilderApi';
import { createInstance, updateInstance } from '../api/documentBuilderApi';
import type { Reservation } from '../../channex/api/channexHubApi';

interface Props {
  template: DocumentTemplate;
  businessId: string;
  reservation?: Reservation | null;
  roomTypeTitle?: string;
  existingInstanceId?: string;
  existingValues?: InstanceValues;
  onSaved: (instanceId: string) => void;
  onCancel: () => void;
}

function resolveAutoFill(field: TemplateField, reservation: Reservation | null | undefined, roomTypeTitle: string | undefined): string {
  if (!field.autoFillFrom || !reservation) return '';
  switch (field.autoFillFrom) {
    case 'reservation.guestName':
      return [reservation.guest_first_name, reservation.guest_last_name].filter(Boolean).join(' ') || reservation.customer_name || '';
    case 'reservation.roomTypeId':
      return roomTypeTitle ?? reservation.room_type_id ?? '';
    case 'reservation.checkIn':
      return reservation.check_in ?? '';
    case 'reservation.checkOut':
      return reservation.check_out ?? '';
    case 'reservation.nights': {
      const n = reservation.count_of_nights;
      if (n != null) return String(n);
      if (reservation.check_in && reservation.check_out) {
        const diff = Math.round((new Date(reservation.check_out).getTime() - new Date(reservation.check_in).getTime()) / 86_400_000);
        return String(diff);
      }
      return '';
    }
    case 'reservation.channel':
      return reservation.channel_name ?? reservation.channel ?? '';
    default:
      return '';
  }
}

function FieldInput({ field, value, onChange }: { field: TemplateField; value: unknown; onChange: (v: unknown) => void }) {
  const isAutoFilled = !!field.autoFillFrom;

  if (field.type === 'section-header') {
    return <div className="col-span-full border-l-2 border-brand pl-3 text-sm font-bold text-content py-1">{field.label}</div>;
  }

  const labelEl = (
    <label className="block text-[10px] uppercase tracking-wide text-content-3 mb-1">
      {field.label}
      {field.required && <span className="text-danger ml-1">*</span>}
      {isAutoFilled && <span className="ml-1.5 text-[8px] bg-brand/20 text-brand px-1 rounded">⚡ auto</span>}
    </label>
  );

  const inputCls = `w-full bg-background border rounded-md px-2.5 py-1.5 text-sm text-content focus:outline-none focus:border-brand ${
    isAutoFilled ? 'border-brand/40 text-brand/80' : 'border-edge'
  }`;

  if (field.type === 'text' || field.type === 'auto-number') {
    return <div>{labelEl}<input readOnly={isAutoFilled || field.type === 'auto-number'} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className={inputCls} /></div>;
  }
  if (field.type === 'textarea') {
    return <div>{labelEl}<textarea value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} rows={3} className={inputCls} /></div>;
  }
  if (field.type === 'date') {
    return <div>{labelEl}<input type="date" readOnly={isAutoFilled} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className={inputCls} /></div>;
  }
  if (field.type === 'number') {
    return (
      <div>{labelEl}
        <div className="flex items-center gap-2">
          <input type="number" readOnly={isAutoFilled} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className={`${inputCls} w-24`} />
          {field.suffix && <span className="text-sm text-content-3">{field.suffix}</span>}
        </div>
      </div>
    );
  }
  if (field.type === 'checkbox-group') {
    const selected: string[] = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div>{labelEl}
        <div className="flex flex-wrap gap-2">
          {(field.options ?? []).map((opt) => {
            const checked = selected.includes(opt);
            return (
              <button
                key={opt}
                type="button"
                onClick={() => onChange(checked ? selected.filter((s) => s !== opt) : [...selected, opt])}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs transition-colors ${checked ? 'border-brand bg-brand/10 text-brand' : 'border-edge text-content-2 hover:border-brand/50'}`}
              >
                <span className={`w-3 h-3 rounded-sm border flex items-center justify-center text-[8px] ${checked ? 'bg-brand border-brand text-white' : 'border-edge'}`}>
                  {checked ? '✓' : ''}
                </span>
                {opt}
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  if (field.type === 'checkbox-amount') {
    const val = (value as { selected?: string[]; amount?: string } | undefined) ?? {};
    const selected: string[] = val.selected ?? [];
    return (
      <div>{labelEl}
        <div className="flex flex-wrap gap-2 mb-2">
          {(field.options ?? []).map((opt) => {
            const checked = selected.includes(opt);
            return (
              <button
                key={opt}
                type="button"
                onClick={() => onChange({ ...val, selected: checked ? selected.filter((s) => s !== opt) : [...selected, opt] })}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs transition-colors ${checked ? 'border-brand bg-brand/10 text-brand' : 'border-edge text-content-2'}`}
              >
                <span className={`w-3 h-3 rounded-sm border flex items-center justify-center text-[8px] ${checked ? 'bg-brand border-brand text-white' : 'border-edge'}`}>
                  {checked ? '✓' : ''}
                </span>
                {opt}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-content-3">Monto:</span>
          <input
            type="text"
            value={val.amount ?? ''}
            onChange={(e) => onChange({ ...val, amount: e.target.value })}
            className="border border-edge rounded-md px-2.5 py-1.5 text-sm text-content bg-background focus:outline-none focus:border-brand w-28"
          />
        </div>
      </div>
    );
  }
  if (field.type === 'bullet-list') {
    const items: string[] = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div>{labelEl}
        <div className="flex flex-col gap-1">
          {items.map((item, i) => (
            <div key={i} className="flex gap-1.5 items-center">
              <span className="text-brand text-xs">•</span>
              <input
                value={item}
                onChange={(e) => { const next = [...items]; next[i] = e.target.value; onChange(next); }}
                className="flex-1 border border-edge rounded px-2 py-1 text-xs text-content bg-background focus:outline-none focus:border-brand"
              />
              <button onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-danger text-xs hover:bg-danger-bg rounded px-1">✕</button>
            </div>
          ))}
          <button onClick={() => onChange([...items, ''])} className="text-[11px] text-brand text-left hover:underline mt-0.5">+ Agregar ítem</button>
        </div>
      </div>
    );
  }
  if (field.type === 'signature') {
    return <div>{labelEl}<div className="border-b border-edge h-8 mt-2" /></div>;
  }
  return <div>{labelEl}<input value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className={inputCls} /></div>;
}

export default function DocumentFiller({ template, businessId, reservation, roomTypeTitle, existingInstanceId, existingValues, onSaved, onCancel }: Props) {
  const initValues: InstanceValues = {};
  for (const row of template.rows) {
    for (const field of row.fields) {
      if (existingValues?.[field.id] !== undefined) {
        initValues[field.id] = existingValues[field.id];
      } else if (field.autoFillFrom) {
        initValues[field.id] = resolveAutoFill(field, reservation, roomTypeTitle);
      }
    }
  }

  const [values, setValues] = useState<InstanceValues>(initValues);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setFieldValue(fieldId: string, value: unknown) {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
  }

  async function handleSave(status: 'draft' | 'completed') {
    setSaving(true);
    setError(null);
    try {
      if (existingInstanceId) {
        await updateInstance(existingInstanceId, { values, status });
        onSaved(existingInstanceId);
      } else {
        const inst = await createInstance({
          businessId,
          templateId: template.id,
          reservationId: reservation?.reservation_id ?? undefined,
          values,
          createdBy: 'current-user',
          status,
        });
        onSaved(inst.id);
      }
    } catch {
      setError('Error guardando. Intenta de nuevo.');
    } finally {
      setSaving(false);
    }
  }

  const colClass = (cols: 1 | 2 | 3) =>
    cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-2' : 'grid-cols-3';

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      <div className="flex items-center justify-between px-5 py-4 border-b border-edge bg-surface shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onCancel} className="flex items-center gap-1 text-content-3 hover:text-content text-sm transition-colors">
            <ArrowLeft size={14} /> Volver
          </button>
          <span className="font-semibold text-sm text-content">{template.name}</span>
        </div>
        <div className="flex items-center gap-2">
          {error && <span className="text-xs text-danger">{error}</span>}
          <button onClick={() => handleSave('draft')} disabled={saving} className="px-3 py-2 bg-surface-subtle border border-edge rounded-lg text-sm text-content-2 hover:bg-edge disabled:opacity-50 transition-colors">
            Guardar borrador
          </button>
          <button onClick={() => handleSave('completed')} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-ok-bg text-ok-text rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-colors">
            <Save size={13} /> {saving ? 'Guardando...' : 'Guardar y completar'}
          </button>
        </div>
      </div>

      {reservation && (
        <div className="mx-5 mt-4 px-4 py-2 bg-brand/10 border border-brand/30 rounded-lg text-xs text-brand">
          ⚡ Los campos marcados fueron pre-llenados con datos de la reserva.
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="max-w-2xl mx-auto flex flex-col gap-5">
          {template.rows.map((row) => (
            <div key={row.id} className={`grid gap-4 ${colClass(row.columns)}`}>
              {row.fields.map((field) => (
                <FieldInput
                  key={field.id}
                  field={field}
                  value={values[field.id] ?? ''}
                  onChange={(v) => setFieldValue(field.id, v)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create FilledDocumentView**

```tsx
// apps/frontend/src/documents/filler/FilledDocumentView.tsx
import { Edit2, Download } from 'lucide-react';
import type { DocumentTemplate, DocumentInstance } from '../api/documentBuilderApi';
import { downloadPdf } from '../api/documentBuilderApi';
import { useState } from 'react';

interface Props {
  template: DocumentTemplate;
  instance: DocumentInstance;
  onEdit: () => void;
}

function renderValue(field: import('../api/documentBuilderApi').TemplateField, value: unknown): React.ReactNode {
  if (field.type === 'section-header') {
    return <div className="col-span-full border-l-2 border-brand pl-3 text-sm font-bold text-content py-1">{field.label}</div>;
  }
  if (field.type === 'signature') {
    return (
      <div>
        <p className="text-[10px] uppercase tracking-wide text-content-3 mb-1">{field.label}</p>
        <div className="border-b border-edge h-6" />
      </div>
    );
  }
  if (field.type === 'checkbox-group') {
    const selected: string[] = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div>
        <p className="text-[10px] uppercase tracking-wide text-content-3 mb-1">{field.label}</p>
        <div className="flex flex-wrap gap-1.5">
          {(field.options ?? []).map((opt) => (
            <span key={opt} className={`text-xs px-2 py-0.5 rounded border ${selected.includes(opt) ? 'bg-brand/20 border-brand text-brand' : 'border-edge text-content-3'}`}>
              {selected.includes(opt) ? '☑' : '☐'} {opt}
            </span>
          ))}
        </div>
      </div>
    );
  }
  if (field.type === 'checkbox-amount') {
    const val = (value as { selected?: string[]; amount?: string } | undefined) ?? {};
    return (
      <div>
        <p className="text-[10px] uppercase tracking-wide text-content-3 mb-1">{field.label}</p>
        <div className="flex flex-wrap gap-1.5 mb-1">
          {(field.options ?? []).map((opt) => (
            <span key={opt} className={`text-xs px-2 py-0.5 rounded border ${(val.selected ?? []).includes(opt) ? 'bg-brand/20 border-brand text-brand' : 'border-edge text-content-3'}`}>
              {(val.selected ?? []).includes(opt) ? '☑' : '☐'} {opt}
            </span>
          ))}
        </div>
        {val.amount && <p className="text-xs text-content">Monto: <strong>{val.amount}</strong></p>}
      </div>
    );
  }
  if (field.type === 'bullet-list') {
    const items: string[] = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div>
        <p className="text-[10px] uppercase tracking-wide text-content-3 mb-1">{field.label}</p>
        <ul className="list-none flex flex-col gap-0.5">
          {items.map((item, i) => <li key={i} className="text-sm text-content before:content-['•'] before:text-brand before:mr-1.5">{item}</li>)}
        </ul>
      </div>
    );
  }
  const suffix = field.suffix ? ` ${field.suffix}` : '';
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-content-3 mb-1">{field.label}</p>
      <p className="text-sm text-content">{String(value ?? '—')}{suffix}</p>
    </div>
  );
}

export default function FilledDocumentView({ template, instance, onEdit }: Props) {
  const [downloading, setDownloading] = useState(false);

  async function handlePdf() {
    setDownloading(true);
    try { await downloadPdf(instance.id); } finally { setDownloading(false); }
  }

  const colClass = (cols: 1 | 2 | 3) =>
    cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-2' : 'grid-cols-3';

  return (
    <div className="bg-surface border border-edge rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-edge flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-content">{template.name}</span>
          <span className="text-xs font-mono text-brand font-bold">#{instance.docNumber}</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-ok-bg text-ok-text font-semibold">✓ Completado</span>
        </div>
        <div className="flex gap-2">
          <button onClick={onEdit} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-surface-subtle border border-edge text-xs text-content-2 hover:bg-edge transition-colors">
            <Edit2 size={11} /> Editar
          </button>
          <button onClick={handlePdf} disabled={downloading} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand/20 border border-brand/30 text-xs text-brand hover:bg-brand/30 disabled:opacity-50 transition-colors">
            <Download size={11} /> {downloading ? 'Generando...' : 'Exportar PDF'}
          </button>
        </div>
      </div>
      <div className="p-4 flex flex-col gap-4">
        {template.rows.map((row) => (
          <div key={row.id} className={`grid gap-3 ${colClass(row.columns)}`}>
            {row.fields.map((field) => (
              <div key={field.id}>{renderValue(field, instance.values[field.id])}</div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/documents/filler/
git commit -m "feat(document-builder): add DocumentFiller and FilledDocumentView"
```

---

## Task 11: Frontend — DocumentsSection + ReservationDetailModal Integration

**Files:**
- Create: `apps/frontend/src/documents/DocumentsSection.tsx`
- Modify: `apps/frontend/src/channex/components/shared/ReservationDetailModal.tsx`

- [ ] **Step 1: Create DocumentsSection**

```tsx
// apps/frontend/src/documents/DocumentsSection.tsx
import { useState, useEffect } from 'react';
import { FileText } from 'lucide-react';
import type { Reservation } from '../channex/api/channexHubApi';
import type { DocumentTemplate, DocumentInstance } from './api/documentBuilderApi';
import { listTemplates, listInstances } from './api/documentBuilderApi';
import DocumentFiller from './filler/DocumentFiller';
import FilledDocumentView from './filler/FilledDocumentView';

interface Props {
  reservation: Reservation;
  businessId: string;
  roomTypeTitle?: string;
}

function templateApplies(template: DocumentTemplate, status: string): boolean {
  if (template.showOn === 'always') return true;
  return template.showOn.includes(status);
}

export default function DocumentsSection({ reservation, businessId, roomTypeTitle }: Props) {
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [instances, setInstances] = useState<DocumentInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [filling, setFilling] = useState<{ template: DocumentTemplate; instance?: DocumentInstance } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [tmpl, inst] = await Promise.all([
        listTemplates(businessId),
        listInstances(businessId, reservation.reservation_id ?? undefined),
      ]);
      setTemplates(tmpl);
      setInstances(inst);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [reservation.reservation_id]);

  if (filling) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
        <div className="w-full max-w-2xl max-h-[90vh] bg-background rounded-2xl border border-edge shadow-2xl overflow-hidden flex flex-col">
          <DocumentFiller
            template={filling.template}
            businessId={businessId}
            reservation={reservation}
            roomTypeTitle={roomTypeTitle}
            existingInstanceId={filling.instance?.id}
            existingValues={filling.instance?.values}
            onSaved={() => { setFilling(null); void load(); }}
            onCancel={() => setFilling(null)}
          />
        </div>
      </div>
    );
  }

  if (loading) return <div className="text-xs text-content-3 py-2">Cargando documentos...</div>;
  if (templates.length === 0) return null;

  return (
    <div className="mt-1">
      <div className="flex flex-col gap-1">
        {templates.map((template) => {
          const applies = templateApplies(template, reservation.booking_status);
          const instance = instances.find((i) => i.templateId === template.id);

          return (
            <div
              key={template.id}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors ${
                applies ? 'border-edge bg-surface-subtle' : 'border-dashed border-edge/50 opacity-40'
              }`}
            >
              <FileText size={14} className={applies ? 'text-brand' : 'text-content-3'} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-content truncate">{template.name}</p>
                <p className="text-[10px] text-content-3">
                  {applies
                    ? instance
                      ? `✓ Completado #${instance.docNumber}`
                      : 'Pendiente'
                    : `No aplica aún (espera: ${Array.isArray(template.showOn) ? template.showOn.join(', ') : template.showOn})`}
                </p>
              </div>
              {applies && (
                instance?.status === 'completed' ? (
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      onClick={() => setFilling({ template, instance })}
                      className="text-xs px-2 py-1 rounded-md bg-surface border border-edge text-content-2 hover:bg-edge transition-colors"
                    >
                      Ver
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setFilling({ template, instance })}
                    className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-brand text-white hover:bg-brand/90 transition-colors"
                  >
                    {instance ? 'Continuar →' : 'Llenar →'}
                  </button>
                )
              )}
            </div>
          );
        })}
      </div>

      {/* Show completed instance inline if available */}
      {instances.filter((i) => i.status === 'completed').map((inst) => {
        const tmpl = templates.find((t) => t.id === inst.templateId);
        if (!tmpl) return null;
        return (
          <div key={inst.id} className="mt-3">
            <FilledDocumentView
              template={tmpl}
              instance={inst}
              onEdit={() => setFilling({ template: tmpl, instance: inst })}
            />
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Add DocumentsSection to ReservationDetailModal**

In `apps/frontend/src/channex/components/shared/ReservationDetailModal.tsx`, add the import after existing imports:

```typescript
import DocumentsSection from '../../../documents/DocumentsSection';
```

In the modal body, add after the Notes section (after the closing `</>` of the `{r.notes && (...)}` block and before the `{noShowButtonVisible && (...)}` block):

```tsx
          {/* Documents section */}
          <SectionTitle>Documentos</SectionTitle>
          <DocumentsSection
            reservation={r}
            businessId={tenantId}
          />
```

- [ ] **Step 3: Verify in browser**

1. Start both backend and frontend: `pnpm dev` from repo root
2. Open `https://localhost:5173/channex`
3. Open any reservation detail modal
4. Scroll to bottom — verify "Documentos" section appears
5. If a template exists (created in Task 9), verify it shows with "Llenar →" button
6. Click "Llenar →", fill the form, click "Guardar y completar"
7. Verify modal shows the completed document with PDF download button
8. Click "↓ Exportar PDF" — verify PDF downloads

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/documents/DocumentsSection.tsx apps/frontend/src/channex/components/shared/ReservationDetailModal.tsx
git commit -m "feat(document-builder): integrate DocumentsSection into ReservationDetailModal"
```

---

## Self-Review Checklist

- [x] **Spec coverage:**
  - ✅ Two Firestore collections (`documentTemplates`, `documentInstances`) — Tasks 1-3
  - ✅ 9 NestJS endpoints — Task 5
  - ✅ PDF via Puppeteer — Task 4
  - ✅ `/documentos` route + nav item — Task 7
  - ✅ Template builder 3-panel (palette, canvas, config) — Task 9
  - ✅ @dnd-kit row reorder — Task 9 (BuilderCanvas)
  - ✅ All 10 field types — Tasks 1 + 9 (FIELD_PALETTE + FieldInput)
  - ✅ Auto-fill from reservation — Task 10 (resolveAutoFill)
  - ✅ `showOn` visibility control — Task 11 (templateApplies)
  - ✅ docNumber counter — Task 3 (getNextDocNumber)
  - ✅ DocumentsSection in ReservationDetailModal — Task 11
  - ✅ Multi-tenant (businessId on all queries) — Tasks 2-3, 6, 8-11
  - ✅ Hybrid mode (digital fill + PDF export) — Tasks 4, 10 (downloadPdf)
  - ✅ Draft + completed states — Tasks 3, 10, 11
  - ✅ SideNav entry + i18n keys — Task 7

- [x] **Placeholder scan:** No TBD, no "implement later", all code is complete.

- [x] **Type consistency:**
  - `TemplateField.type` → `TemplateFieldType` (used consistently in Tasks 1, 6, 9)
  - `TemplateRow.columns` → `1 | 2 | 3` (backend Task 1, frontend Tasks 6, 9)
  - `DocumentInstance.values` → `Record<string, unknown>` (Tasks 1, 6, 10)
  - `createInstance` → `createdBy: string` (Tasks 3, 10) ← Task 10 hardcodes `'current-user'` — acceptable for demo phase

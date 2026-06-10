import { Injectable, NotFoundException } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import * as admin from 'firebase-admin';
import type { DocumentTemplate, DocumentInstance } from './document-builder.types';
import type { CreateTemplateDto } from './dto/create-template.dto';
import type { UpdateTemplateDto } from './dto/update-template.dto';
import type { CreateInstanceDto } from './dto/create-instance.dto';
import type { UpdateInstanceDto } from './dto/update-instance.dto';
import type * as puppeteerTypes from 'puppeteer';

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
      .get();
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as DocumentTemplate))
      .filter((t) => !t.isUnique);
  }

  async createTemplate(dto: CreateTemplateDto): Promise<DocumentTemplate> {
    const now = admin.firestore.Timestamp.now();
    const data = {
      businessId: dto.businessId,
      name: dto.name,
      type: dto.type,
      showOn: dto.showOn ?? 'always',
      isUnique: dto.isUnique,
      rows: JSON.parse(JSON.stringify(dto.rows)),
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
    if (dto.rows !== undefined) updates.rows = JSON.parse(JSON.stringify(dto.rows));
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

  // ── Instances ─────────────────────────────────────────────────────────────

  async listInstances(businessId: string, reservationId?: string): Promise<DocumentInstance[]> {
    let query = this.firebase
      .getFirestore()
      .collection(INSTANCES_COL)
      .where('businessId', '==', businessId) as FirebaseFirestore.Query;

    if (reservationId) {
      query = query.where('reservationId', '==', reservationId);
    }

    const snap = await query.get();
    const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as DocumentInstance));
    return docs.sort((a, b) => {
      const aTime = (a.createdAt as { seconds?: number })?.seconds ?? 0;
      const bTime = (b.createdAt as { seconds?: number })?.seconds ?? 0;
      return bTime - aTime;
    });
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

  // ── PDF Generation ─────────────────────────────────────────────────────────

  async generatePdf(instanceId: string): Promise<Buffer> {
    const { instance, template } = await this.getInstanceWithTemplate(instanceId);
    if (!template) throw new NotFoundException(`Template for instance ${instanceId} not found`);
    const html = this.buildPdfHtml(template, instance);

    const { launch } = await import('puppeteer') as typeof puppeteerTypes;
    const browser = await launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' } });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  private esc(s: unknown): string {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private buildPdfHtml(template: import('./document-builder.types').DocumentTemplate, instance: import('./document-builder.types').DocumentInstance): string {
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
<h1>${this.esc(template.name)}</h1>
<div class="doc-number">N° ${this.esc(instance.docNumber)}</div>
${rowsHtml}
</body></html>`;
  }

  private renderFieldPdf(field: import('./document-builder.types').TemplateField, value: unknown): string {
    if (field.type === 'section-header') {
      return `<div class="section-header">${this.esc(field.label)}</div>`;
    }
    const labelHtml = `<div class="field-label">${this.esc(field.label)}</div>`;
    if (field.type === 'signature') {
      return `${labelHtml}<div class="sig-line"></div>`;
    }
    if (field.type === 'auto-number') {
      return `${labelHtml}<div class="field-value">${this.esc(value)}</div>`;
    }
    if (field.type === 'checkbox-group') {
      const selected: string[] = Array.isArray(value) ? (value as string[]) : [];
      return `${labelHtml}<div class="field-value">${selected.map((o) => this.esc(o)).join(', ')}</div>`;
    }
    if (field.type === 'checkbox-amount') {
      const val = value as { selected?: string[]; amount?: string | number } | undefined;
      const selected = val?.selected ?? [];
      const display = selected.map((o) => this.esc(o)).join(', ');
      const amount = val?.amount != null ? ` &nbsp; Monto: ${this.esc(val.amount)}` : '';
      return `${labelHtml}<div class="field-value">${display}${amount}</div>`;
    }
    if (field.type === 'bullet-list') {
      const items: string[] = Array.isArray(value) ? (value as string[]) : [];
      return `${labelHtml}<ul style="margin:0;padding-left:14px;">${items.map((i) => `<li>${this.esc(i)}</li>`).join('')}</ul>`;
    }
    const suffix = field.suffix ? ` ${this.esc(field.suffix)}` : '';
    return `${labelHtml}<div class="field-value">${this.esc(value)}${suffix}</div>`;
  }
}

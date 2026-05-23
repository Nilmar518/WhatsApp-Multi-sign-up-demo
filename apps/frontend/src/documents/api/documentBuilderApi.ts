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

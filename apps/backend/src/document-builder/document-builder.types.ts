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

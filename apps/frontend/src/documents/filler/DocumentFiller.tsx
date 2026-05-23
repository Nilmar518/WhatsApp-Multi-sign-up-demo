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

  const inputCls = `w-full bg-surface border rounded-md px-2.5 py-1.5 text-sm text-content focus:outline-none focus:border-brand ${
    isAutoFilled ? 'border-brand/40 text-brand/80' : 'border-edge'
  }`;

  if (field.type === 'text' || field.type === 'auto-number') {
    return <div>{labelEl}<input readOnly={field.type === 'auto-number'} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className={inputCls} /></div>;
  }
  if (field.type === 'textarea') {
    return <div>{labelEl}<textarea value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} rows={3} className={inputCls} /></div>;
  }
  if (field.type === 'date') {
    return <div>{labelEl}<input type="date" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className={inputCls} /></div>;
  }
  if (field.type === 'number') {
    return (
      <div>{labelEl}
        <div className="flex items-center gap-2">
          <input type="number" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className={`${inputCls} w-24`} />
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
            className="border border-edge rounded-md px-2.5 py-1.5 text-sm text-content bg-surface focus:outline-none focus:border-brand w-28"
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
                className="flex-1 border border-edge rounded px-2 py-1 text-xs text-content bg-surface focus:outline-none focus:border-brand"
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
    cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-3';

  return (
    <div className="flex flex-col h-full overflow-hidden bg-surface">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 py-3 border-b border-edge bg-surface shrink-0 gap-2">
        <div className="flex items-center gap-3">
          <button onClick={onCancel} className="flex items-center gap-1 text-content-3 hover:text-content text-sm transition-colors shrink-0">
            <ArrowLeft size={14} /> Volver
          </button>
          <span className="font-semibold text-sm text-content truncate">{template.name}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {error && <span className="text-xs text-danger w-full sm:w-auto">{error}</span>}
          <button onClick={() => handleSave('draft')} disabled={saving} className="flex-1 sm:flex-none px-3 py-2 bg-surface-subtle border border-edge rounded-lg text-sm text-content-2 hover:bg-edge disabled:opacity-50 transition-colors">
            Guardar borrador
          </button>
          <button onClick={() => handleSave('completed')} disabled={saving} className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 bg-ok-bg text-ok-text rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-colors">
            <Save size={13} /> {saving ? 'Guardando...' : 'Completar'}
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

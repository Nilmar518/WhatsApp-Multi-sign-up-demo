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

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

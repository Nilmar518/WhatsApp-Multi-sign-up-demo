import { Edit2, Download } from 'lucide-react';
import type { DocumentTemplate, DocumentInstance } from '../api/documentBuilderApi';
import { downloadPdf } from '../api/documentBuilderApi';
import type { TemplateField } from '../api/documentBuilderApi';
import { useState } from 'react';

interface Props {
  template: DocumentTemplate;
  instance: DocumentInstance;
  onEdit: () => void;
}

function renderValue(field: TemplateField, value: unknown): React.ReactNode {
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
    cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-3';

  return (
    <div className="bg-surface border border-edge rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-edge flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-content">{template.name}</span>
          <span className="text-xs font-mono text-brand font-bold">#{instance.docNumber}</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-ok-bg text-ok-text font-semibold">✓ Completado</span>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={onEdit} className="flex-1 sm:flex-none flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-surface-subtle border border-edge text-xs text-content-2 hover:bg-edge transition-colors">
            <Edit2 size={11} /> Editar
          </button>
          <button onClick={handlePdf} disabled={downloading} className="flex-1 sm:flex-none flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-brand/20 border border-brand/30 text-xs text-brand hover:bg-brand/30 disabled:opacity-50 transition-colors">
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

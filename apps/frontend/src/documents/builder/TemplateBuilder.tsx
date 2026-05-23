import { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { ArrowLeft, Save } from 'lucide-react';
import type { DocumentTemplate, TemplateRow, TemplateField, TemplateFieldType } from '../api/documentBuilderApi';
import { createTemplate, updateTemplate } from '../api/documentBuilderApi';
import FieldPalette, { FIELD_PALETTE } from './FieldPalette';
import BuilderCanvas from './BuilderCanvas';
import FieldConfigPanel from './FieldConfigPanel';
import { BASE_FICHA_NAME, BASE_FICHA_ROWS } from './baseTemplate';

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
  const [name, setName] = useState(initial?.name ?? BASE_FICHA_NAME);
  const [type, setType] = useState<DocumentTemplate['type']>(initial?.type ?? 'check-in');
  const [showOn, setShowOn] = useState<DocumentTemplate['showOn']>(initial?.showOn ?? 'always');
  const [rows, setRows] = useState<TemplateRow[]>(initial?.rows ?? BASE_FICHA_ROWS);
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

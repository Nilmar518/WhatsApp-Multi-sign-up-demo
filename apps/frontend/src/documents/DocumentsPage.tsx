import { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Eye, Download } from 'lucide-react';
import {
  listTemplates, deleteTemplate, listInstances, downloadPdf,
  type DocumentTemplate, type DocumentInstance,
} from './api/documentBuilderApi';
import TemplateBuilder from './builder/TemplateBuilder';
import FilledDocumentView from './filler/FilledDocumentView';
import BottomSheet from './BottomSheet';

const FALLBACK_BID = '787167007221172';

function formatDate(ts: unknown): string {
  if (!ts) return '—';
  if (typeof ts === 'object' && ts !== null && '_seconds' in ts) {
    return new Date((ts as { _seconds: number })._seconds * 1000).toLocaleDateString('es-BO');
  }
  return String(ts);
}

export default function DocumentsPage() {
  const [businessId, setBusinessId] = useState(FALLBACK_BID);
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [instances, setInstances] = useState<DocumentInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<DocumentTemplate | null | 'new'>(null);
  const [viewingInstance, setViewingInstance] = useState<DocumentInstance | null>(null);
  const [sheetKey, setSheetKey] = useState(0);

  useEffect(() => {
    fetch('/api/integrations/businesses')
      .then((r) => r.json())
      .then((ids: string[]) => { if (ids.length > 0) setBusinessId(ids[0]); })
      .catch(() => {});
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [tmpl, inst] = await Promise.all([
        listTemplates(businessId),
        listInstances(businessId),
      ]);
      setTemplates(tmpl);
      setInstances(inst);
    } catch {
      setError('Error cargando datos');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [businessId]);

  async function handleDeleteTemplate(id: string) {
    if (!confirm('¿Eliminar esta plantilla?')) return;
    await deleteTemplate(id);
    void load();
  }

  async function handleDownload(instId: string) {
    await downloadPdf(instId);
  }

  if (editingTemplate !== null) {
    return (
      <TemplateBuilder
        businessId={businessId}
        initial={editingTemplate === 'new' ? null : editingTemplate}
        onSave={() => { setEditingTemplate(null); void load(); }}
        onCancel={() => setEditingTemplate(null)}
      />
    );
  }

  const viewingTemplate = viewingInstance
    ? templates.find((t) => t.id === viewingInstance.templateId) ?? null
    : null;

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-surface">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-xl font-bold text-content">Plantillas de Documentos</h1>
            <p className="text-sm text-content-3 mt-1">Configura los formularios para check-in y otras operaciones.</p>
          </div>
          <button
            onClick={() => setEditingTemplate('new')}
            className="flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand/90 transition-colors self-start sm:self-auto"
          >
            <Plus size={14} /> Nueva plantilla
          </button>
        </div>

        {error && <div className="mb-4 p-3 rounded-lg bg-danger-bg text-danger text-sm">{error}</div>}

        {/* Template cards */}
        {loading ? (
          <div className="text-content-3 text-sm">Cargando...</div>
        ) : (
          <div className="flex gap-3 flex-wrap mb-8">
            {templates.map((t) => (
              <div key={t.id} className="w-full sm:w-48 bg-surface border border-edge rounded-xl p-4">
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

        {/* Instance history */}
        <h2 className="text-base font-semibold text-content mb-3">Documentos generados</h2>

        {/* Mobile cards */}
        <div className="flex flex-col gap-2 sm:hidden">
          {instances.map((inst) => {
            const tmpl = templates.find((t) => t.id === inst.templateId);
            return (
              <div key={inst.id} className="bg-surface border border-edge rounded-xl p-4 flex items-center gap-3">
                <span className="font-mono text-sm text-brand font-semibold shrink-0">#{inst.docNumber}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-content truncate">{tmpl?.name ?? 'Documento'}</p>
                  <p className="text-xs text-content-3">{formatDate(inst.createdAt)}</p>
                </div>
                <span className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full shrink-0 ${inst.status === 'completed' ? 'bg-ok-bg text-ok-text' : 'bg-caution-bg text-caution-text'}`}>
                  {inst.status === 'completed' ? 'Completado' : 'Borrador'}
                </span>
                <div className="flex gap-1.5 shrink-0">
                  {tmpl && (
                    <button onClick={() => { setSheetKey((k) => k + 1); setViewingInstance(inst); }} className="p-1.5 rounded hover:bg-edge text-content-3 hover:text-content transition-colors">
                      <Eye size={13} />
                    </button>
                  )}
                  <button onClick={() => handleDownload(inst.id)} className="p-1.5 rounded hover:bg-edge text-content-3 hover:text-content transition-colors">
                    <Download size={13} />
                  </button>
                </div>
              </div>
            );
          })}
          {instances.length === 0 && !loading && (
            <p className="text-center text-content-3 text-sm py-8">No hay documentos generados aún.</p>
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden sm:block bg-surface border border-edge rounded-xl overflow-hidden">
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
              {instances.map((inst) => {
                const tmpl = templates.find((t) => t.id === inst.templateId);
                return (
                  <tr key={inst.id} className="border-b border-edge last:border-0 hover:bg-surface-subtle">
                    <td className="px-4 py-3 font-mono text-sm text-brand font-semibold">#{inst.docNumber}</td>
                    <td className="px-4 py-3 text-content-2">{tmpl?.name ?? (inst.templateId ? 'Ficha' : 'Único')}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full ${inst.status === 'completed' ? 'bg-ok-bg text-ok-text' : 'bg-caution-bg text-caution-text'}`}>
                        {inst.status === 'completed' ? 'Completado' : 'Borrador'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-content-3 text-xs">{formatDate(inst.createdAt)}</td>
                    <td className="px-4 py-3 flex gap-2 justify-end">
                      {tmpl && (
                        <button onClick={() => { setSheetKey((k) => k + 1); setViewingInstance(inst); }} className="p-1.5 rounded hover:bg-edge text-content-3 hover:text-content transition-colors">
                          <Eye size={13} />
                        </button>
                      )}
                      <button onClick={() => handleDownload(inst.id)} className="p-1.5 rounded hover:bg-edge text-content-3 hover:text-content transition-colors">
                        <Download size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {instances.length === 0 && !loading && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-content-3 text-sm">No hay documentos generados aún.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Document detail — bottom sheet */}
      {viewingInstance && viewingTemplate && (
        <BottomSheet key={sheetKey} onClose={() => setViewingInstance(null)}>
          <div className="px-1 pb-6">
            <FilledDocumentView
              template={viewingTemplate}
              instance={viewingInstance}
              onEdit={() => setViewingInstance(null)}
            />
          </div>
        </BottomSheet>
      )}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { FileText, AlertCircle, PlusCircle } from 'lucide-react';
import type { Reservation } from '../channex/api/channexHubApi';
import type { DocumentTemplate, DocumentInstance } from './api/documentBuilderApi';
import { listTemplates, listInstances } from './api/documentBuilderApi';
import DocumentFiller from './filler/DocumentFiller';
import FilledDocumentView from './filler/FilledDocumentView';
import BottomSheet from './BottomSheet';
import { navigate } from '../lib/navigate';

interface Props {
  reservation: Reservation;
  businessId: string;
  roomTypeTitle?: string;
}

function templateApplies(template: DocumentTemplate, status: string): boolean {
  if (template.showOn === 'always') return true;
  return template.showOn.includes(status);
}

// ── Main section ──────────────────────────────────────────────────────────────

export default function DocumentsSection({ reservation, businessId, roomTypeTitle }: Props) {
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [instances, setInstances] = useState<DocumentInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filling, setFilling] = useState<{ template: DocumentTemplate; instance?: DocumentInstance } | null>(null);
  const [viewing, setViewing] = useState<{ template: DocumentTemplate; instance: DocumentInstance } | null>(null);
  const [sheetKey, setSheetKey] = useState(0);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [tmpl, inst] = await Promise.all([
        listTemplates(businessId),
        listInstances(businessId, reservation.reservation_id ?? undefined),
      ]);
      setTemplates(tmpl);
      setInstances(inst);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando documentos');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [reservation.reservation_id]);

  if (filling) {
    return (
      <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm sm:p-4">
        <div className="w-full sm:max-w-2xl h-[95vh] sm:h-auto sm:max-h-[90vh] bg-surface rounded-t-2xl sm:rounded-2xl border border-edge shadow-2xl overflow-hidden flex flex-col">
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

  if (loading) {
    return <div className="text-xs text-content-3 py-2">Cargando documentos...</div>;
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-danger">
        <AlertCircle size={13} />
        <span>{error}</span>
        <button onClick={() => void load()} className="underline hover:no-underline ml-1">Reintentar</button>
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className="flex items-center gap-2.5 py-2">
        <FileText size={13} className="text-content-3 shrink-0" />
        <p className="text-xs text-content-3 flex-1">No hay plantillas configuradas.</p>
        <button
          onClick={() => navigate('/documentos')}
          className="flex items-center gap-1 text-xs text-brand hover:underline shrink-0"
        >
          <PlusCircle size={12} /> Crear plantilla
        </button>
      </div>
    );
  }

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
                  <button
                    onClick={() => { setSheetKey((k) => k + 1); setViewing({ template, instance }); }}
                    className="shrink-0 text-xs px-2 py-1 rounded-md bg-surface border border-edge text-content-2 hover:bg-edge transition-colors"
                  >
                    Ver
                  </button>
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

      {/* Bottom sheet for viewing a completed document */}
      {viewing && (
        <BottomSheet key={sheetKey} onClose={() => setViewing(null)}>
          <div className="px-1 pb-6">
            <FilledDocumentView
              template={viewing.template}
              instance={viewing.instance}
              onEdit={() => {
                setViewing(null);
                setFilling({ template: viewing.template, instance: viewing.instance });
              }}
            />
          </div>
        </BottomSheet>
      )}
    </div>
  );
}

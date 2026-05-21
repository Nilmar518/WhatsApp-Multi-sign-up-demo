import { MessageSquare, X } from 'lucide-react';

interface NoConversationModalProps {
  guestName: string;
  onClose: () => void;
}

export default function NoConversationModal({ guestName, onClose }: NoConversationModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="no-conv-title"
        className="bg-surface-raised border border-edge rounded-xl shadow-lg w-full max-w-sm p-6 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-notice-bg flex items-center justify-center flex-shrink-0">
              <MessageSquare size={18} className="text-notice" />
            </div>
            <p id="no-conv-title" className="text-[15px] font-bold text-content leading-tight">
              Sin conversación directa
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar modal"
            className="p-1 rounded-lg text-content-3 hover:text-content hover:bg-surface-subtle transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <p className="text-[13px] text-content-2 leading-relaxed">
          No se encontró un intercambio de mensajes con{' '}
          <span className="font-semibold text-content">{guestName}</span>.
        </p>
        <p className="text-[13px] text-content-2 leading-relaxed">
          Espera a que el huésped inicie o responda un mensaje para poder acceder
          al hilo de conversación.
        </p>

        <button
          type="button"
          onClick={onClose}
          className="w-full py-2.5 rounded-lg bg-brand text-white text-[13px] font-semibold
                     hover:bg-brand-hover transition-colors"
        >
          Entendido
        </button>
      </div>
    </div>
  );
}

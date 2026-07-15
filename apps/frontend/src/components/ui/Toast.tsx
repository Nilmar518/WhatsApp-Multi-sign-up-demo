import { useCallback, useState } from 'react';
import { CheckCircle, XCircle, Info, AlertTriangle, X } from 'lucide-react';

export type ToastVariant = 'ok' | 'danger' | 'notice' | 'caution';

interface ToastProps {
  message: string;
  variant?: ToastVariant;
  onDismiss: () => void;
  duration?: number;
}

const config: Record<ToastVariant, { icon: React.ReactNode; classes: string; bar: string }> = {
  ok:      { icon: <CheckCircle size={16} />,    classes: 'bg-ok-bg text-ok-text border-ok/30',                bar: 'bg-ok' },
  danger:  { icon: <XCircle size={16} />,        classes: 'bg-danger-bg text-danger-text border-danger/30',    bar: 'bg-danger' },
  notice:  { icon: <Info size={16} />,           classes: 'bg-notice-bg text-notice-text border-notice/30',    bar: 'bg-notice' },
  caution: { icon: <AlertTriangle size={16} />,  classes: 'bg-caution-bg text-caution-text border-caution/30', bar: 'bg-caution' },
};

export default function Toast({ message, variant = 'ok', onDismiss, duration = 5000 }: ToastProps) {
  // El cierre lo dispara el fin de la animación de la barra, así que pausarla con
  // el mouse encima pausa también la cuenta regresiva — una sola fuente de verdad.
  const [paused, setPaused] = useState(false);
  const { icon, classes, bar } = config[variant];

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={`relative overflow-hidden flex items-start gap-3 px-4 py-3 pb-3.5 rounded-lg border shadow-md text-sm font-medium animate-fade-in ${classes}`}
    >
      <span className="mt-px shrink-0">{icon}</span>
      <span className="flex-1">{message}</span>
      <button onClick={onDismiss} className="ml-2 shrink-0 opacity-60 hover:opacity-100 transition-opacity">
        <X size={14} />
      </button>

      <span
        onAnimationEnd={onDismiss}
        style={{
          animation: `toast-progress ${duration}ms linear forwards`,
          animationPlayState: paused ? 'paused' : 'running',
        }}
        className={`absolute bottom-0 left-0 h-0.5 w-full origin-left opacity-60 ${bar}`}
      />
    </div>
  );
}

export function ToastContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 w-80 max-w-[calc(100vw-2.5rem)]">
      {children}
    </div>
  );
}

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

let toastSeq = 0;

/** Estado de toasts reutilizable: `const { toasts, showToast, dismissToast } = useToasts()`. */
export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((message: string, variant: ToastVariant = 'ok') => {
    setToasts((prev) => [...prev, { id: ++toastSeq, message, variant }]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, showToast, dismissToast };
}

/** Render listo para usar: `<Toasts toasts={toasts} onDismiss={dismissToast} />`. */
export function Toasts({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <ToastContainer>
      {toasts.map((t) => (
        <Toast key={t.id} message={t.message} variant={t.variant} onDismiss={() => onDismiss(t.id)} />
      ))}
    </ToastContainer>
  );
}

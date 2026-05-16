import { useEffect } from 'react';
import { CheckCircle, XCircle, Info, AlertTriangle, X } from 'lucide-react';

type ToastVariant = 'ok' | 'danger' | 'notice' | 'caution';

interface ToastProps {
  message: string;
  variant?: ToastVariant;
  onDismiss: () => void;
  duration?: number;
}

const config: Record<ToastVariant, { icon: React.ReactNode; classes: string }> = {
  ok:      { icon: <CheckCircle size={16} />,    classes: 'bg-ok-bg text-ok-text border-ok/30' },
  danger:  { icon: <XCircle size={16} />,        classes: 'bg-danger-bg text-danger-text border-danger/30' },
  notice:  { icon: <Info size={16} />,           classes: 'bg-notice-bg text-notice-text border-notice/30' },
  caution: { icon: <AlertTriangle size={16} />,  classes: 'bg-caution-bg text-caution-text border-caution/30' },
};

export default function Toast({ message, variant = 'ok', onDismiss, duration = 4000 }: ToastProps) {
  useEffect(() => {
    const t = setTimeout(onDismiss, duration);
    return () => clearTimeout(t);
  }, [onDismiss, duration]);

  const { icon, classes } = config[variant];

  return (
    <div className={`flex items-start gap-3 px-4 py-3 rounded-lg border shadow-md text-sm font-medium animate-fade-in ${classes}`}>
      <span className="mt-px shrink-0">{icon}</span>
      <span className="flex-1">{message}</span>
      <button onClick={onDismiss} className="ml-2 shrink-0 opacity-60 hover:opacity-100 transition-opacity">
        <X size={14} />
      </button>
    </div>
  );
}

export function ToastContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 w-80">
      {children}
    </div>
  );
}

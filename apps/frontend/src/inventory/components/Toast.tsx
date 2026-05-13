import UIToast from '../../components/ui/Toast';
import { ToastContainer as UIToastContainer } from '../../components/ui/Toast';
import type { ComponentProps } from 'react';

// ─── Re-export types used by callers ─────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

// ─── Type → Variant mapping ───────────────────────────────────────────────────

const TYPE_TO_VARIANT: Record<ToastType, ComponentProps<typeof UIToast>['variant']> = {
  success: 'ok',
  error:   'danger',
  info:    'notice',
};

// ─── Legacy Toast shim ────────────────────────────────────────────────────────
// Callers pass { toast: ToastItem, onDismiss: () => void }

export function Toast({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: () => void;
}) {
  return (
    <UIToast
      message={toast.message}
      variant={TYPE_TO_VARIANT[toast.type] ?? 'notice'}
      onDismiss={onDismiss}
    />
  );
}

// ─── Legacy ToastContainer shim ───────────────────────────────────────────────
// Callers pass { toasts: ToastItem[], onDismiss: (id: string) => void }

export function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <UIToastContainer>
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </UIToastContainer>
  );
}

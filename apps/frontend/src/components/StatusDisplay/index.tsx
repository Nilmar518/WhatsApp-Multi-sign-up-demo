import type { IntegrationStatus } from '../../types/integration';
import type { SetupStep } from '../../hooks/useWhatsAppConnect';

interface StatusConfig {
  label: string;
  textColor: string;
  dotClass: string;
}

// ─── Firestore status config ──────────────────────────────────────────────────
// These map `status` values persisted on the Firestore integration document.
// The backend writes these during and after the setup flow, so Firestore
// listeners see them once the step completes (i.e. after the API call returns).

const STATUS_CONFIG: Record<IntegrationStatus, StatusConfig> = {
  // ── Lifecycle states ────────────────────────────────────────────────────────
  IDLE: {
    label: 'Not Connected',
    textColor: 'text-gray-500',
    dotClass: 'bg-gray-400',
  },
  CONNECTING: {
    label: 'Connecting...',
    textColor: 'text-yellow-600',
    dotClass: 'bg-yellow-400 animate-pulse',
  },
  PENDING_TOKEN: {
    label: 'Awaiting Token...',
    textColor: 'text-blue-600',
    dotClass: 'bg-blue-400 animate-pulse',
  },
  ACTIVE: {
    label: 'Connected',
    textColor: 'text-green-600',
    dotClass: 'bg-green-500',
  },
  ERROR: {
    label: 'Connection Error',
    textColor: 'text-red-600',
    dotClass: 'bg-red-500',
  },
  MIGRATING: {
    label: 'Migrating...',
    textColor: 'text-purple-600',
    dotClass: 'bg-purple-400 animate-pulse',
  },
  // ── Setup state machine — Firestore-side labels ─────────────────────────────
  // Shown when the Firestore status field reflects a granular setup step.
  // In the facade flow (POST /auth/exchange-token) these appear briefly before
  // the final ACTIVE write. In the per-step flow (useWhatsAppConnect) the hook's
  // SetupStep display takes precedence (see STEP_CONFIG below).
  TOKEN_EXCHANGED: {
    label: 'Verifying your Facebook account...',
    textColor: 'text-yellow-600',
    dotClass: 'bg-yellow-400 animate-pulse',
  },
  PHONE_REGISTERED: {
    label: 'Activating WhatsApp number...',
    textColor: 'text-yellow-600',
    dotClass: 'bg-yellow-400 animate-pulse',
  },
  STATUS_VERIFIED: {
    label: 'Confirming number status...',
    textColor: 'text-blue-600',
    dotClass: 'bg-blue-400 animate-pulse',
  },
  CATALOG_SELECTED: {
    label: 'Catalog linked — finalizing...',
    textColor: 'text-blue-600',
    dotClass: 'bg-blue-400 animate-pulse',
  },
  WEBHOOKS_SUBSCRIBED: {
    label: 'Finalizing connection...',
    textColor: 'text-yellow-600',
    dotClass: 'bg-yellow-400 animate-pulse',
  },
  // ── Messenger setup state machine ─────────────────────────────────────────
  PAGE_SELECTED: {
    label: 'Page linked — subscribing webhooks...',
    textColor: 'text-blue-600',
    dotClass: 'bg-blue-400 animate-pulse',
  },
  PAGE_SUBSCRIBED: {
    label: 'Messenger Connected',
    textColor: 'text-blue-600',
    dotClass: 'bg-[#1877F2]',
  },
};

// ─── Hook step config ─────────────────────────────────────────────────────────
// These map `SetupStep` values from useWhatsAppConnect — they represent the
// in-flight state from the frontend's perspective (i.e. the HTTP call is in
// progress) BEFORE Firestore has been updated. This gives the user immediate
// feedback during the async operations.

const STEP_CONFIG: Partial<Record<SetupStep, StatusConfig>> = {
  exchanging_token: {
    label: 'Verifying your Facebook account...',
    textColor: 'text-yellow-600',
    dotClass: 'bg-yellow-400 animate-pulse',
  },
  registering_phone: {
    label: 'Activating WhatsApp number...',
    textColor: 'text-yellow-600',
    dotClass: 'bg-yellow-400 animate-pulse',
  },
  verifying_status: {
    label: 'Confirming number status...',
    textColor: 'text-blue-600',
    dotClass: 'bg-blue-400 animate-pulse',
  },
  subscribing_webhooks: {
    label: 'Finalizing connection...',
    textColor: 'text-yellow-600',
    dotClass: 'bg-yellow-400 animate-pulse',
  },
  complete: {
    label: 'Connected ✓',
    textColor: 'text-green-600',
    dotClass: 'bg-green-500',
  },
  error: {
    label: 'Connection Error',
    textColor: 'text-red-600',
    dotClass: 'bg-red-500',
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  status: IntegrationStatus;
  isLoading: boolean;
  /**
   * Phase 5 — optional hook step. When provided and not 'idle', the hook step
   * config takes precedence over the Firestore status config. This ensures the
   * UI shows "Activating WhatsApp number..." the moment the HTTP call fires,
   * rather than waiting for the Firestore onSnapshot to update.
   */
  setupStep?: SetupStep;
}

export default function StatusDisplay({ status, isLoading, setupStep }: Props) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded-full bg-gray-300 animate-pulse" />
        <span className="text-sm text-gray-400">Loading status...</span>
      </div>
    );
  }

  // Hook step takes precedence when in-flight (not idle, not complete)
  const stepConfig =
    setupStep && setupStep !== 'idle' ? STEP_CONFIG[setupStep] : undefined;

  const config = stepConfig ?? STATUS_CONFIG[status] ?? STATUS_CONFIG.ERROR;
  const { label, textColor, dotClass } = config;

  return (
    <div className="flex items-center gap-2">
      <div className={`w-3 h-3 rounded-full ${dotClass}`} />
      <span className={`text-sm font-medium ${textColor}`}>{label}</span>
    </div>
  );
}

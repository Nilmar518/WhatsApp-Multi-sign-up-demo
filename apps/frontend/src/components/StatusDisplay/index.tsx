import type { IntegrationStatus } from '../../types/integration';
import type { SetupStep } from '../../hooks/useWhatsAppConnect';
import type { TranslationKey } from '../../i18n/es';
import Badge from '../ui/Badge';
import { useLanguage } from '../../context/LanguageContext';

interface StatusConfig {
  labelKey: TranslationKey;
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
    labelKey:  'status.idle',
    textColor: 'text-content-2',
    dotClass:  'bg-content-3',
  },
  CONNECTING: {
    labelKey:  'status.connecting',
    textColor: 'text-caution-text',
    dotClass:  'bg-caution animate-pulse',
  },
  PENDING_TOKEN: {
    labelKey:  'status.pendingToken',
    textColor: 'text-notice-text',
    dotClass:  'bg-notice animate-pulse',
  },
  ACTIVE: {
    labelKey:  'status.active',
    textColor: 'text-ok-text',
    dotClass:  'bg-ok-text',
  },
  ACCOUNT_RESOLVED: {
    labelKey:  'status.accountResolved',
    textColor: 'text-ok-text',
    dotClass:  'bg-ok-text',
  },
  ERROR: {
    labelKey:  'status.error',
    textColor: 'text-danger-text',
    dotClass:  'bg-danger',
  },
  MIGRATING: {
    labelKey:  'status.migrating',
    textColor: 'text-brand-dim',
    dotClass:  'bg-brand animate-pulse',
  },
  // ── Setup state machine — Firestore-side labels ─────────────────────────────
  // Shown when the Firestore status field reflects a granular setup step.
  // In the facade flow (POST /auth/exchange-token) these appear briefly before
  // the final ACTIVE write. In the per-step flow (useWhatsAppConnect) the hook's
  // SetupStep display takes precedence (see STEP_CONFIG below).
  TOKEN_EXCHANGED: {
    labelKey:  'status.verifyingAccount',
    textColor: 'text-caution-text',
    dotClass:  'bg-caution animate-pulse',
  },
  PHONE_REGISTERED: {
    labelKey:  'status.activatingNumber',
    textColor: 'text-caution-text',
    dotClass:  'bg-caution animate-pulse',
  },
  STATUS_VERIFIED: {
    labelKey:  'status.confirmingStatus',
    textColor: 'text-notice-text',
    dotClass:  'bg-notice animate-pulse',
  },
  CATALOG_SELECTED: {
    labelKey:  'status.catalogLinked',
    textColor: 'text-notice-text',
    dotClass:  'bg-notice animate-pulse',
  },
  WEBHOOKS_SUBSCRIBED: {
    labelKey:  'status.finalizingConn',
    textColor: 'text-caution-text',
    dotClass:  'bg-caution animate-pulse',
  },
  // ── Messenger setup state machine ─────────────────────────────────────────
  PAGE_SELECTED: {
    labelKey:  'status.pageLinked',
    textColor: 'text-notice-text',
    dotClass:  'bg-notice animate-pulse',
  },
  PAGE_SUBSCRIBED: {
    labelKey:  'status.messengerConnected',
    textColor: 'text-notice-text',
    dotClass:  'bg-channel-ms',
  },
};

// ─── Hook step config ─────────────────────────────────────────────────────────
// These map `SetupStep` values from useWhatsAppConnect — they represent the
// in-flight state from the frontend's perspective (i.e. the HTTP call is in
// progress) BEFORE Firestore has been updated. This gives the user immediate
// feedback during the async operations.

const STEP_CONFIG: Partial<Record<SetupStep, StatusConfig>> = {
  exchanging_token: {
    labelKey:  'status.verifyingAccount',
    textColor: 'text-caution-text',
    dotClass:  'bg-caution animate-pulse',
  },
  registering_phone: {
    labelKey:  'status.activatingNumber',
    textColor: 'text-caution-text',
    dotClass:  'bg-caution animate-pulse',
  },
  verifying_status: {
    labelKey:  'status.confirmingStatus',
    textColor: 'text-notice-text',
    dotClass:  'bg-notice animate-pulse',
  },
  subscribing_webhooks: {
    labelKey:  'status.finalizingConn',
    textColor: 'text-caution-text',
    dotClass:  'bg-caution animate-pulse',
  },
  complete: {
    labelKey:  'status.connectedCheck',
    textColor: 'text-ok-text',
    dotClass:  'bg-ok-text',
  },
  error: {
    labelKey:  'status.error',
    textColor: 'text-danger-text',
    dotClass:  'bg-danger',
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
  const { t } = useLanguage();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded-full bg-surface-subtle animate-pulse" />
        <span className="text-sm text-content-3">{t('status.loading')}</span>
      </div>
    );
  }

  // Hook step takes precedence when in-flight (not idle, not complete)
  const stepConfig =
    setupStep && setupStep !== 'idle' ? STEP_CONFIG[setupStep] : undefined;

  const config = stepConfig ?? STATUS_CONFIG[status] ?? STATUS_CONFIG.ERROR;
  const { labelKey, textColor, dotClass } = config;

  // Render a Badge for terminal/prominent statuses
  if (status === 'ACTIVE' && !stepConfig) {
    return <Badge variant="ok">{t('status.active')}</Badge>;
  }
  if (status === 'ERROR' && !stepConfig) {
    return <Badge variant="danger">{t('status.error')}</Badge>;
  }

  return (
    <div className="flex items-center gap-2">
      <div className={`w-3 h-3 rounded-full ${dotClass}`} />
      <span className={`text-sm font-medium ${textColor}`}>{t(labelKey)}</span>
    </div>
  );
}

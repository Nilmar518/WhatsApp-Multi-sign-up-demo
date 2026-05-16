import { useEffect, useState, useCallback } from 'react';
import { useLanguage } from './context/LanguageContext';
import { useIntegrationId } from './hooks/useIntegrationId';
import { useIntegrationStatus } from './hooks/useIntegrationStatus';
import { useMessages } from './hooks/useMessages';
import { useConversations } from './hooks/useConversations';
import type { SetupStep } from './hooks/useWhatsAppConnect';
import ConnectionGateway from './components/ConnectionGateway';
import StatusDisplay from './components/StatusDisplay';
import ChatConsole from './components/ChatConsole';
import BusinessToggle from './components/BusinessToggle';
import ConversationList from './components/ConversationList';
import { CartPanel } from './components/CartPanel';
import ChannelTabs, { type Channel } from './components/ChannelTabs';
import MessengerConnect from './components/MessengerConnect';
import InstagramConnect from './components/InstagramConnect';
import InstagramInbox from './components/InstagramInbox';
import ChannexHub from './channex/ChannexHub';
import DashboardView from './components/dashboard/DashboardView';

// ── Phase 4: business IDs loaded dynamically from the backend ─────────────────
// Fallback to the fixture IDs while fetch is in flight so the UI renders
// immediately; once the response arrives the toggle updates.
const FALLBACK_BUSINESS_IDS = ['787167007221172', 'demo-business-002'];

interface AppProps {
  view?: 'dashboard' | 'mensajes';
  initialChannel?: Channel;
}

export default function App({ view = 'dashboard', initialChannel }: AppProps) {
  const { t } = useLanguage();
  // ── Dynamic business list (Phase 4) ─────────────────────────────────────────
  const [businessIds, setBusinessIds] = useState<string[]>(FALLBACK_BUSINESS_IDS);
  const [businessId, setBusinessId] = useState<string>(FALLBACK_BUSINESS_IDS[0]);

  useEffect(() => {
    fetch('/api/integrations/businesses')
      .then((r) => r.json())
      .then((ids: string[]) => {
        if (ids.length > 0) {
          setBusinessIds(ids);
          // Only reset selection if the current one is not in the new list
          setBusinessId((prev) => (ids.includes(prev) ? prev : ids[0]));
        }
      })
      .catch((err) =>
        console.warn('[App] Failed to load business IDs from backend, using fallback', err),
      );
  }, []);

  // ── Channel navigation ────────────────────────────────────────────────────────
  const [activeChannel, setActiveChannel] = useState<Channel>(initialChannel ?? 'whatsapp');
  const [integrationsRefreshNonce, setIntegrationsRefreshNonce] = useState(0);

  // ── WhatsApp integration (filtered to META provider) ─────────────────────────
  // The provider filter is needed once a business can have multiple integrations
  // (META + META_MESSENGER). Without it, Firestore may return the wrong doc.
  // Requires a composite index on (connectedBusinessIds, provider) in production.
  const { integrationId: waIntegrationId, isLoading: isResolvingWa } =
    useIntegrationId(businessId, 'META', integrationsRefreshNonce);

  const {
    status: waStatus,
    metaData: waMetaData,
    catalog: waCatalog,
    isLoading: isLoadingWaStatus,
  } = useIntegrationStatus(waIntegrationId, integrationsRefreshNonce);

  const waMessages      = useMessages(waIntegrationId);
  const waConversations = useConversations(waMessages);

  // ── Messenger integration (filtered to META_MESSENGER provider) ───────────────
  const { integrationId: msgrIntegrationId, isLoading: isResolvingMsgr } =
    useIntegrationId(businessId, 'META_MESSENGER', integrationsRefreshNonce);

  const {
    status: msgrStatus,
    metaData: msgrMetaData,
    isLoading: isLoadingMsgrStatus,
  } = useIntegrationStatus(msgrIntegrationId, integrationsRefreshNonce);

  const msgrMessages      = useMessages(msgrIntegrationId);
  const msgrConversations = useConversations(msgrMessages);

  // ── Instagram integration (filtered to META_INSTAGRAM provider) ───────────────
  const { integrationId: igIntegrationId, isLoading: isResolvingIg } =
    useIntegrationId(businessId, 'META_INSTAGRAM', integrationsRefreshNonce);

  const {
    status: igStatus,
    metaData: igMetaData,
    isLoading: isLoadingIgStatus,
  } = useIntegrationStatus(igIntegrationId, integrationsRefreshNonce);

  const igMessages      = useMessages(igIntegrationId);
  const igConversations = useConversations(igMessages);

  // ── Derived channel-aware values ──────────────────────────────────────────────
  const activeMetaData = activeChannel === 'whatsapp' ? waMetaData
    : activeChannel === 'messenger'  ? msgrMetaData
    : activeChannel === 'instagram'  ? igMetaData
    : undefined;
  const activeCatalogId = (activeMetaData?.catalogId as string | undefined) ?? undefined;
  const conversations  = activeChannel === 'whatsapp' ? waConversations
    : activeChannel === 'messenger'  ? msgrConversations
    : activeChannel === 'instagram'  ? igConversations
    : [];
  const isLoading      = activeChannel === 'whatsapp'
    ? isResolvingWa   || isLoadingWaStatus
    : activeChannel === 'messenger'
      ? isResolvingMsgr || isLoadingMsgrStatus
      : activeChannel === 'instagram'
        ? isResolvingIg  || isLoadingIgStatus
        : false;

  // ── Phase 5: lift setupStep from ConnectionGateway → StatusDisplay ────────────
  const [setupStep, setSetupStep] = useState<SetupStep>('idle');
  const handleSetupStepChange = useCallback((step: SetupStep) => {
    setSetupStep(step);
    if (step === 'complete') {
      setSetupStep('idle');
    }
  }, []);

  // ── Active contact — shared slot, reset on business or channel change ─────────
  const [activeContact, setActiveContact] = useState<string | null>(null);

  useEffect(() => {
    setActiveContact(null);
  }, [businessId, activeChannel]);

  // Auto-select first contact in the active channel's conversation list
  useEffect(() => {
    if (conversations.length > 0 && !activeContact) {
      setActiveContact(conversations[0].waId);
    }
  }, [conversations, activeContact]);

  // ── WhatsApp connection state ─────────────────────────────────────────────────
  const connectedStatuses = ['ACTIVE', 'WEBHOOKS_SUBSCRIBED', 'CATALOG_SELECTED'];
  const isWaActive    = Boolean(waStatus && connectedStatuses.includes(waStatus));
  const showWaDashboard = isWaActive || waStatus === 'PENDING_TOKEN';

  // ── Messenger connection state ────────────────────────────────────────────────
  // A Messenger integration is "connected" as soon as the Firestore document
  // exists (msgrIntegrationId !== null). The backend only writes the document
  // after PAGE_SUBSCRIBED, so its existence is a sufficient connected signal.
  const isMsgrConnected = msgrIntegrationId !== null;

  // ── Instagram connection state ────────────────────────────────────────────────
  // Same signal: backend writes the document only after WEBHOOKS_SUBSCRIBED.
  const isIgConnected = igIntegrationId !== null;

  /* ── Shared header bar (both views) ──────────────────────────────────────── */
  const header = (
    <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-edge bg-surface-raised">
      <div>
        <h1 className="text-lg font-bold text-content">
          {view === 'mensajes' ? t('app.messages') : t('app.dashboard')}
        </h1>
        <p className="text-content-3 text-xs mt-0.5">
          {view === 'mensajes' ? t('app.subtitle.messages') : t('app.subtitle.dashboard')}
        </p>
      </div>
      <BusinessToggle
        businessIds={businessIds}
        selected={businessId}
        onChange={(id) => setBusinessId(id)}
      />
    </div>
  );

  /* ── helpers: single-channel panels (reused in both single and multi views) ── */
  const whatsappPanel = (
    <>
      {showWaDashboard ? (
        <div className="flex flex-1 overflow-hidden border-t border-edge">
          <div className="w-72 shrink-0 border-r border-edge flex flex-col">
            <CartPanel integrationId={waIntegrationId} contactWaId={activeContact} />
          </div>
          <ConversationList contacts={waConversations} activeContact={activeContact} onSelect={setActiveContact} />
          <div className="flex-1 min-w-0 p-4 flex flex-col">
            <ChatConsole businessId={businessId} messages={waMessages} status={waStatus} activeChannel="whatsapp" activeContact={activeContact} />
          </div>
        </div>
      ) : (
        <div className="p-6 space-y-4">
          <StatusDisplay status={waStatus} isLoading={isLoading} setupStep={setupStep} />
          <ConnectionGateway businessId={businessId} currentStatus={waStatus} onSetupStepChange={handleSetupStepChange} />
        </div>
      )}
    </>
  );

  const messengerPanel = (
    <>
      {isResolvingMsgr ? (
        <div className="flex items-center justify-center py-16 text-content-3 text-sm gap-2">
          <span className="w-4 h-4 border-2 border-edge border-t-brand rounded-full animate-spin" />
          {t('app.verifying.messenger')}
        </div>
      ) : !isMsgrConnected ? (
        <div className="p-6"><MessengerConnect businessId={businessId} /></div>
      ) : (
        <div className="flex flex-1 overflow-hidden border-t border-edge">
          <ConversationList contacts={msgrConversations} activeContact={activeContact} onSelect={setActiveContact} />
          <div className="flex-1 min-w-0 p-4 flex flex-col">
            <ChatConsole businessId={businessId} messages={msgrMessages} status={msgrStatus} activeChannel="messenger" activeContact={activeContact} />
          </div>
        </div>
      )}
    </>
  );

  const instagramPanel = (
    <>
      {isResolvingIg ? (
        <div className="flex items-center justify-center py-16 text-content-3 text-sm gap-2">
          <span className="w-4 h-4 border-2 border-edge border-t-brand rounded-full animate-spin" />
          {t('app.verifying.instagram')}
        </div>
      ) : !isIgConnected ? (
        <div className="p-6"><InstagramConnect businessId={businessId} /></div>
      ) : (
        <div className="p-6 space-y-4">
          <StatusDisplay status={igStatus} isLoading={isLoadingIgStatus} setupStep="idle" />
          <InstagramInbox igMessages={igMessages} igIntegrationId={igIntegrationId!} />
        </div>
      )}
    </>
  );

  /* ── MENSAJES VIEW — single channel (came from sidebar item) ─────────────── */
  if (view === 'mensajes' && initialChannel) {
    return (
      <div className="flex flex-col h-full min-h-screen bg-surface">
        {header}
        <div className="flex flex-col flex-1 overflow-hidden">
          {initialChannel === 'whatsapp'  && whatsappPanel}
          {initialChannel === 'messenger' && messengerPanel}
          {initialChannel === 'instagram' && instagramPanel}
          {initialChannel === 'channex'   && <div className="p-6"><ChannexHub businessId={businessId} /></div>}
        </div>
      </div>
    );
  }

  /* ── MENSAJES VIEW — all channels with tabs (/mensajes without ?channel) ─── */
  if (view === 'mensajes') {
    return (
      <div className="flex flex-col h-full min-h-screen bg-surface">
        {header}
        <div className="flex flex-col flex-1 overflow-hidden">
          <ChannelTabs active={activeChannel} onChange={setActiveChannel} />
          {activeChannel === 'whatsapp'  && whatsappPanel}
          {activeChannel === 'messenger' && messengerPanel}
          {activeChannel === 'instagram' && instagramPanel}
          {activeChannel === 'channex'   && <div className="p-6"><ChannexHub businessId={businessId} /></div>}
        </div>
      </div>
    );
  }

  /* ── DASHBOARD VIEW ───────────────────────────────────────────────────────── */
  return (
    <div className="flex flex-col min-h-screen bg-surface">
      {header}
      <DashboardView
        businessId={businessId}
        isWaActive={isWaActive}
        waMessages={waMessages}
        waConversations={waConversations}
        isMsgrConnected={isMsgrConnected}
        msgrMessages={msgrMessages}
        msgrConversations={msgrConversations}
        isIgConnected={isIgConnected}
        igMessages={igMessages}
        igConversations={igConversations}
        catalog={waCatalog}
        activeCatalogId={activeCatalogId}
        catalogIntegrationId={waIntegrationId ?? msgrIntegrationId}
        catalogStatus={waStatus ?? msgrStatus ?? 'IDLE'}
        onCatalogLinked={() => setIntegrationsRefreshNonce((prev) => prev + 1)}
      />
    </div>
  );
}

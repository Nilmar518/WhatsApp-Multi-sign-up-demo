import { useEffect, useState, useCallback } from 'react';
import { useIntegrationId } from './hooks/useIntegrationId';
import { useIntegrationStatus } from './hooks/useIntegrationStatus';
import { useMessages } from './hooks/useMessages';
import { useConversations } from './hooks/useConversations';
import type { SetupStep } from './hooks/useWhatsAppConnect';
import ConnectionGateway from './components/ConnectionGateway';
import StatusDisplay from './components/StatusDisplay';
import ChatConsole from './components/ChatConsole';
import CatalogView from './components/CatalogView';
import BusinessToggle from './components/BusinessToggle';
import ConversationList from './components/ConversationList';
import DisconnectButton from './components/ResetButton';
import { CartPanel } from './components/CartPanel';
import ChannelTabs, { type Channel } from './components/ChannelTabs';
import MessengerConnect from './components/MessengerConnect';
import InstagramConnect from './components/InstagramConnect';
import InstagramInbox from './components/InstagramInbox';

// ── Phase 4: business IDs loaded dynamically from the backend ─────────────────
// Fallback to the fixture IDs while fetch is in flight so the UI renders
// immediately; once the response arrives the toggle updates.
const FALLBACK_BUSINESS_IDS = ['787167007221172', 'demo-business-002'];

export default function App() {
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
  const [activeChannel, setActiveChannel] = useState<Channel>('whatsapp');
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
  const integrationId  = activeChannel === 'whatsapp' ? waIntegrationId
    : activeChannel === 'messenger'  ? msgrIntegrationId
    : igIntegrationId;
  const status         = activeChannel === 'whatsapp' ? waStatus
    : activeChannel === 'messenger'  ? msgrStatus
    : igStatus;
  const activeMetaData = activeChannel === 'whatsapp' ? waMetaData
    : activeChannel === 'messenger'  ? msgrMetaData
    : igMetaData;
  const activeCatalogId = (activeMetaData?.catalogId as string | undefined) ?? undefined;
  const conversations  = activeChannel === 'whatsapp' ? waConversations
    : activeChannel === 'messenger'  ? msgrConversations
    : igConversations;
  const messages       = activeChannel === 'whatsapp' ? waMessages
    : activeChannel === 'messenger'  ? msgrMessages
    : igMessages;
  const isLoading      = activeChannel === 'whatsapp'
    ? isResolvingWa   || isLoadingWaStatus
    : activeChannel === 'messenger'
      ? isResolvingMsgr || isLoadingMsgrStatus
      : isResolvingIg  || isLoadingIgStatus;

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

  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center p-6">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-7xl space-y-6">

        {/* ── Header + Business Toggle ─────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Migo UIT</h1>
            <p className="text-gray-500 text-sm mt-0.5">
              Multi-channel Business Messaging dashboard.
            </p>
          </div>
          <BusinessToggle
            businessIds={businessIds}
            selected={businessId}
            onChange={(id) => setBusinessId(id)}
          />
        </div>

        {/* ── Channel Tabs ─────────────────────────────────────────────────── */}
        <div className="border border-gray-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
              Catalog Setup (Business Global)
            </h2>
            <p className="text-xs text-gray-500">
              Shared catalog for WhatsApp and Messenger.
            </p>
          </div>

            {integrationId ? (
            <CatalogView
                businessId={businessId}
                status={status}
                activeCatalogId={activeCatalogId}
                onCatalogLinked={() =>
                  setIntegrationsRefreshNonce((prev) => prev + 1)
                }
            />
          ) : (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Connect at least one channel to configure the centralized catalog for this business.
            </div>
          )}
        </div>

        <ChannelTabs active={activeChannel} onChange={setActiveChannel} />

        {/* ── HTTPS guard — Meta Live Mode requires a secure origin ────────── */}
        {window.location.protocol === 'http:' && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800 leading-relaxed">
            <strong className="font-semibold">Insecure connection.</strong>{' '}
            Meta&apos;s Facebook Login requires HTTPS. Open{' '}
            <code className="font-mono bg-amber-100 px-1 rounded">
              https://localhost:5173
            </code>{' '}
            or your ngrok HTTPS URL — the Connect button will not work over plain HTTP.
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/*  WHATSAPP CHANNEL                                                 */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {activeChannel === 'whatsapp' && (
          <>
            {/* ── Connection Status ────────────────────────────────────────── */}
            <StatusDisplay status={waStatus} isLoading={isLoading} setupStep={setupStep} />

            {/* ── Connection gateway (hidden once active or token pending) ──── */}
            {!showWaDashboard && (
              <ConnectionGateway
                businessId={businessId}
                currentStatus={waStatus}
                onSetupStepChange={handleSetupStepChange}
              />
            )}

            {waStatus === 'ERROR' && (
              <p className="text-xs text-red-500 text-center -mt-2">
                Connection failed. Retry above or contact support.
              </p>
            )}

            {/* ── Active + pending dashboard ─────────────────────────────────── */}
            {showWaDashboard && (
              <>
                {/*
                  3-column dashboard panel
                  ─────────────────────────────────────────────────────────────
                  Col 1 (w-72)   Cart Panel     — real-time active cart viewer
                  Col 2 (w-52)   Conversations  — contact list
                  Col 3 (flex-1) Chat           — message thread
                */}
                <div className="flex border border-gray-200 rounded-xl overflow-hidden h-[600px] overflow-x-auto">
                  <div className="w-72 shrink-0 border-r border-gray-200 flex flex-col">
                    <CartPanel
                      integrationId={waIntegrationId}
                      contactWaId={activeContact}
                    />
                  </div>

                  <ConversationList
                    contacts={waConversations}
                    activeContact={activeContact}
                    onSelect={setActiveContact}
                  />

                  <div className="flex-1 min-w-0 p-4 flex flex-col">
                    <ChatConsole
                      businessId={businessId}
                      messages={waMessages}
                      status={waStatus}
                      activeChannel={activeChannel}
                      activeContact={activeContact}
                    />
                  </div>
                </div>

                {isWaActive && <DisconnectButton businessId={businessId} />}
              </>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/*  MESSENGER CHANNEL                                                */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {activeChannel === 'messenger' && (
          <>
            {/* Loading state while Firestore resolves */}
            {isResolvingMsgr && (
              <div className="flex items-center justify-center py-16 text-gray-400 text-sm gap-2">
                <span className="w-4 h-4 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin" />
                Checking Messenger integration...
              </div>
            )}

            {/* Not connected — show onboarding */}
            {!isResolvingMsgr && !isMsgrConnected && (
              <MessengerConnect businessId={businessId} />
            )}

            {/* Connected — 2-column chat view (no Cart, no Catalog) */}
            {!isResolvingMsgr && isMsgrConnected && (
              <>
                {/* Slim status indicator */}
                <StatusDisplay
                  status={msgrStatus}
                  isLoading={isLoadingMsgrStatus}
                  setupStep="idle"
                />

                {/*
                  2-column Messenger dashboard
                  ─────────────────────────────────────────────────────────────
                  Cart and Catalog panels are WhatsApp-specific features.
                  Messenger shows Conversations + Chat only.
                */}
                <div className="flex border border-gray-200 rounded-xl overflow-hidden h-[600px] overflow-x-auto">
                  <ConversationList
                    contacts={msgrConversations}
                    activeContact={activeContact}
                    onSelect={setActiveContact}
                  />

                  <div className="flex-1 min-w-0 p-4 flex flex-col">
                    <ChatConsole
                      businessId={businessId}
                      messages={msgrMessages}
                      status={msgrStatus}
                      activeChannel={activeChannel}
                      activeContact={activeContact}
                    />
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/*  INSTAGRAM CHANNEL                                               */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {activeChannel === 'instagram' && (
          <>
            {/* Loading state while Firestore resolves */}
            {isResolvingIg && (
              <div className="flex items-center justify-center py-16 text-gray-400 text-sm gap-2">
                <span className="w-4 h-4 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin" />
                Checking Instagram integration...
              </div>
            )}

            {/* Not connected — show onboarding */}
            {!isResolvingIg && !isIgConnected && (
              <InstagramConnect businessId={businessId} />
            )}

            {/* Connected — Accordion inbox (Phase 4) */}
            {!isResolvingIg && isIgConnected && (
              <>
                <StatusDisplay
                  status={igStatus}
                  isLoading={isLoadingIgStatus}
                  setupStep="idle"
                />
                <InstagramInbox igMessages={igMessages} igIntegrationId={igIntegrationId!} />
              </>
            )}
          </>
        )}

      </div>
    </div>
  );
}

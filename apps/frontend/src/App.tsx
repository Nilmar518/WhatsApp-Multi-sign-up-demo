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

  // ── Resolve integrationId (UUID) for the selected business (Phase 4) ─────────
  // When the business has no active integration yet, integrationId is null and
  // all downstream hooks short-circuit gracefully.
  const { integrationId, isLoading: isResolvingId } = useIntegrationId(businessId);

  const { status, catalog, isLoading: isLoadingStatus } = useIntegrationStatus(integrationId);
  const messages = useMessages(integrationId);
  const conversations = useConversations(messages);

  const isLoading = isResolvingId || isLoadingStatus;

  // ── Phase 5: lift setupStep from ConnectionGateway → StatusDisplay ────────────
  // ConnectionGateway owns the useWhatsAppConnect hook; it reports step changes
  // here so the global StatusDisplay can show in-flight progress.
  const [setupStep, setSetupStep] = useState<SetupStep>('idle');
  const handleSetupStepChange = useCallback((step: SetupStep) => {
    setSetupStep(step);
    // Reset to idle when the Firestore listener fires ACTIVE — avoids the
    // 'complete' step persisting after the full round-trip to Firestore.
    if (step === 'complete') {
      setSetupStep('idle');
    }
  }, []);

  const [activeContact, setActiveContact] = useState<string | null>(null);

  // Auto-select the first contact as soon as conversations populate
  useEffect(() => {
    if (conversations.length > 0 && !activeContact) {
      setActiveContact(conversations[0].waId);
    }
  }, [conversations, activeContact]);

  // Reset contact selection when switching business integrations
  useEffect(() => {
    setActiveContact(null);
  }, [businessId]);

  // Treat the integration as active if it's in any fully connected state.
  // The setup flow completes at WEBHOOKS_SUBSCRIBED (or CATALOG_SELECTED).
  const connectedStatuses = ['ACTIVE', 'WEBHOOKS_SUBSCRIBED', 'CATALOG_SELECTED'];
  const isActive = Boolean(status && connectedStatuses.includes(status));

  // Show the dashboard pane whenever the integration is in a "connected or
  // connecting" state. MIGRATING is excluded here — the modal stays open
  // mid-migration and there is no dashboard token to display yet.
  const showDashboard = isActive || status === 'PENDING_TOKEN';

  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center p-6">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-7xl space-y-6">
        {/* ── Header + Business Toggle ─────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Migo UIT</h1>
            <p className="text-gray-500 text-sm mt-0.5">
              WhatsApp Business onboarding dashboard.
            </p>
          </div>
          <BusinessToggle
            businessIds={businessIds}
            selected={businessId}
            onChange={(id) => setBusinessId(id)}
          />
        </div>

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

        {/* ── Connection Status ────────────────────────────────────────────── */}
        <StatusDisplay status={status} isLoading={isLoading} setupStep={setupStep} />

        {/* ── Connection gateway (hidden once active or token pending) ────────── */}
        {/* Renders a trigger button that opens the pre-connection modal. The     */}
        {/* modal offers Standard Connect (Meta Embedded Signup) and Force        */}
        {/* Migration (API-driven OTP bypass for numbers on a handset).           */}
        {!showDashboard && (
          <ConnectionGateway
            businessId={businessId}
            currentStatus={status}
            onSetupStepChange={handleSetupStepChange}
          />
        )}

        {status === 'ERROR' && (
          <p className="text-xs text-red-500 text-center -mt-2">
            Connection failed. Retry above or contact support.
          </p>
        )}

        {/* ── Active + pending dashboard ────────────────────────────────────── */}
        {/* CatalogView and DisconnectButton are hidden during PENDING_TOKEN     */}
        {/* because no access token is available yet to fetch catalog data.      */}
        {showDashboard && (
          <>
            {isActive && integrationId && (
              <CatalogView integrationId={integrationId} status={status} catalog={catalog} />
            )}

            {/*
              3-column dashboard panel
              ─────────────────────────────────────────────────────────────────
              Col 1 (w-72)   Cart Panel     — real-time active cart viewer
              Col 2 (w-52)   Conversations  — contact list (ConversationList)
              Col 3 (flex-1) Chat           — message thread (ChatConsole)

              h-[600px] on the wrapper is the single source of truth for row
              height — all three children use h-full internally so they stretch
              to fill it uniformly.

              overflow-x-auto lets the row scroll sideways on narrow viewports
              rather than breaking the layout.
            */}
            <div className="flex border border-gray-200 rounded-xl overflow-hidden h-[600px] overflow-x-auto">

              {/* ── Col 1: Cart Panel ──────────────────────────────────────── */}
              <div className="w-72 shrink-0 border-r border-gray-200 flex flex-col">
                <CartPanel
                  integrationId={integrationId}
                  contactWaId={activeContact}
                />
              </div>

              {/* ── Col 2: Conversation List ───────────────────────────────── */}
              {/*
                ConversationList already declares w-52 shrink-0 and
                border-r border-gray-100 internally — no wrapper needed.
              */}
              <ConversationList
                contacts={conversations}
                activeContact={activeContact}
                onSelect={setActiveContact}
              />

              {/* ── Col 3: Chat Window ─────────────────────────────────────── */}
              <div className="flex-1 min-w-0 p-4 flex flex-col">
                <ChatConsole
                  businessId={businessId}
                  messages={messages}
                  status={status}
                  activeContact={activeContact}
                />
              </div>
            </div>

            {isActive && <DisconnectButton businessId={businessId} />}
          </>
        )}
      </div>
    </div>
  );
}



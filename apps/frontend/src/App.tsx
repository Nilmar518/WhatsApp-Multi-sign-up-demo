import { useEffect, useState } from 'react';
import { useIntegrationStatus } from './hooks/useIntegrationStatus';
import { useMessages } from './hooks/useMessages';
import { useConversations } from './hooks/useConversations';
import ConnectionGateway from './components/ConnectionGateway';
import StatusDisplay from './components/StatusDisplay';
import ChatConsole from './components/ChatConsole';
import CatalogView from './components/CatalogView';
import BusinessToggle from './components/BusinessToggle';
import ConversationList from './components/ConversationList';
import DisconnectButton from './components/ResetButton';

const BUSINESS_IDS = ['demo-business-001', 'demo-business-002'] as const;
type BusinessId = (typeof BUSINESS_IDS)[number];

export default function App() {
  const [businessId, setBusinessId] = useState<BusinessId>(BUSINESS_IDS[0]);
  const { status, catalog, isLoading } = useIntegrationStatus(businessId);
  const messages = useMessages(businessId);
  const conversations = useConversations(messages);

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

  const isActive = status === 'ACTIVE';
  // Show the dashboard pane whenever the integration is in a "connected or
  // connecting" state. MIGRATING is excluded here — the modal stays open
  // mid-migration and there is no dashboard token to display yet.
  const showDashboard = isActive || status === 'PENDING_TOKEN';

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-3xl space-y-6">
        {/* ── Header + Business Toggle ─────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Migo UIT</h1>
            <p className="text-gray-500 text-sm mt-0.5">
              WhatsApp Business onboarding dashboard.
            </p>
          </div>
          <BusinessToggle
            businessIds={BUSINESS_IDS}
            selected={businessId}
            onChange={(id) => setBusinessId(id as BusinessId)}
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
        <StatusDisplay status={status} isLoading={isLoading} />

        {/* ── Connection gateway (hidden once active or token pending) ────────── */}
        {/* Renders a trigger button that opens the pre-connection modal. The     */}
        {/* modal offers Standard Connect (Meta Embedded Signup) and Force        */}
        {/* Migration (API-driven OTP bypass for numbers on a handset).           */}
        {!showDashboard && (
          <ConnectionGateway businessId={businessId} currentStatus={status} />
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
            {isActive && <CatalogView businessId={businessId} catalog={catalog} />}

            {/* Split panel: ConversationList (left) + ChatConsole (right) */}
            <div
              className="flex border border-gray-200 rounded-xl overflow-hidden"
              style={{ minHeight: '22rem' }}
            >
              <ConversationList
                contacts={conversations}
                activeContact={activeContact}
                onSelect={setActiveContact}
              />
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

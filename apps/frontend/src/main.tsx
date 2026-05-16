import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import CatalogManagerApp from './catalog-manager/CatalogManagerApp';
import InventoryPage from './inventory/InventoryPage';
import ChannexHub from './channex/ChannexHub';
import SettingsPage from './settings/SettingsPage';
import AuthGate from './auth/AuthGate';
import MainLayout from './layout/MainLayout';
import { ThemeProvider } from './context/ThemeContext';
import { LanguageProvider } from './context/LanguageContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

const FALLBACK_BID = '787167007221172';

function ChannexPage({ initialTab = 'properties' }: { initialTab?: 'properties' | 'airbnb' | 'booking' }) {
  const [businessId, setBusinessId] = useState(FALLBACK_BID);
  useEffect(() => {
    fetch('/api/integrations/businesses')
      .then((r) => r.json())
      .then((ids: string[]) => { if (ids.length > 0) setBusinessId(ids[0]); })
      .catch(() => {});
  }, []);
  return <ChannexHub businessId={businessId} initialTab={initialTab} />;
}

// In production, rewrite /api/* fetch calls to the Railway backend URL.
// In dev, Vite proxy handles /api/* → localhost:3001.
const apiBase = import.meta.env.VITE_API_BASE_URL as string | undefined;
if (apiBase) {
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === 'string' && input.startsWith('/api/')) {
      input = apiBase + input;
    }
    return _fetch(input, init);
  };
}

type ChannelParam = 'whatsapp' | 'messenger' | 'instagram' | 'channex';

function channexTab(path: string): 'properties' | 'airbnb' | 'booking' {
  if (path.startsWith('/channex/airbnb'))   return 'airbnb';
  if (path.startsWith('/channex/booking'))  return 'booking';
  return 'properties';
}

function AppShell() {
  const [loc, setLoc] = useState({ path: window.location.pathname, search: window.location.search });
  const [transitioning, setTransitioning] = useState(false);

  useEffect(() => {
    const onPop = () => {
      setTransitioning(true);
      setLoc({ path: window.location.pathname, search: window.location.search });
      const t = setTimeout(() => setTransitioning(false), 250);
      return () => clearTimeout(t);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const { path, search } = loc;
  const channelParam = new URLSearchParams(search).get('channel') as ChannelParam | null;

  let content: React.ReactNode;
  if (path.startsWith('/catalog-manager')) content = <CatalogManagerApp />;
  else if (path.startsWith('/inventory'))  content = <InventoryPage />;
  else if (path.startsWith('/mensajes'))   content = <App view="mensajes" initialChannel={channelParam ?? undefined} />;
  else if (path.startsWith('/channex'))    content = <ChannexPage initialTab={channexTab(path)} />;
  else if (path.startsWith('/configuracion')) content = <SettingsPage />;
  else                                     content = <App view="dashboard" />;

  return <MainLayout transitioning={transitioning}>{content}</MainLayout>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <LanguageProvider>
          <AuthGate>
            <AppShell />
          </AuthGate>
        </LanguageProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import CatalogManagerApp from './catalog-manager/CatalogManagerApp';
import InventoryPage from './inventory/InventoryPage';
import AuthGate from './auth/AuthGate';
import MainLayout from './layout/MainLayout';
import './index.css';

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

// Pathname-based routing (no external router dependency)
const isCatalogManager = window.location.pathname.startsWith('/catalog-manager');
const isInventory       = window.location.pathname.startsWith('/inventory');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthGate>
      {isInventory ? (
        <InventoryPage />
      ) : isCatalogManager ? (
        <CatalogManagerApp />
      ) : (
        <MainLayout>
          <App />
        </MainLayout>
      )}
    </AuthGate>
  </React.StrictMode>,
);

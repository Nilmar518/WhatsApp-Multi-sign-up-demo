import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import CatalogManagerApp from './catalog-manager/CatalogManagerApp';
import InventoryPage from './inventory/InventoryPage';
import AuthGate from './auth/AuthGate';
import './index.css';

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
        <App />
      )}
    </AuthGate>
  </React.StrictMode>,
);

import { useState, useEffect, useCallback } from 'react';
import type { MetaCatalog } from '../catalog-manager/api/catalogManagerApi';
import { listCatalogs } from '../catalog-manager/api/catalogManagerApi';
import CatalogManager from './components/CatalogManager';
import ProductManager from './components/ProductManager';
import { ToastContainer } from './components/Toast';
import type { ToastItem, ToastType } from './components/Toast';

const BUSINESS_OPTIONS = [
  { label: 'Demo Business 001', value: 'demo-business-001' },
  { label: 'Demo Business 002', value: 'demo-business-002' },
];

type View = 'catalogs' | 'products';

/**
 * InventoryPage — Administrative view for catalog & product management.
 *
 * Route: /inventory (pathname-based routing in main.tsx)
 *
 * Separated from the Dashboard (CatalogView) which handles WABA linking only.
 * This page is the full ABM/CRUD surface for Meta product catalogs and items.
 */
export default function InventoryPage() {
  const [businessId, setBusinessId] = useState(BUSINESS_OPTIONS[0].value);
  const [view, setView]             = useState<View>('catalogs');
  const [selectedCatalog, setSelectedCatalog] = useState<MetaCatalog | null>(null);

  // Catalogs
  const [catalogs, setCatalogs]         = useState<MetaCatalog[]>([]);
  const [catalogsLoading, setCatalogsLoading] = useState(false);

  // Toasts
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Date.now().toString() + Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ── Fetch catalogs ──────────────────────────────────────────────────────────

  const fetchCatalogs = useCallback(async () => {
    setCatalogsLoading(true);
    try {
      const data = await listCatalogs(businessId);
      setCatalogs(data);
    } catch (err: unknown) {
      showToast(
        err instanceof Error ? err.message : 'Failed to load catalogs',
        'error',
      );
    } finally {
      setCatalogsLoading(false);
    }
  }, [businessId, showToast]);

  // Re-fetch + reset view whenever business changes
  useEffect(() => {
    setCatalogs([]);
    setView('catalogs');
    setSelectedCatalog(null);
    void fetchCatalogs();
  }, [fetchCatalogs, businessId]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleViewProducts = (catalog: MetaCatalog) => {
    setSelectedCatalog(catalog);
    setView('products');
  };

  const handleBackToCatalogs = () => {
    setView('catalogs');
    setSelectedCatalog(null);
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <a
            href="/"
            className="text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
          >
            ← Dashboard
          </a>
          <span className="text-gray-300">|</span>
          <h1 className="text-base font-bold text-gray-900">
            Inventory Manager
          </h1>
          <span className="text-xs font-medium bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
            Admin
          </span>
        </div>

        {/* Business selector */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-500">Business</label>
          <select
            value={businessId}
            onChange={(e) => setBusinessId(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-white"
          >
            {BUSINESS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-4xl mx-auto px-6 py-8">
        <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
          {view === 'catalogs' && (
            <CatalogManager
              businessId={businessId}
              catalogs={catalogs}
              isLoading={catalogsLoading}
              onRefresh={() => void fetchCatalogs()}
              onViewProducts={handleViewProducts}
              onToast={showToast}
            />
          )}

          {view === 'products' && selectedCatalog && (
            <ProductManager
              businessId={businessId}
              catalog={selectedCatalog}
              onBack={handleBackToCatalogs}
              onToast={showToast}
            />
          )}
        </div>
      </main>

      {/* Toast notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

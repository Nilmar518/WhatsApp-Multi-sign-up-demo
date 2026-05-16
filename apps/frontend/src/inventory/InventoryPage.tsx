import { useState, useEffect, useCallback } from 'react';
import type { MetaCatalog, MetaProduct } from '../catalog-manager/api/catalogManagerApi';
import { listCatalogs } from '../catalog-manager/api/catalogManagerApi';
import CatalogManager from './components/CatalogManager';
import ProductManager from './components/ProductManager';
import VariantManager from './components/VariantManager';
import AutoReplyManager from './components/AutoReplyManager';
import { ToastContainer } from './components/Toast';
import type { ToastItem, ToastType } from './components/Toast';

// ─── Constants ────────────────────────────────────────────────────────────────

const BUSINESS_OPTIONS = [
  { label: 'Real Business', value: '787167007221172' },
  { label: 'Demo Business 002', value: 'demo-business-002' },
];

// ─── Types ────────────────────────────────────────────────────────────────────

type Section = 'inventory' | 'auto-replies';
type InventoryView = 'catalogs' | 'products' | 'variants';

// ─── Sidebar icons ────────────────────────────────────────────────────────────

function BoxIcon({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2 : 1.75}
      className="w-4 h-4 shrink-0"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
      />
    </svg>
  );
}

function BoltIcon({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2 : 1.75}
      className="w-4 h-4 shrink-0"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13 10V3L4 14h7v7l9-11h-7z"
      />
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * InventoryPage — Administrative view for catalog, product, and auto-reply management.
 *
 * Route: /inventory (pathname-based routing in main.tsx)
 *
 * Layout: sticky header + left sidebar + scrollable main content area.
 */
export default function InventoryPage() {
  const [businessId, setBusinessId] = useState(BUSINESS_OPTIONS[0].value);
  const [section, setSection]       = useState<Section>('inventory');
  const [view, setView]             = useState<InventoryView>('catalogs');
  const [selectedCatalog, setSelectedCatalog] = useState<MetaCatalog | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<MetaProduct | null>(null);

  // Catalogs (shared between inventory and auto-reply product selector)
  const [catalogs, setCatalogs]           = useState<MetaCatalog[]>([]);
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
    setSection('inventory');
    setView('catalogs');
    setSelectedCatalog(null);
    setSelectedProduct(null);
    void fetchCatalogs();
  }, [fetchCatalogs, businessId]);

  // ── Inventory view handlers ─────────────────────────────────────────────────

  const handleViewProducts = (catalog: MetaCatalog) => {
    setSelectedCatalog(catalog);
    setView('products');
  };

  const handleBackToCatalogs = () => {
    setView('catalogs');
    setSelectedCatalog(null);
    setSelectedProduct(null);
  };

  const handleManageVariants = (product: MetaProduct) => {
    setSelectedProduct(product);
    setView('variants');
  };

  const handleBackToProducts = () => {
    setView('products');
    setSelectedProduct(null);
  };

  // ── Sidebar navigation ──────────────────────────────────────────────────────

  const handleSectionChange = (next: Section) => {
    setSection(next);
    // When navigating back to inventory, reset to catalogs list
    if (next === 'inventory') {
      setView('catalogs');
      setSelectedCatalog(null);
      setSelectedProduct(null);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen flex flex-col bg-surface-subtle">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="bg-surface-raised border-b border-edge px-6 py-3.5 flex items-center justify-between shrink-0 z-10">
        <div className="flex items-center gap-3">
          <a
            href="/"
            className="text-sm font-medium text-content-3 hover:text-content-2 transition-colors"
          >
            ← Dashboard
          </a>
          <span className="text-content-3">|</span>
          <h1 className="text-sm font-bold text-content">Inventory Manager</h1>
          <span className="text-xs font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
            Admin
          </span>
        </div>

        {/* Business selector */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-content-3">Business</label>
          <select
            value={businessId}
            onChange={(e) => setBusinessId(e.target.value)}
            className="text-sm border border-edge rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-surface-raised"
          >
            {BUSINESS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* ── Body: sidebar + content ─────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Sidebar ──────────────────────────────────────────────────────── */}
        <aside className="w-56 bg-surface-raised border-r border-edge shrink-0 flex flex-col py-5 px-3">
          <p className="text-[10px] font-semibold text-content-3 uppercase tracking-widest px-3 mb-2">
            Menu
          </p>
          <nav className="space-y-0.5">
            <button
              onClick={() => handleSectionChange('inventory')}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left ${
                section === 'inventory'
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'text-content-2 hover:bg-surface-subtle hover:text-content'
              }`}
            >
              <BoxIcon active={section === 'inventory'} />
              Catalogs &amp; Products
            </button>

            <button
              onClick={() => handleSectionChange('auto-replies')}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left ${
                section === 'auto-replies'
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'text-content-2 hover:bg-surface-subtle hover:text-content'
              }`}
            >
              <BoltIcon active={section === 'auto-replies'} />
              Keyword Triggers
            </button>
          </nav>
        </aside>

        {/* ── Main content ─────────────────────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto p-6">
          <div className="bg-surface-raised border border-edge rounded-2xl p-6 shadow-sm min-h-full">

            {/* Catalogs & Products section */}
            {section === 'inventory' && view === 'catalogs' && (
              <CatalogManager
                businessId={businessId}
                catalogs={catalogs}
                isLoading={catalogsLoading}
                onRefresh={() => void fetchCatalogs()}
                onViewProducts={handleViewProducts}
                onToast={showToast}
              />
            )}

            {section === 'inventory' && view === 'products' && selectedCatalog && (
              <ProductManager
                businessId={businessId}
                catalog={selectedCatalog}
                onBack={handleBackToCatalogs}
                onToast={showToast}
                onManageVariants={handleManageVariants}
              />
            )}

            {section === 'inventory' && view === 'variants' && selectedCatalog && selectedProduct && (
              <VariantManager
                businessId={businessId}
                catalog={selectedCatalog}
                product={selectedProduct}
                onBack={handleBackToProducts}
                onToast={showToast}
              />
            )}

            {/* Keyword Triggers section */}
            {section === 'auto-replies' && (
              <AutoReplyManager
                businessId={businessId}
                catalogs={catalogs}
                onToast={showToast}
              />
            )}

          </div>
        </main>
      </div>

      {/* Toast notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

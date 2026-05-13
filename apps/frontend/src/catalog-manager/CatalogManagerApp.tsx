import { useState, useEffect, useCallback } from 'react';
import type { MetaCatalog, MetaProduct } from './api/catalogManagerApi';
import { listCatalogs, listProducts } from './api/catalogManagerApi';
import CatalogList from './components/CatalogList';
import ProductList from './components/ProductList';
import Button from '../components/ui/Button';

const BUSINESS_OPTIONS = [
  { label: 'Real Business', value: '787167007221172' },
  { label: 'Demo Business 002', value: 'demo-business-002' },
];

type View = 'catalogs' | 'products';

/**
 * CatalogManagerApp — Admin UI for WhatsApp Catalog CRUD
 *
 * Isolated from the Multi Sign-Up demo at App.tsx.
 * Accessible at /catalog-manager (pathname-based routing in main.tsx).
 *
 * Objective 1 (current): Full CRUD for Catalogs and Products via Meta Graph API.
 * Objective 2 (upcoming): Messaging automation with catalog items.
 */
export default function CatalogManagerApp() {
  const [businessId, setBusinessId] = useState(BUSINESS_OPTIONS[0].value);
  const [view, setView] = useState<View>('catalogs');
  const [selectedCatalog, setSelectedCatalog] = useState<MetaCatalog | null>(null);

  const [catalogs, setCatalogs] = useState<MetaCatalog[]>([]);
  const [catalogsLoading, setCatalogsLoading] = useState(false);
  const [catalogsError, setCatalogsError] = useState<string | null>(null);

  const [products, setProducts] = useState<MetaProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);

  // ── Fetch catalogs ──────────────────────────────────────────────────────

  const fetchCatalogs = useCallback(async () => {
    setCatalogsLoading(true);
    setCatalogsError(null);
    try {
      const data = await listCatalogs(businessId);
      setCatalogs(data);
    } catch (err: unknown) {
      setCatalogsError(
        err instanceof Error ? err.message : 'Failed to load catalogs',
      );
    } finally {
      setCatalogsLoading(false);
    }
  }, [businessId]);

  // ── Fetch products ──────────────────────────────────────────────────────

  const fetchProducts = useCallback(async () => {
    if (!selectedCatalog) return;
    setProductsLoading(true);
    setProductsError(null);
    try {
      const data = await listProducts(businessId, selectedCatalog.id);
      setProducts(data);
    } catch (err: unknown) {
      setProductsError(
        err instanceof Error ? err.message : 'Failed to load products',
      );
    } finally {
      setProductsLoading(false);
    }
  }, [businessId, selectedCatalog]);

  // ── Effects ─────────────────────────────────────────────────────────────

  useEffect(() => {
    void fetchCatalogs();
    // Reset product view when switching business
    setView('catalogs');
    setSelectedCatalog(null);
    setProducts([]);
  }, [fetchCatalogs, businessId]);

  useEffect(() => {
    if (view === 'products' && selectedCatalog) {
      void fetchProducts();
    }
  }, [view, selectedCatalog, fetchProducts]);

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleViewProducts = (catalog: MetaCatalog) => {
    setSelectedCatalog(catalog);
    setProducts([]);
    setView('products');
  };

  const handleBackToCatalogs = () => {
    setView('catalogs');
    setSelectedCatalog(null);
    setProducts([]);
  };

  const handleBusinessChange = (newBusinessId: string) => {
    setBusinessId(newBusinessId);
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-surface-subtle">
      {/* Top bar */}
      <header className="bg-surface-raised border-b border-edge px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <a
            href="/"
            className="text-sm font-medium text-content-2 hover:text-content transition-colors"
          >
            ← Main App
          </a>
          <span className="text-content-3">|</span>
          <h1 className="text-base font-bold text-content">
            Catalog Manager
          </h1>
          <span className="text-xs font-medium bg-notice-bg text-notice-text px-2 py-0.5 rounded-full">
            Admin
          </span>
        </div>

        {/* Business selector */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-content-2">Business</label>
          <select
            value={businessId}
            onChange={(e) => handleBusinessChange(e.target.value)}
            className="text-sm border border-edge rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand/20 bg-surface-raised"
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
        {/* Catalog-level error banner */}
        {view === 'catalogs' && catalogsError && (
          <div className="mb-6 text-sm text-danger-text bg-danger-bg border border-danger-bg rounded-xl px-4 py-3">
            <span className="font-semibold">Error loading catalogs: </span>
            {catalogsError}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void fetchCatalogs()}
              className="ml-3 text-xs underline hover:no-underline"
            >
              Retry
            </Button>
          </div>
        )}

        {/* Product-level error banner */}
        {view === 'products' && productsError && (
          <div className="mb-6 text-sm text-danger-text bg-danger-bg border border-danger-bg rounded-xl px-4 py-3">
            <span className="font-semibold">Error loading products: </span>
            {productsError}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void fetchProducts()}
              className="ml-3 text-xs underline hover:no-underline"
            >
              Retry
            </Button>
          </div>
        )}

        {/* Card container */}
        <div className="bg-surface-raised border border-edge rounded-2xl p-6 shadow-sm">
          {view === 'catalogs' && (
            <CatalogList
              businessId={businessId}
              catalogs={catalogs}
              isLoading={catalogsLoading}
              onRefresh={() => void fetchCatalogs()}
              onViewProducts={handleViewProducts}
            />
          )}

          {view === 'products' && selectedCatalog && (
            <ProductList
              businessId={businessId}
              catalogId={selectedCatalog.id}
              catalogName={selectedCatalog.name}
              products={products}
              isLoading={productsLoading}
              onRefresh={() => void fetchProducts()}
              onBack={handleBackToCatalogs}
            />
          )}
        </div>

        {/* Roadmap note */}
        <p className="mt-6 text-xs text-content-3 text-center">
          Objective 1 of 2 — Catalog CRUD &nbsp;·&nbsp; Objective 2 coming soon: Messaging Automation
        </p>
      </main>
    </div>
  );
}

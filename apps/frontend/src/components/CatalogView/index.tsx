import { useState, useEffect, useCallback } from 'react';
import type { CatalogData } from '../../types/catalog';
import type { MetaCatalog, CatalogHealth } from '../../catalog-manager/api/catalogManagerApi';
import {
  listCatalogs,
  createCatalog,
  linkCatalog,
  checkHealth,
} from '../../catalog-manager/api/catalogManagerApi';

interface Props {
  businessId: string;
  catalog: CatalogData | null;
}

// ─── Health badge ──────────────────────────────────────────────────────────────

function HealthBadge({ health }: { health: CatalogHealth | null }) {
  if (!health) return null;

  const allOk =
    health.appIsValid &&
    health.missingScopes.length === 0 &&
    health.hasCommerceAccount;

  const hasCritical = !health.appIsValid || health.missingScopes.length > 0;
  const [showTooltip, setShowTooltip] = useState(false);

  if (allOk) {
    return (
      <span
        className="text-xs font-medium text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full cursor-default"
        title="Meta permissions OK · Commerce Account active"
      >
        ● OK
      </span>
    );
  }

  const label = hasCritical ? '● Attention' : '● Commerce';
  const cls   = hasCritical ? 'text-red-600 bg-red-50' : 'text-amber-600 bg-amber-50';

  const tooltipLines = [
    ...health.missingScopes.map((s) => `Missing scope: ${s}`),
    ...(!health.hasCommerceAccount
      ? ['No Commerce Account — catalog creation may fail']
      : []),
    ...health.warnings.slice(0, 2),
  ];

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setShowTooltip((v) => !v)}
        className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${cls}`}
      >
        {label}
      </button>
      {showTooltip && (
        <div className="absolute left-0 top-6 z-10 bg-white border border-gray-200 rounded-xl shadow-lg p-3 w-64 space-y-1 text-xs text-gray-600">
          {tooltipLines.length === 0 ? (
            <p>Token valid — waiting on Commerce Account setup.</p>
          ) : (
            tooltipLines.map((l, i) => (
              <p key={i} className="leading-snug">{l}</p>
            ))
          )}
          <a
            href="https://business.facebook.com/commerce"
            target="_blank"
            rel="noopener noreferrer"
            className="block pt-1 text-blue-600 underline"
          >
            Open Commerce Manager →
          </a>
        </div>
      )}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function CatalogView({ businessId, catalog }: Props) {
  // ── Meta sync ─────────────────────────────────────────────────────────────
  const [isSyncing, setIsSyncing]   = useState(false);
  const [syncError, setSyncError]   = useState<string | null>(null);

  // ── System health ─────────────────────────────────────────────────────────
  const [health, setHealth]         = useState<CatalogHealth | null>(null);

  // ── Catalog selector ──────────────────────────────────────────────────────
  const [availableCatalogs, setAvailableCatalogs] = useState<MetaCatalog[]>([]);
  const [catalogsLoading, setCatalogsLoading]     = useState(false);
  const [linkingId, setLinkingId]                 = useState<string | null>(null);

  // ── Create catalog form ───────────────────────────────────────────────────
  const [showCatalogForm, setShowCatalogForm] = useState(false);
  const [newCatalogName, setNewCatalogName]   = useState('');
  const [catalogCreating, setCatalogCreating] = useState(false);
  const [catalogError, setCatalogError]       = useState<string | null>(null);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const syncFromMeta = useCallback(async () => {
    setIsSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch(
        `/api/catalog?businessId=${encodeURIComponent(businessId)}`,
      );
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? `Server error ${res.status}`);
      }
    } catch (err: unknown) {
      setSyncError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSyncing(false);
    }
  }, [businessId]);

  const fetchAvailableCatalogs = useCallback(async () => {
    setCatalogsLoading(true);
    try {
      const data = await listCatalogs(businessId);
      setAvailableCatalogs(data);
    } catch {
      setAvailableCatalogs([]);
    } finally {
      setCatalogsLoading(false);
    }
  }, [businessId]);

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    checkHealth(businessId)
      .then(setHealth)
      .catch(() => setHealth(null));
  }, [businessId]);

  useEffect(() => {
    if (!catalog?.catalogId) {
      void fetchAvailableCatalogs();
    }
  }, [catalog?.catalogId, fetchAvailableCatalogs]);

  // ── Catalog: link existing ────────────────────────────────────────────────

  const handleLinkCatalog = async (cat: MetaCatalog) => {
    setLinkingId(cat.id);
    setCatalogError(null);
    try {
      await linkCatalog(businessId, cat.id);
      await syncFromMeta();
    } catch (err: unknown) {
      setCatalogError(err instanceof Error ? err.message : 'Failed to link catalog');
    } finally {
      setLinkingId(null);
    }
  };

  // ── Catalog: create new ───────────────────────────────────────────────────

  const handleCreateCatalog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatalogName.trim()) return;
    setCatalogCreating(true);
    setCatalogError(null);
    try {
      await createCatalog(businessId, newCatalogName.trim());
      setNewCatalogName('');
      setShowCatalogForm(false);
      await syncFromMeta();
    } catch (err: unknown) {
      setCatalogError(err instanceof Error ? err.message : 'Failed to create catalog');
    } finally {
      setCatalogCreating(false);
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const hasCatalog = !!catalog?.catalogId;

  const selectableCatalogs = availableCatalogs.filter(
    (c) => c.id !== catalog?.catalogId,
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="border-t border-gray-200 pt-6 space-y-3">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
            Product Catalog
          </h2>
          <HealthBadge health={health} />
        </div>
        <div className="flex items-center gap-3">
          {hasCatalog && (
            <a
              href="/inventory"
              className="text-xs font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
            >
              Manage Inventory →
            </a>
          )}
          <button
            onClick={() => void syncFromMeta()}
            disabled={isSyncing}
            className="text-xs font-medium text-green-600 hover:text-green-700 disabled:opacity-40 transition-colors"
          >
            {isSyncing ? 'Syncing…' : hasCatalog ? 'Refresh' : 'Load Catalog'}
          </button>
        </div>
      </div>

      {/* ── Sync error ──────────────────────────────────────────────────── */}
      {syncError && (
        <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {syncError}
        </p>
      )}

      {/* ── Catalog linked ──────────────────────────────────────────────── */}
      {hasCatalog && (
        <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800 truncate">
              {catalog!.catalogName ?? 'Linked Catalog'}
            </p>
            <p className="text-xs text-gray-400 font-mono truncate">
              {catalog!.catalogId}
            </p>
          </div>
          <a
            href="/inventory"
            className="shrink-0 text-xs font-medium text-emerald-600 hover:text-emerald-700 bg-white border border-emerald-200 px-3 py-1.5 rounded-lg transition-colors"
          >
            Manage →
          </a>
        </div>
      )}

      {/* ── No catalog linked: selector + create ────────────────────────── */}
      {!hasCatalog && !isSyncing && (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">
            {catalog
              ? 'No catalog linked to this WABA.'
              : 'No catalog loaded yet. Click "Load Catalog" to sync from Meta.'}
          </p>

          {/* Selector skeleton */}
          {catalogsLoading && (
            <div className="h-8 bg-gray-100 animate-pulse rounded-xl" />
          )}

          {/* Existing catalogs */}
          {!catalogsLoading && selectableCatalogs.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-500">
                Select an existing catalog to link:
              </p>
              {selectableCatalogs.map((cat) => (
                <div
                  key={cat.id}
                  className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {cat.name}
                    </p>
                    <p className="text-xs text-gray-400 font-mono truncate">
                      {cat.id}
                    </p>
                  </div>
                  <button
                    onClick={() => void handleLinkCatalog(cat)}
                    disabled={linkingId === cat.id}
                    className="shrink-0 text-xs font-medium text-green-600 hover:text-green-700 bg-green-50 hover:bg-green-100 px-3 py-1 rounded-lg disabled:opacity-40 transition-colors"
                  >
                    {linkingId === cat.id ? 'Linking…' : 'Link'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {catalogError && (
            <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {catalogError}
            </p>
          )}

          {/* Divider */}
          {selectableCatalogs.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-xs text-gray-400">or</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
          )}

          {/* Create catalog */}
          {!showCatalogForm && (
            <div className="flex items-center justify-between">
              <button
                onClick={() => { setShowCatalogForm(true); setCatalogError(null); }}
                className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
              >
                + Create New Catalog
              </button>
              <a
                href="/inventory"
                className="text-xs font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
              >
                Manage Inventory →
              </a>
            </div>
          )}

          {showCatalogForm && (
            <form
              onSubmit={(e) => void handleCreateCatalog(e)}
              className="flex gap-2 items-end bg-blue-50 border border-blue-200 rounded-xl p-3"
            >
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Catalog name
                </label>
                <input
                  type="text"
                  value={newCatalogName}
                  onChange={(e) => setNewCatalogName(e.target.value)}
                  placeholder="e.g. Summer Collection"
                  autoFocus
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                {catalogError && (
                  <p className="text-xs text-red-500 mt-1">{catalogError}</p>
                )}
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowCatalogForm(false)}
                  className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1.5 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={catalogCreating || !newCatalogName.trim()}
                  className="text-xs font-medium bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
                >
                  {catalogCreating ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

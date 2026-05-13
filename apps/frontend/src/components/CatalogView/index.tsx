import { useState, useEffect, useCallback } from 'react';
import type { IntegrationStatus } from '../../types/integration';
import type { MetaCatalog, CatalogHealth } from '../../catalog-manager/api/catalogManagerApi';
import {
  createCatalog,
  unlinkCatalog,
  checkHealth,
} from '../../catalog-manager/api/catalogManagerApi';
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import { Input } from '../ui/Input';

interface Props {
  businessId: string;
  status: IntegrationStatus;
  activeCatalogId?: string;
  onCatalogLinked?: () => void;
}

// ─── Health badge ──────────────────────────────────────────────────────────────

function HealthBadge({
  health,
  status,
}: {
  health: CatalogHealth | null;
  status: IntegrationStatus;
}) {
  if (!health) return null;

  const warnings = health.warnings ?? [];
  const missingScopes = health.missingScopes ?? [];

  const missingTokenWarning = warnings.some((w) =>
    /no meta access token found|no access token/i.test(w),
  );

  // Hybrid POC guard: setup can be valid at WEBHOOKS_SUBSCRIBED even when
  // health endpoint still reports a transient token warning.
  if (status === 'WEBHOOKS_SUBSCRIBED' && missingTokenWarning) {
    return (
      <Badge variant="ok" title="Connected (WEBHOOKS_SUBSCRIBED)">
        ● Connected
      </Badge>
    );
  }

  const allOk =
    health.appIsValid &&
    missingScopes.length === 0 &&
    health.hasCommerceAccount;

  const hasCritical = !health.appIsValid || missingScopes.length > 0;
  const [showTooltip, setShowTooltip] = useState(false);

  if (allOk) {
    return (
      <Badge variant="ok" title="Meta permissions OK · Commerce Account active">
        ● OK
      </Badge>
    );
  }

  const label = hasCritical ? '● Attention' : '● Commerce';

  const tooltipLines = [
    ...missingScopes.map((s) => `Missing scope: ${s}`),
    ...(!health.hasCommerceAccount
      ? ['No Commerce Account — catalog creation may fail']
      : []),
    ...warnings.slice(0, 2),
  ];

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setShowTooltip((v) => !v)}
        className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${hasCritical ? 'text-danger-text bg-danger-bg' : 'text-caution-text bg-caution-bg'}`}
      >
        {label}
      </button>
      {showTooltip && (
        <div className="absolute left-0 top-6 z-10 bg-surface-raised border border-edge rounded-xl shadow-lg p-3 w-64 space-y-1 text-xs text-content-2">
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
            className="block pt-1 text-notice-text underline"
          >
            Open Commerce Manager →
          </a>
        </div>
      )}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function CatalogView({
  businessId,
  status,
  activeCatalogId,
  onCatalogLinked,
}: Props) {
  // ── Meta sync ─────────────────────────────────────────────────────────────
  const [isSyncing, setIsSyncing]   = useState(false);
  const [syncError, setSyncError]   = useState<string | null>(null);

  // ── System health ─────────────────────────────────────────────────────────
  const [health, setHealth]         = useState<CatalogHealth | null>(null);

  // ── Catalog selector ──────────────────────────────────────────────────────
  const [availableCatalogs, setAvailableCatalogs] = useState<MetaCatalog[]>([]);
  const [catalogsLoading, setCatalogsLoading]     = useState(false);
  const [linkingId, setLinkingId]                 = useState<string | null>(null);
  const [linkedCatalog, setLinkedCatalog]         = useState<MetaCatalog | null>(null);

  // ── Unlink ────────────────────────────────────────────────────────────────
  const [isUnlinking, setIsUnlinking]   = useState(false);
  const [unlinkError, setUnlinkError]   = useState<string | null>(null);

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
      const snap = await getDocs(
        query(
          collection(db, 'catalogs'),
          where('businessId', '==', businessId),
          limit(50),
        ),
      );

      const data = snap.docs.map((d) => {
        const row = d.data() as { catalogId?: string; name?: string };
        return {
          id: row.catalogId ?? d.id,
          name: row.name ?? 'Unnamed Catalog',
        } as MetaCatalog;
      });

      setAvailableCatalogs(data);
    } catch {
      setAvailableCatalogs([]);
    } finally {
      setCatalogsLoading(false);
    }
  }, [businessId]);

  const fetchLinkedCatalog = useCallback(async () => {
    if (!activeCatalogId) {
      setLinkedCatalog(null);
      return;
    }

    const catalogRef = doc(db, 'catalogs', activeCatalogId);
    const snap = await getDoc(catalogRef);
    if (!snap.exists()) {
      setLinkedCatalog({ id: activeCatalogId, name: 'Linked Catalog' });
      return;
    }

    const row = snap.data() as { catalogId?: string; name?: string };
    setLinkedCatalog({
      id: row.catalogId ?? snap.id,
      name: row.name ?? 'Linked Catalog',
    });
  }, [activeCatalogId]);

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    checkHealth(businessId)
      .then(setHealth)
      .catch(() => setHealth(null));
  }, [businessId]);

  useEffect(() => {
    if (!activeCatalogId) {
      void fetchAvailableCatalogs();
    }
  }, [activeCatalogId, fetchAvailableCatalogs]);

  useEffect(() => {
    void fetchLinkedCatalog();
  }, [fetchLinkedCatalog]);

  // ── Catalog: link existing ────────────────────────────────────────────────

  const handleLinkCatalog = async (catalogId: string) => {
    setLinkingId(catalogId);
    setCatalogError(null);
    try {
      const res = await fetch(
        `/api/catalog-manager/catalogs/${encodeURIComponent(catalogId)}/link?businessId=${encodeURIComponent(businessId)}`,
        { method: 'POST' },
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(body.message ?? `Failed to link catalog (HTTP ${res.status})`);
      }

      await syncFromMeta();
      onCatalogLinked?.();
    } catch (err: unknown) {
      setCatalogError(err instanceof Error ? err.message : 'Failed to link catalog');
    } finally {
      setLinkingId(null);
    }
  };

  // ── Catalog: unlink ───────────────────────────────────────────────────────

  const handleUnlinkCatalog = async () => {
    if (
      !confirm(
        'Unlink this catalog from WhatsApp?\n\nThe catalog itself is not deleted — it can be re-linked at any time.',
      )
    )
      return;
    setIsUnlinking(true);
    setUnlinkError(null);
    try {
      await unlinkCatalog(businessId);
      onCatalogLinked?.();
      // Firestore is updated by the backend; onSnapshot propagates to App.tsx
    } catch (err: unknown) {
      setUnlinkError(err instanceof Error ? err.message : 'Failed to unlink catalog');
    } finally {
      setIsUnlinking(false);
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
      onCatalogLinked?.();
    } catch (err: unknown) {
      setCatalogError(err instanceof Error ? err.message : 'Failed to create catalog');
    } finally {
      setCatalogCreating(false);
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const hasCatalog = !!activeCatalogId;

  const selectableCatalogs = availableCatalogs.filter(
    (c) => c.id !== activeCatalogId,
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="border-t border-edge pt-6 space-y-3">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-sm font-semibold text-content-2 uppercase tracking-wide">
            Product Catalog
          </h2>
          <HealthBadge health={health} status={status} />
        </div>
        <div className="flex items-center gap-3">
          {hasCatalog && (
            <a
              href="/inventory"
              className="text-xs font-medium text-brand hover:text-brand-hover transition-colors"
            >
              Manage Inventory →
            </a>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void syncFromMeta()}
            disabled={isSyncing}
          >
            {isSyncing ? 'Syncing…' : hasCatalog ? 'Refresh' : 'Load Catalog'}
          </Button>
        </div>
      </div>

      {/* ── Sync error ──────────────────────────────────────────────────── */}
      {syncError && (
        <p className="text-xs text-danger-text bg-danger-bg border border-danger/40 rounded-lg px-3 py-2">
          {syncError}
        </p>
      )}

      {/* ── Catalog linked ──────────────────────────────────────────────── */}
      {hasCatalog && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between bg-ok-bg border border-ok/40 rounded-xl px-4 py-3 gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-content truncate">
                {linkedCatalog?.name ?? 'Linked Catalog'}
              </p>
              <p className="text-xs text-content-3 font-mono truncate">
                {linkedCatalog?.id ?? activeCatalogId}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <a
                href="/inventory"
                className="text-xs font-medium text-ok-text hover:text-ok-text bg-surface-raised border border-ok/40 px-3 py-1.5 rounded-lg transition-colors"
              >
                Manage →
              </a>
              <Button
                variant="danger"
                size="sm"
                onClick={() => void handleUnlinkCatalog()}
                disabled={isUnlinking}
              >
                {isUnlinking ? 'Unlinking…' : 'Unlink'}
              </Button>
            </div>
          </div>
          {unlinkError && (
            <p className="text-xs text-danger-text bg-danger-bg border border-danger/40 rounded-lg px-3 py-2">
              {unlinkError}
            </p>
          )}
        </div>
      )}

      {/* ── No catalog linked: selector + create ────────────────────────── */}
      {!hasCatalog && !isSyncing && (
        <div className="space-y-3">
          <p className="text-xs text-content-3">
            {linkedCatalog
              ? 'No catalog linked to this integration.'
              : 'No catalog loaded yet. Click "Load Catalog" to sync from Meta.'}
          </p>

          {/* Selector skeleton */}
          {catalogsLoading && (
            <div className="h-8 bg-surface-subtle animate-pulse rounded-xl" />
          )}

          {/* Existing catalogs */}
          {!catalogsLoading && selectableCatalogs.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-content-2">
                Select an existing catalog to link:
              </p>
              {selectableCatalogs.map((cat) => (
                <div
                  key={cat.id}
                  className="flex items-center justify-between bg-surface-subtle border border-edge rounded-xl px-3 py-2 gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-content truncate">
                      {cat.name}
                    </p>
                    <p className="text-xs text-content-3 font-mono truncate">
                      {cat.id}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleLinkCatalog(cat.id)}
                    disabled={linkingId === cat.id}
                    className="shrink-0"
                  >
                    {linkingId === cat.id ? 'Linking…' : 'Link'}
                  </Button>
                </div>
              ))}
            </div>
          )}

          {catalogError && (
            <p className="text-xs text-danger-text bg-danger-bg border border-danger/40 rounded-lg px-3 py-2">
              {catalogError}
            </p>
          )}

          {/* Divider */}
          {selectableCatalogs.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-edge" />
              <span className="text-xs text-content-3">or</span>
              <div className="flex-1 h-px bg-edge" />
            </div>
          )}

          {/* Create catalog */}
          {!showCatalogForm && (
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setShowCatalogForm(true); setCatalogError(null); }}
              >
                + Create New Catalog
              </Button>
              <a
                href="/inventory"
                className="text-xs font-medium text-brand hover:text-brand-hover transition-colors"
              >
                Manage Inventory →
              </a>
            </div>
          )}

          {showCatalogForm && (
            <form
              onSubmit={(e) => void handleCreateCatalog(e)}
              className="flex gap-2 items-end bg-notice-bg border border-notice/40 rounded-xl p-3"
            >
              <div className="flex-1">
                <label className="block text-xs font-medium text-content-2 mb-1">
                  Catalog name
                </label>
                <Input
                  type="text"
                  value={newCatalogName}
                  onChange={(e) => setNewCatalogName(e.target.value)}
                  placeholder="e.g. Summer Collection"
                  autoFocus
                />
                {catalogError && (
                  <p className="text-xs text-danger-text mt-1">{catalogError}</p>
                )}
              </div>
              <div className="flex gap-1.5 shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowCatalogForm(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={catalogCreating || !newCatalogName.trim()}
                >
                  {catalogCreating ? 'Creating…' : 'Create'}
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

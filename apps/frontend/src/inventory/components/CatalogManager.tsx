import { useState } from 'react';
import type { MetaCatalog } from '../../catalog-manager/api/catalogManagerApi';
import {
  createCatalog,
  renameCatalog,
  deleteCatalog,
} from '../../catalog-manager/api/catalogManagerApi';
import type { ToastType } from './Toast';

interface Props {
  businessId: string;
  catalogs: MetaCatalog[];
  isLoading: boolean;
  onRefresh: () => void;
  onViewProducts: (catalog: MetaCatalog) => void;
  onToast: (message: string, type: ToastType) => void;
}

export default function CatalogManager({
  businessId,
  catalogs,
  isLoading,
  onRefresh,
  onViewProducts,
  onToast,
}: Props) {
  // ── Create form ─────────────────────────────────────────────────────────────
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName]               = useState('');
  const [creating, setCreating]             = useState(false);

  // ── Inline rename ────────────────────────────────────────────────────────────
  const [renamingId, setRenamingId]     = useState<string | null>(null);
  const [renameValue, setRenameValue]   = useState('');
  const [renameSaving, setRenameSaving] = useState(false);

  // ── Delete ───────────────────────────────────────────────────────────────────
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── Create ───────────────────────────────────────────────────────────────────

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await createCatalog(businessId, newName.trim());
      setNewName('');
      setShowCreateForm(false);
      onRefresh();
      onToast(`Catalog "${newName.trim()}" created`, 'success');
    } catch (err: unknown) {
      onToast(
        err instanceof Error ? err.message : 'Failed to create catalog',
        'error',
      );
    } finally {
      setCreating(false);
    }
  };

  // ── Rename ───────────────────────────────────────────────────────────────────

  const openRename = (catalog: MetaCatalog) => {
    setRenamingId(catalog.id);
    setRenameValue(catalog.name);
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue('');
  };

  const handleRename = async (catalogId: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    setRenameSaving(true);
    try {
      await renameCatalog(businessId, catalogId, trimmed);
      onRefresh();
      onToast('Catalog renamed', 'success');
    } catch (err: unknown) {
      onToast(
        err instanceof Error ? err.message : 'Failed to rename catalog',
        'error',
      );
    } finally {
      setRenameSaving(false);
      setRenamingId(null);
    }
  };

  // ── Delete ───────────────────────────────────────────────────────────────────

  const handleDelete = async (catalog: MetaCatalog) => {
    if (
      !confirm(
        `Delete catalog "${catalog.name}"?\n\nThis will permanently remove it and all its products from Meta.`,
      )
    )
      return;

    setDeletingId(catalog.id);
    try {
      await deleteCatalog(businessId, catalog.id);
      onRefresh();
      onToast(`Catalog "${catalog.name}" deleted`, 'success');
    } catch (err: unknown) {
      onToast(
        err instanceof Error ? err.message : 'Failed to delete catalog',
        'error',
      );
    } finally {
      setDeletingId(null);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-800">
          Product Catalogs
        </h2>
        <button
          onClick={() => { setShowCreateForm((v) => !v); setNewName(''); }}
          className="text-sm font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
        >
          {showCreateForm ? 'Cancel' : '+ New Catalog'}
        </button>
      </div>

      {/* Create form */}
      {showCreateForm && (
        <form
          onSubmit={(e) => void handleCreate(e)}
          className="flex gap-2 items-end bg-emerald-50 border border-emerald-200 rounded-xl p-3"
        >
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Catalog Name
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Summer Collection"
              autoFocus
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400"
            />
          </div>
          <button
            type="submit"
            disabled={creating || !newName.trim()}
            className="text-sm font-medium bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 disabled:opacity-40 transition-colors"
          >
            {creating ? 'Creating…' : 'Create'}
          </button>
        </form>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-14 bg-gray-100 animate-pulse rounded-xl" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && catalogs.length === 0 && (
        <div className="text-center py-10 text-gray-400">
          <p className="text-sm">No catalogs found in your Business account.</p>
          <p className="text-xs mt-1">Click "+ New Catalog" to create one.</p>
        </div>
      )}

      {/* Catalog list */}
      {!isLoading && catalogs.length > 0 && (
        <ul className="space-y-2">
          {catalogs.map((catalog) => (
            <li
              key={catalog.id}
              className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3"
            >
              {/* Name / rename input */}
              <div className="min-w-0 flex-1">
                {renamingId === catalog.id ? (
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleRename(catalog.id);
                      if (e.key === 'Escape') cancelRename();
                    }}
                    className="w-full text-sm font-semibold border border-emerald-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  />
                ) : (
                  <>
                    <p className="text-sm font-semibold text-gray-800 truncate">
                      {catalog.name}
                    </p>
                    <p className="text-xs text-gray-400 font-mono truncate">
                      {catalog.id}
                    </p>
                  </>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1.5 shrink-0">
                {renamingId === catalog.id ? (
                  <>
                    <button
                      onClick={() => void handleRename(catalog.id)}
                      disabled={renameSaving || !renameValue.trim()}
                      className="text-xs font-medium text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1.5 rounded-lg disabled:opacity-40 transition-colors"
                    >
                      {renameSaving ? '…' : 'Save'}
                    </button>
                    <button
                      onClick={cancelRename}
                      className="text-xs font-medium text-gray-500 hover:text-gray-700 px-2.5 py-1.5 rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => onViewProducts(catalog)}
                      className="text-xs font-medium text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-2.5 py-1.5 rounded-lg transition-colors"
                    >
                      Products →
                    </button>
                    <button
                      onClick={() => openRename(catalog)}
                      title="Rename"
                      className="text-xs font-medium text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 px-2.5 py-1.5 rounded-lg transition-colors"
                    >
                      Rename
                    </button>
                    <button
                      onClick={() => void handleDelete(catalog)}
                      disabled={deletingId === catalog.id}
                      className="text-xs font-medium text-red-500 hover:text-red-600 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-40"
                    >
                      {deletingId === catalog.id ? '…' : 'Delete'}
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Refresh */}
      {!isLoading && (
        <div className="flex justify-end">
          <button
            onClick={onRefresh}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            ↻ Refresh
          </button>
        </div>
      )}
    </div>
  );
}

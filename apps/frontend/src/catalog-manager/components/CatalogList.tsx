import { useState } from 'react';
import type { MetaCatalog } from '../api/catalogManagerApi';
import { createCatalog, deleteCatalog } from '../api/catalogManagerApi';

interface Props {
  businessId: string;
  catalogs: MetaCatalog[];
  isLoading: boolean;
  onRefresh: () => void;
  onViewProducts: (catalog: MetaCatalog) => void;
}

export default function CatalogList({
  businessId,
  catalogs,
  isLoading,
  onRefresh,
  onViewProducts,
}: Props) {
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createCatalog(businessId, newName.trim());
      setNewName('');
      setShowForm(false);
      onRefresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create catalog');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (catalog: MetaCatalog) => {
    if (
      !confirm(
        `Delete catalog "${catalog.name}"?\n\nThis will permanently remove it and all its products from Meta.`,
      )
    )
      return;

    setDeletingId(catalog.id);
    setError(null);
    try {
      await deleteCatalog(businessId, catalog.id);
      onRefresh();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'Failed to delete catalog',
      );
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-800">
          Product Catalogs
        </h2>
        <button
          onClick={() => {
            setShowForm((v) => !v);
            setError(null);
          }}
          className="text-sm font-medium text-green-600 hover:text-green-700 transition-colors"
        >
          {showForm ? 'Cancel' : '+ New Catalog'}
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <form
          onSubmit={(e) => void handleCreate(e)}
          className="flex gap-2 items-end bg-green-50 border border-green-200 rounded-xl p-3"
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
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-400"
              autoFocus
            />
          </div>
          <button
            type="submit"
            disabled={submitting || !newName.trim()}
            className="text-sm font-medium bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:opacity-40 transition-colors"
          >
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </form>
      )}

      {/* Error */}
      {error && (
        <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-14 bg-gray-100 animate-pulse rounded-xl"
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && catalogs.length === 0 && (
        <div className="text-center py-10 text-gray-400">
          <p className="text-sm">No catalogs found in your Business account.</p>
          <p className="text-xs mt-1">
            Click "+ New Catalog" to create one.
          </p>
        </div>
      )}

      {/* Catalog rows */}
      {!isLoading && catalogs.length > 0 && (
        <ul className="space-y-2">
          {catalogs.map((catalog) => (
            <li
              key={catalog.id}
              className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 gap-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-800 truncate">
                  {catalog.name}
                </p>
                <p className="text-xs text-gray-400 font-mono truncate">
                  {catalog.id}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => onViewProducts(catalog)}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors"
                >
                  Products →
                </button>
                <button
                  onClick={() => void handleDelete(catalog)}
                  disabled={deletingId === catalog.id}
                  className="text-xs font-medium text-red-500 hover:text-red-600 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
                >
                  {deletingId === catalog.id ? '…' : 'Delete'}
                </button>
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

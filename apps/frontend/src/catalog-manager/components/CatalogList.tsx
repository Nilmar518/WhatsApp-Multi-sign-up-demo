import { useState } from 'react';
import type { MetaCatalog } from '../api/catalogManagerApi';
import { createCatalog, deleteCatalog } from '../api/catalogManagerApi';
import Button from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';

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
        <h2 className="text-base font-semibold text-content">
          Product Catalogs
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setShowForm((v) => !v);
            setError(null);
          }}
          className="text-ok-text hover:text-ok-text"
        >
          {showForm ? 'Cancel' : '+ New Catalog'}
        </Button>
      </div>

      {/* Create form */}
      {showForm && (
        <form
          onSubmit={(e) => void handleCreate(e)}
          className="flex gap-2 items-end bg-ok-bg border border-ok-bg rounded-xl p-3"
        >
          <div className="flex-1">
            <label className="block text-xs font-medium text-content-2 mb-1">
              Catalog Name
            </label>
            <Input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Summer Collection"
              autoFocus
            />
          </div>
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={submitting || !newName.trim()}
          >
            {submitting ? 'Creating…' : 'Create'}
          </Button>
        </form>
      )}

      {/* Error */}
      {error && (
        <p className="text-xs text-danger-text bg-danger-bg border border-danger-bg rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-14 bg-surface-subtle animate-pulse rounded-xl"
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && catalogs.length === 0 && (
        <div className="text-center py-10 text-content-3">
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
              className="flex items-center justify-between bg-surface-subtle border border-edge rounded-xl px-4 py-3 gap-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-content truncate">
                  {catalog.name}
                </p>
                <p className="text-xs text-content-3 font-mono truncate">
                  {catalog.id}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onViewProducts(catalog)}
                >
                  Products →
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => void handleDelete(catalog)}
                  disabled={deletingId === catalog.id}
                >
                  {deletingId === catalog.id ? '…' : 'Delete'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Refresh */}
      {!isLoading && (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            className="text-content-3 hover:text-content-2"
          >
            ↻ Refresh
          </Button>
        </div>
      )}
    </div>
  );
}

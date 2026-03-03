import { useState } from 'react';
import type { CatalogData } from '../../types/catalog';

interface Props {
  businessId: string;
  catalog: CatalogData | null;
}

export default function CatalogView({ businessId, catalog }: Props) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLoad = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/catalog?businessId=${encodeURIComponent(businessId)}`,
      );
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? `Server error ${res.status}`);
      }
      // Firestore onSnapshot picks up the catalog write — no local state needed
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="border-t border-gray-200 pt-6 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          Product Catalog
        </h2>
        <button
          onClick={() => void handleLoad()}
          disabled={isLoading}
          className="text-xs font-medium text-green-600 hover:text-green-700 disabled:opacity-40 transition-colors"
        >
          {isLoading ? 'Loading…' : catalog ? 'Refresh' : 'Load Catalog'}
        </button>
      </div>

      {/* Empty state */}
      {!catalog && !isLoading && (
        <p className="text-xs text-gray-400">
          No catalog loaded yet. Click "Load Catalog" to fetch from Meta.
        </p>
      )}

      {/* Catalog content */}
      {catalog && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-800">
              {catalog.catalogName}
            </span>
            {catalog.catalogId && (
              <span className="text-xs text-gray-400 font-mono">
                {catalog.catalogId}
              </span>
            )}
          </div>

          {catalog.products.length === 0 ? (
            <p className="text-xs text-gray-400">
              No products found. Add products in Meta Commerce Manager.
            </p>
          ) : (
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {catalog.products.map((product) => (
                <div
                  key={product.id}
                  className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {product.name}
                    </p>
                    {product.retailer_id && (
                      <p className="text-xs text-gray-400">
                        SKU: {product.retailer_id}
                      </p>
                    )}
                  </div>
                  <div className="ml-3 text-right shrink-0">
                    {product.price && (
                      <p className="text-sm font-semibold text-gray-700">
                        {product.currency} {product.price}
                      </p>
                    )}
                    {product.availability && (
                      <span
                        className={`text-xs font-medium ${
                          product.availability === 'in stock'
                            ? 'text-green-600'
                            : 'text-amber-600'
                        }`}
                      >
                        {product.availability}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-gray-400">
            Last synced:{' '}
            {new Date(catalog.fetchedAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
    </div>
  );
}

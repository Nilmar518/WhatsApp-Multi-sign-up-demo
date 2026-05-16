import { useState, useEffect, useCallback } from 'react';
import type {
  MetaCatalog,
  MetaProduct,
  CreateProductPayload,
  UpdateProductPayload,
} from '../../catalog-manager/api/catalogManagerApi';
import {
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  formatPrice,
} from '../../catalog-manager/api/catalogManagerApi';
import type { ToastType } from './Toast';

interface Props {
  businessId: string;
  catalog: MetaCatalog;
  onBack: () => void;
  onToast: (message: string, type: ToastType) => void;
  onManageVariants: (product: MetaProduct) => void;
}

// ─── Product form ──────────────────────────────────────────────────────────────

interface ProductFormValues {
  retailerId: string;
  name: string;
  description: string;
  availability: string;
  condition: string;
  priceDecimal: string;
  currency: string;
  imageUrl: string;
  url: string;
}

const EMPTY_FORM: ProductFormValues = {
  retailerId: '',
  name: '',
  description: '',
  availability: 'in stock',
  condition: 'new',
  priceDecimal: '',
  currency: 'USD',
  imageUrl: '',
  url: '',
};

const AVAILABILITY_OPTIONS = [
  'in stock',
  'out of stock',
  'preorder',
  'available for order',
  'discontinued',
] as const;

const CONDITION_OPTIONS = ['new', 'refurbished', 'used'] as const;

// ─── Product card ──────────────────────────────────────────────────────────────

function ProductCard({
  product,
  onEdit,
  onDelete,
  onManageVariants,
  isDeleting,
}: {
  product: MetaProduct;
  onEdit: () => void;
  onDelete: () => void;
  onManageVariants: () => void;
  isDeleting: boolean;
}) {
  const [imgError, setImgError] = useState(false);

  return (
    <div className="group bg-surface-raised border border-edge rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      {/* Thumbnail */}
      <div className="relative bg-surface-subtle aspect-square flex items-center justify-center overflow-hidden">
        {product.image_url && !imgError ? (
          <img
            src={product.image_url}
            alt={product.name}
            onError={() => setImgError(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <svg
            className="w-10 h-10 text-content-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007z"
            />
          </svg>
        )}

        {/* Hover actions overlay */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          <button
            onClick={onEdit}
            className="text-xs font-medium bg-surface-raised text-content px-3 py-1.5 rounded-lg hover:bg-surface-subtle transition-colors"
          >
            Edit
          </button>
          <button
            onClick={onManageVariants}
            className="text-xs font-medium bg-violet-500 text-white px-3 py-1.5 rounded-lg hover:bg-violet-600 transition-colors"
          >
            Variants
          </button>
          <button
            onClick={onDelete}
            disabled={isDeleting}
            className="text-xs font-medium bg-red-500 text-white px-3 py-1.5 rounded-lg hover:bg-red-600 disabled:opacity-40 transition-colors"
          >
            {isDeleting ? '…' : 'Delete'}
          </button>
        </div>
      </div>

      {/* Info */}
      <div className="p-3 space-y-1">
        <p className="text-sm font-semibold text-content truncate" title={product.name}>
          {product.name}
        </p>
        <div className="flex items-center justify-between gap-1">
          <span className="text-sm font-medium text-content-2">
            {formatPrice(product.price, product.currency)}
          </span>
          {product.availability && (
            <span
              className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
                product.availability === 'in stock'
                  ? 'bg-green-100 text-green-700'
                  : product.availability === 'out of stock'
                    ? 'bg-red-100 text-red-600'
                    : 'bg-amber-100 text-amber-700'
              }`}
            >
              {product.availability === 'in stock'
                ? 'In Stock'
                : product.availability === 'out of stock'
                  ? 'Out of Stock'
                  : product.availability}
            </span>
          )}
        </div>
        {product.retailer_id && (
          <p className="text-xs text-content-3 font-mono truncate">
            {product.retailer_id}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Skeleton card ─────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="bg-surface-raised border border-edge rounded-xl overflow-hidden">
      <div className="aspect-square bg-surface-subtle animate-pulse" />
      <div className="p-3 space-y-2">
        <div className="h-4 bg-surface-subtle animate-pulse rounded" />
        <div className="h-3 bg-surface-subtle animate-pulse rounded w-2/3" />
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function ProductManager({
  businessId,
  catalog,
  onBack,
  onToast,
  onManageVariants,
}: Props) {
  const [products, setProducts]     = useState<MetaProduct[]>([]);
  const [loading, setLoading]       = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Form state
  const [showForm, setShowForm]         = useState(false);
  const [editingProduct, setEditingProduct] = useState<MetaProduct | null>(null);
  const [form, setForm]                 = useState<ProductFormValues>(EMPTY_FORM);
  const [submitting, setSubmitting]     = useState(false);
  const [formError, setFormError]       = useState<string | null>(null);

  // ── Fetch ────────────────────────────────────────────────────────────────────

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listProducts(businessId, catalog.id);
      setProducts(data);
    } catch (err: unknown) {
      onToast(
        err instanceof Error ? err.message : 'Failed to load products',
        'error',
      );
    } finally {
      setLoading(false);
    }
  }, [businessId, catalog.id, onToast]);

  useEffect(() => {
    void fetchProducts();
  }, [fetchProducts]);

  // ── Form helpers ─────────────────────────────────────────────────────────────

  const updateField = (key: keyof ProductFormValues, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const openCreate = () => {
    setEditingProduct(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  };

  const openEdit = (product: MetaProduct) => {
    setEditingProduct(product);
    const priceMinor = product.price ? parseInt(product.price, 10) : 0;
    setForm({
      retailerId:   product.retailer_id ?? '',
      name:         product.name,
      description:  product.description ?? '',
      availability: product.availability ?? 'in stock',
      condition:    product.condition ?? 'new',
      priceDecimal: product.price ? (priceMinor / 100).toFixed(2) : '',
      currency:     product.currency ?? 'USD',
      imageUrl:     product.image_url ?? '',
      url:          product.url ?? '',
    });
    setFormError(null);
    setShowForm(true);
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingProduct(null);
    setForm(EMPTY_FORM);
    setFormError(null);
  };

  // ── Submit ───────────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const priceMinor = Math.round(parseFloat(form.priceDecimal) * 100);
    if (isNaN(priceMinor) || priceMinor <= 0) {
      setFormError('Please enter a valid price (e.g. 10.00)');
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      if (editingProduct) {
        const payload: UpdateProductPayload = {
          businessId,
          name:         form.name,
          description:  form.description,
          availability: form.availability,
          condition:    form.condition,
          price:        priceMinor,
          currency:     form.currency,
          imageUrl:     form.imageUrl,
          url:          form.url,
        };
        await updateProduct(catalog.id, editingProduct.id, payload);
        onToast(`"${form.name}" updated`, 'success');
      } else {
        const payload: CreateProductPayload = {
          businessId,
          retailerId:   form.retailerId,
          name:         form.name,
          description:  form.description,
          availability: form.availability,
          condition:    form.condition,
          price:        priceMinor,
          currency:     form.currency,
          imageUrl:     form.imageUrl,
          url:          form.url,
        };
        await createProduct(catalog.id, payload);
        onToast(`"${form.name}" added`, 'success');
      }
      cancelForm();
      void fetchProducts();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Operation failed';
      setFormError(msg);
      onToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Delete ───────────────────────────────────────────────────────────────────

  const handleDelete = async (product: MetaProduct) => {
    if (
      !confirm(`Delete "${product.name}"?\n\nThis is permanent and cannot be undone.`)
    )
      return;

    setDeletingId(product.id);
    try {
      await deleteProduct(businessId, catalog.id, product.id);
      setProducts((prev) => prev.filter((p) => p.id !== product.id));
      onToast(`"${product.name}" deleted`, 'success');
    } catch (err: unknown) {
      onToast(
        err instanceof Error ? err.message : 'Failed to delete product',
        'error',
      );
    } finally {
      setDeletingId(null);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-sm font-medium text-content-2 hover:text-content transition-colors"
          >
            ← Catalogs
          </button>
          <span className="text-content-3">|</span>
          <h2 className="text-base font-semibold text-content truncate max-w-xs">
            {catalog.name}
          </h2>
        </div>
        {!showForm && (
          <button
            onClick={openCreate}
            className="text-sm font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
          >
            + New Product
          </button>
        )}
      </div>

      {/* Inline product form */}
      {showForm && (
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-blue-800">
              {editingProduct ? 'Edit Product' : 'New Product'}
            </h3>
            <button
              type="button"
              onClick={cancelForm}
              className="text-xs text-content-2 hover:text-content transition-colors"
            >
              Cancel
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* SKU — read-only on edit */}
            <div>
              <label className="block text-xs font-medium text-content-2 mb-1">
                SKU / Retailer ID <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={form.retailerId}
                onChange={(e) => updateField('retailerId', e.target.value)}
                placeholder="e.g. SHIRT-RED-M"
                disabled={!!editingProduct}
                required={!editingProduct}
                className="w-full text-sm border border-edge rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-surface-subtle disabled:text-content-3"
              />
            </div>

            {/* Name */}
            <div>
              <label className="block text-xs font-medium text-content-2 mb-1">
                Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => updateField('name', e.target.value)}
                placeholder="e.g. Red Cotton T-Shirt"
                required
                className="w-full text-sm border border-edge rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>

            {/* Description */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-content-2 mb-1">
                Description <span className="text-red-400">*</span>
              </label>
              <textarea
                value={form.description}
                onChange={(e) => updateField('description', e.target.value)}
                placeholder="Short product description"
                required
                rows={2}
                className="w-full text-sm border border-edge rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
              />
            </div>

            {/* Price */}
            <div>
              <label className="block text-xs font-medium text-content-2 mb-1">
                Price <span className="text-red-400">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={form.priceDecimal}
                onChange={(e) => updateField('priceDecimal', e.target.value)}
                placeholder="10.00"
                required
                className="w-full text-sm border border-edge rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>

            {/* Currency */}
            <div>
              <label className="block text-xs font-medium text-content-2 mb-1">
                Currency <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={form.currency}
                onChange={(e) =>
                  updateField('currency', e.target.value.toUpperCase())
                }
                placeholder="USD"
                maxLength={3}
                required
                className="w-full text-sm border border-edge rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 uppercase"
              />
            </div>

            {/* Availability */}
            <div>
              <label className="block text-xs font-medium text-content-2 mb-1">
                Availability <span className="text-red-400">*</span>
              </label>
              <select
                value={form.availability}
                onChange={(e) => updateField('availability', e.target.value)}
                className="w-full text-sm border border-edge rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                {AVAILABILITY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            {/* Condition */}
            <div>
              <label className="block text-xs font-medium text-content-2 mb-1">
                Condition <span className="text-red-400">*</span>
              </label>
              <select
                value={form.condition}
                onChange={(e) => updateField('condition', e.target.value)}
                className="w-full text-sm border border-edge rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                {CONDITION_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            {/* Image URL */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-content-2 mb-1">
                Image URL <span className="text-red-400">*</span>
              </label>
              <input
                type="url"
                value={form.imageUrl}
                onChange={(e) => updateField('imageUrl', e.target.value)}
                placeholder="https://example.com/image.jpg"
                required
                className="w-full text-sm border border-edge rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>

            {/* Product URL */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-content-2 mb-1">
                Product Page URL <span className="text-red-400">*</span>
              </label>
              <input
                type="url"
                value={form.url}
                onChange={(e) => updateField('url', e.target.value)}
                placeholder="https://example.com/products/item"
                required
                className="w-full text-sm border border-edge rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </div>

          {formError && (
            <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {formError}
            </p>
          )}

          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={cancelForm}
              className="text-sm font-medium text-content-2 hover:text-content px-4 py-2 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="text-sm font-medium bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              {submitting
                ? editingProduct ? 'Saving…' : 'Creating…'
                : editingProduct ? 'Save Changes' : 'Create Product'}
            </button>
          </div>
        </form>
      )}

      {/* Loading skeleton grid */}
      {loading && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && products.length === 0 && (
        <div className="text-center py-10 text-content-3">
          <svg
            className="w-10 h-10 mx-auto mb-3 text-content-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007z"
            />
          </svg>
          <p className="text-sm">No products in this catalog yet.</p>
          <p className="text-xs mt-1">Click "+ New Product" to add the first one.</p>
        </div>
      )}

      {/* Product grid */}
      {!loading && products.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              onEdit={() => openEdit(product)}
              onDelete={() => void handleDelete(product)}
              onManageVariants={() => onManageVariants(product)}
              isDeleting={deletingId === product.id}
            />
          ))}
        </div>
      )}

      {/* Footer */}
      {!loading && (
        <div className="flex justify-between items-center pt-1">
          <p className="text-xs text-content-3">
            {products.length} product{products.length !== 1 ? 's' : ''}
          </p>
          <button
            onClick={() => void fetchProducts()}
            className="text-xs text-content-3 hover:text-content-2 transition-colors"
          >
            ↻ Refresh
          </button>
        </div>
      )}
    </div>
  );
}

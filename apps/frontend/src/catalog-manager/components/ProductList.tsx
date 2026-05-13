import { useState } from 'react';
import type {
  MetaProduct,
  CreateProductPayload,
  UpdateProductPayload,
} from '../api/catalogManagerApi';
import {
  createProduct,
  updateProduct,
  deleteProduct,
  formatPrice,
} from '../api/catalogManagerApi';
import Button from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';

const AVAILABILITY_OPTIONS = [
  'in stock',
  'out of stock',
  'preorder',
  'available for order',
  'discontinued',
] as const;

const CONDITION_OPTIONS = ['new', 'refurbished', 'used'] as const;

interface ProductFormValues {
  retailerId: string;
  name: string;
  description: string;
  availability: string;
  condition: string;
  priceDecimal: string; // user-friendly decimal input e.g. "10.00"
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

interface Props {
  businessId: string;
  catalogId: string;
  catalogName: string;
  products: MetaProduct[];
  isLoading: boolean;
  onRefresh: () => void;
  onBack: () => void;
}

export default function ProductList({
  businessId,
  catalogId,
  catalogName,
  products,
  isLoading,
  onRefresh,
  onBack,
}: Props) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<MetaProduct | null>(null);
  const [form, setForm] = useState<ProductFormValues>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const updateField = (key: keyof ProductFormValues, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const openCreate = () => {
    setEditingProduct(null);
    setForm(EMPTY_FORM);
    setError(null);
    setShowCreateForm(true);
  };

  const openEdit = (product: MetaProduct) => {
    setEditingProduct(product);
    const priceMinor = product.price ? parseInt(product.price, 10) : 0;
    setForm({
      retailerId: product.retailer_id ?? '',
      name: product.name,
      description: product.description ?? '',
      availability: product.availability ?? 'in stock',
      condition: product.condition ?? 'new',
      priceDecimal: product.price ? (priceMinor / 100).toFixed(2) : '',
      currency: product.currency ?? 'USD',
      imageUrl: product.image_url ?? '',
      url: product.url ?? '',
    });
    setShowCreateForm(true);
    setError(null);
  };

  const cancelForm = () => {
    setShowCreateForm(false);
    setEditingProduct(null);
    setForm(EMPTY_FORM);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const priceMinor = Math.round(parseFloat(form.priceDecimal) * 100);
    if (isNaN(priceMinor) || priceMinor <= 0) {
      setError('Please enter a valid price (e.g. 10.00)');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      if (editingProduct) {
        const payload: UpdateProductPayload = {
          businessId,
          name: form.name,
          description: form.description,
          availability: form.availability,
          condition: form.condition,
          price: priceMinor,
          currency: form.currency,
          imageUrl: form.imageUrl,
          url: form.url,
        };
        await updateProduct(catalogId, editingProduct.id, payload);
      } else {
        const payload: CreateProductPayload = {
          businessId,
          retailerId: form.retailerId,
          name: form.name,
          description: form.description,
          availability: form.availability,
          condition: form.condition,
          price: priceMinor,
          currency: form.currency,
          imageUrl: form.imageUrl,
          url: form.url,
        };
        await createProduct(catalogId, payload);
      }

      cancelForm();
      onRefresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Operation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (product: MetaProduct) => {
    if (
      !confirm(
        `Delete product "${product.name}"?\n\nThis is permanent and cannot be undone.`,
      )
    )
      return;

    setDeletingId(product.id);
    setError(null);
    try {
      await deleteProduct(businessId, catalogId, product.id);
      onRefresh();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'Failed to delete product',
      );
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="text-content-2 hover:text-content"
          >
            ← Catalogs
          </Button>
          <span className="text-content-3">|</span>
          <h2 className="text-base font-semibold text-content truncate max-w-xs">
            {catalogName}
          </h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={openCreate}
          className="text-ok-text hover:text-ok-text"
        >
          + New Product
        </Button>
      </div>

      {/* Create / Edit form */}
      {showCreateForm && (
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="bg-notice-bg border border-notice/40 rounded-xl p-4 space-y-3"
        >
          <h3 className="text-sm font-semibold text-notice-text">
            {editingProduct ? 'Edit Product' : 'New Product'}
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Retailer ID (SKU) — read-only when editing */}
            <div>
              <label className="block text-xs font-medium text-content-2 mb-1">
                SKU / Retailer ID <span className="text-danger-text">*</span>
              </label>
              <Input
                type="text"
                value={form.retailerId}
                onChange={(e) => updateField('retailerId', e.target.value)}
                placeholder="e.g. SHIRT-RED-M"
                disabled={!!editingProduct}
                required={!editingProduct}
              />
              {editingProduct && (
                <p className="text-xs text-content-3 mt-1">
                  SKU cannot be changed after creation.
                </p>
              )}
            </div>

            {/* Name */}
            <div>
              <label className="block text-xs font-medium text-content-2 mb-1">
                Name <span className="text-danger-text">*</span>
              </label>
              <Input
                type="text"
                value={form.name}
                onChange={(e) => updateField('name', e.target.value)}
                placeholder="e.g. Red Cotton T-Shirt"
                required
              />
            </div>

            {/* Description */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-content-2 mb-1">
                Description <span className="text-danger-text">*</span>
              </label>
              <textarea
                value={form.description}
                onChange={(e) => updateField('description', e.target.value)}
                placeholder="Short product description"
                required
                rows={2}
                className="w-full text-sm border border-edge rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/20 resize-none bg-surface-raised text-content placeholder:text-content-3"
              />
            </div>

            {/* Availability */}
            <div>
              <label className="block text-xs font-medium text-content-2 mb-1">
                Availability <span className="text-danger-text">*</span>
              </label>
              <select
                value={form.availability}
                onChange={(e) => updateField('availability', e.target.value)}
                className="w-full text-sm border border-edge rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/20 bg-surface-raised text-content"
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
                Condition <span className="text-danger-text">*</span>
              </label>
              <select
                value={form.condition}
                onChange={(e) => updateField('condition', e.target.value)}
                className="w-full text-sm border border-edge rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/20 bg-surface-raised text-content"
              >
                {CONDITION_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            {/* Price */}
            <div>
              <label className="block text-xs font-medium text-content-2 mb-1">
                Price <span className="text-danger-text">*</span>
              </label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={form.priceDecimal}
                onChange={(e) => updateField('priceDecimal', e.target.value)}
                placeholder="10.00"
                required
              />
            </div>

            {/* Currency */}
            <div>
              <label className="block text-xs font-medium text-content-2 mb-1">
                Currency <span className="text-danger-text">*</span>
              </label>
              <Input
                type="text"
                value={form.currency}
                onChange={(e) =>
                  updateField('currency', e.target.value.toUpperCase())
                }
                placeholder="USD"
                maxLength={3}
                required
                className="uppercase"
              />
            </div>

            {/* Image URL */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-content-2 mb-1">
                Image URL <span className="text-danger-text">*</span>
              </label>
              <Input
                type="url"
                value={form.imageUrl}
                onChange={(e) => updateField('imageUrl', e.target.value)}
                placeholder="https://example.com/image.jpg"
                required
              />
            </div>

            {/* Product URL */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-content-2 mb-1">
                Product Page URL <span className="text-danger-text">*</span>
              </label>
              <Input
                type="url"
                value={form.url}
                onChange={(e) => updateField('url', e.target.value)}
                placeholder="https://example.com/products/shirt"
                required
              />
            </div>
          </div>

          {error && (
            <p className="text-xs text-danger-text bg-danger-bg border border-danger-bg rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={cancelForm}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={submitting}
            >
              {submitting
                ? editingProduct
                  ? 'Saving…'
                  : 'Creating…'
                : editingProduct
                  ? 'Save Changes'
                  : 'Create Product'}
            </Button>
          </div>
        </form>
      )}

      {/* Top-level error (outside form) */}
      {!showCreateForm && error && (
        <p className="text-xs text-danger-text bg-danger-bg border border-danger-bg rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 bg-surface-subtle animate-pulse rounded-xl"
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && products.length === 0 && (
        <div className="text-center py-10 text-content-3">
          <p className="text-sm">No products in this catalog yet.</p>
          <p className="text-xs mt-1">
            Click "+ New Product" to add the first one.
          </p>
        </div>
      )}

      {/* Product table */}
      {!isLoading && products.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-content-2 uppercase tracking-wide border-b border-edge">
                <th className="pb-2 pr-4">Name</th>
                <th className="pb-2 pr-4">SKU</th>
                <th className="pb-2 pr-4">Price</th>
                <th className="pb-2 pr-4">Availability</th>
                <th className="pb-2 pr-4">Condition</th>
                <th className="pb-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {products.map((product) => (
                <tr key={product.id} className="hover:bg-surface-subtle transition-colors">
                  <td className="py-3 pr-4 font-medium text-content max-w-[180px] truncate">
                    {product.name}
                  </td>
                  <td className="py-3 pr-4 text-content-2 font-mono text-xs">
                    {product.retailer_id ?? '—'}
                  </td>
                  <td className="py-3 pr-4 text-content">
                    {formatPrice(product.price, product.currency)}
                  </td>
                  <td className="py-3 pr-4">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        product.availability === 'in stock'
                          ? 'bg-ok-bg text-ok-text'
                          : product.availability === 'out of stock'
                            ? 'bg-danger-bg text-danger-text'
                            : 'bg-caution-bg text-caution-text'
                      }`}
                    >
                      {product.availability ?? '—'}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-content-2 capitalize">
                    {product.condition ?? '—'}
                  </td>
                  <td className="py-3 text-right">
                    <div className="flex gap-2 justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEdit(product)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => void handleDelete(product)}
                        disabled={deletingId === product.id}
                      >
                        {deletingId === product.id ? '…' : 'Delete'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

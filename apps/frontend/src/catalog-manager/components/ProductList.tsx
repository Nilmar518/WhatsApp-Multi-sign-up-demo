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
          <button
            onClick={onBack}
            className="text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
          >
            ← Catalogs
          </button>
          <span className="text-gray-300">|</span>
          <h2 className="text-base font-semibold text-gray-800 truncate max-w-xs">
            {catalogName}
          </h2>
        </div>
        <button
          onClick={openCreate}
          className="text-sm font-medium text-green-600 hover:text-green-700 transition-colors"
        >
          + New Product
        </button>
      </div>

      {/* Create / Edit form */}
      {showCreateForm && (
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3"
        >
          <h3 className="text-sm font-semibold text-blue-800">
            {editingProduct ? 'Edit Product' : 'New Product'}
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Retailer ID (SKU) — read-only when editing */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                SKU / Retailer ID <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={form.retailerId}
                onChange={(e) => updateField('retailerId', e.target.value)}
                placeholder="e.g. SHIRT-RED-M"
                disabled={!!editingProduct}
                required={!editingProduct}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100 disabled:text-gray-400"
              />
              {editingProduct && (
                <p className="text-xs text-gray-400 mt-1">
                  SKU cannot be changed after creation.
                </p>
              )}
            </div>

            {/* Name */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => updateField('name', e.target.value)}
                placeholder="e.g. Red Cotton T-Shirt"
                required
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>

            {/* Description */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Description <span className="text-red-400">*</span>
              </label>
              <textarea
                value={form.description}
                onChange={(e) => updateField('description', e.target.value)}
                placeholder="Short product description"
                required
                rows={2}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
              />
            </div>

            {/* Availability */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Availability <span className="text-red-400">*</span>
              </label>
              <select
                value={form.availability}
                onChange={(e) => updateField('availability', e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
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
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Condition <span className="text-red-400">*</span>
              </label>
              <select
                value={form.condition}
                onChange={(e) => updateField('condition', e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
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
              <label className="block text-xs font-medium text-gray-600 mb-1">
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
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>

            {/* Currency */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
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
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 uppercase"
              />
            </div>

            {/* Image URL */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Image URL <span className="text-red-400">*</span>
              </label>
              <input
                type="url"
                value={form.imageUrl}
                onChange={(e) => updateField('imageUrl', e.target.value)}
                placeholder="https://example.com/image.jpg"
                required
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>

            {/* Product URL */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Product Page URL <span className="text-red-400">*</span>
              </label>
              <input
                type="url"
                value={form.url}
                onChange={(e) => updateField('url', e.target.value)}
                placeholder="https://example.com/products/shirt"
                required
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={cancelForm}
              className="text-sm font-medium text-gray-600 hover:text-gray-800 px-4 py-2 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="text-sm font-medium bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              {submitting
                ? editingProduct
                  ? 'Saving…'
                  : 'Creating…'
                : editingProduct
                  ? 'Save Changes'
                  : 'Create Product'}
            </button>
          </div>
        </form>
      )}

      {/* Top-level error (outside form) */}
      {!showCreateForm && error && (
        <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 bg-gray-100 animate-pulse rounded-xl"
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && products.length === 0 && (
        <div className="text-center py-10 text-gray-400">
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
              <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-200">
                <th className="pb-2 pr-4">Name</th>
                <th className="pb-2 pr-4">SKU</th>
                <th className="pb-2 pr-4">Price</th>
                <th className="pb-2 pr-4">Availability</th>
                <th className="pb-2 pr-4">Condition</th>
                <th className="pb-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {products.map((product) => (
                <tr key={product.id} className="hover:bg-gray-50 transition-colors">
                  <td className="py-3 pr-4 font-medium text-gray-800 max-w-[180px] truncate">
                    {product.name}
                  </td>
                  <td className="py-3 pr-4 text-gray-500 font-mono text-xs">
                    {product.retailer_id ?? '—'}
                  </td>
                  <td className="py-3 pr-4 text-gray-700">
                    {formatPrice(product.price, product.currency)}
                  </td>
                  <td className="py-3 pr-4">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        product.availability === 'in stock'
                          ? 'bg-green-100 text-green-700'
                          : product.availability === 'out of stock'
                            ? 'bg-red-100 text-red-600'
                            : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {product.availability ?? '—'}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-gray-500 capitalize">
                    {product.condition ?? '—'}
                  </td>
                  <td className="py-3 text-right">
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => openEdit(product)}
                        className="text-xs font-medium text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded-lg transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => void handleDelete(product)}
                        disabled={deletingId === product.id}
                        className="text-xs font-medium text-red-500 hover:text-red-600 bg-red-50 hover:bg-red-100 px-2 py-1 rounded-lg transition-colors disabled:opacity-40"
                      >
                        {deletingId === product.id ? '…' : 'Delete'}
                      </button>
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

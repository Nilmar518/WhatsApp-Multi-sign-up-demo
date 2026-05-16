import { useState, useEffect, useCallback } from 'react';
import type { MetaCatalog, MetaProduct } from '../../catalog-manager/api/catalogManagerApi';
import { listProducts } from '../../catalog-manager/api/catalogManagerApi';
import type { AutoReply, MatchType } from '../api/autoReplyApi';
import {
  listRules,
  createRule,
  updateRule,
  deleteRule,
} from '../api/autoReplyApi';
import type { ToastType } from './Toast';

// ─── Icons ────────────────────────────────────────────────────────────────────

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-3.5 h-3.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-3.5 h-3.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  businessId: string;
  catalogs: MetaCatalog[];
  onToast: (message: string, type: ToastType) => void;
}

// ─── Form state ───────────────────────────────────────────────────────────────

interface FormState {
  triggerWord: string;
  matchType: MatchType;
  collectionTitle: string;
  retailerIds: string[];
  isActive: boolean;
}

const EMPTY_FORM: FormState = {
  triggerWord: '',
  matchType: 'EXACT',
  collectionTitle: '',
  retailerIds: [],
  isActive: true,
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function AutoReplyManager({ businessId, catalogs, onToast }: Props) {
  // ── Rules list ──────────────────────────────────────────────────────────────
  const [rules, setRules]       = useState<AutoReply[]>([]);
  const [loading, setLoading]   = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── Modal ───────────────────────────────────────────────────────────────────
  const [showModal, setShowModal]     = useState(false);
  const [editingRule, setEditingRule] = useState<AutoReply | null>(null);
  const [saving, setSaving]           = useState(false);
  const [form, setForm]               = useState<FormState>(EMPTY_FORM);

  // ── Product selector ────────────────────────────────────────────────────────
  const [selectorCatalogId, setSelectorCatalogId] = useState('');
  const [products, setProducts]                   = useState<MetaProduct[]>([]);
  const [productsLoading, setProductsLoading]     = useState(false);
  const [productSearch, setProductSearch]         = useState('');

  // ── Fetch rules ─────────────────────────────────────────────────────────────

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listRules(businessId);
      setRules(data);
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : 'Failed to load rules', 'error');
    } finally {
      setLoading(false);
    }
  }, [businessId, onToast]);

  useEffect(() => {
    setRules([]);
    void fetchRules();
  }, [fetchRules]);

  // ── Product selector: fetch when catalog changes ─────────────────────────────

  useEffect(() => {
    if (!showModal || !selectorCatalogId) {
      setProducts([]);
      return;
    }
    let cancelled = false;
    setProductsLoading(true);
    listProducts(businessId, selectorCatalogId)
      .then((data) => { if (!cancelled) setProducts(data); })
      .catch((err: unknown) => {
        if (!cancelled)
          onToast(err instanceof Error ? err.message : 'Failed to load products', 'error');
      })
      .finally(() => { if (!cancelled) setProductsLoading(false); });
    return () => { cancelled = true; };
  }, [showModal, selectorCatalogId, businessId, onToast]);

  // Default catalog selector to first available catalog when modal opens
  useEffect(() => {
    if (showModal && catalogs.length > 0 && !selectorCatalogId) {
      setSelectorCatalogId(catalogs[0].id);
    }
  }, [showModal, catalogs, selectorCatalogId]);

  // ── Modal helpers ───────────────────────────────────────────────────────────

  const openCreate = () => {
    setEditingRule(null);
    setForm(EMPTY_FORM);
    setProductSearch('');
    setSelectorCatalogId(catalogs[0]?.id ?? '');
    setShowModal(true);
  };

  const openEdit = (rule: AutoReply) => {
    setEditingRule(rule);
    setForm({
      triggerWord:     rule.triggerWord,
      matchType:       rule.matchType,
      collectionTitle: rule.collectionTitle,
      retailerIds:     [...rule.retailerIds],
      isActive:        rule.isActive,
    });
    setProductSearch('');
    setSelectorCatalogId(catalogs[0]?.id ?? '');
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingRule(null);
    setForm(EMPTY_FORM);
    setProducts([]);
    setProductSearch('');
    setSelectorCatalogId('');
  };

  // ── Form field helper ───────────────────────────────────────────────────────

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // ── Product toggle ──────────────────────────────────────────────────────────

  const toggleProduct = (retailerId: string) => {
    setForm((prev) => ({
      ...prev,
      retailerIds: prev.retailerIds.includes(retailerId)
        ? prev.retailerIds.filter((id) => id !== retailerId)
        : [...prev.retailerIds, retailerId],
    }));
  };

  // ── Save ────────────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.triggerWord.trim()) { onToast('Trigger word is required', 'error'); return; }
    if (!form.collectionTitle.trim()) { onToast('Collection title is required', 'error'); return; }
    if (form.retailerIds.length === 0) { onToast('Select at least one product', 'error'); return; }

    setSaving(true);
    try {
      if (editingRule) {
        const updated = await updateRule(editingRule.id, {
          businessId,
          triggerWord:     form.triggerWord.trim(),
          matchType:       form.matchType,
          collectionTitle: form.collectionTitle.trim(),
          retailerIds:     form.retailerIds,
          isActive:        form.isActive,
        });
        setRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
        onToast('Rule updated', 'success');
      } else {
        const created = await createRule({
          businessId,
          triggerWord:     form.triggerWord.trim(),
          matchType:       form.matchType,
          collectionTitle: form.collectionTitle.trim(),
          retailerIds:     form.retailerIds,
          isActive:        form.isActive,
        });
        setRules((prev) => [...prev, created]);
        onToast(`Rule "${created.triggerWord}" created`, 'success');
      }
      closeModal();
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : 'Failed to save rule', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Toggle active (optimistic) ──────────────────────────────────────────────

  const handleToggle = async (rule: AutoReply) => {
    const next = !rule.isActive;
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, isActive: next } : r)));
    try {
      await updateRule(rule.id, { businessId, isActive: next });
    } catch (err: unknown) {
      // Revert
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, isActive: rule.isActive } : r)));
      onToast(err instanceof Error ? err.message : 'Failed to update rule', 'error');
    }
  };

  // ── Delete (optimistic) ─────────────────────────────────────────────────────

  const handleDelete = async (rule: AutoReply) => {
    if (!confirm(`Delete rule for "${rule.triggerWord}"?`)) return;
    setDeletingId(rule.id);
    setRules((prev) => prev.filter((r) => r.id !== rule.id));
    try {
      await deleteRule(businessId, rule.id);
      onToast('Rule deleted', 'success');
    } catch (err: unknown) {
      setRules((prev) => [...prev, rule]); // Revert
      onToast(err instanceof Error ? err.message : 'Failed to delete rule', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  // ── Filtered products ───────────────────────────────────────────────────────

  const filteredProducts = productSearch.trim()
    ? products.filter(
        (p) =>
          p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
          (p.retailer_id ?? '').toLowerCase().includes(productSearch.toLowerCase()),
      )
    : products;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-content">Keyword Triggers</h2>
          <p className="text-xs text-content-3 mt-0.5">
            Auto-reply with product collections when a keyword is matched.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="text-sm font-medium bg-brand text-white px-3.5 py-2 rounded-lg hover:bg-brand-hover transition-colors"
        >
          + New Rule
        </button>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-surface-subtle animate-pulse rounded-xl" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && rules.length === 0 && (
        <div className="text-center py-12 text-content-3">
          <div className="text-3xl mb-2">⚡</div>
          <p className="text-sm font-medium">No keyword triggers yet.</p>
          <p className="text-xs mt-1">
            Create a rule to auto-reply with products when a keyword is received.
          </p>
        </div>
      )}

      {/* Rules table */}
      {!loading && rules.length > 0 && (
        <div className="overflow-hidden border border-edge rounded-xl">
          <table className="w-full text-sm">
            <thead className="bg-surface-subtle border-b border-edge">
              <tr>
                <th className="text-left text-xs font-semibold text-content-2 px-4 py-2.5">
                  Trigger Word
                </th>
                <th className="text-left text-xs font-semibold text-content-2 px-4 py-2.5">
                  Collection
                </th>
                <th className="text-left text-xs font-semibold text-content-2 px-4 py-2.5">
                  Products
                </th>
                <th className="text-left text-xs font-semibold text-content-2 px-4 py-2.5">
                  Active
                </th>
                <th className="text-right text-xs font-semibold text-content-2 px-4 py-2.5">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rules.map((rule) => (
                <tr key={rule.id} className="hover:bg-surface-subtle transition-colors">
                  {/* Trigger Word */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-content">{rule.triggerWord}</span>
                      <span
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                          rule.matchType === 'EXACT'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-purple-100 text-purple-700'
                        }`}
                      >
                        {rule.matchType === 'EXACT' ? 'EXACT' : 'CONTAINS'}
                      </span>
                    </div>
                  </td>

                  {/* Collection title */}
                  <td className="px-4 py-3 text-content-2 max-w-[160px] truncate">
                    {rule.collectionTitle}
                  </td>

                  {/* Product count */}
                  <td className="px-4 py-3">
                    <span className="text-xs text-content-2">
                      {rule.retailerIds.length} product{rule.retailerIds.length !== 1 ? 's' : ''}
                    </span>
                  </td>

                  {/* Active toggle */}
                  <td className="px-4 py-3">
                    <button
                      onClick={() => void handleToggle(rule)}
                      aria-label={rule.isActive ? 'Deactivate rule' : 'Activate rule'}
                      className={`relative inline-flex items-center h-5 w-9 rounded-full transition-colors ${
                        rule.isActive ? 'bg-emerald-500' : 'bg-gray-300'
                      }`}
                    >
                      <span
                        className={`absolute inline-block w-3.5 h-3.5 bg-white rounded-full shadow transition-transform ${
                          rule.isActive ? 'translate-x-[18px]' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => openEdit(rule)}
                        title="Edit"
                        className="p-1.5 text-content-3 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      >
                        <PencilIcon />
                      </button>
                      <button
                        onClick={() => void handleDelete(rule)}
                        disabled={deletingId === rule.id}
                        title="Delete"
                        className="p-1.5 text-content-3 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
                      >
                        <TrashIcon />
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
      {!loading && (
        <div className="flex justify-end">
          <button
            onClick={() => void fetchRules()}
            className="text-xs text-content-3 hover:text-content-2 transition-colors"
          >
            ↻ Refresh
          </button>
        </div>
      )}

      {/* ── Modal ──────────────────────────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4">
          <div className="bg-surface-raised rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-edge shrink-0">
              <h3 className="text-base font-semibold text-content">
                {editingRule ? 'Edit Rule' : 'New Rule'}
              </h3>
              <button
                onClick={closeModal}
                className="text-content-3 hover:text-content-2 transition-colors text-lg leading-none"
              >
                ✕
              </button>
            </div>

            {/* Modal body — scrollable */}
            <form
              id="rule-form"
              onSubmit={(e) => void handleSubmit(e)}
              className="flex-1 overflow-y-auto px-6 py-5 space-y-5"
            >
              {/* Trigger word */}
              <div>
                <label className="block text-xs font-semibold text-content-2 mb-1.5">
                  Trigger Word <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={form.triggerWord}
                  onChange={(e) => setField('triggerWord', e.target.value)}
                  placeholder='e.g. "hola" or "ofertas"'
                  autoFocus
                  className="w-full text-sm border border-edge rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
                <p className="text-xs text-content-3 mt-1">
                  The incoming text that will trigger this auto-reply.
                </p>
              </div>

              {/* Match type */}
              <div>
                <label className="block text-xs font-semibold text-content-2 mb-1.5">
                  Match Type
                </label>
                <div className="flex gap-2">
                  {(['EXACT', 'CONTAINS'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setField('matchType', type)}
                      className={`flex-1 text-xs font-medium py-2 rounded-lg border transition-colors ${
                        form.matchType === type
                          ? type === 'EXACT'
                            ? 'bg-blue-50 border-blue-300 text-blue-700'
                            : 'bg-purple-50 border-purple-300 text-purple-700'
                          : 'border-edge text-content-2 hover:bg-surface-subtle'
                      }`}
                    >
                      {type === 'EXACT' ? '= Exact Match' : '⊃ Contains'}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-content-3 mt-1">
                  {form.matchType === 'EXACT'
                    ? 'The full message must equal the trigger word exactly.'
                    : 'The message just needs to contain the trigger word anywhere.'}
                </p>
              </div>

              {/* Collection title */}
              <div>
                <label className="block text-xs font-semibold text-content-2 mb-1.5">
                  Collection Title <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={form.collectionTitle}
                  onChange={(e) => setField('collectionTitle', e.target.value)}
                  placeholder='e.g. "Ropa de niños"'
                  className="w-full text-sm border border-edge rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
                <p className="text-xs text-content-3 mt-1">
                  Shown as the section header in the WhatsApp product message.
                </p>
              </div>

              {/* Separator */}
              <div className="border-t border-edge" />

              {/* Product selector */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-content-2">
                    Products to Include <span className="text-red-400">*</span>
                  </label>
                  {form.retailerIds.length > 0 && (
                    <span className="text-xs font-medium text-emerald-600">
                      {form.retailerIds.length} selected
                    </span>
                  )}
                </div>

                {/* Catalog picker (only if multiple catalogs) */}
                {catalogs.length > 1 && (
                  <select
                    value={selectorCatalogId}
                    onChange={(e) => {
                      setSelectorCatalogId(e.target.value);
                      setProducts([]);
                    }}
                    className="w-full text-xs border border-edge rounded-lg px-2.5 py-1.5 mb-2 focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-surface-raised"
                  >
                    {catalogs.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}

                {catalogs.length === 0 ? (
                  <div className="text-center py-6 bg-surface-subtle rounded-xl border border-dashed border-edge">
                    <p className="text-xs text-content-3">
                      No catalogs found. Create a catalog in "Catalogs & Products" first.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Search */}
                    <div className="relative mb-2">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-content-3 text-xs">
                        🔍
                      </span>
                      <input
                        type="text"
                        value={productSearch}
                        onChange={(e) => setProductSearch(e.target.value)}
                        placeholder="Search products…"
                        className="w-full text-xs border border-edge rounded-lg pl-7 pr-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                      />
                    </div>

                    {/* Product list */}
                    <div className="border border-edge rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                      {productsLoading && (
                        <div className="space-y-px">
                          {[1, 2, 3].map((i) => (
                            <div key={i} className="h-10 bg-surface-subtle animate-pulse" />
                          ))}
                        </div>
                      )}

                      {!productsLoading && filteredProducts.length === 0 && (
                        <div className="py-6 text-center text-xs text-content-3">
                          {products.length === 0
                            ? 'No products in this catalog.'
                            : 'No products match your search.'}
                        </div>
                      )}

                      {!productsLoading && filteredProducts.length > 0 && (
                        <ul className="divide-y divide-edge">
                          {filteredProducts.map((product) => {
                            const retailerId = product.retailer_id ?? product.id;
                            const isChecked = form.retailerIds.includes(retailerId);
                            return (
                              <li key={product.id}>
                                <label className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-subtle cursor-pointer transition-colors">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => toggleProduct(retailerId)}
                                    className="w-3.5 h-3.5 accent-emerald-600 rounded shrink-0"
                                  />
                                  {product.image_url && (
                                    <img
                                      src={product.image_url}
                                      alt={product.name}
                                      className="w-7 h-7 rounded object-cover shrink-0"
                                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                                    />
                                  )}
                                  <div className="min-w-0 flex-1">
                                    <p className="text-xs font-medium text-content truncate">
                                      {product.name}
                                    </p>
                                    {retailerId && (
                                      <p className="text-[10px] text-content-3 font-mono truncate">
                                        {retailerId}
                                      </p>
                                    )}
                                  </div>
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>

                    {products.length > 0 && (
                      <p className="text-[10px] text-content-3 mt-1">
                        {products.length} product{products.length !== 1 ? 's' : ''} in catalog
                        {filteredProducts.length < products.length &&
                          ` · ${filteredProducts.length} shown`}
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* Active toggle */}
              <div className="flex items-center justify-between bg-surface-subtle rounded-xl px-4 py-3">
                <div>
                  <p className="text-xs font-semibold text-content-2">Active</p>
                  <p className="text-[10px] text-content-3">
                    Inactive rules are stored but will not fire.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setField('isActive', !form.isActive)}
                  aria-label={form.isActive ? 'Deactivate' : 'Activate'}
                  className={`relative inline-flex items-center h-5 w-9 rounded-full transition-colors ${
                    form.isActive ? 'bg-emerald-500' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`absolute inline-block w-3.5 h-3.5 bg-white rounded-full shadow transition-transform ${
                      form.isActive ? 'translate-x-[18px]' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
            </form>

            {/* Modal footer */}
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-edge shrink-0">
              <button
                type="button"
                onClick={closeModal}
                className="text-sm font-medium text-content-2 hover:text-content px-4 py-2 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="rule-form"
                disabled={saving}
                className="text-sm font-medium bg-brand text-white px-5 py-2 rounded-lg hover:bg-brand-hover disabled:opacity-40 transition-colors"
              >
                {saving ? 'Saving…' : editingRule ? 'Save Changes' : 'Create Rule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import type {
  MetaProduct,
  MetaCatalog,
  MetaVariant,
  CreateVariantPayload,
  UpdateVariantPayload,
} from '../../catalog-manager/api/catalogManagerApi';
import {
  listVariants,
  createVariant,
  updateVariant,
  deleteVariant,
  formatPrice,
} from '../../catalog-manager/api/catalogManagerApi';
import type { ToastType } from './Toast';
import { useLanguage } from '../../context/LanguageContext';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  businessId: string;
  catalog: MetaCatalog;
  product: MetaProduct;
  onBack: () => void;
  onToast: (message: string, type: ToastType) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ATTRIBUTE_PRESETS = [
  'color',
  'size',
  'material',
  'style',
  'pattern',
  'gender',
  'age_group',
] as const;

const AVAILABILITY_OPTIONS = [
  'in stock',
  'out of stock',
  'preorder',
  'available for order',
  'discontinued',
] as const;

const CONDITION_OPTIONS = ['new', 'refurbished', 'used'] as const;

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<MetaVariant['status'], { cls: string; dot: string }> = {
  SYNCING_WITH_META:   { cls: 'bg-caution-bg text-caution-text border border-amber-200',   dot: 'bg-amber-400' },
  ACTIVE:              { cls: 'bg-ok-bg text-ok-text border border-green-200',            dot: 'bg-green-500' },
  FAILED_INTEGRATION:  { cls: 'bg-danger-bg text-danger-text border border-red-200',      dot: 'bg-red-500' },
  ARCHIVED:            { cls: 'bg-surface-subtle text-content-2 border border-edge',      dot: 'bg-gray-400' },
  SUSPENDED_BY_POLICY: { cls: 'bg-orange-50 text-orange-700 border border-orange-200',    dot: 'bg-orange-500' },
};

const STATUS_LABEL_KEY: Record<MetaVariant['status'], 'inventory.variant.status.syncing' | 'inventory.variant.status.active' | 'inventory.variant.status.error' | 'inventory.variant.status.archived' | 'inventory.variant.status.suspended'> = {
  SYNCING_WITH_META:   'inventory.variant.status.syncing',
  ACTIVE:              'inventory.variant.status.active',
  FAILED_INTEGRATION:  'inventory.variant.status.error',
  ARCHIVED:            'inventory.variant.status.archived',
  SUSPENDED_BY_POLICY: 'inventory.variant.status.suspended',
};

function StatusBadge({ status }: { status: MetaVariant['status'] }) {
  const { t } = useLanguage();
  const style = STATUS_STYLE[status] ?? STATUS_STYLE.FAILED_INTEGRATION;
  const isSyncing = status === 'SYNCING_WITH_META';
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${style.cls}`}>
      {isSyncing ? (
        <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
      ) : (
        <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
      )}
      {t(STATUS_LABEL_KEY[status] ?? 'inventory.variant.status.error')}
    </span>
  );
}

// ─── Variant form values ──────────────────────────────────────────────────────

interface VariantFormValues {
  retailerId: string;
  name: string;
  description: string;
  attributeKey: string;
  customAttributeKey: string;
  attributeValue: string;
  availability: string;
  condition: string;
  priceDecimal: string;
  currency: string;
  imageUrl: string;
  url: string;
}

function makeEmptyForm(product: MetaProduct): VariantFormValues {
  return {
    retailerId:       '',
    name:             product.name,
    description:      product.description ?? '',
    attributeKey:     'color',
    customAttributeKey: '',
    attributeValue:   '',
    availability:     product.availability ?? 'in stock',
    condition:        product.condition ?? 'new',
    priceDecimal:     product.price ? (parseInt(product.price, 10) / 100).toFixed(2) : '',
    currency:         product.currency ?? 'USD',
    imageUrl:         product.image_url ?? '',
    url:              product.url ?? '',
  };
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function VariantManager({
  businessId,
  catalog,
  product,
  onBack,
  onToast,
}: Props) {
  const { t } = useLanguage();
  const [variants, setVariants]     = useState<MetaVariant[]>([]);
  const [loading, setLoading]       = useState(false);
  const [showForm, setShowForm]     = useState(false);
  const [editingVariant, setEditingVariant] = useState<MetaVariant | null>(null);
  const [form, setForm]             = useState<VariantFormValues>(() => makeEmptyForm(product));
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError]   = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── Fetch ─────────────────────────────────────────────────────────────────

  const fetchVariants = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listVariants(businessId, catalog.id, product.id);
      setVariants(data);
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : t('inventory.variant.err.load'), 'error');
    } finally {
      setLoading(false);
    }
  }, [businessId, catalog.id, product.id, onToast]);

  useEffect(() => { void fetchVariants(); }, [fetchVariants]);

  // ── Form helpers ──────────────────────────────────────────────────────────

  const updateField = (key: keyof VariantFormValues, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const resolvedAttributeKey =
    form.attributeKey === '__custom__' ? form.customAttributeKey.trim() : form.attributeKey;

  const openCreate = () => {
    setEditingVariant(null);
    setForm(makeEmptyForm(product));
    setFormError(null);
    setShowForm(true);
  };

  const openEdit = (v: MetaVariant) => {
    setEditingVariant(v);
    const isPreset = ATTRIBUTE_PRESETS.includes(v.attributeKey as typeof ATTRIBUTE_PRESETS[number]);
    setForm({
      retailerId:         v.retailerId,
      name:               v.name,
      description:        '',
      attributeKey:       isPreset ? v.attributeKey : '__custom__',
      customAttributeKey: isPreset ? '' : v.attributeKey,
      attributeValue:     v.attributeValue,
      availability:       v.availability ?? 'in stock',
      condition:          'new',
      priceDecimal:       v.price ? (v.price / 100).toFixed(2) : '',
      currency:           v.currency ?? 'USD',
      imageUrl:           '',
      url:                '',
    });
    setFormError(null);
    setShowForm(true);
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingVariant(null);
    setForm(makeEmptyForm(product));
    setFormError(null);
  };

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const priceMinor = Math.round(parseFloat(form.priceDecimal) * 100);
    if (isNaN(priceMinor) || priceMinor <= 0) {
      setFormError(t('inventory.variant.val.price'));
      return;
    }
    if (!resolvedAttributeKey) {
      setFormError(t('inventory.variant.val.attr'));
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      if (editingVariant) {
        const payload: UpdateVariantPayload = {
          businessId,
          name:           form.name,
          description:    form.description || undefined,
          attributeKey:   resolvedAttributeKey,
          attributeValue: form.attributeValue,
          availability:   form.availability,
          condition:      form.condition,
          price:          priceMinor,
          currency:       form.currency,
          imageUrl:       form.imageUrl || undefined,
          url:            form.url || undefined,
        };
        await updateVariant(catalog.id, product.id, editingVariant.metaVariantId!, payload);
        onToast(t('inventory.variant.ok.updated', { name: form.name }), 'success');
      } else {
        const payload: CreateVariantPayload = {
          businessId,
          // itemGroupId is sent as a hint; the backend overrides it with the
          // value fetched directly from Meta to handle Commerce Manager products.
          itemGroupId:    product.retailer_id ?? product.id,
          retailerId:     form.retailerId,
          // name and description are locked to the parent product's values.
          // Meta groups variants ONLY when these fields match the parent exactly.
          name:           product.name,
          description:    product.description ?? '',
          attributeKey:   resolvedAttributeKey,
          attributeValue: form.attributeValue,
          availability:   form.availability,
          condition:      form.condition,
          price:          priceMinor,
          currency:       form.currency,
          imageUrl:       form.imageUrl,
          url:            form.url,
        };
        await createVariant(catalog.id, product.id, payload);
        onToast(t('inventory.variant.ok.created', { key: resolvedAttributeKey, value: form.attributeValue }), 'success');
      }
      cancelForm();
      void fetchVariants();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('inventory.product.err.op');
      setFormError(msg);
      onToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────

  const handleDelete = async (variant: MetaVariant) => {
    if (!variant.metaVariantId) {
      onToast(t('inventory.variant.err.neverSynced'), 'error');
      return;
    }
    if (!confirm(t('inventory.variant.confirm.archive', { name: variant.name, key: variant.attributeKey, value: variant.attributeValue })))
      return;

    setDeletingId(variant.metaVariantId);
    try {
      await deleteVariant(businessId, catalog.id, product.id, variant.metaVariantId);
      onToast(t('inventory.variant.ok.archived'), 'success');
      void fetchVariants();
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : t('inventory.variant.err.delete'), 'error');
    } finally {
      setDeletingId(null);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const activeVariants   = variants.filter((v) => v.status !== 'ARCHIVED');
  const archivedVariants = variants.filter((v) => v.status === 'ARCHIVED');

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={onBack}
            className="text-sm font-medium text-content-2 hover:text-content transition-colors"
          >
            {t('inventory.variant.back')}
          </button>
          <span className="text-content-3">|</span>
          <span className="text-sm text-content-2 truncate max-w-[140px]">{catalog.name}</span>
          <span className="text-content-3">|</span>
          <h2 className="text-sm font-semibold text-content truncate max-w-[180px]">
            {product.name}
          </h2>
          <span className="text-xs font-semibold bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full">
            {t('inventory.variant.badge')}
          </span>
        </div>
        {!showForm && (
          <button
            onClick={openCreate}
            className="text-sm font-medium text-violet-600 hover:text-violet-700 transition-colors"
          >
            {t('inventory.variant.new')}
          </button>
        )}
      </div>

      {/* Parent product info strip */}
      <div className="flex items-center gap-3 bg-surface-subtle border border-edge rounded-xl px-4 py-3">
        {product.image_url && (
          <img
            src={product.image_url}
            alt={product.name}
            className="w-10 h-10 rounded-lg object-cover shrink-0 border border-edge"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        )}
        <div className="min-w-0">
          <p className="text-sm font-semibold text-content truncate">{product.name}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-content-3 font-mono">{product.retailer_id}</span>
            <span className="text-content-3">·</span>
            <span className="text-xs text-content-2">
              {formatPrice(product.price, product.currency)}
            </span>
          </div>
        </div>
        <div className="ml-auto text-right shrink-0">
          <p className="text-xs text-content-3">item_group_id</p>
          <p className="text-xs font-mono text-content-2">{product.retailer_id ?? product.id}</p>
        </div>
      </div>

      {/* Variant form */}
      {showForm && (
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="bg-violet-50 border border-violet-200 rounded-xl p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-violet-800">
              {editingVariant ? t('inventory.variant.form.editTitle') : t('inventory.variant.form.newTitle')}
            </h3>
            <button
              type="button"
              onClick={cancelForm}
              className="text-xs text-content-2 hover:text-content transition-colors"
            >
              {t('inventory.variant.cancel')}
            </button>
          </div>

          {/* Meta grouping rule notice */}
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-xs text-amber-800">
            <svg className="w-3.5 h-3.5 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2a10 10 0 100 20A10 10 0 0012 2zm1 14h-2v-2h2v2zm0-4h-2V7h2v5z"/>
            </svg>
            <span>
              {t('inventory.variant.notice')}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Attribute key */}
            <div>
              <label className="block text-xs font-medium text-content-2 mb-1">
                {t('inventory.variant.field.attr')} <span className="text-red-400">*</span>
              </label>
              <select
                value={form.attributeKey}
                onChange={(e) => updateField('attributeKey', e.target.value)}
                className="w-full text-sm border border-edge rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400"
              >
                {ATTRIBUTE_PRESETS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
                <option value="__custom__">{t('inventory.variant.custom')}</option>
              </select>
              {form.attributeKey === '__custom__' && (
                <input
                  type="text"
                  value={form.customAttributeKey}
                  onChange={(e) => updateField('customAttributeKey', e.target.value)}
                  placeholder={t('inventory.variant.ph.attr')}
                  required
                  className="w-full mt-1.5 text-sm border border-edge rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400"
                />
              )}
            </div>

            {/* Attribute value */}
            <div>
              <label className="block text-xs font-medium text-content-2 mb-1">
                {t('inventory.variant.field.value')} <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={form.attributeValue}
                onChange={(e) => updateField('attributeValue', e.target.value)}
                placeholder={t('inventory.variant.ph.value')}
                required
                className="w-full text-sm border border-edge rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
            </div>

            {/* SKU */}
            <div>
              <label className="block text-xs font-medium text-content-2 mb-1">
                {t('inventory.variant.field.sku')} <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={form.retailerId}
                onChange={(e) => updateField('retailerId', e.target.value)}
                placeholder={t('inventory.variant.ph.sku')}
                disabled={!!editingVariant}
                required={!editingVariant}
                className="w-full text-sm border border-edge rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400 disabled:bg-surface-subtle disabled:text-content-3"
              />
            </div>

            {/* Name — locked to parent (Meta grouping rule) */}
            <div>
              <label className="block text-xs font-medium text-content-2 mb-1 flex items-center gap-1.5">
                {t('inventory.variant.field.name')}
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                  <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 100 20A10 10 0 0012 2zm1 14h-2v-2h2v2zm0-4h-2V7h2v5z"/></svg>
                  {t('inventory.variant.inherited')}
                </span>
              </label>
              <div className="w-full text-sm border border-edge bg-surface-subtle rounded-lg px-3 py-2 text-content-2 cursor-not-allowed">
                {product.name}
              </div>
            </div>

            {/* Description — locked to parent (Meta grouping rule) */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-content-2 mb-1 flex items-center gap-1.5">
                {t('inventory.variant.field.desc')}
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                  <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 100 20A10 10 0 0012 2zm1 14h-2v-2h2v2zm0-4h-2V7h2v5z"/></svg>
                  {t('inventory.variant.inherited')}
                </span>
              </label>
              <div className="w-full text-sm border border-edge bg-surface-subtle rounded-lg px-3 py-2 text-content-2 min-h-[52px] cursor-not-allowed">
                {product.description || <em className="text-content-3">{t('inventory.variant.noParentDesc')}</em>}
              </div>
            </div>

            {/* Price */}
            <div>
              <label className="block text-xs font-medium text-content-2 mb-1">
                {t('inventory.variant.field.price')} <span className="text-red-400">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={form.priceDecimal}
                onChange={(e) => updateField('priceDecimal', e.target.value)}
                placeholder="10.00"
                required
                className="w-full text-sm border border-edge rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
            </div>

            {/* Currency */}
            <div>
              <label className="block text-xs font-medium text-content-2 mb-1">
                {t('inventory.variant.field.currency')} <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={form.currency}
                onChange={(e) => updateField('currency', e.target.value.toUpperCase())}
                placeholder="USD"
                maxLength={3}
                required
                className="w-full text-sm border border-edge rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400 uppercase"
              />
            </div>

            {/* Availability */}
            <div>
              <label className="block text-xs font-medium text-content-2 mb-1">{t('inventory.variant.field.avail')}</label>
              <select
                value={form.availability}
                onChange={(e) => updateField('availability', e.target.value)}
                className="w-full text-sm border border-edge rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400"
              >
                <option value="in stock">{t('inventory.product.avail.inStock')}</option>
                <option value="out of stock">{t('inventory.product.avail.outOfStock')}</option>
                <option value="preorder">{t('inventory.product.avail.preorder')}</option>
                <option value="available for order">{t('inventory.product.avail.available')}</option>
                <option value="discontinued">{t('inventory.product.avail.discontinued')}</option>
              </select>
            </div>

            {/* Condition */}
            <div>
              <label className="block text-xs font-medium text-content-2 mb-1">{t('inventory.variant.field.cond')}</label>
              <select
                value={form.condition}
                onChange={(e) => updateField('condition', e.target.value)}
                className="w-full text-sm border border-edge rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400"
              >
                <option value="new">{t('inventory.product.cond.new')}</option>
                <option value="refurbished">{t('inventory.product.cond.refurbished')}</option>
                <option value="used">{t('inventory.product.cond.used')}</option>
              </select>
            </div>

            {/* Image URL */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-content-2 mb-1">
                {t('inventory.variant.field.imageUrl')} {!editingVariant && <span className="text-red-400">*</span>}
              </label>
              <input
                type="url"
                value={form.imageUrl}
                onChange={(e) => updateField('imageUrl', e.target.value)}
                placeholder="https://example.com/variant-image.jpg"
                required={!editingVariant}
                className="w-full text-sm border border-edge rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
            </div>

            {/* Product URL */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-content-2 mb-1">
                {t('inventory.variant.field.pageUrl')} {!editingVariant && <span className="text-red-400">*</span>}
              </label>
              <input
                type="url"
                value={form.url}
                onChange={(e) => updateField('url', e.target.value)}
                placeholder="https://example.com/products/shirt?color=red&size=xl"
                required={!editingVariant}
                className="w-full text-sm border border-edge rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400"
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
              {t('inventory.variant.cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="text-sm font-medium bg-violet-600 text-white px-4 py-2 rounded-lg hover:bg-violet-700 disabled:opacity-40 transition-colors"
            >
              {submitting
                ? editingVariant ? t('inventory.variant.saving') : t('inventory.variant.creating')
                : editingVariant ? t('inventory.variant.save') : t('inventory.variant.create')}
            </button>
          </div>
        </form>
      )}

      {/* Variants table */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 bg-surface-subtle animate-pulse rounded-xl" />
          ))}
        </div>
      ) : activeVariants.length === 0 && !showForm ? (
        <div className="text-center py-10 text-content-3">
          <svg className="w-10 h-10 mx-auto mb-3 text-content-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
          </svg>
          <p className="text-sm">{t('inventory.variant.empty')}</p>
          <p className="text-xs mt-1">{t('inventory.variant.emptyHint')}</p>
        </div>
      ) : (
        <div className="overflow-hidden border border-edge rounded-xl">
          <table className="w-full text-sm">
            <thead className="bg-surface-subtle border-b border-edge">
              <tr>
                <th className="text-left text-xs font-semibold text-content-2 px-4 py-2.5">{t('inventory.variant.col.attr')}</th>
                <th className="text-left text-xs font-semibold text-content-2 px-4 py-2.5">{t('inventory.variant.col.sku')}</th>
                <th className="text-left text-xs font-semibold text-content-2 px-4 py-2.5 hidden sm:table-cell">{t('inventory.variant.col.price')}</th>
                <th className="text-left text-xs font-semibold text-content-2 px-4 py-2.5 hidden md:table-cell">{t('inventory.variant.col.stock')}</th>
                <th className="text-left text-xs font-semibold text-content-2 px-4 py-2.5">{t('inventory.variant.col.status')}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {activeVariants.map((v) => (
                <tr key={v.retailerId} className="hover:bg-surface-subtle transition-colors">
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-xs font-medium bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded capitalize">
                        {v.attributeKey}
                      </span>
                      <span className="text-sm text-content-2">{v.attributeValue}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-mono text-content-2">{v.retailerId}</span>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span className="text-sm text-content-2">
                      {v.price
                        ? new Intl.NumberFormat('en-US', {
                            style: 'currency',
                            currency: v.currency ?? 'USD',
                          }).format(v.price / 100)
                        : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="text-xs text-content-2 capitalize">
                      {v.availability ?? '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <StatusBadge status={v.status} />
                      {v.status === 'FAILED_INTEGRATION' && v.failureReason && (
                        <p className="text-[10px] text-red-500 leading-tight max-w-[160px] truncate" title={v.failureReason}>
                          {v.failureReason}
                        </p>
                      )}
                      {v.status === 'SUSPENDED_BY_POLICY' && v.rejectionReasons?.length && (
                        <p className="text-[10px] text-orange-600 leading-tight max-w-[160px] truncate" title={v.rejectionReasons.join(', ')}>
                          {v.rejectionReasons[0]}
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => openEdit(v)}
                        className="text-xs font-medium text-content-2 hover:text-content transition-colors"
                      >
                        {t('inventory.variant.actions.edit')}
                      </button>
                      <button
                        onClick={() => void handleDelete(v)}
                        disabled={deletingId === v.metaVariantId}
                        className="text-xs font-medium text-red-400 hover:text-red-600 disabled:opacity-40 transition-colors"
                      >
                        {deletingId === v.metaVariantId ? '…' : t('inventory.variant.actions.archive')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Archived section — collapsed by default */}
      {archivedVariants.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-xs text-content-3 hover:text-content-2 transition-colors list-none flex items-center gap-1">
            <svg className="w-3 h-3 transition-transform group-open:rotate-90" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5l8 7-8 7V5z" />
            </svg>
            {t(archivedVariants.length === 1 ? 'inventory.variant.archived.one' : 'inventory.variant.archived.many', { n: archivedVariants.length })}
          </summary>
          <div className="mt-2 overflow-hidden border border-edge rounded-xl opacity-60">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-edge">
                {archivedVariants.map((v) => (
                  <tr key={v.retailerId} className="bg-surface-subtle">
                    <td className="px-4 py-2.5">
                      <span className="text-xs text-content-3 capitalize">{v.attributeKey}: {v.attributeValue}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs font-mono text-content-3">{v.retailerId}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status="ARCHIVED" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {/* Footer */}
      {!loading && (
        <div className="flex justify-between items-center pt-1">
          <p className="text-xs text-content-3">
            {t(activeVariants.length === 1 ? 'inventory.variant.active.one' : 'inventory.variant.active.many', { n: activeVariants.length })}
          </p>
          <button
            onClick={() => void fetchVariants()}
            className="text-xs text-content-3 hover:text-content-2 transition-colors"
          >
            {t('inventory.variant.refresh')}
          </button>
        </div>
      )}
    </div>
  );
}

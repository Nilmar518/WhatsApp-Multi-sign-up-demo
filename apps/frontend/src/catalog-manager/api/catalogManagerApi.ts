const BASE = '/api/catalog-manager';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MetaCatalog {
  id: string;
  name: string;
  vertical?: string;
}

export interface MetaProduct {
  id: string;
  name: string;
  retailer_id?: string;
  description?: string;
  availability?: string;
  condition?: string;
  /** Price string from Meta in minor units (e.g. "1000" = $10.00) */
  price?: string;
  currency?: string;
  url?: string;
  image_url?: string;
  /** Meta Commerce Manager review status */
  review_status?: 'approved' | 'pending' | 'rejected' | 'outdated';
}

export interface CreateProductPayload {
  businessId: string;
  retailerId: string;
  name: string;
  description: string;
  availability: string;
  condition: string;
  /** Price in minor currency units (e.g. 1000 = $10.00 USD) */
  price: number;
  currency: string;
  imageUrl: string;
  url: string;
}

export interface UpdateProductPayload {
  businessId: string;
  name?: string;
  description?: string;
  availability?: string;
  condition?: string;
  price?: number;
  currency?: string;
  imageUrl?: string;
  url?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (res.status === 204) return undefined as unknown as T;

  const body = await res.json().catch(() => ({})) as { message?: string; statusCode?: number };

  if (!res.ok) {
    throw new Error(
      Array.isArray(body.message)
        ? body.message.join('; ')
        : (body.message ?? `HTTP ${res.status}`),
    );
  }

  return body as T;
}

// ─── Catalog API ──────────────────────────────────────────────────────────────

export async function listCatalogs(businessId: string): Promise<MetaCatalog[]> {
  return apiFetch(
    `${BASE}/catalogs?businessId=${encodeURIComponent(businessId)}`,
  );
}

export async function createCatalog(
  businessId: string,
  name: string,
): Promise<MetaCatalog> {
  return apiFetch(`${BASE}/catalogs`, {
    method: 'POST',
    body: JSON.stringify({ businessId, name }),
  });
}

export async function renameCatalog(
  businessId: string,
  catalogId: string,
  name: string,
): Promise<void> {
  return apiFetch(`${BASE}/catalogs/${catalogId}`, {
    method: 'PATCH',
    body: JSON.stringify({ businessId, name }),
  });
}

export async function deleteCatalog(
  businessId: string,
  catalogId: string,
): Promise<void> {
  return apiFetch(
    `${BASE}/catalogs/${catalogId}?businessId=${encodeURIComponent(businessId)}`,
    { method: 'DELETE' },
  );
}

// ─── Product API ──────────────────────────────────────────────────────────────

export async function listProducts(
  businessId: string,
  catalogId: string,
): Promise<MetaProduct[]> {
  return apiFetch(
    `${BASE}/catalogs/${catalogId}/products?businessId=${encodeURIComponent(businessId)}`,
  );
}

export async function createProduct(
  catalogId: string,
  payload: CreateProductPayload,
): Promise<MetaProduct> {
  return apiFetch(`${BASE}/catalogs/${catalogId}/products`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateProduct(
  catalogId: string,
  productItemId: string,
  payload: UpdateProductPayload,
): Promise<MetaProduct> {
  return apiFetch(`${BASE}/catalogs/${catalogId}/products/${productItemId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function deleteProduct(
  businessId: string,
  catalogId: string,
  productItemId: string,
): Promise<void> {
  return apiFetch(
    `${BASE}/catalogs/${catalogId}/products/${productItemId}?businessId=${encodeURIComponent(businessId)}`,
    { method: 'DELETE' },
  );
}

// ─── Variant API ──────────────────────────────────────────────────────────────

export interface MetaVariant {
  /** Firestore auto-generated document ID */
  id?: string;
  retailerId: string;
  name: string;
  itemGroupId: string;
  catalogId: string;
  metaVariantId?: string;
  attributeKey: string;
  attributeValue: string;
  price?: number;
  currency?: string;
  availability?: string;
  /** Sync state written and maintained by our backend */
  status: 'SYNCING_WITH_META' | 'ACTIVE' | 'FAILED_INTEGRATION' | 'ARCHIVED' | 'SUSPENDED_BY_POLICY';
  failureReason?: string;
  rejectionReasons?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateVariantPayload {
  businessId: string;
  itemGroupId: string;
  retailerId: string;
  name: string;
  description: string;
  attributeKey: string;
  attributeValue: string;
  availability: string;
  condition: string;
  price: number;
  currency: string;
  imageUrl: string;
  url: string;
}

export interface UpdateVariantPayload {
  businessId: string;
  name?: string;
  description?: string;
  attributeKey?: string;
  attributeValue?: string;
  availability?: string;
  condition?: string;
  price?: number;
  currency?: string;
  imageUrl?: string;
  url?: string;
}

export async function listVariants(
  businessId: string,
  catalogId: string,
  productId: string,
): Promise<MetaVariant[]> {
  return apiFetch(
    `${BASE}/catalogs/${catalogId}/products/${productId}/variants?businessId=${encodeURIComponent(businessId)}`,
  );
}

export async function createVariant(
  catalogId: string,
  productId: string,
  payload: CreateVariantPayload,
): Promise<MetaVariant> {
  return apiFetch(
    `${BASE}/catalogs/${catalogId}/products/${productId}/variants`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

export async function updateVariant(
  catalogId: string,
  productId: string,
  variantItemId: string,
  payload: UpdateVariantPayload,
): Promise<MetaVariant> {
  return apiFetch(
    `${BASE}/catalogs/${catalogId}/products/${productId}/variants/${variantItemId}`,
    { method: 'PUT', body: JSON.stringify(payload) },
  );
}

export async function deleteVariant(
  businessId: string,
  catalogId: string,
  productId: string,
  variantItemId: string,
): Promise<void> {
  return apiFetch(
    `${BASE}/catalogs/${catalogId}/products/${productId}/variants/${variantItemId}?businessId=${encodeURIComponent(businessId)}`,
    { method: 'DELETE' },
  );
}

// ─── Health check API ─────────────────────────────────────────────────────────

export interface CatalogHealth {
  appIsValid: boolean;
  scopes: string[];
  missingScopes: string[];
  hasCommerceAccount: boolean;
  commerceAccountId?: string;
  ownerBusinessId?: string;
  warnings: string[];
}

export async function checkHealth(businessId: string): Promise<CatalogHealth> {
  return apiFetch(
    `${BASE}/health?businessId=${encodeURIComponent(businessId)}`,
  );
}

export async function linkCatalog(
  businessId: string,
  catalogId: string,
): Promise<void> {
  return apiFetch(
    `${BASE}/catalogs/${catalogId}/link?businessId=${encodeURIComponent(businessId)}`,
    { method: 'POST' },
  );
}

export async function unlinkCatalog(businessId: string): Promise<void> {
  return apiFetch(
    `${BASE}/catalogs/unlink?businessId=${encodeURIComponent(businessId)}`,
    { method: 'POST' },
  );
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Converts a Meta price string in minor units to a display string (e.g. "1000" → "$10.00") */
export function formatPrice(price: string | undefined, currency: string | undefined): string {
  if (!price || !currency) return '—';
  const amount = parseInt(price, 10) / 100;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

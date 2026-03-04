/**
 * Shared type definitions for the Catalog Manager module.
 *
 * Exported here so both CatalogManagerService and CatalogManagerController
 * can reference them explicitly, satisfying TS4053 (public methods of exported
 * classes must not use private/unexported names in their return types).
 */

export interface MetaCatalogItem {
  id: string;
  name: string;
  vertical?: string;
}

export interface MetaProductItem {
  id: string;
  name: string;
  retailer_id?: string;
  description?: string;
  availability?: string;
  condition?: string;
  /** Price string from Meta in minor units (e.g. "1000" = $10.00 USD) */
  price?: string;
  currency?: string;
  url?: string;
  image_url?: string;
  /** Meta Commerce Manager review status for the product listing */
  review_status?: 'approved' | 'pending' | 'rejected' | 'outdated';
}

export interface CommerceAccount {
  id: string;
  name?: string;
}

/**
 * Result returned by GET /catalog-manager/health.
 * Drives the System Health indicator in the frontend dashboard.
 */
export interface CatalogHealthResult {
  /** Whether the App Access Token is valid */
  appIsValid: boolean;
  /** Scopes currently granted to the App token (may be empty for App tokens) */
  scopes: string[];
  /** Required scopes that are NOT present */
  missingScopes: string[];
  /** Whether at least one Commerce Account exists under the ownerBusinessId */
  hasCommerceAccount: boolean;
  /** First Commerce Account ID found (used as fallback for catalog creation) */
  commerceAccountId?: string;
  /** Resolved owner Business Manager ID (from discovery or cache) */
  ownerBusinessId?: string;
  /** Non-fatal advisory messages */
  warnings: string[];
}

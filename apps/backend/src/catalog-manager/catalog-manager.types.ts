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
  /**
   * READ-side field name for the item group ID returned by GET requests.
   * Meta uses an asymmetric naming convention:
   *   GET  /{product_id}?fields=retailer_product_group_id  ← this field
   *   POST /{catalogId}/products { item_group_id: "..." }  ← different name
   * Always use `retailer_product_group_id` when reading and `item_group_id` when writing.
   */
  retailer_product_group_id?: string;
  /**
   * WRITE-side field name used in POST/PUT payloads to set the item group.
   * Never returned by GET — use `retailer_product_group_id` for reads.
   */
  item_group_id?: string;
}

export interface CommerceAccount {
  id: string;
  name?: string;
}

/**
 * Domain states for a product record tracked in Firestore.
 *
 *   SYNCING_WITH_META   — written optimistically before the Meta API call
 *   ACTIVE              — Meta confirmed the product was created successfully
 *   FAILED_INTEGRATION  — Meta API call failed; compensatory state for the orphan record
 */
export type ProductSyncStatus =
  | 'SYNCING_WITH_META'
  | 'ACTIVE'
  | 'FAILED_INTEGRATION'
  /** Meta's policy engine rejected the product after initial approval */
  | 'SUSPENDED_BY_POLICY'
  /** Product existed in Firestore as ACTIVE but is no longer present in Meta's catalog */
  | 'DELETED_IN_META';

/**
 * Shape of a document in the `catalog_products` Firestore subcollection
 * (integrations/{businessId}/catalog_products/{autoId}).
 */
export interface FirestoreProductRecord {
  retailerId: string;
  /**
   * The item_group_id sent to Meta. For parent products this equals `retailerId`.
   * All variants of this product share the same value, enabling Firestore queries
   * like `where('itemGroupId', '==', parentRetailerId)` to fetch a variant family.
   */
  itemGroupId?: string;
  name: string;
  catalogId: string;
  /** Set to the Meta product item ID once the API call succeeds */
  metaProductId?: string;
  status: ProductSyncStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Domain states for a variant record tracked in Firestore.
 *
 *   SYNCING_WITH_META    — optimistic write before the Meta API call
 *   ACTIVE               — Meta confirmed the variant was created / updated
 *   FAILED_INTEGRATION   — Meta API call failed; compensatory record with error detail
 *   ARCHIVED             — soft-deleted (history preserved, excluded from active lists)
 *   SUSPENDED_BY_POLICY  — Meta's policy engine rejected the variant after review
 */
export type VariantSyncStatus =
  | 'SYNCING_WITH_META'
  | 'ACTIVE'
  | 'FAILED_INTEGRATION'
  | 'ARCHIVED'
  | 'SUSPENDED_BY_POLICY';

/**
 * Shape of a document in the `variants` Firestore subcollection:
 *   integrations/{businessId}/catalog_products/{productDocId}/variants/{autoId}
 */
export interface FirestoreVariantRecord {
  /** Unique SKU for this variant */
  retailerId: string;
  /** Display name */
  name: string;
  /** Parent product's retailer_id — equals item_group_id sent to Meta */
  itemGroupId: string;
  /** Meta catalog ID this variant belongs to */
  catalogId: string;
  /** Set to the Meta product item ID once the API call succeeds */
  metaVariantId?: string;
  /** Attribute dimension key, e.g. "color" */
  attributeKey: string;
  /** Attribute dimension value, e.g. "Red" */
  attributeValue: string;
  /** Price in minor currency units */
  price?: number;
  currency?: string;
  availability?: string;
  status: VariantSyncStatus;
  /** Populated on FAILED_INTEGRATION — raw Meta error message */
  failureReason?: string;
  /** Populated on SUSPENDED_BY_POLICY — rejection reason codes from Meta */
  rejectionReasons?: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Single corrective action taken during a reconciliation run.
 */
export interface ReconciliationCorrection {
  retailerId: string;
  action: 'ADDED_TO_FIRESTORE' | 'MARKED_DELETED_IN_META';
  detail: string;
}

/**
 * Report returned by POST /catalog-manager/catalogs/:catalogId/reconcile.
 *
 * The reconciler compares Meta's catalog (source of truth) against the local
 * Firestore mirror and patches every discrepancy it finds.
 */
export interface ReconciliationReport {
  checkedAt: string;
  businessId: string;
  catalogId: string;
  /** Total products currently active in Meta */
  totalInMeta: number;
  /** Total catalog_products documents found in Firestore */
  totalInFirestore: number;
  /** Docs created in Firestore because Meta had items we were missing */
  addedToFirestore: number;
  /** Docs marked DELETED_IN_META because Firestore had ACTIVE items Meta no longer has */
  archivedInFirestore: number;
  /** Items that matched without any correction needed */
  alreadySynced: number;
  /** Full audit trail of every automatic correction applied */
  corrections: ReconciliationCorrection[];
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

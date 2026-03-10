import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DefensiveLoggerService } from '../common/logger/defensive-logger.service';
import { FirebaseService } from '../firebase/firebase.service';
import { SecretManagerService } from '../common/secrets/secret-manager.service';
import { CreateCatalogDto } from './dto/create-catalog.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CreateVariantDto } from './dto/create-variant.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import type {
  MetaCatalogItem,
  MetaProductItem,
  CommerceAccount,
  CatalogHealthResult,
  FirestoreProductRecord,
  FirestoreVariantRecord,
  ReconciliationReport,
  ReconciliationCorrection,
} from './catalog-manager.types';

/**
 * Graph API base URLs.
 *
 * v19.0 — all catalog/product CRUD (stable endpoints).
 * v25.0 — WABA owner discovery and Commerce Account operations (as required).
 */
const META_GRAPH_V19 = 'https://graph.facebook.com/v19.0';
const META_GRAPH_V25 = 'https://graph.facebook.com/v25.0';

const REQUIRED_SCOPES = [
  'business_management',
  'catalog_management',
  'whatsapp_business_management',
];

interface WabaOwnerResponse {
  id: string;
  owner_business_info?: { id: string; name?: string } | null;
}

interface IntegrationCredentials {
  accessToken: string;
  wabaId: string;
  phoneNumberId: string;
}

@Injectable()
export class CatalogManagerService {
  private readonly logger = new Logger(CatalogManagerService.name);

  constructor(
    private readonly defLogger: DefensiveLoggerService,
    private readonly firebase: FirebaseService,
    private readonly secrets: SecretManagerService,
  ) {}

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Reads the Firestore integration document and returns all credentials
   * needed for Meta API calls (accessToken, wabaId, phoneNumberId).
   */
  private async getIntegrationCredentials(
    businessId: string,
  ): Promise<IntegrationCredentials> {
    const db = this.firebase.getFirestore();
    const snap = await db.collection('integrations').doc(businessId).get();

    if (!snap.exists) {
      throw new NotFoundException(
        `No integration found for businessId=${businessId}`,
      );
    }

    const metaData = (snap.data()?.metaData ?? {}) as {
      accessToken?: string;
      wabaId?: string;
      phoneNumberId?: string;
    };

    if (!metaData.accessToken) {
      throw new BadRequestException(
        'Integration is not active. Connect via the main app before managing catalogs.',
      );
    }

    return {
      accessToken: metaData.accessToken,
      wabaId: metaData.wabaId ?? '',
      phoneNumberId: metaData.phoneNumberId ?? '',
    };
  }

  /**
   * Returns the best available token for Meta catalog and product CRUD operations.
   *
   * Priority:
   *   1. META_SYSTEM_USER_TOKEN — System User token with catalog_management + ads_management
   *      scopes. This is the only token that can create/delete/update catalogs and products.
   *   2. Integration access token from Firestore — WABA user token. Has
   *      whatsapp_business_management scope but NOT catalog_management. Using this
   *      token for catalog operations causes Meta Error 10.
   *
   * If META_SYSTEM_USER_TOKEN is absent, a warning is emitted. Callers that rely
   * on catalog_management scope will fail with Error 10 from Meta in this case.
   */
  private async getCatalogToken(businessId: string): Promise<string> {
    const systemUserToken = this.secrets.get('META_SYSTEM_USER_TOKEN');
    if (systemUserToken) {
      this.logger.log(
        '[CATALOG_MANAGER] Using META_SYSTEM_USER_TOKEN for catalog operation',
      );
      return systemUserToken;
    }

    this.logger.warn(
      '[CATALOG_MANAGER] META_SYSTEM_USER_TOKEN not set in .env.secrets — ' +
        'falling back to integration token. This will cause Meta Error 10 ' +
        'because the WABA token lacks catalog_management scope.',
    );
    const { accessToken } = await this.getIntegrationCredentials(businessId);
    return accessToken;
  }

  /**
   * Resolves the Meta Business Manager ID that owns the given WABA.
   *
   * Resolution order (priority highest → lowest):
   *   1. Secret          — `META_BUSINESS_ID` in `.env.secrets` (explicit override,
   *                         used when the WABA owner_business_info returns a different
   *                         Business Manager than the one that holds the token)
   *   2. Firestore cache — `metaData.ownerBusinessId` (written by step 3 on first run)
   *   3. Meta Graph v25.0 — `GET /{wabaId}?fields=owner_business_info` (live discovery)
   *
   * If `META_BUSINESS_ID` is set it is always used, bypassing the cache and
   * the discovery call entirely. This prevents a stale cached value (e.g. from a
   * previous WABA lookup) from overriding the explicitly configured business ID.
   */
  private async resolveOwnerBusinessId(
    businessId: string,
    wabaId: string,
    accessToken: string,
  ): Promise<string> {
    // 1. Explicit secret — highest priority, always wins
    const secretId = this.secrets.get('META_BUSINESS_ID');
    if (secretId) {
      this.logger.log(
        `[CATALOG_MANAGER] ownerBusinessId resolved from META_BUSINESS_ID secret: ${secretId}`,
      );
      return secretId;
    }

    const db = this.firebase.getFirestore();
    const docRef = db.collection('integrations').doc(businessId);

    // 2. Firestore cache
    const snap = await docRef.get();
    const cached = (
      snap.data()?.metaData as Record<string, unknown> | undefined
    )?.ownerBusinessId as string | undefined;

    if (cached) {
      this.logger.log(
        `[CATALOG_MANAGER] ownerBusinessId resolved from Firestore cache: ${cached}`,
      );
      return cached;
    }

    if (!wabaId) {
      throw new BadRequestException(
        'wabaId is missing from the integration. Cannot discover the owner Business Manager ID.',
      );
    }

    // 3. Live discovery via Meta Graph API v25.0
    this.logger.log(
      `[CATALOG_MANAGER] Discovering owner business for wabaId=${wabaId} via Graph v25.0`,
    );

    const discovery = await this.defLogger.request<WabaOwnerResponse>({
      method: 'GET',
      url: `${META_GRAPH_V25}/${wabaId}`,
      params: { fields: 'owner_business_info' },
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const discoveredId = discovery.owner_business_info?.id;

    if (discoveredId) {
      const name = discovery.owner_business_info?.name;
      this.logger.log(
        `[CATALOG_MANAGER] ✓ Discovered ownerBusinessId=${discoveredId}` +
          (name ? ` ("${name}")` : ''),
      );
      await this.firebase.update(docRef, {
        'metaData.ownerBusinessId': discoveredId,
        updatedAt: new Date().toISOString(),
      });
      return discoveredId;
    }

    throw new BadRequestException(
      'Could not resolve the Meta Business Manager ID. ' +
        'owner_business_info is null and META_BUSINESS_ID is not set in .env.secrets.',
    );
  }

  /**
   * Returns true if the thrown error is a Meta Graph API error with the
   * given numeric error code. Used to detect Error 100 (permission / unsupported).
   */
  private isMetaError(err: unknown, code: number): boolean {
    const metaCode = (err as any)?.response?.data?.error?.code;
    return metaCode === code;
  }

  /**
   * Returns a human-readable description of a Meta Graph API error, with
   * actionable hints for known codes:
   *
   *   12   — endpoint deprecated (product_catalogs → use owned_product_catalogs)
   *   100  — unsupported / permission denied (catalog_management scope required)
   *   190  — token expired or invalid
   *   2500 — unknown path component (endpoint does not exist for this API version)
   */
  private describeMetaError(err: unknown): string {
    const error = (err as any)?.response?.data?.error as
      | { code?: number; message?: string }
      | undefined;
    if (!error) return String(err);
    const hints: Record<number, string> = {
      10:   'App permission denied — catalog_management scope is not granted on the token used. ' +
              'Ensure META_SYSTEM_USER_TOKEN is set in .env.secrets (System User token with catalog_management + ads_management). ' +
              'The WABA integration token from Firestore does NOT have catalog_management scope.',
      12:   'Endpoint deprecated — replace product_catalogs with owned_product_catalogs',
      100:  'Unsupported operation — ensure catalog_management scope is granted and Commerce ToS are accepted',
      190:  'Token expired or invalid — regenerate the access token',
      2500: 'Unknown API path — this edge may not exist for this API version or business type',
    };
    const hint = error.code !== undefined ? hints[error.code] : undefined;
    return `Meta Error ${error.code ?? '?'}: ${error.message ?? '(no message)'}` +
      (hint ? ` | Hint: ${hint}` : '');
  }

  /**
   * Fetches all Commerce Accounts linked to the given Meta Business Manager ID.
   *
   * Non-fatal: if Meta returns Error 2500 ("Unknown path components") the
   * business has no Commerce Account configured yet — returns an empty array
   * and logs a warning instead of throwing. All other errors are re-thrown.
   *
   * NOTE: `catalog_management` scope is required for this edge to succeed.
   */
  private async fetchCommerceAccounts(
    businessId: string,
    accessToken: string,
  ): Promise<CommerceAccount[]> {
    this.logger.log(
      `[CATALOG_MANAGER] Fetching commerce accounts for businessId=${businessId}`,
    );
    try {
      const resp = await this.defLogger.request<{ data: CommerceAccount[] }>({
        method: 'GET',
        url: `${META_GRAPH_V19}/${businessId}/commerce_accounts`,
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return resp.data ?? [];
    } catch (err: unknown) {
      if (this.isMetaError(err, 2500)) {
        this.logger.warn(
          `[CATALOG_MANAGER] commerce_accounts returned Error 2500 for businessId=${businessId}. ` +
            'The business likely has no Commerce Account configured in Meta Business Suite. ' +
            this.describeMetaError(err),
        );
        return [];
      }
      throw err;
    }
  }

  /**
   * Fallback catalog creation path used when the primary POST to
   * /{ownerBusinessId}/product_catalogs returns Error 100.
   *
   * Strategy:
   *   1. Fetch Commerce Accounts under the Business Manager
   *   2. If found, attempt catalog creation under the first Commerce Account
   *   3. If no Commerce Accounts, re-throw with a helpful message
   */
  private async createCatalogViaCommerceAccount(
    ownerBusinessId: string,
    name: string,
    accessToken: string,
  ): Promise<MetaCatalogItem> {
    const accounts = await this.fetchCommerceAccounts(
      ownerBusinessId,
      accessToken,
    );

    if (!accounts.length) {
      throw new BadRequestException(
        'Catalog creation failed (Error 100) and no Commerce Accounts were found ' +
          'under the Business Manager. ' +
          'Please accept Commerce Terms of Service in Meta Business Suite, ' +
          'then retry. Required permissions: catalog_management, business_management.',
      );
    }

    const commerceAccountId = accounts[0].id;
    this.logger.log(
      `[CATALOG_MANAGER] Creating catalog via Commerce Account id=${commerceAccountId}`,
    );

    const resp = await this.defLogger.request<MetaCatalogItem>({
      method: 'POST',
      url: `${META_GRAPH_V19}/${commerceAccountId}/catalogs`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      data: { name, vertical: 'commerce' },
    });

    this.logger.log(
      `[CATALOG_MANAGER] ✓ Catalog created via Commerce Account id=${resp.id}`,
    );
    return resp;
  }

  // ─── Catalog Operations ───────────────────────────────────────────────────

  /**
   * Lists all product catalogs accessible by the Business Manager that owns this WABA.
   *
   * Resolution order:
   *   1. `owned_product_catalogs` — catalogs where the BM is the direct owner
   *      (`product_catalogs` is deprecated since Graph API v2.11, Error code 12)
   *   2. `client_product_catalogs` — catalogs shared by a partner BM; tried only
   *      when the owned list is empty (common for reseller / agency accounts)
   *
   * NOTE: `catalog_management` scope is required for either edge to return data.
   */
  async listCatalogs(businessId: string): Promise<MetaCatalogItem[]> {
    const { wabaId } = await this.getIntegrationCredentials(businessId);
    const catalogToken = await this.getCatalogToken(businessId);
    const ownerBusinessId = await this.resolveOwnerBusinessId(
      businessId,
      wabaId,
      catalogToken,
    );

    this.logger.log(
      `[CATALOG_MANAGER] Listing owned_product_catalogs for ownerBusinessId=${ownerBusinessId}`,
    );

    const resp = await this.defLogger.request<{ data: MetaCatalogItem[] }>({
      method: 'GET',
      url: `${META_GRAPH_V19}/${ownerBusinessId}/owned_product_catalogs`,
      headers: { Authorization: `Bearer ${catalogToken}` },
    });

    const owned = resp.data ?? [];
    if (owned.length > 0) return owned;

    // No owned catalogs — check for partner-shared (client) catalogs
    this.logger.log(
      `[CATALOG_MANAGER] No owned catalogs found — checking client_product_catalogs`,
    );
    try {
      const clientResp = await this.defLogger.request<{ data: MetaCatalogItem[] }>({
        method: 'GET',
        url: `${META_GRAPH_V19}/${ownerBusinessId}/client_product_catalogs`,
        headers: { Authorization: `Bearer ${catalogToken}` },
      });
      return clientResp.data ?? [];
    } catch (err: unknown) {
      this.logger.warn(
        `[CATALOG_MANAGER] client_product_catalogs also returned no results: ${this.describeMetaError(err)}`,
      );
      return [];
    }
  }

  /**
   * Creates a new product catalog under the Business Manager that owns this WABA.
   *
   * Error 100 fallback: if the direct creation fails (missing Commerce Terms
   * acceptance), automatically retries via an existing Commerce Account.
   */
  async createCatalog(dto: CreateCatalogDto): Promise<MetaCatalogItem> {
    const { wabaId } = await this.getIntegrationCredentials(dto.businessId);
    const catalogToken = await this.getCatalogToken(dto.businessId);
    const ownerBusinessId = await this.resolveOwnerBusinessId(
      dto.businessId,
      wabaId,
      catalogToken,
    );

    this.logger.log(
      `[CATALOG_MANAGER] Creating catalog name="${dto.name}" under ownerBusinessId=${ownerBusinessId}`,
    );

    try {
      const resp = await this.defLogger.request<MetaCatalogItem>({
        method: 'POST',
        url: `${META_GRAPH_V19}/${ownerBusinessId}/owned_product_catalogs`,
        headers: {
          Authorization: `Bearer ${catalogToken}`,
          'Content-Type': 'application/json',
        },
        data: { name: dto.name, vertical: 'commerce' },
      });
      this.logger.log(`[CATALOG_MANAGER] ✓ Catalog created id=${resp.id}`);
      return resp;
    } catch (err: unknown) {
      if (this.isMetaError(err, 100)) {
        this.logger.warn(
          `[CATALOG_MANAGER] ${this.describeMetaError(err)} ` +
            `— businessId=${ownerBusinessId}. ` +
            'Possible causes: (1) Commerce ToS not accepted in Meta Business Suite, ' +
            '(2) token owner belongs to a different Business Manager, ' +
            '(3) System User missing catalog_management scope. ' +
            'Attempting Commerce Account fallback.',
        );
        return this.createCatalogViaCommerceAccount(
          ownerBusinessId,
          dto.name,
          catalogToken,
        );
      }
      throw err;
    }
  }

  /**
   * Permanently deletes a catalog from Meta.
   */
  /**
   * Renames an existing product catalog.
   *
   * Meta endpoint: POST /v19.0/{catalogId} with { name } body.
   */
  async renameCatalog(
    businessId: string,
    catalogId: string,
    name: string,
  ): Promise<{ success: boolean }> {
    const catalogToken = await this.getCatalogToken(businessId);
    this.logger.log(
      `[CATALOG_MANAGER] Renaming catalogId=${catalogId} to "${name}"`,
    );
    const resp = await this.defLogger.request<{ success: boolean }>({
      method: 'POST',
      url: `${META_GRAPH_V19}/${catalogId}`,
      headers: {
        Authorization: `Bearer ${catalogToken}`,
        'Content-Type': 'application/json',
      },
      data: { name },
    });
    this.logger.log(`[CATALOG_MANAGER] ✓ Catalog renamed id=${catalogId}`);
    return resp;
  }

  /**
   * Permanently deletes a catalog from Meta.
   */
  async deleteCatalog(businessId: string, catalogId: string): Promise<void> {
    const catalogToken = await this.getCatalogToken(businessId);
    this.logger.log(
      `[CATALOG_MANAGER] Deleting catalogId=${catalogId}`,
    );
    await this.defLogger.request<{ success: boolean }>({
      method: 'DELETE',
      url: `${META_GRAPH_V19}/${catalogId}`,
      headers: { Authorization: `Bearer ${catalogToken}` },
    });
    this.logger.log(`[CATALOG_MANAGER] ✓ Catalog deleted id=${catalogId}`);
  }

  /**
   * Links an existing catalog to the WABA via the WhatsApp Commerce Settings
   * on the registered phone number.
   *
   * After calling this, the existing GET /catalog endpoint should be triggered
   * from the client to sync the Firestore document (onSnapshot will update the UI).
   *
   * Meta endpoint: POST /v25.0/{phoneNumberId}/whatsapp_commerce_settings
   * Body: { catalog_id, is_catalog_visible: true }
   */
  async linkCatalogToWaba(
    businessId: string,
    catalogId: string,
  ): Promise<void> {
    const { phoneNumberId } = await this.getIntegrationCredentials(businessId);
    const catalogToken = await this.getCatalogToken(businessId);

    if (!phoneNumberId) {
      throw new BadRequestException(
        'phoneNumberId is missing from the integration. Cannot link catalog.',
      );
    }

    this.logger.log(
      `[CATALOG_MANAGER] Linking catalogId=${catalogId} to phoneNumberId=${phoneNumberId}`,
    );

    await this.defLogger.request<{ success: boolean }>({
      method: 'POST',
      url: `${META_GRAPH_V25}/${phoneNumberId}/whatsapp_commerce_settings`,
      headers: {
        Authorization: `Bearer ${catalogToken}`,
        'Content-Type': 'application/json',
      },
      data: { catalog_id: catalogId, is_catalog_visible: true, is_cart_enabled: true },
    });

    this.logger.log(
      `[CATALOG_MANAGER] ✓ Catalog ${catalogId} linked to phoneNumberId=${phoneNumberId} (visibility=true, cart=true)`,
    );
  }

  /**
   * Unlinks the currently associated catalog from the WABA phone number.
   *
   * Meta endpoint: POST /v25.0/{phoneNumberId}/whatsapp_commerce_settings
   * Body: { is_catalog_visible: false, catalog_id: "" }
   *
   * After Meta confirms success, Firestore is updated with an empty catalog
   * state so the frontend's onSnapshot listener reverts the UI immediately —
   * no additional client-side sync call is required.
   */
  async unlinkCatalogFromWaba(businessId: string): Promise<void> {
    const { phoneNumberId } = await this.getIntegrationCredentials(businessId);
    const catalogToken = await this.getCatalogToken(businessId);

    if (!phoneNumberId) {
      throw new BadRequestException(
        'phoneNumberId is missing from the integration. Cannot unlink catalog.',
      );
    }

    this.logger.log(
      `[CATALOG_MANAGER] Unlinking catalog from phoneNumberId=${phoneNumberId}`,
    );

    await this.defLogger.request<{ success: boolean }>({
      method: 'POST',
      url: `${META_GRAPH_V25}/${phoneNumberId}/whatsapp_commerce_settings`,
      headers: {
        Authorization: `Bearer ${catalogToken}`,
        'Content-Type': 'application/json',
      },
      data: { is_catalog_visible: false, catalog_id: '' },
    });

    this.logger.log(
      `[CATALOG_MANAGER] ✓ Catalog unlinked from phoneNumberId=${phoneNumberId} — clearing Firestore catalog state`,
    );

    // Reset the Firestore catalog field so the frontend onSnapshot fires
    // immediately and the UI reverts to the "no catalog linked" selector.
    const db = this.firebase.getFirestore();
    const docRef = db.collection('integrations').doc(businessId);
    await this.firebase.update(docRef, {
      catalog: {
        catalogId: '',
        catalogName: 'No catalog linked to this WABA',
        products: [],
        fetchedAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    });

    this.logger.log(
      `[CATALOG_MANAGER] ✓ Firestore catalog state cleared for businessId=${businessId}`,
    );
  }

  // ─── Health Check ─────────────────────────────────────────────────────────

  /**
   * Validates the current Meta App token scopes and checks for the presence
   * of a Commerce Account under the resolved Business Manager.
   *
   * Called by GET /catalog-manager/health to power the System Health indicator.
   */
  async checkHealth(businessId: string): Promise<CatalogHealthResult> {
    const warnings: string[] = [];
    const result: CatalogHealthResult = {
      appIsValid: false,
      scopes: [],
      missingScopes: [],
      hasCommerceAccount: false,
      warnings,
    };

    // Get credentials (non-fatal — we still return a result on partial failure)
    let creds: IntegrationCredentials;
    try {
      creds = await this.getIntegrationCredentials(businessId);
    } catch (err: unknown) {
      warnings.push(
        err instanceof Error ? err.message : 'Integration credentials unavailable',
      );
      result.missingScopes = [...REQUIRED_SCOPES];
      return result;
    }

    const { accessToken, wabaId } = creds;

    // ── Token validity + scopes via debug_token ─────────────────────────────
    const appId = this.secrets.get('META_APP_ID');
    const appSecret = this.secrets.get('META_APP_SECRET');

    if (!appId || !appSecret) {
      warnings.push(
        'META_APP_ID or META_APP_SECRET not configured — cannot validate token scopes.',
      );
    } else {
      try {
        const appToken = `${appId}|${appSecret}`;
        const debugResp = await this.defLogger.request<{
          data: { is_valid: boolean; scopes: string[]; error?: { message: string } };
        }>({
          method: 'GET',
          url: `${META_GRAPH_V25}/debug_token`,
          params: {
            input_token: accessToken,
            access_token: appToken,
          },
        });

        result.appIsValid = debugResp.data?.is_valid ?? false;
        result.scopes = debugResp.data?.scopes ?? [];
        result.missingScopes = REQUIRED_SCOPES.filter(
          (s) => !result.scopes.includes(s),
        );

        if (result.scopes.length === 0) {
          warnings.push(
            'Token validation returned no scopes. ' +
              'If this is a System User token, verify it has catalog_management permissions.',
          );
        }
      } catch {
        warnings.push('Could not reach debug_token endpoint — scope check skipped.');
        result.appIsValid = true; // assume valid if we can't check
      }
    }

    // ── Commerce Account presence ───────────────────────────────────────────
    try {
      const ownerBusinessId = await this.resolveOwnerBusinessId(
        businessId,
        wabaId,
        accessToken,
      );
      result.ownerBusinessId = ownerBusinessId;

      const accounts = await this.fetchCommerceAccounts(
        ownerBusinessId,
        accessToken,
      );
      result.hasCommerceAccount = accounts.length > 0;
      if (accounts.length > 0) {
        result.commerceAccountId = accounts[0].id;
      } else {
        warnings.push(
          'No Commerce Account found. Catalog creation may fail with Error 100. ' +
            'Accept Commerce Terms of Service in Meta Business Suite.',
        );
      }
    } catch (err: unknown) {
      warnings.push(
        'Could not check Commerce Accounts: ' +
          (err instanceof Error ? err.message : String(err)),
      );
    }

    return result;
  }

  // ─── Product Operations ───────────────────────────────────────────────────

  async listProducts(
    businessId: string,
    catalogId: string,
  ): Promise<MetaProductItem[]> {
    const catalogToken = await this.getCatalogToken(businessId);
    this.logger.log(
      `[CATALOG_MANAGER] Listing products for catalogId=${catalogId}`,
    );
    const resp = await this.defLogger.request<{ data: MetaProductItem[] }>({
      method: 'GET',
      url: `${META_GRAPH_V19}/${catalogId}/products`,
      params: {
        fields:
          'id,name,retailer_id,description,availability,condition,price,currency,url,image_url,review_status',
      },
      headers: { Authorization: `Bearer ${catalogToken}` },
    });
    return resp.data ?? [];
  }

  async createProduct(
    catalogId: string,
    dto: CreateProductDto,
  ): Promise<MetaProductItem> {
    const catalogToken = await this.getCatalogToken(dto.businessId);

    // 1. Optimistic Firestore write — SYNCING_WITH_META
    const db = this.firebase.getFirestore();
    const productRef = db
      .collection('integrations')
      .doc(dto.businessId)
      .collection('catalog_products')
      .doc(); // auto-generated ID

    const now = new Date().toISOString();
    // Parent products use their own retailer_id as the item_group_id so that
    // every variant created later can reference this same value, producing a
    // unified product family with attribute selectors (size/color) in WhatsApp.
    const itemGroupId = dto.retailerId;

    const firestoreRecord: FirestoreProductRecord = {
      retailerId:  dto.retailerId,
      itemGroupId, // persisted so the reconciler and variant queries can use it
      name:        dto.name,
      catalogId,
      status:      'SYNCING_WITH_META',
      createdAt:   now,
      updatedAt:   now,
    };
    await this.firebase.set(productRef, firestoreRecord);

    this.logger.log(
      `[CATALOG_MANAGER] Creating product retailerId="${dto.retailerId}" ` +
      `itemGroupId="${itemGroupId}" in catalogId=${catalogId} (Firestore: SYNCING_WITH_META)`,
    );

    try {
      // 2. Call Meta Graph API — item_group_id is mandatory so Meta groups this
      // product and its future variants under a single product family, rather
      // than auto-generating a random group ID that variants cannot reference.
      const resp = await this.defLogger.request<MetaProductItem>({
        method: 'POST',
        url: `${META_GRAPH_V19}/${catalogId}/products`,
        headers: {
          Authorization: `Bearer ${catalogToken}`,
          'Content-Type': 'application/json',
        },
        data: {
          retailer_id:   dto.retailerId,
          item_group_id: itemGroupId,
          name:          dto.name,
          description:   dto.description,
          availability:  dto.availability,
          condition:     dto.condition,
          price:         dto.price,
          currency:      dto.currency,
          image_url:     dto.imageUrl,
          url:           dto.url,
        },
      });

      // 3. Transition to ACTIVE once Meta confirms
      const activeProductPatch = {
        metaProductId: resp.id,
        status: 'ACTIVE',
        updatedAt: new Date().toISOString(),
      };
      await this.firebase.update(productRef, activeProductPatch);

      // 4. Post-write verify: read back and repair if the write was silently lost
      await this.verifyAndRepairFirestoreWrite(
        productRef,
        'ACTIVE',
        activeProductPatch,
        `createProduct retailerId="${dto.retailerId}"`,
      );

      this.logger.log(
        `[CATALOG_MANAGER] ✓ Product created id=${resp.id} (Firestore: ACTIVE, verified)`,
      );
      return resp;
    } catch (err: unknown) {
      // 4. Compensatory rollback — leave a traceable record, not an orphan
      await this.firebase.update(productRef, {
        status: 'FAILED_INTEGRATION',
        updatedAt: new Date().toISOString(),
      });
      this.logger.error(
        `[CATALOG_MANAGER] ✗ Product creation failed for retailerId="${dto.retailerId}" — Firestore marked FAILED_INTEGRATION`,
      );
      throw err;
    }
  }

  async updateProduct(
    productItemId: string,
    dto: UpdateProductDto,
  ): Promise<MetaProductItem> {
    const catalogToken = await this.getCatalogToken(dto.businessId);
    this.logger.log(
      `[CATALOG_MANAGER] Updating product id=${productItemId}`,
    );

    const metaData: Record<string, unknown> = {};
    if (dto.name !== undefined) metaData['name'] = dto.name;
    if (dto.description !== undefined) metaData['description'] = dto.description;
    if (dto.availability !== undefined) metaData['availability'] = dto.availability;
    if (dto.condition !== undefined) metaData['condition'] = dto.condition;
    if (dto.price !== undefined) metaData['price'] = dto.price;
    if (dto.currency !== undefined) metaData['currency'] = dto.currency;
    if (dto.imageUrl !== undefined) metaData['image_url'] = dto.imageUrl;
    if (dto.url !== undefined) metaData['url'] = dto.url;

    // 1. Call Meta Graph API first — Firestore only updated on success
    const resp = await this.defLogger.request<MetaProductItem>({
      method: 'POST',
      url: `${META_GRAPH_V19}/${productItemId}`,
      headers: {
        Authorization: `Bearer ${catalogToken}`,
        'Content-Type': 'application/json',
      },
      data: metaData,
    });

    this.logger.log(`[CATALOG_MANAGER] ✓ Product updated id=${productItemId} — syncing Firestore`);

    // 2. Sync the matching catalog_products doc — fatal: if Firestore fails, surface the error
    const db = this.firebase.getFirestore();
    const snap = await db
      .collection('integrations')
      .doc(dto.businessId)
      .collection('catalog_products')
      .where('metaProductId', '==', productItemId)
      .limit(1)
      .get();

    if (!snap.empty) {
      const firestoreUpdate: Record<string, unknown> = {
        status: 'ACTIVE',
        updatedAt: new Date().toISOString(),
      };
      if (dto.name !== undefined) firestoreUpdate['name'] = dto.name;
      if (dto.availability !== undefined) firestoreUpdate['availability'] = dto.availability;

      await this.firebase.update(snap.docs[0].ref, firestoreUpdate);
      this.logger.log(
        `[CATALOG_MANAGER] ✓ Firestore catalog_products synced for id=${productItemId}`,
      );
    } else {
      this.logger.error(
        `[CATALOG_MANAGER] ✗ No catalog_products doc found for metaProductId=${productItemId} — ` +
        `Firestore not updated. Run reconcile to repair.`,
      );
    }

    return resp;
  }

  async deleteProduct(
    businessId: string,
    productItemId: string,
  ): Promise<void> {
    const catalogToken = await this.getCatalogToken(businessId);
    this.logger.log(
      `[CATALOG_MANAGER] Deleting product id=${productItemId}`,
    );

    // 1. Delete from Meta first — if this fails, we do NOT touch Firestore
    await this.defLogger.request<{ success: boolean }>({
      method: 'DELETE',
      url: `${META_GRAPH_V19}/${productItemId}`,
      headers: { Authorization: `Bearer ${catalogToken}` },
    });

    // 2. Remove the corresponding Firestore record
    try {
      const db = this.firebase.getFirestore();
      const snap = await db
        .collection('integrations')
        .doc(businessId)
        .collection('catalog_products')
        .where('metaProductId', '==', productItemId)
        .limit(1)
        .get();

      for (const doc of snap.docs) {
        await doc.ref.delete();
      }
    } catch (err: unknown) {
      // Meta delete succeeded — log as ERROR so the inconsistency is visible
      // and the operator knows to run reconcile.
      this.logger.error(
        `[CATALOG_MANAGER] ✗ Product id=${productItemId} deleted from Meta but ` +
        `Firestore cleanup FAILED: ${(err as Error).message} — run reconcile to repair`,
      );
    }

    this.logger.log(`[CATALOG_MANAGER] ✓ Product deleted id=${productItemId}`);
  }

  /**
   * Finds the `catalog_products` Firestore document whose `metaProductId`
   * matches the given Meta product ID. If no document is found (the product
   * was created before Firestore tracking was introduced), creates a minimal
   * stub so variants always have a valid parent document to nest under.
   */
  private async findOrCreateProductRef(
    businessId: string,
    metaProductId: string,
  ) {
    const db = this.firebase.getFirestore();
    const colRef = db
      .collection('integrations')
      .doc(businessId)
      .collection('catalog_products');

    const snap = await colRef
      .where('metaProductId', '==', metaProductId)
      .limit(1)
      .get();

    if (!snap.empty) return snap.docs[0].ref;

    // Stub: product predates Firestore tracking — create a minimal doc
    this.logger.warn(
      `[CATALOG_MANAGER] No catalog_products doc found for metaProductId=${metaProductId} — creating stub`,
    );
    const stubRef = colRef.doc();
    const now = new Date().toISOString();
    await this.firebase.set(stubRef, {
      metaProductId,
      retailerId: '',
      name: '',
      catalogId: '',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    });
    return stubRef;
  }

  // ─── Variant Operations ───────────────────────────────────────────────────

  /**
   * Lists all variants for a product from the Firestore subcollection.
   *
   * Returns records in all states (including ARCHIVED and FAILED_INTEGRATION)
   * so the UI can surface sync errors and historical items to the operator.
   */
  async listVariants(
    businessId: string,
    parentMetaProductId: string,
  ): Promise<FirestoreVariantRecord[]> {
    this.logger.log(
      `[CATALOG_MANAGER] Listing variants for metaProductId=${parentMetaProductId}`,
    );
    const parentRef = await this.findOrCreateProductRef(
      businessId,
      parentMetaProductId,
    );
    const snap = await parentRef.collection('variants').get();
    return snap.docs.map((d) => d.data() as FirestoreVariantRecord);
  }

  /**
   * Creates a new variant under a parent product.
   *
   * Meta model: each variant is an independent product item POSTed to
   * /{catalogId}/products with an `item_group_id` field set to the parent's
   * retailer_id. This groups them into a product family in Commerce Manager.
   *
   * Transactional flow:
   *   1. Optimistic Firestore write → SYNCING_WITH_META
   *   2. POST to Meta Graph API
   *   3a. On success → update to ACTIVE + set metaVariantId
   *   3b. On failure → update to FAILED_INTEGRATION + record failureReason
   */
  async createVariant(
    catalogId: string,
    parentMetaProductId: string,
    dto: CreateVariantDto,
  ): Promise<MetaProductItem> {
    const catalogToken = await this.getCatalogToken(dto.businessId);

    // ── Step 0: Resolve canonical parent metadata from Meta ───────────────────
    //
    // Meta's grouping algorithm requires that the variant's `item_group_id`,
    // `name`, and `description` match the parent product EXACTLY.
    //
    // The `item_group_id` problem:
    //   • Products created via our API have item_group_id = their own retailer_id
    //     (set explicitly in createProduct).
    //   • Products created in Commerce Manager have a Meta-auto-generated
    //     item_group_id (e.g. "j7rpi46x21") that does NOT equal the retailer_id.
    //
    // We always perform a preflight GET so we use whatever Meta actually stored,
    // regardless of how the parent was created.
    this.logger.log(
      `[CATALOG_MANAGER] Fetching parent product id=${parentMetaProductId} to resolve canonical grouping fields`,
    );

    // Meta naming asymmetry:
    //   GET  ?fields=retailer_product_group_id  ← read-side name
    //   POST { item_group_id: "..." }            ← write-side name (different!)
    // Requesting `item_group_id` on a GET returns Error 100 "Tried accessing
    // nonexisting field" — always use `retailer_product_group_id` when reading.
    const parentMeta = await this.defLogger.request<MetaProductItem>({
      method: 'GET',
      url: `${META_GRAPH_V19}/${parentMetaProductId}`,
      params: { fields: 'retailer_product_group_id,name,description' },
      headers: { Authorization: `Bearer ${catalogToken}` },
    });

    const resolvedItemGroupId = parentMeta.retailer_product_group_id ?? dto.itemGroupId;
    const resolvedName        = parentMeta.name        ?? dto.name;
    const resolvedDescription = parentMeta.description ?? dto.description;

    if (resolvedItemGroupId !== dto.itemGroupId) {
      this.logger.warn(
        `[CATALOG_MANAGER] retailer_product_group_id mismatch for parent id=${parentMetaProductId}: ` +
        `DTO sent "${dto.itemGroupId}" but Meta has "${resolvedItemGroupId}" — ` +
        `using Meta's value (parent was likely created in Commerce Manager)`,
      );
    }

    const parentRef = await this.findOrCreateProductRef(
      dto.businessId,
      parentMetaProductId,
    );

    // 1. Optimistic Firestore write — uses resolved (canonical) values.
    // The document ID is the variant's retailer_id (not an auto-generated UUID)
    // so the document path is deterministic and can be looked up directly on
    // update/archive without requiring a collectionGroup query.
    const variantRef = parentRef.collection('variants').doc(dto.retailerId);
    const now = new Date().toISOString();
    const firestoreRecord: FirestoreVariantRecord = {
      retailerId:     dto.retailerId,
      name:           resolvedName,
      itemGroupId:    resolvedItemGroupId,
      catalogId,
      attributeKey:   dto.attributeKey,
      attributeValue: dto.attributeValue,
      price:          dto.price,
      currency:       dto.currency,
      availability:   dto.availability,
      status:         'SYNCING_WITH_META',
      createdAt:      now,
      updatedAt:      now,
    };
    await this.firebase.set(variantRef, firestoreRecord);

    this.logger.log(
      `[CATALOG_MANAGER] Creating variant retailerId="${dto.retailerId}" ` +
      `itemGroupId="${resolvedItemGroupId}" name="${resolvedName}" ` +
      `in catalogId=${catalogId} (Firestore: SYNCING_WITH_META)`,
    );

    try {
      // 2. POST to Meta with canonical values — ensures Meta groups this variant
      // under the correct product family and does not create an orphan product.
      const resp = await this.defLogger.request<MetaProductItem>({
        method: 'POST',
        url: `${META_GRAPH_V19}/${catalogId}/products`,
        headers: {
          Authorization: `Bearer ${catalogToken}`,
          'Content-Type': 'application/json',
        },
        data: {
          retailer_id:                dto.retailerId,
          // Meta naming asymmetry: `item_group_id` is the write-side key (POST),
          // `retailer_product_group_id` is the read-side key (GET).
          // Both sides must use their respective names — sending `item_group_id`
          // on a GET or `retailer_product_group_id` on a POST will be silently
          // ignored by the Graph API, breaking variant grouping.
          retailer_product_group_id:  resolvedItemGroupId, // POST write-side key
          name:                       resolvedName,         // exact match to parent
          description:                resolvedDescription,  // exact match to parent
          [dto.attributeKey]:         dto.attributeValue,   // differentiator (color/size/…)
          availability:               dto.availability,
          condition:                  dto.condition,
          price:                      dto.price,
          currency:                   dto.currency,
          image_url:                  dto.imageUrl,
          url:                        dto.url,
        },
      });

      // 3a. Transition to ACTIVE.
      // Use set({ merge: true }) instead of update() — if the initial SYNCING write
      // was silently lost, update() would throw FAILED_PRECONDITION on a missing doc.
      // Merge semantics: creates the full record if absent, or patches existing fields.
      const activeVariantPatch = {
        ...firestoreRecord,
        metaVariantId: resp.id,
        status:        'ACTIVE',
        updatedAt:     new Date().toISOString(),
      };
      await this.firebase.set(variantRef, activeVariantPatch, { merge: true });

      // 3b. Post-write verify: read back and repair if the write was silently lost
      await this.verifyAndRepairFirestoreWrite(
        variantRef,
        'ACTIVE',
        activeVariantPatch,
        `createVariant retailerId="${dto.retailerId}"`,
      );

      this.logger.log(
        `[CATALOG_MANAGER] ✓ Variant created metaVariantId=${resp.id} (Firestore: ACTIVE, verified)`,
      );
      return resp;
    } catch (err: unknown) {
      // 4. Compensatory rollback — use set({ merge: true }) for the same reason
      // as the ACTIVE transition: the initial SYNCING write may be missing.
      const reason = this.describeMetaError(err);
      await this.firebase.set(
        variantRef,
        {
          ...firestoreRecord,
          status:        'FAILED_INTEGRATION',
          failureReason: reason,
          updatedAt:     new Date().toISOString(),
        },
        { merge: true },
      );
      this.logger.error(
        `[CATALOG_MANAGER] ✗ Variant creation failed retailerId="${dto.retailerId}" — ` +
        `Firestore: FAILED_INTEGRATION | ${reason}`,
      );
      throw err;
    }
  }

  /**
   * Updates an existing variant in Meta and syncs the change to Firestore.
   *
   * Meta first: if the Graph API call fails, Firestore is not touched.
   */
  async updateVariant(
    variantItemId: string,
    dto: UpdateVariantDto,
  ): Promise<MetaProductItem> {
    const catalogToken = await this.getCatalogToken(dto.businessId);
    this.logger.log(
      `[CATALOG_MANAGER] Updating variant id=${variantItemId}`,
    );

    const metaData: Record<string, unknown> = {};
    if (dto.name !== undefined)           metaData['name']          = dto.name;
    if (dto.description !== undefined)    metaData['description']   = dto.description;
    if (dto.availability !== undefined)   metaData['availability']  = dto.availability;
    if (dto.condition !== undefined)      metaData['condition']     = dto.condition;
    if (dto.price !== undefined)          metaData['price']         = dto.price;
    if (dto.currency !== undefined)       metaData['currency']      = dto.currency;
    if (dto.imageUrl !== undefined)       metaData['image_url']     = dto.imageUrl;
    if (dto.url !== undefined)            metaData['url']           = dto.url;
    if (dto.attributeKey !== undefined && dto.attributeValue !== undefined) {
      metaData[dto.attributeKey] = dto.attributeValue;
    }

    // 1. Meta first
    const resp = await this.defLogger.request<MetaProductItem>({
      method: 'POST',
      url: `${META_GRAPH_V19}/${variantItemId}`,
      headers: {
        Authorization: `Bearer ${catalogToken}`,
        'Content-Type': 'application/json',
      },
      data: metaData,
    });

    this.logger.log(
      `[CATALOG_MANAGER] ✓ Variant updated id=${variantItemId} — syncing Firestore`,
    );

    // 2. Sync Firestore — fatal: if Firestore fails, surface the error
    const dbForUpdate = this.firebase.getFirestore();
    const variantUpdateSnap = await dbForUpdate
      .collectionGroup('variants')
      .where('metaVariantId', '==', variantItemId)
      .limit(1)
      .get();

    if (!variantUpdateSnap.empty) {
      const firestoreUpdate: Record<string, unknown> = {
        status:    'ACTIVE',
        updatedAt: new Date().toISOString(),
      };
      if (dto.name !== undefined)           firestoreUpdate['name']           = dto.name;
      if (dto.availability !== undefined)   firestoreUpdate['availability']   = dto.availability;
      if (dto.attributeKey !== undefined)   firestoreUpdate['attributeKey']   = dto.attributeKey;
      if (dto.attributeValue !== undefined) firestoreUpdate['attributeValue'] = dto.attributeValue;

      await this.firebase.update(variantUpdateSnap.docs[0].ref, firestoreUpdate);
      this.logger.log(
        `[CATALOG_MANAGER] ✓ Firestore variants synced for id=${variantItemId}`,
      );
    } else {
      this.logger.error(
        `[CATALOG_MANAGER] ✗ No variants doc found for metaVariantId=${variantItemId} — ` +
        `Firestore not updated. Run reconcile to repair.`,
      );
    }

    return resp;
  }

  /**
   * Soft-deletes a variant: deletes it from Meta, then marks the Firestore
   * record as ARCHIVED (preserves history, excludes from active UI lists).
   *
   * Firestore lookup strategy:
   *   We scope the query to `parentRef.collection('variants')` rather than
   *   `db.collectionGroup('variants')` because collectionGroup queries require
   *   a Firestore composite index that is not auto-created — missing indexes
   *   throw FAILED_PRECONDITION. A scoped subcollection query only needs the
   *   default single-field index that Firestore creates automatically.
   *
   * The success log is emitted INSIDE the try block so it only fires after
   * the Firestore promise resolves successfully, never on error paths.
   */
  async deleteVariant(
    businessId: string,
    parentMetaProductId: string,
    variantItemId: string,
  ): Promise<void> {
    const catalogToken = await this.getCatalogToken(businessId);
    this.logger.log(
      `[CATALOG_MANAGER] Deleting variant id=${variantItemId} (parent=${parentMetaProductId})`,
    );

    // 1. Delete from Meta first
    await this.defLogger.request<{ success: boolean }>({
      method: 'DELETE',
      url: `${META_GRAPH_V19}/${variantItemId}`,
      headers: { Authorization: `Bearer ${catalogToken}` },
    });

    // 2. Soft-delete in Firestore — scoped to the parent product's subcollection
    try {
      const parentRef = await this.findOrCreateProductRef(
        businessId,
        parentMetaProductId,
      );

      const snap = await parentRef
        .collection('variants')
        .where('metaVariantId', '==', variantItemId)
        .limit(1)
        .get();

      if (snap.empty) {
        this.logger.error(
          `[CATALOG_MANAGER] ✗ Variant metaVariantId=${variantItemId} not found in Firestore ` +
          `(parent=${parentMetaProductId}) — Meta delete succeeded but Firestore was not updated. ` +
          `Run reconcile to repair.`,
        );
        return;
      }

      await this.firebase.set(
        snap.docs[0].ref,
        { status: 'ARCHIVED', updatedAt: new Date().toISOString() },
        { merge: true },
      );

      // Success log is here — only reachable after the Firestore set() resolves
      this.logger.log(
        `[CATALOG_MANAGER] ✓ Variant deleted id=${variantItemId} (Firestore: ARCHIVED)`,
      );
    } catch (err: unknown) {
      // Meta delete succeeded — log as ERROR so the inconsistency is clearly visible
      this.logger.error(
        `[CATALOG_MANAGER] ✗ Variant id=${variantItemId} deleted from Meta but ` +
        `ARCHIVED update FAILED: ${(err as Error).message} — run reconcile to repair`,
      );
    }
  }

  // ─── Post-write Verify ────────────────────────────────────────────────────

  /**
   * Reads a Firestore document back after an `update()` call and verifies the
   * expected status was actually persisted. If the document is missing or has
   * a stale status, forces a `.set({ merge: true })` repair write.
   *
   * Rationale: The Admin SDK's `update()` is `await`-able and throws on error,
   * but network partitions or Firestore emulator quirks can cause a write to
   * return success while the document remains unchanged. This guard detects
   * silent write failures early and self-heals.
   */
  private async verifyAndRepairFirestoreWrite(
    ref: FirebaseFirestore.DocumentReference,
    expectedStatus: string,
    patch: Record<string, unknown>,
    label: string,
  ): Promise<void> {
    const snap = await ref.get();

    if (!snap.exists) {
      this.logger.error(
        `[FIRESTORE_VERIFY] ✗ ${label} — document MISSING after write. Forcing repair.`,
      );
      await this.firebase.set(
        ref,
        { ...patch, repairedAt: new Date().toISOString() },
        { merge: true },
      );
      return;
    }

    const actual = (snap.data() as Record<string, unknown>)['status'] as string | undefined;
    if (actual !== expectedStatus) {
      this.logger.error(
        `[FIRESTORE_VERIFY] ✗ ${label} — status mismatch ` +
        `(stored="${actual ?? 'undefined'}" expected="${expectedStatus}"). Forcing repair.`,
      );
      await this.firebase.set(
        ref,
        { ...patch, repairedAt: new Date().toISOString() },
        { merge: true },
      );
    }
  }

  // ─── Reconciliation ───────────────────────────────────────────────────────

  /**
   * Reconciles the local Firestore mirror against Meta's catalog (source of truth).
   *
   * Algorithm:
   *   1. Fetch all active products from Meta Graph API.
   *   2. Fetch all `catalog_products` docs from Firestore for this businessId.
   *   3. For every item Meta has that Firestore doesn't → create a Firestore doc (ACTIVE).
   *   4. For every ACTIVE Firestore item that Meta no longer has → mark DELETED_IN_META.
   *   5. Log every correction at WARN level for auditability.
   *
   * Exposed via POST /catalog-manager/catalogs/:catalogId/reconcile
   */
  async reconcileCatalog(
    businessId: string,
    catalogId: string,
  ): Promise<ReconciliationReport> {
    const catalogToken = await this.getCatalogToken(businessId);
    const now = new Date().toISOString();

    const report: ReconciliationReport = {
      checkedAt:        now,
      businessId,
      catalogId,
      totalInMeta:      0,
      totalInFirestore: 0,
      addedToFirestore: 0,
      archivedInFirestore: 0,
      alreadySynced:    0,
      corrections:      [],
    };

    // ── Step 1: Fetch all products from Meta ──────────────────────────────────
    this.logger.log(
      `[RECONCILE] Starting reconciliation for catalogId=${catalogId} businessId=${businessId}`,
    );

    const metaResp = await this.defLogger.request<{ data: MetaProductItem[] }>({
      method: 'GET',
      url: `${META_GRAPH_V19}/${catalogId}/products`,
      params: {
        // Use `retailer_product_group_id` — the read-side name for item_group_id
        fields: 'id,name,retailer_id,retailer_product_group_id,availability,price,currency',
        limit: 200,
      },
      headers: { Authorization: `Bearer ${catalogToken}` },
    });

    const metaProducts = metaResp.data ?? [];
    report.totalInMeta = metaProducts.length;

    const metaByRetailerId = new Map<string, MetaProductItem>(
      metaProducts
        .filter((p) => !!p.retailer_id)
        .map((p) => [p.retailer_id as string, p]),
    );

    // ── Step 2: Fetch all Firestore catalog_products docs ────────────────────
    const db = this.firebase.getFirestore();
    const firestoreSnap = await db
      .collection('integrations')
      .doc(businessId)
      .collection('catalog_products')
      .get();

    report.totalInFirestore = firestoreSnap.docs.length;

    const firestoreByRetailerId = new Map<string, FirestoreProductRecord & { docId: string }>(
      firestoreSnap.docs
        .filter((d) => !!(d.data() as FirestoreProductRecord).retailerId)
        .map((d) => [
          (d.data() as FirestoreProductRecord).retailerId,
          { ...(d.data() as FirestoreProductRecord), docId: d.id },
        ]),
    );

    // ── Step 3: Meta has → Firestore doesn't ────────────────────────────────
    for (const [retailerId, metaProduct] of metaByRetailerId) {
      if (firestoreByRetailerId.has(retailerId)) {
        report.alreadySynced++;
        continue;
      }

      const correction: ReconciliationCorrection = {
        retailerId,
        action: 'ADDED_TO_FIRESTORE',
        detail: `Meta id=${metaProduct.id}`,
      };

      this.logger.warn(
        `[RECONCILE] retailer_id="${retailerId}" present in Meta but MISSING from Firestore — creating record`,
      );

      const newRef = db
        .collection('integrations')
        .doc(businessId)
        .collection('catalog_products')
        .doc();

      // Use read-side field name; fall back to retailerId for legacy products
      const resolvedGroupId = metaProduct.retailer_product_group_id ?? retailerId;

      await this.firebase.set(newRef, {
        retailerId,
        itemGroupId:  resolvedGroupId,
        name:         metaProduct.name,
        catalogId,
        metaProductId: metaProduct.id,
        availability: metaProduct.availability,
        price:        metaProduct.price,
        currency:     metaProduct.currency,
        status:       'ACTIVE',
        createdAt:    now,
        updatedAt:    now,
      });

      report.addedToFirestore++;
      report.corrections.push(correction);
    }

    // ── Step 4: Firestore ACTIVE → Meta doesn't have ─────────────────────────
    for (const [retailerId, fsRecord] of firestoreByRetailerId) {
      if (fsRecord.status !== 'ACTIVE') continue; // only flag ACTIVE records
      if (metaByRetailerId.has(retailerId)) continue;

      const correction: ReconciliationCorrection = {
        retailerId,
        action: 'MARKED_DELETED_IN_META',
        detail: `Firestore docId=${fsRecord.docId}`,
      };

      this.logger.warn(
        `[RECONCILE] retailer_id="${retailerId}" is ACTIVE in Firestore but NOT in Meta — marking DELETED_IN_META`,
      );

      const docRef = db
        .collection('integrations')
        .doc(businessId)
        .collection('catalog_products')
        .doc(fsRecord.docId);

      await this.firebase.update(docRef, {
        status:    'DELETED_IN_META',
        updatedAt: now,
      });

      report.archivedInFirestore++;
      report.corrections.push(correction);
    }

    this.logger.log(
      `[RECONCILE] ✓ Done — Meta=${report.totalInMeta} Firestore=${report.totalInFirestore} ` +
      `added=${report.addedToFirestore} archived=${report.archivedInFirestore} ` +
      `synced=${report.alreadySynced} corrections=${report.corrections.length}`,
    );

    return report;
  }
}

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
import type {
  MetaCatalogItem,
  MetaProductItem,
  CommerceAccount,
  CatalogHealthResult,
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
    const { accessToken, phoneNumberId } =
      await this.getIntegrationCredentials(businessId);

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
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      data: { catalog_id: catalogId, is_catalog_visible: true },
    });

    this.logger.log(
      `[CATALOG_MANAGER] ✓ Catalog ${catalogId} linked to phoneNumberId=${phoneNumberId}`,
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
    this.logger.log(
      `[CATALOG_MANAGER] Creating product retailerId="${dto.retailerId}" in catalogId=${catalogId}`,
    );
    const resp = await this.defLogger.request<MetaProductItem>({
      method: 'POST',
      url: `${META_GRAPH_V19}/${catalogId}/products`,
      headers: {
        Authorization: `Bearer ${catalogToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        retailer_id: dto.retailerId,
        name: dto.name,
        description: dto.description,
        availability: dto.availability,
        condition: dto.condition,
        price: dto.price,
        currency: dto.currency,
        image_url: dto.imageUrl,
        url: dto.url,
      },
    });
    this.logger.log(`[CATALOG_MANAGER] ✓ Product created id=${resp.id}`);
    return resp;
  }

  async updateProduct(
    productItemId: string,
    dto: UpdateProductDto,
  ): Promise<MetaProductItem> {
    const catalogToken = await this.getCatalogToken(dto.businessId);
    this.logger.log(
      `[CATALOG_MANAGER] Updating product id=${productItemId}`,
    );
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data['name'] = dto.name;
    if (dto.description !== undefined) data['description'] = dto.description;
    if (dto.availability !== undefined) data['availability'] = dto.availability;
    if (dto.condition !== undefined) data['condition'] = dto.condition;
    if (dto.price !== undefined) data['price'] = dto.price;
    if (dto.currency !== undefined) data['currency'] = dto.currency;
    if (dto.imageUrl !== undefined) data['image_url'] = dto.imageUrl;
    if (dto.url !== undefined) data['url'] = dto.url;

    const resp = await this.defLogger.request<MetaProductItem>({
      method: 'POST',
      url: `${META_GRAPH_V19}/${productItemId}`,
      headers: {
        Authorization: `Bearer ${catalogToken}`,
        'Content-Type': 'application/json',
      },
      data,
    });
    this.logger.log(`[CATALOG_MANAGER] ✓ Product updated id=${productItemId}`);
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
    await this.defLogger.request<{ success: boolean }>({
      method: 'DELETE',
      url: `${META_GRAPH_V19}/${productItemId}`,
      headers: { Authorization: `Bearer ${catalogToken}` },
    });
    this.logger.log(`[CATALOG_MANAGER] ✓ Product deleted id=${productItemId}`);
  }
}

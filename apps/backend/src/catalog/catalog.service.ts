import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DefensiveLoggerService } from '../common/logger/defensive-logger.service';
import { FirebaseService } from '../firebase/firebase.service';
import { SecretManagerService } from '../common/secrets/secret-manager.service';

interface MetaCatalogItem {
  id: string;
  name: string;
  vertical?: string;
}

interface MetaProduct {
  id: string;
  name: string;
  retailer_id?: string;
  availability?: string;
  price?: string;
  currency?: string;
  /** Product image URL as returned by the Meta Graph API v25.0 ProductItem object.
   *  Optional — Meta omits the field entirely for products without a configured image. */
  image_url?: string;
}

export interface CatalogData {
  catalogId: string;
  catalogName: string;
  products: MetaProduct[];
  fetchedAt: string;
}

@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    private readonly defLogger: DefensiveLoggerService,
    private readonly firebase: FirebaseService,
    private readonly secrets: SecretManagerService,
  ) {}

  async getCatalog(businessId: string): Promise<CatalogData> {
    const db = this.firebase.getFirestore();
    const docRef = db.collection('integrations').doc(businessId);
    const snap = await docRef.get();

    if (!snap.exists) {
      throw new NotFoundException(
        `No integration found for businessId=${businessId}`,
      );
    }

    const { accessToken, wabaId } = (snap.data()?.metaData ?? {}) as {
      accessToken?: string;
      wabaId?: string;
    };

    if (!accessToken || !wabaId) {
      throw new BadRequestException(
        'Integration is not fully connected. accessToken or wabaId missing.',
      );
    }

    const businessIdMeta = this.secrets.get('META_BUSINESS_ID') || businessId;
    
    // 🔥 EL SECRETO ESTÁ AQUÍ: Usamos el System Token para tener permisos de ver los catálogos
    const systemToken = this.secrets.get('META_SYSTEM_USER_TOKEN') || accessToken;

    this.logger.log(`[CATALOG] Fetching catalogs for businessId=${businessIdMeta} using System Token`);

    // Step 1 — Buscamos catálogos propios con el SYSTEM TOKEN
    let catalogsResp = await this.defLogger.request<{
      data: MetaCatalogItem[];
    }>({
      method: 'GET',
      url: `https://graph.facebook.com/v25.0/${businessIdMeta}/owned_product_catalogs`,
      headers: { Authorization: `Bearer ${systemToken}` },
    });

    let catalogs = catalogsResp.data ?? [];

    // Plan B — Si no hay propios, buscamos los compartidos/clientes con el SYSTEM TOKEN
    if (catalogs.length === 0) {
      this.logger.log(`[CATALOG] No owned catalogs, checking client_product_catalogs...`);
      const clientCatalogsResp = await this.defLogger.request<{
        data: MetaCatalogItem[];
      }>({
        method: 'GET',
        url: `https://graph.facebook.com/v25.0/${businessIdMeta}/client_product_catalogs`,
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      catalogs = clientCatalogsResp.data ?? [];
    }

    if (!catalogs.length) {
      this.logger.warn(
        `[CATALOG] No catalog found (owned or client) for businessId=${businessIdMeta}. Configure a catalog in Meta Commerce Manager.`,
      );
      const empty: CatalogData = {
        catalogId: '',
        catalogName: 'No catalog linked to this WABA',
        products: [],
        fetchedAt: new Date().toISOString(),
      };
      await this.firebase.update(docRef, { catalog: empty, updatedAt: new Date().toISOString() });
      return empty;
    }

    // Tomamos el primer catálogo que encuentre el negocio
    const firstCatalog = catalogs[0];
    this.logger.log(
      `[CATALOG] Found catalog id=${firstCatalog.id} name="${firstCatalog.name}"`,
    );

    // Step 2 — Descargamos los productos usando también el SYSTEM TOKEN
    const productsResp = await this.defLogger.request<{ data: MetaProduct[] }>(
      {
        method: 'GET',
        url: `https://graph.facebook.com/v25.0/${firstCatalog.id}/products`,
        params: { fields: 'id,name,retailer_id,availability,price,currency,image_url' },
        headers: { Authorization: `Bearer ${systemToken}` },
      },
    );

    const catalogData: CatalogData = {
      catalogId: firstCatalog.id,
      catalogName: firstCatalog.name,
      products: productsResp.data ?? [],
      fetchedAt: new Date().toISOString(),
    };

    this.logger.log(
      `[CATALOG] ✓ Stored ${catalogData.products.length} product(s) for businessId=${businessId}`,
    );

    await this.firebase.update(docRef, {
      catalog: catalogData,
      updatedAt: new Date().toISOString(),
    });

    return catalogData;
  }
}
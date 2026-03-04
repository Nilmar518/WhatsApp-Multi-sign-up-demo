import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DefensiveLoggerService } from '../common/logger/defensive-logger.service';
import { FirebaseService } from '../firebase/firebase.service';

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

    this.logger.log(`[CATALOG] Fetching catalogs for wabaId=${wabaId}`);

    // Step 1 — List catalogs linked to the WABA
    const catalogsResp = await this.defLogger.request<{
      data: MetaCatalogItem[];
    }>({
      method: 'GET',
      url: `https://graph.facebook.com/v19.0/${wabaId}/owned_product_catalogs`,
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const catalogs = catalogsResp.data ?? [];

    if (!catalogs.length) {
      this.logger.warn(
        `[CATALOG] No catalog linked to wabaId=${wabaId}. Configure a catalog in Meta Commerce Manager.`,
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

    const firstCatalog = catalogs[0];
    this.logger.log(
      `[CATALOG] Found catalog id=${firstCatalog.id} name="${firstCatalog.name}"`,
    );

    // Step 2 — Fetch products from the first linked catalog
    const productsResp = await this.defLogger.request<{ data: MetaProduct[] }>(
      {
        method: 'GET',
        url: `https://graph.facebook.com/v19.0/${firstCatalog.id}/products`,
        params: { fields: 'id,name,retailer_id,availability,price,currency' },
        headers: { Authorization: `Bearer ${accessToken}` },
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

    // Persist to Firestore — the frontend onSnapshot will pick this up automatically
    await this.firebase.update(docRef, {
      catalog: catalogData,
      updatedAt: new Date().toISOString(),
    });

    return catalogData;
  }
}

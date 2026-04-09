import {
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { DefensiveLoggerService } from '../common/logger/defensive-logger.service';
import { FirebaseService } from '../firebase/firebase.service';
import { SecretManagerService } from '../common/secrets/secret-manager.service';
import { META_API } from '../integrations/meta/meta-api-versions';

interface MetaCatalogItem {
  id: string;
  name: string;
  vertical?: string;
}

interface MetaCatalogDetail {
  id: string;
  name?: string;
}

interface MetaCatalogListResponse {
  data: MetaCatalogItem[];
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

interface DeepSyncResult {
  catalogs: MetaCatalogItem[];
  productsByCatalogId: Map<string, MetaProduct[]>;
}

@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    private readonly defLogger: DefensiveLoggerService,
    private readonly firebase: FirebaseService,
    private readonly secrets: SecretManagerService,
  ) {}

  async getCatalog(businessId: string, catalogId?: string): Promise<CatalogData> {
    const now = new Date().toISOString();
    const businessIdMeta = await this.resolveMetaBusinessId(businessId);
    const systemToken = this.secrets.get('META_SYSTEM_USER_TOKEN');
    if (!systemToken) {
      throw new BadRequestException(
        'META_SYSTEM_USER_TOKEN is required to sync centralized catalogs.',
      );
    }

    const deepSync = await this.syncCatalogDiscovery(
      businessIdMeta,
      systemToken,
      now,
    );
    const discoveredCatalogs = deepSync.catalogs;

    if (!discoveredCatalogs.length) {
      return {
        catalogId: '',
        catalogName: 'No catalog linked to this business',
        products: [],
        fetchedAt: now,
      };
    }

    if (!catalogId) {
      await this.ensureOneActiveCatalog(businessIdMeta, discoveredCatalogs, now);

      const activeCatalog = await this.resolveActiveCatalog(businessIdMeta);
      const activeProducts = activeCatalog
        ? (deepSync.productsByCatalogId.get(activeCatalog.catalogId) ?? [])
        : [];

      return {
        catalogId: activeCatalog?.catalogId ?? '',
        catalogName: activeCatalog?.catalogName ?? 'Catalog discovery synced',
        products: activeProducts,
        fetchedAt: now,
      };
    }

    return this.activateCatalogAndReturnSyncedData(
      businessIdMeta,
      catalogId,
      deepSync,
      now,
    );
  }

  private async resolveMetaBusinessId(businessIdOrIntegrationId: string): Promise<string> {
    const configuredBusinessId = this.secrets.get('META_BUSINESS_ID');
    if (configuredBusinessId) {
      return configuredBusinessId;
    }

    if (/^\d+$/.test(businessIdOrIntegrationId)) {
      return businessIdOrIntegrationId;
    }

    const db = this.firebase.getFirestore();
    const integrationSnap = await db
      .collection('integrations')
      .doc(businessIdOrIntegrationId)
      .get();

    if (integrationSnap.exists) {
      const data = integrationSnap.data() as { connectedBusinessIds?: string[] };
      const connectedBusinessIds = data.connectedBusinessIds ?? [];
      const numericBusinessId = connectedBusinessIds.find((id) => /^\d+$/.test(id));
      if (numericBusinessId) {
        return numericBusinessId;
      }
      if (connectedBusinessIds[0]) {
        return connectedBusinessIds[0];
      }
    }

    this.logger.warn(
      `[CATALOG] Could not resolve Meta businessId from input=${businessIdOrIntegrationId}; using input as fallback`,
    );
    return businessIdOrIntegrationId;
  }

  private async syncCatalogDiscovery(
    businessIdMeta: string,
    systemToken: string,
    now: string,
  ): Promise<DeepSyncResult> {
    const db = this.firebase.getFirestore();

    this.logger.log(`[CATALOG] Discovery: fetching catalogs for businessId=${businessIdMeta}`);

    const ownedResp = await this.defLogger.request<MetaCatalogListResponse>({
      method: 'GET',
      url: `${META_API.base(META_API.PHONE_CATALOG)}/${businessIdMeta}/owned_product_catalogs`,
      headers: { Authorization: `Bearer ${systemToken}` },
    });

    const clientResp = await this.defLogger.request<MetaCatalogListResponse>({
      method: 'GET',
      url: `${META_API.base(META_API.PHONE_CATALOG)}/${businessIdMeta}/client_product_catalogs`,
      headers: { Authorization: `Bearer ${systemToken}` },
    });

    const mergedCatalogs = [...(ownedResp.data ?? []), ...(clientResp.data ?? [])];
    const catalogs = Array.from(new Map(mergedCatalogs.map((c) => [c.id, c])).values());

    if (!catalogs.length) {
      this.logger.warn(`[CATALOG] Discovery: no catalogs found for businessId=${businessIdMeta}`);
      return {
        catalogs: [],
        productsByCatalogId: new Map<string, MetaProduct[]>(),
      };
    }

    const productsByCatalogId = new Map<string, MetaProduct[]>();

    // Sequential loop to avoid Meta API bursts/rate-limits on businesses with many catalogs.
    for (const c of catalogs) {
      const catalogRef = db.collection('catalogs').doc(c.id);
      await this.firebase.set(
        catalogRef,
        {
          catalogId: c.id,
          name: c.name,
          businessId: businessIdMeta,
          provider: 'META',
          updatedAt: now,
        },
        { merge: true },
      );

      const productsResp = await this.defLogger.request<{ data: MetaProduct[] }>({
        method: 'GET',
        url: `${META_API.base(META_API.PHONE_CATALOG)}/${c.id}/products`,
        params: { fields: 'id,name,retailer_id,availability,price,currency,image_url' },
        headers: { Authorization: `Bearer ${systemToken}` },
      });

      const products = productsResp.data ?? [];
      productsByCatalogId.set(c.id, products);

      const existing = await catalogRef.collection('products').get();
      const batch = db.batch();
      for (const doc of existing.docs) {
        batch.delete(doc.ref);
      }

      for (const p of products) {
        batch.set(catalogRef.collection('products').doc(p.id), {
          productId: p.id,
          metaProductId: p.id,
          retailerId: p.retailer_id ?? p.id,
          name: p.name,
          availability: p.availability,
          price: p.price,
          currency: p.currency,
          image_url: p.image_url,
          updatedAt: now,
        });
      }

      await batch.commit();

      this.logger.log(
        `[CATALOG] Deep sync: catalogId=${c.id} products=${products.length} businessId=${businessIdMeta}`,
      );
    }

    this.logger.log(
      `[CATALOG] Discovery: deep-synced ${catalogs.length} catalog(s) for businessId=${businessIdMeta}`,
    );

    return { catalogs, productsByCatalogId };
  }

  private async activateCatalogAndReturnSyncedData(
    businessIdMeta: string,
    selectedCatalogId: string,
    deepSync: DeepSyncResult,
    now: string,
  ): Promise<CatalogData> {
    const db = this.firebase.getFirestore();

    const catalogRef = db.collection('catalogs').doc(selectedCatalogId);
    const selectedDoc = await catalogRef.get();
    if (!selectedDoc.exists) {
      throw new BadRequestException(
        `catalogId=${selectedCatalogId} was not discovered for businessId=${businessIdMeta}`,
      );
    }

    const selectedName = (selectedDoc.data() as { name?: string } | undefined)?.name;

    await this.firebase.set(
      catalogRef,
      {
        catalogId: selectedCatalogId,
        businessId: businessIdMeta,
        name: selectedName ?? 'Unnamed Catalog',
        provider: 'META',
        fetchedAt: now,
        updatedAt: now,
      },
      { merge: true },
    );

    const activeSnap = await db
      .collection('catalogs')
      .where('businessId', '==', businessIdMeta)
      .get();

    const activeBatch = db.batch();
    for (const doc of activeSnap.docs) {
      activeBatch.set(doc.ref, { isActive: false, updatedAt: now }, { merge: true });
    }
    activeBatch.set(catalogRef, { isActive: true, updatedAt: now }, { merge: true });
    await activeBatch.commit();

    await this.firebase.set(
      db.collection('businesses').doc(businessIdMeta),
      {
        activeCatalogId: selectedCatalogId,
        updatedAt: now,
      },
      { merge: true },
    );

    const selectedProducts = deepSync.productsByCatalogId.get(selectedCatalogId) ?? [];
    const catalogData: CatalogData = {
      catalogId: selectedCatalogId,
      catalogName: selectedName ?? 'Unnamed Catalog',
      products: selectedProducts,
      fetchedAt: now,
    };

    this.logger.log(
      `[CATALOG] Activation: catalogId=${selectedCatalogId} products=${catalogData.products.length} businessId=${businessIdMeta}`,
    );

    return catalogData;
  }

  private async ensureOneActiveCatalog(
    businessIdMeta: string,
    catalogs: MetaCatalogItem[],
    now: string,
  ): Promise<void> {
    if (!catalogs.length) return;

    const db = this.firebase.getFirestore();
    const snap = await db
      .collection('catalogs')
      .where('businessId', '==', businessIdMeta)
      .where('isActive', '==', true)
      .limit(1)
      .get();

    if (!snap.empty) {
      return;
    }

    const fallbackCatalogId = catalogs[0].id;
    await this.firebase.set(
      db.collection('catalogs').doc(fallbackCatalogId),
      {
        isActive: true,
        updatedAt: now,
      },
      { merge: true },
    );

    await this.firebase.set(
      db.collection('businesses').doc(businessIdMeta),
      {
        activeCatalogId: fallbackCatalogId,
        updatedAt: now,
      },
      { merge: true },
    );
  }

  private async resolveActiveCatalog(
    businessIdMeta: string,
  ): Promise<{ catalogId: string; catalogName: string } | null> {
    const db = this.firebase.getFirestore();
    const snap = await db
      .collection('catalogs')
      .where('businessId', '==', businessIdMeta)
      .where('isActive', '==', true)
      .limit(1)
      .get();

    if (snap.empty) {
      return null;
    }

    const doc = snap.docs[0];
    const data = doc.data() as { catalogId?: string; name?: string };
    return {
      catalogId: data.catalogId ?? doc.id,
      catalogName: data.name ?? 'Unnamed Catalog',
    };
  }
}
export interface CatalogProduct {
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
  products: CatalogProduct[];
  fetchedAt: string;
}

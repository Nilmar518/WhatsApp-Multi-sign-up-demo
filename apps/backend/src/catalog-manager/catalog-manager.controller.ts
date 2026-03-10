import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CatalogManagerService } from './catalog-manager.service';
import { CreateCatalogDto } from './dto/create-catalog.dto';
import { UpdateCatalogDto } from './dto/update-catalog.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CreateVariantDto } from './dto/create-variant.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import type {
  MetaCatalogItem,
  MetaProductItem,
  CatalogHealthResult,
  FirestoreVariantRecord,
  ReconciliationReport,
} from './catalog-manager.types';

@Controller('catalog-manager')
export class CatalogManagerController {
  constructor(private readonly catalogManagerService: CatalogManagerService) {}

  // ─── System Health ────────────────────────────────────────────────────────

  /**
   * GET /catalog-manager/health?businessId=X
   *
   * Validates Meta App token scopes and Commerce Account presence.
   * Powers the System Health indicator in the dashboard UI.
   * Never throws — always returns a result with warnings on partial failure.
   */
  @Get('health')
  checkHealth(
    @Query('businessId') businessId: string,
  ): Promise<CatalogHealthResult> {
    return this.catalogManagerService.checkHealth(businessId);
  }

  // ─── Catalog Endpoints ────────────────────────────────────────────────────

  /**
   * GET /catalog-manager/catalogs?businessId=X
   *
   * Lists all product catalogs in the Meta Business account.
   * Used by the catalog selector to let users link an existing catalog
   * instead of creating a duplicate.
   */
  @Get('catalogs')
  listCatalogs(
    @Query('businessId') businessId: string,
  ): Promise<MetaCatalogItem[]> {
    return this.catalogManagerService.listCatalogs(businessId);
  }

  /**
   * POST /catalog-manager/catalogs
   * Body: { businessId, name }
   *
   * Creates a new catalog. Automatically falls back to Commerce Account
   * creation if Error 100 is returned on the primary attempt.
   */
  @Post('catalogs')
  createCatalog(@Body() dto: CreateCatalogDto): Promise<MetaCatalogItem> {
    return this.catalogManagerService.createCatalog(dto);
  }

  /**
   * PATCH /catalog-manager/catalogs/:catalogId
   * Body: { businessId, name }
   *
   * Renames an existing catalog.
   */
  @Patch('catalogs/:catalogId')
  renameCatalog(
    @Param('catalogId') catalogId: string,
    @Body() dto: UpdateCatalogDto,
  ): Promise<{ success: boolean }> {
    return this.catalogManagerService.renameCatalog(
      dto.businessId,
      catalogId,
      dto.name,
    );
  }

  /**
   * DELETE /catalog-manager/catalogs/:catalogId?businessId=X
   *
   * Permanently deletes a catalog and all its products from Meta.
   */
  @Delete('catalogs/:catalogId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteCatalog(
    @Param('catalogId') catalogId: string,
    @Query('businessId') businessId: string,
  ): Promise<void> {
    return this.catalogManagerService.deleteCatalog(businessId, catalogId);
  }

  /**
   * POST /catalog-manager/catalogs/unlink?businessId=X
   *
   * Unlinks the catalog from the WABA phone number (sets is_catalog_visible=false)
   * and clears the Firestore catalog state so the onSnapshot fires immediately.
   *
   * NOTE: Declared before POST catalogs/:catalogId/link so NestJS does not
   * resolve "unlink" as a catalogId path parameter.
   *
   * Meta endpoint: POST /v25.0/{phoneNumberId}/whatsapp_commerce_settings
   */
  @Post('catalogs/unlink')
  @HttpCode(HttpStatus.NO_CONTENT)
  unlinkCatalog(
    @Query('businessId') businessId: string,
  ): Promise<void> {
    return this.catalogManagerService.unlinkCatalogFromWaba(businessId);
  }

  /**
   * POST /catalog-manager/catalogs/:catalogId/link?businessId=X
   *
   * Links an existing catalog to the WABA phone number via WhatsApp Commerce
   * Settings. After this call succeeds, trigger GET /catalog?businessId=X
   * from the client to sync Firestore and enable the onSnapshot update.
   *
   * Meta endpoint: POST /v25.0/{phoneNumberId}/whatsapp_commerce_settings
   */
  @Post('catalogs/:catalogId/link')
  @HttpCode(HttpStatus.NO_CONTENT)
  linkCatalog(
    @Param('catalogId') catalogId: string,
    @Query('businessId') businessId: string,
  ): Promise<void> {
    return this.catalogManagerService.linkCatalogToWaba(businessId, catalogId);
  }

  // ─── Product Endpoints ────────────────────────────────────────────────────

  /**
   * GET /catalog-manager/catalogs/:catalogId/products?businessId=X
   */
  @Get('catalogs/:catalogId/products')
  listProducts(
    @Param('catalogId') catalogId: string,
    @Query('businessId') businessId: string,
  ): Promise<MetaProductItem[]> {
    return this.catalogManagerService.listProducts(businessId, catalogId);
  }

  /**
   * POST /catalog-manager/catalogs/:catalogId/products
   * Body: CreateProductDto
   */
  @Post('catalogs/:catalogId/products')
  createProduct(
    @Param('catalogId') catalogId: string,
    @Body() dto: CreateProductDto,
  ): Promise<MetaProductItem> {
    return this.catalogManagerService.createProduct(catalogId, dto);
  }

  /**
   * PUT /catalog-manager/catalogs/:catalogId/products/:productItemId
   * Body: UpdateProductDto (all fields optional except businessId)
   */
  @Put('catalogs/:catalogId/products/:productItemId')
  updateProduct(
    @Param('productItemId') productItemId: string,
    @Body() dto: UpdateProductDto,
  ): Promise<MetaProductItem> {
    return this.catalogManagerService.updateProduct(productItemId, dto);
  }

  /**
   * DELETE /catalog-manager/catalogs/:catalogId/products/:productItemId?businessId=X
   */
  @Delete('catalogs/:catalogId/products/:productItemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteProduct(
    @Param('productItemId') productItemId: string,
    @Query('businessId') businessId: string,
  ): Promise<void> {
    return this.catalogManagerService.deleteProduct(businessId, productItemId);
  }

  // ─── Variant Endpoints ────────────────────────────────────────────────────

  /**
   * GET /catalog-manager/catalogs/:catalogId/products/:productId/variants?businessId=X
   *
   * Lists all variants for a product from Firestore (all states, including
   * FAILED_INTEGRATION and ARCHIVED, so the operator can see the full history).
   */
  @Get('catalogs/:catalogId/products/:productId/variants')
  listVariants(
    @Param('productId') productId: string,
    @Query('businessId') businessId: string,
  ): Promise<FirestoreVariantRecord[]> {
    return this.catalogManagerService.listVariants(businessId, productId);
  }

  /**
   * POST /catalog-manager/catalogs/:catalogId/products/:productId/variants
   * Body: CreateVariantDto
   *
   * Creates a new variant. Sends to Meta with item_group_id = parent's
   * retailer_id, then writes ACTIVE record to Firestore variants subcollection.
   */
  @Post('catalogs/:catalogId/products/:productId/variants')
  createVariant(
    @Param('catalogId') catalogId: string,
    @Param('productId') productId: string,
    @Body() dto: CreateVariantDto,
  ): Promise<MetaProductItem> {
    return this.catalogManagerService.createVariant(catalogId, productId, dto);
  }

  /**
   * PUT /catalog-manager/catalogs/:catalogId/products/:productId/variants/:variantItemId
   * Body: UpdateVariantDto
   *
   * Updates a variant in Meta then syncs the diff to Firestore.
   */
  @Put('catalogs/:catalogId/products/:productId/variants/:variantItemId')
  updateVariant(
    @Param('variantItemId') variantItemId: string,
    @Body() dto: UpdateVariantDto,
  ): Promise<MetaProductItem> {
    return this.catalogManagerService.updateVariant(variantItemId, dto);
  }

  /**
   * DELETE /catalog-manager/catalogs/:catalogId/products/:productId/variants/:variantItemId?businessId=X
   *
   * Deletes from Meta then soft-deletes (ARCHIVED) in Firestore.
   */
  @Delete('catalogs/:catalogId/products/:productId/variants/:variantItemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteVariant(
    @Param('productId') productId: string,
    @Param('variantItemId') variantItemId: string,
    @Query('businessId') businessId: string,
  ): Promise<void> {
    return this.catalogManagerService.deleteVariant(businessId, productId, variantItemId);
  }

  // ─── Reconciliation ───────────────────────────────────────────────────────

  /**
   * POST /catalog-manager/catalogs/:catalogId/reconcile?businessId=X
   *
   * Compares Meta's catalog (source of truth) against the Firestore mirror and
   * patches every discrepancy:
   *   • Items in Meta but not Firestore → created in Firestore as ACTIVE
   *   • Items ACTIVE in Firestore but absent in Meta → marked DELETED_IN_META
   *
   * Returns a full audit report. Every correction is also logged at WARN level.
   * Safe to call at any time — idempotent when there are no discrepancies.
   */
  @Post('catalogs/:catalogId/reconcile')
  reconcileCatalog(
    @Param('catalogId') catalogId: string,
    @Query('businessId') businessId: string,
  ): Promise<ReconciliationReport> {
    return this.catalogManagerService.reconcileCatalog(businessId, catalogId);
  }
}

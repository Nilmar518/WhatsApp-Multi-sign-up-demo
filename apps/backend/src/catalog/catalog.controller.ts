import { Controller, Get, Query } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CatalogQueryDto } from './dto/catalog-query.dto';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  /**
   * GET /catalog?businessId={id}
   *
   * Fetches the product catalog from Meta for the given integration,
   * persists it to Firestore (triggering a real-time UI update via onSnapshot),
   * and returns the full catalog data.
   *
   * The frontend can call this at any time to refresh catalog data.
   * Subsequent calls always re-fetch from Meta — no server-side caching.
   */
  @Get()
  getCatalog(@Query() query: CatalogQueryDto) {
    return this.catalogService.getCatalog(query.businessId);
  }
}

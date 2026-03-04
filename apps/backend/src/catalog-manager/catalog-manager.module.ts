import { Module } from '@nestjs/common';
import { CatalogManagerController } from './catalog-manager.controller';
import { CatalogManagerService } from './catalog-manager.service';

@Module({
  controllers: [CatalogManagerController],
  providers: [CatalogManagerService],
})
export class CatalogManagerModule {}

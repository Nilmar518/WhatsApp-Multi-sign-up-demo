import { Module } from '@nestjs/common';
import { MigoPropertyService } from './migo-property.service';
import { MigoPropertyController } from './migo-property.controller';

@Module({
  providers: [MigoPropertyService],
  controllers: [MigoPropertyController],
  exports: [MigoPropertyService],
})
export class MigoPropertyModule {}

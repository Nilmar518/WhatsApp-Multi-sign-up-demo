import { Module } from '@nestjs/common';
import { DocumentBuilderController } from './document-builder.controller';
import { DocumentBuilderService } from './document-builder.service';

@Module({
  controllers: [DocumentBuilderController],
  providers: [DocumentBuilderService],
})
export class DocumentBuilderModule {}

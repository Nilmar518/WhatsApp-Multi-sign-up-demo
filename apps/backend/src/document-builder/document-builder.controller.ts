import {
  Controller, Get, Post, Put, Delete, Param, Query, Body,
  HttpCode, HttpStatus, Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { DocumentBuilderService } from './document-builder.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { CreateInstanceDto } from './dto/create-instance.dto';
import { UpdateInstanceDto } from './dto/update-instance.dto';

@Controller('document-builder')
export class DocumentBuilderController {
  constructor(private readonly svc: DocumentBuilderService) {}

  // ── Templates ──────────────────────────────────────────────────────────────

  @Get('templates')
  listTemplates(@Query('businessId') businessId: string) {
    return this.svc.listTemplates(businessId);
  }

  @Post('templates')
  createTemplate(@Body() dto: CreateTemplateDto) {
    return this.svc.createTemplate(dto);
  }

  @Put('templates/:id')
  updateTemplate(@Param('id') id: string, @Body() dto: UpdateTemplateDto) {
    return this.svc.updateTemplate(id, dto);
  }

  @Delete('templates/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteTemplate(@Param('id') id: string) {
    return this.svc.deleteTemplate(id);
  }

  // ── Instances ──────────────────────────────────────────────────────────────

  @Get('instances')
  listInstances(
    @Query('businessId') businessId: string,
    @Query('reservationId') reservationId?: string,
  ) {
    return this.svc.listInstances(businessId, reservationId);
  }

  @Post('instances')
  createInstance(@Body() dto: CreateInstanceDto) {
    return this.svc.createInstance(dto);
  }

  @Put('instances/:id')
  updateInstance(@Param('id') id: string, @Body() dto: UpdateInstanceDto) {
    return this.svc.updateInstance(id, dto);
  }

  @Delete('instances/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteInstance(@Param('id') id: string) {
    return this.svc.deleteInstance(id);
  }

  // ── PDF ────────────────────────────────────────────────────────────────────

  @Post('instances/:id/pdf')
  async generatePdf(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.svc.generatePdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="ficha-${id}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }
}

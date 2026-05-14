import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { MigoPropertyService, type MigoPropertyDoc } from './migo-property.service';
import { CreateMigoPropertyDto } from './dto/create-migo-property.dto';
import { UpdateMigoPropertyDto } from './dto/update-migo-property.dto';
import { AssignConnectionDto } from './dto/assign-connection.dto';
import { ToggleSyncDto } from './dto/toggle-sync.dto';

@Controller('migo-properties')
export class MigoPropertyController {
  private readonly logger = new Logger(MigoPropertyController.name);

  constructor(private readonly migoPropertyService: MigoPropertyService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateMigoPropertyDto): Promise<MigoPropertyDoc> {
    this.logger.log(`[CTRL] POST /migo-properties title="${dto.title}"`);
    return this.migoPropertyService.createPropertyType(dto);
  }

  @Get()
  async list(@Query('tenantId') tenantId: string): Promise<MigoPropertyDoc[]> {
    this.logger.log(`[CTRL] GET /migo-properties tenantId=${tenantId}`);
    return this.migoPropertyService.listPropertyTypes(tenantId);
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<MigoPropertyDoc> {
    this.logger.log(`[CTRL] GET /migo-properties/${id}`);
    return this.migoPropertyService.getPropertyType(id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateMigoPropertyDto,
  ): Promise<MigoPropertyDoc> {
    this.logger.log(`[CTRL] PATCH /migo-properties/${id}`);
    return this.migoPropertyService.updatePropertyType(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    this.logger.log(`[CTRL] DELETE /migo-properties/${id}`);
    return this.migoPropertyService.deletePropertyType(id);
  }

  @Post(':id/connections')
  @HttpCode(HttpStatus.CREATED)
  async assignConnection(
    @Param('id') id: string,
    @Body() dto: AssignConnectionDto,
  ): Promise<MigoPropertyDoc> {
    this.logger.log(
      `[CTRL] POST /migo-properties/${id}/connections channexPropertyId=${dto.channexPropertyId}`,
    );
    return this.migoPropertyService.assignConnection(id, dto);
  }

  @Delete(':id/connections/:channexId')
  @HttpCode(HttpStatus.OK)
  async removeConnection(
    @Param('id') id: string,
    @Param('channexId') channexId: string,
  ): Promise<MigoPropertyDoc> {
    this.logger.log(`[CTRL] DELETE /migo-properties/${id}/connections/${channexId}`);
    return this.migoPropertyService.removeConnection(id, channexId);
  }

  @Patch(':id/connections/:channexId')
  async toggleSync(
    @Param('id') id: string,
    @Param('channexId') channexId: string,
    @Body() dto: ToggleSyncDto,
  ): Promise<MigoPropertyDoc> {
    this.logger.log(
      `[CTRL] PATCH /migo-properties/${id}/connections/${channexId} isSyncEnabled=${dto.isSyncEnabled}`,
    );
    return this.migoPropertyService.toggleSync(id, channexId, dto.isSyncEnabled);
  }

  @Post(':id/availability/reset')
  @HttpCode(HttpStatus.OK)
  async resetAvailability(@Param('id') id: string): Promise<MigoPropertyDoc> {
    this.logger.log(`[CTRL] POST /migo-properties/${id}/availability/reset`);
    return this.migoPropertyService.resetAvailability(id);
  }
}

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import { ChannexARIService } from './channex-ari.service';
import { MigoPropertyAriDto } from '../migo-property/dto/migo-property-ari.dto';

@Controller('channex/ari')
export class ChannexMigoAriController {
  private readonly logger = new Logger(ChannexMigoAriController.name);

  constructor(private readonly ariService: ChannexARIService) {}

  @Post('migo-property/:migoPropertyId')
  @HttpCode(HttpStatus.OK)
  async pushAriToMigoProperty(
    @Param('migoPropertyId') migoPropertyId: string,
    @Body() dto: MigoPropertyAriDto,
  ): Promise<{
    status: number;
    succeeded: string[];
    failed: Array<{ channexPropertyId: string; error: string }>;
  }> {
    this.logger.log(
      `[CTRL] POST /channex/ari/migo-property/${migoPropertyId}`,
    );

    const result = await this.ariService.pushAriToMigoProperty(migoPropertyId, dto);
    const status = result.failed.length > 0 ? 207 : 200;

    return { status, ...result };
  }
}

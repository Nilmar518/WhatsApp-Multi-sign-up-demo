import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AutoReplyService } from './auto-reply.service';
import { CreateAutoReplyDto } from './dto/create-auto-reply.dto';
import { UpdateAutoReplyDto } from './dto/update-auto-reply.dto';
import type { AutoReply } from './auto-reply.types';

@Controller('auto-replies')
export class AutoReplyController {
  constructor(private readonly service: AutoReplyService) {}

  @Get()
  list(@Query('businessId') businessId: string): Promise<AutoReply[]> {
    return this.service.listRules(businessId);
  }

  @Post()
  create(@Body() dto: CreateAutoReplyDto): Promise<AutoReply> {
    return this.service.createRule(dto);
  }

  @Put(':ruleId')
  update(
    @Param('ruleId') ruleId: string,
    @Body() dto: UpdateAutoReplyDto,
  ): Promise<AutoReply> {
    return this.service.updateRule(dto.businessId, ruleId, dto);
  }

  @Delete(':ruleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @Param('ruleId') ruleId: string,
    @Query('businessId') businessId: string,
  ): Promise<void> {
    return this.service.deleteRule(businessId, ruleId);
  }
}

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ChannexARIService, StoredRoomType } from './channex-ari.service';
import { ChannexARISnapshotService, MonthSnapshotDoc } from './channex-ari-snapshot.service';
import { CreateRoomTypeDto } from './dto/create-room-type.dto';
import { CreateRatePlanDto } from './dto/create-rate-plan.dto';
import {
  AriAvailabilityBatchDto,
  AriRestrictionsBatchDto,
  AriFullSyncDto,
} from './dto/ari-batch.dto';
import type {
  ChannexRoomTypeResponse,
  ChannexRatePlanResponse,
  FullSyncResult,
} from './channex.types';

/**
 * ChannexARIController — Room Type CRUD and real-time ARI push endpoints.
 *
 * Route prefix: channex/properties/:propertyId
 *
 * Endpoints:
 *   POST /channex/properties/:propertyId/room-types     → Create room type
 *   GET  /channex/properties/:propertyId/room-types     → List room types (Firestore cache)
 *   POST /channex/properties/:propertyId/availability   → Push availability (batch)
 *   POST /channex/properties/:propertyId/restrictions   → Push restrictions (batch)
 *   POST /channex/properties/:propertyId/full-sync      → Full 500-day ARI sync (2 calls)
 *
 * Batch model:
 *   Availability and restriction endpoints accept an array of updates dispatched
 *   in a single Channex API call. For single updates, send a one-element array.
 *   This satisfies Channex certification requirements for batched ARI pushes.
 */
@Controller('channex/properties/:propertyId')
export class ChannexARIController {
  private readonly logger = new Logger(ChannexARIController.name);

  constructor(
    private readonly ariService: ChannexARIService,
    private readonly snapshotService: ChannexARISnapshotService,
  ) {}

  /**
   * POST /channex/properties/:propertyId/room-types
   *
   * Creates a Room Type in Channex and appends it to the Firestore `room_types`
   * array. At least one Room Type is required before availability can be pushed.
   * Newly created Room Types default to availability=0 (hidden from OTAs).
   *
   * Returns: ChannexRoomTypeResponse (includes `room_type_id` UUID)
   * Status:  201 Created
   */
  @Post('room-types')
  @HttpCode(HttpStatus.CREATED)
  async createRoomType(
    @Param('propertyId') propertyId: string,
    @Body() dto: CreateRoomTypeDto,
  ): Promise<ChannexRoomTypeResponse> {
    this.logger.log(
      `[CTRL] POST /room-types — propertyId=${propertyId} title="${dto.title}"`,
    );

    return this.ariService.createRoomType(propertyId, dto);
  }

  /**
   * GET /channex/properties/:propertyId/room-types
   *
   * Returns the `room_types` array from the Firestore integration document.
   * Cached read — does not call the Channex API.
   *
   * Returns: StoredRoomType[]
   * Status:  200 OK
   */
  @Get('room-types')
  async getRoomTypes(
    @Param('propertyId') propertyId: string,
  ): Promise<StoredRoomType[]> {
    this.logger.log(`[CTRL] GET /room-types — propertyId=${propertyId}`);

    return this.ariService.getRoomTypes(propertyId);
  }

  /**
   * POST /channex/properties/:propertyId/room-types/:roomTypeId/rate-plans
   *
   * Creates a Rate Plan in Channex and appends a new entry to the Firestore
   * `room_types` array with the rate_plan_id populated.
   * Supports multiple rate plans per room type (e.g., BAR + B&B).
   *
   * Returns: ChannexRatePlanResponse (includes `rate_plan_id` UUID)
   * Status:  201 Created
   */
  @Post('room-types/:roomTypeId/rate-plans')
  @HttpCode(HttpStatus.CREATED)
  async createRatePlan(
    @Param('propertyId') propertyId: string,
    @Param('roomTypeId') roomTypeId: string,
    @Body() dto: CreateRatePlanDto,
  ): Promise<ChannexRatePlanResponse> {
    this.logger.log(
      `[CTRL] POST /room-types/${roomTypeId}/rate-plans — propertyId=${propertyId} title="${dto.title}"`,
    );

    return this.ariService.createRatePlan(propertyId, roomTypeId, dto);
  }

  /**
   * POST /channex/properties/:propertyId/availability
   *
   * Pushes one or more availability updates to Channex in a single HTTP call.
   * For single updates: send `updates` with one element.
   * For batch (certification Tests #9, #10): send multiple updates together.
   *
   * Body:    { updates: AvailabilityEntryDto[] }
   * Returns: { status: 'ok', taskId: string }
   * Status:  200 OK
   *
   * Errors:
   *   429 — Channex rate limit hit (ChannexRateLimitError)
   *   502 — Channex API rejected the payload
   */
  @Post('availability')
  @HttpCode(HttpStatus.OK)
  async pushAvailability(
    @Param('propertyId') propertyId: string,
    @Body() dto: AriAvailabilityBatchDto,
  ): Promise<{ status: 'ok'; taskId: string }> {
    this.logger.log(
      `[CTRL] POST /availability — propertyId=${propertyId} count=${dto.updates?.length ?? 0}`,
    );

    const updates = (dto.updates ?? []).map((u) => ({ ...u, property_id: propertyId }));
    const taskId = await this.ariService.pushAvailability(updates);
    return { status: 'ok', taskId };
  }

  /**
   * POST /channex/properties/:propertyId/restrictions
   *
   * Pushes one or more restriction/rate updates to Channex in a single HTTP call.
   * `rate_plan_id` must be present in each entry — restrictions operate on
   * Rate Plans, not Room Types.
   *
   * Body:    { updates: RestrictionEntryDto[] }
   * Returns: { status: 'ok', taskId: string }
   * Status:  200 OK
   */
  @Post('restrictions')
  @HttpCode(HttpStatus.OK)
  async pushRestrictions(
    @Param('propertyId') propertyId: string,
    @Body() dto: AriRestrictionsBatchDto,
  ): Promise<{ status: 'ok'; taskId: string }> {
    this.logger.log(
      `[CTRL] POST /restrictions — propertyId=${propertyId} count=${dto.updates?.length ?? 0}`,
    );

    const updates = (dto.updates ?? []).map((u) => ({ ...u, property_id: propertyId }));
    const taskId = await this.ariService.pushRestrictions(updates);
    return { status: 'ok', taskId };
  }

  /**
   * POST /channex/properties/:propertyId/full-sync
   *
   * Sends N days (default 500) of ARI for all room types and rate plans of the
   * property in exactly 2 Channex API calls — satisfying certification Test #1.
   *
   * Reads room_types[] from the Firestore integration document (already mirrored
   * from Channex during channel connection). Does NOT modify existing Channex
   * configuration — only pushes ARI values for existing entities.
   *
   * Body:    { defaultAvailability: number, defaultRate: string, days?: number }
   * Returns: { availabilityTaskId: string, restrictionsTaskId: string }
   * Status:  200 OK
   */
  /**
   * GET /channex/properties/:propertyId/ari-snapshot?tenantId=&month=YYYY-MM
   *
   * Returns a cached Firestore ARI snapshot for the given month.
   * No Channex API call — reads from `channex_integrations/{tenantId}/properties/{propertyId}/ari_snapshots/{month}`.
   */
  @Get('ari-snapshot')
  async getARISnapshot(
    @Param('propertyId') propertyId: string,
    @Query('tenantId') tenantId: string,
    @Query('month') month: string,
  ): Promise<MonthSnapshotDoc> {
    this.logger.log(
      `[CTRL] GET /ari-snapshot — propertyId=${propertyId} tenantId=${tenantId} month=${month}`,
    );
    return this.snapshotService.getMonthSnapshot(tenantId, propertyId, month);
  }

  /**
   * POST /channex/properties/:propertyId/ari-refresh?tenantId=&month=YYYY-MM
   *
   * Pulls current ARI from Channex and writes it to Firestore.
   * Rate-limited (counts against Channex 10 req/min per property).
   */
  @Post('ari-refresh')
  @HttpCode(HttpStatus.OK)
  async refreshARISnapshot(
    @Param('propertyId') propertyId: string,
    @Query('tenantId') tenantId: string,
    @Query('month') month: string,
  ): Promise<{ status: 'ok' }> {
    this.logger.log(
      `[CTRL] POST /ari-refresh — propertyId=${propertyId} tenantId=${tenantId} month=${month}`,
    );
    await this.ariService.refreshARISnapshot(tenantId, propertyId, month);
    return { status: 'ok' };
  }

  @Post('full-sync')
  @HttpCode(HttpStatus.OK)
  async fullSync(
    @Param('propertyId') propertyId: string,
    @Body() dto: AriFullSyncDto,
  ): Promise<FullSyncResult> {
    this.logger.log(
      `[CTRL] POST /full-sync — propertyId=${propertyId} ` +
        `availability=${dto.defaultAvailability} rate=${dto.defaultRate} days=${dto.days ?? 500}`,
    );

    return this.ariService.fullSync(propertyId, {
      defaultAvailability: dto.defaultAvailability,
      defaultRate: dto.defaultRate,
      days: dto.days,
    });
  }
}

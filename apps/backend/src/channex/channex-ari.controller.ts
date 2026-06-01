import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ChannexARIService, StoredRoomType } from './channex-ari.service';
import { ChannexARISnapshotService, MonthSnapshotDoc } from './channex-ari-snapshot.service';
import { ChannexSyncService, ConnectionHealthResult } from './channex-sync.service';
import { CreateRoomTypeDto } from './dto/create-room-type.dto';
import { UpdateRoomTypeDto } from './dto/update-room-type.dto';
import { CreateRatePlanDto } from './dto/create-rate-plan.dto';
import {
  AriAvailabilityBatchDto,
  AriRestrictionsBatchDto,
  AriFullSyncDto,
} from './dto/ari-batch.dto';
import { CreateManualBookingDto } from './dto/create-manual-booking.dto';
import { ChannexService } from './channex.service';
import type {
  ChannexRoomTypeResponse,
  ChannexRatePlanResponse,
  FullSyncResult,
} from './channex.types';
import type { FirestoreReservationDoc } from './transformers/booking-revision.transformer';

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
    private readonly syncService: ChannexSyncService,
    private readonly channexService: ChannexService,
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
   * PUT /channex/properties/:propertyId/room-types/:roomTypeId
   *
   * Updates a Room Type in Channex and mirrors the change to Firestore.
   * All fields are optional — only provided fields are updated.
   */
  @Put('room-types/:roomTypeId')
  async updateRoomType(
    @Param('propertyId') propertyId: string,
    @Param('roomTypeId') roomTypeId: string,
    @Body() dto: UpdateRoomTypeDto,
  ): Promise<ChannexRoomTypeResponse> {
    this.logger.log(`[CTRL] PUT /room-types/${roomTypeId} — propertyId=${propertyId}`);
    return this.ariService.updateRoomType(propertyId, roomTypeId, dto);
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
        `availability=${dto.defaultAvailability} rate=${dto.defaultRate} ` +
        `minStay=${dto.defaultMinStayArrival} maxStay=${dto.defaultMaxStay} ` +
        `stopSell=${dto.defaultStopSell} cta=${dto.defaultClosedToArrival} ctd=${dto.defaultClosedToDeparture} ` +
        `days=${dto.days ?? 500}`,
    );

    return this.ariService.fullSync(propertyId, {
      defaultAvailability: dto.defaultAvailability,
      defaultRate: dto.defaultRate,
      defaultMinStayArrival: dto.defaultMinStayArrival,
      defaultMaxStay: dto.defaultMaxStay,
      defaultStopSell: dto.defaultStopSell,
      defaultClosedToArrival: dto.defaultClosedToArrival,
      defaultClosedToDeparture: dto.defaultClosedToDeparture,
      days: dto.days,
    });
  }

  /**
   * POST /channex/properties/:propertyId/connection-health?tenantId=X
   *
   * Runs 4 live checks and auto-repairs a missing webhook:
   *   1. Property exists in Channex
   *   2. At least one room type exists
   *   3. Property's group_id matches the tenant's Firestore group
   *   4. Webhook with our callback_url is active → re-registers if missing
   */
  /**
   * GET /channex/properties/:propertyId/bookings?tenantId=X&limit=50
   *
   * Returns bookings for the property plus the OTA channel code resolved from
   * the property's connected channel (e.g. "BDC", "ABB").
   */
  @Get('bookings')
  async getPropertyBookings(
    @Param('propertyId') propertyId: string,
    @Query('tenantId') tenantId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ): Promise<{ bookings: FirestoreReservationDoc[]; propertyChannelCode: string | null }> {
    this.logger.log(
      `[CTRL] GET /bookings — propertyId=${propertyId} tenantId=${tenantId} limit=${limit} dateFrom=${dateFrom ?? '-'} dateTo=${dateTo ?? '-'}`,
    );
    return this.ariService.getPropertyBookings(propertyId, tenantId, limit, dateFrom, dateTo);
  }

  /**
   * GET /channex/properties/:propertyId/bookings/:bookingId?tenantId=X
   *
   * Returns a single reservation by its Channex booking ID, plus the OTA
   * channel code. Used by the Messages inbox "Ver Reserva" button.
   * Returns 404 if no booking is found.
   */
  @Get('bookings/:bookingId')
  async getBookingById(
    @Param('propertyId') propertyId: string,
    @Param('bookingId') bookingId: string,
    @Query('tenantId') tenantId: string,
  ): Promise<{ reservation: FirestoreReservationDoc; propertyChannelCode: string | null }> {
    this.logger.log(
      `[CTRL] GET /bookings/${bookingId} — propertyId=${propertyId} tenantId=${tenantId}`,
    );

    const result = await this.ariService.getBookingById(propertyId, bookingId, tenantId);

    if (!result) {
      throw new NotFoundException(`Booking ${bookingId} not found for propertyId=${propertyId}`);
    }

    return result;
  }

  /**
   * POST /channex/properties/:propertyId/bookings/pull?tenantId=X&limit=50
   *
   * Pulls bookings from the Channex REST API and upserts to Firestore.
   * Use when webhook delivery failed or the push payload was not processed.
   */
  @Post('bookings/pull')
  @HttpCode(HttpStatus.OK)
  async pullBookings(
    @Param('propertyId') propertyId: string,
    @Query('tenantId') tenantId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ): Promise<{ synced: number }> {
    this.logger.log(
      `[CTRL] POST /bookings/pull — propertyId=${propertyId} tenantId=${tenantId} limit=${limit}`,
    );
    return this.ariService.pullBookingsFromChannex(propertyId, tenantId);
  }

  @Post('connection-health')
  @HttpCode(HttpStatus.OK)
  async checkConnectionHealth(
    @Param('propertyId') propertyId: string,
    @Query('tenantId') tenantId: string,
  ): Promise<ConnectionHealthResult> {
    this.logger.log(
      `[CTRL] POST /connection-health — propertyId=${propertyId} tenantId=${tenantId}`,
    );
    return this.syncService.checkConnectionHealth(propertyId, tenantId);
  }

  /**
   * POST /channex/properties/:propertyId/bookings/manual
   *
   * Creates a manual booking (walk-in, maintenance block, owner stay, or direct)
   * and immediately pushes availability=0 to Channex for the booked date range.
   *
   * Body:    CreateManualBookingDto (tenantId, roomTypeId, checkIn, checkOut, bookingType, …)
   * Returns: FirestoreReservationDoc
   * Status:  201 Created
   */
  @Post('bookings/manual')
  @HttpCode(HttpStatus.CREATED)
  async createManualBooking(
    @Param('propertyId') propertyId: string,
    @Body() dto: CreateManualBookingDto,
  ): Promise<FirestoreReservationDoc> {
    this.logger.log(
      `[CTRL] POST /bookings/manual — propertyId=${propertyId} tenantId=${dto.tenantId} ` +
        `type=${dto.bookingType} checkIn=${dto.checkIn} checkOut=${dto.checkOut}`,
    );
    return this.ariService.createManualBooking(propertyId, dto);
  }

  /**
   * POST /channex/properties/:propertyId/bookings/:channexBookingId/no-show
   *
   * Reports a Booking.com guest as No Show via Channex.
   * BDC rule: can only be executed ≥1 day after check-in.
   *
   * Body:    { tenantId: string, waivedFees: boolean }
   * Returns: 200 { success: true, data } on success
   *          422 { errors } on Channex validation error
   * Status:  200 OK | 422 Unprocessable | 400 Bad Request
   */
  @Post('bookings/:channexBookingId/no-show')
  @HttpCode(HttpStatus.OK)
  async markNoShow(
    @Param('propertyId') propertyId: string,
    @Param('channexBookingId') channexBookingId: string,
    @Body('tenantId') tenantId: string,
    @Body('waivedFees') waivedFees: boolean,
  ): Promise<{ success: boolean; data?: unknown; errors?: unknown }> {
    this.logger.log(
      `[CTRL] POST /bookings/${channexBookingId}/no-show — propertyId=${propertyId} tenantId=${tenantId} waivedFees=${waivedFees}`,
    );

    if (!tenantId) {
      throw new BadRequestException('tenantId is required in the request body.');
    }

    const result = await this.ariService.markBookingNoShow(
      propertyId,
      channexBookingId,
      tenantId,
      waivedFees ?? false,
    );

    if (!result.success) {
      throw new HttpException(result.errors ?? { message: 'No show request failed' }, HttpStatus.UNPROCESSABLE_ENTITY);
    }

    return result;
  }

  /**
   * PATCH /channex/properties/:propertyId/bookings/manual/:pmsBookingId/cancel
   *
   * Cancels a manual booking (channex_booking_id === null only) and restores
   * availability=1 in Channex for the original date range.
   *
   * Query:   tenantId (required)
   * Returns: FirestoreReservationDoc
   * Status:  200 OK
   */
  @Patch('bookings/manual/:pmsBookingId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelManualBooking(
    @Param('propertyId') propertyId: string,
    @Param('pmsBookingId') pmsBookingId: string,
    @Query('tenantId') tenantId: string,
  ): Promise<FirestoreReservationDoc> {
    this.logger.log(
      `[CTRL] PATCH /bookings/manual/${pmsBookingId}/cancel — propertyId=${propertyId} tenantId=${tenantId}`,
    );
    return this.ariService.cancelManualBooking(propertyId, pmsBookingId, tenantId);
  }

  /**
   * POST /channex/properties/:propertyId/bookings/:channexBookingId/sync
   *
   * Fetches full booking details from Channex and returns the raw payload for
   * inspection. Used to diagnose room_type_id mapping and to enrich existing
   * reservations that arrived before the rooms fetch was implemented.
   */
  @Post('bookings/:channexBookingId/sync')
  @HttpCode(HttpStatus.OK)
  async syncBookingFromChannex(
    @Param('propertyId') _propertyId: string,
    @Param('channexBookingId') channexBookingId: string,
    @Body('tenantId') tenantId: string,
  ): Promise<{ booking: Record<string, unknown> | null }> {
    this.logger.log(
      `[CTRL] POST /bookings/${channexBookingId}/sync — tenantId=${tenantId}`,
    );
    if (!tenantId) {
      throw new BadRequestException('tenantId is required');
    }
    const booking = await this.ariService.enrichBookingFromChannex(channexBookingId, tenantId);
    return { booking };
  }
}

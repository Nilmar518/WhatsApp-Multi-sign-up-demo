import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import { ChannexARIService, StoredRoomType } from './channex-ari.service';
import { CreateRoomTypeDto } from './dto/create-room-type.dto';
import type {
  AvailabilityEntryDto,
  ChannexRoomTypeResponse,
  RestrictionEntryDto,
} from './channex.types';

/**
 * ChannexARIController — Room Type CRUD and real-time ARI push endpoints.
 *
 * Route prefix: channex/properties/:propertyId
 *
 * Endpoints:
 *   POST /channex/properties/:propertyId/room-types     → Create room type
 *   GET  /channex/properties/:propertyId/room-types     → List room types (Firestore cache)
 *   POST /channex/properties/:propertyId/availability   → Push availability to Channex (sync)
 *   POST /channex/properties/:propertyId/restrictions   → Push restrictions to Channex (sync)
 *
 * ARI push model (simplified):
 *   Availability and restriction pushes are now fully synchronous — the handler
 *   awaits the Channex HTTP response before returning 200 OK. This gives the
 *   frontend an accurate loading state (1-2 s spinner) rather than an
 *   optimistic "buffered" ack that masked failures.
 */
@Controller('channex/properties/:propertyId')
export class ChannexARIController {
  private readonly logger = new Logger(ChannexARIController.name);

  constructor(private readonly ariService: ChannexARIService) {}

  /**
   * POST /channex/properties/:propertyId/room-types
   *
   * Creates a Room Type in Channex and appends it to the Firestore `room_types`
   * array. At least one Room Type is required before availability can be pushed.
   * Newly created Room Types default to availability=0 (hidden from Airbnb).
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
   * POST /channex/properties/:propertyId/availability
   *
   * Pushes an availability update directly to Channex and returns 200 only after
   * Channex confirms receipt. The frontend must show a loading state for the
   * ~1-2 s duration of this call.
   *
   * Body:    AvailabilityEntryDto
   * Returns: { status: 'ok' }
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
    @Body() dto: AvailabilityEntryDto,
  ): Promise<{ status: 'ok' }> {
    this.logger.log(
      `[CTRL] POST /availability — propertyId=${propertyId} ` +
        `room=${dto.room_type_id} ${dto.date_from}→${dto.date_to} value=${dto.availability}`,
    );

    // Hydrate property_id from the URL param so the body field is optional.
    const update: AvailabilityEntryDto = { ...dto, property_id: propertyId };

    await this.ariService.pushAvailability(update);
    return { status: 'ok' };
  }

  /**
   * POST /channex/properties/:propertyId/restrictions
   *
   * Pushes a rate/restriction update directly to Channex and returns 200 only
   * after Channex confirms receipt.
   *
   * Restrictions operate on `rate_plan_id` (not `room_type_id`) — ensure the
   * correct Rate Plan UUID is provided. Rate values must be decimal strings
   * (e.g. "150.00") as required by the Channex restrictions endpoint.
   *
   * Body:    RestrictionEntryDto
   * Returns: { status: 'ok' }
   * Status:  200 OK
   */
  @Post('restrictions')
  @HttpCode(HttpStatus.OK)
  async pushRestrictions(
    @Param('propertyId') propertyId: string,
    @Body() dto: RestrictionEntryDto,
  ): Promise<{ status: 'ok' }> {
    this.logger.log(
      `[CTRL] POST /restrictions — propertyId=${propertyId} ` +
        `plan=${dto.rate_plan_id} ${dto.date_from}→${dto.date_to}`,
    );

    const update: RestrictionEntryDto = { ...dto, property_id: propertyId };

    await this.ariService.pushRestrictions(update);
    return { status: 'ok' };
  }
}

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import {
  BookingService,
  type SessionTokenResult,
  type SyncBookingResult,
} from './booking.service';
import {
  BookingPipelineService,
  type CommitPipelineResult,
} from './booking-pipeline.service';

export interface BdcSyncResult {
  status: 'success';
  channel: 'BookingCom';
  pipelineResult: CommitPipelineResult;
}
import { CommitPipelineDto } from './dto/commit-pipeline.dto';
import { DisconnectBookingDto } from './dto/disconnect-booking.dto';
import { MapBookingDto } from './dto/map-booking.dto';

@Controller('booking')
export class BookingController {
  constructor(
    private readonly bookingService: BookingService,
    private readonly pipelineService: BookingPipelineService,
  ) {}

  /**
   * GET /booking/session?tenantId=X
   * Resolves/creates the Channex group + shell property, issues a one-time
   * session token so the frontend can open the Channex popup with channels=BDC.
   */
  @Get('session')
  getSession(
    @Query('tenantId') tenantId: string,
  ): Promise<SessionTokenResult> {
    return this.bookingService.getSessionToken(tenantId);
  }

  /** Legacy alias — prefer GET /booking/session. */
  @Get('session-token')
  getSessionTokenLegacy(
    @Query('tenantId') tenantId: string,
  ): Promise<SessionTokenResult> {
    return this.bookingService.getSessionToken(tenantId);
  }

  /**
   * POST /booking/sync
   * Body: { tenantId: string }
   *
   * Finds the channel for the tenant's Channex group after the IFrame popup.
   *
   * Booking.com: pipeline is executed automatically — no user mapping step
   * required. Returns BdcSyncResult with full pipelineResult on success.
   *
   * Other channels (Airbnb): returns OTA rooms/rates for the frontend to
   * display the manual mapping UI before calling POST /booking/commit.
   */
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  async syncBooking(
    @Body('tenantId') tenantId: string,
  ): Promise<SyncBookingResult | BdcSyncResult> {
    const syncResult = await this.bookingService.syncBooking(tenantId);

    if (syncResult.channelCode === 'BookingCom') {
      const pipelineResult = await this.pipelineService.commitPipeline(tenantId);
      return {
        status: 'success',
        channel: 'BookingCom',
        pipelineResult,
      };
    }

    return syncResult;
  }

  /**
   * POST /booking/map
   * Body: { tenantId: string, mappings: [{ migoRoomId, otaRoomId, otaRateId }] }
   * Saves the room-mapping table to Firestore so inbound webhooks can match
   * OTA rooms to Migo-internal room IDs.
   */
  @Post('map')
  @HttpCode(HttpStatus.OK)
  saveMapping(@Body() dto: MapBookingDto): Promise<{ saved: number }> {
    return this.bookingService.saveMapping(dto);
  }

  /**
   * POST /booking/webhook
   * Receives Channex reservation events for Booking.com.
   * Send the simulator payload from Postman to {ngrok-url}/booking/webhook.
   *
   * Expected body: { event: "booking", payload: { ... } }
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  handleChannexWebhook(@Body() payload: unknown): Promise<{ status: string }> {
    return this.bookingService.handleChannexWebhook(payload);
  }

  /**
   * POST /booking/commit
   * Body: { tenantId: string }
   *
   * Executes Steps 4–8 of the Booking.com pipeline after the user has completed
   * the Channex IFrame popup and POST /booking/sync has persisted the channel ID.
   *
   * Steps performed:
   *   4a. Fetch OTA mapping records (BDC room/rate slots) from Channex
   *   4b. Create internal Room Types from BDC room data (idempotent)
   *   4c. Create internal Rate Plans from BDC rate data (idempotent)
   *   5.  Assign OTA → internal mappings (PUT per slot)
   *   6.  Activate the Booking.com channel
   *   7.  Register webhook subscription (master /webhook endpoint, send_data=true)
   *   8.  Install Channex Webhooks App on the property
   */
  @Post('commit')
  @HttpCode(HttpStatus.OK)
  commitPipeline(@Body() dto: CommitPipelineDto): Promise<CommitPipelineResult> {
    return this.pipelineService.commitPipeline(dto.tenantId);
  }

  /**
   * POST /booking/disconnect
   * Deletes the Channex channel (XML drop → Booking.com Extranet unlocked).
   */
  @Post('disconnect')
  @HttpCode(HttpStatus.NO_CONTENT)
  disconnectBooking(@Body() dto: DisconnectBookingDto): Promise<void> {
    return this.bookingService.disconnectBooking(dto);
  }
}

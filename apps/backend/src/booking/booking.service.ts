import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { FieldValue } from 'firebase-admin/firestore';
import { DefensiveLoggerService } from '../common/logger/defensive-logger.service';
import { SecretManagerService } from '../common/secrets/secret-manager.service';
import { FirebaseService } from '../firebase/firebase.service';
import { ChannexGroupService } from '../channex/channex-group.service';
import { DisconnectBookingDto } from './dto/disconnect-booking.dto';
import { MapBookingDto } from './dto/map-booking.dto';

const CHANNEX_INTEGRATIONS = 'channex_integrations';

export interface BookingRoom {
  id: string;
  title: string;
}

export interface BookingRate {
  id: string;
  title: string;
  room_id: string;
}

export interface SyncBookingResult {
  channelCode: string;
  rooms: BookingRoom[];
  rates: BookingRate[];
}

export interface SessionTokenResult {
  token: string;
  propertyId: string;
}

@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);
  private readonly baseUrl: string;

  constructor(
    private readonly defLogger: DefensiveLoggerService,
    private readonly secrets: SecretManagerService,
    private readonly firebase: FirebaseService,
    private readonly groupService: ChannexGroupService,
  ) {
    this.baseUrl =
      process.env.CHANNEX_BASE_URL ?? 'https://staging.channex.io/api/v1';
  }

  private buildAuthHeaders(): Record<string, string> {
    const apiKey = this.secrets.get('CHANNEX_API_KEY');
    if (!apiKey) {
      throw new HttpException(
        'CHANNEX_API_KEY is not set. Add it to apps/backend/.env.secrets.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return {
      'user-api-key': apiKey,
      'Content-Type': 'application/json',
    };
  }

  /**
   * GET /booking/session-token?tenantId=X
   *
   * Prepares the Channex popup session for Booking.com:
   *   1. Resolves (or creates) the Channex group for the tenant.
   *   2. Resolves (or creates) a shell property under that group — cached in
   *      channex_integrations/{tenantId} so the same property is reused on retry.
   *   3. Issues a one-time session token scoped to the property.
   *
   * The frontend opens the popup at:
   *   {CHANNEX_BASE}/auth/exchange?oauth_session_key=TOKEN&property_id=PROP_ID&channels=BDC&...
   */
  async getSessionToken(tenantId: string): Promise<SessionTokenResult> {
    const headers = this.buildAuthHeaders();
    const channexGroupId = await this.groupService.ensureGroup(tenantId);

    const db = this.firebase.getFirestore();
    const bookingDocRef = db.collection(CHANNEX_INTEGRATIONS).doc(tenantId);
    const bookingDoc = await bookingDocRef.get();
    let channexPropertyId: string = bookingDoc.data()?.channex_property_id ?? '';

    if (!channexPropertyId) {
      this.logger.log(
        `[BOOKING_TOKEN] No shell property — creating for tenant=${tenantId}`,
      );
      const propertyRes = await this.defLogger.request<any>({
        method: 'POST',
        url: `${this.baseUrl}/properties`,
        headers,
        data: {
          property: {
            title: 'Booking.com Base Property',
            currency: 'USD',
            timezone: 'America/New_York',
            property_type: 'hotel',
            group_id: channexGroupId,
          },
        },
      });
      channexPropertyId = propertyRes.data.id;
      this.logger.log(
        `[BOOKING_TOKEN] ✓ Property created — channexPropertyId=${channexPropertyId}`,
      );

    } else {
      this.logger.log(
        `[BOOKING_TOKEN] ✓ Reusing property — channexPropertyId=${channexPropertyId}`,
      );
    }

    // Root integration doc — idempotent merge
    const rootRef = db.collection(CHANNEX_INTEGRATIONS).doc(tenantId);
    await this.firebase.set(rootRef, {
      tenant_id: tenantId,
      channex_group_id: channexGroupId,
      channex_property_id: channexPropertyId,   // mirror for pipeline quick-read
      channex_channel_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { merge: true });

    // Property subcol doc — idempotent merge (room_types intentionally omitted to
    // preserve any manually created rooms from before the BDC connection flow)
    const propertyRef = rootRef.collection('properties').doc(channexPropertyId);
    await this.firebase.set(propertyRef, {
      channex_property_id: channexPropertyId,
      tenant_id: tenantId,
      channex_group_id: channexGroupId,
      channex_channel_id: null,
      connection_status: 'pending',
      connected_channels: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { merge: true });

    this.logger.log(
      `[BOOKING_TOKEN] Requesting session token for propertyId=${channexPropertyId}`,
    );
    const tokenRes = await this.defLogger.request<any>({
      method: 'POST',
      url: `${this.baseUrl}/auth/one_time_token`,
      headers,
      data: { property_id: channexPropertyId },
    });
    const token: string = tokenRes?.data?.token;
    if (!token) {
      throw new HttpException(
        'Channex one_time_token response did not contain data.token.',
        HttpStatus.BAD_GATEWAY,
      );
    }

    this.logger.log(`[BOOKING_TOKEN] ✓ Session token issued`);
    return { token, propertyId: channexPropertyId };
  }

  /**
   * POST /booking/sync
   *
   * Called after the user completes the Channex popup flow.
   * Uses the group_id to list all channels, finds the BookingCom channel,
   * fetches its OTA rooms/rates via get_rooms, and persists to Firestore.
   */
  async syncBooking(tenantId: string): Promise<SyncBookingResult> {
    const headers = this.buildAuthHeaders();
    const db = this.firebase.getFirestore();
    const channexGroupId = await this.groupService.ensureGroup(tenantId);

    // 1. List channels for the group
    this.logger.log(
      `[BOOKING_SYNC] Fetching channels for group_id=${channexGroupId}`,
    );
    const channelsRes = await this.defLogger.request<any>({
      method: 'GET',
      url: `${this.baseUrl}/channels?group_id=${channexGroupId}`,
      headers,
    });

    // 2. Find the Booking.com channel
    const channels: any[] = channelsRes?.data?.data ?? channelsRes?.data ?? [];
    const bookingChannel = channels.find(
      (c: any) =>
        c.attributes?.channel === 'BookingCom' ||
        c.attributes?.channel_design_id === 'booking_com',
    );
    if (!bookingChannel) {
      throw new HttpException(
        'No Booking.com channel found. Please ensure you created it in the popup with the name "Booking.com"',
        HttpStatus.NOT_FOUND,
      );
    }
    const channexChannelId: string = bookingChannel.id;
    const channexPropertyId: string = bookingChannel.attributes?.properties?.[0];
    const channelCode: string = bookingChannel.attributes?.channel ?? '';
    this.logger.log(
      `[BOOKING_SYNC] ✓ Found channel — channexChannelId=${channexChannelId} code=${channelCode}`,
    );

    // 3. BDC inventory model is inverted: room types live in Channex and sync TO BDC.
    //    GET /channels/{id}/mappings returns 404 for BookingCom channels (no pre-existing
    //    OTA slots to fetch). Skip the mappings call; the commit pipeline (POST /booking/commit)
    //    will create room types, rate plans, and mappings in the correct order.
    if (channelCode === 'BookingCom') {
      const propertyRef = db
        .collection(CHANNEX_INTEGRATIONS)
        .doc(tenantId)
        .collection('properties')
        .doc(channexPropertyId);

      await this.firebase.update(propertyRef, {
        channex_channel_id: channexChannelId,
        channex_property_id: channexPropertyId,
        connection_status: 'channel_ready',
        updated_at: new Date().toISOString(),
      });

      // Mirror channel_id on root doc for webhook routing
      await this.firebase.update(
        db.collection(CHANNEX_INTEGRATIONS).doc(tenantId),
        { channex_channel_id: channexChannelId, updated_at: new Date().toISOString() },
      );
      this.logger.log(
        `[BOOKING_SYNC] ✓ BDC channel persisted — ready for pipeline auto-commit`,
      );
      return { channelCode, rooms: [], rates: [] };
    }

    // 3b. Non-BDC channels: fetch OTA mapping records to derive rooms and rates.
    this.logger.log(
      `[BOOKING_SYNC] Fetching OTA mapping records for channel=${channexChannelId}`,
    );
    const mappingsRes = await this.defLogger.request<{ data: any[] }>({
      method: 'GET',
      url: `${this.baseUrl}/channels/${channexChannelId}/mappings`,
      headers,
    });

    const rawMappings: any[] = mappingsRes?.data ?? [];

    const roomsMap = new Map<string, BookingRoom>();
    const rates: BookingRate[] = [];

    for (const record of rawMappings) {
      const attr = record.attributes ?? {};
      const otaRoomId: string =
        attr.ota_room_type_id ?? attr.room_type_id ?? record.id;
      const otaRoomName: string =
        attr.ota_room_type_name ?? attr.room_name ?? `Room ${otaRoomId}`;
      const otaRateId: string =
        attr.ota_rate_plan_id ?? attr.rate_plan_id ?? record.id;
      const otaRateName: string =
        attr.ota_rate_plan_name ?? attr.rate_name ?? `Rate ${otaRateId}`;

      if (!roomsMap.has(otaRoomId)) {
        roomsMap.set(otaRoomId, { id: otaRoomId, title: otaRoomName });
      }
      rates.push({ id: otaRateId, title: otaRateName, room_id: otaRoomId });
    }

    const rooms: BookingRoom[] = Array.from(roomsMap.values());

    // 4. Persist to channex_integrations/{tenantId}/properties/{channexPropertyId}
    const propertyRef = db
      .collection(CHANNEX_INTEGRATIONS)
      .doc(tenantId)
      .collection('properties')
      .doc(channexPropertyId);

    await this.firebase.update(propertyRef, {
      channex_channel_id: channexChannelId,
      channex_property_id: channexPropertyId,
      connection_status: 'active',
      ota_rooms: rooms,
      ota_rates: rates,
      updated_at: new Date().toISOString(),
    });

    await this.firebase.update(
      db.collection(CHANNEX_INTEGRATIONS).doc(tenantId),
      { channex_channel_id: channexChannelId, updated_at: new Date().toISOString() },
    );
    this.logger.log(
      `[BOOKING_SYNC] ✓ Saved rooms and rates to Firestore for tenant=${tenantId}`,
    );

    return { channelCode, rooms, rates };
  }

  /**
   * POST /booking/map
   *
   * Persists the tenant's room-mapping table to channex_integrations/{tenantId}.
   * Each entry links a Migo-internal room ID to an OTA room + rate plan so that
   * inbound Channex webhook events can be matched to the correct internal entity.
   */
  async saveMapping(dto: MapBookingDto): Promise<{ saved: number }> {
    const db = this.firebase.getFirestore();
    const rootDoc = await db.collection(CHANNEX_INTEGRATIONS).doc(dto.tenantId).get();
    const channexPropertyId: string = rootDoc.data()?.channex_property_id ?? '';

    if (channexPropertyId) {
      const propertyRef = db
        .collection(CHANNEX_INTEGRATIONS)
        .doc(dto.tenantId)
        .collection('properties')
        .doc(channexPropertyId);

      await this.firebase.update(propertyRef, {
        mappings: dto.mappings,
        updated_at: new Date().toISOString(),
      });
    }

    this.logger.log(
      `[BOOKING_MAP] ✓ Saved ${dto.mappings.length} mapping(s) for tenant=${dto.tenantId}`,
    );
    return { saved: dto.mappings.length };
  }

  /**
   * POST /booking/webhook
   *
   * Persists Channex Booking.com events to Firestore so the frontend can
   * display them in real-time via onSnapshot.
   *
   * event=booking  → upsert channex_integrations/{tenantId}/booking_reservations/{id}
   * event=message  → write   channex_integrations/{tenantId}/booking_threads/{threadId}/messages/{msgId}
   *                  upsert  channex_integrations/{tenantId}/booking_threads/{threadId}
   */
  async handleChannexWebhook(payload: any): Promise<{ status: string }> {
    const eventType: string = payload?.event ?? '';
    const data = payload?.payload;

    this.logger.log(`[BOOKING_WEBHOOK] Received event="${eventType}"`);

    if (!data?.channel_id) {
      return { status: 'ignored' };
    }

    // ── Resolve tenant ────────────────────────────────────────────────────────
    const db = this.firebase.getFirestore();
    const tenantSnap = await db
      .collection(CHANNEX_INTEGRATIONS)
      .where('channex_channel_id', '==', data.channel_id)
      .limit(1)
      .get();

    if (tenantSnap.empty) {
      this.logger.warn(
        `[BOOKING_WEBHOOK] No tenant for channex_channel_id=${data.channel_id}`,
      );
      return { status: 'unmapped_channel' };
    }

    const tenantId: string = tenantSnap.docs[0].id;

    // ── Route by event type ───────────────────────────────────────────────────
    if (eventType === 'booking') {
      const guestName = `${data.customer?.name ?? ''} ${data.customer?.surname ?? ''}`.trim() || 'Guest unavailable';
      const roomTypeId: string = data.rooms?.[0]?.room_type_id ?? '';

      const resRef = db
        .collection(CHANNEX_INTEGRATIONS)
        .doc(tenantId)
        .collection('booking_reservations')
        .doc(data.id as string);

      await this.firebase.set(
        resRef,
        {
          reservation_id: data.id,
          channel_id: data.channel_id,
          property_id: data.property_id ?? null,
          status: data.status ?? 'unknown',
          guest_name: guestName,
          customer: data.customer ?? null,
          check_in_date: data.check_in_date ?? null,
          check_out_date: data.check_out_date ?? null,
          room_type_id: roomTypeId,
          amount: data.amount ?? null,
          currency: data.currency ?? 'USD',
          inserted_at: data.inserted_at ?? new Date().toISOString(),
          cancelled_at: data.cancelled_at ?? null,
          updated_at: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      this.logger.log(
        `[BOOKING_WEBHOOK] ✓ Reservation ${data.id} (${data.status}) saved for tenant=${tenantId}`,
      );
    } else if (eventType === 'message') {
      const threadId: string = data.message_thread_id;
      const messageId: string = data.ota_message_id ?? data.id;
      const guestName = `${data.author?.name ?? ''} ${data.author?.surname ?? ''}`.trim() || 'Guest';
      const sender = data.direction === 'inbound' ? 'guest' : 'host';

      // 1. Write the message sub-document
      const messageRef = db
        .collection(CHANNEX_INTEGRATIONS)
        .doc(tenantId)
        .collection('booking_threads')
        .doc(threadId)
        .collection('messages')
        .doc(messageId);

      await this.firebase.set(messageRef, {
        text: data.body ?? '',
        sender,
        reservationId: data.reservation_id ?? null,
        createdAt: FieldValue.serverTimestamp(),
      });

      // 2. Upsert thread document (drives the left-pane thread list)
      const threadRef = db
        .collection(CHANNEX_INTEGRATIONS)
        .doc(tenantId)
        .collection('booking_threads')
        .doc(threadId);

      await this.firebase.set(
        threadRef,
        {
          guestName,
          lastMessage: data.body ?? '',
          reservationId: data.reservation_id ?? null,
          checkInDate: null,
          checkOutDate: null,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      this.logger.log(
        `[BOOKING_WEBHOOK] ✓ Message ${messageId} → thread ${threadId} saved for tenant=${tenantId}`,
      );
    } else {
      this.logger.log(`[BOOKING_WEBHOOK] Unhandled event type="${eventType}" — ignored`);
    }

    return { status: 'success' };
  }

  /**
   * POST /booking/disconnect
   *
   * Deletes the Booking.com channel in Channex, sending an XML drop signal that
   * releases the user's Extranet calendar. Removes the Firestore document.
   */
  async disconnectBooking(dto: DisconnectBookingDto): Promise<void> {
    const { tenantId } = dto;
    const headers = this.buildAuthHeaders();

    const db = this.firebase.getFirestore();
    const docRef = db.collection(CHANNEX_INTEGRATIONS).doc(tenantId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      throw new HttpException(
        `No Booking.com integration found for tenant=${tenantId}`,
        HttpStatus.NOT_FOUND,
      );
    }

    const channexChannelId: string = docSnap.data()!.channex_channel_id;

    this.logger.log(
      `[BOOKING_DISCONNECT] Deleting channel=${channexChannelId} for tenant=${tenantId}`,
    );
    await this.defLogger.request<any>({
      method: 'DELETE',
      url: `${this.baseUrl}/channels/${channexChannelId}`,
      headers,
    });
    this.logger.log(`[BOOKING_DISCONNECT] ✓ Channel deleted`);

    await docRef.delete();
    this.logger.log(
      `[BOOKING_DISCONNECT] ✓ Firestore document removed — docId=${tenantId}`,
    );
  }
}

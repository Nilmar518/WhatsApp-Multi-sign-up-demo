import { HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { SecretManagerService } from '../common/secrets/secret-manager.service';
import { ChannexService } from './channex.service';
import { StoredRoomType, StoredRatePlan, mergeRoomTypes } from './channex-ari.service';
import { ChannexConnectionStatus, ChannexWebhookPayload } from './channex.types';
import { ListingPreviewProperty, ListingPreviewRoom, SyncNameOverrides } from './channex-sync.service';

const COLLECTION = 'channex_integrations';
const BDC_EVENT_MASK =
  'booking_new;booking_modification;booking_cancellation;message_new;inquiry_new;booking_inquiry';

interface BdcMappingEntry {
  otaRoomId: string;
  otaRoomTitle: string;
  otaRateId: string;
  otaRateTitle: string;
  maxPersons: number;
  readonly: boolean;
  pricingType: string;
}

export interface BdcRoomResult {
  otaRoomId: string;
  otaRoomTitle: string;
  channexRoomTitle: string;    // user-provided name (from SyncNameOverrides)
  roomTypeId: string;
  ratePlanIds: string[];
}

export interface BdcRoomFailure {
  otaRoomId: string;
  otaRoomTitle: string;
  step: 'A' | 'B';            // A = room type creation, B = rate plan creation
  reason: string;
}

export interface BdcSyncResult {
  channexChannelId: string;
  channexPropertyId: string;  // base property (single, permanent)
  webhookId: string | null;
  succeeded: BdcRoomResult[];
  failed: BdcRoomFailure[];
}

/**
 * ChannexBdcSyncService — Single-property BDC pipeline.
 *
 * Uses one shared base property for all rooms. The BDC channel stays assigned
 * to the base property permanently. No re-assignment.
 *
 * Pipeline per BDC room (from mapping_details):
 *   A  POST /api/v1/room_types   → room type under parentPropertyId
 *   B  POST /api/v1/rate_plans   → rate plan(s) under A
 *
 * After all rooms:
 *   C  PUT  /api/v1/channels/:id → apply all room/rate mappings on BDC channel
 *   D  POST /api/v1/channels/:id/activate
 *   E  POST /api/v1/webhooks     → webhook on parentPropertyId (once)
 *   F  POST /api/v1/applications/install → Messages App on parentPropertyId (once)
 *   G  Install Booking CRS App (non-fatal)
 *   H  Persist base property doc + root metadata to Firestore
 */
@Injectable()
export class ChannexBdcSyncService {
  private readonly logger = new Logger(ChannexBdcSyncService.name);

  constructor(
    private readonly channex: ChannexService,
    private readonly firebase: FirebaseService,
    private readonly secrets: SecretManagerService,
  ) {}

  async getBdcListingPreview(propertyId: string, channelId?: string): Promise<ListingPreviewProperty[]> {
    let channexChannelId: string;
    if (channelId) {
      channexChannelId = channelId;
    } else {
      const channels = await this.channex.getChannels(propertyId);
      const bdcChannel = channels.find(
        (c) =>
          c.attributes?.channel === 'BookingCom' ||
          c.attributes?.channel_design_id === 'booking_com',
      );
      if (!bdcChannel) {
        throw new HttpException(
          'No Booking.com channel found for this property.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      channexChannelId = bdcChannel.id;
    }

    const channelDetails = await this.channex.getChannelDetails(channexChannelId);
    const raw = await this.channex.getMappingDetails(channelDetails.channel, channelDetails.settings);
    const entries = this.parseMappingDetails(raw);

    // Group all rates by room
    const roomsMap = new Map<string, BdcMappingEntry[]>();
    for (const entry of entries) {
      const group = roomsMap.get(entry.otaRoomId) ?? [];
      roomsMap.set(entry.otaRoomId, [...group, entry]);
    }

    // Single property with all BDC rooms nested inside
    const rooms: ListingPreviewRoom[] = [];
    for (const [otaRoomId, roomEntries] of roomsMap) {
      rooms.push({
        id: otaRoomId,
        roomName: roomEntries[0].otaRoomTitle,
        rates: roomEntries.map((e) => ({ id: e.otaRateId, rateName: e.otaRateTitle })),
      });
    }

    return [
      {
        id: propertyId,
        propertyName: '',
        rooms,
      },
    ];
  }

  async syncBdc(
    propertyId: string,
    tenantId: string,
    channelId?: string,
    nameOverrides?: SyncNameOverrides,
  ): Promise<BdcSyncResult> {
    this.logger.log(`[BDC_SYNC] ▶ Starting — parentPropertyId=${propertyId} tenantId=${tenantId}`);

    // ── Step 0: Resolve BDC channel ID ─────────────────────────────────────────
    let channexChannelId: string;
    if (channelId) {
      channexChannelId = channelId;
      this.logger.log(`[BDC_SYNC] BDC channel provided — channelId=${channexChannelId}`);
    } else {
      const channels = await this.channex.getChannels(propertyId);
      const bdcChannel = channels.find(
        (c) =>
          c.attributes?.channel === 'BookingCom' ||
          c.attributes?.channel_design_id === 'booking_com',
      );
      if (!bdcChannel) {
        throw new HttpException(
          'No Booking.com channel found for this property. Complete the Channex IFrame popup first.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      channexChannelId = bdcChannel.id;
      this.logger.log(`[BDC_SYNC] BDC channel discovered — channelId=${channexChannelId}`);
    }

    // ── Step 1: Fetch mapping_details ──────────────────────────────────────────
    const channelDetails = await this.channex.getChannelDetails(channexChannelId);
    const raw = await this.channex.getMappingDetails(channelDetails.channel, channelDetails.settings);
    const entries = this.parseMappingDetails(raw);
    this.logger.log(`[BDC_SYNC] mapping_details ✓ — entries=${entries.length}`);

    if (entries.length === 0) {
      throw new HttpException(
        'mapping_details returned no rooms. Ensure the Booking.com Hotel ID was entered in the IFrame popup.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // ── Step 2: Resolve parent doc metadata ────────────────────────────────────
    const parentDoc = await this.resolveParentDoc(propertyId);

    // ── Phase 1: Create room types + rate plans under parentPropertyId ─────────
    const succeeded: BdcRoomResult[] = [];
    const failed: BdcRoomFailure[] = [];
    const roomTypesForFirestore: StoredRoomType[] = [];

    // room mapping accumulator: otaRoomId → channexRoomTypeId
    const roomMappings: Record<string, string> = {};
    // rate plan mapping accumulator for channel update body
    const ratePlanMappings: Array<Record<string, unknown>> = [];

    const roomsMap = new Map<string, BdcMappingEntry[]>();
    for (const entry of entries) {
      const group = roomsMap.get(entry.otaRoomId) ?? [];
      roomsMap.set(entry.otaRoomId, [...group, entry]);
    }

    for (const [otaRoomId, roomEntries] of roomsMap) {
      const first = roomEntries[0];
      const override = nameOverrides?.[otaRoomId];
      const roomTitle = override?.roomName ?? first.otaRoomTitle;
      let currentStep: BdcRoomFailure['step'] = 'A';

      try {
        // ── Step A: Create room type under parentPropertyId ───────────────────
        currentStep = 'A';
        const rtResp = await this.channex.createRoomType({
          property_id: propertyId,
          title: roomTitle,
          count_of_rooms: 1,
          occ_adults: first.maxPersons,
          occ_children: 0,
          occ_infants: 0,
          default_occupancy: first.maxPersons,
        });
        const roomTypeId = rtResp.data.id;
        this.logger.log(
          `[BDC_SYNC] ✓ A — Room type created — "${roomTitle}" roomTypeId=${roomTypeId}`,
        );

        // ── Step B: Create rate plans under parentPropertyId ─────────────────
        currentStep = 'B';
        const ratePlanIds: string[] = [];
        for (const rateEntry of roomEntries) {
          const rateName = override?.rates?.[rateEntry.otaRateId] ?? rateEntry.otaRateTitle;
          const rpResp = await this.channex.createRatePlan({
            property_id: propertyId,
            room_type_id: roomTypeId,
            title: rateName,
            options: [{ occupancy: rateEntry.maxPersons, is_primary: true, rate: 0 }],
          });
          const ratePlanId = rpResp.data.id;
          ratePlanIds.push(ratePlanId);
          this.logger.log(
            `[BDC_SYNC] ✓ B — Rate plan created — "${rateName}" ratePlanId=${ratePlanId}`,
          );
          ratePlanMappings.push({
            rate_plan_id: ratePlanId,
            settings: {
              room_type_code: Number(rateEntry.otaRoomId),
              rate_plan_code: Number(rateEntry.otaRateId),
              occupancy: rateEntry.maxPersons,
              readonly: rateEntry.readonly,
              primary_occ: true,
              occ_changed: false,
              pricing_type: rateEntry.pricingType,
            },
          });
        }

        roomMappings[otaRoomId] = roomTypeId;
        succeeded.push({
          otaRoomId,
          otaRoomTitle: first.otaRoomTitle,
          channexRoomTitle: roomTitle,
          roomTypeId,
          ratePlanIds,
        });
        roomTypesForFirestore.push({
          room_type_id: roomTypeId,
          title: roomTitle,
          count_of_rooms: 1,
          default_occupancy: first.maxPersons,
          occ_adults: first.maxPersons,
          occ_children: 0,
          occ_infants: 0,
          source: 'booking',
          ota_room_id: otaRoomId,
          migo_property_id: override?.migoPropertyId ?? undefined,
          rate_plans: roomEntries.map((rateEntry, i) => {
            const rateName = override?.rates?.[rateEntry.otaRateId] ?? rateEntry.otaRateTitle;
            return {
              rate_plan_id: ratePlanIds[i],
              title: rateName,
              currency: parentDoc.currency,
              rate: 0,
              occupancy: rateEntry.maxPersons,
              is_primary: i === 0,
              ota_rate_id: rateEntry.otaRateId,   // ← correct: per-rate BDC ID
            } as StoredRatePlan;
          }),
        });
      } catch (err) {
        const reason = (err as Error).message ?? String(err);
        this.logger.error(
          `[BDC_SYNC] Step ${currentStep} failed — otaRoomId=${otaRoomId}: ${reason}`,
        );
        failed.push({ otaRoomId, otaRoomTitle: first.otaRoomTitle, step: currentStep, reason });
      }
    }

    if (succeeded.length === 0) {
      throw new HttpException(
        'All BDC rooms failed to provision. Check server logs for details.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // ── Phase 2: Channel + webhook + app — all on parentPropertyId ─────────────

    // ── Step C: Apply full room+rate mapping on BDC channel ───────────────────
    await this.channex.updateChannel(channexChannelId, {
      settings: { ...channelDetails.settings, mappingSettings: { rooms: roomMappings } },
      rate_plans: ratePlanMappings,
    });
    this.logger.log(
      `[BDC_SYNC] ✓ C — Channel mappings applied — rooms=${Object.keys(roomMappings).length} rates=${ratePlanMappings.length}`,
    );

    // ── Step D: Activate BDC channel ─────────────────────────────────────────
    try {
      await this.channex.activateChannelAction(channexChannelId);
    } catch {
      this.logger.warn('[BDC_SYNC] activateChannelAction failed — falling back to PUT is_active');
      await this.channex.activateChannel(channexChannelId);
    }
    this.logger.log(`[BDC_SYNC] ✓ D — BDC channel activated`);

    // ── Step E: Register webhook on parentPropertyId (once) ──────────────────
    const webhookId = await this.registerPropertyWebhook(propertyId);
    this.logger.log(
      `[BDC_SYNC] ✓ E — Webhook — propertyId=${propertyId} webhookId=${webhookId ?? 'none'}`,
    );

    // ── Step F: Install Messages App on parentPropertyId (once, non-fatal) ──────
    try {
      await this.channex.installApplication(propertyId, ChannexService.APP_IDS.channex_messages);
      this.logger.log(`[BDC_SYNC] ✓ F — Messages App installed — propertyId=${propertyId}`);
    } catch (err) {
      this.logger.warn(
        `[BDC_SYNC] Messages App install failed (non-fatal): ${(err as Error).message}`,
      );
    }

    // ── Step G: Install Booking CRS App (non-fatal) ───────────────────────────
    try {
      await this.channex.installBookingCrsApp(propertyId);
      this.logger.log(`[BDC_SYNC] ✓ G — Booking CRS installed — propertyId=${propertyId}`);
    } catch (err) {
      this.logger.warn(
        `[BDC_SYNC] Booking CRS install failed (non-fatal): ${(err as Error).message}`,
      );
    }

    // ── Step H: Persist to Firestore ─────────────────────────────────────────
    await this.persistToFirestore(
      propertyId,
      tenantId,
      channexChannelId,
      webhookId,
      roomTypesForFirestore,
    );

    this.logger.log(
      `[BDC_SYNC] ✓ Pipeline complete — tenantId=${tenantId} succeeded=${succeeded.length} failed=${failed.length}`,
    );

    return { channexChannelId, channexPropertyId: propertyId, webhookId, succeeded, failed };
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private parseMappingDetails(raw: Record<string, unknown>): BdcMappingEntry[] {
    const rooms = (raw as any)?.data?.rooms;

    if (!Array.isArray(rooms)) {
      throw new HttpException(
        `mapping_details returned an unrecognised shape — expected data.rooms[]. Raw: ${JSON.stringify(raw, null, 2)}`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const entries: BdcMappingEntry[] = [];

    for (const room of rooms) {
      if (!room?.id) continue;
      const otaRoomId = String(room.id);
      const otaRoomTitle = String(room.title ?? `Room ${otaRoomId}`);
      const rates: any[] = Array.isArray(room.rates) ? room.rates : [];

      if (rates.length === 0) {
        this.logger.warn(`[BDC_SYNC] Room "${otaRoomTitle}" has no rates — skipping`);
        continue;
      }

      for (const rate of rates) {
        if (!rate?.id) continue;
        entries.push({
          otaRoomId,
          otaRoomTitle,
          otaRateId: String(rate.id),
          otaRateTitle: String(rate.title ?? `Rate ${rate.id}`),
          maxPersons: typeof rate.max_persons === 'number' ? rate.max_persons : 2,
          readonly: Boolean(rate.readonly ?? false),
          pricingType: String(rate.pricing ?? 'Standard'),
        });
      }
    }

    return entries;
  }

  private async resolveParentDoc(propertyId: string): Promise<{
    timezone: string;
    channex_group_id: string | null;
    currency: string;
  }> {
    const db = this.firebase.getFirestore();
    const snapshot = await db
      .collectionGroup('properties')
      .where('channex_property_id', '==', propertyId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      throw new NotFoundException(
        `No integration document found for Channex property ID: ${propertyId}`,
      );
    }

    const data = snapshot.docs[0].data();
    return {
      timezone: (data.timezone as string | undefined) || 'UTC',
      channex_group_id: (data.channex_group_id as string | null | undefined) ?? null,
      currency: (data.currency as string | undefined) || 'USD',
    };
  }

  private async registerPropertyWebhook(channexPropertyId: string): Promise<string | null> {
    try {
      const baseCallbackUrl = process.env.CHANNEX_WEBHOOK_CALLBACK_URL;
      if (!baseCallbackUrl) {
        this.logger.warn(
          `[BDC_SYNC] Webhook skipped — CHANNEX_WEBHOOK_CALLBACK_URL not set. propertyId=${channexPropertyId}`,
        );
        return null;
      }

      const webhookSecret = this.secrets.get('CHANNEX_WEBHOOK_SECRET');
      if (!webhookSecret) {
        this.logger.warn(
          `[BDC_SYNC] Webhook skipped — CHANNEX_WEBHOOK_SECRET not set. propertyId=${channexPropertyId}`,
        );
        return null;
      }

      const callbackUrl = `${baseCallbackUrl}/api/channex/webhook`;

      const existing = await this.channex.listPropertyWebhooks(channexPropertyId);
      const found = existing.find((wh) => wh.attributes?.callback_url === callbackUrl);
      if (found) {
        this.logger.log(
          `[BDC_SYNC] Webhook already registered — propertyId=${channexPropertyId} webhookId=${found.id}`,
        );
        return found.id;
      }

      const payload: ChannexWebhookPayload = {
        property_id: channexPropertyId,
        callback_url: callbackUrl,
        event_mask: BDC_EVENT_MASK,
        send_data: true,
        is_active: true,
        headers: { 'x-channex-signature': webhookSecret },
      };

      const result = await this.channex.createWebhookSubscription(payload);
      return result.webhookId ?? null;
    } catch (err) {
      this.logger.warn(
        `[BDC_SYNC] Webhook registration failed (non-fatal) — propertyId=${channexPropertyId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async persistToFirestore(
    parentPropertyId: string,
    tenantId: string,
    channexChannelId: string,
    webhookId: string | null,
    roomTypes: StoredRoomType[],
  ): Promise<void> {
    const db = this.firebase.getFirestore();
    const now = new Date().toISOString();

    // roomTypes[] already built with correct ota_rate_id and occupancy in syncBdc()

    // Merge new BDC room types into base property doc (preserves manual rooms)
    const propertyRef = db
      .collection(COLLECTION)
      .doc(tenantId)
      .collection('properties')
      .doc(parentPropertyId);

    const existingSnap = await propertyRef.get();
    const existing = existingSnap.exists
      ? ((existingSnap.data()?.room_types as StoredRoomType[] | undefined) ?? [])
      : [];

    // Replace all 'booking' source rooms with the new set (idempotent re-sync)
    const merged = mergeRoomTypes(existing, roomTypes, 'booking');

    await this.firebase.set(
      propertyRef,
      {
        channex_channel_id: channexChannelId,
        channex_webhook_id: webhookId,
        connection_status: ChannexConnectionStatus.Active,
        connected_channels: ['booking'],
        room_types: merged,
        last_bdc_sync_timestamp: now,
        updated_at: now,
      },
      { merge: true },
    );

    this.logger.log(
      `[BDC_SYNC] ✓ Base property doc updated — propertyId=${parentPropertyId} rooms=${roomTypes.length}`,
    );

    // Update root integration doc with sync metadata
    const rootRef = db.collection(COLLECTION).doc(tenantId);
    await this.firebase.update(rootRef, {
      last_bdc_sync_timestamp: now,
      bdc_channel_id: channexChannelId,
      bdc_webhook_id: webhookId,
      updated_at: now,
    });

    // Register channel doc so getPropertyBookings can resolve propertyChannelCode
    try {
      const ch = await this.channex.getChannelDetails(channexChannelId);
      await db
        .collection(COLLECTION)
        .doc(tenantId)
        .collection('channels')
        .doc(channexChannelId)
        .set({
          channel_id: channexChannelId,
          title: ch.title,
          channel_code: ch.channel,
          status: ch.status,
          is_active: ch.isActive,
          synced_at: now,
          updated_at: now,
        });
    } catch (err) {
      this.logger.warn(
        `[BDC_SYNC] WARN — Could not register channel doc (non-fatal): ${(err as Error).message}`,
      );
    }
  }
}

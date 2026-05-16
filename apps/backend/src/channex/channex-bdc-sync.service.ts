import { HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { SecretManagerService } from '../common/secrets/secret-manager.service';
import { ChannexService } from './channex.service';
import { StoredRoomType, StoredRatePlan } from './channex-ari.service';
import { ChannexConnectionStatus, ChannexWebhookPayload } from './channex.types';

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

export interface IsolatedBdcResult {
  otaRoomId: string;
  otaRoomTitle: string;
  channexPropertyId: string;
  roomTypeId: string;
  ratePlanIds: string[];
  webhookId: string | null;
}

export interface IsolatedBdcFailure {
  otaRoomId: string;
  otaRoomTitle: string;
  step: 'A' | 'B' | 'C' | 'D' | 'E';
  reason: string;
}

export interface BdcSyncResult {
  channexChannelId: string;
  succeeded: IsolatedBdcResult[];
  failed: IsolatedBdcFailure[];
}

/**
 * ChannexBdcSyncService — 1:1 Isolated Provisioning for Booking.com.
 *
 * Mirrors the Airbnb isolated model: one dedicated Channex property per BDC
 * room type. The base property (used for the IFrame OAuth) is never modified.
 *
 * Pipeline per BDC room (from mapping_details):
 *   A  POST /api/v1/properties       → isolated Channex property (title = BDC room title)
 *   B  POST /api/v1/room_types        → room type under A
 *   C  POST /api/v1/rate_plans        → rate plan(s) under B
 *   D  POST /api/v1/applications/install → Messages App on A
 *
 * After all rooms:
 *   E  PUT  /api/v1/channels/:id      → apply all room/rate mappings on base BDC channel
 *   F  POST /api/v1/channels/:id/activate
 *   G  POST /api/v1/webhooks          → webhook on BASE property (where BDC channel lives)
 *   H  Persist isolated property docs + root metadata to Firestore
 */
@Injectable()
export class ChannexBdcSyncService {
  private readonly logger = new Logger(ChannexBdcSyncService.name);

  constructor(
    private readonly channex: ChannexService,
    private readonly firebase: FirebaseService,
    private readonly secrets: SecretManagerService,
  ) {}

  async syncBdc(propertyId: string, tenantId: string): Promise<BdcSyncResult> {
    this.logger.log(`[BDC_SYNC] ▶ Starting — parentPropertyId=${propertyId} tenantId=${tenantId}`);

    // ── Step 0: Discover BDC channel on base property ─────────────────────────
    const channels = await this.channex.getChannels(propertyId);
    const bdcChannel = channels.find(
      (c: any) =>
        c.attributes?.channel === 'BookingCom' ||
        c.attributes?.channel_design_id === 'booking_com',
    );

    if (!bdcChannel) {
      throw new HttpException(
        'No Booking.com channel found for this property. Complete the Channex IFrame popup first.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const channexChannelId: string = bdcChannel.id;
    this.logger.log(`[BDC_SYNC] BDC channel found — channelId=${channexChannelId}`);

    // ── Step 1: Fetch mapping_details (BDC room/rate catalog) ─────────────────
    const channelDetails = await this.channex.getChannelDetails(channexChannelId);
    const raw = await this.channex.getMappingDetails(
      channelDetails.channel,
      channelDetails.settings,
    );
    const entries = this.parseMappingDetails(raw);
    this.logger.log(`[BDC_SYNC] mapping_details ✓ — entries=${entries.length}`);

    if (entries.length === 0) {
      throw new HttpException(
        'mapping_details returned no rooms. Ensure the Booking.com Hotel ID was entered in the IFrame popup.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // ── Step 2: Resolve parent doc for timezone / groupId / currency ───────────
    const parentDoc = await this.resolveParentDoc(propertyId);

    // ── Step 3: 1:1 — one isolated Channex property per BDC room ──────────────
    const succeeded: IsolatedBdcResult[] = [];
    const failed: IsolatedBdcFailure[] = [];

    // Group entries by room so each room is processed once with all its rates
    const roomsMap = new Map<string, BdcMappingEntry[]>();
    for (const entry of entries) {
      const group = roomsMap.get(entry.otaRoomId) ?? [];
      roomsMap.set(entry.otaRoomId, [...group, entry]);
    }

    // Accumulators for the BDC channel update (Step E)
    const roomMappings: Record<string, string> = {};
    const ratePlanMappings: Array<Record<string, unknown>> = [];

    for (const [otaRoomId, roomEntries] of roomsMap) {
      const first = roomEntries[0];
      let newPropertyId: string | null = null;
      let currentStep: IsolatedBdcFailure['step'] = 'A';

      try {
        // ── Step A: Create isolated Channex property ─────────────────────────
        currentStep = 'A';
        const propResp = await this.channex.createProperty({
          title: first.otaRoomTitle,
          currency: parentDoc.currency,
          timezone: parentDoc.timezone,
          property_type: 'apartment',
          ...(parentDoc.channex_group_id ? { group_id: parentDoc.channex_group_id } : {}),
          settings: {
            min_stay_type: 'arrival',
            allow_availability_autoupdate_on_confirmation: true,
          },
        });
        newPropertyId = propResp.data.id;
        this.logger.log(
          `[BDC_SYNC] ✓ A — Property created — "${first.otaRoomTitle}" newPropertyId=${newPropertyId}`,
        );

        // ── Step B: Create room type under the new property ──────────────────
        currentStep = 'B';
        const rtResp = await this.channex.createRoomType({
          property_id: newPropertyId,
          title: first.otaRoomTitle,
          count_of_rooms: 1,
          occ_adults: first.maxPersons,
          occ_children: 0,
          occ_infants: 0,
          default_occupancy: first.maxPersons,
        });
        const roomTypeId = rtResp.data.id;
        this.logger.log(
          `[BDC_SYNC] ✓ B — Room Type created — roomTypeId=${roomTypeId} capacity=${first.maxPersons}`,
        );

        // ── Step C: Create rate plans for all rates of this room ─────────────
        currentStep = 'C';
        const ratePlanIds: string[] = [];
        for (const rateEntry of roomEntries) {
          const rpResp = await this.channex.createRatePlan({
            property_id: newPropertyId,
            room_type_id: roomTypeId,
            title: rateEntry.otaRateTitle,
            options: [{ occupancy: rateEntry.maxPersons, is_primary: true, rate: 0 }],
          });
          const ratePlanId = rpResp.data.id;
          ratePlanIds.push(ratePlanId);
          this.logger.log(
            `[BDC_SYNC] ✓ C — Rate Plan created — "${rateEntry.otaRateTitle}" ratePlanId=${ratePlanId}`,
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

        // ── Step D: Register webhook on isolated property (non-fatal) ────────
        currentStep = 'D';
        const webhookId = await this.registerPropertyWebhook(newPropertyId);
        this.logger.log(
          `[BDC_SYNC] ✓ D — Webhook — newPropertyId=${newPropertyId} webhookId=${webhookId ?? 'none'}`,
        );

        // ── Step E: Install Messages App on isolated property ────────────────
        currentStep = 'E';
        await this.channex.installApplication(
          newPropertyId,
          ChannexService.APP_IDS.channex_messages,
        );
        this.logger.log(
          `[BDC_SYNC] ✓ E — Messages App installed — newPropertyId=${newPropertyId}`,
        );

        succeeded.push({ otaRoomId, otaRoomTitle: first.otaRoomTitle, channexPropertyId: newPropertyId, roomTypeId, ratePlanIds, webhookId });
      } catch (err) {
        const reason = (err as Error).message ?? String(err);
        this.logger.error(
          `[BDC_SYNC] Step ${currentStep} failed — otaRoomId=${otaRoomId} title="${first.otaRoomTitle}": ${reason}`,
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

    // ── Step E: Apply channel mappings on the BDC channel (base property) ────
    await this.channex.updateChannel(channexChannelId, {
      settings: { ...channelDetails.settings, mappingSettings: { rooms: roomMappings } },
      rate_plans: ratePlanMappings,
    });
    this.logger.log(
      `[BDC_SYNC] ✓ E — Channel mappings applied — rooms=${Object.keys(roomMappings).length} rates=${ratePlanMappings.length}`,
    );

    // ── Step E.5: Re-assign channel property to first isolated property ───────
    // BDC channels are created under the base property (used only for the IFrame
    // popup). Channex delivers booking webhooks to the channel's assigned property.
    // We must update property_id to the first isolated property before activation
    // so webhooks route there instead of to the base property (which has no webhook).
    const webhookTargetPropertyId = succeeded[0].channexPropertyId;
    await this.channex.updateChannel(channexChannelId, {
      property_id: webhookTargetPropertyId,
    });
    this.logger.log(
      `[BDC_SYNC] ✓ E.5 — Channel re-assigned to isolated property — propertyId=${webhookTargetPropertyId}`,
    );

    // ── Step F: Activate BDC channel ─────────────────────────────────────────
    try {
      await this.channex.activateChannelAction(channexChannelId);
    } catch {
      this.logger.warn('[BDC_SYNC] activateChannelAction failed — falling back to PUT is_active');
      await this.channex.activateChannel(channexChannelId);
    }
    this.logger.log(`[BDC_SYNC] ✓ F — BDC channel activated`);

    // ── Step G: Persist to Firestore ──────────────────────────────────────────
    await this.persistToFirestore(propertyId, tenantId, channexChannelId, succeeded, parentDoc);

    this.logger.log(
      `[BDC_SYNC] ✓ Pipeline complete — tenantId=${tenantId} succeeded=${succeeded.length} failed=${failed.length}`,
    );

    return { channexChannelId, succeeded, failed };
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
    succeeded: IsolatedBdcResult[],
    parentDoc: { timezone: string; channex_group_id: string | null; currency: string },
  ): Promise<void> {
    const db = this.firebase.getFirestore();
    const now = new Date().toISOString();

    // One properties subcollection doc per isolated property (same structure as Airbnb)
    for (const s of succeeded) {
      const propertyRef = db
        .collection(COLLECTION)
        .doc(tenantId)
        .collection('properties')
        .doc(s.channexPropertyId);

      const roomType: StoredRoomType = {
        room_type_id: s.roomTypeId,
        title: s.otaRoomTitle,
        count_of_rooms: 1,
        default_occupancy: 2,
        occ_adults: 2,
        occ_children: 0,
        occ_infants: 0,
        source: 'booking',
        ota_room_id: s.otaRoomId,
        rate_plans: s.ratePlanIds.map((id) => ({
          rate_plan_id: id,
          title: s.otaRoomTitle,
          currency: parentDoc.currency,
          rate: 0,
          occupancy: 2,
          is_primary: true,
          ota_rate_id: s.otaRoomId,
        } as StoredRatePlan)),
      };

      await this.firebase.set(propertyRef, {
        channex_property_id: s.channexPropertyId,
        tenant_id: tenantId,
        channex_group_id: parentDoc.channex_group_id,
        channex_channel_id: channexChannelId,
        channex_webhook_id: s.webhookId ?? null,
        connection_status: ChannexConnectionStatus.Active,
        title: s.otaRoomTitle,
        currency: parentDoc.currency,
        timezone: parentDoc.timezone,
        property_type: 'apartment',
        connected_channels: ['booking'],
        room_types: [roomType],
        booking_room_id: s.otaRoomId,
        integrationDocId: tenantId,
        created_at: now,
        updated_at: now,
      });

      this.logger.log(
        `[BDC_SYNC] ✓ Property doc written — channexPropertyId=${s.channexPropertyId} title="${s.otaRoomTitle}"`,
      );
    }

    // Update root integration doc with sync metadata (parent property doc is NOT touched)
    const rootRef = db.collection(COLLECTION).doc(tenantId);
    await this.firebase.update(rootRef, {
      last_bdc_sync_timestamp: now,
      bdc_channel_id: channexChannelId,
      bdc_webhook_id: succeeded[0]?.webhookId ?? null,
      updated_at: now,
    });

    this.logger.log(
      `[BDC_SYNC] ✓ Firestore updated — tenantId=${tenantId} succeeded=${succeeded.length}`,
    );
  }
}

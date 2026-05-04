import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { FieldValue } from 'firebase-admin/firestore';
import { FirebaseService } from '../firebase/firebase.service';
import { ChannexService } from '../channex/channex.service';
import { SecretManagerService } from '../common/secrets/secret-manager.service';
import type { ChannexWebhookPayload } from '../channex/channex.types';

// BDC webhook event triggers (semicolon-separated per Channex API contract)
const BDC_EVENT_MASK =
  'booking_new;booking_modification;booking_cancellation;message_new;inquiry_new;booking_inquiry';

// ─── Firestore collection ─────────────────────────────────────────────────────

const CHANNEX_INTEGRATIONS = 'channex_integrations';

// ─── BDC mapping entry ────────────────────────────────────────────────────────

/**
 * A single flattened OTA room+rate pair as returned by parseBdcMappingDetails().
 *
 * Booking.com nests rates inside rooms in the mapping_details response:
 *   data.rooms[].rates[]
 * We flatten this into one entry per rate so each entry maps 1:1 to a
 * Channex Rate Plan and one channel mapping record.
 *
 * Fields `maxPersons`, `readonly`, and `pricingType` are captured directly from
 * the BDC rate object and forwarded verbatim into the channel mapping payload so
 * Channex stores the same values the UI would have sent.
 */
interface BdcMappingEntry {
  otaRoomId: string;
  otaRoomTitle: string;
  otaRateId: string;
  otaRateTitle: string;
  maxPersons: number;    // rate.max_persons from mapping_details
  readonly: boolean;     // rate.readonly
  pricingType: string;   // rate.pricing
}

// ─── Pipeline result ──────────────────────────────────────────────────────────

export interface CommitPipelineResult {
  channexPropertyId: string;
  channexChannelId: string;
  webhookId: string | undefined;
  roomTypesCreated: number;
  ratePlansCreated: number;
  mappingsCreated: number;
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * BookingPipelineService — orchestrates Steps 4–8 of the Booking.com
 * via Channex.io integration pipeline.
 *
 * Steps 1–3 (group, property, IFrame token) are handled by BookingService.
 * BookingService.syncBooking() discovers the channel and stores the channel_id.
 * This service picks up after both complete.
 *
 * Pre-condition: `channex_integrations/{tenantId}` must contain:
 *   - channex_channel_id   (written by BookingService.syncBooking)
 *   - channex_property_id  (written by BookingService.getSessionToken)
 *
 * ─── BDC mapping_details response shape (confirmed via network trace) ─────────
 *
 *   POST /api/v1/channels/mapping_details
 *   Body: { channel: "BookingCom", settings: <from GET /channels/{id}> }
 *
 *   Response:
 *   {
 *     "data": {
 *       "rooms": [
 *         {
 *           "id": 1215249402,          ← number, cast to string
 *           "title": "Deluxe Double Room",
 *           "rates": [
 *             { "id": 47420297, "title": "Standard Rate" }
 *           ]
 *         }
 *       ]
 *     }
 *   }
 *
 * ─── Endpoint sources ─────────────────────────────────────────────────────────
 *
 * Step 4a  GET /channels/{id} → extract channel code + settings
 *          POST /channels/mapping_details → BDC rooms nested with rates
 *
 * Step 4b  POST /api/v1/room_types (one per unique BDC room, idempotent by title prefix BDC:)
 * Step 4c  POST /api/v1/rate_plans  (one per BDC rate, idempotent by title prefix BDC:)
 *
 * Step 5   POST /api/v1/channels/{channel_id}/mappings
 *          payload: { mapping: { rate_plan_id, settings: { room_id, rate_id } } }
 *          Confirmed CREATE endpoint (Airbnb Connection API PDF, p.8).
 *
 * Step 6   POST /api/v1/channels/{channel_id}/activate
 *
 * Steps 7/8  Webhook + App install — confirmed endpoints.
 *
 * ─── Idempotency contract ─────────────────────────────────────────────────────
 *   - Room types / rate plans: matched by title prefix `BDC:` before creation.
 *   - Webhook: preflight GET by callback_url.
 *   - App install: 422 treated as already-installed.
 *   - Mapping: 422 treated as already-mapped.
 */
@Injectable()
export class BookingPipelineService {
  private readonly logger = new Logger(BookingPipelineService.name);
  private readonly callbackUrl: string;

  constructor(
    private readonly channex: ChannexService,
    private readonly firebase: FirebaseService,
    private readonly secrets: SecretManagerService,
  ) {
    this.callbackUrl =
      `${process.env.NGROK_URL ?? 'http://localhost:3001'}/webhook`;
  }

  // ─── Public entry-point ───────────────────────────────────────────────────

  /**
   * Executes Steps 4–8 after the user completes the Booking.com IFrame popup
   * and POST /booking/sync has persisted the channel_id to Firestore.
   *
   * Pipeline sequence:
   *   4a. GET /channels/{id} → extract settings.
   *       POST /channels/mapping_details → BDC room+rate tree → flatten.
   *   4b. For each unique BDC room → find or create Channex Room Type (BDC: prefix).
   *   4c. For each BDC rate within that room → find or create Channex Rate Plan.
   *   5.  POST /channels/{id}/mappings per entry — settings: { room_id, rate_id }.
   *   6.  POST /channels/{id}/activate.
   *   7.  POST /webhooks — callback_url=/webhook, send_data=true, CHANNEX_WEBHOOK_SECRET.
   *   8.  POST /applications/install — channex_webhooks app.
   */
  async commitPipeline(tenantId: string): Promise<CommitPipelineResult> {
    this.logger.log(`[BDC_PIPELINE] ▶ Starting — tenantId=${tenantId}`);

    // ── Preflight: read Firestore state ────────────────────────────────────
    const db = this.firebase.getFirestore();
    const docRef = db.collection(CHANNEX_INTEGRATIONS).doc(tenantId);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new HttpException(
        `No channex_integrations doc for tenantId=${tenantId}. ` +
          `Run GET /booking/session first.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const data = doc.data()!;
    const channexChannelId: string = data.channex_channel_id ?? '';
    const channexPropertyId: string = data.channex_property_id ?? '';

    if (!channexChannelId || !channexPropertyId) {
      throw new HttpException(
        `channex_channel_id or channex_property_id missing for tenantId=${tenantId}. ` +
          `Complete the IFrame popup then call POST /booking/sync first.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // ── Step 4a: Discover BDC rooms + rates via mapping_details ───────────
    const entries = await this.fetchBdcMappings(channexChannelId);
    this.logger.log(
      `[BDC_PIPELINE] Step 4a ✓ — entries=${entries.length} (rooms×rates flattened)`,
    );

    if (entries.length === 0) {
      throw new HttpException(
        `mapping_details returned no rooms for channelId=${channexChannelId}. ` +
          `Ensure the Booking.com Hotel ID was entered in the IFrame popup.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // ── Steps 4b / 4c: Create Room Types + Rate Plans ──────────────────────
    const { roomTypeMap, ratePlanMap, roomTypesCreated, ratePlansCreated } =
      await this.createRoomsAndRates(channexPropertyId, entries);
    this.logger.log(
      `[BDC_PIPELINE] Steps 4b/4c ✓ — roomTypes=${roomTypesCreated} ratePlans=${ratePlansCreated}`,
    );

    // ── Step 5: Create channel mappings (tier-1 room, tier-2 rate) ────────
    const mappingsCreated = await this.createMappings(
      channexChannelId,
      entries,
      roomTypeMap,
      ratePlanMap,
    );
    this.logger.log(
      `[BDC_PIPELINE] Step 5 ✓ — mappings created=${mappingsCreated}`,
    );

    // ── Step 6: Activate channel ────────────────────────────────────────────
    await this.activateChannel(channexChannelId);
    this.logger.log(`[BDC_PIPELINE] Step 6 ✓ — channel activated`);

    // ── Step 7: Register webhook ────────────────────────────────────────────
    const webhookId = await this.registerWebhook(channexPropertyId);
    this.logger.log(
      `[BDC_PIPELINE] Step 7 ✓ — webhookId=${webhookId ?? 'already_existed'}`,
    );

    // ── Step 8: Install Channex Messages App ───────────────────────────────
    await this.channex.installApplication(
      channexPropertyId,
      ChannexService.APP_IDS.channex_messages,
    );
    this.logger.log(`[BDC_PIPELINE] Step 8 ✓ — Messages App installed`);

    // ── Step 8: Update Firestore State ──────────────────────────────────────
    // Build room_types: one entry per unique Channex room, with its rate plans.
    const roomTypesIndex = new Map<
      string,
      { id: string; title: string; rate_plans: Array<{ id: string; title: string }> }
    >();

    for (const entry of entries) {
      const channexRoomTypeId = roomTypeMap.get(entry.otaRoomId)!;
      if (!roomTypesIndex.has(entry.otaRoomId)) {
        roomTypesIndex.set(entry.otaRoomId, {
          id: channexRoomTypeId,
          title: `BDC: ${entry.otaRoomTitle}`,
          rate_plans: [],
        });
      }
      const rateKey = `${entry.otaRoomId}_${entry.otaRateId}`;
      const channexRatePlanId = ratePlanMap.get(rateKey);
      if (channexRatePlanId) {
        roomTypesIndex.get(entry.otaRoomId)!.rate_plans.push({
          id: channexRatePlanId,
          title: `BDC: ${entry.otaRoomTitle} — ${entry.otaRateTitle}`,
        });
      }
    }

    // Write room_types to the property subcol doc
    const propertyRef = db
      .collection(CHANNEX_INTEGRATIONS)
      .doc(tenantId)
      .collection('properties')
      .doc(channexPropertyId);

    await this.firebase.update(propertyRef, {
      connection_status: 'active',
      channel_name: 'BookingCom',
      channex_channel_id: channexChannelId,
      channex_property_id: channexPropertyId,
      channex_webhook_id: webhookId ?? null,
      room_types: Array.from(roomTypesIndex.values()),
      connected_channels: FieldValue.arrayUnion('booking'),
      pipeline_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Mirror connection_status + channel_id on root doc
    await this.firebase.update(docRef, {
      channex_channel_id: channexChannelId,
      updated_at: new Date().toISOString(),
    });

    this.logger.log(
      `[BDC_PIPELINE] ✓ Pipeline complete — tenantId=${tenantId}`,
    );

    return {
      channexPropertyId,
      channexChannelId,
      webhookId,
      roomTypesCreated,
      ratePlansCreated,
      mappingsCreated,
    };
  }

  // ─── Step 4a — OTA Discovery ──────────────────────────────────────────────

  /**
   * Fetches BDC rooms and rates via POST /channels/mapping_details, then flattens
   * the nested rooms[].rates[] tree into a flat BdcMappingEntry[] array.
   *
   * The channel settings are extracted from GET /channels/{id} verbatim —
   * Channex docs state "tokens should be used from existed Channel".
   */
  private async fetchBdcMappings(channelId: string): Promise<BdcMappingEntry[]> {
    const channelDetails = await this.channex.getChannelDetails(channelId);

    this.logger.log(
      `[BDC_PIPELINE] Channel details — code="${channelDetails.channel}" ` +
        `settingsKeys=[${Object.keys(channelDetails.settings).join(', ')}]`,
    );

    const raw = await this.channex.getMappingDetails(
      channelDetails.channel,
      channelDetails.settings,
    );

    return this.parseBdcMappingDetails(raw);
  }

  /**
   * Parses the POST /channels/mapping_details response for Booking.com.
   *
   * Confirmed response shape (intercepted via network trace):
   *   {
   *     "data": {
   *       "rooms": [
   *         {
   *           "id": 1215249402,           ← number — cast to string
   *           "title": "Deluxe Double Room",
   *           "rates": [
   *             { "id": 47420297, "title": "Standard Rate" }
   *           ]
   *         }
   *       ]
   *     }
   *   }
   *
   * Each room can have multiple rates. We flatten to one BdcMappingEntry per rate
   * so each entry maps 1:1 to a Channex Rate Plan and one channel mapping record.
   *
   * IDs arrive as numbers from the API and are cast to strings here so all
   * downstream code works with consistent string identifiers.
   */
  private parseBdcMappingDetails(raw: Record<string, unknown>): BdcMappingEntry[] {
    const rooms = (raw as any)?.data?.rooms;

    if (!Array.isArray(rooms)) {
      throw new HttpException(
        `[BDC_PIPELINE] mapping_details returned an unrecognised shape — ` +
          `expected data.rooms[]. Raw: ${JSON.stringify(raw, null, 2)}`,
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
        this.logger.warn(
          `[BDC_PIPELINE] Room "${otaRoomTitle}" (${otaRoomId}) has no rates — skipping`,
        );
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

    this.logger.log(
      `[BDC_PIPELINE] Parsed ${entries.length} room×rate entries from mapping_details`,
    );

    return entries;
  }

  // ─── Steps 4b / 4c — Room Types + Rate Plans ─────────────────────────────

  /**
   * Creates Channex Room Types and Rate Plans from the BDC mapping entries.
   *
   * Idempotency strategy:
   *   1. Pre-loads all existing room_types + rate_plans in a single preflight.
   *   2. Matches by exact title (prefix `BDC:`) — never duplicates on retry.
   *   3. One Room Type per unique otaRoomId.
   *   4. One Rate Plan per composite key `{otaRoomId}_{otaRateId}`.
   *      BDC reuses rate_id values across different rooms (e.g. both rooms have
   *      a "Standard Rate" with id=1). Keying by otaRateId alone would cause the
   *      second room to skip creation and collide with the first room's plan.
   *
   * Returns:
   *   roomTypeMap  — otaRoomId → channex room_type UUID
   *   ratePlanMap  — "{otaRoomId}_{otaRateId}" → channex rate_plan UUID (Step 5)
   */
  private async createRoomsAndRates(
    propertyId: string,
    entries: BdcMappingEntry[],
  ): Promise<{
    roomTypeMap: Map<string, string>;
    ratePlanMap: Map<string, string>;
    roomTypesCreated: number;
    ratePlansCreated: number;
  }> {
    const existingRoomTypes = await this.channex.getRoomTypes(propertyId);
    const existingRatePlans = await this.channex.getRatePlans(propertyId);

    const roomTitleToId = new Map<string, string>(
      existingRoomTypes.map((rt) => [rt.attributes.title as string, rt.id]),
    );
    const rateTitleToId = new Map<string, string>(
      existingRatePlans.map((rp) => [rp.attributes.title as string, rp.id]),
    );

    const roomTypeMap = new Map<string, string>(); // otaRoomId → channex UUID
    const ratePlanMap = new Map<string, string>(); // "{otaRoomId}_{otaRateId}" → channex UUID

    let roomTypesCreated = 0;
    let ratePlansCreated = 0;

    for (const entry of entries) {
      // ── Room Type (one per unique otaRoomId) ────────────────────────────
      if (!roomTypeMap.has(entry.otaRoomId)) {
        const roomTitle = `BDC: ${entry.otaRoomTitle}`;
        let channexRoomTypeId = roomTitleToId.get(roomTitle);

        if (!channexRoomTypeId) {
          const created = await this.channex.createRoomType({
            property_id: propertyId,
            title: roomTitle,
            count_of_rooms: 1,
            occ_adults: entry.maxPersons,
            occ_children: 0,
            occ_infants: 0,
            default_occupancy: entry.maxPersons,
          });
          channexRoomTypeId = created.data.id;
          roomTitleToId.set(roomTitle, channexRoomTypeId);
          roomTypesCreated++;
          this.logger.log(
            `[BDC_PIPELINE] ✓ Room type created — "${roomTitle}" id=${channexRoomTypeId}`,
          );
        } else {
          this.logger.log(
            `[BDC_PIPELINE] Reusing room type — "${roomTitle}" id=${channexRoomTypeId}`,
          );
        }

        roomTypeMap.set(entry.otaRoomId, channexRoomTypeId);
      }

      // ── Rate Plan (composite key prevents cross-room ID collision) ───────
      const rateKey = `${entry.otaRoomId}_${entry.otaRateId}`;
      if (!ratePlanMap.has(rateKey)) {
        const channexRoomTypeId = roomTypeMap.get(entry.otaRoomId)!;
        const rateTitle = `BDC: ${entry.otaRoomTitle} — ${entry.otaRateTitle}`;
        let channexRatePlanId = rateTitleToId.get(rateTitle);

        if (!channexRatePlanId) {
          const created = await this.channex.createRatePlan({
            property_id: propertyId,
            room_type_id: channexRoomTypeId,
            title: rateTitle,
            options: [{ occupancy: entry.maxPersons, is_primary: true, rate: 0 }],
          });
          channexRatePlanId = created.data.id;
          rateTitleToId.set(rateTitle, channexRatePlanId);
          ratePlansCreated++;
          this.logger.log(
            `[BDC_PIPELINE] ✓ Rate plan created — "${rateTitle}" id=${channexRatePlanId}`,
          );
        } else {
          this.logger.log(
            `[BDC_PIPELINE] Reusing rate plan — "${rateTitle}" id=${channexRatePlanId}`,
          );
        }

        ratePlanMap.set(rateKey, channexRatePlanId);
      }
    }

    return { roomTypeMap, ratePlanMap, roomTypesCreated, ratePlansCreated };
  }

  // ─── Step 5 — Create Channel Mappings ────────────────────────────────────

  /**
  /**
   * Persists BDC room+rate mappings via a single PUT /api/v1/channels/{channelId}.
   *
   * This matches the exact mechanism used by the Channex UI (intercepted via network
   * trace). Booking.com mappings are NOT stored as individual mapping records —
   * they are embedded directly in the channel document as:
   *
   *   channel.settings.mappingSettings.rooms  — { otaRoomId: channexRoomTypeId }
   *   channel.rate_plans[]                    — one entry per OTA rate, carrying
   *                                             the internal rate_plan_id plus the
   *                                             BDC numeric codes in settings.
   *
   * The PUT payload is built as follows:
   *   settings: { ...existingSettings, mappingSettings: { rooms: { ... } } }
   *   rate_plans: [{ rate_plan_id, settings: { room_type_code, rate_plan_code, ... } }]
   *
   * OTA IDs are cast back to Number() because Channex stores them as integers
   * in room_type_code / rate_plan_code (they arrive as strings in our pipeline
   * after being cast from the mapping_details numeric response).
   *
   * Returns the count of rate plan entries written.
   */
  private async createMappings(
    channelId: string,
    entries: BdcMappingEntry[],
    roomTypeMap: Map<string, string>,
    ratePlanMap: Map<string, string>,
  ): Promise<number> {
    // ── Fetch current channel to preserve existing settings fields ─────────
    const channelDetails = await this.channex.getChannelDetails(channelId);

    // ── Build mappingSettings.rooms: { otaRoomId → channexRoomTypeId } ─────
    const rooms: Record<string, string> = {};
    for (const [otaRoomId, channexRoomTypeId] of roomTypeMap) {
      rooms[otaRoomId] = channexRoomTypeId;
      this.logger.log(
        `[BDC_PIPELINE] Room mapping — otaRoomId=${otaRoomId} → roomTypeId=${channexRoomTypeId}`,
      );
    }

    // ── Build rate_plans array (one entry per flattened BDC rate) ──────────
    const ratePlans: Array<Record<string, unknown>> = [];

    for (const entry of entries) {
      const rateKey = `${entry.otaRoomId}_${entry.otaRateId}`;
      const channexRatePlanId = ratePlanMap.get(rateKey);

      if (!channexRatePlanId) {
        this.logger.warn(
          `[BDC_PIPELINE] No rate plan for rateKey=${rateKey} — skip`,
        );
        continue;
      }

      ratePlans.push({
        rate_plan_id: channexRatePlanId,
        settings: {
          room_type_code: Number(entry.otaRoomId),
          rate_plan_code: Number(entry.otaRateId),
          occupancy: entry.maxPersons,
          readonly: entry.readonly,
          primary_occ: true,
          occ_changed: false,
          pricing_type: entry.pricingType,
        },
      });

      this.logger.log(
        `[BDC_PIPELINE] Rate plan entry — otaRoomId=${entry.otaRoomId} ` +
          `otaRateId=${entry.otaRateId} ratePlanId=${channexRatePlanId}`,
      );
    }

    // ── Single atomic PUT with rooms + rate_plans ──────────────────────────
    await this.channex.updateChannel(channelId, {
      settings: {
        ...channelDetails.settings,
        mappingSettings: { rooms },
      },
      rate_plans: ratePlans,
    });

    this.logger.log(
      `[BDC_PIPELINE] ✓ Channel updated — rooms=${roomTypeMap.size} ratePlans=${ratePlans.length}`,
    );

    return ratePlans.length;
  }

  // ─── Step 6 — Channel Activation ─────────────────────────────────────────

  /**
   * Activates the channel via POST /channels/{id}/activate (PDF page 9).
   * Falls back to PUT is_active if the action endpoint is unavailable on staging.
   */
  private async activateChannel(channelId: string): Promise<void> {
    try {
      await this.channex.activateChannelAction(channelId);
    } catch {
      this.logger.warn(
        `[BDC_PIPELINE] activateChannelAction failed — falling back to PUT is_active`,
      );
      await this.channex.activateChannel(channelId);
    }
  }

  // ─── Step 7 — Webhook Subscription ───────────────────────────────────────

  /**
   * Registers a per-property webhook pointing to the master /webhook endpoint.
   *
   * All channels share POST /webhook. WebhookController routes by payload shape:
   * Channex `event` field → booking-revisions queue → ChannexBookingWorker,
   * which resolves the tenant via channex_property_id index in Firestore.
   *
   * Idempotency: skips POST if a subscription with the same callback_url exists.
   * Security: CHANNEX_WEBHOOK_SECRET from .env.secrets sent as x-channex-signature.
   */
  private async registerWebhook(
    propertyId: string,
  ): Promise<string | undefined> {
    const existingWebhooks =
      await this.channex.listPropertyWebhooks(propertyId);

    const existing = (
      existingWebhooks as Array<{
        id: string;
        attributes: { callback_url: string };
      }>
    ).find((wh) => wh.attributes?.callback_url === this.callbackUrl);

    if (existing) {
      this.logger.log(
        `[BDC_PIPELINE] Webhook already registered — propertyId=${propertyId} ` +
          `webhookId=${existing.id}`,
      );
      return existing.id;
    }

    const hmacSecret = this.secrets.get('CHANNEX_WEBHOOK_SECRET') ?? '';

    const webhookPayload: ChannexWebhookPayload = {
      property_id: propertyId,
      callback_url: this.callbackUrl,
      event_mask: BDC_EVENT_MASK,
      send_data: true,
      is_active: true,
      headers: { 'x-channex-signature': hmacSecret },
    };

    const result = await this.channex.createWebhookSubscription(webhookPayload);
    return result.webhookId;
  }
}

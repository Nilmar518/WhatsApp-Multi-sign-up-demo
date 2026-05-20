import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { ChannexService } from './channex.service';
import { ChannexGroupService } from './channex-group.service';

export interface StoredChannelDoc {
  channel_id: string;
  title: string;
  channel_code: string;
  status: string;
  is_active: boolean;
  synced_at: string;
  updated_at?: string;
}

const COLLECTION = 'channex_integrations';
const CHANNELS_SUBCOLLECTION = 'channels';

@Injectable()
export class ChannexChannelManagementService {
  private readonly logger = new Logger(ChannexChannelManagementService.name);

  constructor(
    private readonly channex: ChannexService,
    private readonly firebase: FirebaseService,
    private readonly groupService: ChannexGroupService,
  ) {}

  /**
   * Returns all OTA channels for the tenant.
   *
   * Firestore-first: if the `channels` subcollection is non-empty, returns its
   * contents without calling Channex. On first call (empty subcollection) it
   * fetches from Channex via getChannelsByGroup and persists the result.
   */
  async getChannelsForTenant(tenantId: string): Promise<StoredChannelDoc[]> {
    const db = this.firebase.getFirestore();
    const channelsCol = db
      .collection(COLLECTION)
      .doc(tenantId)
      .collection(CHANNELS_SUBCOLLECTION);

    const snap = await channelsCol.get();

    if (!snap.empty) {
      this.logger.log(
        `[CHANNEL_MGMT] Firestore cache hit — tenantId=${tenantId} count=${snap.size}`,
      );
      return snap.docs.map((doc) => doc.data() as StoredChannelDoc);
    }

    this.logger.log(
      `[CHANNEL_MGMT] Firestore empty — fetching from Channex — tenantId=${tenantId}`,
    );

    const groupId = await this.groupService.getGroupId(tenantId);
    if (!groupId) {
      throw new NotFoundException(
        `No Channex group found for tenant: ${tenantId}. Provision a property first.`,
      );
    }

    const channels = await this.channex.getChannelsByGroup(groupId);
    this.logger.log(
      `[CHANNEL_MGMT] Fetched ${channels.length} channels from Channex — groupId=${groupId}`,
    );

    const now = new Date().toISOString();
    const batch = db.batch();
    const result: StoredChannelDoc[] = [];

    for (const ch of channels) {
      const doc: StoredChannelDoc = {
        channel_id: ch.id,
        title: ch.attributes.title,
        channel_code: ch.attributes.channel,
        status: ch.attributes.status ?? (ch.attributes.is_active ? 'active' : 'inactive'),
        is_active: ch.attributes.is_active ?? false,
        synced_at: now,
      };
      batch.set(channelsCol.doc(ch.id), doc);
      result.push(doc);
    }

    await batch.commit();
    this.logger.log(
      `[CHANNEL_MGMT] ✓ Channels persisted to Firestore — tenantId=${tenantId} count=${result.length}`,
    );

    return result;
  }

  async activateChannel(channelId: string, tenantId: string): Promise<void> {
    this.logger.log(
      `[CHANNEL_MGMT] Activating channel — channelId=${channelId} tenantId=${tenantId}`,
    );

    await this.channex.enableChannel(channelId);

    const db = this.firebase.getFirestore();
    await db
      .collection(COLLECTION)
      .doc(tenantId)
      .collection(CHANNELS_SUBCOLLECTION)
      .doc(channelId)
      .set(
        { status: 'active', is_active: true, updated_at: new Date().toISOString() },
        { merge: true },
      );

    this.logger.log(`[CHANNEL_MGMT] ✓ Channel activated — channelId=${channelId}`);
  }

  /**
   * Always fetches directly from Channex — bypasses Firestore cache.
   * Used by the channel-select modal so the user sees real-time status.
   */
  async getLiveChannelsForTenant(tenantId: string): Promise<StoredChannelDoc[]> {
    this.logger.log(`[CHANNEL_MGMT] Live fetch from Channex — tenantId=${tenantId}`);

    const db = this.firebase.getFirestore();
    const groupId = await this.groupService.getGroupId(tenantId);
    if (!groupId) {
      throw new NotFoundException(
        `No Channex group found for tenant: ${tenantId}. Provision a property first.`,
      );
    }

    const channels = await this.channex.getChannelsByGroup(groupId);
    this.logger.log(
      `[CHANNEL_MGMT] Live: ${channels.length} channels from Channex — groupId=${groupId}`,
    );

    const now = new Date().toISOString();
    const channelsCol = db.collection(COLLECTION).doc(tenantId).collection(CHANNELS_SUBCOLLECTION);
    const batch = db.batch();

    const result: StoredChannelDoc[] = channels.map((ch) => {
      const doc: StoredChannelDoc = {
        channel_id: ch.id,
        title: ch.attributes.title,
        channel_code: ch.attributes.channel,
        status: ch.attributes.status ?? (ch.attributes.is_active ? 'active' : 'inactive'),
        is_active: ch.attributes.is_active ?? false,
        synced_at: now,
        updated_at: now,
      };
      batch.set(channelsCol.doc(ch.id), doc);
      return doc;
    });

    await batch.commit();
    this.logger.log(
      `[CHANNEL_MGMT] ✓ Live channels persisted to Firestore — tenantId=${tenantId} count=${result.length}`,
    );

    return result;
  }

  async deactivateChannel(channelId: string, tenantId: string): Promise<void> {
    this.logger.log(
      `[CHANNEL_MGMT] Deactivating channel — channelId=${channelId} tenantId=${tenantId}`,
    );

    await this.channex.disableChannel(channelId);

    const db = this.firebase.getFirestore();
    await db
      .collection(COLLECTION)
      .doc(tenantId)
      .collection(CHANNELS_SUBCOLLECTION)
      .doc(channelId)
      .set(
        { status: 'inactive', is_active: false, updated_at: new Date().toISOString() },
        { merge: true },
      );

    this.logger.log(`[CHANNEL_MGMT] ✓ Channel deactivated — channelId=${channelId}`);
  }

  async syncChannelsForTenant(tenantId: string): Promise<{
    added: number;
    alreadyInSync: number;
    extraInFirestore: string[];
  }> {
    this.logger.log(`[CHANNEL_MGMT] syncChannelsForTenant — tenantId=${tenantId}`);
    const db = this.firebase.getFirestore();
    const channelsCol = db
      .collection(COLLECTION)
      .doc(tenantId)
      .collection(CHANNELS_SUBCOLLECTION);

    const groupId = await this.groupService.getGroupId(tenantId);
    if (!groupId) {
      throw new NotFoundException(
        `No Channex group found for tenant: ${tenantId}. Provision a property first.`,
      );
    }

    const [channexChannels, firestoreSnap] = await Promise.all([
      this.channex.getChannelsByGroup(groupId),
      channelsCol.get(),
    ]);

    const channexIds = new Set(channexChannels.map((c) => c.id));
    const firestoreIds = new Set(firestoreSnap.docs.map((d) => d.id));

    const extraInFirestore = [...firestoreIds].filter((id) => !channexIds.has(id));
    const missingInFirestore = channexChannels.filter((c) => !firestoreIds.has(c.id));

    if (missingInFirestore.length > 0) {
      const now = new Date().toISOString();
      const batch = db.batch();
      for (const ch of missingInFirestore) {
        const doc: StoredChannelDoc = {
          channel_id: ch.id,
          title: ch.attributes.title,
          channel_code: ch.attributes.channel,
          status: ch.attributes.status ?? (ch.attributes.is_active ? 'active' : 'inactive'),
          is_active: ch.attributes.is_active ?? false,
          synced_at: now,
        };
        batch.set(channelsCol.doc(ch.id), doc);
      }
      await batch.commit();
    }

    this.logger.log(
      `[CHANNEL_MGMT] ✓ syncChannelsForTenant — added=${missingInFirestore.length} alreadyInSync=${channexChannels.length - missingInFirestore.length} extraInFirestore=${extraInFirestore.length}`,
    );

    return {
      added: missingInFirestore.length,
      alreadyInSync: channexChannels.length - missingInFirestore.length,
      extraInFirestore,
    };
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { ChannexService } from './channex.service';

const COLLECTION = 'channex_groups';

@Injectable()
export class ChannexGroupService {
  private readonly logger = new Logger(ChannexGroupService.name);

  constructor(
    private readonly channex: ChannexService,
    private readonly firebase: FirebaseService,
  ) {}

  /**
   * Returns the Channex Group ID for a given businessId.
   *
   * Resolution order:
   *   1. Firestore cache  (`channex_groups/{businessId}`)
   *   2. Channex API list (group with title === businessId)
   *   3. Channex API create (new group titled businessId)
   *
   * Calling this before provisionProperty ensures every tenant's properties
   * share one Group in Channex, making multi-OTA management (Airbnb, Booking)
   * possible from a single dashboard.
   */
  async ensureGroup(businessId: string): Promise<string> {
    // ── 1. Firestore cache hit ───────────────────────────────────────────────
    const db = this.firebase.getFirestore();
    const docRef = db.collection(COLLECTION).doc(businessId);
    const snap = await docRef.get();

    if (snap.exists) {
      const groupId = snap.data()!.channex_group_id as string;
      this.logger.log(`[GROUP] Cache hit — businessId=${businessId} groupId=${groupId}`);
      return groupId;
    }

    // ── 2. Channex list lookup ───────────────────────────────────────────────
    this.logger.log(`[GROUP] Cache miss — fetching from Channex for businessId=${businessId}`);
    const listResponse = await this.channex.listGroups();
    const existing = listResponse.data.find(
      (g) => g.attributes.title === businessId,
    );

    if (existing) {
      await this.cacheGroup(docRef, existing.id, businessId);
      this.logger.log(`[GROUP] Found existing Channex group — groupId=${existing.id}`);
      return existing.id;
    }

    // ── 3. Create new group ──────────────────────────────────────────────────
    this.logger.log(`[GROUP] Creating new Channex group — title=${businessId}`);
    const created = await this.channex.createGroup(businessId);
    const newGroupId = created.data.id;
    await this.cacheGroup(docRef, newGroupId, businessId);
    this.logger.log(`[GROUP] Created — groupId=${newGroupId}`);
    return newGroupId;
  }

  private async cacheGroup(
    docRef: FirebaseFirestore.DocumentReference,
    channexGroupId: string,
    title: string,
  ): Promise<void> {
    await this.firebase.set(docRef, {
      channex_group_id: channexGroupId,
      title,
      created_at: new Date().toISOString(),
    });
  }
}

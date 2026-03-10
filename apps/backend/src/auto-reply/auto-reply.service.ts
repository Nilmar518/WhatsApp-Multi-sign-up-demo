import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { CreateAutoReplyDto } from './dto/create-auto-reply.dto';
import { UpdateAutoReplyDto } from './dto/update-auto-reply.dto';
import type { AutoReply } from './auto-reply.types';

@Injectable()
export class AutoReplyService {
  private readonly logger = new Logger(AutoReplyService.name);

  constructor(private readonly firebase: FirebaseService) {}

  // ─── Private helper ───────────────────────────────────────────────────────

  private rulesRef(businessId: string) {
    return this.firebase
      .getFirestore()
      .collection('integrations')
      .doc(businessId)
      .collection('auto_replies');
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  async listRules(businessId: string): Promise<AutoReply[]> {
    this.logger.log(`[AUTO_REPLY_LIST] businessId=${businessId}`);
    const snapshot = await this.rulesRef(businessId)
      .orderBy('createdAt', 'asc')
      .get();
    return snapshot.docs.map(
      (doc) => ({ id: doc.id, ...doc.data() }) as AutoReply,
    );
  }

  async createRule(dto: CreateAutoReplyDto): Promise<AutoReply> {
    const { businessId, ...fields } = dto;
    const now = new Date().toISOString();
    const ref = this.rulesRef(businessId).doc();

    const rule: AutoReply = {
      id: ref.id,
      ...fields,
      createdAt: now,
      updatedAt: now,
    };

    await this.firebase.set(ref, rule);
    this.logger.log(
      `[AUTO_REPLY_CREATE] ✓ id=${ref.id} trigger="${dto.triggerWord}" businessId=${businessId}`,
    );
    return rule;
  }

  async updateRule(
    businessId: string,
    ruleId: string,
    dto: UpdateAutoReplyDto,
  ): Promise<AutoReply> {
    const ref = this.rulesRef(businessId).doc(ruleId);
    const snap = await ref.get();

    if (!snap.exists) {
      throw new NotFoundException(`Auto-reply rule not found: id=${ruleId}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { businessId: _ignored, ...fields } = dto;
    const updates = { ...fields, updatedAt: new Date().toISOString() };

    await this.firebase.update(ref, updates);

    const updated: AutoReply = {
      ...(snap.data() as AutoReply),
      ...updates,
      id: ruleId,
    };

    this.logger.log(
      `[AUTO_REPLY_UPDATE] ✓ id=${ruleId} businessId=${businessId}`,
    );
    return updated;
  }

  async deleteRule(businessId: string, ruleId: string): Promise<void> {
    const ref = this.rulesRef(businessId).doc(ruleId);
    const snap = await ref.get();

    if (!snap.exists) {
      throw new NotFoundException(`Auto-reply rule not found: id=${ruleId}`);
    }

    await ref.delete();
    this.logger.log(
      `[AUTO_REPLY_DELETE] ✓ id=${ruleId} businessId=${businessId}`,
    );
  }
}

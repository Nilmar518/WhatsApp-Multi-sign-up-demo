import { Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { FirebaseService } from '../../firebase/firebase.service';
import { ChannexPropertyService } from '../channex-property.service';
import type { ChannexWebhookFullPayload } from '../channex.types';

const INTEGRATIONS_COLLECTION = 'channex_integrations';
const PROPERTIES_SUB_COLLECTION = 'properties';
const THREADS_SUB_COLLECTION = 'threads';
const MESSAGES_SUB_COLLECTION = 'messages';
const WEBHOOK_ERRORS_COLLECTION = 'channex_webhook_errors';

type ProcessResult = { firestoreDocId?: string; discarded: boolean };
type AuditStatus = 'success' | 'discarded' | 'failed';

@Injectable()
export class ChannexMessageWorker {
  private readonly logger = new Logger(ChannexMessageWorker.name);

  constructor(
    private readonly propertyService: ChannexPropertyService,
    private readonly firebase: FirebaseService,
  ) {}

  async handleWithRetry(payload: ChannexWebhookFullPayload): Promise<void> {
    const root = payload;
    const msg = (root.payload ?? {}) as Record<string, unknown>;
    const revisionId =
      (typeof msg.id === 'string' ? msg.id : undefined) ??
      (typeof msg.ota_message_id === 'string' ? msg.ota_message_id : undefined) ??
      (typeof msg.message_thread_id === 'string' ? msg.message_thread_id : undefined) ??
      `noid-${Date.now()}`;
    const propertyId =
      typeof msg.property_id === 'string' ? msg.property_id : root.property_id;
    const event = root.event;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const result = await this.processInternal(payload);
        await this.writeAudit({
          firestoreDocId: result.firestoreDocId,
          revisionId,
          event,
          propertyId,
          status: result.discarded ? 'discarded' : 'success',
          attempts: attempt,
        });
        return;
      } catch (err) {
        lastError = err as Error;
        this.logger.warn(
          `[MESSAGE-WORKER] Attempt ${attempt}/3 failed — revisionId=${revisionId}: ${lastError.message}`,
        );
        if (attempt < 3) await new Promise<void>((r) => setTimeout(r, 1000));
      }
    }

    await this.writeAudit({
      revisionId,
      event,
      propertyId,
      status: 'failed',
      attempts: 3,
      error: lastError?.message,
    });
  }

  private async processInternal(
    payload: ChannexWebhookFullPayload,
  ): Promise<ProcessResult> {
    const root = payload;
    const msg = (root.payload ?? {}) as Record<string, unknown>;
    const event = root.event;
    const isInquiryEvent = event === 'inquiry';
    const isMessageEvent = event === 'message';

    const propertyId =
      typeof msg.property_id === 'string' ? msg.property_id : root.property_id;
    const threadId =
      typeof msg.message_thread_id === 'string' ? msg.message_thread_id : undefined;
    const rawMessageId = msg.id ?? msg.ota_message_id;
    const messageId = typeof rawMessageId === 'string' ? rawMessageId : undefined;
    const bookingId = typeof msg.booking_id === 'string' ? msg.booking_id : null;
    const guestName =
      typeof (msg.meta as Record<string, unknown> | undefined)?.name === 'string'
        ? ((msg.meta as Record<string, unknown>).name as string)
        : 'Unknown Guest';
    const messageText = typeof msg.message === 'string' ? msg.message : '';
    const sender = typeof msg.sender === 'string' ? msg.sender : 'unknown';
    const timestamp = typeof msg.timestamp === 'string' ? msg.timestamp : undefined;
    const bookingDetails =
      typeof msg.booking_details === 'object' && msg.booking_details !== null
        ? (msg.booking_details as Record<string, unknown>)
        : null;
    const inquiryGuestName =
      typeof bookingDetails?.guest_name === 'string'
        ? bookingDetails.guest_name
        : 'Unknown Guest';
    const inquiryCheckinDate =
      typeof bookingDetails?.checkin_date === 'string'
        ? bookingDetails.checkin_date
        : null;
    const inquiryCheckoutDate =
      typeof bookingDetails?.checkout_date === 'string'
        ? bookingDetails.checkout_date
        : null;
    const inquiryListingName =
      typeof bookingDetails?.listing_name === 'string'
        ? bookingDetails.listing_name
        : null;
    const inquiryNights =
      typeof bookingDetails?.nights === 'number' ? bookingDetails.nights : null;
    const inquiryPayoutAmount =
      typeof bookingDetails?.payout_amount === 'number'
        ? bookingDetails.payout_amount
        : null;
    const inquiryCurrency =
      typeof bookingDetails?.currency === 'string' ? bookingDetails.currency : null;
    const inquiryNumberOfGuests =
      typeof bookingDetails?.number_of_guests === 'number'
        ? bookingDetails.number_of_guests
        : null;
    const inquiryNumberOfAdults =
      typeof bookingDetails?.number_of_adults === 'number'
        ? bookingDetails.number_of_adults
        : null;
    const inquiryNumberOfChildren =
      typeof bookingDetails?.number_of_children === 'number'
        ? bookingDetails.number_of_children
        : null;
    const inquiryNumberOfInfants =
      typeof bookingDetails?.number_of_infants === 'number'
        ? bookingDetails.number_of_infants
        : null;
    const inquiryNumberOfPets =
      typeof bookingDetails?.number_of_pets === 'number'
        ? bookingDetails.number_of_pets
        : null;

    this.logger.log(
      `[MESSAGE-WORKER] Processing event=${event ?? '?'} ` +
        `propertyId=${propertyId ?? '?'} ` +
        `threadId=${threadId ?? '?'} ` +
        `messageId=${messageId ?? '?'}`,
    );

    if (!propertyId || !threadId) {
      this.logger.warn(
        `[MESSAGE-WORKER] Missing required field(s) — ` +
          `property_id=${propertyId ?? 'MISSING'} ` +
          `message_thread_id=${threadId ?? 'MISSING'}. Discarded.`,
      );
      return { discarded: true };
    }

    if (isInquiryEvent && !bookingDetails) {
      this.logger.warn(
        `[MESSAGE-WORKER] Missing booking_details for inquiry — threadId=${threadId}. Discarded.`,
      );
      return { discarded: true };
    }

    if (isMessageEvent && !messageId) {
      this.logger.warn(
        `[MESSAGE-WORKER] Missing message_id — ` +
          `propertyId=${propertyId} threadId=${threadId}. Discarded.`,
      );
      return { discarded: true };
    }

    if (!isInquiryEvent && !isMessageEvent) {
      this.logger.warn(
        `[MESSAGE-WORKER] Unsupported event=${event ?? 'undefined'}. Discarded.`,
      );
      return { discarded: true };
    }

    const integration = await this.propertyService.resolveIntegration(propertyId);

    if (!integration) {
      this.logger.error(
        `[MESSAGE-WORKER] No integration found for propertyId=${propertyId}. Discarded.`,
      );
      return { discarded: true };
    }

    const { tenantId, firestoreDocId } = integration;

    this.logger.log(
      `[MESSAGE-WORKER] Resolved — tenantId=${tenantId} firestoreDocId=${firestoreDocId}`,
    );

    const db = this.firebase.getFirestore();
    const serverNow = admin.firestore.FieldValue.serverTimestamp();

    const threadRef = db
      .collection(INTEGRATIONS_COLLECTION)
      .doc(firestoreDocId)
      .collection(PROPERTIES_SUB_COLLECTION)
      .doc(propertyId)
      .collection(THREADS_SUB_COLLECTION)
      .doc(threadId);

    if (isInquiryEvent) {
      await this.firebase.set(
        threadRef,
        {
          propertyId,
          tenantId,
          bookingId: null,
          isInquiry: true,
          guestName: inquiryGuestName,
          listingName: inquiryListingName,
          checkinDate: inquiryCheckinDate,
          checkoutDate: inquiryCheckoutDate,
          nights: inquiryNights,
          payoutAmount: inquiryPayoutAmount,
          currency: inquiryCurrency,
          numberOfGuests: inquiryNumberOfGuests,
          numberOfAdults: inquiryNumberOfAdults,
          numberOfChildren: inquiryNumberOfChildren,
          numberOfInfants: inquiryNumberOfInfants,
          numberOfPets: inquiryNumberOfPets,
          bookingDetails,
          updatedAt: serverNow,
        },
        { merge: true },
      );

      this.logger.log(
        `[MESSAGE-WORKER] ✓ Inquiry thread persisted — threadId=${threadId} tenantId=${tenantId}`,
      );
      return { firestoreDocId, discarded: false };
    }

    const messageRef = threadRef.collection(MESSAGES_SUB_COLLECTION).doc(messageId!);

    const batch = db.batch();

    batch.set(
      threadRef,
      {
        propertyId,
        tenantId,
        bookingId,
        guestName,
        lastMessage: messageText,
        updatedAt: serverNow,
      },
      { merge: true },
    );

    batch.set(messageRef, {
      propertyId,
      threadId,
      bookingId,
      guestName,
      text: messageText,
      sender,
      messageId,
      createdAt: timestamp
        ? admin.firestore.Timestamp.fromDate(new Date(timestamp))
        : serverNow,
      updatedAt: serverNow,
    });

    try {
      await batch.commit();
    } catch (err: unknown) {
      this.logger.error(
        `[MESSAGE-WORKER] Batch commit failed for threadId=${threadId} messageId=${messageId}: ` +
          `${(err as Error).message ?? String(err)}`,
      );
      throw err;
    }

    this.logger.log(
      `[MESSAGE-WORKER] ✓ Persisted — threadId=${threadId} messageId=${messageId} ` +
        `sender=${sender} tenantId=${tenantId}`,
    );

    return { firestoreDocId, discarded: false };
  }

  private async writeAudit(opts: {
    firestoreDocId?: string;
    revisionId: string;
    event: string;
    propertyId?: string;
    status: AuditStatus;
    attempts: number;
    error?: string;
  }): Promise<void> {
    const { firestoreDocId, revisionId, event, propertyId, status, attempts, error } = opts;
    const db = this.firebase.getFirestore();
    const doc: Record<string, unknown> = {
      event,
      propertyId: propertyId ?? null,
      revisionId,
      status,
      attempts,
      processedAt: new Date().toISOString(),
      ...(error ? { error } : {}),
    };

    try {
      if (firestoreDocId) {
        await db
          .collection(INTEGRATIONS_COLLECTION)
          .doc(firestoreDocId)
          .collection('webhook_events')
          .doc(revisionId)
          .set(doc);
      } else {
        await db
          .collection(WEBHOOK_ERRORS_COLLECTION)
          .doc(revisionId)
          .set(doc);
      }
    } catch (auditErr) {
      this.logger.error(
        `[MESSAGE-WORKER] Audit write failed for revisionId=${revisionId}: ` +
          `${(auditErr as Error).message}`,
      );
    }
  }
}

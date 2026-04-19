import { Logger } from '@nestjs/common';
import { Processor, Process } from '@nestjs/bull';
import type { Job } from 'bull';
import * as admin from 'firebase-admin';
import { FirebaseService } from '../../firebase/firebase.service';
import { ChannexPropertyService } from '../channex-property.service';
import type { ChannexWebhookFullPayload } from '../channex.types';

// ─── Firestore path constants ─────────────────────────────────────────────────
//
// Schema (1:1 Vacation Rental model):
//
//   channex_integrations/{integrationDocId}
//     └── properties/{channexPropertyId}
//           └── inquiries/{message_thread_id}
//           └── threads/{message_thread_id}
//                 └── messages/{message_id}

const INTEGRATIONS_COLLECTION = 'channex_integrations';
const PROPERTIES_SUB_COLLECTION = 'properties';
const THREADS_SUB_COLLECTION = 'threads';
const MESSAGES_SUB_COLLECTION = 'messages';

// ─── Worker ───────────────────────────────────────────────────────────────────

/**
 * ChannexMessageWorker — BullMQ consumer for the `channex-messages` queue.
 *
 * Consumes `message` events delivered by the Channex Messages App and persists
 * them to a two-level Firestore structure under the tenant's integration document:
 *
 *   channex_integrations/{firestoreDocId}
 *     └── threads/{message_thread_id}          ← upserted on every message
 *           └── messages/{message_id}          ← inserted once (idempotent)
 *
 * Processing pipeline per job:
 *   1. Resolve tenant context via indexed Firestore query (property_id → docId)
 *   2. Validate required fields; discard gracefully on missing data
 *   3. Batched write:
 *        a. Upsert thread document (lastMessage, guestName, updatedAt, bookingId)
 *        b. Create message document (text, sender, timestamp) — set without merge
 *           so the message id acts as a natural idempotency key; a second
 *           delivery of the same message is a no-op (same doc path, same data).
 *
 * Retry policy (set by controller's job options):
 *   - 3 attempts with 5s fixed backoff on transient Firestore errors
 *   - Missing property_id / unknown property: discarded without retry
 *   - Missing message id or message_thread_id: discarded without retry
 *     (deterministic data error — retrying will not fix missing OTA fields)
 */
@Processor('channex-messages')
export class ChannexMessageWorker {
  private readonly logger = new Logger(ChannexMessageWorker.name);

  constructor(
    private readonly propertyService: ChannexPropertyService,
    private readonly firebase: FirebaseService,
  ) {}

  @Process()
  async process(job: Job<ChannexWebhookFullPayload>): Promise<void> {
    // ── Payload extraction ────────────────────────────────────────────────
    // job.data is the raw webhook root (event, property_id, ...).
    // Message-specific fields are nested under the `payload` key — confirmed
    // from live payload inspection. `property_id` exists on both levels;
    // prefer the nested copy and fall back to the root for resilience.
    const root = job.data;
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
      typeof bookingDetails?.nights === 'number'
        ? bookingDetails.nights
        : null;
    const inquiryPayoutAmount =
      typeof bookingDetails?.payout_amount === 'number'
        ? bookingDetails.payout_amount
        : null;
    const inquiryCurrency =
      typeof bookingDetails?.currency === 'string'
        ? bookingDetails.currency
        : null;
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
      `[MESSAGE-WORKER] Processing job=${job.id} ` +
        `event=${event ?? '?'} ` +
        `propertyId=${propertyId ?? '?'} ` +
        `threadId=${threadId ?? '?'} ` +
        `messageId=${messageId ?? '?'}`,
    );

    // ── Step 1: Validate required routing fields ──────────────────────────
    if (!propertyId || !threadId) {
      this.logger.warn(
        `[MESSAGE-WORKER] Missing required field(s) in job=${job.id} — ` +
          `property_id=${propertyId ?? 'MISSING'} ` +
          `message_thread_id=${threadId ?? 'MISSING'} ` +
          `Job discarded — will NOT be retried.`,
      );
      return;
    }

    if (isInquiryEvent && !bookingDetails) {
      this.logger.warn(
        `[MESSAGE-WORKER] Missing fields for inquiry in job=${job.id} — ` +
          `threadId=${threadId} booking_details=MISSING. ` +
          `Job discarded — will NOT be retried.`,
      );
      return;
    }

    if (isMessageEvent && !messageId) {
      this.logger.warn(
        `[MESSAGE-WORKER] Missing required field(s) in job=${job.id} — ` +
          `property_id=${propertyId} ` +
          `message_thread_id=${threadId} ` +
          `message_id=MISSING. ` +
          `Job discarded — will NOT be retried.`,
      );
      return;
    }

    if (!isInquiryEvent && !isMessageEvent) {
      this.logger.warn(
        `[MESSAGE-WORKER] Unsupported event=${event ?? 'undefined'} in job=${job.id}. ` +
          `Job discarded — will NOT be retried.`,
      );
      return;
    }

    // ── Step 2: Resolve tenant context ────────────────────────────────────
    const integration = await this.propertyService.resolveIntegration(propertyId);

    if (!integration) {
      this.logger.error(
        `[MESSAGE-WORKER] No integration found for propertyId=${propertyId}. ` +
          `Job=${job.id} discarded — will NOT be retried.`,
      );
      return;
    }

    const { tenantId, firestoreDocId } = integration;

    this.logger.log(
      `[MESSAGE-WORKER] Resolved — tenantId=${tenantId} firestoreDocId=${firestoreDocId}`,
    );

    // ── Step 3: Build Firestore document refs ─────────────────────────────
    //
    // Path: channex_integrations/{integrationDocId}
    //         /properties/{propertyId}
    //           /threads/{threadId}
    //             /messages/{messageId}
    //
    // `propertyId` here is the ISOLATED Channex property UUID (1:1 model) —
    // the same ID present in the webhook payload. It was used as the document
    // ID when the sync pipeline wrote the `properties/` subcollection doc,
    // so thread and message writes land directly under the correct listing.
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
        `[MESSAGE-WORKER] ✓ Inquiry thread persisted — ` +
          `threadId=${threadId} tenantId=${tenantId}`,
      );
      return;
    }

    // Message events require a message document.
    const messageRef = threadRef
      .collection(MESSAGES_SUB_COLLECTION)
      .doc(messageId);     // message id (id || ota_message_id) is the idempotency key
                           // so duplicate webhook deliveries resolve to the same doc path

    // ── Step 4: Batched write ─────────────────────────────────────────────
    // Both writes are committed atomically. If either fails, the batch is
    // rolled back and BullMQ will retry the whole job (up to 3 attempts).
    //
    // Thread upsert (merge: true):
    //   Always overwrites lastMessage / updatedAt so the thread list stays
    //   current. guestName is written on every upsert — Airbnb may enrich the
    //   name after the first message; the latest value wins.
    //
    // Message insert (no merge):
    //   A plain set without merge means a second delivery of the same
    //   message id overwrites with identical data — effectively a no-op
    //   that avoids accumulating duplicate sub-documents.
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
      // Prefer the OTA-supplied timestamp; fall back to server time so the
      // message always has a sortable createdAt regardless of OTA clock drift.
      createdAt: timestamp
        ? admin.firestore.Timestamp.fromDate(new Date(timestamp))
        : serverNow,
      updatedAt: serverNow,
    });

    try {
      await batch.commit();
    } catch (err: unknown) {
      // Re-throw so BullMQ marks the job as failed and applies the retry policy.
      // The error is already logged by FirebaseService.set() for individual writes,
      // but a batch commit failure bypasses that wrapper — log it here explicitly.
      this.logger.error(
        `[MESSAGE-WORKER] Batch commit failed for job=${job.id} ` +
          `threadId=${threadId} messageId=${messageId}: ` +
          `${(err as Error).message ?? String(err)}`,
      );
      throw err;
    }

    this.logger.log(
      `[MESSAGE-WORKER] ✓ Persisted — ` +
        `threadId=${threadId} messageId=${messageId} ` +
        `sender=${sender} tenantId=${tenantId}`,
    );
  }
}

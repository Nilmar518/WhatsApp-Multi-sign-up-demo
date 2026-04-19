import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { FirebaseService } from '../firebase/firebase.service';
import type { FirestoreReservationDoc } from './transformers/booking-revision.transformer';

interface BookingNewBridgePayload {
  tenantId: string;
  reservation: FirestoreReservationDoc;
}

interface GuestContactDoc {
  first_name: string;
  last_name: string | null;
  check_in: string;
  check_out: string;
  channel: 'airbnb';
  channex_property_id: string;
  whatsapp_number: string | null;
  created_at: string;
  updated_at: string;
}

const GUESTS_COLLECTION = 'contacts';

@Injectable()
export class ChannexMessagingBridgeService {
  private readonly logger = new Logger(ChannexMessagingBridgeService.name);

  constructor(
    private readonly firebase: FirebaseService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @OnEvent('channex.booking_new')
  async handleNewReservation(payload: BookingNewBridgePayload): Promise<void> {
    const { tenantId, reservation } = payload;
    const reservationCode = reservation.reservation_id;

    const doc: GuestContactDoc = {
      first_name: reservation.guest_first_name ?? '',
      last_name: reservation.guest_last_name,
      check_in: reservation.check_in,
      check_out: reservation.check_out,
      channel: 'airbnb',
      channex_property_id: reservation.channex_property_id,
      whatsapp_number: null,
      created_at: reservation.created_at,
      updated_at: new Date().toISOString(),
    };

    const db = this.firebase.getFirestore();
    const contactRef = db.collection(GUESTS_COLLECTION).doc(tenantId).collection('guests').doc(reservationCode);

    await this.firebase.set(contactRef, doc, { merge: true });

    this.logger.log(
      `[BRIDGE] Guest contact upserted — tenantId=${tenantId} reservationCode=${reservationCode}`,
    );
  }

  async linkGuestPhone(
    tenantId: string,
    reservationCode: string,
    phone: string,
  ): Promise<void> {
    const db = this.firebase.getFirestore();
    const contactRef = db.collection(GUESTS_COLLECTION).doc(tenantId).collection('guests').doc(reservationCode);

    await this.firebase.update(contactRef, {
      whatsapp_number: phone,
      updated_at: new Date().toISOString(),
    });

    this.eventEmitter.emit('channex.guest_phone_linked', {
      reservationCode,
      phone,
    });

    this.logger.log(
      `[BRIDGE] Guest phone linked — tenantId=${tenantId} reservationCode=${reservationCode}`,
    );
  }
}
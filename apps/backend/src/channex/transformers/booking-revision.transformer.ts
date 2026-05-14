import type { ChannexWebhookFullPayload } from '../channex.types';

// ─── Output shape ─────────────────────────────────────────────────────────────

/**
 * Normalised reservation document written to:
 *   channex_integrations/{docId}/reservations/{reservation_id}
 *
 * `reservation_id` (= ota_reservation_code) is used as the Firestore document ID
 * to guarantee idempotency — duplicate webhook deliveries for the same booking
 * produce a merge write with identical content, not a second document.
 */
export interface FirestoreReservationDoc {
  // Identity
  reservation_id: string | null;   // ota_reservation_code — doc ID and idempotency key; null for manual bookings
  channex_booking_id: string | null; // Channex revision UUID (booking.id) — for support/audit trails
  pms_booking_id?: string;          // Firestore auto-ID — PMS internal identifier (set by worker, not transformer)
  propertyId?: string;              // explicit field (previously implicit in Firestore path)
  booking_status: string;          // 'new' | 'modified' | 'cancelled'
  channel: string;              // OTA key: 'airbnb' | 'booking_com' | … derived from ota_name
  channex_property_id: string;
  room_type_id: string | null;
  ota_listing_id?: string | null;

  // Dates
  check_in: string;                // ISO 8601 (YYYY-MM-DD)
  check_out: string;

  // Financial
  gross_amount: number;            // Raw `amount` from Channex
  currency: string;                // ISO 4217
  ota_fee: number;                 // ota_commission — Airbnb's cut
  net_payout: number;              // gross_amount - ota_fee
  additional_taxes: number;        // Sum of non-inclusive taxes

  // Payment model — varies by OTA:
  //   Airbnb:      payment_collect='ota',      payment_type='bank_transfer'
  //   Booking.com: payment_collect='property', payment_type='credit_card'
  payment_collect: string;
  payment_type: string;

  // Guest PII — OTA-gated:
  //   guest_first_name  always present
  //   guest_last_name   Airbnb may suppress until 48h before check-in
  guest_first_name: string | null;
  guest_last_name: string | null;

  // Messaging bridge (Phase 7) — filled manually by the admin via the UI
  whatsapp_number: null;

  // Timestamps
  created_at: string;              // ISO 8601 — first time Migo UIT processed this booking
  updated_at: string;              // ISO 8601 — last write (any event type)

  // Raw booking payload mirrors (for audit/debug and exact UI mapping)
  booking_unique_id?: string | null;
  booking_revision_id?: string | null;
  live_feed_event_id?: string | null;
  ota_code?: string | null;
  customer_name?: string | null;
  arrival_date?: string | null;
  departure_date?: string | null;
  count_of_nights?: number | null;
  count_of_rooms?: number | null;
  amount_raw?: string | number | null;

  // Sync fields (Phase 2 flat bookings structure)
  ari_synced?: boolean;             // true if availability was pushed to Channex successfully (manual bookings only)
  ari_task_id?: string | null;      // Channex task ID from the availability push (manual bookings only)
}

// ─── OTA name → channel key ───────────────────────────────────────────────────

/**
 * Normalises the `ota_name` string returned by Channex into a lowercase
 * channel key used consistently across the Firestore schema and frontend badges.
 *
 * Channex ota_name values observed in production:
 *   'Airbnb'     → 'airbnb'
 *   'BookingCom' → 'booking_com'
 *   'ABB'        → 'airbnb'   (OTA code variant)
 *   'BDC'        → 'booking_com'
 */
function resolveChannel(otaName: unknown): string {
  const raw = typeof otaName === 'string' ? otaName.toLowerCase().replace(/[\s-]/g, '_') : '';

  if (raw === 'airbnb' || raw === 'abb') return 'airbnb';
  if (raw === 'bookingcom' || raw === 'bdc' || raw === 'booking_com') return 'booking_com';
  if (raw === 'vrbo' || raw === 'homeaway') return 'vrbo';

  // Return the normalised raw string so unknown OTAs still display something meaningful.
  return raw || 'unknown';
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function splitCustomerName(fullName: string): { firstName: string | null; lastName: string | null } {
  const trimmed = fullName.trim();
  if (!trimmed) {
    return { firstName: null, lastName: null };
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: null };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

function addNights(dateIso: string, nights: number): string {
  const date = new Date(`${dateIso}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || nights <= 0) {
    return '';
  }

  date.setUTCDate(date.getUTCDate() + nights);
  return date.toISOString().slice(0, 10);
}

// ─── Transformer ──────────────────────────────────────────────────────────────

/**
 * BookingRevisionTransformer — translates a Channex webhook full payload into a
 * normalised Firestore reservation document.
 *
 * Design principles:
 *   - All field access is done defensively with optional chaining — Channex does
 *     not guarantee every field is populated for every event type or OTA.
 *   - Financial calculations use explicit arithmetic (not string parsing) since
 *     Channex delivers `amount` and `ota_commission` as numbers.
 *   - Guest PII extraction targets rooms[0].guests[0] (the lead guest). If
 *     Airbnb has not yet disclosed the surname (pre-48h), `guest_last_name` is null.
 *   - `payment_collect` and `payment_type` are hardcoded to Airbnb values since
 *     this integration exclusively targets ABB channel bookings.
 *
 * This function is pure — no I/O, no side effects, fully deterministic.
 * Safe to call multiple times on the same payload (idempotent output).
 */
export class BookingRevisionTransformer {
  static toFirestoreReservation(
    payload: ChannexWebhookFullPayload,
    tenantId: string,
  ): FirestoreReservationDoc {
    const booking =
      (payload.booking as Record<string, unknown> | undefined) ??
      (payload.payload as Record<string, unknown> | undefined);

    if (!booking) {
      throw new Error(
        `BookingRevisionTransformer: payload.booking is undefined for event=${payload.event} ` +
          `revision_id=${payload.revision_id}. Cannot transform.`,
      );
    }

    const now = new Date().toISOString();

    // ── Financial calculations ─────────────────────────────────────────────
    const grossAmount = toNumber(booking.amount, 0);
    const otaFee = toNumber(booking.ota_commission, 0);
    const netPayout = grossAmount - otaFee;

    // Sum only non-inclusive taxes — these must be added on top of `amount`
    // to arrive at the true total charge to the guest. Inclusive taxes are
    // already embedded in `amount` and must not be double-counted.
    const taxes = Array.isArray(booking.taxes)
      ? (booking.taxes as Array<{ is_inclusive?: boolean; total_price?: number }>)
      : [];

    const additionalTaxes = taxes.reduce((sum, tax) => {
      if (tax.is_inclusive) return sum;
      return sum + toNumber(tax.total_price, 0);
    }, 0);

    // ── Guest PII extraction ───────────────────────────────────────────────
    // Traverse: rooms[0] → guests[0] → { name, surname }
    // Each level is optional: rooms may be empty, guests may be empty, and
    // surname is explicitly nullable (Airbnb withholds it until 48h pre-checkin).
    const rooms = Array.isArray(booking.rooms)
      ? (booking.rooms as Array<Record<string, unknown>>)
      : [];
    const leadRoom = rooms[0] ?? null;
    const leadGuests = Array.isArray(leadRoom?.guests)
      ? (leadRoom?.guests as Array<Record<string, unknown>>)
      : [];
    const leadGuest = leadGuests[0] ?? null;
    const guestFirstName =
      typeof leadGuest?.name === 'string' ? leadGuest.name : null;
    const guestLastName =
      typeof leadGuest?.surname === 'string' ? leadGuest.surname : null;
    const roomTypeId =
      typeof leadRoom?.room_type_id === 'string' ? leadRoom.room_type_id : null;
    const customerName =
      typeof booking.customer_name === 'string' ? booking.customer_name : null;

    const customerNameParts = customerName
      ? splitCustomerName(customerName)
      : { firstName: null, lastName: null };

    const reservationId =
      (typeof booking.booking_unique_id === 'string' && booking.booking_unique_id) ||
      (typeof booking.ota_reservation_code === 'string' && booking.ota_reservation_code) ||
      (typeof booking.booking_id === 'string' && booking.booking_id) ||
      null;

    const bookingStatus =
      (typeof booking.status === 'string' && booking.status) || payload.event;

    const bookingRecordId =
      (typeof booking.booking_id === 'string' && booking.booking_id) ||
      (typeof booking.id === 'string' && booking.id) ||
      null;

    const checkIn =
      (typeof booking.arrival_date === 'string' && booking.arrival_date) ||
      (typeof booking.check_in === 'string' && booking.check_in) ||
      '';
    const countOfNights = toNumber(booking.count_of_nights, 0);
    const checkOut =
      (typeof booking.departure_date === 'string' && booking.departure_date) ||
      (typeof booking.check_out === 'string' && booking.check_out) ||
      (checkIn ? addNights(checkIn, countOfNights) : '') ||
      '';

    const currency =
      (typeof booking.currency === 'string' && booking.currency) || 'USD';

    // ── tenantId is provided by the caller (ChannexBookingWorker) and is not
    //    present in the Channex payload itself. It is used here only to satisfy
    //    the function signature for future use (e.g. Phase 7 guest contact doc).
    //    Suppress the unused-variable lint rule rather than removing the param.
    void tenantId;

    const otaName = booking.ota_name ?? booking.channel ?? booking.ota_code;
    const channel = resolveChannel(otaName);

    return {
      // Identity
      reservation_id: reservationId,
      channex_booking_id: bookingRecordId,
      booking_status: bookingStatus,
      channel,
      channex_property_id: payload.property_id,
      room_type_id: roomTypeId,

      // Dates
      check_in: checkIn,
      check_out: checkOut,

      // Financial
      gross_amount: grossAmount,
      currency,
      ota_fee: otaFee,
      net_payout: netPayout,
      additional_taxes: additionalTaxes,

      // Payment model — taken from the booking payload; varies by OTA
      payment_collect: (typeof booking.payment_collect === 'string' ? booking.payment_collect : 'ota') as 'ota' | 'property',
      payment_type: (typeof booking.payment_type === 'string' ? booking.payment_type : 'bank_transfer') as string,

      // Guest PII
      guest_first_name: guestFirstName ?? customerNameParts.firstName,
      guest_last_name: guestLastName ?? customerNameParts.lastName,

      // Phase 7 placeholder
      whatsapp_number: null,

      // Timestamps
      created_at: now,
      updated_at: now,

      // Raw booking payload mirrors
      booking_unique_id:
        typeof booking.booking_unique_id === 'string' ? booking.booking_unique_id : null,
      booking_revision_id:
        typeof booking.booking_revision_id === 'string'
          ? booking.booking_revision_id
          : payload.revision_id ?? null,
      live_feed_event_id:
        typeof booking.live_feed_event_id === 'string' ? booking.live_feed_event_id : null,
      ota_code: typeof booking.ota_code === 'string' ? booking.ota_code : null,
      customer_name: customerName,
      arrival_date:
        typeof booking.arrival_date === 'string' ? booking.arrival_date : null,
      departure_date:
        typeof booking.departure_date === 'string' ? booking.departure_date : null,
      count_of_nights: countOfNights || null,
      count_of_rooms: toNumber(booking.count_of_rooms, 0) || null,
      amount_raw:
        typeof booking.amount === 'string' || typeof booking.amount === 'number'
          ? booking.amount
          : null,
    };
  }
}

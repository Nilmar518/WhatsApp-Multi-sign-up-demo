import { Injectable, Logger } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import type { AvailabilityEntryDto, RestrictionEntryDto } from './channex.types';

const INTEGRATIONS_COLLECTION = 'channex_integrations';
const ACTIVITY_SUB_COLLECTION = 'activity';

export type ActivityVariant = 'ok' | 'danger' | 'notice' | 'caution';

/**
 * Un evento ya confirmado (webhook recibido, o push aceptado por Channex).
 * El mensaje se arma acá y no en el cliente: el backend es el único que tiene
 * los títulos de propiedad y habitación sin depender de qué pantalla esté abierta.
 */
export interface ActivityEvent {
  type: string;
  message: string;
  variant: ActivityVariant;
  propertyId?: string | null;
}

/** Sólo lo que necesitamos del doc de propiedad para nombrar las cosas. */
export interface PropertyNames {
  title: string;
  room_types: Array<{
    room_type_id: string;
    title: string;
    rate_plans?: Array<{ rate_plan_id: string }>;
  }>;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** '2026-06-06' → '6-jun-2026' */
function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${Number(day)}-${MONTHS[Number(month) - 1]}-${year}`;
}

function formatRange(from: string, to: string): string {
  return from === to ? formatDate(from) : `${formatDate(from)} → ${formatDate(to)}`;
}

@Injectable()
export class ChannexActivityService {
  private readonly logger = new Logger(ChannexActivityService.name);

  constructor(private readonly firebase: FirebaseService) {}

  /**
   * Escribe los eventos en channex_integrations/{tenantId}/activity.
   * El frontend escucha esa colección desde cualquier pantalla y sesión.
   *
   * ponytail: sin purga. Son docs chicos y el cliente sólo lee los últimos 30.
   * Si algún día molesta, borrar por createdAt con una cron.
   */
  async record(tenantId: string, events: ActivityEvent[]): Promise<void> {
    if (!tenantId || events.length === 0) return;

    const db = this.firebase.getFirestore();
    const col = db
      .collection(INTEGRATIONS_COLLECTION)
      .doc(tenantId)
      .collection(ACTIVITY_SUB_COLLECTION);
    const createdAt = Date.now();

    try {
      const batch = db.batch();
      for (const event of events) {
        batch.set(col.doc(), {
          ...event,
          propertyId: event.propertyId ?? null,
          createdAt,
        });
      }
      await batch.commit();
      this.logger.log(`[ACTIVITY] ✓ ${events.length} evento(s) — tenantId=${tenantId}`);
    } catch (err) {
      this.logger.error('[ACTIVITY] ✗ No se pudo registrar la actividad', err);
    }
  }

  // ─── Constructores de mensajes ─────────────────────────────────────────────

  buildAvailabilityEvents(
    propertyId: string,
    property: PropertyNames,
    entries: AvailabilityEntryDto[],
  ): ActivityEvent[] {
    const titleByRoomType = new Map(property.room_types.map((rt) => [rt.room_type_id, rt.title]));

    return entries.map((e) => ({
      type: 'availability',
      variant: 'notice' as const,
      propertyId,
      message: this.withProperty(
        `Se actualizó la disponibilidad de ${titleByRoomType.get(e.room_type_id) ?? 'una habitación'}: ` +
          `${e.availability} (${formatRange(e.date_from, e.date_to)})`,
        property.title,
      ),
    }));
  }

  buildRestrictionEvents(
    propertyId: string,
    property: PropertyNames,
    entries: RestrictionEntryDto[],
  ): ActivityEvent[] {
    const titleByRatePlan = new Map<string, string>();
    for (const rt of property.room_types) {
      for (const rp of rt.rate_plans ?? []) titleByRatePlan.set(rp.rate_plan_id, rt.title);
    }

    const events: ActivityEvent[] = [];
    for (const e of entries) {
      const room = titleByRatePlan.get(e.rate_plan_id) ?? 'una habitación';
      const when = formatRange(e.date_from, e.date_to);
      const push = (type: string, message: string, variant: ActivityVariant) =>
        events.push({ type, variant, propertyId, message: this.withProperty(message, property.title) });

      if (e.stop_sell === true) push('stop_sell', `Se bloquearon las ventas de ${room} (${when})`, 'caution');
      if (e.stop_sell === false) push('open_sell', `Se reabrieron las ventas de ${room} (${when})`, 'notice');
      if (e.rate !== undefined) push('rate', `Se editó la tarifa de ${room}: ${e.rate} (${when})`, 'notice');
      if (e.min_stay_arrival !== undefined)
        push('min_stay', `Estadía mínima de ${room}: ${e.min_stay_arrival} noche(s) (${when})`, 'notice');
      if (e.max_stay !== undefined)
        push('max_stay', `Estadía máxima de ${room}: ${e.max_stay} noche(s) (${when})`, 'notice');
      if (e.closed_to_arrival) push('cta', `Sin llegadas (CTA) en ${room} (${when})`, 'caution');
      if (e.closed_to_departure) push('ctd', `Sin salidas (CTD) en ${room} (${when})`, 'caution');
    }
    return events;
  }

  buildBookingEvent(
    event: string,
    propertyId: string,
    propertyTitle: string,
    booking: { guest: string; check_in: string; check_out: string },
  ): ActivityEvent | null {
    const when = formatRange(booking.check_in, booking.check_out);
    const guest = booking.guest || 'huésped sin nombre';

    switch (event) {
      case 'booking_new':
        return {
          type: event,
          variant: 'ok',
          propertyId,
          message: this.withProperty(`Nueva reserva de ${guest} para el ${when}`, propertyTitle),
        };
      case 'booking_cancellation':
        return {
          type: event,
          variant: 'danger',
          propertyId,
          message: this.withProperty(`Se canceló la reserva de ${guest} (${when})`, propertyTitle),
        };
      case 'booking_modification':
        return {
          type: event,
          variant: 'caution',
          propertyId,
          message: this.withProperty(`Se modificó la reserva de ${guest} (${when})`, propertyTitle),
        };
      default:
        return null;
    }
  }

  private withProperty(message: string, propertyTitle: string): string {
    return propertyTitle ? `${message} · ${propertyTitle}` : message;
  }
}

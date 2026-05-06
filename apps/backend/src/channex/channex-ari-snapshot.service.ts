import { Injectable, Logger } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import type {
  AvailabilityEntryDto,
  ChannexAvailabilityReadResponse,
  ChannexRestrictionsReadResponse,
  RestrictionEntryDto,
} from './channex.types';

// ─── Firestore document shape ─────────────────────────────────────────────────

export interface DayAvailability {
  availability: number;
  booked: number | null;
  roomTypeId: string;
}

export interface DayRestrictions {
  rate: string | null;
  minStayArrival: number | null;
  maxStay: number | null;
  stopSell: boolean;
  closedToArrival: boolean;
  closedToDeparture: boolean;
  ratePlanId: string;
}

/** Shape of a day slot inside a monthly snapshot document. */
export interface DaySnapshot {
  availability?: DayAvailability;
  restrictions?: DayRestrictions;
}

/**
 * Monthly snapshot document stored at:
 *   channex_integrations/{tenantId}/properties/{propertyId}/ari_snapshots/{YYYY-MM}
 *
 * Top-level keys are ISO dates (YYYY-MM-DD).
 */
export type MonthSnapshotDoc = Record<string, DaySnapshot>;

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class ChannexARISnapshotService {
  private readonly logger = new Logger(ChannexARISnapshotService.name);

  constructor(private readonly firebase: FirebaseService) {}

  // ─── Write helpers ────────────────────────────────────────────────────────

  /**
   * Merges availability entries into the relevant monthly Firestore documents.
   * Uses a transaction per month-bucket so concurrent writes don't overwrite data
   * for dates outside the current update window.
   * Fire-and-forget: caller does NOT await this.
   */
  async saveAvailabilitySnapshot(
    tenantId: string,
    propertyId: string,
    entries: ChannexAvailabilityReadResponse['data'],
  ): Promise<void> {
    const db = this.firebase.getFirestore();
    const byMonth = this.groupByMonth(entries.map((e) => e.attributes.date));

    for (const [month, dates] of Object.entries(byMonth)) {
      const docRef = db
        .collection('channex_integrations')
        .doc(tenantId)
        .collection('properties')
        .doc(propertyId)
        .collection('ari_snapshots')
        .doc(month);

      const patch: Record<string, DayAvailability> = {};
      for (const e of entries) {
        if (!dates.includes(e.attributes.date)) continue;
        patch[e.attributes.date] = {
          availability: e.attributes.availability,
          booked: e.attributes.booked ?? null,
          roomTypeId: e.attributes.room_type_id,
        } satisfies DayAvailability;
      }

      try {
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(docRef);
          const existing: MonthSnapshotDoc = snap.exists ? (snap.data() as MonthSnapshotDoc) : {};
          for (const [date, avail] of Object.entries(patch)) {
            existing[date] = { ...(existing[date] ?? {}), availability: avail };
          }
          tx.set(docRef, existing);
        });
        this.logger.log(
          `[ARI-SNAPSHOT] ✓ Availability saved — tenantId=${tenantId} propertyId=${propertyId} month=${month} dates=${dates.length}`,
        );
      } catch (err) {
        this.logger.error(
          `[ARI-SNAPSHOT] ✗ Availability save failed — month=${month}`,
          err,
        );
      }
    }
  }

  /**
   * Merges restriction entries into the relevant monthly Firestore documents.
   * Same transaction-per-month pattern as saveAvailabilitySnapshot.
   */
  async saveRestrictionsSnapshot(
    tenantId: string,
    propertyId: string,
    entries: ChannexRestrictionsReadResponse['data'],
  ): Promise<void> {
    const db = this.firebase.getFirestore();
    const byMonth = this.groupByMonth(entries.map((e) => e.attributes.date));

    for (const [month, dates] of Object.entries(byMonth)) {
      const docRef = db
        .collection('channex_integrations')
        .doc(tenantId)
        .collection('properties')
        .doc(propertyId)
        .collection('ari_snapshots')
        .doc(month);

      const patch: Record<string, DayRestrictions> = {};
      for (const e of entries) {
        if (!dates.includes(e.attributes.date)) continue;
        patch[e.attributes.date] = {
          rate: e.attributes.rate ?? null,
          minStayArrival: e.attributes.min_stay_arrival ?? null,
          maxStay: e.attributes.max_stay ?? null,
          stopSell: e.attributes.stop_sell,
          closedToArrival: e.attributes.closed_to_arrival,
          closedToDeparture: e.attributes.closed_to_departure,
          ratePlanId: e.attributes.rate_plan_id,
        } satisfies DayRestrictions;
      }

      try {
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(docRef);
          const existing: MonthSnapshotDoc = snap.exists ? (snap.data() as MonthSnapshotDoc) : {};
          for (const [date, restr] of Object.entries(patch)) {
            existing[date] = { ...(existing[date] ?? {}), restrictions: restr };
          }
          tx.set(docRef, existing);
        });
        this.logger.log(
          `[ARI-SNAPSHOT] ✓ Restrictions saved — tenantId=${tenantId} propertyId=${propertyId} month=${month} dates=${dates.length}`,
        );
      } catch (err) {
        this.logger.error(
          `[ARI-SNAPSHOT] ✗ Restrictions save failed — month=${month}`,
          err,
        );
      }
    }
  }

  // ─── Read helpers ─────────────────────────────────────────────────────────

  /** Returns a single month's snapshot document, or {} if it doesn't exist. */
  async getMonthSnapshot(
    tenantId: string,
    propertyId: string,
    month: string, // YYYY-MM
  ): Promise<MonthSnapshotDoc> {
    const db = this.firebase.getFirestore();
    const snap = await db
      .collection('channex_integrations')
      .doc(tenantId)
      .collection('properties')
      .doc(propertyId)
      .collection('ari_snapshots')
      .doc(month)
      .get();

    return snap.exists ? (snap.data() as MonthSnapshotDoc) : {};
  }

  // ─── Optimistic write from push DTOs ─────────────────────────────────────

  /**
   * Expands AvailabilityEntryDto[] (date ranges) into per-day Firestore entries
   * and saves them. Called fire-and-forget after each successful Channex push.
   */
  async saveFromAvailabilityEntries(
    tenantId: string,
    propertyId: string,
    entries: AvailabilityEntryDto[],
  ): Promise<void> {
    const expanded: ChannexAvailabilityReadResponse['data'] = [];
    for (const e of entries) {
      for (const date of this.expandRange(e.date_from, e.date_to)) {
        expanded.push({
          id: `${e.room_type_id}:${date}`,
          type: 'availability',
          attributes: {
            property_id: e.property_id,
            room_type_id: e.room_type_id,
            date,
            availability: e.availability,
            booked: null,
          },
        });
      }
    }
    await this.saveAvailabilitySnapshot(tenantId, propertyId, expanded);
  }

  /**
   * Expands RestrictionEntryDto[] (date ranges) into per-day Firestore entries
   * and saves them. Called fire-and-forget after each successful Channex push.
   */
  async saveFromRestrictionEntries(
    tenantId: string,
    propertyId: string,
    entries: RestrictionEntryDto[],
  ): Promise<void> {
    const expanded: ChannexRestrictionsReadResponse['data'] = [];
    for (const e of entries) {
      for (const date of this.expandRange(e.date_from, e.date_to)) {
        expanded.push({
          id: `${e.rate_plan_id}:${date}`,
          type: 'restriction',
          attributes: {
            property_id: e.property_id,
            rate_plan_id: e.rate_plan_id,
            date,
            rate: e.rate ?? null,
            min_stay_arrival: e.min_stay_arrival ?? null,
            max_stay: e.max_stay ?? null,
            stop_sell: e.stop_sell ?? false,
            closed_to_arrival: e.closed_to_arrival ?? false,
            closed_to_departure: e.closed_to_departure ?? false,
          },
        });
      }
    }
    await this.saveRestrictionsSnapshot(tenantId, propertyId, expanded);
  }

  // ─── Utility ──────────────────────────────────────────────────────────────

  /** Groups ISO date strings by their YYYY-MM prefix. */
  private groupByMonth(dates: string[]): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const d of dates) {
      const month = d.slice(0, 7); // YYYY-MM
      (result[month] ??= []).push(d);
    }
    return result;
  }

  /** Expands a YYYY-MM-DD range into an array of individual ISO date strings. */
  private expandRange(dateFrom: string, dateTo: string): string[] {
    const dates: string[] = [];
    const cur = new Date(dateFrom + 'T00:00:00Z');
    const end = new Date(dateTo + 'T00:00:00Z');
    while (cur <= end) {
      dates.push(cur.toISOString().split('T')[0]);
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return dates;
  }
}

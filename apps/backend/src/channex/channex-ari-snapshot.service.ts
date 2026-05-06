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

  // ─── Refresh from Channex response ────────────────────────────────────────

  /**
   * Saves availability data pulled from GET /api/v1/availability.
   * Response shape: data[roomTypeId][YYYY-MM-DD] = count (integer)
   */
  async saveAvailabilitySnapshot(
    tenantId: string,
    propertyId: string,
    data: ChannexAvailabilityReadResponse['data'],
  ): Promise<void> {
    // Flatten roomTypeId → date → count into date → DayAvailability
    const byDate: Record<string, DayAvailability> = {};
    for (const [roomTypeId, dates] of Object.entries(data)) {
      for (const [date, count] of Object.entries(dates)) {
        byDate[date] = { availability: count, roomTypeId };
      }
    }
    await this._persistAvailabilityByDate(tenantId, propertyId, byDate);
  }

  /**
   * Saves restrictions data pulled from GET /api/v1/restrictions.
   * Response shape: data[ratePlanId][YYYY-MM-DD] = ChannexRestrictionsDayData
   */
  async saveRestrictionsSnapshot(
    tenantId: string,
    propertyId: string,
    data: ChannexRestrictionsReadResponse['data'],
  ): Promise<void> {
    // Flatten ratePlanId → date → data into date → DayRestrictions
    const byDate: Record<string, DayRestrictions> = {};
    for (const [ratePlanId, dates] of Object.entries(data)) {
      for (const [date, d] of Object.entries(dates)) {
        byDate[date] = {
          rate: d.rate ?? null,
          minStayArrival: d.min_stay_arrival ?? null,
          maxStay: d.max_stay === 0 ? null : (d.max_stay ?? null),
          stopSell: d.stop_sell,
          closedToArrival: d.closed_to_arrival,
          closedToDeparture: d.closed_to_departure,
          ratePlanId,
        };
      }
    }
    await this._persistRestrictionsByDate(tenantId, propertyId, byDate);
  }

  // ─── Optimistic write from push DTOs ─────────────────────────────────────

  /**
   * Expands AvailabilityEntryDto[] date ranges into per-day entries and saves.
   * Called fire-and-forget after each successful Channex push.
   */
  async saveFromAvailabilityEntries(
    tenantId: string,
    propertyId: string,
    entries: AvailabilityEntryDto[],
  ): Promise<void> {
    const byDate: Record<string, DayAvailability> = {};
    for (const e of entries) {
      for (const date of this.expandRange(e.date_from, e.date_to)) {
        byDate[date] = { availability: e.availability, roomTypeId: e.room_type_id };
      }
    }
    await this._persistAvailabilityByDate(tenantId, propertyId, byDate);
  }

  /**
   * Expands RestrictionEntryDto[] date ranges into per-day entries and saves.
   * Called fire-and-forget after each successful Channex push.
   */
  async saveFromRestrictionEntries(
    tenantId: string,
    propertyId: string,
    entries: RestrictionEntryDto[],
  ): Promise<void> {
    const byDate: Record<string, DayRestrictions> = {};
    for (const e of entries) {
      for (const date of this.expandRange(e.date_from, e.date_to)) {
        byDate[date] = {
          rate: e.rate ?? null,
          minStayArrival: e.min_stay_arrival ?? null,
          maxStay: e.max_stay ?? null,
          stopSell: e.stop_sell ?? false,
          closedToArrival: e.closed_to_arrival ?? false,
          closedToDeparture: e.closed_to_departure ?? false,
          ratePlanId: e.rate_plan_id,
        };
      }
    }
    await this._persistRestrictionsByDate(tenantId, propertyId, byDate);
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

  // ─── Internal Firestore writers ───────────────────────────────────────────

  private async _persistAvailabilityByDate(
    tenantId: string,
    propertyId: string,
    byDate: Record<string, DayAvailability>,
  ): Promise<void> {
    const db = this.firebase.getFirestore();
    const byMonth = this.groupByMonth(Object.keys(byDate));

    for (const [month, dates] of Object.entries(byMonth)) {
      const docRef = db
        .collection('channex_integrations')
        .doc(tenantId)
        .collection('properties')
        .doc(propertyId)
        .collection('ari_snapshots')
        .doc(month);

      try {
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(docRef);
          const existing: MonthSnapshotDoc = snap.exists ? (snap.data() as MonthSnapshotDoc) : {};
          for (const date of dates) {
            existing[date] = { ...(existing[date] ?? {}), availability: byDate[date] };
          }
          tx.set(docRef, existing);
        });
        this.logger.log(
          `[ARI-SNAPSHOT] ✓ Availability saved — tenantId=${tenantId} propertyId=${propertyId} month=${month} dates=${dates.length}`,
        );
      } catch (err) {
        this.logger.error(`[ARI-SNAPSHOT] ✗ Availability save failed — month=${month}`, err);
      }
    }
  }

  private async _persistRestrictionsByDate(
    tenantId: string,
    propertyId: string,
    byDate: Record<string, DayRestrictions>,
  ): Promise<void> {
    const db = this.firebase.getFirestore();
    const byMonth = this.groupByMonth(Object.keys(byDate));

    for (const [month, dates] of Object.entries(byMonth)) {
      const docRef = db
        .collection('channex_integrations')
        .doc(tenantId)
        .collection('properties')
        .doc(propertyId)
        .collection('ari_snapshots')
        .doc(month);

      try {
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(docRef);
          const existing: MonthSnapshotDoc = snap.exists ? (snap.data() as MonthSnapshotDoc) : {};
          for (const date of dates) {
            existing[date] = { ...(existing[date] ?? {}), restrictions: byDate[date] };
          }
          tx.set(docRef, existing);
        });
        this.logger.log(
          `[ARI-SNAPSHOT] ✓ Restrictions saved — tenantId=${tenantId} propertyId=${propertyId} month=${month} dates=${dates.length}`,
        );
      } catch (err) {
        this.logger.error(`[ARI-SNAPSHOT] ✗ Restrictions save failed — month=${month}`, err);
      }
    }
  }

  // ─── Utility ──────────────────────────────────────────────────────────────

  private groupByMonth(dates: string[]): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const d of dates) {
      const month = d.slice(0, 7);
      (result[month] ??= []).push(d);
    }
    return result;
  }

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

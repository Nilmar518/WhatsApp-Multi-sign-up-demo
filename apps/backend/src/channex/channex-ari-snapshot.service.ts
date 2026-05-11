import { Injectable, Logger } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import type {
  AvailabilityEntryDto,
  ChannexAvailabilityReadResponse,
  ChannexRestrictionsReadResponse,
  RestrictionEntryDto,
} from './channex.types';

// ─── Firestore document shape ─────────────────────────────────────────────────

/** Per-room-type slot stored for a calendar day. */
export interface DayRoomTypeSnapshot {
  availability: number;
}

/** Per-rate-plan slot stored for a calendar day. */
export interface DayRatePlanSnapshot {
  rate: string | null;
  stopSell: boolean;
  closedToArrival: boolean;
  closedToDeparture: boolean;
  minStayArrival: number | null;
  maxStay: number | null;
}

/**
 * A single calendar day.
 * roomTypes  — keyed by Channex room_type_id
 * ratePlans  — keyed by Channex rate_plan_id
 *
 * Both maps are optional so partial writes (availability only, or restrictions
 * only) do not clobber the other side.
 */
export interface DaySnapshot {
  roomTypes?: Record<string, DayRoomTypeSnapshot>;
  ratePlans?: Record<string, DayRatePlanSnapshot>;
}

/**
 * Monthly snapshot document.
 * Path: channex_integrations/{tenantId}/properties/{propertyId}/ari_snapshots/{YYYY-MM}
 * Top-level keys are ISO dates (YYYY-MM-DD).
 */
export type MonthSnapshotDoc = Record<string, DaySnapshot>;

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class ChannexARISnapshotService {
  private readonly logger = new Logger(ChannexARISnapshotService.name);

  constructor(private readonly firebase: FirebaseService) {}

  // ─── Refresh from Channex GET response ────────────────────────────────────

  /**
   * Saves availability pulled from GET /api/v1/availability.
   * Input shape: data[roomTypeId][YYYY-MM-DD] = count
   */
  async saveAvailabilitySnapshot(
    tenantId: string,
    propertyId: string,
    data: ChannexAvailabilityReadResponse['data'],
  ): Promise<void> {
    const byDate: Record<string, Record<string, DayRoomTypeSnapshot>> = {};
    for (const [roomTypeId, dates] of Object.entries(data)) {
      for (const [date, count] of Object.entries(dates)) {
        (byDate[date] ??= {})[roomTypeId] = { availability: count };
      }
    }
    await this._persistRoomTypesByDate(tenantId, propertyId, byDate);
  }

  /**
   * Saves restrictions pulled from GET /api/v1/restrictions.
   * Input shape: data[ratePlanId][YYYY-MM-DD] = ChannexRestrictionsDayData
   */
  async saveRestrictionsSnapshot(
    tenantId: string,
    propertyId: string,
    data: ChannexRestrictionsReadResponse['data'],
  ): Promise<void> {
    const byDate: Record<string, Record<string, DayRatePlanSnapshot>> = {};
    for (const [ratePlanId, dates] of Object.entries(data)) {
      for (const [date, d] of Object.entries(dates)) {
        (byDate[date] ??= {})[ratePlanId] = {
          rate: d.rate || null,
          stopSell: d.stop_sell,
          closedToArrival: d.closed_to_arrival,
          closedToDeparture: d.closed_to_departure,
          minStayArrival: d.min_stay_arrival || null,
          maxStay: d.max_stay === 0 ? null : (d.max_stay || null),
        };
      }
    }
    await this._persistRatePlansByDate(tenantId, propertyId, byDate);
  }

  // ─── Optimistic write from push DTOs ─────────────────────────────────────

  /**
   * Expands AvailabilityEntryDto[] ranges into per-room-type per-day entries.
   * Called fire-and-forget after each successful Channex availability push.
   */
  async saveFromAvailabilityEntries(
    tenantId: string,
    propertyId: string,
    entries: AvailabilityEntryDto[],
  ): Promise<void> {
    const byDate: Record<string, Record<string, DayRoomTypeSnapshot>> = {};
    for (const e of entries) {
      for (const date of this.expandRange(e.date_from, e.date_to)) {
        (byDate[date] ??= {})[e.room_type_id] = { availability: e.availability };
      }
    }
    await this._persistRoomTypesByDate(tenantId, propertyId, byDate);
  }

  /**
   * Expands RestrictionEntryDto[] ranges into per-rate-plan per-day entries.
   * Called fire-and-forget after each successful Channex restrictions push.
   */
  async saveFromRestrictionEntries(
    tenantId: string,
    propertyId: string,
    entries: RestrictionEntryDto[],
  ): Promise<void> {
    const byDate: Record<string, Record<string, DayRatePlanSnapshot>> = {};
    for (const e of entries) {
      for (const date of this.expandRange(e.date_from, e.date_to)) {
        (byDate[date] ??= {})[e.rate_plan_id] = {
          rate: e.rate ?? null,
          stopSell: e.stop_sell ?? false,
          closedToArrival: e.closed_to_arrival ?? false,
          closedToDeparture: e.closed_to_departure ?? false,
          minStayArrival: e.min_stay_arrival ?? null,
          maxStay: e.max_stay ?? null,
        };
      }
    }
    await this._persistRatePlansByDate(tenantId, propertyId, byDate);
  }

  // ─── Read ─────────────────────────────────────────────────────────────────

  async getMonthSnapshot(
    tenantId: string,
    propertyId: string,
    month: string,
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

  /**
   * Merges roomType availability into monthly docs.
   * Only touches the `roomTypes` key of each day — never overwrites `ratePlans`.
   */
  private async _persistRoomTypesByDate(
    tenantId: string,
    propertyId: string,
    byDate: Record<string, Record<string, DayRoomTypeSnapshot>>,
  ): Promise<void> {
    await this._persist(tenantId, propertyId, byDate, 'roomTypes');
  }

  /**
   * Merges rate plan restrictions into monthly docs.
   * Only touches the `ratePlans` key of each day — never overwrites `roomTypes`.
   */
  private async _persistRatePlansByDate(
    tenantId: string,
    propertyId: string,
    byDate: Record<string, Record<string, DayRatePlanSnapshot>>,
  ): Promise<void> {
    await this._persist(tenantId, propertyId, byDate, 'ratePlans');
  }

  private async _persist<T>(
    tenantId: string,
    propertyId: string,
    byDate: Record<string, Record<string, T>>,
    key: 'roomTypes' | 'ratePlans',
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
          const existing: MonthSnapshotDoc = snap.exists
            ? (snap.data() as MonthSnapshotDoc)
            : {};
          for (const date of dates) {
            existing[date] = {
              ...(existing[date] ?? {}),
              [key]: {
                ...((existing[date]?.[key] as Record<string, T>) ?? {}),
                ...byDate[date],
              },
            };
          }
          tx.set(docRef, existing);
        });
        this.logger.log(
          `[ARI-SNAPSHOT] ✓ ${key} saved — tenantId=${tenantId} propertyId=${propertyId} month=${month} dates=${dates.length}`,
        );
      } catch (err) {
        this.logger.error(
          `[ARI-SNAPSHOT] ✗ ${key} save failed — month=${month}`,
          err,
        );
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

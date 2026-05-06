import { IsArray, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import type { AvailabilityEntryDto, RestrictionEntryDto } from '../channex.types';

/**
 * Body for POST /channex/properties/:propertyId/availability
 *
 * Single update:  send updates with one element.
 * Batch (cert):   send all updates together — dispatched in ONE Channex API call.
 */
export class AriAvailabilityBatchDto {
  @IsArray()
  updates: AvailabilityEntryDto[];
}

/**
 * Body for POST /channex/properties/:propertyId/restrictions
 *
 * Single update:  send updates with one element.
 * Batch (cert):   send all updates together — dispatched in ONE Channex API call.
 */
export class AriRestrictionsBatchDto {
  @IsArray()
  updates: RestrictionEntryDto[];
}

/**
 * Body for POST /channex/properties/:propertyId/full-sync
 *
 * Sends `days` days of ARI for all room types and rate plans of the property
 * in exactly 2 Channex API calls — satisfying certification Test #1.
 */
export class AriFullSyncDto {
  /** Units to set on all room types (e.g. 1 for single-unit vacation rentals). */
  @IsNumber()
  @Min(0)
  defaultAvailability: number;

  /** Base rate for all rate plans as decimal string, e.g. "100.00". */
  @IsString()
  defaultRate: string;

  /** Days forward from today. Defaults to 500 (certification requirement). */
  @IsOptional()
  @IsNumber()
  @Min(1)
  days?: number;
}

import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateRoomTypeDto {
  /**
   * Commercial name of the room type as it will appear in the Channex dashboard.
   * For vacation rentals (Airbnb model) this is typically the full listing name.
   */
  @IsString()
  @IsNotEmpty()
  title: string;

  /**
   * Default occupancy — the standard number of guests included in the base rate.
   * Must be >= 1. Airbnb uses this as the base occupancy for pricing.
   */
  @IsInt()
  @Min(1)
  defaultOccupancy: number;

  /**
   * Maximum number of adults the room can accommodate.
   * Attempting to reduce this value on an already-mapped room type requires
   * force=true on the Channex PUT/DELETE and must be done with caution.
   */
  @IsInt()
  @Min(1)
  occAdults: number;

  /** Maximum number of children. Defaults to 0 in Channex if omitted. */
  @IsInt()
  @Min(0)
  @IsOptional()
  occChildren?: number;

  /** Maximum number of infants. Defaults to 0 in Channex if omitted. */
  @IsInt()
  @Min(0)
  @IsOptional()
  occInfants?: number;
}

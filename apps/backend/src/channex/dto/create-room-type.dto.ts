import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateRoomTypeDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  /** Physical units of this room type. Channex caps availability pushes at this value (max_availability). */
  @IsInt()
  @Min(1)
  @IsOptional()
  countOfRooms?: number;

  /** Default occupancy — standard number of guests in the base rate. */
  @IsInt()
  @Min(1)
  defaultOccupancy: number;

  /** Maximum number of adults. */
  @IsInt()
  @Min(1)
  occAdults: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  occChildren?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  occInfants?: number;
}

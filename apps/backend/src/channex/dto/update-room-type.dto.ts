import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpdateRoomTypeDto {
  @IsOptional()
  @IsString()
  title?: string;

  /** Physical units — sets max_availability in Channex. */
  @IsOptional()
  @IsInt()
  @Min(1)
  countOfRooms?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  defaultOccupancy?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  occAdults?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  occChildren?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  occInfants?: number;
}

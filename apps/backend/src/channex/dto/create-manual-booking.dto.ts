import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateManualBookingDto {
  @IsString()
  tenantId: string;

  @IsString()
  roomTypeId: string;

  @IsOptional()
  @IsString()
  ratePlanId?: string | null;

  @IsDateString()
  checkIn: string;           // YYYY-MM-DD

  @IsDateString()
  checkOut: string;          // YYYY-MM-DD

  @IsIn(['walkin', 'maintenance', 'owner_stay', 'direct'])
  bookingType: 'walkin' | 'maintenance' | 'owner_stay' | 'direct';

  @IsOptional()
  @IsInt()
  @Min(1)
  countOfRooms?: number;     // how many units to book; defaults to 1

  @IsOptional()
  @IsString()
  guestName?: string;

  @IsOptional()
  @IsString()
  guestPhone?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  grossAmount?: number;      // unit price (per room); total = grossAmount × countOfRooms

  @IsOptional()
  @IsString()
  currency?: string;
}

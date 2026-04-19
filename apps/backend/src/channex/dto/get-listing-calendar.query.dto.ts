import { IsDateString } from 'class-validator';

export class GetListingCalendarQueryDto {
  @IsDateString()
  date_from!: string;

  @IsDateString()
  date_to!: string;
}

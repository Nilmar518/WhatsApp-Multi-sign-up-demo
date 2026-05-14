import { IsBoolean, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class MigoPropertyAriDto {
  @IsString()
  @IsNotEmpty()
  dateFrom: string;

  @IsString()
  @IsNotEmpty()
  dateTo: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  availability?: number;

  @IsString()
  @IsOptional()
  rate?: string;

  @IsBoolean()
  @IsOptional()
  stopSell?: boolean;

  @IsInt()
  @Min(1)
  @IsOptional()
  minStayArrival?: number;

  @IsBoolean()
  @IsOptional()
  closedToArrival?: boolean;

  @IsBoolean()
  @IsOptional()
  closedToDeparture?: boolean;
}

import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateRatePlanDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  currency?: string;

  /** Base rate en minor currency units (cents). 0 = sin rate inicial, se pushea luego via ARI. */
  @IsNumber()
  @Min(0)
  @IsOptional()
  rate?: number;

  /** Ocupación base para el rate plan. Default: 2. */
  @IsNumber()
  @Min(1)
  @IsOptional()
  occupancy?: number;
}

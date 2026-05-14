import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class CreateMigoPropertyDto {
  @IsString()
  @IsNotEmpty()
  tenantId: string;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsInt()
  @Min(1)
  total_units: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  alert_threshold?: number;
}

import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class UpdateMigoPropertyDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  title?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  total_units?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  alert_threshold?: number;
}

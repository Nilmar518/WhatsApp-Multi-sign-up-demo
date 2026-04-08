import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CatalogQueryDto {
  @IsString()
  @IsNotEmpty()
  businessId: string;

  @IsOptional()
  @IsString()
  catalogId?: string;
}

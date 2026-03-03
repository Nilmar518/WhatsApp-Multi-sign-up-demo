import { IsString, IsNotEmpty } from 'class-validator';

export class CatalogQueryDto {
  @IsString()
  @IsNotEmpty()
  businessId: string;
}

import { IsString, IsNotEmpty } from 'class-validator';

export class UpdateCatalogDto {
  @IsString()
  @IsNotEmpty()
  businessId: string;

  @IsString()
  @IsNotEmpty()
  name: string;
}

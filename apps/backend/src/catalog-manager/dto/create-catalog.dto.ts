import { IsString, IsNotEmpty } from 'class-validator';

export class CreateCatalogDto {
  @IsString()
  @IsNotEmpty()
  businessId: string;

  @IsString()
  @IsNotEmpty()
  name: string;
}

import { IsString, IsNotEmpty } from 'class-validator';

export class SelectCatalogStepDto {
  @IsString()
  @IsNotEmpty()
  catalogId: string;
}

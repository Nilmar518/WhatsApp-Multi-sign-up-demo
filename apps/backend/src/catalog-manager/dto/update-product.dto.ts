import { IsString, IsNotEmpty, IsInt, IsPositive, IsUrl, IsIn, IsOptional } from 'class-validator';

export class UpdateProductDto {
  /** Firestore integration ID used to retrieve the access token */
  @IsString()
  @IsNotEmpty()
  businessId: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  description?: string;

  @IsOptional()
  @IsIn(['in stock', 'out of stock', 'preorder', 'available for order', 'discontinued'])
  availability?: string;

  @IsOptional()
  @IsIn(['new', 'refurbished', 'used'])
  condition?: string;

  /** Price in minor currency units (e.g. 1000 = $10.00 USD) */
  @IsOptional()
  @IsInt()
  @IsPositive()
  price?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  currency?: string;

  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  @IsOptional()
  @IsUrl()
  url?: string;
}

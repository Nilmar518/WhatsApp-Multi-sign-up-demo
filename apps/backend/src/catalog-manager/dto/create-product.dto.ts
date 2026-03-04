import { IsString, IsNotEmpty, IsInt, IsPositive, IsUrl, IsIn } from 'class-validator';

export class CreateProductDto {
  /** Firestore integration ID used to retrieve the access token */
  @IsString()
  @IsNotEmpty()
  businessId: string;

  /** Unique product identifier (SKU) within the catalog */
  @IsString()
  @IsNotEmpty()
  retailerId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsIn(['in stock', 'out of stock', 'preorder', 'available for order', 'discontinued'])
  availability: string;

  @IsIn(['new', 'refurbished', 'used'])
  condition: string;

  /** Price in minor currency units (e.g. 1000 = $10.00 USD) */
  @IsInt()
  @IsPositive()
  price: number;

  /** ISO 4217 currency code (e.g. USD, EUR, MXN) */
  @IsString()
  @IsNotEmpty()
  currency: string;

  @IsUrl()
  imageUrl: string;

  @IsUrl()
  url: string;
}

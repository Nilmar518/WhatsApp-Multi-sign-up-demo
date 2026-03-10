import {
  IsString,
  IsNotEmpty,
  IsInt,
  IsPositive,
  IsUrl,
  IsIn,
} from 'class-validator';

export class CreateVariantDto {
  /** Firestore integration ID */
  @IsString()
  @IsNotEmpty()
  businessId: string;

  /**
   * Parent product's retailer_id — sent as `item_group_id` to Meta.
   * This is what groups all variants under a single product family.
   */
  @IsString()
  @IsNotEmpty()
  itemGroupId: string;

  /** Unique SKU for this specific variant (e.g. "SHIRT-RED-XL") */
  @IsString()
  @IsNotEmpty()
  retailerId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  /** Attribute key, e.g. "color", "size", "material" */
  @IsString()
  @IsNotEmpty()
  attributeKey: string;

  /** Attribute value, e.g. "Red", "XL", "Cotton" */
  @IsString()
  @IsNotEmpty()
  attributeValue: string;

  @IsIn(['in stock', 'out of stock', 'preorder', 'available for order', 'discontinued'])
  availability: string;

  @IsIn(['new', 'refurbished', 'used'])
  condition: string;

  /** Price in minor currency units (e.g. 1000 = $10.00 USD) */
  @IsInt()
  @IsPositive()
  price: number;

  @IsString()
  @IsNotEmpty()
  currency: string;

  @IsUrl()
  imageUrl: string;

  @IsUrl()
  url: string;
}

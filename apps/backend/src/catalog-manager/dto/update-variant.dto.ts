import {
  IsString,
  IsNotEmpty,
  IsInt,
  IsPositive,
  IsUrl,
  IsIn,
  IsOptional,
} from 'class-validator';

export class UpdateVariantDto {
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
  @IsString()
  @IsNotEmpty()
  attributeKey?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  attributeValue?: string;

  @IsOptional()
  @IsIn(['in stock', 'out of stock', 'preorder', 'available for order', 'discontinued'])
  availability?: string;

  @IsOptional()
  @IsIn(['new', 'refurbished', 'used'])
  condition?: string;

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

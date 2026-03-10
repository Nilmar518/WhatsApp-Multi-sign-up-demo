import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsArray,
  ArrayNotEmpty,
  IsBoolean,
  IsOptional,
} from 'class-validator';
import { MatchType } from '../auto-reply.types';

export class UpdateAutoReplyDto {
  @IsString()
  @IsNotEmpty()
  businessId: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  triggerWord?: string;

  @IsOptional()
  @IsEnum(MatchType)
  matchType?: MatchType;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  collectionTitle?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  retailerIds?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

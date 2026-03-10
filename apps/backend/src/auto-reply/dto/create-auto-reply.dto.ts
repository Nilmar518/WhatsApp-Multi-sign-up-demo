import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsArray,
  ArrayNotEmpty,
  IsBoolean,
} from 'class-validator';
import { MatchType } from '../auto-reply.types';

export class CreateAutoReplyDto {
  @IsString()
  @IsNotEmpty()
  businessId: string;

  @IsString()
  @IsNotEmpty()
  triggerWord: string;

  @IsEnum(MatchType)
  matchType: MatchType;

  @IsString()
  @IsNotEmpty()
  collectionTitle: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  retailerIds: string[];

  @IsBoolean()
  isActive: boolean;
}

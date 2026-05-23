import { IsString, IsNotEmpty, IsBoolean, IsArray, IsIn, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'checkbox-group', 'checkbox-amount', 'auto-number', 'section-header', 'signature', 'bullet-list'] as const;
const AUTO_FILL_SOURCES = ['reservation.guestName', 'reservation.roomTypeId', 'reservation.checkIn', 'reservation.checkOut', 'reservation.nights', 'reservation.channel'] as const;

class TemplateFieldDto {
  @IsString() @IsNotEmpty() id: string;
  @IsIn([...FIELD_TYPES]) type: string;
  @IsString() @IsNotEmpty() label: string;
  @IsBoolean() required: boolean;
  @IsOptional() @IsArray() options?: string[];
  @IsOptional() @IsString() suffix?: string;
  @IsOptional() @IsIn([...AUTO_FILL_SOURCES]) autoFillFrom?: string;
}

class TemplateRowDto {
  @IsString() @IsNotEmpty() id: string;
  @IsIn([1, 2, 3]) columns: 1 | 2 | 3;
  @IsArray() @ValidateNested({ each: true }) @Type(() => TemplateFieldDto) fields: TemplateFieldDto[];
}

export class CreateTemplateDto {
  @IsString() @IsNotEmpty() businessId: string;
  @IsString() @IsNotEmpty() name: string;
  @IsIn(['check-in', 'custom']) type: 'check-in' | 'custom';
  @IsOptional() showOn: string[] | 'always';
  @IsBoolean() isUnique: boolean;
  @IsArray() @ValidateNested({ each: true }) @Type(() => TemplateRowDto) rows: TemplateRowDto[];
}

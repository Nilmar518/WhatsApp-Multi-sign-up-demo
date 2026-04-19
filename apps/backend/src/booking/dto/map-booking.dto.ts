import { IsArray, IsNotEmpty, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class MappingEntryDto {
  @IsString()
  @IsNotEmpty()
  migoRoomId: string;

  @IsString()
  @IsNotEmpty()
  otaRoomId: string;

  @IsString()
  @IsNotEmpty()
  otaRateId: string;
}

export class MapBookingDto {
  @IsString()
  @IsNotEmpty()
  tenantId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MappingEntryDto)
  mappings: MappingEntryDto[];
}

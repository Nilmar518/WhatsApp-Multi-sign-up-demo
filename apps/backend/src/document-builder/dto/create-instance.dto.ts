import { IsString, IsNotEmpty, IsOptional, IsObject, IsIn } from 'class-validator';

export class CreateInstanceDto {
  @IsString() @IsNotEmpty() businessId: string;
  @IsOptional() templateId?: string | null;
  @IsOptional() @IsString() reservationId?: string;
  @IsOptional() @IsObject() values?: Record<string, unknown>;
  @IsString() @IsNotEmpty() createdBy: string;
  @IsOptional() @IsIn(['draft', 'completed']) status?: 'draft' | 'completed';
}

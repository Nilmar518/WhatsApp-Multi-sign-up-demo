import { IsOptional, IsObject, IsIn } from 'class-validator';

export class UpdateInstanceDto {
  @IsOptional() @IsObject() values?: Record<string, unknown>;
  @IsOptional() @IsIn(['draft', 'completed']) status?: 'draft' | 'completed';
}

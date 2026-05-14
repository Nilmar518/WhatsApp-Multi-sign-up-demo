import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AssignConnectionDto {
  @IsString()
  @IsNotEmpty()
  channexPropertyId: string;

  @IsString()
  @IsNotEmpty()
  platform: string;

  @IsString()
  @IsNotEmpty()
  listingTitle: string;

  @IsBoolean()
  @IsOptional()
  isSyncEnabled?: boolean;
}

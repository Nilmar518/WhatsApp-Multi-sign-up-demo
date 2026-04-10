import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SetupInstagramDto {
  @IsString()
  @IsNotEmpty()
  shortLivedToken: string;

  @IsString()
  @IsNotEmpty()
  businessId: string;

  /** Optional — when provided, selects this specific Facebook Page during setup. */
  @IsString()
  @IsOptional()
  pageId?: string;
}

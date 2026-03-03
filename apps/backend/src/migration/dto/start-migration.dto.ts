import { IsString, IsNotEmpty } from 'class-validator';

export class StartMigrationDto {
  @IsString()
  @IsNotEmpty()
  businessId: string;

  /**
   * Full phone number in E.164 format.
   * Accepted formats: "+591 67025559" | "+59167025559" | "59167025559"
   * The backend parses the country code and number automatically.
   */
  @IsString()
  @IsNotEmpty()
  phoneE164: string;
}

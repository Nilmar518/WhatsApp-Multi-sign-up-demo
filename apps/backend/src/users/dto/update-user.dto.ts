import {
  IsEnum,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { CountryCode } from '../enums/country.enum';
import { UserRole } from '../enums/user-role.enum';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6,15}$/, { message: 'phone must be 6–15 digits, no country code' })
  phone?: string;

  @IsOptional()
  @IsEnum(CountryCode)
  country?: CountryCode;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}

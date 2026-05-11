import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsString,
  Matches,
} from 'class-validator';
import { CountryCode } from '../enums/country.enum';
import { UserRole } from '../enums/user-role.enum';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  uid: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @Matches(/^\d{6,15}$/, { message: 'phone must be 6–15 digits, no country code' })
  phone: string;

  @IsEnum(CountryCode)
  country: CountryCode;

  @IsEnum(UserRole)
  role: UserRole;
}

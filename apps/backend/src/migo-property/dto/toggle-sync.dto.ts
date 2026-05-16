import { IsBoolean } from 'class-validator';

export class ToggleSyncDto {
  @IsBoolean()
  isSyncEnabled: boolean;
}

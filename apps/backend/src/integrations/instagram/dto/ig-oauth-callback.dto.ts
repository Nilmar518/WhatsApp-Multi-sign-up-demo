import { IsNotEmpty, IsString } from 'class-validator';

export class IgOAuthCallbackDto {
  /** Authorization code issued by Instagram */
  @IsString()
  @IsNotEmpty()
  code: string;

  /**
   * Opaque state value — carries the businessId through the OAuth round-trip
   * so the callback knows which business to link the IG account to.
   */
  @IsString()
  @IsNotEmpty()
  state: string;
}

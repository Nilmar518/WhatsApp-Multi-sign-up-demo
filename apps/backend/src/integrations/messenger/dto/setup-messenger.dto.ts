import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SetupMessengerDto {
  /** Short-lived Facebook user access token from the client's Facebook Login flow. */
  @IsString()
  @IsNotEmpty()
  shortLivedToken: string;

  /** Tenant identifier — stored in connectedBusinessIds[] on the integration document. */
  @IsString()
  @IsNotEmpty()
  businessId: string;

  /**
   * Optional Page ID to select.
   * When omitted the service defaults to the first Page returned by /me/accounts.
   */
  @IsString()
  @IsOptional()
  pageId?: string;
}

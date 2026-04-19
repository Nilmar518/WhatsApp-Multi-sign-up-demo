import {
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateChannexPropertyDto {
  /**
   * Migo UIT tenant identifier — stored as `tenant_id` in the Firestore
   * `channex_integrations` document. Used to enforce multi-tenant isolation
   * in Firestore Security Rules and to route inbound webhooks to the correct
   * client partition.
   */
  @IsString()
  @IsNotEmpty()
  tenantId: string;

  /**
   * Internal reference to the property entity in Migo's own data model.
   * Stored as `migo_property_id` to link the Channex integration back to
   * the first-party property record (address, owner, amenities, etc.).
   */
  @IsString()
  @IsNotEmpty()
  migoPropertyId: string;

  /**
   * Commercial name of the property — must match the name displayed in
   * Migo UIT for visual congruence. Sent verbatim as `title` to Channex.
   */
  @IsString()
  @IsNotEmpty()
  title: string;

  /**
   * ISO 4217 three-letter currency code (e.g. 'USD', 'PEN', 'EUR').
   * Defines the base currency for all ARI rates and financial reporting
   * within this property's Channex context.
   */
  @IsString()
  @IsNotEmpty()
  currency: string;

  /**
   * IANA timezone string (e.g. 'America/Lima', 'Europe/Madrid').
   * Critical for correct check-in/check-out boundary calculation and
   * Airbnb cancellation window enforcement.
   */
  @IsString()
  @IsNotEmpty()
  timezone: string;

  /**
   * Channex property classification. Affects billing tier in Channex.
   * Use 'apartment' for vacation rentals (Airbnb model) and 'hotel'
   * for traditional accommodation. Defaults to 'apartment'.
   */
  @IsString()
  @IsOptional()
  propertyType?: string;

  /**
   * UUID of an existing Channex Group to associate this property with.
   * Groups allow multi-property tenants to have their properties clustered
   * for aggregate metrics and simplified webhook management.
   * Can be created in the Channex dashboard or via the Groups API.
   */
  @IsString()
  @IsOptional()
  groupId?: string;
}

import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { MetaIntegrationService } from './meta-integration.service';
import { ExchangeTokenStepDto } from './dto/exchange-token-step.dto';
import { RegisterPhoneStepDto } from './dto/register-phone-step.dto';
import { VerifyPhoneStatusDto } from './dto/verify-phone-status.dto';
import { SelectCatalogStepDto } from './dto/select-catalog-step.dto';
import { SubscribeWebhooksStepDto } from './dto/subscribe-webhooks-step.dto';

/**
 * MetaIntegrationController — per-step WhatsApp onboarding endpoints.
 *
 * These endpoints implement the granular 5-step setup state machine:
 *
 *   Step 1  POST /integrations/meta/exchange-token
 *   Step 2  POST /integrations/meta/whatsapp/register
 *   Step 3  POST /integrations/meta/whatsapp/status
 *   Step 4a GET  /integrations/meta/catalogs?integrationId=X&businessId=X
 *   Step 4b POST /integrations/meta/:integrationId/catalogs
 *   Step 5  POST /integrations/meta/whatsapp/subscribe-webhooks
 *
 * The existing POST /auth/exchange-token remains as a backward-compatible
 * sequential facade that calls all steps in order and ends with status=ACTIVE.
 *
 * Authentication: currently unguarded (fine for demo).
 * Phase 3+ will add role-based guards aligned with the production architecture.
 */
@Controller('integrations/meta')
export class MetaIntegrationController {
  constructor(private readonly metaService: MetaIntegrationService) {}

  /**
   * POST /integrations/meta/exchange-token
   *
   * Step 1 — Exchanges the single-use Facebook OAuth code for a 60-day
   * long-lived token. Stores the token in SecretManagerService and writes
   * `setupStatus=TOKEN_EXCHANGED` to Firestore.
   *
   * Returns `{ integrationId, setupStatus }`. The caller MUST proceed to
   * POST /whatsapp/register with the returned integrationId.
   */
  @Post('exchange-token')
  @HttpCode(HttpStatus.OK)
  exchangeToken(@Body() dto: ExchangeTokenStepDto) {
    return this.metaService.exchangeToken(dto);
  }

  /**
   * POST /integrations/meta/whatsapp/register
   *
   * Step 2 — Fetches the WABA phone list, enforces the registration limit,
   * and activates the phone number on the WhatsApp Cloud API network.
   *
   * Reads `wabaId` and `phoneNumberId` from the integration document written
   * during step 1. Resolves `phoneNumberId` from the WABA list if not stored.
   *
   * Returns `{ setupStatus: 'PHONE_REGISTERED', phoneNumberId }`.
   */
  @Post('whatsapp/register')
  @HttpCode(HttpStatus.OK)
  registerPhone(@Body() dto: RegisterPhoneStepDto) {
    return this.metaService.registerPhone(dto);
  }

  /**
   * POST /integrations/meta/whatsapp/status
   *
   * Step 3 — Verifies that the phone number's `code_verification_status` is
   * VERIFIED on the WhatsApp network. A confirmation step before catalog selection.
   *
   * Returns `{ setupStatus: 'STATUS_VERIFIED', codeVerificationStatus }`.
   */
  @Post('whatsapp/status')
  @HttpCode(HttpStatus.OK)
  verifyPhoneStatus(@Body() dto: VerifyPhoneStatusDto) {
    return this.metaService.verifyPhoneStatus(dto);
  }

  /**
   * GET /integrations/meta/catalogs?integrationId=X&businessId=X
   *
   * Step 4a — Lists Meta product catalogs available to the business.
   * Uses META_SYSTEM_USER_TOKEN when present (required for catalog_management scope).
   *
   * No status advancement — this is a read-only prerequisite before catalog selection.
   */
  @Get('catalogs')
  listCatalogs(
    @Query('integrationId') integrationId: string,
    @Query('businessId') businessId: string,
  ) {
    return this.metaService.listCatalogs(integrationId, businessId);
  }

  /**
   * POST /integrations/meta/:integrationId/catalogs
   *
   * Step 4b — Links the selected catalog to the integration and writes
   * `setupStatus=CATALOG_SELECTED` to Firestore.
   *
   * Returns `{ setupStatus: 'CATALOG_SELECTED', catalogId }`.
   */
  @Post(':integrationId/catalogs')
  @HttpCode(HttpStatus.OK)
  selectCatalog(
    @Param('integrationId') integrationId: string,
    @Body() dto: SelectCatalogStepDto,
  ) {
    return this.metaService.selectCatalog(integrationId, dto);
  }

  /**
   * POST /integrations/meta/whatsapp/subscribe-webhooks
   *
   * Step 5 — Subscribes the app to receive `messages` webhook events from the WABA.
   * Without this, inbound messages are silently dropped by Meta's routing layer.
   *
   * Returns `{ setupStatus: 'WEBHOOKS_SUBSCRIBED' }`.
   * After this step the integration is fully active — the facade additionally
   * writes `status=ACTIVE` for backward compatibility with existing frontend hooks.
   */
  @Post('whatsapp/subscribe-webhooks')
  @HttpCode(HttpStatus.OK)
  subscribeWebhooks(@Body() dto: SubscribeWebhooksStepDto) {
    return this.metaService.subscribeWebhooks(dto);
  }
}

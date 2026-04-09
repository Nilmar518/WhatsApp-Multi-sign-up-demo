import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
} from '@nestjs/common';
import {
  MessengerIntegrationService,
  SetupMessengerResult,
} from './messenger-integration.service';
import { SetupMessengerDto } from './dto/setup-messenger.dto';

/**
 * MessengerIntegrationController — Messenger-specific onboarding endpoint.
 *
 * Route prefix: integrations/messenger
 *
 * This controller owns the single-shot setup flow.  Generic lifecycle
 * operations (disconnect, health, reset) are handled by IntegrationsController
 * at /integrations/:integrationId/... and are provider-agnostic.
 */
@Controller('integrations/messenger')
export class MessengerIntegrationController {
  private readonly logger = new Logger(MessengerIntegrationController.name);

  constructor(
    private readonly messengerService: MessengerIntegrationService,
  ) {}

  /**
   * POST /integrations/messenger/setup
   *
   * One-shot Messenger Page onboarding:
   *   1. Exchanges short-lived Facebook user token for a long-lived token.
   *   2. Lists manageable Pages via /me/accounts.
   *   3. Selects the target Page (first page, or the one matching pageId).
   *   4. Stores the long-lived Page Access Token in SecretManager.
   *   5. Persists the integration document (provider=META_MESSENGER).
   *   6. Subscribes the app to Page webhook fields.
   *
   * Body:   { shortLivedToken, businessId, pageId? }
   * Returns: { integrationId, pageId, pageName, setupStatus: 'PAGE_SUBSCRIBED' }
   */
  @Post('setup')
  @HttpCode(HttpStatus.CREATED)
  async setup(@Body() dto: SetupMessengerDto): Promise<SetupMessengerResult> {
    const result = await this.messengerService.setupMessenger(dto);
    this.logger.log(
      `[MESSENGER_CTRL] ✓ POST /setup — integrationId=${result.integrationId} pageId=${result.pageId}`,
    );
    return result;
  }
}

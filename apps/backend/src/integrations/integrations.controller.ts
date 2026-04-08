import {
  Controller,
  Delete,
  Get,
  Post,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { IntegrationsService } from './integrations.service';

/**
 * IntegrationsController — thin, provider-agnostic lifecycle endpoints.
 *
 * All business logic is delegated to IntegrationsService which dispatches
 * to the appropriate IntegrationProviderContract implementation.
 * This controller knows nothing about Firestore, secrets, or Meta Graph API.
 *
 * Routes (Phase 4 additions):
 *   GET    /integrations?businessId=X              — list integrations for a tenant
 *   GET    /integrations/businesses                — list known business IDs (demo stub)
 *
 * Existing routes:
 *   POST   /integrations/:integrationId/disconnect  — graceful disconnect
 *   GET    /integrations/:integrationId/health      — provider health check
 *   DELETE /integrations/:integrationId             — hard reset (dev/demo only)
 *
 * IMPORTANT: static routes (/businesses) MUST be declared before parameterised
 * routes (/:integrationId) so NestJS does not swallow them as param values.
 */
@Controller('integrations')
export class IntegrationsController {
  private readonly logger = new Logger(IntegrationsController.name);

  constructor(private readonly integrationsService: IntegrationsService) {}

  // ─── Phase 4: Multi-tenancy query endpoints ────────────────────────────────

  /**
   * GET /integrations/businesses
   *
   * Returns the list of business IDs that should appear in the BusinessToggle.
   * In the demo this is a static stub of the two fixture IDs.
   * In production this would query a `businesses` Firestore collection or
   * a dedicated business-registry service.
   *
   * Declared BEFORE /:integrationId routes to avoid NestJS param shadowing.
   */
  @Get('businesses')
  listBusinessIds() {
    const ids = this.integrationsService.listBusinessIds();
    this.logger.log(
      `[INTEGRATIONS_CTRL] ✓ GET /businesses — returning ${ids.length} business ID(s)`,
    );
    return ids;
  }

  /**
   * GET /integrations?businessId=X
   *
   * Returns all integration documents where connectedBusinessIds array contains
   * the given businessId. Used by the frontend after the demo BusinessToggle
   * selects a business, to resolve the current integrationId for that tenant.
   *
   * Each item in the response array:
   *   { integrationId, provider, status, setupStatus }
   */
  @Get()
  async findByBusinessId(@Query('businessId') businessId: string) {
    const results = await this.integrationsService.findByBusinessId(businessId);
    this.logger.log(
      `[INTEGRATIONS_CTRL] ✓ GET /?businessId=${businessId} — ${results.length} result(s)`,
    );
    return results;
  }

  /**
   * POST /integrations/:integrationId/disconnect
   *
   * Gracefully disconnects the Meta/WhatsApp integration for the given ID.
   * Delegates to MetaProvider.disconnect() via IntegrationsService:
   *   1. Invalidates the stored token in SecretManagerService.
   *   2. Resets Firestore status to IDLE and clears credential fields.
   *
   * The frontend's onSnapshot listener fires automatically when status
   * becomes 'IDLE', returning the UI to the onboarding flow.
   * Conversation history (messages sub-collection) is preserved.
   */
  @Post(':integrationId/disconnect')
  @HttpCode(HttpStatus.OK)
  async disconnect(@Param('integrationId') integrationId: string) {
    await this.integrationsService.disconnect('META', integrationId);

    this.logger.log(
      `[INTEGRATIONS_CTRL] ✓ POST /${integrationId}/disconnect`,
    );
    return { disconnected: true, integrationId };
  }

  /**
   * GET /integrations/:integrationId/health
   *
   * Returns a lightweight health status for the integration.
   * Checks that a valid token exists in SecretManagerService and that
   * the Firestore document is in a connected state.
   *
   * Phase 6 extends this to call Meta's /debug_token endpoint for full
   * token-validity and scope verification.
   */
  @Get(':integrationId/health')
  async healthCheck(@Param('integrationId') integrationId: string) {
    const health = await this.integrationsService.healthCheck('META', integrationId);

    this.logger.log(
      `[INTEGRATIONS_CTRL] ✓ GET /${integrationId}/health — healthy=${health.healthy}`,
    );
    return health;
  }

  /**
   * DELETE /integrations/:integrationId
   *
   * Hard-wipes the Firestore integration document and invalidates any
   * stored token. Intended for development and demo resets only — this
   * bypasses the graceful disconnect lifecycle.
   */
  @Delete(':integrationId')
  @HttpCode(HttpStatus.OK)
  async reset(@Param('integrationId') integrationId: string) {
    await this.integrationsService.reset(integrationId);

    this.logger.log(
      `[INTEGRATIONS_CTRL] ✓ DELETE /${integrationId}`,
    );
    return { reset: true, integrationId };
  }
}

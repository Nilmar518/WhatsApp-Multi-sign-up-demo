import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  InstagramIntegrationService,
  SetupInstagramResult,
} from './instagram-integration.service';
import { SetupInstagramDto } from './dto/setup-instagram.dto';
import { IgOAuthCallbackDto } from './dto/ig-oauth-callback.dto';
import { ReplyToCommentDto } from './dto/reply-to-comment.dto';
import { SendInstagramMessageDto } from './dto/send-instagram-message.dto';

/**
 * InstagramIntegrationController
 *
 * Route prefix: /integrations/instagram
 *
 * Primary onboarding flow (Instagram API with Instagram Login):
 *   Browser → GET /integrations/instagram/oauth-callback?code=X&state=businessId
 *
 * Legacy / testing flow:
 *   POST /integrations/instagram/setup  (accepts a pre-obtained short-lived token)
 *
 * Messaging:
 *   POST /integrations/instagram/:integrationId/messages  (manual DM)
 *   POST /integrations/instagram/:integrationId/reply     (comment reply)
 *
 * IMPORTANT: literal routes (setup, oauth-callback) must be declared before
 * parameterised routes (:integrationId/...) to prevent NestJS from routing
 * them into the param handler.
 */
@Controller('integrations/instagram')
export class InstagramIntegrationController {
  private readonly logger = new Logger(InstagramIntegrationController.name);

  constructor(
    private readonly instagramService: InstagramIntegrationService,
  ) {}

  // ─── OAuth 2.0 Callback (primary onboarding path) ──────────────────────────

  /**
   * GET /integrations/instagram/oauth-callback?code=X&state={businessId}
   *
   * Instagram redirects here after the user completes the authorization screen.
   * The backend performs the full three-step token pipeline:
   *   1. code → short-lived token  (POST api.instagram.com/oauth/access_token)
   *   2. short-lived → long-lived  (GET  graph.instagram.com/access_token)
   *   3. long-lived  → /me ID      (GET  graph.instagram.com/v25.0/me)
   *
   * On success:  redirect → {FRONTEND_URL}/?ig_connected=1
   * On error:    redirect → {FRONTEND_URL}/?ig_error={message}
   *
   * The Firestore onSnapshot listener in the frontend (useIntegrationId) detects
   * the new META_INSTAGRAM document and swaps the connect screen for the dashboard.
   */
  @Get('oauth-callback')
  async oauthCallback(
    @Query() query: IgOAuthCallbackDto,
    @Res() res: Response,
  ): Promise<void> {
    const frontendUrl = process.env.FRONTEND_URL ?? 'https://localhost:5173';

    try {
      const result = await this.instagramService.handleOAuthCallback(
        query.code,
        query.state, // state carries the businessId
      );

      this.logger.log(
        `[INSTAGRAM_CTRL] ✓ GET /oauth-callback — integrationId=${result.integrationId} ` +
          `igAccountId=${result.igAccountId}`,
      );

      // Redirect back to the frontend; the Firestore listener handles the UI swap.
      res.redirect(`${frontendUrl}/?ig_connected=1`);
    } catch (err: any) {
      const message = (err?.message ?? 'Unknown error') as string;
      this.logger.error(
        `[INSTAGRAM_CTRL] ✗ GET /oauth-callback — ${message}`,
      );
      // Redirect with error so the frontend can surface a user-readable message.
      res.redirect(
        `${frontendUrl}/?ig_error=${encodeURIComponent(message.slice(0, 200))}`,
      );
    }
  }

  // ─── Legacy / testing setup ─────────────────────────────────────────────────

  /**
   * POST /integrations/instagram/setup
   *
   * @deprecated — Use GET /oauth-callback for production flows.
   * Accepts a short-lived Instagram token obtained outside this service.
   * Useful for local testing when the full OAuth redirect round-trip is
   * inconvenient.
   *
   * Body:    { shortLivedToken, businessId }
   * Returns: { integrationId, igAccountId, igUsername, setupStatus }
   */
  @Post('setup')
  @HttpCode(HttpStatus.CREATED)
  async setup(@Body() dto: SetupInstagramDto): Promise<SetupInstagramResult> {
    const result = await this.instagramService.setupInstagram(dto);
    this.logger.log(
      `[INSTAGRAM_CTRL] ✓ POST /setup — integrationId=${result.integrationId} ` +
        `igAccountId=${result.igAccountId}`,
    );
    return result;
  }

  // ─── Messaging ──────────────────────────────────────────────────────────────

  /**
   * POST /integrations/instagram/:integrationId/messages
   *
   * Sends a manual text DM to an Instagram user.
   * Enforces the 24-hour messaging window (403 if closed).
   * Persists the outbound message to Firestore so it surfaces in the chat UI.
   *
   * Body: { recipientId, text }
   */
  @Post(':integrationId/messages')
  @HttpCode(HttpStatus.CREATED)
  async sendMessage(
    @Param('integrationId') integrationId: string,
    @Body() dto: SendInstagramMessageDto,
  ): Promise<{ success: true; messageId: string }> {
    const result = await this.instagramService.sendInstagramMessage(integrationId, dto);
    this.logger.log(
      `[INSTAGRAM_CTRL] ✓ POST /${integrationId}/messages — to=${dto.recipientId} msgId=${result.messageId}`,
    );
    return result;
  }

  /**
   * POST /integrations/instagram/:integrationId/reply
   *
   * Sends a Public or Private reply to an Instagram comment.
   * PUBLIC  → replies publicly under the post
   * PRIVATE → sends a DM (Single Reply Rule + 7-day window enforced)
   *
   * Body: { type: 'PUBLIC' | 'PRIVATE', commentId, igsid, text }
   */
  @Post(':integrationId/reply')
  @HttpCode(HttpStatus.OK)
  async replyToComment(
    @Param('integrationId') integrationId: string,
    @Body() dto: ReplyToCommentDto,
  ): Promise<{ success: true }> {
    const result = await this.instagramService.replyToComment(integrationId, dto);
    this.logger.log(
      `[INSTAGRAM_CTRL] ✓ POST /${integrationId}/reply — type=${dto.type} commentId=${dto.commentId}`,
    );
    return result;
  }
}

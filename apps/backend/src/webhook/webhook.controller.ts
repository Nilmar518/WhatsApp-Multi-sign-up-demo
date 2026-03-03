import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Res,
  Logger,
  HttpCode,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { WebhookService } from './webhook.service';

@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly webhookService: WebhookService,
  ) {}

  // GET /webhook — Meta hub challenge verification (one-time setup)
  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const verifyToken = this.config.get<string>('META_WEBHOOK_VERIFY_TOKEN');
    const ngrokUrl = this.config.get<string>('NGROK_URL');

    this.logger.log(`[WEBHOOK_VERIFY] mode=${mode} | active_url=${ngrokUrl}`);

    if (mode === 'subscribe' && token === verifyToken) {
      this.logger.log('[WEBHOOK_VERIFY] ✓ Verification successful');
      res.status(200).send(challenge);
    } else {
      this.logger.warn('[WEBHOOK_VERIFY] ✗ Token mismatch — request rejected');
      res.status(403).send('Forbidden');
    }
  }

  // POST /webhook — Inbound messages and delivery status events from Meta
  @Post()
  @HttpCode(200) // Meta requires 200 within 20s or it will retry
  async receive(@Body() body: unknown) {
    // ── Raw payload dump — first line of defence when tracing inbound issues ──
    console.log('[WEBHOOK_INBOUND_PAYLOAD]:', JSON.stringify(body, null, 2));

    this.logger.log('[WEBHOOK_EVENT] Payload received');

    // processInbound never throws — defensive design ensures we always ack Meta
    await this.webhookService.processInbound(body);

    return { received: true };
  }
}

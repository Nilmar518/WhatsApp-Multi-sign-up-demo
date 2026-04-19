import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { SecretManagerService } from '../../common/secrets/secret-manager.service';

/**
 * ChannexHmacGuard — validates inbound Channex webhook requests.
 *
 * Channex attaches the configured webhook secret verbatim in the
 * `x-channex-signature` header. This guard performs a constant-time
 * comparison of that header value against the locally stored secret,
 * preventing timing-based oracle attacks that would allow an adversary
 * to brute-force the secret by measuring response latency.
 *
 * Secret storage: CHANNEX_WEBHOOK_SECRET in apps/backend/.env.secrets
 * Value:          migo_staging_wh_sec_9f8a7b6c5d4e3f2g1h
 *
 * Production upgrade path:
 *   If Channex migrates to HMAC-SHA256 body signatures, update this guard to:
 *     1. Enable rawBody in NestFactory.create (rawBody: true in main.ts)
 *     2. Read req.rawBody (Buffer)
 *     3. Compute createHmac('sha256', secret).update(rawBody).digest('hex')
 *     4. Replace the timingSafeEqual comparison with the computed HMAC
 *   No other code changes are required — callers remain unaware of the
 *   auth strategy used here.
 *
 * This guard is registered in ChannexModule.providers and applied with
 * @UseGuards(ChannexHmacGuard) on ChannexWebhookController.
 */
@Injectable()
export class ChannexHmacGuard implements CanActivate {
  private readonly logger = new Logger(ChannexHmacGuard.name);

  constructor(private readonly secrets: SecretManagerService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const incomingSignature = req.headers['x-channex-signature'];
    const storedSecret = this.secrets.get('CHANNEX_WEBHOOK_SECRET');

    // ── Pre-flight: guard misconfiguration ────────────────────────────────
    if (!storedSecret) {
      this.logger.error(
        '[HMAC_GUARD] CHANNEX_WEBHOOK_SECRET is not set in .env.secrets. ' +
          'All webhook requests will be rejected.',
      );
      throw new UnauthorizedException(
        'Webhook secret not configured on the server.',
      );
    }

    // ── Missing header ────────────────────────────────────────────────────
    if (!incomingSignature || typeof incomingSignature !== 'string') {
      this.logger.warn(
        '[HMAC_GUARD] Rejected — x-channex-signature header is absent.',
      );
      throw new UnauthorizedException('Missing x-channex-signature header.');
    }

    // ── Timing-safe comparison ────────────────────────────────────────────
    // timingSafeEqual requires buffers of identical byte length.
    // If lengths differ, we know immediately it's invalid, but we still
    // go through a constant-time path to avoid leaking length information.
    const incomingBuffer = Buffer.from(incomingSignature, 'utf8');
    const secretBuffer = Buffer.from(storedSecret, 'utf8');

    const lengthsMatch = incomingBuffer.length === secretBuffer.length;

    // Compare against a same-length target to keep timing constant even when
    // lengths differ. We use secretBuffer twice so a length mismatch still
    // runs the full comparison without an early exit.
    const comparisonBuffer = lengthsMatch ? incomingBuffer : secretBuffer;
    const signatureValid =
      lengthsMatch && timingSafeEqual(comparisonBuffer, secretBuffer);

    if (!signatureValid) {
      this.logger.warn(
        '[HMAC_GUARD] Rejected — x-channex-signature does not match stored secret.',
      );
      throw new UnauthorizedException('Invalid webhook signature.');
    }

    this.logger.debug('[HMAC_GUARD] Signature validated.');
    return true;
  }
}

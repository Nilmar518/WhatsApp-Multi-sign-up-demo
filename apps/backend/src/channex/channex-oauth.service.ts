import { Injectable, Logger } from '@nestjs/common';
import { ChannexService } from './channex.service';

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * ChannexOAuthService — orchestrates the IFrame-based Airbnb OAuth onboarding.
 *
 * Responsibilities:
 *   - Generate single-use session tokens for embedding the Channex IFrame.
 *   - Generate direct connection URLs for the CSP-blocked fallback ("Copy Link") flow.
 *
 * This service is a thin coordinator above ChannexService. The separation exists
 * so future phases can add session caching, per-tenant token rate tracking, or
 * audit logging here without polluting the I/O boundary (ChannexService).
 *
 * Token lifecycle:
 *   - One-time tokens expire in 15 minutes and are invalidated after first use.
 *   - They are never persisted — a fresh token must be requested for each IFrame render.
 *   - The frontend requests a token on mount; if the IFrame reports an error or the
 *     user closes and reopens the panel, a new token is fetched automatically.
 */
@Injectable()
export class ChannexOAuthService {
  private readonly logger = new Logger(ChannexOAuthService.name);

  constructor(private readonly channex: ChannexService) {}

  // ─── One-time token ───────────────────────────────────────────────────────

  /**
   * Generates a single-use session token scoped to a specific Channex property.
   *
   * The frontend embeds this token in the IFrame src URL:
   *   {CHANNEX_IFRAME_BASE_URL}/auth/exchange?oauth_session_key={TOKEN}
   *   &app_mode=headless&redirect_to=/channels&property_id={PROPERTY_ID}&channels=ABB
   *
   * `app_mode=headless` strips all Channex navigation chrome, making the embedded
   * UI appear as a native part of Migo UIT (white-label effect).
   * `channels=ABB` constrains the UI to show only the Airbnb connection option,
   * preventing accidental connection of unsupported OTAs.
   *
   * The token is returned directly to the frontend — never written to Firestore
   * or any persistent store.
   *
   * @param propertyId  The Channex property UUID obtained during Phase 2 provisioning
   */
  async generateOneTimeToken(propertyId: string): Promise<string> {
    this.logger.log(
      `[OAUTH] Generating one-time token — propertyId=${propertyId}`,
    );

    const token = await this.channex.getOneTimeToken(propertyId);

    this.logger.log(
      `[OAUTH] ✓ Token issued — propertyId=${propertyId}`,
    );

    return token;
  }

  // ─── Copy-link fallback ───────────────────────────────────────────────────

  /**
   * Generates a shareable direct connection URL for the CSP-blocked fallback flow.
   *
   * When a tenant's browser enforces a strict Content Security Policy that blocks
   * IFrames from staging.channex.io, the ChannexIFrame React component detects the
   * failure and requests this URL instead. The frontend then renders an
   * "Open in New Tab" button pointing to this URL, allowing the user to complete
   * the Airbnb OAuth flow in a separate tab without disrupting the Migo UIT session.
   *
   * The returned URL is a one-shot Channex connection link — not the raw IFrame URL.
   * It does not require the `oauth_session_key` token exchange step.
   *
   * @param propertyId  The Channex property UUID
   * @param channel     OTA channel code. Defaults to 'ABB' (Airbnb).
   *                    Pass 'BDC' for Booking.com when multi-channel support is added.
   */
  async generateCopyLink(
    propertyId: string,
    channel: string = 'ABB',
  ): Promise<string> {
    this.logger.log(
      `[OAUTH] Generating copy-link fallback — propertyId=${propertyId} channel=${channel}`,
    );

    const url = await this.channex.getChannelConnectionUrl(propertyId, channel);

    this.logger.log(
      `[OAUTH] ✓ Copy-link issued — propertyId=${propertyId} channel=${channel}`,
    );

    return url;
  }
}

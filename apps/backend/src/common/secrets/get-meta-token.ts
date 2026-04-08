import { HttpException, HttpStatus } from '@nestjs/common';
import { SecretManagerService } from './secret-manager.service';

export interface MetaTokenPayload {
  accessToken: string;
  tokenType: 'LONG_LIVED' | 'SYSTEM_USER';
  tokenExpiresAt: string | null;
}

/**
 * Retrieves the Meta access token for a given integration from SecretManagerService.
 *
 * Secret key convention: `META_TOKEN__{integrationId}`
 * Secret value format: JSON-serialised MetaTokenPayload
 *
 * Throws HTTP 401 UNAUTHORIZED if the secret is absent or malformed —
 * the caller should surface this as a "re-authenticate" prompt.
 *
 * Usage (inject SecretManagerService, then call at the point of need):
 *
 *   import { getMetaToken } from '../common/secrets/get-meta-token';
 *   const accessToken = getMetaToken(this.secrets, businessId);
 */
export function getMetaToken(
  secrets: SecretManagerService,
  integrationId: string,
): string {
  const raw = secrets.get(`META_TOKEN__${integrationId}`);

  if (!raw) {
    throw new HttpException(
      `No Meta access token found for integrationId=${integrationId}. ` +
        'Re-run the WhatsApp Embedded Signup flow to re-authenticate.',
      HttpStatus.UNAUTHORIZED,
    );
  }

  try {
    const parsed = JSON.parse(raw) as MetaTokenPayload;
    if (!parsed.accessToken) {
      throw new Error('accessToken field missing in parsed payload');
    }
    return parsed.accessToken;
  } catch {
    throw new HttpException(
      `Malformed Meta token secret for integrationId=${integrationId}. ` +
        'Re-authenticate to restore a valid token.',
      HttpStatus.UNAUTHORIZED,
    );
  }
}

/**
 * Builds and serialises a MetaTokenPayload for storage via SecretManagerService.set().
 *
 * Usage:
 *   secrets.set(`META_TOKEN__${integrationId}`, buildMetaTokenSecret(accessToken, 'LONG_LIVED'));
 */
export function buildMetaTokenSecret(
  accessToken: string,
  tokenType: MetaTokenPayload['tokenType'],
): string {
  const payload: MetaTokenPayload = {
    accessToken,
    tokenType,
    tokenExpiresAt:
      tokenType === 'LONG_LIVED'
        ? new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString()
        : null,
  };
  return JSON.stringify(payload);
}

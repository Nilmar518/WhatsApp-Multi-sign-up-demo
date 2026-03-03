import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

/**
 * SecretManagerService — GCP Secret Manager Emulator
 *
 * Priority chain:
 *   1. `.env.secrets` file (highest — mirrors Secret Manager in production)
 *   2. `process.env` fallback (standard .env loaded by ConfigModule)
 *
 * Every secret access is logged for audit observability, mirroring the
 * behaviour expected from the @google-cloud/secret-manager client.
 *
 * PRODUCTION SWAP: Replace this service with one that calls
 *   secretManagerClient.accessSecretVersion({ name: `projects/.../secrets/${name}/versions/latest` })
 * No other code changes are required — all callers use the same .get() API.
 */
@Injectable()
export class SecretManagerService implements OnModuleInit {
  private readonly logger = new Logger('GCP-SECRET-EMULATOR');
  private readonly secrets: Record<string, string> = {};

  onModuleInit() {
    const secretsPath = path.resolve(process.cwd(), '.env.secrets');

    if (fs.existsSync(secretsPath)) {
      const parsed = dotenv.parse(fs.readFileSync(secretsPath));
      Object.assign(this.secrets, parsed);
      this.logger.log(
        `[GCP-SECRET-EMULATOR] Loaded ${Object.keys(parsed).length} secret(s) from .env.secrets`,
      );
    } else {
      this.logger.warn(
        '[GCP-SECRET-EMULATOR] .env.secrets not found — all secrets fall back to process.env',
      );
    }
  }

  /**
   * Retrieves a secret value by name.
   * Logs every access — in production this call goes to GCP Secret Manager.
   */
  get(secretName: string): string | undefined {
    this.logger.log(`[GCP-SECRET-EMULATOR] Accessing secret: ${secretName}`);
    return this.secrets[secretName] ?? process.env[secretName];
  }
}

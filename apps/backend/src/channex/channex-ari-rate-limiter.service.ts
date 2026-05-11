import { Injectable, Logger } from '@nestjs/common';

type EndpointType = 'availability' | 'restrictions';

interface Window {
  count: number;
  windowStart: number;
}

/**
 * ChannexARIRateLimiter — in-memory sliding window rate limiter for ARI pushes.
 *
 * Channex limits: 10 POST /availability + 10 POST /restrictions per minute per property.
 * This service tracks call counts per (propertyId, type) pair and delays execution
 * when the limit is reached, resuming once the 60-second window resets.
 *
 * Counts HTTP calls, not individual items in values[] — sending 10 items in one
 * call counts as 1 against the limit, which is correct per Channex's policy.
 *
 * In-memory: suitable for single-instance deployment. If the service scales
 * horizontally, replace with a Redis-backed counter.
 */
@Injectable()
export class ChannexARIRateLimiter {
  private readonly logger = new Logger(ChannexARIRateLimiter.name);
  private readonly windows = new Map<string, Window>();
  private readonly LIMIT = 10;
  private readonly WINDOW_MS = 60_000;

  /**
   * Acquires a rate limit slot for a given property + endpoint type.
   * If the current window is full, waits until it resets before resolving.
   *
   * @param propertyId  Channex property UUID
   * @param type        'availability' or 'restrictions'
   */
  async acquire(propertyId: string, type: EndpointType): Promise<void> {
    const key = `${propertyId}:${type}`;
    const now = Date.now();

    let win = this.windows.get(key);

    if (!win || now - win.windowStart >= this.WINDOW_MS) {
      win = { count: 0, windowStart: now };
      this.windows.set(key, win);
    }

    if (win.count < this.LIMIT) {
      win.count++;
      this.logger.debug(
        `[RATE] ${key} — slot ${win.count}/${this.LIMIT} acquired`,
      );
      return;
    }

    const msUntilReset = this.WINDOW_MS - (now - win.windowStart);
    this.logger.warn(
      `[RATE] ${key} — limit reached (${this.LIMIT}/min). Waiting ${msUntilReset}ms.`,
    );

    await this.sleep(msUntilReset + 50);

    const fresh: Window = { count: 1, windowStart: Date.now() };
    this.windows.set(key, fresh);
    this.logger.debug(`[RATE] ${key} — window reset, slot 1/${this.LIMIT} acquired`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

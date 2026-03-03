import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';

export class TokenExpiredError extends Error {
  constructor(
    message: string,
    public readonly metaErrorCode: number,
  ) {
    super(message);
    this.name = 'TokenExpiredError';
  }
}

@Injectable()
export class DefensiveLoggerService {
  private readonly logger = new Logger('MetaAPI');

  async request<T>(config: AxiosRequestConfig): Promise<T> {
    const start = Date.now();
    const url = String(config.url ?? '');

    this.logger.log(`[REQUEST] ${config.method?.toUpperCase()} ${url}`);
    if (config.data) {
      this.logger.debug(`[REQUEST_BODY] ${JSON.stringify(config.data)}`);
    }

    try {
      const response: AxiosResponse<T> = await axios({ ...config });
      const latency = Date.now() - start;

      this.logger.log(`[RESPONSE] ${response.status} | [LATENCY] ${latency}ms`);
      this.logger.log('[RESPONSE_BODY]');
      console.dir(response.data, { depth: null });

      return response.data;
    } catch (err: any) {
      const latency = Date.now() - start;
      const errorCode = err?.response?.data?.error?.code as number | undefined;
      const errorMessage = err?.response?.data?.error?.message as string | undefined;

      this.logger.error(
        `[ERROR_CODE] ${errorCode ?? 'UNKNOWN'} | [LATENCY] ${latency}ms | ${errorMessage ?? err.message}`,
      );

      // Meta token errors — no retry possible.
      //
      // Error 190: always an invalid/expired token.
      // Error 100: ambiguous — can mean "code already consumed" (token error) OR
      //   "Tried accessing nonexisting field" (missing OAuth scope, NOT a token error).
      //   Only classify as TokenExpiredError when the message is not about a missing
      //   field, so that scope errors surface as plain API failures instead of
      //   misleading the caller into thinking the code was already used.
      const isFieldAccessError = errorMessage?.includes('nonexisting field') ?? false;
      if (errorCode === 190 || (errorCode === 100 && !isFieldAccessError)) {
        throw new TokenExpiredError(
          `Meta token error (${errorCode}): ${errorMessage ?? 'Token is invalid or already used.'}`,
          errorCode,
        );
      }

      throw err;
    }
  }
}

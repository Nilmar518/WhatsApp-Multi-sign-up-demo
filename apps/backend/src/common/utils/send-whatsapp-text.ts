/**
 * sendWhatsAppText — standalone Meta Graph API v25.0 text-message sender.
 *
 * No NestJS DI. Importable by any service, script, or test without needing
 * access to the application container.
 *
 * For instrumented use (latency logging, TokenExpiredError detection) inside
 * NestJS services that already have DefensiveLoggerService injected, prefer
 * defLogger.request() directly. This utility trades that instrumentation for
 * portability — it is the right tool when DI is not available.
 */

import axios from 'axios';

// ─── Constants ────────────────────────────────────────────────────────────────

import { META_API } from '../../integrations/meta/meta-api-versions';

const META_MESSAGES_ENDPOINT =
  `${META_API.base(META_API.PHONE_CATALOG)}/{phoneNumberId}/messages`;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SendWhatsAppTextOptions {
  /**
   * WhatsApp Business phone number ID stored in the integration's metaData.
   * This is NOT the human-readable phone number — it is Meta's internal ID
   * (e.g. "123456789012345").
   */
  phoneNumberId: string;

  /** Customer's WhatsApp ID / wa_id (the number they message from). */
  recipientWaId: string;

  /** Plain-text body. WhatsApp markdown (*bold*, _italic_) is supported. */
  text: string;

  /**
   * Bearer token for the request.
   * Callers should prefer META_SYSTEM_USER_TOKEN (has messaging scope) over
   * the WABA integration token when available.
   */
  accessToken: string;
}

export interface SendWhatsAppTextResult {
  /** Meta's wamid for the sent message (e.g. "wamid.HB..."). */
  wamid: string;
}

// ─── Meta API response shapes ─────────────────────────────────────────────────

interface MetaMessagesResponse {
  messaging_product: string;
  contacts: { input: string; wa_id: string }[];
  messages: { id: string }[];
}

interface MetaApiError {
  code?: number;
  message?: string;
  error_subcode?: number;
  fbtrace_id?: string;
}

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Sends a plain-text WhatsApp message via the Meta Graph API v25.0.
 *
 * On success — returns `{ wamid }`.
 * On failure — extracts Meta's structured error object, logs it, and rethrows
 *              a typed `Error` with the Meta error code in the message so
 *              callers can pattern-match on it if needed.
 *
 * @example
 * ```ts
 * const { wamid } = await sendWhatsAppText({
 *   phoneNumberId: integration.metaData.phoneNumberId,
 *   recipientWaId: '591712345678',
 *   text: '🛒 *Tu Carrito Actual:*\n...',
 *   accessToken: systemToken,
 * });
 * ```
 */
export async function sendWhatsAppText(
  options: SendWhatsAppTextOptions,
): Promise<SendWhatsAppTextResult> {
  const { phoneNumberId, recipientWaId, text, accessToken } = options;

  const url = META_MESSAGES_ENDPOINT.replace('{phoneNumberId}', phoneNumberId);

  // Standard WhatsApp Cloud API text message payload
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to:                recipientWaId,
    type:              'text',
    text:              { body: text },
  };

  try {
    const { data } = await axios.post<MetaMessagesResponse>(url, payload, {
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${accessToken}`,
      },
    });

    const wamid = data.messages?.[0]?.id ?? 'unknown';
    return { wamid };

  } catch (err: unknown) {
    // ── Extract Meta's structured error for a useful log line ──────────────
    const metaError = (err as any)?.response?.data?.error as  // eslint-disable-line @typescript-eslint/no-explicit-any
      MetaApiError | undefined;

    if (metaError) {
      // Re-throw with the Meta error code in the message so catch blocks in
      // calling services can distinguish API rejections from network failures.
      const detail =
        `Meta error ${metaError.code ?? '?'}: ` +
        `${metaError.message ?? '(no message)'}` +
        (metaError.fbtrace_id ? ` [fbtrace_id=${metaError.fbtrace_id}]` : '');

      throw new Error(`[WHATSAPP_SEND] ✗ ${detail} — recipient=${recipientWaId}`);
    }

    // Network-level failure (DNS, timeout, connection refused, etc.)
    throw new Error(
      `[WHATSAPP_SEND] ✗ Network failure — ` +
      `${(err as Error).message} — recipient=${recipientWaId}`,
    );
  }
}

// ─── Interactive button message sender ────────────────────────────────────────

/**
 * Options for sendWhatsAppInteractive.
 * The `interactive` object is typed via WhatsAppInteractivePayload from
 * cart.types — imported inline to avoid a circular dependency.
 */
export interface SendWhatsAppInteractiveOptions {
  phoneNumberId: string;
  recipientWaId: string;
  /** The `interactive` object as defined by the Meta Cloud API spec */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interactive: Record<string, any>;
  accessToken: string;
}

/**
 * Sends a WhatsApp interactive message (type='interactive') via the Meta
 * Graph API v25.0.
 *
 * Use this for button, list, or product messages. The caller is responsible
 * for constructing a valid `interactive` object — see WhatsAppInteractivePayload
 * in cart.types.ts for the button message shape.
 *
 * Full interactive button payload sent to Meta:
 * ```json
 * {
 *   "messaging_product": "whatsapp",
 *   "recipient_type":    "individual",
 *   "to":                "<recipientWaId>",
 *   "type":              "interactive",
 *   "interactive": {
 *     "type": "button",
 *     "body": { "text": "🛒 Tienes 3 artículos ... ¿Qué deseas hacer?" },
 *     "action": {
 *       "buttons": [
 *         { "type": "reply", "reply": { "id": "CMD_VIEW_MPM", "title": "Ver ítems" } },
 *         { "type": "reply", "reply": { "id": "CMD_PAY_CART", "title": "Pagar"    } }
 *       ]
 *     }
 *   }
 * }
 * ```
 *
 * On success — returns `{ wamid }`.
 * On failure — extracts Meta's structured error and rethrows with the
 *              error code in the message, identical to sendWhatsAppText.
 */
export async function sendWhatsAppInteractive(
  options: SendWhatsAppInteractiveOptions,
): Promise<SendWhatsAppTextResult> {
  const { phoneNumberId, recipientWaId, interactive, accessToken } = options;

  const url = META_MESSAGES_ENDPOINT.replace('{phoneNumberId}', phoneNumberId);

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to:                recipientWaId,
    type:              'interactive',
    interactive,
  };

  try {
    const { data } = await axios.post<MetaMessagesResponse>(url, payload, {
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${accessToken}`,
      },
    });

    const wamid = data.messages?.[0]?.id ?? 'unknown';
    return { wamid };

  } catch (err: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metaError = (err as any)?.response?.data?.error as MetaApiError | undefined;

    if (metaError) {
      const detail =
        `Meta error ${metaError.code ?? '?'}: ` +
        `${metaError.message ?? '(no message)'}` +
        (metaError.fbtrace_id ? ` [fbtrace_id=${metaError.fbtrace_id}]` : '');
      throw new Error(`[WHATSAPP_INTERACTIVE] ✗ ${detail} — recipient=${recipientWaId}`);
    }

    throw new Error(
      `[WHATSAPP_INTERACTIVE] ✗ Network failure — ` +
      `${(err as Error).message} — recipient=${recipientWaId}`,
    );
  }
}

import { useState, useRef, useCallback } from 'react';

// ─── SetupStep ────────────────────────────────────────────────────────────────

/**
 * SetupStep — mirrors the backend MetaSetupStatus state machine plus UI-only
 * states for the in-flight period and terminal states.
 *
 * Progression (happy path):
 *   idle
 *   → exchanging_token      (FB.login callback fires, code sent to backend)
 *   → registering_phone     (POST /integrations/meta/whatsapp/register)
 *   → verifying_status       (POST /integrations/meta/whatsapp/status)
 *   → selecting_catalog      (optional, automatically picks the first catalog)
 *   → subscribing_webhooks   (POST /integrations/meta/whatsapp/subscribe-webhooks)
 *   → complete               (WEBHOOKS_SUBSCRIBED — Firestore onSnapshot drives UI to ACTIVE)
 *
 * Catalog selection is now automatic after status verification. If a catalog
 * lookup or selection fails, the hook logs the error and continues the chain.
 *
 * Error / retry:
 *   → error               (any step failed definitively — show error, reset to idle)
 */
export type SetupStep =
  | 'idle'
  | 'exchanging_token'
  | 'registering_phone'
  | 'verifying_status'
  | 'subscribing_webhooks'
  | 'complete'
  | 'error';

// ─── Internal helpers ─────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5_000;

/**
 * Fetch a per-step endpoint with automatic retry on 5xx / network errors.
 * 4xx responses are considered definitive and returned immediately.
 * Returns null if all retries are exhausted.
 */
async function fetchWithRetry(
  url: string,
  body: object,
  method: 'POST' | 'GET' = 'POST',
): Promise<Response | null> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      // 4xx → definitive failure, do not retry
      if (res.ok || (res.status >= 400 && res.status < 500)) return res;
      console.warn(
        `[useWhatsAppConnect] ${url} attempt ${attempt}/${MAX_RETRIES} — HTTP ${res.status}, retrying in ${RETRY_DELAY_MS}ms`,
      );
    } catch {
      console.warn(
        `[useWhatsAppConnect] ${url} attempt ${attempt}/${MAX_RETRIES} — network error, retrying in ${RETRY_DELAY_MS}ms`,
      );
    }
    if (attempt < MAX_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
  return null;
}

/**
 * Remove Facebook Login State (CSRF nonces) from localStorage after the OAuth
 * exchange — these `fblst_` keys are written by the FB SDK and serve no
 * purpose once the flow completes.
 */
function clearFacebookLoginState(): void {
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('fblst_')) toRemove.push(key);
  }
  toRemove.forEach((k) => {
    localStorage.removeItem(k);
    console.log(`[useWhatsAppConnect] Cleared FB login state: ${k}`);
  });
}

// ─── Catalog types ────────────────────────────────────────────────────────────

export interface Catalog {
  id: string;
  name: string;
  vertical?: string;
}

// ─── Hook return type ─────────────────────────────────────────────────────────

export interface UseWhatsAppConnectReturn {
  step: SetupStep;
  integrationId: string | null;
  error: string | null;
  /**
   * Step 1 — called from ConnectButton's FB.login callback.
   * Exchanges the single-use code for a long-lived token, then automatically
   * chains registerPhone → verifyStatus → subscribeWebhooks.
   */
  exchangeToken: (
    code: string,
    wabaId: string,
    phoneNumberId: string,
    businessId: string,
  ) => Promise<void>;
  /**
   * Step 4a — fetch available catalogs for manual user selection.
   * Does NOT advance setupStatus — read-only prerequisite.
   */
  fetchCatalogs: (businessId: string) => Promise<Catalog[]>;
  /**
   * Step 4b — link the chosen catalog to the integration.
   * Only required when the demo exposes catalog selection to the user.
   */
  selectCatalog: (catalogId: string) => Promise<boolean>;
  /** Resets the hook to idle state so a new connect attempt can begin. */
  reset: () => void;
}

// ─── useWhatsAppConnect ───────────────────────────────────────────────────────

/**
 * useWhatsAppConnect
 *
 * Encapsulates the full 5-step WhatsApp Cloud API onboarding state machine.
 * ConnectButton calls only `exchangeToken()` — the hook chains the remaining
 * steps automatically on success, advancing `step` so StatusDisplay can show
 * granular progress without any additional plumbing in the component tree.
 *
 * Retry policy (inherited from fetchWithRetry):
 *   5xx / network error → retry up to MAX_RETRIES times with RETRY_DELAY_MS gap
 *   4xx               → return immediately (definitive; includes 410 Gone)
 *
 * Error contract:
 *   On any definitive failure, `step` moves to 'error' and `error` is set to
 *   a human-readable message. Call `reset()` to return to 'idle' and allow
 *   the user to retry from the start.
 */
export function useWhatsAppConnect(businessId?: string): UseWhatsAppConnectReturn {
  const [step, setStep] = useState<SetupStep>('idle');
  const [integrationId, setIntegrationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keeps the latest integrationId accessible inside long-running async chains
  // without stale-closure issues.
  const integrationIdRef = useRef<string | null>(null);

  const fail = useCallback((message: string) => {
    setError(message);
    setStep('error');
    console.error(`[useWhatsAppConnect] ✗ ${message}`);
  }, []);

  // ─── Step 2: Register phone ──────────────────────────────────────────────────

  const registerPhone = useCallback(async (id: string): Promise<boolean> => {
    setStep('registering_phone');

    const res = await fetchWithRetry(
      '/api/integrations/meta/whatsapp/register',
      { integrationId: id },
    );

    if (!res) {
      fail(`Phone registration failed after ${MAX_RETRIES} attempts. Please retry.`);
      return false;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { message?: string };
      fail(body.message ?? `Phone registration failed (HTTP ${res.status}).`);
      return false;
    }
    console.log(`[useWhatsAppConnect] ✓ PHONE_REGISTERED — integrationId=${id}`);
    return true;
  }, [fail]);

  // ─── Step 3: Verify phone status ─────────────────────────────────────────────

  const verifyStatus = useCallback(async (id: string): Promise<boolean> => {
    setStep('verifying_status');

    const res = await fetchWithRetry(
      '/api/integrations/meta/whatsapp/status',
      { integrationId: id },
    );

    if (!res) {
      fail(`Status verification failed after ${MAX_RETRIES} attempts. Please retry.`);
      return false;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { message?: string };
      fail(body.message ?? `Status verification failed (HTTP ${res.status}).`);
      return false;
    }
    console.log(`[useWhatsAppConnect] ✓ STATUS_VERIFIED — integrationId=${id}`);
    return true;
  }, [fail]);

  // ─── Step 5: Subscribe webhooks ──────────────────────────────────────────────

  const subscribeWebhooks = useCallback(async (id: string): Promise<boolean> => {
    setStep('subscribing_webhooks');

    const res = await fetchWithRetry(
      '/api/integrations/meta/whatsapp/subscribe-webhooks',
      { integrationId: id },
    );

    if (!res) {
      fail(`Webhook subscription failed after ${MAX_RETRIES} attempts. Please retry.`);
      return false;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { message?: string };
      fail(body.message ?? `Webhook subscription failed (HTTP ${res.status}).`);
      return false;
    }
    console.log(`[useWhatsAppConnect] ✓ WEBHOOKS_SUBSCRIBED — integrationId=${id}`);
    return true;
  }, [fail]);

  // ─── Step 4a: Fetch catalogs (read-only, on demand) ──────────────────────────

  const fetchCatalogs = useCallback(
    async (businessId: string): Promise<Catalog[]> => {
      const id = integrationIdRef.current;
      if (!id) return [];

      try {
        const res = await fetch(
          `/api/integrations/meta/catalogs?integrationId=${encodeURIComponent(id)}&businessId=${encodeURIComponent(businessId)}`,
        );
        if (!res.ok) return [];
        return (await res.json()) as Catalog[];
      } catch {
        return [];
      }
    },
    [],
  );

  // ─── Step 4b: Select catalog ─────────────────────────────────────────────────

  const selectCatalog = useCallback(
    async (catalogId: string): Promise<boolean> => {
      const id = integrationIdRef.current;
      if (!id) return false;

      try {
        const res = await fetchWithRetry(
          `/api/integrations/meta/${encodeURIComponent(id)}/catalogs`,
          { catalogId },
        );

        if (!res || !res.ok) {
          const body = res ? await res.json().catch(() => ({})) as { message?: string } : null;
          console.error(
            body?.message ?? '[useWhatsAppConnect] selectCatalog failed',
          );
          return false;
        }

        console.log(`[useWhatsAppConnect] ✓ CATALOG_SELECTED — catalogId=${catalogId}`);
        return true;
      } catch (error) {
        console.error('[useWhatsAppConnect] selectCatalog failed:', error);
        return false;
      }
    },
    [],
  );

  // ─── Step 1: Exchange token (entry point from ConnectButton) ──────────────────

  const exchangeToken = useCallback(
    async (
      code: string,
      wabaId: string,
      phoneNumberId: string,
      signupBusinessId: string,
    ): Promise<void> => {
      setStep('exchanging_token');
      setError(null);
      setIntegrationId(null);

      const res = await fetchWithRetry(
        '/api/integrations/meta/exchange-token',
        { code, wabaId, phoneNumberId, businessId: signupBusinessId },
      );

      if (!res) {
        fail(`Token exchange failed after ${MAX_RETRIES} attempts. Please retry.`);
        return;
      }

      if (!res.ok) {
        if (res.status === 410) {
          fail(
            'This signup code has already been used. Please click "Retry Connection" to start the signup again.',
          );
        } else if (res.status === 409) {
          fail('Registration limit reached for this WhatsApp account.');
        } else {
          const body = await res.json().catch(() => ({})) as { message?: string };
          fail(body.message ?? `Token exchange failed (HTTP ${res.status}).`);
        }
        return;
      }

      // Token exchanged — clear FB CSRF state and extract the new integrationId (UUID)
      clearFacebookLoginState();
      const data = await res.json() as { integrationId: string };
      const newId = data.integrationId;
      setIntegrationId(newId);
      integrationIdRef.current = newId;
      console.log(`[useWhatsAppConnect] ✓ TOKEN_EXCHANGED — integrationId=${newId}`);

      // ── Automatic chain: register → verify → subscribe ────────────────────────
      // Each step returns false on failure; `fail()` has already been called and
      // `step` is already 'error', so we just short-circuit.
      if (!(await registerPhone(newId))) return;
      if (!(await verifyStatus(newId))) return;
      const catalogs = await fetchCatalogs(signupBusinessId);
      if (catalogs.length > 0) {
        const selected = await selectCatalog(catalogs[0].id);
        if (!selected) {
          console.warn(
            `[useWhatsAppConnect] Continuing without catalog selection — catalogId=${catalogs[0].id}`,
          );
        }
      }
      if (!(await subscribeWebhooks(newId))) return;

      // All steps succeeded — Firestore onSnapshot drives the UI to ACTIVE
      setStep('complete');
      console.log('[useWhatsAppConnect] ✓ Setup complete — awaiting Firestore ACTIVE');
    },
    [businessId, fail, fetchCatalogs, registerPhone, selectCatalog, subscribeWebhooks, verifyStatus],
  );

  // ─── reset ───────────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    setStep('idle');
    setError(null);
    setIntegrationId(null);
    integrationIdRef.current = null;
  }, []);

  return {
    step,
    integrationId,
    error,
    exchangeToken,
    fetchCatalogs,
    selectCatalog,
    reset,
  };
}

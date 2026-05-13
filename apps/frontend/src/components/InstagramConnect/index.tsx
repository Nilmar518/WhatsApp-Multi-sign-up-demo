import { useEffect } from 'react';
import { useInstagramConnect } from '../../hooks/useInstagramConnect';
import Button from '../ui/Button';

interface Props {
  businessId: string;
}

/**
 * InstagramConnect
 *
 * Shown on the Instagram tab when the current business has no META_INSTAGRAM
 * integration in Firestore. Initiates the "Instagram API with Instagram Login"
 * pure OAuth 2.0 redirect flow — no Facebook SDK required.
 *
 * Flow:
 *   1. User clicks "Connect Instagram".
 *   2. Browser redirects to api.instagram.com/oauth/authorize.
 *   3. User approves. Instagram redirects to the backend callback URL.
 *   4. Backend exchanges the code, stores the integration in Firestore, and
 *      redirects the browser back to this frontend with ?ig_connected=1.
 *   5. The Firestore listener in useIntegrationId fires (META_INSTAGRAM doc
 *      now exists) and App.tsx replaces this component with InstagramInbox.
 *
 * Error recovery:
 *   If the backend callback redirects back with ?ig_error=..., this component
 *   reads that query param on mount and surfaces a human-readable error banner.
 *
 * Required env vars (apps/frontend/.env):
 *   VITE_INSTAGRAM_APP_ID   — Meta/Instagram App client_id
 *   VITE_IG_REDIRECT_URI    — Backend callback URL registered in Meta App Dashboard
 */
export default function InstagramConnect({ businessId }: Props) {
  const { step, error, connect, reset } = useInstagramConnect();

  // Surface an OAuth error returned by the backend in the query string.
  // e.g. ?ig_error=Token+exchange+failed
  const oauthError = new URLSearchParams(window.location.search).get('ig_error');

  // Clean the error param from the URL after reading it so a refresh doesn't
  // re-show the stale error.
  useEffect(() => {
    if (oauthError) {
      const clean = new URL(window.location.href);
      clean.searchParams.delete('ig_error');
      window.history.replaceState({}, '', clean.toString());
    }
  }, [oauthError]);

  const isRedirecting = step === 'redirecting';
  const hasError      = step === 'error' || Boolean(oauthError);
  const displayError  = error ?? oauthError;

  return (
    <div className="flex flex-col items-center justify-center min-h-[380px] gap-6 text-center px-6">
      {/* Icon */}
      <div className="w-20 h-20 rounded-full bg-gradient-to-br from-purple-50 to-pink-50 flex items-center justify-center text-4xl shadow-sm">
        📸
      </div>

      {/* Copy */}
      <div className="space-y-2 max-w-sm">
        <h2 className="text-xl font-bold text-content">Connect Instagram</h2>
        <p className="text-sm text-content-2 leading-relaxed">
          Link an Instagram Professional account (Business or Creator) to receive and
          reply to Direct Messages, automate comment responses, and track Story Mentions.
          No Facebook Page required.
        </p>
      </div>

      {/* Scope list */}
      <ul className="text-left text-xs text-content-2 space-y-1.5 bg-surface-subtle rounded-xl px-5 py-4 w-full max-w-sm">
        <li className="flex items-center gap-2">
          <span className="text-ok-text font-bold">✓</span>
          <span>
            <strong>instagram_business_basic</strong> — read your Instagram Business profile
          </span>
        </li>
        <li className="flex items-center gap-2">
          <span className="text-ok-text font-bold">✓</span>
          <span>
            <strong>instagram_business_manage_messages</strong> — send &amp; receive DMs,
            Story Mentions
          </span>
        </li>
        <li className="flex items-center gap-2">
          <span className="text-ok-text font-bold">✓</span>
          <span>
            <strong>instagram_business_manage_comments</strong> — read comments, send
            Private Replies
          </span>
        </li>
      </ul>

      {/* Error state */}
      {hasError && (
        <div className="w-full max-w-sm space-y-3">
          <div className="bg-danger-bg border border-danger/40 rounded-xl px-4 py-3 text-xs text-danger-text text-left">
            <strong className="font-semibold">Connection failed:</strong>{' '}
            {displayError}
          </div>
          <Button
            variant="secondary"
            className="w-full"
            onClick={reset}
          >
            Try Again
          </Button>
        </div>
      )}

      {/* Connect button */}
      {!hasError && (
        <button
          onClick={() => connect(businessId)}
          disabled={isRedirecting}
          className={[
            'flex items-center justify-center gap-2 w-full max-w-sm py-3 px-6 rounded-xl font-semibold text-white text-sm transition-colors',
            isRedirecting
              ? 'bg-purple-300 cursor-not-allowed'
              : 'bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 active:from-purple-700 active:to-pink-700',
          ].join(' ')}
        >
          {isRedirecting ? (
            <>
              <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              Redirecting to Instagram…
            </>
          ) : (
            <>
              {/* Instagram glyph */}
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
              </svg>
              Connect Instagram
            </>
          )}
        </button>
      )}

      {/* HTTPS guard */}
      {window.location.protocol === 'http:' && (
        <p className="text-xs text-amber-600 max-w-sm">
          Instagram OAuth requires HTTPS. Open{' '}
          <code className="font-mono bg-amber-50 px-1 rounded">
            https://localhost:5173
          </code>{' '}
          or your ngrok URL.
        </p>
      )}
    </div>
  );
}

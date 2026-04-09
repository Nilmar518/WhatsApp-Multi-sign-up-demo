import { useMessengerConnect } from '../../hooks/useMessengerConnect';

interface Props {
  businessId: string;
}

/**
 * MessengerConnect
 *
 * Shown on the Messenger tab when the current business has no META_MESSENGER
 * integration in Firestore. Handles the full onboarding flow:
 *
 *   1. User clicks "Connect Facebook Messenger".
 *   2. Facebook Login popup opens with page management scopes.
 *   3. Hook retrieves the short-lived access token.
 *   4. Hook POSTs to /api/integrations/messenger/setup.
 *   5. Backend exchanges token, selects page, stores PAT, writes Firestore doc,
 *      subscribes webhooks.
 *   6. The Firestore onSnapshot listener in useIntegrationId fires and the
 *      parent (App.tsx) swaps this component for the Messenger chat view.
 */
export default function MessengerConnect({ businessId }: Props) {
  const { step, error, connect, reset } = useMessengerConnect();

  const isConnecting = step === 'connecting';
  const hasError = step === 'error';

  return (
    <div className="flex flex-col items-center justify-center min-h-[380px] gap-6 text-center px-6">
      {/* Icon */}
      <div className="w-20 h-20 rounded-full bg-blue-50 flex items-center justify-center text-4xl shadow-sm">
        💙
      </div>

      {/* Copy */}
      <div className="space-y-2 max-w-sm">
        <h2 className="text-xl font-bold text-gray-900">Connect Facebook Messenger</h2>
        <p className="text-sm text-gray-500 leading-relaxed">
          Link a Facebook Page to receive and reply to Messenger conversations from
          this dashboard. You&apos;ll need to be an admin of the Page.
        </p>
      </div>

      {/* Scope list */}
      <ul className="text-left text-xs text-gray-500 space-y-1.5 bg-gray-50 rounded-xl px-5 py-4 w-full max-w-sm">
        <li className="flex items-center gap-2">
          <span className="text-green-500 font-bold">✓</span>
          <span><strong>pages_show_list</strong> — list your managed Pages</span>
        </li>
        <li className="flex items-center gap-2">
          <span className="text-green-500 font-bold">✓</span>
          <span><strong>pages_messaging</strong> — send &amp; receive Messenger messages</span>
        </li>
        <li className="flex items-center gap-2">
          <span className="text-green-500 font-bold">✓</span>
          <span><strong>pages_manage_metadata</strong> — subscribe to Page webhooks</span>
        </li>
      </ul>

      {/* Action */}
      {hasError ? (
        <div className="w-full max-w-sm space-y-3">
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-700 text-left">
            <strong className="font-semibold">Connection failed:</strong>{' '}
            {error}
          </div>
          <button
            onClick={reset}
            className="w-full py-2.5 px-6 rounded-xl font-semibold text-sm text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors"
          >
            Try Again
          </button>
        </div>
      ) : (
        <button
          onClick={() => connect(businessId)}
          disabled={isConnecting}
          className={[
            'flex items-center justify-center gap-2 w-full max-w-sm py-3 px-6 rounded-xl font-semibold text-white text-sm transition-colors',
            isConnecting
              ? 'bg-blue-300 cursor-not-allowed'
              : 'bg-[#1877F2] hover:bg-[#1565d8] active:bg-[#0e4faa]',
          ].join(' ')}
        >
          {isConnecting ? (
            <>
              <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              Connecting...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
              </svg>
              Continue with Facebook
            </>
          )}
        </button>
      )}

      {/* HTTPS guard */}
      {window.location.protocol === 'http:' && (
        <p className="text-xs text-amber-600 max-w-sm">
          Facebook Login requires HTTPS. Open{' '}
          <code className="font-mono bg-amber-50 px-1 rounded">https://localhost:5173</code>{' '}
          or your ngrok URL.
        </p>
      )}
    </div>
  );
}

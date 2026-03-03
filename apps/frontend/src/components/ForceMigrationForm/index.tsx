import { useState } from 'react';

interface Props {
  businessId: string;
  /** True when the form was triggered by a failed Embedded Signup popup */
  fromFailedPopup?: boolean;
}

type Step = 'start' | 'request_code' | 'verify_code' | 'complete' | 'done';
type CodeMethod = 'SMS' | 'VOICE';

async function post<T>(
  path: string,
  body: object,
): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetch(`/api/migration/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { msg = ((await res.json()) as { message?: string }).message ?? msg; } catch { /* ignore */ }
      return { data: null, error: msg };
    }
    return { data: (await res.json()) as T, error: null };
  } catch (e: any) {
    return { data: null, error: (e as Error).message ?? 'Network error' };
  }
}

const inputBase =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 disabled:bg-gray-50 disabled:text-gray-400';

const otpInput = `${inputBase} tracking-[0.4em] text-center text-xl font-mono`;

function Btn({ disabled, loading, label, loadingLabel, onClick }: {
  disabled: boolean;
  loading: boolean;
  label: string;
  loadingLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      disabled={disabled || loading}
      onClick={onClick}
      className={[
        'w-full py-2.5 px-4 rounded-xl font-semibold text-sm transition-colors',
        disabled || loading
          ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
          : 'bg-purple-600 hover:bg-purple-700 active:bg-purple-800 text-white',
      ].join(' ')}
    >
      {loading ? loadingLabel : label}
    </button>
  );
}

export default function ForceMigrationForm({ businessId, fromFailedPopup }: Props) {
  const [step, setStep] = useState<Step>('start');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inputs
  const [phone, setPhone] = useState('');
  const [codeMethod, setCodeMethod] = useState<CodeMethod>('SMS');
  const [otp, setOtp] = useState('');
  const [pin, setPin] = useState('');

  // Returned by /start, passed to subsequent steps
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setLoading(true);
    try { await fn(); } catch { /* errors set inside fn */ }
    setLoading(false);
  };

  // ── Step 1: start ──────────────────────────────────────────────────────────

  const handleStart = () => run(async () => {
    const { data, error: err } = await post<{ phoneNumberId: string; wabaId: string }>(
      'start',
      { businessId, phoneE164: phone },
    );
    if (err || !data) { setError(err ?? 'Failed to register number'); return; }
    setPhoneNumberId(data.phoneNumberId);
    setWabaId(data.wabaId);
    setStep('request_code');
  });

  // ── Step 2: request OTP ───────────────────────────────────────────────────

  const handleRequestCode = () => run(async () => {
    const { error: err } = await post('request-code', { businessId, phoneNumberId, codeMethod });
    if (err) { setError(err); return; }
    setStep('verify_code');
  });

  // ── Step 3: verify OTP ────────────────────────────────────────────────────

  const handleVerify = () => run(async () => {
    const { error: err } = await post('verify-code', { businessId, phoneNumberId, code: otp });
    if (err) { setError(err); return; }
    setStep('complete');
  });

  // ── Step 4: register + activate ───────────────────────────────────────────

  const handleComplete = () => run(async () => {
    const { error: err } = await post('complete', { businessId, phoneNumberId, wabaId, pin });
    if (err) { setError(err); return; }
    setStep('done');
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* Banner — shown when redirected from a failed signup popup */}
      {fromFailedPopup && step === 'start' && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-900 leading-relaxed">
          <strong className="font-semibold">Signup incomplete.</strong>{' '}
          Your number may already be linked to your account. Enter it below and we'll
          complete the migration automatically.
        </div>
      )}

      {/* Step 1 — phone number */}
      {step === 'start' && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-gray-800">Enter your WhatsApp number</p>
          <p className="text-xs text-gray-500 -mt-1">
            Include the country code. Example: <span className="font-mono">+591 67025559</span>
          </p>
          <input
            className={inputBase}
            placeholder="+591 67025559"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={loading}
            type="tel"
          />
          <Btn
            disabled={phone.trim().length < 7}
            loading={loading}
            label="Send verification code →"
            loadingLabel="Setting up..."
            onClick={handleStart}
          />
        </div>
      )}

      {/* Step 2 — choose delivery method, send OTP */}
      {step === 'request_code' && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-gray-800">
            How should we send the code?
          </p>
          <p className="text-xs text-gray-500 -mt-1">
            A 6-digit code will be delivered to <strong>{phone}</strong>.
          </p>
          <div className="flex gap-2">
            {(['SMS', 'VOICE'] as CodeMethod[]).map((m) => (
              <button
                key={m}
                onClick={() => setCodeMethod(m)}
                className={[
                  'flex-1 py-2.5 rounded-xl text-sm font-medium border-2 transition-colors',
                  codeMethod === m
                    ? 'border-purple-500 bg-purple-50 text-purple-700'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300',
                ].join(' ')}
              >
                {m === 'SMS' ? '💬 SMS' : '📞 Voice call'}
              </button>
            ))}
          </div>
          <Btn
            disabled={false}
            loading={loading}
            label={`Send via ${codeMethod} →`}
            loadingLabel="Sending..."
            onClick={handleRequestCode}
          />
        </div>
      )}

      {/* Step 3 — enter OTP */}
      {step === 'verify_code' && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-gray-800">Enter the 6-digit code</p>
          <p className="text-xs text-gray-500 -mt-1">
            Check your {codeMethod === 'SMS' ? 'SMS messages' : 'phone for a call'}.
            Submitting this code will disconnect the number from the WhatsApp app.
          </p>
          <input
            className={otpInput}
            placeholder="——————"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            disabled={loading}
            maxLength={6}
            inputMode="numeric"
          />
          <Btn
            disabled={otp.length !== 6}
            loading={loading}
            label="Verify →"
            loadingLabel="Verifying..."
            onClick={handleVerify}
          />
        </div>
      )}

      {/* Step 4 — set PIN and activate */}
      {step === 'complete' && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-gray-800">Set a 6-digit security PIN</p>
          <p className="text-xs text-gray-500 -mt-1">
            This PIN protects your number on the WhatsApp Cloud API.
            Use <span className="font-mono bg-gray-100 px-1 rounded">000000</span> for testing.
          </p>
          <input
            className={otpInput}
            placeholder="——————"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            disabled={loading}
            maxLength={6}
            inputMode="numeric"
          />
          <Btn
            disabled={pin.length !== 6}
            loading={loading}
            label="Activate number →"
            loadingLabel="Activating..."
            onClick={handleComplete}
          />
        </div>
      )}

      {/* Done */}
      {step === 'done' && (
        <div className="text-center py-6 space-y-2">
          <div className="text-4xl">✓</div>
          <p className="font-semibold text-green-700">Migration complete!</p>
          <p className="text-xs text-gray-500">
            {phone} is now live on WhatsApp Cloud API. The dashboard will update automatically.
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 leading-relaxed">
          {error}
        </p>
      )}
    </div>
  );
}

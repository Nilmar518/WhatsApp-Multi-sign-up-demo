import { useState } from 'react';
import Button from '../ui/Button';
import { Input } from '../ui/Input';
import { useLanguage } from '../../context/LanguageContext';

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

const otpClasses = 'tracking-[0.4em] text-center text-xl font-mono';

export default function ForceMigrationForm({ businessId, fromFailedPopup }: Props) {
  const { t } = useLanguage();
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
          <strong className="font-semibold">{t('migration.signupIncomplete')}</strong>{' '}
          {t('migration.signupBody')}
        </div>
      )}

      {/* Step 1 — phone number */}
      {step === 'start' && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-content">{t('migration.enterNumber')}</p>
          <p className="text-xs text-content-2 -mt-1">
            {t('migration.includeCode')} <span className="font-mono">+591 67025559</span>
          </p>
          <Input
            placeholder="+591 67025559"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={loading}
            type="tel"
          />
          <Button
            variant="primary"
            className="w-full"
            disabled={phone.trim().length < 7 || loading}
            onClick={handleStart}
          >
            {loading ? t('migration.settingUp') : t('migration.sendCode')}
          </Button>
        </div>
      )}

      {/* Step 2 — choose delivery method, send OTP */}
      {step === 'request_code' && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-content">
            {t('migration.howToSend')}
          </p>
          <p className="text-xs text-content-2 -mt-1">
            {t('migration.codeDelivery')} <strong>{phone}</strong>.
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
                    : 'border-edge text-content-2 hover:border-edge',
                ].join(' ')}
              >
                {m === 'SMS' ? '💬 SMS' : t('migration.voiceOption')}
              </button>
            ))}
          </div>
          <Button
            variant="primary"
            className="w-full"
            disabled={loading}
            onClick={handleRequestCode}
          >
            {loading ? t('migration.sending') : (codeMethod === 'SMS' ? t('migration.sendViaSms') : t('migration.sendViaVoice'))}
          </Button>
        </div>
      )}

      {/* Step 3 — enter OTP */}
      {step === 'verify_code' && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-content">{t('migration.enterOtp')}</p>
          <p className="text-xs text-content-2 -mt-1">
            {codeMethod === 'SMS' ? t('migration.checkSms') : t('migration.checkCall')}{' '}
            {t('migration.otpWarning')}
          </p>
          <Input
            className={otpClasses}
            placeholder="——————"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            disabled={loading}
            maxLength={6}
            inputMode="numeric"
          />
          <Button
            variant="primary"
            className="w-full"
            disabled={otp.length !== 6 || loading}
            onClick={handleVerify}
          >
            {loading ? t('migration.verifying') : t('migration.verify')}
          </Button>
        </div>
      )}

      {/* Step 4 — set PIN and activate */}
      {step === 'complete' && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-content">{t('migration.setPin')}</p>
          <p className="text-xs text-content-2 -mt-1">
            {t('migration.pinDesc')}
            {' '}Use <span className="font-mono bg-surface-subtle px-1 rounded">000000</span> for testing.
          </p>
          <Input
            className={otpClasses}
            placeholder="——————"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            disabled={loading}
            maxLength={6}
            inputMode="numeric"
          />
          <Button
            variant="primary"
            className="w-full"
            disabled={pin.length !== 6 || loading}
            onClick={handleComplete}
          >
            {loading ? t('migration.activating') : t('migration.activate')}
          </Button>
        </div>
      )}

      {/* Done */}
      {step === 'done' && (
        <div className="text-center py-6 space-y-2">
          <div className="text-4xl">✓</div>
          <p className="font-semibold text-ok-text">{t('migration.complete')}</p>
          <p className="text-xs text-content-2">
            {phone} {t('migration.completeBody')}
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-xs text-danger-text bg-danger-bg border border-danger/40 rounded-lg px-3 py-2 leading-relaxed">
          {error}
        </p>
      )}
    </div>
  );
}

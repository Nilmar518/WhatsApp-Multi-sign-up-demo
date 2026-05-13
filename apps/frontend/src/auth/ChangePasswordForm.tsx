import { useState } from 'react';
import { updatePassword } from 'firebase/auth';
import { auth } from '../firebase/firebase';
import { Input } from '../components/ui/Input';
import Button from '../components/ui/Button';
import { useLanguage } from '../context/LanguageContext';

interface Props {
  onDone: () => void;
}

export default function ChangePasswordForm({ onDone }: Props) {
  const [newPassword, setNewPassword]         = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError]                     = useState('');
  const [loading, setLoading]                 = useState(false);
  const { t } = useLanguage();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (newPassword.length < 8) {
      setError(t('auth.pwMinLength'));
      return;
    }
    if (!/[A-Z]/.test(newPassword)) {
      setError(t('auth.pwUppercase'));
      return;
    }
    if (!/[0-9]/.test(newPassword)) {
      setError(t('auth.pwNumber'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('auth.pwMismatch'));
      return;
    }

    setLoading(true);
    try {
      await updatePassword(auth.currentUser!, newPassword);
      const uid = auth.currentUser!.uid;
      await fetch(`/api/users/${uid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mustChangePassword: false }),
      });
      onDone();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(t('auth.pwError'));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-surface-raised border border-edge rounded-2xl p-8 shadow-md">
        <h1 className="text-xl font-semibold text-content mb-2">{t('auth.changePassword')}</h1>
        <p className="text-sm text-content-2 mb-6">{t('auth.firstSession')}</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-content mb-1">
              {t('auth.newPassword')}
            </label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              placeholder="••••••••"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-content mb-1">
              {t('auth.confirmPassword')}
            </label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-sm text-danger-text bg-danger-bg border border-danger/30 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <Button type="submit" disabled={loading} className="w-full justify-center">
            {loading ? t('auth.saving') : t('auth.changePassword')}
          </Button>
        </form>
      </div>
    </div>
  );
}

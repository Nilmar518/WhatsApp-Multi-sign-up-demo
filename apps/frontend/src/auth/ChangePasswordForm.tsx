import { useState } from 'react';
import { updatePassword } from 'firebase/auth';
import { auth } from '../firebase/firebase';
import { Input } from '../components/ui/Input';
import Button from '../components/ui/Button';

interface Props {
  onDone: () => void;
}

export default function ChangePasswordForm({ onDone }: Props) {
  const [newPassword, setNewPassword]         = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError]                     = useState('');
  const [loading, setLoading]                 = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (newPassword.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (!/[A-Z]/.test(newPassword)) {
      setError('La contraseña debe contener al menos una letra mayúscula.');
      return;
    }
    if (!/[0-9]/.test(newPassword)) {
      setError('La contraseña debe contener al menos un número.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Las contraseñas no coinciden.');
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
        setError('Ocurrió un error. Intenta de nuevo.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-surface-raised border border-edge rounded-2xl p-8 shadow-md">
        <h1 className="text-xl font-semibold text-content mb-2">Cambiar contraseña</h1>
        <p className="text-sm text-content-2 mb-6">
          Esta es tu primera sesión. Por seguridad, debes establecer una nueva contraseña.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-content mb-1">
              Nueva contraseña
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
              Confirmar contraseña
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
            {loading ? 'Guardando…' : 'Cambiar contraseña'}
          </Button>
        </form>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase/firebase';
import { Smartphone, Loader2 } from 'lucide-react';
import Button from '../components/ui/Button';
import { Input } from '../components/ui/Input';

export default function LoginPage() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch {
      setError('Credenciales inválidas. Verifica tu correo y contraseña.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-sidebar flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-brand mb-4 shadow-brand">
            <Smartphone size={24} className="text-white" />
          </div>
          <h1 className="text-xl font-bold text-content-inv">Migo App</h1>
          <p className="text-sm text-content-sidebar mt-1">Ingresa a tu cuenta</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-surface-sidebar-hover rounded-xl p-6 flex flex-col gap-4 shadow-lg ring-1 ring-white/5"
        >
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-content-sidebar">Correo electrónico</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@correo.com"
              required
              className="bg-surface-sidebar border-edge-strong text-content-inv placeholder:text-content-sidebar-muted focus:border-brand"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-content-sidebar">Contraseña</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="bg-surface-sidebar border-edge-strong text-content-inv placeholder:text-content-sidebar-muted focus:border-brand"
            />
          </div>

          {error && (
            <p className="text-xs text-danger-text bg-danger-bg border border-danger/30 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <Button type="submit" disabled={loading} className="w-full justify-center mt-1">
            {loading ? <Loader2 size={16} className="animate-spin" /> : null}
            {loading ? 'Ingresando…' : 'Ingresar'}
          </Button>
        </form>
      </div>
    </div>
  );
}

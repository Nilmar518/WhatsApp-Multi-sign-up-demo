import { useState } from 'react';
import { Input, Select } from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import { createUser, type CreateUserResponse } from '../api/usersApi';

const COUNTRY_OPTIONS = [
  { code: 'AR', name: 'Argentina' }, { code: 'BO', name: 'Bolivia' },
  { code: 'BR', name: 'Brasil' }, { code: 'CL', name: 'Chile' },
  { code: 'CO', name: 'Colombia' }, { code: 'CR', name: 'Costa Rica' },
  { code: 'EC', name: 'Ecuador' }, { code: 'MX', name: 'México' },
  { code: 'PE', name: 'Perú' }, { code: 'PY', name: 'Paraguay' },
  { code: 'UY', name: 'Uruguay' }, { code: 'VE', name: 'Venezuela' },
  { code: 'US', name: 'Estados Unidos' }, { code: 'ES', name: 'España' },
];

const ROLE_OPTIONS = [
  { value: 'customer', label: 'Cliente' },
  { value: 'admin', label: 'Administrador' },
  { value: 'owner', label: 'Propietario' },
];

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

type Phase = 'form' | 'password';

interface FormState {
  name: string;
  email: string;
  phone: string;
  country: string;
  role: 'customer' | 'admin' | 'owner';
}

interface FormErrors {
  name?: string;
  email?: string;
  phone?: string;
}

export default function CreateUserModal({ onClose, onSuccess }: Props) {
  const [phase, setPhase] = useState<Phase>('form');
  const [form, setForm] = useState<FormState>({
    name: '',
    email: '',
    phone: '',
    country: COUNTRY_OPTIONS[0].code,
    role: 'customer',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [createdUser, setCreatedUser] = useState<CreateUserResponse | null>(null);
  const [copied, setCopied] = useState(false);

  function validate(): boolean {
    const next: FormErrors = {};
    if (!form.name.trim()) next.name = 'El nombre es requerido';
    if (!form.email.trim()) {
      next.email = 'El email es requerido';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      next.email = 'Ingresa un email válido';
    }
    if (!form.phone.trim()) {
      next.phone = 'El teléfono es requerido';
    } else if (!/^\d+$/.test(form.phone)) {
      next.phone = 'Solo se permiten dígitos';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const result = await createUser({
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        country: form.country,
        role: form.role,
      });
      setCreatedUser(result);
      setPhase('password');
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Error al crear el usuario');
    } finally {
      setSubmitting(false);
    }
  }

  function handleChange(field: keyof FormState, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
    if (errors[field as keyof FormErrors]) {
      setErrors(prev => ({ ...prev, [field]: undefined }));
    }
  }

  async function handleCopy() {
    if (!createdUser) return;
    try {
      await navigator.clipboard.writeText(createdUser.temporaryPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: do nothing if clipboard is unavailable
    }
  }

  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (phase === 'form' && e.target === e.currentTarget) {
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
    >
      <div className="bg-surface-raised rounded-xl shadow-2xl p-6 w-full max-w-md">
        {phase === 'form' && (
          <>
            <h2 className="text-lg font-semibold text-content mb-5">Agregar usuario</h2>
            <form onSubmit={handleSubmit} noValidate>
              <div className="flex flex-col gap-4">
                <div>
                  <label className="block text-sm font-medium text-content-2 mb-1">
                    Nombre
                  </label>
                  <Input
                    type="text"
                    value={form.name}
                    onChange={e => handleChange('name', e.target.value)}
                    placeholder="Nombre completo"
                  />
                  {errors.name && (
                    <p className="mt-1 text-xs text-danger-text">{errors.name}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-content-2 mb-1">
                    Email
                  </label>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={e => handleChange('email', e.target.value)}
                    placeholder="correo@ejemplo.com"
                  />
                  {errors.email && (
                    <p className="mt-1 text-xs text-danger-text">{errors.email}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-content-2 mb-1">
                    Teléfono
                  </label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    value={form.phone}
                    onChange={e => handleChange('phone', e.target.value)}
                    placeholder="Solo dígitos"
                  />
                  {errors.phone && (
                    <p className="mt-1 text-xs text-danger-text">{errors.phone}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-content-2 mb-1">
                    País
                  </label>
                  <Select
                    value={form.country}
                    onChange={e => handleChange('country', e.target.value)}
                  >
                    {COUNTRY_OPTIONS.map(c => (
                      <option key={c.code} value={c.code}>{c.name}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-content-2 mb-1">
                    Rol
                  </label>
                  <Select
                    value={form.role}
                    onChange={e => handleChange('role', e.target.value as FormState['role'])}
                  >
                    {ROLE_OPTIONS.map(r => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </Select>
                </div>
                {serverError && (
                  <p className="text-sm text-danger-text bg-danger-bg rounded-md px-3 py-2">
                    {serverError}
                  </p>
                )}
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <Button type="button" variant="secondary" onClick={onClose}>
                  Cancelar
                </Button>
                <Button type="submit" variant="primary" disabled={submitting}>
                  {submitting ? 'Creando...' : 'Crear usuario'}
                </Button>
              </div>
            </form>
          </>
        )}

        {phase === 'password' && createdUser && (
          <>
            <h2 className="text-lg font-semibold text-content mb-1">
              Usuario creado exitosamente
            </h2>
            <p className="text-sm text-content-2 mb-4">
              {createdUser.name} — {createdUser.email}
            </p>
            <div className="rounded-lg border border-amber-400/40 bg-amber-50/10 px-4 py-3 mb-4">
              <p className="text-sm font-medium text-amber-500">
                Esta contraseña se muestra una sola vez. Cópiala antes de cerrar.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="flex-1 font-mono bg-surface text-content-inv rounded-md px-3 py-2 text-sm break-all select-all">
                {createdUser.temporaryPassword}
              </span>
              <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
                {copied ? 'Copiado' : 'Copiar'}
              </Button>
            </div>
            <div className="flex justify-end mt-6">
              <Button type="button" variant="primary" onClick={onSuccess}>
                Cerrar
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

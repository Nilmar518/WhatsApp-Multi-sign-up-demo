import { useState } from 'react';
import { Input, Select } from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import { updateUser, type User } from '../api/usersApi';

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
  user: User;
  onClose: () => void;
  onSuccess: () => void;
}

interface FormState {
  name: string;
  phone: string;
  country: string;
  role: 'customer' | 'admin' | 'owner';
}

interface FormErrors {
  name?: string;
  phone?: string;
}

export default function EditUserModal({ user, onClose, onSuccess }: Props) {
  const [form, setForm] = useState<FormState>({
    name: user.name,
    phone: user.phone,
    country: user.country,
    role: user.role,
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  function validate(): boolean {
    const next: FormErrors = {};
    if (!form.name.trim()) next.name = 'El nombre es requerido';
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
      await updateUser(user.uid, {
        name: form.name.trim(),
        phone: form.phone.trim(),
        country: form.country,
        role: form.role,
      });
      onSuccess();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Error al actualizar el usuario');
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

  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
    >
      <div className="bg-surface-raised rounded-xl shadow-2xl p-6 w-full max-w-md">
        <h2 className="text-lg font-semibold text-content mb-5">Editar usuario</h2>
        <form onSubmit={handleSubmit} noValidate>
          <div className="flex flex-col gap-4">
            <div>
              <label className="block text-sm font-medium text-content-2 mb-1">
                Email
              </label>
              <Input
                type="email"
                value={user.email}
                readOnly
                disabled
                className="cursor-not-allowed"
              />
            </div>
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
              {submitting ? 'Guardando...' : 'Guardar cambios'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

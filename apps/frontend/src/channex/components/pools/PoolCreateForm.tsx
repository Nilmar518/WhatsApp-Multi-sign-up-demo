import { useState } from 'react';
import Button from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { createMigoProperty, type MigoProperty } from '../../api/migoPropertyApi';
import { useLanguage } from '../../../context/LanguageContext';

interface Props {
  tenantId: string;
  onCreated: (pool: MigoProperty) => void;
  onCancel: () => void;
}

export default function PoolCreateForm({ tenantId, onCreated, onCancel }: Props) {
  const { t } = useLanguage();
  const [title, setTitle] = useState('');
  const [alertThreshold, setAlertThreshold] = useState('0');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError(t('channex.poolCreate.err.name'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const pool = await createMigoProperty({
        tenantId,
        title: title.trim(),
        alert_threshold: parseInt(alertThreshold, 10) || 0,
      });
      onCreated(pool);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('channex.poolCreate.err.create'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-edge bg-surface-raised px-6 py-6 max-w-md">
      <h2 className="text-lg font-semibold text-content mb-5">{t('channex.poolCreate.title')}</h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-content-2 uppercase tracking-wide">
            {t('channex.poolCreate.name')}
          </label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('channex.poolCreate.namePh')}
            required
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-content-2 uppercase tracking-wide">
            {t('channex.poolCreate.alertThreshold')}
          </label>
          <Input
            type="number"
            min={0}
            value={alertThreshold}
            onChange={(e) => setAlertThreshold(e.target.value)}
          />
          <p className="mt-1 text-xs text-content-3">
            {t('channex.poolCreate.alertHelp')}
          </p>
        </div>

        <p className="text-xs text-content-3">
          {t('channex.poolCreate.capacityNote')}
        </p>

        {error && <p className="text-sm text-danger-text">{error}</p>}

        <div className="flex gap-3 pt-2">
          <Button type="submit" variant="primary" size="sm" disabled={saving}>
            {saving ? t('channex.poolCreate.creating') : t('channex.poolCreate.create')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            {t('channex.poolCreate.cancel')}
          </Button>
        </div>
      </form>
    </div>
  );
}

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { provisionProperty } from '../api/channexApi';

interface Props {
  tenantId?: string;
  onProvisioned: (propertyId: string) => void;
}

const CURRENCIES = ['USD', 'EUR', 'PEN'] as const;
const TIMEZONES = ['America/Lima', 'America/New_York', 'Europe/Madrid'] as const;
const PROPERTY_TYPES = ['apartment', 'hotel'] as const;

function resolveTenantId(): string {
  return new URLSearchParams(window.location.search).get('tenantId') ?? 'demo-business-001';
}

function resolveMigoPropertyId(title: string): string {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('migoPropertyId') ?? params.get('propertyId');

  if (fromQuery) return fromQuery;

  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug ? `${slug}-${Date.now().toString(36)}` : `property-${Date.now().toString(36)}`;
}

export default function PropertyProvisioningForm({ tenantId: tenantIdProp, onProvisioned }: Props) {
  const [title, setTitle] = useState('Oceanview Apartment');
  const [currency, setCurrency] = useState<(typeof CURRENCIES)[number]>('USD');
  const [timezone, setTimezone] = useState<(typeof TIMEZONES)[number]>('America/Lima');
  const [propertyType, setPropertyType] = useState<(typeof PROPERTY_TYPES)[number]>('apartment');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channexPropertyId, setChannexPropertyId] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [advanceArmed, setAdvanceArmed] = useState(false);

  const canSubmit = useMemo(() => title.trim().length > 0 && !loading, [loading, title]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setCopyStatus('idle');

    try {
      const resolvedTenant = tenantIdProp ?? resolveTenantId();

      const response = await provisionProperty({
        tenantId: resolvedTenant,
        migoPropertyId: resolveMigoPropertyId(title),
        title: title.trim(),
        currency,
        timezone,
        propertyType,
      });

      setChannexPropertyId(response.channexPropertyId);
      setAdvanceArmed(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to provision property.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!channexPropertyId || !advanceArmed) return;

    const timer = window.setTimeout(() => {
      onProvisioned(channexPropertyId);
    }, 900);

    return () => {
      window.clearTimeout(timer);
    };
  }, [advanceArmed, channexPropertyId, onProvisioned]);

  const handleCopy = async () => {
    if (!channexPropertyId) return;

    try {
      await navigator.clipboard.writeText(channexPropertyId);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
  };

  return (
    <div className="rounded-2xl border border-rose-100 bg-surface-raised shadow-sm overflow-hidden">
      <div className="border-b border-rose-50 bg-gradient-to-r from-rose-50 to-orange-50 px-6 py-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-600">Step 1</p>
        <h2 className="mt-1 text-xl font-semibold text-content">Property Provisioning</h2>
        <p className="mt-1 text-sm text-content-2">
          Create the Channex property that will host the Airbnb connection flow.
        </p>
      </div>

      <form className="space-y-5 px-6 py-6" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <label htmlFor="airbnb-title" className="text-sm font-medium text-content">Title</label>
          <input
            id="airbnb-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full rounded-xl border border-edge bg-surface-raised px-4 py-3 text-sm text-content outline-none transition focus:border-rose-400 focus:ring-4 focus:ring-rose-100"
            placeholder="Oceanview Apartment"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <label htmlFor="airbnb-currency" className="text-sm font-medium text-content">Currency</label>
            <select
              id="airbnb-currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value as (typeof CURRENCIES)[number])}
              className="w-full rounded-xl border border-edge bg-surface-raised px-4 py-3 text-sm text-content outline-none transition focus:border-rose-400 focus:ring-4 focus:ring-rose-100"
            >
              {CURRENCIES.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label htmlFor="airbnb-timezone" className="text-sm font-medium text-content">Timezone</label>
            <select
              id="airbnb-timezone"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value as (typeof TIMEZONES)[number])}
              className="w-full rounded-xl border border-edge bg-surface-raised px-4 py-3 text-sm text-content outline-none transition focus:border-rose-400 focus:ring-4 focus:ring-rose-100"
            >
              {TIMEZONES.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label htmlFor="airbnb-type" className="text-sm font-medium text-content">Property Type</label>
            <select
              id="airbnb-type"
              value={propertyType}
              onChange={(event) => setPropertyType(event.target.value as (typeof PROPERTY_TYPES)[number])}
              className="w-full rounded-xl border border-edge bg-surface-raised px-4 py-3 text-sm text-content outline-none transition focus:border-rose-400 focus:ring-4 focus:ring-rose-100"
            >
              {PROPERTY_TYPES.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-danger-text/20 bg-danger-bg px-4 py-3 text-sm text-danger-text">
            {error}
          </div>
        )}

        {channexPropertyId && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Provisioned</p>
                <p className="mt-1 break-all text-sm font-mono text-emerald-900">{channexPropertyId}</p>
                <p className="mt-1 text-xs text-emerald-700">Advancing to connection setup...</p>
              </div>

              <button
                type="button"
                onClick={() => void handleCopy()}
                className="inline-flex items-center justify-center rounded-xl border border-emerald-300 bg-white px-4 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100"
              >
                {copyStatus === 'copied' ? 'Copied' : copyStatus === 'failed' ? 'Copy failed' : 'Copy ID'}
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-3">
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex items-center justify-center rounded-xl bg-rose-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {loading ? 'Provisioning...' : 'Provision Property'}
          </button>
        </div>
      </form>
    </div>
  );
}
import { useState, useEffect } from 'react';
import { getPropertyBookings, type Reservation } from '../../api/channexHubApi';
import type { ChannexProperty } from '../../hooks/useChannexProperties';
import ReservationDetailModal from './ReservationDetailModal';
import { useLanguage } from '../../../context/LanguageContext';

type EnrichedReservation = Reservation & { propertyTitle: string; propertyChannelCode: string | null };

const STATUS_STYLES: Record<string, string> = {
  new: 'bg-ok-bg text-ok-text',
  booking_new: 'bg-ok-bg text-ok-text',
  confirmed: 'bg-ok-bg text-ok-text',
  modified: 'bg-caution-bg text-caution-text',
  booking_modification: 'bg-caution-bg text-caution-text',
  cancelled: 'bg-danger-bg text-danger-text',
  booking_cancellation: 'bg-danger-bg text-danger-text',
};

function statusStyle(s: string): string {
  return STATUS_STYLES[s] ?? 'bg-surface-subtle text-content-2';
}

function statusLabel(s: string): string {
  const raw = s.replace(/^booking_/, '').replace(/_/g, ' ');
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function nights(checkIn: string, checkOut: string): number | null {
  const a = new Date(checkIn);
  const b = new Date(checkOut);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

interface Props {
  tenantId: string;
  properties: ChannexProperty[];
}

const today = new Date().toISOString().split('T')[0];

export default function AggregatedReservationsPanel({ tenantId, properties }: Props) {
  const { t } = useLanguage();
  const [reservations, setReservations] = useState<EnrichedReservation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<EnrichedReservation | null>(null);
  const [filterPropertyId, setFilterPropertyId] = useState('');
  const [filterFrom, setFilterFrom] = useState(today);
  const [filterTo, setFilterTo] = useState(today);
  // fetchParams drives the actual API call — only updates on "Aplicar"
  const [fetchParams, setFetchParams] = useState({ from: today, to: today });

  useEffect(() => {
    let cancelled = false;
    if (properties.length === 0) {
      setReservations([]);
      return;
    }
    setLoading(true);
    setError(null);
    Promise.allSettled(
      properties.map(async (p) => {
        const { bookings, propertyChannelCode } = await getPropertyBookings(
          p.channex_property_id, tenantId, 100, fetchParams.from, fetchParams.to,
        );
        return bookings.map((r) => ({ ...r, propertyTitle: p.title, propertyChannelCode: propertyChannelCode ?? null }));
      }),
    )
      .then((results) => {
        if (cancelled) return;
        const merged = results
          .filter((r): r is PromiseFulfilledResult<EnrichedReservation[]> => r.status === 'fulfilled')
          .flatMap((r) => r.value)
          .sort((a, b) => {
            const aDate = (a.arrival_date ?? a.check_in).slice(0, 10);
            const bDate = (b.arrival_date ?? b.check_in).slice(0, 10);
            return bDate.localeCompare(aDate);
          });
        const failCount = results.filter((r) => r.status === 'rejected').length;
        setReservations(merged);
        if (failCount > 0) setError(`${failCount} propert${failCount > 1 ? 'ies' : 'y'} failed to load.`);
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Error loading reservations'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [properties, tenantId, fetchParams]);

  const filtered = reservations.filter((r) => {
    if (filterPropertyId && r.channex_property_id !== filterPropertyId) return false;
    const arrivalDate = (r.arrival_date ?? r.check_in).slice(0, 10);
    if (filterFrom && arrivalDate < filterFrom) return false;
    if (filterTo && arrivalDate > filterTo) return false;
    return true;
  });

  const hasFilters = filterPropertyId || filterFrom !== today || filterTo !== today;

  function handleApply() {
    setFetchParams({ from: filterFrom, to: filterTo });
  }

  function handleClear() {
    setFilterPropertyId('');
    setFilterFrom(today);
    setFilterTo(today);
    setFetchParams({ from: today, to: today });
  }

  // Group by property when no property filter is active
  const groupEntries = filterPropertyId
    ? null
    : Object.entries(
        filtered.reduce<Record<string, EnrichedReservation[]>>((acc, r) => {
          (acc[r.propertyTitle] ??= []).push(r);
          return acc;
        }, {}),
      ).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="flex flex-col">
      {/* Filters bar */}
      <div className="flex flex-col gap-3 px-3 py-3 sm:px-6 sm:flex-row sm:flex-wrap sm:items-center border-b border-edge">
        {/* Property filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-content-2 uppercase tracking-wider shrink-0">
            {t('channex.integration.filter.property')}
          </span>
          <select
            value={filterPropertyId}
            onChange={(e) => setFilterPropertyId(e.target.value)}
            className="flex-1 sm:flex-none min-w-0 bg-surface border border-edge rounded-md text-sm text-content px-2 py-1 outline-none focus:border-brand"
          >
            <option value="">{t('channex.integration.filter.allProps')}</option>
            {properties.map((p) => (
              <option key={p.channex_property_id} value={p.channex_property_id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>

        {/* Date range filter */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-content-2 uppercase tracking-wider shrink-0">
              {t('channex.integration.filter.from')}
            </span>
            <input
              type="date"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
              className="bg-surface border border-edge rounded-md text-sm text-content px-2 py-1 outline-none focus:border-brand"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-content-2 uppercase tracking-wider shrink-0">
              {t('channex.integration.filter.to')}
            </span>
            <input
              type="date"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
              className="bg-surface border border-edge rounded-md text-sm text-content px-2 py-1 outline-none focus:border-brand"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto sm:ml-auto">
          {hasFilters && (
            <button
              type="button"
              onClick={handleClear}
              className="text-xs text-content-2 hover:text-content underline"
            >
              {t('channex.integration.filter.clear')}
            </button>
          )}
          <button
            type="button"
            onClick={handleApply}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-brand text-white hover:bg-brand/90 transition-colors"
          >
            Aplicar
          </button>
        </div>
      </div>

      {/* List */}
      <div className="px-3 py-4 sm:px-6 sm:py-6">
        {loading && <p className="text-sm text-content-2">{t('channex.integration.reservations.loading')}</p>}
        {error && <p className="text-sm text-danger-text">{error}</p>}
        {!loading && !error && filtered.length === 0 && (
          <p className="text-sm text-content-2">{t('channex.integration.reservations.empty')}</p>
        )}
        {!loading && !error && filtered.length > 0 && (
          <div className="space-y-4">
            <p className="text-xs text-content-2">{filtered.length} reservations</p>

            {/* Grouped by property (when no property filter) */}
            {groupEntries && groupEntries.map(([propertyTitle, rows]) => (
              <div key={propertyTitle}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold text-content uppercase tracking-wider">
                    {propertyTitle}
                  </span>
                  <span className="text-xs text-content-2">({rows.length})</span>
                </div>
                <div className="space-y-2">
                  {rows.map((r, i) => {
                    const n = nights(r.check_in, r.check_out);
                    const guest = [r.guest_first_name, r.guest_last_name].filter(Boolean).join(' ') || 'Guest';
                    return (
                      <div
                        key={r.channex_booking_id ?? `${r.channex_property_id}-${r.check_in}-${i}`}
                        role="button"
                        tabIndex={0}
                        aria-label={`${guest}, ${r.check_in} – ${r.check_out}`}
                        onClick={() => setSelected(r)}
                        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSelected(r)}
                        className="flex items-center gap-3 px-3 py-3 bg-surface border border-edge rounded-xl cursor-pointer hover:border-brand transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-content truncate">{guest}</p>
                          <p className="text-xs text-content-2 mt-0.5">
                            {r.check_in} – {r.check_out}
                            {n !== null && ` · ${n} night${n !== 1 ? 's' : ''}`}
                          </p>
                        </div>
                        <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${statusStyle(r.booking_status)}`}>
                          {statusLabel(r.booking_status)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Flat list (when a specific property is selected) */}
            {!groupEntries && (
              <div className="space-y-2">
                {filtered.map((r, i) => {
                  const n = nights(r.check_in, r.check_out);
                  const guest = [r.guest_first_name, r.guest_last_name].filter(Boolean).join(' ') || 'Guest';
                  return (
                    <div
                      key={r.channex_booking_id ?? `${r.channex_property_id}-${r.check_in}-${i}`}
                      role="button"
                      tabIndex={0}
                      aria-label={`${guest}, ${r.check_in} – ${r.check_out}`}
                      onClick={() => setSelected(r)}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSelected(r)}
                      className="flex items-center gap-3 px-3 py-3 bg-surface border border-edge rounded-xl cursor-pointer hover:border-brand transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-content truncate">{guest}</p>
                        <p className="text-xs text-content-2 mt-0.5">
                          {r.check_in} – {r.check_out}
                          {n !== null && ` · ${n} night${n !== 1 ? 's' : ''}`}
                        </p>
                      </div>
                      <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${statusStyle(r.booking_status)}`}>
                        {statusLabel(r.booking_status)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {selected && (
        <ReservationDetailModal
          reservation={selected}
          tenantId={tenantId}
          propertyTitle={selected.propertyTitle}
          propertyChannelCode={selected.propertyChannelCode}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

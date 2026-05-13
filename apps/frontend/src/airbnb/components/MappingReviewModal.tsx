import { useState, useCallback } from 'react';
import {
  commitMapping,
  type StageSyncResult,
  type StagedMappingRow,
  type CommitMappingInput,
} from '../api/channexApi';

// ─── Types ────────────────────────────────────────────────────────────────────

type RowStatus = 'pending' | 'mapping' | 'mapped' | 'error';

interface RowState {
  selectedRatePlanId: string;
  status: RowStatus;
  errorMsg: string | null;
}

interface Props {
  /** Staged data returned by POST /sync_stage */
  staged: StageSyncResult;
  /** Called when every row has been successfully mapped */
  onComplete: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPrice(price: number, currency: string | null): string {
  if (!currency) return `${price}`;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(price);
  } catch {
    return `${price} ${currency}`;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * MappingReviewModal — Stage 2 of the Airbnb onboarding pipeline.
 *
 * Displays a table of auto-generated Airbnb ↔ Channex Rate Plan pairs.
 * The user can adjust each row's Rate Plan via a dropdown, then either:
 *   - Click "Map" on a single row to commit that specific pair, or
 *   - Click "Auto-Map All" to commit every pending row at once.
 *
 * When every row is mapped, a "Complete Setup" CTA calls `onComplete`
 * to advance the wizard to the Availability & Rates (INVENTORY) step.
 *
 * API calls:
 *   POST /api/channex/properties/:id/commit_mapping
 *   Body: { channelId, mappings: [{ ratePlanId, otaListingId }] }
 */
export default function MappingReviewModal({ staged, onComplete }: Props) {
  const { channelId, propertyId, staged: rows } = staged;

  // Build initial row state — each row pre-selects the auto-matched Rate Plan.
  const [rowStates, setRowStates] = useState<Record<string, RowState>>(() => {
    const init: Record<string, RowState> = {};
    for (const row of rows) {
      init[row.airbnb.airbnbId] = {
        selectedRatePlanId: row.channex.ratePlanId,
        status: 'pending',
        errorMsg: null,
      };
    }
    return init;
  });

  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const allMapped = rows.every((r) => rowStates[r.airbnb.airbnbId]?.status === 'mapped');
  const pendingRows = rows.filter((r) => rowStates[r.airbnb.airbnbId]?.status === 'pending');

  const setRowStatus = useCallback(
    (airbnbId: string, patch: Partial<RowState>) => {
      setRowStates((prev) => ({
        ...prev,
        [airbnbId]: { ...prev[airbnbId], ...patch },
      }));
    },
    [],
  );

  // ── Individual row commit ───────────────────────────────────────────────────

  const handleMapRow = useCallback(
    async (row: StagedMappingRow) => {
      const { airbnbId } = row.airbnb;
      const { selectedRatePlanId } = rowStates[airbnbId];

      setRowStatus(airbnbId, { status: 'mapping', errorMsg: null });

      try {
        await commitMapping(propertyId, channelId, [
          { ratePlanId: selectedRatePlanId, otaListingId: airbnbId },
        ]);
        setRowStatus(airbnbId, { status: 'mapped' });
      } catch (err) {
        setRowStatus(airbnbId, {
          status: 'error',
          errorMsg: err instanceof Error ? err.message : 'Mapping failed',
        });
      }
    },
    [rowStates, propertyId, channelId, setRowStatus],
  );

  // ── Bulk commit ─────────────────────────────────────────────────────────────

  const handleAutoMapAll = useCallback(async () => {
    if (!pendingRows.length) return;

    setBulkLoading(true);
    setBulkError(null);

    const mappings: CommitMappingInput[] = pendingRows.map((row) => ({
      ratePlanId: rowStates[row.airbnb.airbnbId].selectedRatePlanId,
      otaListingId: row.airbnb.airbnbId,
    }));

    // Optimistically mark all pending as 'mapping'
    setRowStates((prev) => {
      const next = { ...prev };
      for (const row of pendingRows) {
        next[row.airbnb.airbnbId] = { ...next[row.airbnb.airbnbId], status: 'mapping', errorMsg: null };
      }
      return next;
    });

    try {
      await commitMapping(propertyId, channelId, mappings);
      // Mark all as mapped
      setRowStates((prev) => {
        const next = { ...prev };
        for (const row of pendingRows) {
          next[row.airbnb.airbnbId] = { ...next[row.airbnb.airbnbId], status: 'mapped' };
        }
        return next;
      });
    } catch (err) {
      // Revert to pending on failure
      setRowStates((prev) => {
        const next = { ...prev };
        for (const row of pendingRows) {
          next[row.airbnb.airbnbId] = { ...next[row.airbnb.airbnbId], status: 'pending' };
        }
        return next;
      });
      setBulkError(err instanceof Error ? err.message : 'Auto-Map failed. Please try again.');
    } finally {
      setBulkLoading(false);
    }
  }, [pendingRows, rowStates, propertyId, channelId]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="bg-surface-raised rounded-2xl border border-edge overflow-hidden">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="px-6 py-5 border-b border-edge">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-7 h-7 rounded-lg bg-rose-100 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-rose-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-content">
            Review Listing Mappings
          </h2>
        </div>
        <p className="text-sm text-content-2 ml-10">
          Verify that each Airbnb listing is paired to the correct Channex rate plan,
          then commit individual rows or map all at once.
        </p>
      </div>

      {/* ── Success banner ─────────────────────────────────────────────────── */}
      {allMapped && (
        <div className="mx-6 mt-5 flex items-center gap-3 rounded-xl bg-ok-bg border border-ok-text/20 px-4 py-3">
          <svg className="w-5 h-5 text-ok-text flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
          <p className="text-sm font-medium text-ok-text flex-1">
            All listings mapped successfully. Your Airbnb channel is now active.
          </p>
          <button
            type="button"
            onClick={onComplete}
            className="shrink-0 px-4 py-1.5 bg-ok-text hover:opacity-80 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            Continue →
          </button>
        </div>
      )}

      {/* ── Bulk error ────────────────────────────────────────────────────── */}
      {bulkError && (
        <div className="mx-6 mt-5 rounded-xl bg-danger-bg border border-danger-text/20 px-4 py-3 text-sm text-danger-text">
          <span className="font-semibold">Auto-Map failed: </span>{bulkError}
        </div>
      )}

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      <div className="px-6 py-5">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-medium text-content-3 uppercase tracking-wider border-b border-edge">
                <th className="pb-3 pr-4 w-6">#</th>
                <th className="pb-3 pr-4">Airbnb Listing</th>
                <th className="pb-3 pr-4 w-48">Rate Plan</th>
                <th className="pb-3 w-24 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge/50">
              {rows.map((row, idx) => {
                const { airbnbId, title, basePrice, currency, capacity } = row.airbnb;
                const rowState = rowStates[airbnbId];
                const isMapped = rowState.status === 'mapped';
                const isMapping = rowState.status === 'mapping';
                const isError = rowState.status === 'error';

                return (
                  <tr key={airbnbId} className={isMapped ? 'opacity-60' : ''}>
                    {/* Index */}
                    <td className="py-4 pr-4 text-content-3 font-mono text-xs align-top pt-5">
                      {idx + 1}
                    </td>

                    {/* Airbnb listing info */}
                    <td className="py-4 pr-4 align-top">
                      <p className="font-medium text-content leading-snug">{title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-content-3 font-mono">{airbnbId}</span>
                        <span className="text-content-3">·</span>
                        <span className="text-xs text-content-2">
                          {formatPrice(basePrice, currency)}
                          <span className="text-content-3">/night</span>
                        </span>
                        <span className="text-content-3">·</span>
                        <span className="text-xs text-content-3">{capacity} guests</span>
                      </div>
                      {isError && rowState.errorMsg && (
                        <p className="text-xs text-red-600 mt-1">{rowState.errorMsg}</p>
                      )}
                    </td>

                    {/* Rate Plan dropdown */}
                    <td className="py-4 pr-4 align-top">
                      <select
                        disabled={isMapped || isMapping}
                        value={rowState.selectedRatePlanId}
                        onChange={(e) =>
                          setRowStatus(airbnbId, { selectedRatePlanId: e.target.value })
                        }
                        className={[
                          'w-full text-sm rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-rose-500 transition-colors',
                          isMapped
                            ? 'bg-surface-subtle border-edge text-content-3 cursor-not-allowed'
                            : 'bg-surface-raised border-edge text-content hover:border-edge',
                        ].join(' ')}
                      >
                        {rows.map((r) => (
                          <option key={r.channex.ratePlanId} value={r.channex.ratePlanId}>
                            {r.channex.title}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* Action */}
                    <td className="py-4 align-top text-right">
                      {isMapped ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-ok-text bg-ok-bg rounded-full px-2.5 py-1">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                          </svg>
                          Mapped
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={isMapping}
                          onClick={() => void handleMapRow(row)}
                          className={[
                            'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                            isMapping
                              ? 'bg-surface-subtle text-content-3 cursor-not-allowed'
                              : isError
                                ? 'bg-danger-bg hover:opacity-80 text-danger-text'
                                : 'bg-rose-600 hover:bg-rose-700 text-white',
                          ].join(' ')}
                        >
                          {isMapping ? (
                            <>
                              <div className="w-3 h-3 border border-gray-300 border-t-gray-500 rounded-full animate-spin" />
                              Mapping…
                            </>
                          ) : isError ? (
                            'Retry'
                          ) : (
                            'Map'
                          )}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Footer actions ────────────────────────────────────────────────── */}
      {!allMapped && (
        <div className="px-6 pb-6 flex items-center justify-between gap-4 border-t border-edge pt-4">
          <p className="text-xs text-content-3">
            {pendingRows.length} of {rows.length} listings pending
          </p>
          <button
            type="button"
            disabled={bulkLoading || !pendingRows.length}
            onClick={() => void handleAutoMapAll()}
            className={[
              'inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors',
              bulkLoading || !pendingRows.length
                ? 'bg-surface-subtle text-content-3 cursor-not-allowed'
                : 'bg-content hover:bg-content-2 text-surface-raised',
            ].join(' ')}
          >
            {bulkLoading ? (
              <>
                <div className="w-4 h-4 border-2 border-gray-400 border-t-white rounded-full animate-spin" />
                Mapping all…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                </svg>
                Auto-Map All
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

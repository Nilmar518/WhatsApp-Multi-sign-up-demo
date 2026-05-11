import { useState } from 'react';
import {
  provisionProperty,
  createRoomType,
  createRatePlan,
} from '../api/channexHubApi';
import type { ChannexProperty } from '../hooks/useChannexProperties';

interface RoomDraft {
  title: string;
  defaultOccupancy: number;
  roomTypeId?: string;
}

interface RateDraft {
  roomTypeId: string;
  roomTitle: string;
  title: string;
  rate: number;
  ratePlanId?: string;
}

interface Props {
  tenantId: string;
  onComplete: (prop: ChannexProperty) => void;
  onCancel: () => void;
}

type Step = 1 | 2 | 3 | 4;

export default function PropertySetupWizard({ tenantId, onComplete, onCancel }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─── CERTIFICATION TEST DEFAULTS ───────────────────────────────────────────
  // These defaults pre-fill the wizard for Channex PMS certification testing.
  // To reset for production: replace title with '' and rooms with [].
  // ─── END CERTIFICATION TEST DEFAULTS ───────────────────────────────────────

  // Step 1 — replace with '' for production
  const [title, setTitle] = useState('Test Property - Migo UIT' /* '' */);
  const [currency, setCurrency] = useState('USD'); // same in production
  const [timezone, setTimezone] = useState('America/New_York'); // same in production

  // Step 2 — replace with [] for production
  const [rooms, setRooms] = useState<RoomDraft[]>([
    /* CERT: pre-filled for certification — replace with [] for production */
    { title: 'Twin Room', defaultOccupancy: 2 },
    { title: 'Double Room', defaultOccupancy: 2 },
  ]);

  // Step 3
  const [rates, setRates] = useState<RateDraft[]>([]);

  // Step 4
  const [channexPropertyId, setChannexPropertyId] = useState('');
  const [firestoreDocId, setFirestoreDocId] = useState('');

  async function handleStep1() {
    setSaving(true);
    setError(null);
    try {
      const result = await provisionProperty({
        tenantId,
        migoPropertyId: `${tenantId}-${Date.now()}`,
        title,
        currency,
        timezone,
      });
      setChannexPropertyId(result.channexPropertyId);
      setFirestoreDocId(result.firestoreDocId);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create property.');
    } finally {
      setSaving(false);
    }
  }

  async function handleStep2() {
    setSaving(true);
    setError(null);
    try {
      const created: RoomDraft[] = [];
      for (const room of rooms) {
        const { id } = await createRoomType(channexPropertyId, {
          title: room.title,
          defaultOccupancy: room.defaultOccupancy,
          occAdults: room.defaultOccupancy,
        });
        created.push({ ...room, roomTypeId: id });
      }
      setRooms(created);
      const drafts: RateDraft[] = [];
      for (const room of created) {
        if (!room.roomTypeId) continue;
        drafts.push(
          { roomTypeId: room.roomTypeId, roomTitle: room.title, title: 'Best Available Rate', rate: 100 },
          { roomTypeId: room.roomTypeId, roomTitle: room.title, title: 'Bed and Breakfast', rate: 120 },
        );
      }
      setRates(drafts);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create room types.');
    } finally {
      setSaving(false);
    }
  }

  async function handleStep3() {
    setSaving(true);
    setError(null);
    try {
      const created: RateDraft[] = [];
      for (const rate of rates) {
        const { id } = await createRatePlan(channexPropertyId, rate.roomTypeId, {
          title: rate.title,
          currency,
          rate: rate.rate,
          occupancy: 2,
        });
        created.push({ ...rate, ratePlanId: id });
      }
      setRates(created);
      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create rate plans.');
    } finally {
      setSaving(false);
    }
  }

  function handleFinish() {
    onComplete({
      firestoreDocId,
      channex_property_id: channexPropertyId,
      title,
      currency,
      timezone,
      connection_status: 'pending',
      connected_channels: [],
      room_types: rooms
        .flatMap((r) =>
          rates
            .filter((rt) => rt.roomTypeId === r.roomTypeId)
            .map((rt) => ({
              room_type_id: r.roomTypeId!,
              title: r.title,
              default_occupancy: r.defaultOccupancy,
              occ_adults: r.defaultOccupancy,
              occ_children: 0,
              occ_infants: 0,
              count_of_rooms: 1,
              rate_plans: rt.ratePlanId
                ? [{ rate_plan_id: rt.ratePlanId, title: rt.title, currency, rate: rt.rate, occupancy: r.defaultOccupancy }]
                : [],
            })),
        ),
    });
  }

  const stepLabels = ['Property details', 'Room types', 'Rate plans', 'Confirm'];

  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      {/* Progress */}
      <div className="mb-6 flex items-center gap-2">
        {stepLabels.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                step > i + 1
                  ? 'bg-emerald-500 text-white'
                  : step === i + 1
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-400'
              }`}
            >
              {step > i + 1 ? '✓' : i + 1}
            </div>
            <span
              className={`text-xs font-medium ${step === i + 1 ? 'text-slate-900' : 'text-slate-400'}`}
            >
              {label}
            </span>
            {i < stepLabels.length - 1 && (
              <div className="h-px w-6 bg-slate-200" />
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Step 1: Property details */}
      {step === 1 && (
        <div className="space-y-4">
          <h3 className="text-base font-semibold text-slate-900">Property details</h3>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Name</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Currency</label>
              <input
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Timezone</label>
              <input
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          <div className="flex justify-between pt-2">
            <button type="button" onClick={onCancel} className="text-sm text-slate-500 hover:text-slate-700">Cancel</button>
            <button
              type="button"
              onClick={() => void handleStep1()}
              disabled={saving || !title}
              className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Creating…' : 'Create Property →'}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Room types */}
      {step === 2 && (
        <div className="space-y-4">
          <h3 className="text-base font-semibold text-slate-900">Room types</h3>
          <p className="text-sm text-slate-500">
            Property ID: <code className="font-mono text-xs text-indigo-700">{channexPropertyId}</code>
          </p>
          {rooms.map((room, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3">
              <div className="flex-1">
                <input
                  value={room.title}
                  onChange={(e) => {
                    const next = [...rooms];
                    next[i] = { ...room, title: e.target.value };
                    setRooms(next);
                  }}
                  className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
              <div className="w-28">
                <label className="block text-[11px] text-slate-500">Occupancy</label>
                <input
                  type="number"
                  min={1}
                  value={room.defaultOccupancy}
                  onChange={(e) => {
                    const next = [...rooms];
                    next[i] = { ...room, defaultOccupancy: Number(e.target.value) };
                    setRooms(next);
                  }}
                  className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
              <button
                type="button"
                onClick={() => setRooms(rooms.filter((_, j) => j !== i))}
                className="text-slate-400 hover:text-red-500"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setRooms([...rooms, { title: '', defaultOccupancy: 2 }])}
            className="text-sm text-indigo-600 hover:text-indigo-800"
          >
            + Add room type
          </button>
          <div className="flex justify-between pt-2">
            <button type="button" onClick={() => setStep(1)} className="text-sm text-slate-500 hover:text-slate-700">← Back</button>
            <button
              type="button"
              onClick={() => void handleStep2()}
              disabled={saving || rooms.length === 0}
              className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Creating…' : 'Create Room Types →'}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Rate plans */}
      {step === 3 && (
        <div className="space-y-4">
          <h3 className="text-base font-semibold text-slate-900">Rate plans</h3>
          {rates.map((rate, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3">
              <div className="flex-1">
                <label className="block text-[11px] text-slate-500">{rate.roomTitle}</label>
                <input
                  value={rate.title}
                  onChange={(e) => {
                    const next = [...rates];
                    next[i] = { ...rate, title: e.target.value };
                    setRates(next);
                  }}
                  className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
                />
              </div>
              <div className="w-24">
                <label className="block text-[11px] text-slate-500">Base rate</label>
                <input
                  type="number"
                  min={0}
                  value={rate.rate}
                  onChange={(e) => {
                    const next = [...rates];
                    next[i] = { ...rate, rate: Number(e.target.value) };
                    setRates(next);
                  }}
                  className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
                />
              </div>
            </div>
          ))}
          <div className="flex justify-between pt-2">
            <button type="button" onClick={() => setStep(2)} className="text-sm text-slate-500 hover:text-slate-700">← Back</button>
            <button
              type="button"
              onClick={() => void handleStep3()}
              disabled={saving || rates.length === 0}
              className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Creating…' : 'Create Rate Plans →'}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Confirmation */}
      {step === 4 && (
        <div className="space-y-4">
          <h3 className="text-base font-semibold text-slate-900">Setup complete</h3>
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 space-y-2 text-xs font-mono">
            <p><span className="text-slate-500">Property ID:</span> <span className="text-emerald-700">{channexPropertyId}</span></p>
            {rooms.map((r) => (
              <p key={r.roomTypeId}><span className="text-slate-500">{r.title}:</span> <span className="text-emerald-700">{r.roomTypeId}</span></p>
            ))}
            {rates.map((r, i) => (
              <p key={i}><span className="text-slate-500">{r.roomTitle} / {r.title}:</span> <span className="text-emerald-700">{r.ratePlanId}</span></p>
            ))}
          </div>
          <p className="text-xs text-slate-500">Save these IDs for the Channex certification form (Section 2).</p>
          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={handleFinish}
              className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Go to property →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

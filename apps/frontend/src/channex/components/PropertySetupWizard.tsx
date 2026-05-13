import { useState } from 'react';
import {
  provisionProperty,
  createRoomType,
  createRatePlan,
} from '../api/channexHubApi';
import type { ChannexProperty } from '../hooks/useChannexProperties';
import Button from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';

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
  const [title, setTitle] = useState('Test Property - Migo App' /* '' */);
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
    <div className="mx-auto max-w-2xl rounded-2xl border border-edge bg-surface-raised p-6 shadow-sm">
      {/* Progress */}
      <div className="mb-6 flex items-center gap-2">
        {stepLabels.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                step > i + 1
                  ? 'bg-emerald-500 text-white'
                  : step === i + 1
                    ? 'bg-brand text-white'
                    : 'bg-surface-subtle text-content-3'
              }`}
            >
              {step > i + 1 ? '✓' : i + 1}
            </div>
            <span
              className={`text-xs font-medium ${step === i + 1 ? 'text-content' : 'text-content-3'}`}
            >
              {label}
            </span>
            {i < stepLabels.length - 1 && (
              <div className="h-px w-6 bg-edge" />
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-danger-bg bg-danger-bg px-4 py-3 text-sm text-danger-text">
          {error}
        </div>
      )}

      {/* Step 1: Property details */}
      {step === 1 && (
        <div className="space-y-4">
          <h3 className="text-base font-semibold text-content">Property details</h3>
          <div>
            <label className="mb-1 block text-xs font-semibold text-content-2">Name</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-content-2">Currency</label>
              <Input
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-content-2">Timezone</label>
              <Input
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-between pt-2">
            <Button type="button" onClick={onCancel} variant="ghost" size="sm">Cancel</Button>
            <Button
              type="button"
              onClick={() => void handleStep1()}
              disabled={saving || !title}
              variant="primary"
              size="sm"
            >
              {saving ? 'Creating…' : 'Create Property →'}
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Room types */}
      {step === 2 && (
        <div className="space-y-4">
          <h3 className="text-base font-semibold text-content">Room types</h3>
          <p className="text-sm text-content-2">
            Property ID: <code className="font-mono text-xs text-brand">{channexPropertyId}</code>
          </p>
          {rooms.map((room, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl border border-edge px-4 py-3">
              <div className="flex-1">
                <Input
                  value={room.title}
                  onChange={(e) => {
                    const next = [...rooms];
                    next[i] = { ...room, title: e.target.value };
                    setRooms(next);
                  }}
                />
              </div>
              <div className="w-28">
                <label className="block text-[11px] text-content-2">Occupancy</label>
                <Input
                  type="number"
                  min={1}
                  value={room.defaultOccupancy}
                  onChange={(e) => {
                    const next = [...rooms];
                    next[i] = { ...room, defaultOccupancy: Number(e.target.value) };
                    setRooms(next);
                  }}
                />
              </div>
              <button
                type="button"
                onClick={() => setRooms(rooms.filter((_, j) => j !== i))}
                className="text-content-3 hover:text-danger-text"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setRooms([...rooms, { title: '', defaultOccupancy: 2 }])}
            className="text-sm text-brand hover:text-brand"
          >
            + Add room type
          </button>
          <div className="flex justify-between pt-2">
            <Button type="button" onClick={() => setStep(1)} variant="ghost" size="sm">← Back</Button>
            <Button
              type="button"
              onClick={() => void handleStep2()}
              disabled={saving || rooms.length === 0}
              variant="primary"
              size="sm"
            >
              {saving ? 'Creating…' : 'Create Room Types →'}
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Rate plans */}
      {step === 3 && (
        <div className="space-y-4">
          <h3 className="text-base font-semibold text-content">Rate plans</h3>
          {rates.map((rate, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl border border-edge px-4 py-3">
              <div className="flex-1">
                <label className="block text-[11px] text-content-2">{rate.roomTitle}</label>
                <Input
                  value={rate.title}
                  onChange={(e) => {
                    const next = [...rates];
                    next[i] = { ...rate, title: e.target.value };
                    setRates(next);
                  }}
                />
              </div>
              <div className="w-24">
                <label className="block text-[11px] text-content-2">Base rate</label>
                <Input
                  type="number"
                  min={0}
                  value={rate.rate}
                  onChange={(e) => {
                    const next = [...rates];
                    next[i] = { ...rate, rate: Number(e.target.value) };
                    setRates(next);
                  }}
                />
              </div>
            </div>
          ))}
          <div className="flex justify-between pt-2">
            <Button type="button" onClick={() => setStep(2)} variant="ghost" size="sm">← Back</Button>
            <Button
              type="button"
              onClick={() => void handleStep3()}
              disabled={saving || rates.length === 0}
              variant="primary"
              size="sm"
            >
              {saving ? 'Creating…' : 'Create Rate Plans →'}
            </Button>
          </div>
        </div>
      )}

      {/* Step 4: Confirmation */}
      {step === 4 && (
        <div className="space-y-4">
          <h3 className="text-base font-semibold text-content">Setup complete</h3>
          <div className="rounded-xl bg-ok-bg border border-ok-bg px-4 py-3 space-y-2 text-xs font-mono">
            <p><span className="text-content-2">Property ID:</span> <span className="text-ok-text">{channexPropertyId}</span></p>
            {rooms.map((r) => (
              <p key={r.roomTypeId}><span className="text-content-2">{r.title}:</span> <span className="text-ok-text">{r.roomTypeId}</span></p>
            ))}
            {rates.map((r, i) => (
              <p key={i}><span className="text-content-2">{r.roomTitle} / {r.title}:</span> <span className="text-ok-text">{r.ratePlanId}</span></p>
            ))}
          </div>
          <p className="text-xs text-content-2">Save these IDs for the Channex certification form (Section 2).</p>
          <div className="flex justify-end pt-2">
            <Button
              type="button"
              onClick={handleFinish}
              variant="primary"
              size="sm"
            >
              Go to property →
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

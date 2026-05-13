import { useCallback, useEffect, useState } from 'react';
import {
  listRoomTypes,
  createRoomType,
  createRatePlan,
  type StoredRoomType,
  type StoredRatePlan,
} from '../api/channexHubApi';
import Button from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';

interface Props {
  propertyId: string;
  currency: string;
}

export default function RoomRateManager({ propertyId, currency }: Props) {
  const [roomTypes, setRoomTypes] = useState<StoredRoomType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showRoomForm, setShowRoomForm] = useState(false);
  const [newRoomTitle, setNewRoomTitle] = useState('');
  const [newRoomOccupancy, setNewRoomOccupancy] = useState(2);
  const [savingRoom, setSavingRoom] = useState(false);

  const [showRateForm, setShowRateForm] = useState<string | null>(null);
  const [newRateTitle, setNewRateTitle] = useState('');
  const [newRateAmount, setNewRateAmount] = useState(100);
  const [savingRate, setSavingRate] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listRoomTypes(propertyId);
      setRoomTypes(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load room types.');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => { void reload(); }, [reload]);

  async function handleAddRoom() {
    if (!newRoomTitle) return;
    setSavingRoom(true);
    try {
      await createRoomType(propertyId, {
        title: newRoomTitle,
        defaultOccupancy: newRoomOccupancy,
        occAdults: newRoomOccupancy,
      });
      setNewRoomTitle('');
      setNewRoomOccupancy(2);
      setShowRoomForm(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create room type.');
    } finally {
      setSavingRoom(false);
    }
  }

  async function handleAddRate(roomTypeId: string) {
    if (!newRateTitle) return;
    setSavingRate(true);
    try {
      await createRatePlan(propertyId, roomTypeId, {
        title: newRateTitle,
        currency,
        rate: newRateAmount,
        occupancy: 2,
      });
      setNewRateTitle('');
      setNewRateAmount(100);
      setShowRateForm(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create rate plan.');
    } finally {
      setSavingRate(false);
    }
  }

  if (loading) return <p className="text-sm text-content-2">Loading room types…</p>;

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl border border-danger-bg bg-danger-bg px-4 py-3 text-sm text-danger-text">
          {error}
        </div>
      )}

      {roomTypes.map((rt) => (
        <div key={rt.room_type_id} className="rounded-2xl border border-edge bg-surface-raised p-4">
          {/* Room type header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-semibold text-content">{rt.title}</p>
              <p className="text-xs font-mono text-content-3 mt-0.5">{rt.room_type_id}</p>
            </div>
            <div className="flex flex-wrap gap-1.5 justify-end">
              <span className="rounded-full bg-surface-subtle px-2.5 py-1 text-xs font-medium text-content-2">
                {rt.count_of_rooms} room{rt.count_of_rooms !== 1 ? 's' : ''}
              </span>
              <span className="rounded-full bg-brand-subtle px-2.5 py-1 text-xs font-medium text-brand">
                Occ {rt.default_occupancy}
              </span>
            </div>
          </div>

          {/* Occupancy breakdown */}
          <div className="mt-2 flex gap-3 text-xs text-content-2">
            <span>Adults: <span className="font-medium text-content">{rt.occ_adults}</span></span>
            <span>Children: <span className="font-medium text-content">{rt.occ_children}</span></span>
            <span>Infants: <span className="font-medium text-content">{rt.occ_infants}</span></span>
            {rt.source && (
              <span className="ml-auto rounded-full bg-surface-subtle px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-content-2">
                {rt.source}
              </span>
            )}
          </div>

          {/* Rate plans */}
          <div className="mt-4 space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-content-2">
              Rate Plans ({rt.rate_plans.length})
            </p>

            {rt.rate_plans.length === 0 ? (
              <p className="text-xs text-content-3 italic">No rate plans yet.</p>
            ) : (
              rt.rate_plans.map((rp: StoredRatePlan) => (
                <div
                  key={rp.rate_plan_id}
                  className="flex items-center justify-between rounded-xl bg-surface-subtle px-3 py-2 gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-content truncate">{rp.title}</p>
                    <p className="text-[11px] font-mono text-content-3 truncate">{rp.rate_plan_id}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {rp.is_primary && (
                      <span className="rounded-full bg-ok-bg px-2 py-0.5 text-[11px] font-semibold text-ok-text">
                        Primary
                      </span>
                    )}
                    <span className="rounded-full bg-surface-raised border border-edge px-2.5 py-1 text-xs font-semibold text-content">
                      {rp.currency} {rp.rate}
                    </span>
                    <span className="text-xs text-content-3">occ {rp.occupancy}</span>
                  </div>
                </div>
              ))
            )}

            {showRateForm === rt.room_type_id ? (
              <div className="flex items-center gap-2 rounded-xl border border-brand-light bg-brand-subtle px-3 py-2">
                <Input
                  value={newRateTitle}
                  onChange={(e) => setNewRateTitle(e.target.value)}
                  placeholder="Rate plan name"
                  className="flex-1 text-xs"
                />
                <Input
                  type="number"
                  min={0}
                  value={newRateAmount}
                  onChange={(e) => setNewRateAmount(Number(e.target.value))}
                  placeholder="Base rate"
                  className="w-20 text-xs"
                />
                <Button
                  type="button"
                  onClick={() => void handleAddRate(rt.room_type_id)}
                  disabled={savingRate || !newRateTitle}
                  variant="primary"
                  size="sm"
                >
                  {savingRate ? '…' : 'Add'}
                </Button>
                <button type="button" onClick={() => setShowRateForm(null)} className="text-content-3 hover:text-content-2">✕</button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { setShowRateForm(rt.room_type_id); setNewRateTitle(''); setNewRateAmount(100); }}
                className="text-xs text-brand hover:text-brand"
              >
                + Add rate plan
              </button>
            )}
          </div>
        </div>
      ))}

      {showRoomForm ? (
        <div className="rounded-2xl border border-brand-light bg-brand-subtle p-4 space-y-3">
          <p className="text-sm font-semibold text-content">New room type</p>
          <div className="flex items-center gap-3">
            <Input
              value={newRoomTitle}
              onChange={(e) => setNewRoomTitle(e.target.value)}
              placeholder="Room name"
              className="flex-1"
            />
            <Input
              type="number"
              min={1}
              value={newRoomOccupancy}
              onChange={(e) => setNewRoomOccupancy(Number(e.target.value))}
              className="w-24"
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={() => void handleAddRoom()}
              disabled={savingRoom || !newRoomTitle}
              variant="primary"
              size="sm"
            >
              {savingRoom ? 'Creating…' : 'Create Room Type'}
            </Button>
            <Button type="button" onClick={() => setShowRoomForm(false)} variant="ghost" size="sm">Cancel</Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowRoomForm(true)}
          className="rounded-xl border-2 border-dashed border-edge px-4 py-3 text-sm text-content-2 hover:border-brand-light hover:text-brand w-full"
        >
          + Add room type
        </button>
      )}
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import {
  listRoomTypes,
  createRoomType,
  createRatePlan,
  type StoredRoomType,
} from '../api/channexHubApi';

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
      setRoomTypes(data);
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

  const grouped = roomTypes.reduce<Record<string, StoredRoomType[]>>((acc, rt) => {
    const key = rt.room_type_id;
    if (!acc[key]) acc[key] = [];
    acc[key].push(rt);
    return acc;
  }, {});

  if (loading) return <p className="text-sm text-slate-500">Loading room types…</p>;

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {Object.entries(grouped).map(([roomTypeId, entries]) => (
        <div key={roomTypeId} className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-slate-900">{entries[0].title}</p>
              <p className="text-xs text-slate-500 font-mono">{roomTypeId}</p>
            </div>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
              Occupancy {entries[0].default_occupancy}
            </span>
          </div>

          <div className="mt-3 space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Rate Plans</p>
            {entries.map((rt) =>
              rt.rate_plan_id ? (
                <div key={rt.rate_plan_id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                  <span className="text-sm text-slate-700">{rt.title}</span>
                  <span className="font-mono text-xs text-slate-500">{rt.rate_plan_id}</span>
                </div>
              ) : null,
            )}

            {showRateForm === roomTypeId ? (
              <div className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2">
                <input
                  value={newRateTitle}
                  onChange={(e) => setNewRateTitle(e.target.value)}
                  placeholder="Rate plan name"
                  className="flex-1 rounded-lg border border-slate-200 px-2 py-1 text-xs"
                />
                <input
                  type="number"
                  min={0}
                  value={newRateAmount}
                  onChange={(e) => setNewRateAmount(Number(e.target.value))}
                  placeholder="Base rate"
                  className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-xs"
                />
                <button
                  type="button"
                  onClick={() => void handleAddRate(roomTypeId)}
                  disabled={savingRate || !newRateTitle}
                  className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {savingRate ? '…' : 'Add'}
                </button>
                <button type="button" onClick={() => setShowRateForm(null)} className="text-slate-400 hover:text-slate-600">✕</button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { setShowRateForm(roomTypeId); setNewRateTitle(''); setNewRateAmount(100); }}
                className="text-xs text-indigo-600 hover:text-indigo-800"
              >
                + Add rate plan
              </button>
            )}
          </div>
        </div>
      ))}

      {showRoomForm ? (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 space-y-3">
          <p className="text-sm font-semibold text-slate-900">New room type</p>
          <div className="flex items-center gap-3">
            <input
              value={newRoomTitle}
              onChange={(e) => setNewRoomTitle(e.target.value)}
              placeholder="Room name"
              className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
            <input
              type="number"
              min={1}
              value={newRoomOccupancy}
              onChange={(e) => setNewRoomOccupancy(Number(e.target.value))}
              className="w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleAddRoom()}
              disabled={savingRoom || !newRoomTitle}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {savingRoom ? 'Creating…' : 'Create Room Type'}
            </button>
            <button type="button" onClick={() => setShowRoomForm(false)} className="text-sm text-slate-500">Cancel</button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowRoomForm(true)}
          className="rounded-xl border-2 border-dashed border-slate-200 px-4 py-3 text-sm text-slate-500 hover:border-indigo-300 hover:text-indigo-600 w-full"
        >
          + Add room type
        </button>
      )}
    </div>
  );
}

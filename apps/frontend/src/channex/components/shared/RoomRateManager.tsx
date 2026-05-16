import { useCallback, useEffect, useState } from 'react';
import {
  listRoomTypes,
  createRoomType,
  updateRoomType,
  createRatePlan,
  type StoredRoomType,
  type StoredRatePlan,
} from '../../api/channexHubApi';
import Button from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';

interface Props {
  propertyId: string;
  currency: string;
}

interface RoomForm {
  title: string;
  countOfRooms: number;
  defaultOccupancy: number;
  occAdults: number;
  occChildren: number;
  occInfants: number;
}

function emptyRoomForm(): RoomForm {
  return { title: '', countOfRooms: 1, defaultOccupancy: 2, occAdults: 2, occChildren: 0, occInfants: 0 };
}

function roomFormFromExisting(rt: StoredRoomType): RoomForm {
  return {
    title: rt.title,
    countOfRooms: rt.count_of_rooms,
    defaultOccupancy: rt.default_occupancy,
    occAdults: rt.occ_adults,
    occChildren: rt.occ_children,
    occInfants: rt.occ_infants,
  };
}

function RoomFormFields({
  form,
  onChange,
}: {
  form: RoomForm;
  onChange: (f: RoomForm) => void;
}) {
  function set<K extends keyof RoomForm>(key: K, val: RoomForm[K]) {
    onChange({ ...form, [key]: val });
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-semibold text-content-2">Nombre</label>
        <Input
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="Ej. Suite Estándar"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-content-2">
            Unidades físicas
            <span className="ml-1 font-normal text-content-3">(count_of_rooms)</span>
          </label>
          <Input
            type="number"
            min={1}
            value={form.countOfRooms}
            onChange={(e) => set('countOfRooms', Math.max(1, parseInt(e.target.value) || 1))}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-content-2">
            Ocupación base
          </label>
          <Input
            type="number"
            min={1}
            value={form.defaultOccupancy}
            onChange={(e) => {
              const v = Math.max(1, parseInt(e.target.value) || 1);
              onChange({ ...form, defaultOccupancy: v, occAdults: Math.max(form.occAdults, v) });
            }}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-content-2">Adultos máx.</label>
          <Input
            type="number"
            min={1}
            value={form.occAdults}
            onChange={(e) => set('occAdults', Math.max(1, parseInt(e.target.value) || 1))}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-content-2">Niños máx.</label>
          <Input
            type="number"
            min={0}
            value={form.occChildren}
            onChange={(e) => set('occChildren', Math.max(0, parseInt(e.target.value) || 0))}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-content-2">Bebés máx.</label>
          <Input
            type="number"
            min={0}
            value={form.occInfants}
            onChange={(e) => set('occInfants', Math.max(0, parseInt(e.target.value) || 0))}
          />
        </div>
      </div>
    </div>
  );
}

export default function RoomRateManager({ propertyId, currency }: Props) {
  const [roomTypes, setRoomTypes] = useState<StoredRoomType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [showRoomForm, setShowRoomForm] = useState(false);
  const [newRoomForm, setNewRoomForm] = useState<RoomForm>(emptyRoomForm());
  const [savingRoom, setSavingRoom] = useState(false);

  // Edit form — keyed by room_type_id
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<RoomForm>(emptyRoomForm());
  const [savingEdit, setSavingEdit] = useState(false);

  // Rate plan form
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
    if (!newRoomForm.title) return;
    setSavingRoom(true);
    setError(null);
    try {
      await createRoomType(propertyId, {
        title: newRoomForm.title,
        countOfRooms: newRoomForm.countOfRooms,
        defaultOccupancy: newRoomForm.defaultOccupancy,
        occAdults: newRoomForm.occAdults,
        occChildren: newRoomForm.occChildren,
        occInfants: newRoomForm.occInfants,
      });
      setNewRoomForm(emptyRoomForm());
      setShowRoomForm(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create room type.');
    } finally {
      setSavingRoom(false);
    }
  }

  async function handleSaveEdit(roomTypeId: string) {
    setSavingEdit(true);
    setError(null);
    try {
      await updateRoomType(propertyId, roomTypeId, {
        title: editForm.title,
        countOfRooms: editForm.countOfRooms,
        defaultOccupancy: editForm.defaultOccupancy,
        occAdults: editForm.occAdults,
        occChildren: editForm.occChildren,
        occInfants: editForm.occInfants,
      });
      setEditingRoomId(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update room type.');
    } finally {
      setSavingEdit(false);
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
          {editingRoomId === rt.room_type_id ? (
            /* ── Edit mode ── */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-content">Editar room type</p>
                <button
                  type="button"
                  onClick={() => setEditingRoomId(null)}
                  className="text-content-3 hover:text-content-2 text-xs"
                >
                  ✕ Cancelar
                </button>
              </div>
              <RoomFormFields form={editForm} onChange={setEditForm} />
              <Button
                type="button"
                onClick={() => void handleSaveEdit(rt.room_type_id)}
                disabled={savingEdit || !editForm.title}
                variant="primary"
                size="sm"
              >
                {savingEdit ? 'Guardando…' : 'Guardar cambios'}
              </Button>
            </div>
          ) : (
            /* ── Read mode ── */
            <>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-semibold text-content">{rt.title}</p>
                  <p className="text-xs font-mono text-content-3 mt-0.5">{rt.room_type_id}</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex flex-wrap gap-1.5 justify-end">
                    <span className="rounded-full bg-surface-subtle px-2.5 py-1 text-xs font-medium text-content-2">
                      {rt.count_of_rooms} {rt.count_of_rooms !== 1 ? 'unidades' : 'unidad'}
                    </span>
                    <span className="rounded-full bg-brand-subtle px-2.5 py-1 text-xs font-medium text-brand">
                      Occ {rt.default_occupancy}
                    </span>
                  </div>
                  <button
                    type="button"
                    title="Editar"
                    onClick={() => { setEditingRoomId(rt.room_type_id); setEditForm(roomFormFromExisting(rt)); }}
                    className="rounded-lg border border-edge px-2 py-1 text-xs text-content-2 hover:border-brand-light hover:text-brand transition-colors"
                  >
                    ✎
                  </button>
                </div>
              </div>

              <div className="mt-2 flex gap-3 text-xs text-content-2">
                <span>Adultos: <span className="font-medium text-content">{rt.occ_adults}</span></span>
                <span>Niños: <span className="font-medium text-content">{rt.occ_children}</span></span>
                <span>Bebés: <span className="font-medium text-content">{rt.occ_infants}</span></span>
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
                  <p className="text-xs text-content-3 italic">Sin rate plans aún.</p>
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
                      placeholder="Nombre del rate plan"
                      className="flex-1 text-xs"
                    />
                    <Input
                      type="number"
                      min={0}
                      value={newRateAmount}
                      onChange={(e) => setNewRateAmount(Number(e.target.value))}
                      placeholder="Tarifa base"
                      className="w-24 text-xs"
                    />
                    <Button
                      type="button"
                      onClick={() => void handleAddRate(rt.room_type_id)}
                      disabled={savingRate || !newRateTitle}
                      variant="primary"
                      size="sm"
                    >
                      {savingRate ? '…' : 'Agregar'}
                    </Button>
                    <button type="button" onClick={() => setShowRateForm(null)} className="text-content-3 hover:text-content-2">✕</button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setShowRateForm(rt.room_type_id); setNewRateTitle(''); setNewRateAmount(100); }}
                    className="text-xs text-brand hover:text-brand"
                  >
                    + Agregar rate plan
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      ))}

      {/* Create form */}
      {showRoomForm ? (
        <div className="rounded-2xl border border-brand-light bg-brand-subtle p-4 space-y-4">
          <p className="text-sm font-semibold text-content">Nuevo room type</p>
          <RoomFormFields form={newRoomForm} onChange={setNewRoomForm} />
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={() => void handleAddRoom()}
              disabled={savingRoom || !newRoomForm.title}
              variant="primary"
              size="sm"
            >
              {savingRoom ? 'Creando…' : 'Crear Room Type'}
            </Button>
            <Button type="button" onClick={() => { setShowRoomForm(false); setNewRoomForm(emptyRoomForm()); }} variant="ghost" size="sm">
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowRoomForm(true)}
          className="rounded-xl border-2 border-dashed border-edge px-4 py-3 text-sm text-content-2 hover:border-brand-light hover:text-brand w-full"
        >
          + Agregar room type
        </button>
      )}
    </div>
  );
}

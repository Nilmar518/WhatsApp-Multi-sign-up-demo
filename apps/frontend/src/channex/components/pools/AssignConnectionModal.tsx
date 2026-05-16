import { useState } from 'react';
import Button from '../../../components/ui/Button';
import { Input, Select } from '../../../components/ui/Input';
import { useChannexProperties } from '../../hooks/useChannexProperties';
import { assignConnection, type MigoProperty, type PlatformConnection } from '../../api/migoPropertyApi';

interface Props {
  migoPropertyId: string;
  tenantId: string;
  existingConnections: PlatformConnection[];
  onAssigned: (updated: MigoProperty) => void;
  onClose: () => void;
}

export default function AssignConnectionModal({
  migoPropertyId,
  tenantId,
  existingConnections,
  onAssigned,
  onClose,
}: Props) {
  const { properties, loading: propsLoading } = useChannexProperties(tenantId);
  const [selectedChannexId, setSelectedChannexId] = useState('');
  const [platform, setPlatform] = useState('airbnb');
  const [listingTitle, setListingTitle] = useState('');
  const [isSyncEnabled, setIsSyncEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connectedIds = new Set(existingConnections.map((c) => c.channex_property_id));
  const available = properties.filter((p) => !connectedIds.has(p.channex_property_id));

  const selectedProp = selectedChannexId
    ? properties.find((p) => p.channex_property_id === selectedChannexId)
    : null;

  const selectedRoomCount = selectedProp
    ? selectedProp.room_types.reduce((sum, rt) => sum + (rt.count_of_rooms ?? 0), 0)
    : null;

  const hasNoRooms = selectedRoomCount !== null && selectedRoomCount === 0;

  function handlePropertySelect(channexId: string) {
    setSelectedChannexId(channexId);
    const prop = properties.find((p) => p.channex_property_id === channexId);
    if (prop) {
      setListingTitle(prop.title);
      if (prop.connected_channels.length > 0) {
        setPlatform(prop.connected_channels[0]);
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedChannexId || !listingTitle.trim()) {
      setError('Select a property and enter a listing title.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await assignConnection(migoPropertyId, {
        channexPropertyId: selectedChannexId,
        platform,
        listingTitle: listingTitle.trim(),
        isSyncEnabled,
      });
      onAssigned(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign connection');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl border border-edge bg-surface-raised px-6 py-6 shadow-xl">
        <h3 className="mb-5 text-base font-semibold text-content">Assign Platform Connection</h3>

        {propsLoading ? (
          <p className="text-sm text-content-2">Loading properties…</p>
        ) : available.length === 0 ? (
          <p className="text-sm text-content-2">
            All registered Channex properties are already connected.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-content-2">
                Channex Property
              </label>
              <Select
                value={selectedChannexId}
                onChange={(e) => handlePropertySelect(e.target.value)}
                required
              >
                <option value="">Select a property…</option>
                {available.map((p) => (
                  <option key={p.channex_property_id} value={p.channex_property_id}>
                    {p.title}
                  </option>
                ))}
              </Select>
            </div>

            {selectedChannexId && selectedRoomCount !== null && (
              <div className={`rounded-lg px-3 py-2 text-sm ${
                hasNoRooms
                  ? 'bg-danger-bg text-danger-text'
                  : 'bg-ok-bg text-ok-text'
              }`}>
                {hasNoRooms ? (
                  <>
                    <strong>No rooms configured.</strong> Go to Properties → Rooms &amp; Rates and
                    set the room count for this property before adding it to a pool.
                  </>
                ) : (
                  <>
                    This connection will add <strong>{selectedRoomCount} room{selectedRoomCount !== 1 ? 's' : ''}</strong> to the pool capacity.
                  </>
                )}
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-content-2">
                Platform
              </label>
              <Select value={platform} onChange={(e) => setPlatform(e.target.value)}>
                <option value="airbnb">Airbnb</option>
                <option value="booking">Booking.com</option>
              </Select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-content-2">
                OTA Listing Title
              </label>
              <Input
                value={listingTitle}
                onChange={(e) => setListingTitle(e.target.value)}
                placeholder="e.g. Studio Full ventana grande"
                required
              />
            </div>

            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={isSyncEnabled}
                onChange={(e) => setIsSyncEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-edge accent-brand"
              />
              <span className="text-sm text-content">Sync enabled (include in ARI fan-out)</span>
            </label>

            {error && <p className="text-sm text-danger-text">{error}</p>}

            <div className="flex gap-3 pt-2">
              <Button type="submit" variant="primary" size="sm" disabled={saving || hasNoRooms}>
                {saving ? 'Assigning…' : 'Assign'}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

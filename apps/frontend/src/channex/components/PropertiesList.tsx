import type { ChannexProperty } from '../hooks/useChannexProperties';

interface Props {
  properties: ChannexProperty[];
  onSelect: (p: ChannexProperty) => void;
  onNew: () => void;
}

export default function PropertiesList({ properties, onSelect, onNew }: Props) {
  return (
    <div>
      <button type="button" onClick={onNew} className="mb-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">
        + New Property
      </button>
      {properties.length === 0 && <p className="text-sm text-gray-500">No properties yet.</p>}
      {properties.map((p) => (
        <button key={p.firestoreDocId} type="button" onClick={() => onSelect(p)} className="block w-full text-left rounded-xl border px-4 py-3 mb-2 hover:bg-gray-50">
          {p.title}
        </button>
      ))}
    </div>
  );
}

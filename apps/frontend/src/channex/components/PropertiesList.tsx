import type { ChannexProperty } from '../hooks/useChannexProperties';
import Button from '../../components/ui/Button';
import PropertyCard from './shared/PropertyCard';

interface Props {
  properties: ChannexProperty[];
  onSelect: (property: ChannexProperty) => void;
  onNew: () => void;
}

export default function PropertiesList({ properties, onSelect, onNew }: Props) {
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-content">Properties</h2>
          <p className="text-sm text-content-2">
            Manage Channex properties, room types, rate plans, and ARI.
          </p>
        </div>
        <Button type="button" onClick={onNew} variant="primary" size="sm">
          + New Property
        </Button>
      </div>

      {properties.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-edge px-8 py-12 text-center">
          <p className="text-sm font-medium text-content">No properties yet</p>
          <p className="mt-1 text-sm text-content-2">
            Create a property to start managing ARI and connecting OTA channels.
          </p>
          <Button type="button" onClick={onNew} variant="primary" size="sm" className="mt-4">
            Create first property
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {properties.map((property) => (
            <PropertyCard
              key={property.firestoreDocId}
              property={property}
              onClick={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

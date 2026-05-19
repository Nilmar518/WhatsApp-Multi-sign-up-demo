import type { ChannexProperty } from '../hooks/useChannexProperties';
import Button from '../../components/ui/Button';
import PropertyCard from './shared/PropertyCard';
import { useLanguage } from '../../context/LanguageContext';

interface Props {
  properties: ChannexProperty[];
  onSelect: (property: ChannexProperty) => void;
  onNew: () => void;
}

export default function PropertiesList({ properties, onSelect, onNew }: Props) {
  const { t } = useLanguage();
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-content">{t('channex.props.title')}</h2>
          <p className="text-sm text-content-2">{t('channex.props.desc')}</p>
        </div>
        <Button type="button" onClick={onNew} variant="primary" size="sm">
          {t('channex.props.new')}
        </Button>
      </div>

      {properties.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-edge px-8 py-12 text-center">
          <p className="text-sm font-medium text-content">{t('channex.props.empty.title')}</p>
          <p className="mt-1 text-sm text-content-2">{t('channex.props.empty.desc')}</p>
          <Button type="button" onClick={onNew} variant="primary" size="sm" className="mt-4">
            {t('channex.props.empty.action')}
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

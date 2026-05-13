import { useLanguage } from '../../context/LanguageContext';

interface Props {
  businessIds: readonly string[];
  selected: string;
  onChange: (id: string) => void;
}

export default function BusinessToggle({ businessIds, selected, onChange }: Props) {
  const { t } = useLanguage();
  const labels = [t('toggle.number1'), t('toggle.number2')];
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="text-xs text-content-3 font-medium">{t('toggle.label')}</span>
      <div className="flex gap-1 bg-surface-subtle rounded-lg p-1 border border-edge">
        {businessIds.map((id, i) => (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={[
              'px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-150',
              selected === id
                ? 'bg-surface-raised text-content shadow-sm border border-edge'
                : 'text-content-3 hover:text-content-2',
            ].join(' ')}
          >
            {labels[i] ?? id}
          </button>
        ))}
      </div>
    </div>
  );
}

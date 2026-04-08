interface Props {
  businessIds: readonly string[];
  selected: string;
  onChange: (id: string) => void;
}

const LABELS: Record<string, string> = {
  '787167007221172': 'Number 1',
  'demo-business-002': 'Number 2',
};

export default function BusinessToggle({ businessIds, selected, onChange }: Props) {
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="text-xs text-gray-400">Integration</span>
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {businessIds.map((id) => (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={[
              'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
              selected === id
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-400 hover:text-gray-600',
            ].join(' ')}
          >
            {LABELS[id] ?? id}
          </button>
        ))}
      </div>
    </div>
  );
}

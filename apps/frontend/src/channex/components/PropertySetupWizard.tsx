import type { ChannexProperty } from '../hooks/useChannexProperties';

interface Props {
  tenantId: string;
  onComplete: (prop: ChannexProperty) => void;
  onCancel: () => void;
}

export default function PropertySetupWizard({ onCancel }: Props) {
  return (
    <div>
      <p className="text-sm text-gray-500">Wizard — coming in Task 7</p>
      <button type="button" onClick={onCancel} className="mt-4 text-sm text-gray-500">Cancel</button>
    </div>
  );
}

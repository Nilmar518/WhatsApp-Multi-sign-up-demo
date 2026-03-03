import type { IntegrationStatus } from '../../types/integration';

interface StatusConfig {
  label: string;
  textColor: string;
  dotClass: string;
}

const STATUS_CONFIG: Record<IntegrationStatus, StatusConfig> = {
  IDLE: {
    label: 'Not Connected',
    textColor: 'text-gray-500',
    dotClass: 'bg-gray-400',
  },
  CONNECTING: {
    label: 'Connecting...',
    textColor: 'text-yellow-600',
    dotClass: 'bg-yellow-400 animate-pulse',
  },
  PENDING_TOKEN: {
    label: 'Awaiting Token...',
    textColor: 'text-blue-600',
    dotClass: 'bg-blue-400 animate-pulse',
  },
  ACTIVE: {
    label: 'Connected',
    textColor: 'text-green-600',
    dotClass: 'bg-green-500',
  },
  ERROR: {
    label: 'Connection Error',
    textColor: 'text-red-600',
    dotClass: 'bg-red-500',
  },
  MIGRATING: {
    label: 'Migrating...',
    textColor: 'text-purple-600',
    dotClass: 'bg-purple-400 animate-pulse',
  },
};

interface Props {
  status: IntegrationStatus;
  isLoading: boolean;
}

export default function StatusDisplay({ status, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded-full bg-gray-300 animate-pulse" />
        <span className="text-sm text-gray-400">Loading status...</span>
      </div>
    );
  }

  const { label, textColor, dotClass } = STATUS_CONFIG[status];

  return (
    <div className="flex items-center gap-2">
      <div className={`w-3 h-3 rounded-full ${dotClass}`} />
      <span className={`text-sm font-medium ${textColor}`}>{label}</span>
    </div>
  );
}

// apps/frontend/src/channex/components/connection/NoPropertyGuide.tsx

import { useLanguage } from '../../../context/LanguageContext';

interface Props {
  channel: 'airbnb' | 'booking';
  onNavigateToProperties: () => void;
}

const CHANNEL_LABELS: Record<Props['channel'], string> = {
  airbnb: 'Airbnb',
  booking: 'Booking.com',
};

export default function NoPropertyGuide({ channel, onNavigateToProperties }: Props) {
  const { t } = useLanguage();

  const syncAction = t(
    channel === 'airbnb'
      ? 'channex.noPropGuide.syncAction.airbnb'
      : 'channex.noPropGuide.syncAction.booking',
  );

  const steps = [
    {
      title: t('channex.noPropGuide.step1.title'),
      description: t('channex.noPropGuide.step1.desc'),
      action: (
        <button
          type="button"
          onClick={onNavigateToProperties}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          {t('channex.noPropGuide.step1.btn')}
        </button>
      ),
    },
    {
      title: t('channex.noPropGuide.step2.title', { channel: CHANNEL_LABELS[channel] }),
      description: t('channex.noPropGuide.step2.desc'),
      action: null,
    },
    {
      title: t('channex.noPropGuide.step3.title'),
      description: t('channex.noPropGuide.step3.desc', { action: syncAction }),
      action: null,
    },
  ];

  return (
    <div className="space-y-3">
      <p className="mb-4 text-sm text-content-2">
        {t('channex.noPropGuide.intro')}
      </p>
      {steps.map((step, index) => (
        <div
          key={step.title}
          className="flex items-start gap-4 rounded-xl border border-edge bg-surface-raised px-4 py-4"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
            {index + 1}
          </div>
          <div>
            <p className="text-sm font-semibold text-content">{step.title}</p>
            <p className="mt-0.5 text-sm text-content-2">{step.description}</p>
            {step.action}
          </div>
        </div>
      ))}
    </div>
  );
}

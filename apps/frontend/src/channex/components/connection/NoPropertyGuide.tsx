// apps/frontend/src/channex/components/connection/NoPropertyGuide.tsx

interface Props {
  channel: 'airbnb' | 'booking';
  onNavigateToProperties: () => void;
}

const CHANNEL_LABELS: Record<Props['channel'], string> = {
  airbnb: 'Airbnb',
  booking: 'Booking.com',
};

const SYNC_LABELS: Record<Props['channel'], string> = {
  airbnb: 'Sync Listings',
  booking: 'Sync Rooms & Rates',
};

export default function NoPropertyGuide({ channel, onNavigateToProperties }: Props) {
  const steps = [
    {
      title: 'Crea tu primera propiedad',
      description:
        'Ve a la pestaña Properties y completa el asistente de configuración para registrar tu propiedad en Channex.',
      action: (
        <button
          type="button"
          onClick={onNavigateToProperties}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          → Ir a Properties
        </button>
      ),
    },
    {
      title: `Conecta tu cuenta de ${CHANNEL_LABELS[channel]}`,
      description:
        'Regresa a esta pestaña y autoriza el acceso desde el panel de conexión que aparecerá aquí.',
      action: null,
    },
    {
      title: 'Sincroniza tus propiedades',
      description: `Una vez conectado, usa el botón "${SYNC_LABELS[channel]}" para importar tus propiedades.`,
      action: null,
    },
  ];

  return (
    <div className="space-y-3">
      <p className="mb-4 text-sm text-content-2">
        Todavía no tienes una propiedad en Channex. Sigue estos pasos para comenzar:
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

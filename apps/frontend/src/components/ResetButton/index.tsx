import { useState } from 'react';
import Button from '../ui/Button';

interface Props {
  businessId: string;
}

export default function DisconnectButton({ businessId }: Props) {
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDisconnect = async () => {
    const confirmed = window.confirm(
      '¿Desconectar cuenta de WhatsApp?\n\n' +
      'Se eliminarán las credenciales de esta integración. ' +
      'El historial de mensajes se conservará. ' +
      'Podrás volver a conectar en cualquier momento.',
    );
    if (!confirmed) return;

    setIsDisconnecting(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/integrations/${encodeURIComponent(businessId)}/disconnect`,
        { method: 'POST' },
      );

      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? `Error ${res.status}`);
      }

      // State resets automatically — useIntegrationStatus onSnapshot fires when
      // Firestore status becomes 'IDLE', hiding this panel without a page reload.
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo desconectar');
      setIsDisconnecting(false);
    }
  };

  return (
    <div className="border-t border-edge pt-4 space-y-2">
      <div className="flex justify-center">
        <Button
          variant="danger"
          size="sm"
          onClick={() => void handleDisconnect()}
          disabled={isDisconnecting}
        >
          {isDisconnecting ? (
            <>
              <span className="w-3 h-3 rounded-full border-2 border-danger/30 border-t-danger-text animate-spin" />
              Desconectando…
            </>
          ) : (
            'Desconectar cuenta de WhatsApp'
          )}
        </Button>
      </div>

      {error && (
        <p className="text-xs text-red-500 text-center">{error}</p>
      )}
    </div>
  );
}

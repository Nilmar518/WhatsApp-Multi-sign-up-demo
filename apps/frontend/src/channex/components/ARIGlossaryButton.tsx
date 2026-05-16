import { useState } from 'react';

const TERMS = [
  {
    abbr: 'ARI',
    full: 'Availability, Rates & Inventory',
    desc: 'Conjunto de datos de disponibilidad, tarifas y restricciones que se sincroniza con las OTAs.',
  },
  {
    abbr: 'SS',
    full: 'Stop Sell',
    desc: 'Bloquea toda venta en esa fecha sin importar la disponibilidad real.',
  },
  {
    abbr: 'CTA',
    full: 'Closed to Arrival',
    desc: 'No se aceptan nuevas llegadas en esa fecha.',
  },
  {
    abbr: 'CTD',
    full: 'Closed to Departure',
    desc: 'No se aceptan salidas en esa fecha.',
  },
  {
    abbr: 'Min Stay',
    full: 'Minimum Stay on Arrival',
    desc: 'Noches mínimas requeridas si el huésped llega ese día.',
  },
  {
    abbr: 'Max Stay',
    full: 'Maximum Stay',
    desc: 'Noches máximas de estancia permitidas.',
  },
];

interface Props {
  className?: string;
}

export default function ARIGlossaryButton({ className }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Guía de términos ARI"
        className={`rounded-xl border border-edge bg-surface-raised px-2.5 py-1.5 text-xs font-semibold text-content-2 hover:bg-surface-subtle ${className ?? ''}`}
      >
        ℹ
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-surface-raised p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-bold text-content">Guía de términos ARI</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-content-3 hover:text-content-2 text-lg leading-none"
              >
                ✕
              </button>
            </div>

            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-edge">
                  <th className="pb-2 text-left font-semibold text-content-2 w-16">Término</th>
                  <th className="pb-2 text-left font-semibold text-content-2 w-36">Nombre completo</th>
                  <th className="pb-2 text-left font-semibold text-content-2">Descripción</th>
                </tr>
              </thead>
              <tbody>
                {TERMS.map((t) => (
                  <tr key={t.abbr} className="border-b border-edge last:border-0">
                    <td className="py-2 font-bold text-content">{t.abbr}</td>
                    <td className="py-2 text-content-2">{t.full}</td>
                    <td className="py-2 text-content-3">{t.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

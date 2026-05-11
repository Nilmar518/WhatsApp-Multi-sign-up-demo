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
        className={`rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50 ${className ?? ''}`}
      >
        ℹ
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">Guía de términos ARI</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-lg leading-none"
              >
                ✕
              </button>
            </div>

            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="pb-2 text-left font-semibold text-slate-500 w-16">Término</th>
                  <th className="pb-2 text-left font-semibold text-slate-500 w-36">Nombre completo</th>
                  <th className="pb-2 text-left font-semibold text-slate-500">Descripción</th>
                </tr>
              </thead>
              <tbody>
                {TERMS.map((t) => (
                  <tr key={t.abbr} className="border-b border-slate-50 last:border-0">
                    <td className="py-2 font-bold text-slate-800">{t.abbr}</td>
                    <td className="py-2 text-slate-600">{t.full}</td>
                    <td className="py-2 text-slate-500">{t.desc}</td>
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

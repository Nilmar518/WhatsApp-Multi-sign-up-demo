import { useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';

interface Props {
  className?: string;
}

export default function ARIGlossaryButton({ className }: Props) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  const TERMS = [
    {
      abbr:  t('channex.glossary.ari.term'),
      name:  t('channex.glossary.ari.name'),
      full:  t('channex.glossary.ari.full'),
      desc:  t('channex.glossary.ari.desc'),
      when:  t('channex.glossary.ari.when'),
      color: 'bg-surface-subtle text-content-2',
    },
    {
      abbr:  t('channex.glossary.ss.term'),
      name:  t('channex.glossary.ss.name'),
      full:  t('channex.glossary.ss.full'),
      desc:  t('channex.glossary.ss.desc'),
      when:  t('channex.glossary.ss.when'),
      color: 'bg-danger-bg text-danger-text',
    },
    {
      abbr:  t('channex.glossary.cta.term'),
      name:  t('channex.glossary.cta.name'),
      full:  t('channex.glossary.cta.full'),
      desc:  t('channex.glossary.cta.desc'),
      when:  t('channex.glossary.cta.when'),
      color: 'bg-caution-bg text-caution-text',
    },
    {
      abbr:  t('channex.glossary.ctd.term'),
      name:  t('channex.glossary.ctd.name'),
      full:  t('channex.glossary.ctd.full'),
      desc:  t('channex.glossary.ctd.desc'),
      when:  t('channex.glossary.ctd.when'),
      color: 'bg-caution-bg text-caution-text',
    },
    {
      abbr:  t('channex.glossary.minStay.term'),
      name:  t('channex.glossary.minStay.name'),
      full:  t('channex.glossary.minStay.full'),
      desc:  t('channex.glossary.minStay.desc'),
      when:  t('channex.glossary.minStay.when'),
      color: 'bg-surface-subtle text-content-2',
    },
    {
      abbr:  t('channex.glossary.maxStay.term'),
      name:  t('channex.glossary.maxStay.name'),
      full:  t('channex.glossary.maxStay.full'),
      desc:  t('channex.glossary.maxStay.desc'),
      when:  t('channex.glossary.maxStay.when'),
      color: 'bg-surface-subtle text-content-2',
    },
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t('channex.glossary.btn')}
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
            className="w-full max-w-md rounded-2xl bg-surface-raised p-6 shadow-xl overflow-y-auto max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-bold text-content">{t('channex.glossary.title')}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-content-3 hover:text-content-2 text-lg leading-none"
              >
                ✕
              </button>
            </div>

            <ul className="space-y-3">
              {TERMS.map((term) => (
                <li key={term.abbr} className="rounded-xl border border-edge bg-surface-subtle p-3">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${term.color}`}>
                      {term.abbr}
                    </span>
                    <span className="text-xs font-semibold text-content">{term.name}</span>
                  </div>
                  <p className="text-[10px] text-content-3 mb-2">{term.full}</p>
                  <p className="text-xs text-content-2 mb-1.5">{term.desc}</p>
                  <p className="text-xs text-content-3">
                    <span className="font-semibold text-content-2">{t('channex.glossary.col.when')}: </span>
                    {term.when}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

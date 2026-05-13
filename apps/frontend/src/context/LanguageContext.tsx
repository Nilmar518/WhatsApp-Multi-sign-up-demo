import { createContext, useContext, useState } from 'react';
import { es } from '../i18n/es';
import { en } from '../i18n/en';
import type { TranslationKey } from '../i18n/es';

type Lang = 'es' | 'en';

const LS_KEY = 'app_lang';

const locales = { es, en };

interface LanguageContextValue {
  lang: Lang;
  toggleLanguage: () => void;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: 'es',
  toggleLanguage: () => undefined,
  t: (key) => key,
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    const stored = localStorage.getItem(LS_KEY);
    return stored === 'en' ? 'en' : 'es';
  });

  const toggleLanguage = () => {
    setLang((l) => {
      const next = l === 'es' ? 'en' : 'es';
      localStorage.setItem(LS_KEY, next);
      return next;
    });
  };

  const t = (key: TranslationKey): string => locales[lang][key] ?? key;

  return (
    <LanguageContext.Provider value={{ lang, toggleLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export const useLanguage = () => useContext(LanguageContext);

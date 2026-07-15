import { useState, useEffect } from 'react';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase/firebase';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { navigate } from '../lib/navigate';
import {
  CalendarDays,
  Hotel, Globe, Moon, Sun, LogOut,
  Home, Languages, ChevronUp, MoreHorizontal,
  Settings, FileText,
} from 'lucide-react';

interface TabProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

function Tab({ icon, label, active, onClick }: TabProps) {
  return (
    <button
      onClick={onClick}
      className={[
        'relative flex flex-col items-center justify-center gap-0.5',
        'w-full h-full px-2 py-2',
        'transition-colors duration-150 select-none',
        active ? 'text-brand' : 'text-content-sidebar hover:text-content-inv',
      ].join(' ')}
    >
      {active && (
        <span className="absolute top-0 left-1/2 -translate-x-1/2 w-5 h-0.5 bg-brand rounded-full" />
      )}
      <span className="shrink-0">{icon}</span>
      <span className="text-[9px] font-semibold tracking-tight truncate max-w-[60px]">
        {label}
      </span>
    </button>
  );
}

export default function BottomNav() {
  const { theme, toggleTheme } = useTheme();
  const { lang, toggleLanguage, t } = useLanguage();

  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const [expandedMenu, setExpandedMenu] = useState<'channex' | 'more' | null>(null);

  useEffect(() => {
    const onPop = () => {
      setCurrentPath(window.location.pathname);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    if (!currentPath.startsWith('/channex')) {
      setExpandedMenu((prev) => prev === 'channex' ? null : prev);
    }
  }, [currentPath]);

  const channexIsActive = currentPath.startsWith('/channex');
  const moreIsActive =
    currentPath.startsWith('/configuracion') ||
    currentPath.startsWith('/documentos');

  const handleChannexTap = () => {
    if (expandedMenu === 'channex') {
      navigate('/channex');
      setExpandedMenu(null);
    } else {
      setExpandedMenu('channex');
    }
  };

  const handleMoreTap = () => {
    setExpandedMenu(expandedMenu === 'more' ? null : 'more');
  };

  const handleSubNav = (href: string) => {
    navigate(href);
    setExpandedMenu(null);
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  return (
    <>
      {/* Channex sub-menu */}
      <div
        className={[
          'fixed bottom-16 left-0 right-0 z-[30] md:hidden',
          'bg-surface-sidebar border-t border-white/10 shadow-[0_-4px_16px_rgba(0,0,0,0.3)]',
          'transition-all duration-200',
          expandedMenu === 'channex'
            ? 'opacity-100 pointer-events-auto translate-y-0'
            : 'opacity-0 pointer-events-none translate-y-2',
        ].join(' ')}
      >
        <div className="flex items-center gap-2 px-4 py-3">
          <span className="text-content-sidebar-muted text-[9px] font-bold uppercase tracking-widest mr-1 shrink-0">
            Channex
          </span>
          <button
            onClick={() => handleSubNav('/channex/airbnb')}
            className={[
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors duration-150 shrink-0',
              currentPath === '/channex/airbnb'
                ? 'bg-brand text-white shadow-brand'
                : 'bg-white/5 text-content-sidebar hover:bg-brand/20 hover:text-brand',
            ].join(' ')}
          >
            <Home size={12} />
            <span>{t('nav.airbnb')}</span>
          </button>
          <button
            onClick={() => handleSubNav('/channex/booking')}
            className={[
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors duration-150 shrink-0',
              currentPath === '/channex/booking'
                ? 'bg-brand text-white shadow-brand'
                : 'bg-white/5 text-content-sidebar hover:bg-brand/20 hover:text-brand',
            ].join(' ')}
          >
            <Globe size={12} />
            <span>{t('nav.booking')}</span>
          </button>
        </div>
      </div>

      {/* More sub-menu — stacked list */}
      <div
        className={[
          'fixed bottom-16 left-0 right-0 z-[30] md:hidden',
          'bg-surface-sidebar border-t border-white/10 shadow-[0_-4px_16px_rgba(0,0,0,0.3)]',
          'transition-all duration-200',
          expandedMenu === 'more'
            ? 'opacity-100 pointer-events-auto translate-y-0'
            : 'opacity-0 pointer-events-none translate-y-2',
        ].join(' ')}
      >
        <div className="flex flex-col py-1">
          <button
            onClick={() => handleSubNav('/documentos')}
            className={[
              'flex items-center gap-3 px-5 py-3 text-sm font-medium transition-colors',
              currentPath.startsWith('/documentos')
                ? 'text-brand bg-white/5'
                : 'text-content-sidebar hover:bg-white/5',
            ].join(' ')}
          >
            <FileText size={16} />
            Documentos
          </button>
          <button
            onClick={() => handleSubNav('/configuracion')}
            className={[
              'flex items-center gap-3 px-5 py-3 text-sm font-medium transition-colors',
              currentPath.startsWith('/configuracion')
                ? 'text-brand bg-white/5'
                : 'text-content-sidebar hover:bg-white/5',
            ].join(' ')}
          >
            <Settings size={16} />
            {t('nav.settings')}
          </button>
          <button
            onClick={() => { toggleTheme(); }}
            className="flex items-center gap-3 px-5 py-3 text-sm font-medium text-content-sidebar hover:bg-white/5 transition-colors"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            {theme === 'dark' ? t('nav.lightMode') : t('nav.darkMode')}
          </button>
          <button
            onClick={() => { toggleLanguage(); }}
            className="flex items-center gap-3 px-5 py-3 text-sm font-medium text-content-sidebar hover:bg-white/5 transition-colors"
          >
            <Languages size={16} />
            {lang === 'es' ? 'English' : 'Español'}
          </button>
          <div className="mx-4 my-1 border-t border-white/10" />
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-5 py-3 text-sm font-medium text-danger hover:bg-white/5 transition-colors"
          >
            <LogOut size={16} />
            {t('nav.logout')}
          </button>
        </div>
      </div>

      {/* Bottom navigation bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-[35] h-16 bg-surface-sidebar border-t border-white/10 md:hidden shadow-[0_-2px_8px_rgba(0,0,0,0.2)]">
        <div className="grid grid-cols-3 h-full w-full">
          <Tab
            icon={<CalendarDays size={17} />}
            label={t('nav.dashboard')}
            active={currentPath === '/'}
            onClick={() => { navigate('/'); setExpandedMenu(null); }}
          />

          {/* Channex — expandable */}
          <Tab
            icon={
              <span className="relative inline-flex items-center justify-center">
                <Hotel size={17} />
                {expandedMenu === 'channex' && (
                  <ChevronUp size={9} className="absolute -top-2 -right-2.5 text-brand" />
                )}
              </span>
            }
            label={t('nav.channex')}
            active={channexIsActive || expandedMenu === 'channex'}
            onClick={handleChannexTap}
          />

          {/* More — expandable */}
          <Tab
            icon={
              <span className="relative inline-flex items-center justify-center">
                <MoreHorizontal size={17} />
                {expandedMenu === 'more' && (
                  <ChevronUp size={9} className="absolute -top-2 -right-2.5 text-brand" />
                )}
              </span>
            }
            label="Más"
            active={moreIsActive || expandedMenu === 'more'}
            onClick={handleMoreTap}
          />
        </div>
      </nav>
    </>
  );
}

import { useState, useEffect } from 'react';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase/firebase';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import {
  LayoutDashboard, MessageSquare, Package, Smartphone,
  Hotel, Globe, Settings, Moon, Sun, User, LogOut,
  ChevronLeft, ChevronRight, MessageCircle, Camera, Home, Languages,
} from 'lucide-react';

const LS_KEY = 'sidenav_collapsed';

import { navigate } from '../lib/navigate';
export { navigate };

interface NavItem {
  icon: React.ReactNode;
  label: string;
  href: string;
}

function computeActive(href: string, path: string): boolean {
  if (href === '/') return path === '/';
  // strip query from href for prefix matching
  const hrefPath = href.split('?')[0];
  return path === hrefPath || path.startsWith(hrefPath + '/');
}

function NavRow({ icon, label, href, collapsed, activeOverride, currentPath }: NavItem & { collapsed: boolean; activeOverride?: boolean; currentPath: string }) {
  const active = activeOverride !== undefined ? activeOverride : computeActive(href, currentPath);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(href)}
      onKeyDown={(e) => e.key === 'Enter' && navigate(href)}
      className={[
        'flex items-center gap-2.5 px-2.5 py-2 rounded-md cursor-pointer',
        'text-content-sidebar text-sm font-medium transition-colors duration-150',
        'hover:bg-surface-sidebar-hover hover:text-content-inv',
        active
          ? 'bg-surface-sidebar-act text-content-inv border-l-2 border-brand'
          : 'border-l-2 border-transparent',
      ].join(' ')}
      title={collapsed ? label : undefined}
    >
      <span className="shrink-0">{icon}</span>
      {!collapsed && <span className="truncate">{label}</span>}
    </div>
  );
}

function SubNavRow({ icon, label, href, collapsed, currentPath }: NavItem & { collapsed: boolean; currentPath: string }) {
  const active = computeActive(href, currentPath);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(href)}
      onKeyDown={(e) => e.key === 'Enter' && navigate(href)}
      className={[
        'flex items-center gap-2 py-1.5 rounded-md cursor-pointer transition-colors duration-150',
        collapsed ? 'px-2.5 justify-center' : 'pl-8 pr-2.5',
        active
          ? 'text-brand bg-brand-subtle/10'
          : 'text-content-sidebar-muted hover:text-content-sidebar hover:bg-surface-sidebar-hover/60',
      ].join(' ')}
      title={collapsed ? label : undefined}
    >
      <span className="shrink-0">{icon}</span>
      {!collapsed && <span className="truncate text-xs font-medium">{label}</span>}
    </div>
  );
}


export default function SideNav() {
  const [collapsed, setCollapsed] = useState<boolean>(
    () => localStorage.getItem(LS_KEY) === 'true',
  );
  const { theme, toggleTheme } = useTheme();
  const { lang, toggleLanguage, t } = useLanguage();

  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const [currentSearch, setCurrentSearch] = useState(window.location.search);

  useEffect(() => {
    const onPop = () => {
      setCurrentPath(window.location.pathname);
      setCurrentSearch(window.location.search);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    localStorage.setItem(LS_KEY, String(collapsed));
  }, [collapsed]);

  const handleLogout = async () => {
    await signOut(auth);
  };

  const channelParam = new URLSearchParams(currentSearch).get('channel');
  const channexOpen = currentPath.startsWith('/channex');

  const isChannelActive = (channel: string) =>
    currentPath.startsWith('/mensajes') && currentSearch.includes(`channel=${channel}`);

  return (
    <nav
      className={[
        'flex flex-col bg-surface-sidebar border-r border-edge/10',
        'sticky top-0 h-screen overflow-y-auto transition-all duration-200',
        collapsed ? 'w-14' : 'w-56',
      ].join(' ')}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-3 py-4 border-b border-white/5">
        <div className="w-8 h-8 rounded-md bg-brand flex items-center justify-center shrink-0 shadow-brand">
          <Smartphone size={16} className="text-white" />
        </div>
        {!collapsed && (
          <span className="text-content-inv font-bold text-sm tracking-tight">
            Migo<span className="text-brand-dim">App</span>
          </span>
        )}
      </div>

      {/* Nav items */}
      <div className="flex-1 flex flex-col gap-0.5 p-2 mt-1">
        {!collapsed && (
          <p className="text-content-sidebar-muted text-[10px] font-semibold uppercase tracking-widest px-2.5 py-2">
            {t('nav.principal')}
          </p>
        )}
        <NavRow icon={<LayoutDashboard size={16} />} label={t('nav.dashboard')}  href="/"         collapsed={collapsed} currentPath={currentPath} />
        <NavRow icon={<MessageSquare size={16} />}   label={t('nav.messages')}   href="/mensajes"  collapsed={collapsed} currentPath={currentPath} />
        <NavRow icon={<Package size={16} />}         label={t('nav.inventory')} href="/inventory" collapsed={collapsed} currentPath={currentPath} />

        {!collapsed && (
          <p className="text-content-sidebar-muted text-[10px] font-semibold uppercase tracking-widest px-2.5 pt-4 pb-2">
            {t('nav.integrations')}
          </p>
        )}
        {collapsed && <div className="my-1 mx-2 border-t border-white/5" />}

        {/* Messaging channels — all at the same level */}
        <NavRow
          icon={<MessageCircle size={16} />} label={t('nav.whatsapp')} href="/mensajes?channel=whatsapp" collapsed={collapsed} currentPath={currentPath}
          activeOverride={currentPath.startsWith('/mensajes') && (!channelParam || channelParam === 'whatsapp')}
        />
        <NavRow
          icon={<MessageSquare size={16} />} label={t('nav.messenger')} href="/mensajes?channel=messenger" collapsed={collapsed} currentPath={currentPath}
          activeOverride={isChannelActive('messenger')}
        />
        <NavRow
          icon={<Camera size={16} />} label={t('nav.instagram')} href="/mensajes?channel=instagram" collapsed={collapsed} currentPath={currentPath}
          activeOverride={isChannelActive('instagram')}
        />

        {/* Channex with sub-items */}
        <NavRow icon={<Hotel size={16} />} label={t('nav.channex')} href="/channex" collapsed={collapsed} currentPath={currentPath} />
        {(channexOpen || !collapsed) && (
          <>
            <SubNavRow icon={<Home size={12} />}  label={t('nav.airbnb')}  href="/channex/airbnb"  collapsed={collapsed} currentPath={currentPath} />
            <SubNavRow icon={<Globe size={12} />} label={t('nav.booking')} href="/channex/booking" collapsed={collapsed} currentPath={currentPath} />
          </>
        )}

        {!collapsed && (
          <p className="text-content-sidebar-muted text-[10px] font-semibold uppercase tracking-widest px-2.5 pt-4 pb-2">
            {t('nav.system')}
          </p>
        )}
        {collapsed && <div className="my-1 mx-2 border-t border-white/5" />}
        <NavRow icon={<Settings size={16} />} label={t('nav.settings')} href="/configuracion" collapsed={collapsed} currentPath={currentPath} />
      </div>

      {/* Bottom controls */}
      <div className="p-2 border-t border-white/5 flex flex-col gap-0.5">
        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? t('nav.lightMode') : t('nav.darkMode')}
          className={[
            'flex items-center gap-2.5 w-full px-2.5 py-2 rounded-md',
            'text-content-sidebar text-sm font-medium',
            'hover:bg-surface-sidebar-hover hover:text-content-inv transition-colors duration-150',
          ].join(' ')}
        >
          {theme === 'dark'
            ? <Sun size={16} className="shrink-0" />
            : <Moon size={16} className="shrink-0" />}
          {!collapsed && (
            <span>{theme === 'dark' ? t('nav.lightMode') : t('nav.darkMode')}</span>
          )}
        </button>

        {/* Language toggle */}
        <button
          onClick={toggleLanguage}
          title={t('nav.changeLang')}
          className={[
            'flex items-center gap-2.5 w-full px-2.5 py-2 rounded-md',
            'text-content-sidebar text-sm font-medium',
            'hover:bg-surface-sidebar-hover hover:text-content-inv transition-colors duration-150',
          ].join(' ')}
        >
          <Languages size={16} className="shrink-0" />
          {!collapsed && (
            <span>{lang.toUpperCase()}</span>
          )}
        </button>

        {/* User */}
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-content-sidebar text-sm font-medium hover:bg-surface-sidebar-hover hover:text-content-inv transition-colors duration-150 cursor-pointer">
          <User size={16} className="shrink-0" />
          {!collapsed && <span className="truncate">{t('nav.myAccount')}</span>}
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          title={t('nav.logout')}
          className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-md text-danger text-sm font-medium hover:bg-danger-bg transition-colors duration-150"
        >
          <LogOut size={16} className="shrink-0" />
          {!collapsed && <span>{t('nav.logout')}</span>}
        </button>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center justify-center w-full mt-1 py-1.5 rounded-md text-content-sidebar-muted hover:text-content-sidebar hover:bg-surface-sidebar-hover transition-colors duration-150"
          title={collapsed ? t('nav.expandMenu') : t('nav.collapseMenu')}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>
    </nav>
  );
}

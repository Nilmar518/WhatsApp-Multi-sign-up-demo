import { useState, useEffect, useRef } from 'react';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase/firebase';

const LS_KEY = 'sidenav_collapsed';

function UserIcon() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
    </svg>
  );
}

export default function SideNav() {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(LS_KEY) !== 'false';
    } catch {
      return true;
    }
  });

  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const soonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, String(collapsed));
    } catch {}
  }, [collapsed]);

  useEffect(() => {
    if (!activeTab) return;
    function handler(e: MouseEvent) {
      if (soonRef.current && !soonRef.current.contains(e.target as Node)) {
        setActiveTab(null);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [activeTab]);

  function toggleTab(tab: string) {
    setActiveTab((prev) => (prev === tab ? null : tab));
  }

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await signOut(auth);
    } catch {
      setLoggingOut(false);
    }
  }

  return (
    <div className="relative flex">
      {/* Sidebar panel */}
      <div
        className={`flex flex-col bg-slate-900 transition-all duration-200 ease-in-out shrink-0 ${
          collapsed ? 'w-14' : 'w-48'
        }`}
      >
        {/* Toggle button */}
        <div className="flex justify-end px-2 pt-3 pb-2">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800 transition-colors"
            title={collapsed ? 'Expandir menú' : 'Colapsar menú'}
          >
            {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
          </button>
        </div>

        {/* Tabs */}
        <nav className="flex-1 flex flex-col gap-1 px-2">
          <button
            type="button"
            onClick={() => toggleTab('users')}
            className={`flex items-center gap-3 px-2 py-2 rounded-lg text-sm font-medium transition-colors w-full text-left ${
              activeTab === 'users'
                ? 'bg-slate-700 text-white'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
            title={collapsed ? 'Users' : undefined}
          >
            <UserIcon />
            {!collapsed && <span className="truncate">Users</span>}
          </button>
        </nav>

        {/* Logout */}
        <div className="px-2 pb-4">
          <button
            type="button"
            onClick={() => void handleLogout()}
            disabled={loggingOut}
            className="flex items-center gap-3 px-2 py-2 rounded-lg text-sm font-medium text-red-400 hover:text-red-300 hover:bg-slate-800 transition-colors w-full text-left disabled:opacity-50"
            title={collapsed ? 'Cerrar sesión' : undefined}
          >
            <LogoutIcon />
            {!collapsed && (
              <span className="truncate">{loggingOut ? 'Saliendo…' : 'Cerrar sesión'}</span>
            )}
          </button>
        </div>
      </div>

      {/* "Próximamente" panel */}
      {activeTab === 'users' && (
        <div ref={soonRef} className="absolute left-full top-16 z-50 ml-2 animate-fade-in">
          <div className="bg-slate-800 text-slate-200 text-xs rounded-lg px-4 py-3 shadow-xl whitespace-nowrap">
            <p className="font-semibold text-sm text-white mb-0.5">Users</p>
            <p className="text-slate-400">Próximamente ✦</p>
          </div>
        </div>
      )}
    </div>
  );
}

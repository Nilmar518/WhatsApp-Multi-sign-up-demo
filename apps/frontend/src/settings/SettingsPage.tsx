import { useState } from 'react';
import type { User } from './api/usersApi';
import UserTable from './components/UserTable';
import CreateUserModal from './components/CreateUserModal';
import EditUserModal from './components/EditUserModal';

type Tab = 'usuarios';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('usuarios');
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const refresh = () => setRefreshTrigger((n) => n + 1);

  const handleEdit = (user: User) => setEditTarget(user);

  const handleDelete = (_uid: string) => {
    refresh();
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'usuarios', label: 'Usuarios' },
  ];

  return (
    <div className="h-screen flex flex-col bg-surface-subtle overflow-hidden">
      <header className="bg-surface-raised border-b border-edge px-6 py-4 shrink-0">
        <h1 className="text-2xl font-bold text-content">Configuración del Sistema</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="bg-surface-raised border border-edge rounded-2xl shadow-sm overflow-hidden">
          <div className="border-b border-edge px-6">
            <nav className="flex gap-1 -mb-px">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={[
                    'px-4 py-3 text-sm font-semibold border-b-2 transition-colors',
                    activeTab === tab.id
                      ? 'border-brand text-brand'
                      : 'border-transparent text-content-subtle hover:text-content hover:border-edge',
                  ].join(' ')}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          <div className="p-6">
            {activeTab === 'usuarios' && (
              <UserTable
                onEdit={handleEdit}
                onDelete={handleDelete}
                onAddNew={() => setShowCreate(true)}
                refreshTrigger={refreshTrigger}
              />
            )}
          </div>
        </div>
      </div>

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onSuccess={() => {
            setShowCreate(false);
            refresh();
          }}
        />
      )}

      {editTarget !== null && (
        <EditUserModal
          user={editTarget}
          onClose={() => setEditTarget(null)}
          onSuccess={() => {
            setEditTarget(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { Pencil, Trash2, Plus, RefreshCw } from 'lucide-react';
import { getUsers, deleteUser, type User } from '../api/usersApi';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';

interface UserTableProps {
  onEdit: (user: User) => void;
  onDelete: (uid: string) => void;
  onAddNew: () => void;
  refreshTrigger: number;
}

const roleVariant: Record<User['role'], 'brand' | 'caution' | 'neutral'> = {
  owner: 'brand',
  admin: 'caution',
  customer: 'neutral',
};

const roleLabel: Record<User['role'], string> = {
  owner: 'Owner',
  admin: 'Admin',
  customer: 'Customer',
};

export default function UserTable({ onEdit, onDelete, onAddNew, refreshTrigger }: UserTableProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingUid, setDeletingUid] = useState<string | null>(null);
  const [confirmingUid, setConfirmingUid] = useState<string | null>(null);

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getUsers();
      setUsers(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al cargar usuarios');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchUsers();
  }, [refreshTrigger]);

  const handleDeleteConfirm = async (uid: string) => {
    setDeletingUid(uid);
    try {
      await deleteUser(uid);
      setUsers((prev) => prev.filter((u) => u.uid !== uid));
      onDelete(uid);
    } catch {
      // swallow — caller can handle via onDelete or toast
    } finally {
      setDeletingUid(null);
      setConfirmingUid(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3 px-1 py-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-10 rounded-lg bg-surface-subtle animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <p className="text-sm text-danger-text">{error}</p>
        <Button variant="outline" size="sm" onClick={() => void fetchUsers()}>
          <RefreshCw className="w-3.5 h-3.5" />
          Reintentar
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-content-2 font-medium">
          {users.length} {users.length === 1 ? 'usuario' : 'usuarios'}
        </p>
        <Button variant="primary" size="sm" onClick={onAddNew}>
          <Plus className="w-3.5 h-3.5" />
          Agregar usuario
        </Button>
      </div>

      {users.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-content-2">No hay usuarios registrados.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-edge">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-subtle border-b border-edge">
                <th className="text-left px-4 py-3 font-semibold text-content-2 text-xs uppercase tracking-wide">
                  Nombre
                </th>
                <th className="text-left px-4 py-3 font-semibold text-content-2 text-xs uppercase tracking-wide">
                  Email
                </th>
                <th className="text-left px-4 py-3 font-semibold text-content-2 text-xs uppercase tracking-wide">
                  Teléfono
                </th>
                <th className="text-left px-4 py-3 font-semibold text-content-2 text-xs uppercase tracking-wide">
                  País
                </th>
                <th className="text-left px-4 py-3 font-semibold text-content-2 text-xs uppercase tracking-wide">
                  Rol
                </th>
                <th className="text-right px-4 py-3 font-semibold text-content-2 text-xs uppercase tracking-wide">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge/10">
              {users.map((user) => (
                <tr key={user.uid} className="hover:bg-surface-raised/50 transition-colors">
                  <td className="px-4 py-3 font-medium text-content">{user.name}</td>
                  <td className="px-4 py-3 text-content-2">{user.email}</td>
                  <td className="px-4 py-3 text-content-2">
                    {user.dialCode} {user.phone}
                  </td>
                  <td className="px-4 py-3 text-content-2">{user.country}</td>
                  <td className="px-4 py-3">
                    <Badge variant={roleVariant[user.role]}>{roleLabel[user.role]}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {confirmingUid === user.uid ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-content-2">¿Confirmar?</span>
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={deletingUid === user.uid}
                            onClick={() => void handleDeleteConfirm(user.uid)}
                          >
                            Sí
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={deletingUid === user.uid}
                            onClick={() => setConfirmingUid(null)}
                          >
                            No
                          </Button>
                        </div>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onEdit(user)}
                            title="Editar usuario"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmingUid(user.uid)}
                            title="Eliminar usuario"
                            className="hover:text-danger-text"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

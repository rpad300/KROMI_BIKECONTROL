// ═══════════════════════════════════════════════════════════
// AdminUsersPage — list, search, manage users
// ═══════════════════════════════════════════════════════════
//
// Features:
//  - Search by email/name
//  - Drive folder status badge per user (green = ok, red = missing)
//  - "Force bootstrap" per user (creates missing folders)
//  - Click to open detail panel: roles, feature flags, impersonate

import { useEffect, useMemo, useState } from 'react';
import {
  listAllUsers,
  type AdminUserRow,
} from '../../services/rbac/RBACService';
import { slugify } from '../../services/storage/KromiFileStore';
import {
  checkUserFolders,
  bootstrapUserOnDrive,
  type UserFolderStatus,
} from '../../services/storage/googleDrive/driveClient';
import { AdminUserDetail } from './AdminUserDetail';

interface UserWithDriveStatus extends AdminUserRow {
  drive?: UserFolderStatus;
  drive_loading?: boolean;
}

export function AdminUsersPage() {
  const [users, setUsers] = useState<UserWithDriveStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const rows = await listAllUsers();
    setUsers(rows.map((r) => ({ ...r, drive_loading: true })));
    setLoading(false);
    // Fire Drive status check in background
    void loadDriveStatus(rows);
  };

  const loadDriveStatus = async (rows: AdminUserRow[]) => {
    if (rows.length === 0) return;
    const slugs = rows.map((r) => slugify(r.email));
    try {
      const result = await checkUserFolders(slugs);
      setUsers((prev) =>
        prev.map((u) => ({
          ...u,
          drive: result[slugify(u.email)],
          drive_loading: false,
        })),
      );
    } catch {
      setUsers((prev) => prev.map((u) => ({ ...u, drive_loading: false })));
    }
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return users;
    const q = search.toLowerCase();
    return users.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        (u.name?.toLowerCase().includes(q) ?? false),
    );
  }, [users, search]);

  const handleBootstrap = async (user: UserWithDriveStatus) => {
    setBootstrapping(user.id);
    try {
      const slug = slugify(user.email);
      await bootstrapUserOnDrive(slug);
      // Re-check status
      const result = await checkUserFolders([slug]);
      setUsers((prev) =>
        prev.map((u) =>
          u.id === user.id ? { ...u, drive: result[slug] } : u,
        ),
      );
    } catch (err) {
      alert(`Erro: ${(err as Error).message}`);
    } finally {
      setBootstrapping(null);
    }
  };

  if (selected) {
    return (
      <AdminUserDetail
        userId={selected}
        onBack={() => { setSelected(null); void load(); }}
      />
    );
  }

  return (
    <div style={{ padding: '4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <h2 className="font-headline font-bold" style={{ fontSize: '16px', color: '#3fff8b' }}>
          Utilizadores ({users.length})
        </h2>
        <button
          onClick={() => void load()}
          disabled={loading}
          style={{
            padding: '6px 10px', fontSize: '10px', fontWeight: 700,
            backgroundColor: 'rgba(110,155,255,0.1)', border: '1px solid rgba(110,155,255,0.2)',
            borderRadius: '4px', color: '#6e9bff', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '4px',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>refresh</span>
          Recarregar
        </button>
      </div>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Procurar por email ou nome..."
        style={{
          width: '100%', padding: '8px 12px', marginBottom: '12px',
          backgroundColor: '#131313', border: '1px solid rgba(73,72,71,0.3)',
          borderRadius: '4px', color: 'white', fontSize: '12px', outline: 'none',
        }}
      />

      {loading && (
        <div style={{ textAlign: 'center', padding: '24px', color: '#777575', fontSize: '11px' }}>
          A carregar...
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '24px', color: '#494847', fontSize: '11px' }}>
          Sem utilizadores.
        </div>
      )}

      {filtered.map((u) => {
        const driveOk = u.drive?.exists === true;
        const driveMissing = u.drive && !u.drive.exists;
        const driveStatusColor = u.drive_loading ? '#777575' : driveOk ? '#3fff8b' : '#ff716c';
        const driveStatusText = u.drive_loading
          ? '...'
          : driveOk
            ? '✓ Drive OK'
            : `✗ ${u.drive?.missing.length} missing`;

        return (
          <div
            key={u.id}
            style={{
              backgroundColor: '#131313',
              padding: '10px 12px',
              borderRadius: '6px',
              marginBottom: '6px',
              border: '1px solid rgba(73,72,71,0.2)',
              cursor: 'pointer',
            }}
            onClick={() => setSelected(u.id)}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                  <span style={{ fontSize: '12px', color: 'white', fontWeight: 600 }}>
                    {u.name ?? '(sem nome)'}
                  </span>
                  {u.is_super_admin && (
                    <span style={{
                      fontSize: '8px', padding: '1px 5px', backgroundColor: 'rgba(255,159,67,0.15)',
                      color: '#ff9f43', borderRadius: '2px', fontWeight: 700,
                    }}>
                      SUPER ADMIN
                    </span>
                  )}
                  {u.suspended_at && (
                    <span style={{
                      fontSize: '8px', padding: '1px 5px', backgroundColor: 'rgba(255,113,108,0.15)',
                      color: '#ff716c', borderRadius: '2px', fontWeight: 700,
                    }}>
                      SUSPENSO
                    </span>
                  )}
                </div>
                <div style={{
                  fontSize: '10px', color: '#777575', overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {u.email}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                <span style={{
                  fontSize: '9px',
                  color: driveStatusColor,
                  fontWeight: 700,
                }}>
                  {driveStatusText}
                </span>
                {driveMissing && (
                  <button
                    onClick={(e) => { e.stopPropagation(); void handleBootstrap(u); }}
                    disabled={bootstrapping === u.id}
                    style={{
                      padding: '3px 8px', fontSize: '9px', fontWeight: 700,
                      backgroundColor: 'rgba(63,255,139,0.1)', border: '1px solid rgba(63,255,139,0.3)',
                      borderRadius: '3px', color: '#3fff8b', cursor: 'pointer',
                    }}
                  >
                    {bootstrapping === u.id ? '...' : 'Forçar criar'}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

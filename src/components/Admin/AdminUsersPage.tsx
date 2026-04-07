// ═══════════════════════════════════════════════════════════
// AdminUsersPage — list, search, manage users
// ═══════════════════════════════════════════════════════════
//
// Session 18 additions:
//  - Search now filters by email/name + role + suspended-only
//  - CSV export of the current filtered list (right next to refresh)
//  - Bulk selection with multi-select checkboxes + "Assign role to N"
//    floating action bar, which loops over admin_set_user_roles RPC
//  - Drive status badge + "Force bootstrap" per user (pre-existing)

import { useEffect, useMemo, useState } from 'react';
import {
  listAllUsers,
  listRoles,
  getUserRoles,
  setUserRoles,
  type AdminUserRow,
  type Role,
} from '../../services/rbac/RBACService';
import { useAuthStore } from '../../store/authStore';
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
  /** Cached at load time — populated via getUserRoles() in background */
  role_ids?: string[];
}

type StatusFilter = 'all' | 'active' | 'suspended' | 'super_admin';

export function AdminUsersPage() {
  const realUserId = useAuthStore((s) => s.realUser?.id);
  const [users, setUsers] = useState<UserWithDriveStatus[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>(''); // '' = any
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState<string | null>(null);

  // Bulk selection
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkRoleId, setBulkRoleId] = useState<string>('');
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ ok: number; fail: number } | null>(null);

  const load = async () => {
    setLoading(true);
    const [rows, roleList] = await Promise.all([listAllUsers(), listRoles()]);
    setUsers(rows.map((r) => ({ ...r, drive_loading: true })));
    setRoles(roleList);
    setLoading(false);
    // Kick off Drive status + roles in background
    void loadDriveStatus(rows);
    void loadUserRoles(rows);
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

  /**
   * Fetch role assignments per user in parallel. This powers the role
   * filter dropdown; without it we'd need a server-side view joining
   * user_roles + roles, which we don't have (and the user count is
   * small enough that per-user queries are fine).
   */
  const loadUserRoles = async (rows: AdminUserRow[]) => {
    const entries = await Promise.all(
      rows.map(async (r) => [r.id, await getUserRoles(r.id).catch(() => [] as string[])] as const),
    );
    const byId = new Map(entries);
    setUsers((prev) => prev.map((u) => ({ ...u, role_ids: byId.get(u.id) ?? [] })));
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (q) {
        const hay = `${u.email} ${u.name ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (roleFilter && !(u.role_ids ?? []).includes(roleFilter)) return false;
      if (statusFilter === 'active' && (u.suspended_at || u.is_super_admin)) return false;
      if (statusFilter === 'suspended' && !u.suspended_at) return false;
      if (statusFilter === 'super_admin' && !u.is_super_admin) return false;
      return true;
    });
  }, [users, search, roleFilter, statusFilter]);

  const handleBootstrap = async (user: UserWithDriveStatus) => {
    setBootstrapping(user.id);
    try {
      const slug = slugify(user.email);
      await bootstrapUserOnDrive(slug);
      const result = await checkUserFolders([slug]);
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, drive: result[slug] } : u)),
      );
    } catch (err) {
      alert(`Erro: ${(err as Error).message}`);
    } finally {
      setBootstrapping(null);
    }
  };

  // ── CSV export ────────────────────────────────────────────
  const exportCsv = () => {
    const roleById = new Map(roles.map((r) => [r.id, r.key] as const));
    const header = ['id', 'email', 'name', 'is_super_admin', 'suspended_at', 'suspended_reason', 'created_at', 'last_login_at', 'roles'];
    const esc = (v: unknown): string => {
      if (v == null) return '';
      const s = String(v);
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const rows = filtered.map((u) => [
      u.id,
      u.email,
      u.name ?? '',
      u.is_super_admin ? 'true' : 'false',
      u.suspended_at ?? '',
      u.suspended_reason ?? '',
      u.created_at,
      u.last_login_at ?? '',
      (u.role_ids ?? []).map((rid) => roleById.get(rid) ?? rid).join(';'),
    ]);
    const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kromi-users-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ── Bulk selection helpers ────────────────────────────────
  const toggleBulk = (id: string) => {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAllVisible = () => {
    setBulkSelected(new Set(filtered.map((u) => u.id)));
  };
  const clearBulk = () => setBulkSelected(new Set());

  const runBulkRoleAssign = async () => {
    if (!bulkRoleId || bulkSelected.size === 0 || !realUserId) return;
    if (!confirm(`Atribuir role a ${bulkSelected.size} utilizador(es)? (Adicionado às roles existentes de cada um)`)) return;
    setBulkRunning(true);
    let ok = 0, fail = 0;
    // Run serially to keep the UI responsive and avoid hammering the RPC.
    for (const userId of bulkSelected) {
      try {
        const current = users.find((u) => u.id === userId)?.role_ids ?? [];
        if (current.includes(bulkRoleId)) { ok++; continue; } // already has it
        const next = [...current, bulkRoleId];
        await setUserRoles(userId, next, realUserId);
        // Update local cache
        setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role_ids: next } : u)));
        ok++;
      } catch {
        fail++;
      }
    }
    setBulkResult({ ok, fail });
    setBulkRunning(false);
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
          Utilizadores ({filtered.length} / {users.length})
        </h2>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            onClick={exportCsv}
            disabled={loading || filtered.length === 0}
            style={{
              padding: '6px 10px', fontSize: '10px', fontWeight: 700,
              backgroundColor: 'rgba(63,255,139,0.1)', border: '1px solid rgba(63,255,139,0.2)',
              borderRadius: '4px', color: '#3fff8b',
              cursor: (loading || filtered.length === 0) ? 'not-allowed' : 'pointer',
              opacity: (loading || filtered.length === 0) ? 0.5 : 1,
              display: 'flex', alignItems: 'center', gap: '4px',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>download</span>
            CSV
          </button>
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
      </div>

      {/* Filters row */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Procurar por email ou nome..."
          style={{
            flex: '1 1 200px', padding: '8px 12px',
            backgroundColor: '#131313', border: '1px solid rgba(73,72,71,0.3)',
            borderRadius: '4px', color: 'white', fontSize: '12px', outline: 'none',
          }}
        />
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          style={{
            padding: '8px 10px', backgroundColor: '#131313',
            border: '1px solid rgba(73,72,71,0.3)', borderRadius: '4px',
            color: 'white', fontSize: '11px', outline: 'none',
          }}
        >
          <option value="">Qualquer role</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>{r.label}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          style={{
            padding: '8px 10px', backgroundColor: '#131313',
            border: '1px solid rgba(73,72,71,0.3)', borderRadius: '4px',
            color: 'white', fontSize: '11px', outline: 'none',
          }}
        >
          <option value="all">Todos os status</option>
          <option value="active">Só activos</option>
          <option value="suspended">Só suspensos</option>
          <option value="super_admin">Só super admin</option>
        </select>
      </div>

      {/* Bulk action bar (visible when any user is selected) */}
      {bulkSelected.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
          padding: '8px 10px', marginBottom: '10px',
          backgroundColor: 'rgba(255,159,67,0.08)',
          border: '1px solid rgba(255,159,67,0.3)', borderRadius: '4px',
        }}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#ff9f43' }}>
            {bulkSelected.size} selecionados
          </span>
          <button onClick={selectAllVisible} style={smallBtnStyle('#6e9bff')}>
            Selecionar todos ({filtered.length})
          </button>
          <button onClick={clearBulk} style={smallBtnStyle('#adaaaa')}>
            Limpar
          </button>
          <div style={{ flex: 1 }} />
          <select
            value={bulkRoleId}
            onChange={(e) => setBulkRoleId(e.target.value)}
            disabled={bulkRunning}
            style={{
              padding: '6px 8px', backgroundColor: '#0e0e0e',
              border: '1px solid rgba(73,72,71,0.3)', borderRadius: '3px',
              color: 'white', fontSize: '10px', outline: 'none',
            }}
          >
            <option value="">Escolher role…</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
          <button
            onClick={() => void runBulkRoleAssign()}
            disabled={!bulkRoleId || bulkRunning}
            style={{
              padding: '6px 12px', fontSize: '10px', fontWeight: 700,
              backgroundColor: (!bulkRoleId || bulkRunning) ? 'rgba(255,159,67,0.15)' : '#ff9f43',
              color: (!bulkRoleId || bulkRunning) ? '#777575' : '#0e0e0e',
              border: 'none', borderRadius: '3px',
              cursor: (!bulkRoleId || bulkRunning) ? 'not-allowed' : 'pointer',
            }}
          >
            {bulkRunning ? 'A aplicar…' : 'Atribuir'}
          </button>
          {bulkResult && (
            <span style={{
              fontSize: '10px',
              color: bulkResult.fail === 0 ? '#3fff8b' : '#ff716c',
            }}>
              {bulkResult.ok} ok, {bulkResult.fail} falharam
            </span>
          )}
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '24px', color: '#777575', fontSize: '11px' }}>
          A carregar...
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '24px', color: '#494847', fontSize: '11px' }}>
          Sem utilizadores para os filtros actuais.
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
        const isBulkSelected = bulkSelected.has(u.id);

        return (
          <div
            key={u.id}
            style={{
              backgroundColor: isBulkSelected ? 'rgba(255,159,67,0.08)' : '#131313',
              padding: '10px 12px',
              borderRadius: '6px',
              marginBottom: '6px',
              border: isBulkSelected ? '1px solid rgba(255,159,67,0.4)' : '1px solid rgba(73,72,71,0.2)',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '10px',
            }}
            onClick={() => setSelected(u.id)}
          >
            <input
              type="checkbox"
              checked={isBulkSelected}
              onClick={(e) => { e.stopPropagation(); toggleBulk(u.id); }}
              onChange={() => { /* handled in onClick to use stopPropagation */ }}
              style={{ cursor: 'pointer', accentColor: '#ff9f43' }}
            />
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
        );
      })}
    </div>
  );
}

function smallBtnStyle(color: string): React.CSSProperties {
  return {
    padding: '4px 8px', fontSize: '9px', fontWeight: 700,
    backgroundColor: 'rgba(73,72,71,0.15)', border: `1px solid ${color}33`,
    borderRadius: '3px', color, cursor: 'pointer',
  };
}

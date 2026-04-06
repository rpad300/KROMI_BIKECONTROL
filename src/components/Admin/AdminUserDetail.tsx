// ═══════════════════════════════════════════════════════════
// AdminUserDetail — manage a single user
// ═══════════════════════════════════════════════════════════
//
// Features:
//  - Profile info (read-only)
//  - Suspend / unsuspend
//  - Toggle super admin flag
//  - Assign roles (multi-select)
//  - Per-user feature flag overrides (allow/deny per permission)
//  - Impersonate ("Entrar como")
//  - Drive folder force-bootstrap

import { useEffect, useState, useCallback } from 'react';
import {
  getUserById,
  getUserRoles,
  setUserRoles,
  listRoles,
  listPermissions,
  getUserFeatureFlags,
  setUserFeatureFlag,
  clearUserFeatureFlag,
  suspendUser,
  unsuspendUser,
  setUserSuperAdmin,
  type AdminUserRow,
  type Role,
  type Permission,
  type UserFeatureFlag,
  type FeatureFlagMode,
} from '../../services/rbac/RBACService';
import { slugify } from '../../services/storage/KromiFileStore';
import { bootstrapUserOnDrive } from '../../services/storage/googleDrive/driveClient';
import { useAuthStore } from '../../store/authStore';

const card: React.CSSProperties = {
  backgroundColor: '#131313',
  borderRadius: '6px',
  padding: '12px',
  marginBottom: '10px',
  border: '1px solid rgba(73,72,71,0.2)',
};
const sectionLabel: React.CSSProperties = {
  fontSize: '10px',
  color: '#ff9f43',
  fontWeight: 700,
  marginBottom: '8px',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

export function AdminUserDetail({ userId, onBack }: { userId: string; onBack: () => void }) {
  const adminId = useAuthStore((s) => s.user?.id);
  const beginImpersonation = useAuthStore((s) => s.beginImpersonation);
  const [user, setUser] = useState<AdminUserRow | null>(null);
  const [allRoles, setAllRoles] = useState<Role[]>([]);
  const [allPerms, setAllPerms] = useState<Permission[]>([]);
  const [userRoleIds, setUserRoleIds] = useState<Set<string>>(new Set());
  const [flags, setFlags] = useState<UserFeatureFlag[]>([]);
  const [busy, setBusy] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    const [u, roles, perms, urs, fs] = await Promise.all([
      getUserById(userId),
      listRoles(),
      listPermissions(),
      getUserRoles(userId),
      getUserFeatureFlags(userId),
    ]);
    setUser(u);
    setAllRoles(roles);
    setAllPerms(perms);
    setUserRoleIds(new Set(urs));
    setFlags(fs);
    setBusy(false);
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  const toggleRole = async (roleId: string) => {
    if (!adminId) return;
    const next = new Set(userRoleIds);
    if (next.has(roleId)) next.delete(roleId);
    else next.add(roleId);
    setUserRoleIds(next);
    await setUserRoles(userId, Array.from(next), adminId);
  };

  const flagFor = (key: string): FeatureFlagMode | null => {
    const f = flags.find((x) => x.permission_key === key);
    return f?.mode ?? null;
  };

  const setFlag = async (key: string, mode: FeatureFlagMode | null) => {
    if (!adminId) return;
    if (mode === null) {
      await clearUserFeatureFlag(userId, key);
    } else {
      await setUserFeatureFlag(userId, key, mode, adminId);
    }
    setFlags(await getUserFeatureFlags(userId));
  };

  const handleSuspend = async () => {
    if (!suspendReason.trim()) {
      alert('Indica uma razão.');
      return;
    }
    await suspendUser(userId, suspendReason);
    setSuspendReason('');
    await load();
  };

  const handleUnsuspend = async () => {
    await unsuspendUser(userId);
    await load();
  };

  const handleSuperAdmin = async () => {
    if (!user) return;
    if (user.is_super_admin) {
      if (!confirm('Remover privilégios de Super Admin a este utilizador?')) return;
    }
    await setUserSuperAdmin(userId, !user.is_super_admin);
    await load();
  };

  const handleBootstrap = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await bootstrapUserOnDrive(slugify(user.email));
    } catch (err) {
      alert(`Erro: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleImpersonate = async () => {
    if (!user || !adminId) return;
    if (user.id === adminId) {
      alert('Não podes fazer impersonation de ti próprio.');
      return;
    }
    if (!confirm(`Entrar como ${user.email}?\nVais ver a plataforma como ele. A tua sessão de admin é preservada.`)) return;
    await beginImpersonation(user, 'Admin debug session');
    onBack();
  };

  if (busy && !user) {
    return <div style={{ padding: '20px', color: '#777575', fontSize: '11px' }}>A carregar...</div>;
  }
  if (!user) {
    return <div style={{ padding: '20px', color: '#ff716c', fontSize: '11px' }}>User não encontrado.</div>;
  }

  return (
    <div style={{ padding: '4px' }}>
      {/* Back */}
      <button
        onClick={onBack}
        style={{
          background: 'none', border: 'none', color: '#6e9bff', cursor: 'pointer',
          fontSize: '11px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '4px',
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>arrow_back</span>
        Voltar à lista
      </button>

      {/* Profile */}
      <div style={card}>
        <div style={sectionLabel}>Perfil</div>
        <div style={{ fontSize: '14px', color: 'white', fontWeight: 600 }}>
          {user.name ?? '(sem nome)'}
        </div>
        <div style={{ fontSize: '11px', color: '#777575' }}>{user.email}</div>
        <div style={{ fontSize: '9px', color: '#494847', marginTop: '6px', fontFamily: 'monospace' }}>
          ID: {user.id}
        </div>
        <div style={{ fontSize: '9px', color: '#494847', marginTop: '2px' }}>
          Slug: <code>users/{slugify(user.email)}/</code>
        </div>
        <div style={{ fontSize: '9px', color: '#494847', marginTop: '2px' }}>
          Criado: {new Date(user.created_at).toLocaleDateString('pt-PT')}
          {user.last_login_at && ` · Último login: ${new Date(user.last_login_at).toLocaleDateString('pt-PT')}`}
        </div>
      </div>

      {/* Quick actions */}
      <div style={card}>
        <div style={sectionLabel}>Acções</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <button
            onClick={handleImpersonate}
            disabled={user.id === adminId}
            style={btnStyle('#6e9bff', user.id === adminId)}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>switch_account</span>
            Entrar como este utilizador
          </button>
          <button onClick={handleBootstrap} style={btnStyle('#3fff8b')}>
            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>create_new_folder</span>
            Forçar criar pastas Drive
          </button>
          <button onClick={handleSuperAdmin} style={btnStyle(user.is_super_admin ? '#ff716c' : '#ff9f43')}>
            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>shield_person</span>
            {user.is_super_admin ? 'Remover Super Admin' : 'Tornar Super Admin'}
          </button>
        </div>
      </div>

      {/* Suspend */}
      <div style={card}>
        <div style={sectionLabel}>Estado da conta</div>
        {user.suspended_at ? (
          <div>
            <div style={{ fontSize: '11px', color: '#ff716c', marginBottom: '6px' }}>
              SUSPENSO desde {new Date(user.suspended_at).toLocaleDateString('pt-PT')}
            </div>
            <div style={{ fontSize: '10px', color: '#777575', marginBottom: '8px' }}>
              {user.suspended_reason ?? '(sem razão)'}
            </div>
            <button onClick={handleUnsuspend} style={btnStyle('#3fff8b')}>
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>check_circle</span>
              Reactivar
            </button>
          </div>
        ) : (
          <div>
            <input
              type="text"
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              placeholder="Razão (obrigatório)"
              style={{
                width: '100%', padding: '6px 8px', marginBottom: '6px',
                backgroundColor: '#0e0e0e', border: '1px solid rgba(73,72,71,0.3)',
                borderRadius: '3px', color: 'white', fontSize: '11px', outline: 'none',
              }}
            />
            <button onClick={handleSuspend} style={btnStyle('#ff716c')}>
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>block</span>
              Suspender utilizador
            </button>
          </div>
        )}
      </div>

      {/* Roles */}
      <div style={card}>
        <div style={sectionLabel}>Roles atribuídos</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {allRoles.map((r) => {
            const checked = userRoleIds.has(r.id);
            return (
              <label key={r.id} style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '6px 8px', borderRadius: '4px',
                backgroundColor: checked ? 'rgba(63,255,139,0.06)' : 'transparent',
                cursor: 'pointer',
              }}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => void toggleRole(r.id)}
                  style={{ accentColor: '#3fff8b' }}
                />
                <div>
                  <div style={{ fontSize: '11px', color: 'white', fontWeight: 600 }}>{r.label}</div>
                  {r.description && (
                    <div style={{ fontSize: '9px', color: '#777575' }}>{r.description}</div>
                  )}
                </div>
              </label>
            );
          })}
        </div>
      </div>

      {/* Feature flag overrides */}
      <div style={card}>
        <div style={sectionLabel}>Overrides de funcionalidades</div>
        <div style={{ fontSize: '9px', color: '#777575', marginBottom: '8px' }}>
          Override (allow / deny) permissões individuais. <strong>Allow</strong> dá acesso mesmo sem role; <strong>Deny</strong> remove acesso mesmo se o role permite.
        </div>
        {allPerms.filter((p) => !p.is_core).map((p) => {
          const mode = flagFor(p.key);
          return (
            <div key={p.key} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '6px 0', borderBottom: '1px solid rgba(73,72,71,0.1)',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '10px', color: 'white', fontWeight: 600 }}>{p.label}</div>
                <div style={{ fontSize: '8px', color: '#494847', fontFamily: 'monospace' }}>{p.key}</div>
              </div>
              <div style={{ display: 'flex', gap: '3px' }}>
                <button
                  onClick={() => void setFlag(p.key, 'allow')}
                  style={flagBtnStyle(mode === 'allow' ? '#3fff8b' : '#494847', mode === 'allow')}
                >
                  Allow
                </button>
                <button
                  onClick={() => void setFlag(p.key, mode === null ? 'deny' : null)}
                  style={flagBtnStyle(mode === 'deny' ? '#ff716c' : '#494847', mode === 'deny')}
                >
                  {mode === null ? 'Deny' : '—'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function btnStyle(color: string, disabled = false): React.CSSProperties {
  return {
    padding: '8px 12px',
    backgroundColor: `${color}1a`,
    border: `1px solid ${color}33`,
    borderRadius: '4px',
    color: disabled ? '#494847' : color,
    fontSize: '11px',
    fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    width: '100%',
    justifyContent: 'flex-start',
  };
}

function flagBtnStyle(color: string, active: boolean): React.CSSProperties {
  return {
    padding: '3px 8px',
    backgroundColor: active ? `${color}33` : 'transparent',
    border: `1px solid ${color}`,
    borderRadius: '3px',
    color,
    fontSize: '9px',
    fontWeight: 700,
    cursor: 'pointer',
  };
}

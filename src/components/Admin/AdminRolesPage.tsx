// ═══════════════════════════════════════════════════════════
// AdminRolesPage — manage roles ↔ permissions
// ═══════════════════════════════════════════════════════════
//
// Lists all roles. Click one to expand the permission matrix.
// Toggle individual permissions per role. Core perms are always
// granted (locked). System roles cannot be deleted.

import { useCallback, useEffect, useState } from 'react';
import {
  listRoles,
  listPermissions,
  getRolePermissions,
  setRolePermissions,
  createRole,
  updateRole,
  deleteRole,
  type Role,
  type Permission,
} from '../../services/rbac/RBACService';

export function AdminRolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [perms, setPerms] = useState<Permission[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rolePerms, setRolePerms] = useState<Record<string, Set<string>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [r, p] = await Promise.all([listRoles(), listPermissions()]);
    setRoles(r);
    setPerms(p);
    const map: Record<string, Set<string>> = {};
    for (const role of r) {
      const keys = await getRolePermissions(role.id);
      map[role.id] = new Set(keys);
    }
    setRolePerms(map);
  }, []);

  useEffect(() => {
    void (async () => {
      await reload();
      setLoading(false);
    })();
  }, [reload]);

  const togglePerm = async (roleId: string, permKey: string) => {
    setSaving(roleId);
    const current = rolePerms[roleId] ?? new Set();
    if (current.has(permKey)) current.delete(permKey);
    else current.add(permKey);
    setRolePerms({ ...rolePerms, [roleId]: current });
    await setRolePermissions(roleId, Array.from(current));
    setSaving(null);
  };

  const handleCreate = async (input: { key: string; label: string; description: string; copyFromRoleId?: string }) => {
    setError(null);
    try {
      const created = await createRole({
        key: input.key,
        label: input.label,
        description: input.description || null,
      });
      // Optional: seed permissions by copying from another role
      if (created && input.copyFromRoleId) {
        const sourceKeys = rolePerms[input.copyFromRoleId];
        if (sourceKeys && sourceKeys.size > 0) {
          await setRolePermissions(created.id, Array.from(sourceKeys));
        }
      }
      setCreating(false);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleSaveEdit = async (roleId: string, patch: { label: string; description: string }) => {
    setError(null);
    try {
      await updateRole(roleId, { label: patch.label, description: patch.description || null });
      setEditingId(null);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleDelete = async (role: Role) => {
    if (role.is_system) {
      setError('Roles do sistema não podem ser apagadas.');
      return;
    }
    if (!confirm(`Apagar role "${role.label}"? Todos os utilizadores que a têm vão perdê-la.`)) return;
    setError(null);
    try {
      await deleteRole(role.id);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (loading) {
    return <div style={{ padding: '20px', color: '#777575', fontSize: '11px' }}>A carregar...</div>;
  }

  // Group perms by category for display
  const grouped: Record<string, Permission[]> = {};
  for (const p of perms) {
    const list = grouped[p.category] ?? [];
    list.push(p);
    grouped[p.category] = list;
  }

  return (
    <div style={{ padding: '4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <h2 className="font-headline font-bold" style={{ fontSize: '16px', color: '#3fff8b', margin: 0 }}>
          Roles ({roles.length}) · Permissões ({perms.length})
        </h2>
        <button
          onClick={() => { setCreating(true); setError(null); }}
          style={{
            padding: '6px 12px', backgroundColor: 'rgba(63,255,139,0.1)',
            border: '1px solid rgba(63,255,139,0.3)', color: '#3fff8b',
            borderRadius: '4px', fontSize: '11px', fontWeight: 700, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '4px',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>add</span>
          Nova Role
        </button>
      </div>

      {error && (
        <div style={{
          padding: '8px 10px', marginBottom: '10px',
          backgroundColor: 'rgba(255,113,108,0.08)', border: '1px solid rgba(255,113,108,0.2)',
          color: '#ff716c', fontSize: '11px', borderRadius: '4px',
        }}>
          {error}
        </div>
      )}

      {creating && (
        <RoleEditor
          title="Nova role"
          initial={{ key: '', label: '', description: '' }}
          allowKey
          copySourceRoles={roles}
          onSave={(d) => void handleCreate(d)}
          onCancel={() => setCreating(false)}
        />
      )}

      {roles.map((r) => {
        const isExpanded = expanded === r.id;
        const granted = rolePerms[r.id] ?? new Set();
        return (
          <div key={r.id} style={{
            backgroundColor: '#131313',
            borderRadius: '6px',
            marginBottom: '8px',
            border: '1px solid rgba(73,72,71,0.2)',
            overflow: 'hidden',
          }}>
            <div
              onClick={() => setExpanded(isExpanded ? null : r.id)}
              style={{
                padding: '10px 12px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '13px', color: 'white', fontWeight: 700 }}>{r.label}</span>
                  {r.is_system && (
                    <span style={{
                      fontSize: '8px', padding: '1px 5px', backgroundColor: 'rgba(110,155,255,0.15)',
                      color: '#6e9bff', borderRadius: '2px', fontWeight: 700,
                    }}>
                      SYSTEM
                    </span>
                  )}
                </div>
                {r.description && (
                  <div style={{ fontSize: '10px', color: '#777575', marginTop: '2px' }}>{r.description}</div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '10px', color: '#3fff8b' }}>{granted.size} perms</span>
                {!r.is_system && (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditingId(editingId === r.id ? null : r.id); setError(null); }}
                      title="Editar"
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: '#fbbf24', display: 'flex', alignItems: 'center',
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>edit</span>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); void handleDelete(r); }}
                      title="Apagar"
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: '#ff716c', display: 'flex', alignItems: 'center',
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>delete</span>
                    </button>
                  </>
                )}
                <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#777575' }}>
                  {isExpanded ? 'expand_less' : 'expand_more'}
                </span>
              </div>
            </div>

            {editingId === r.id && (
              <RoleEditor
                title={`Editar "${r.label}"`}
                initial={{ key: r.key, label: r.label, description: r.description ?? '' }}
                allowKey={false}
                onSave={(d) => void handleSaveEdit(r.id, d)}
                onCancel={() => setEditingId(null)}
              />
            )}

            {isExpanded && (
              <div style={{ padding: '0 12px 12px', borderTop: '1px solid rgba(73,72,71,0.15)' }}>
                {Object.entries(grouped).map(([cat, list]) => (
                  <div key={cat} style={{ marginTop: '10px' }}>
                    <div style={{
                      fontSize: '9px', color: '#ff9f43', fontWeight: 700,
                      textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px',
                    }}>
                      {cat === 'core' ? 'Core (sempre activo)' : cat}
                    </div>
                    {list.map((p) => {
                      const has = granted.has(p.key);
                      const locked = p.is_core; // core perms always on
                      return (
                        <label key={p.key} style={{
                          display: 'flex', alignItems: 'center', gap: '8px',
                          padding: '5px 6px', borderRadius: '3px',
                          backgroundColor: has ? 'rgba(63,255,139,0.04)' : 'transparent',
                          cursor: locked ? 'not-allowed' : 'pointer',
                          opacity: locked ? 0.6 : 1,
                        }}>
                          <input
                            type="checkbox"
                            checked={has || locked}
                            disabled={locked || saving === r.id}
                            onChange={() => void togglePerm(r.id, p.key)}
                            style={{ accentColor: '#3fff8b' }}
                          />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '10px', color: 'white' }}>{p.label}</div>
                            <div style={{ fontSize: '8px', color: '#494847', fontFamily: 'monospace' }}>
                              {p.key}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── RoleEditor inline form ──────────────────────────────────
function RoleEditor({
  title,
  initial,
  allowKey,
  copySourceRoles,
  onSave,
  onCancel,
}: {
  title: string;
  initial: { key: string; label: string; description: string };
  allowKey: boolean;
  /** When set, shows a "copiar permissões de" dropdown for new-role creation. */
  copySourceRoles?: Role[];
  onSave: (data: { key: string; label: string; description: string; copyFromRoleId?: string }) => void;
  onCancel: () => void;
}) {
  const [key, setKey] = useState(initial.key);
  const [label, setLabel] = useState(initial.label);
  const [description, setDescription] = useState(initial.description);
  const [copyFromRoleId, setCopyFromRoleId] = useState<string>('');

  const valid = label.trim().length > 0 && (!allowKey || /^[a-z][a-z0-9_]*$/.test(key));

  return (
    <div style={{
      backgroundColor: '#0e0e0e',
      border: '1px solid rgba(63,255,139,0.3)',
      borderRadius: '6px',
      padding: '12px',
      marginBottom: '8px',
    }}>
      <div style={{ fontSize: '11px', color: '#3fff8b', fontWeight: 700, marginBottom: '8px' }}>
        {title}
      </div>
      {allowKey && (
        <div style={{ marginBottom: '6px' }}>
          <div style={{ fontSize: '9px', color: '#777575', marginBottom: '2px' }}>
            Key (snake_case, imutável depois)
          </div>
          <input
            type="text"
            value={key}
            onChange={(e) => setKey(e.target.value.toLowerCase())}
            placeholder="ex: shop_owner"
            style={inputStyle}
          />
        </div>
      )}
      <div style={{ marginBottom: '6px' }}>
        <div style={{ fontSize: '9px', color: '#777575', marginBottom: '2px' }}>Nome visível</div>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="ex: Dono de Oficina"
          style={inputStyle}
        />
      </div>
      <div style={{ marginBottom: '8px' }}>
        <div style={{ fontSize: '9px', color: '#777575', marginBottom: '2px' }}>Descrição (opcional)</div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          style={{ ...inputStyle, resize: 'vertical' as const }}
        />
      </div>
      {copySourceRoles && copySourceRoles.length > 0 && (
        <div style={{ marginBottom: '8px' }}>
          <div style={{ fontSize: '9px', color: '#777575', marginBottom: '2px' }}>
            Copiar permissões de (opcional)
          </div>
          <select
            value={copyFromRoleId}
            onChange={(e) => setCopyFromRoleId(e.target.value)}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            <option value="">— Começar vazia —</option>
            {copySourceRoles.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
        </div>
      )}
      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
          style={{
            padding: '5px 12px', backgroundColor: 'transparent',
            border: '1px solid rgba(73,72,71,0.3)', color: '#adaaaa',
            borderRadius: '4px', fontSize: '10px', fontWeight: 700, cursor: 'pointer',
          }}
        >
          Cancelar
        </button>
        <button
          onClick={() => onSave({ key, label, description, copyFromRoleId: copyFromRoleId || undefined })}
          disabled={!valid}
          style={{
            padding: '5px 12px',
            backgroundColor: valid ? '#3fff8b' : 'rgba(63,255,139,0.2)',
            border: 'none', color: valid ? '#0e0e0e' : '#777575',
            borderRadius: '4px', fontSize: '10px', fontWeight: 700,
            cursor: valid ? 'pointer' : 'not-allowed',
          }}
        >
          Guardar
        </button>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  backgroundColor: '#131313',
  border: '1px solid rgba(73,72,71,0.3)',
  borderRadius: '3px',
  color: 'white',
  fontSize: '11px',
  outline: 'none',
  fontFamily: 'inherit',
};

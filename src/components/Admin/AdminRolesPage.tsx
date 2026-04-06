// ═══════════════════════════════════════════════════════════
// AdminRolesPage — manage roles ↔ permissions
// ═══════════════════════════════════════════════════════════
//
// Lists all roles. Click one to expand the permission matrix.
// Toggle individual permissions per role. Core perms are always
// granted (locked). System roles cannot be deleted.

import { useEffect, useState } from 'react';
import {
  listRoles,
  listPermissions,
  getRolePermissions,
  setRolePermissions,
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

  useEffect(() => {
    void (async () => {
      const [r, p] = await Promise.all([listRoles(), listPermissions()]);
      setRoles(r);
      setPerms(p);
      // Pre-load all role permissions
      const map: Record<string, Set<string>> = {};
      for (const role of r) {
        const keys = await getRolePermissions(role.id);
        map[role.id] = new Set(keys);
      }
      setRolePerms(map);
      setLoading(false);
    })();
  }, []);

  const togglePerm = async (roleId: string, permKey: string) => {
    setSaving(roleId);
    const current = rolePerms[roleId] ?? new Set();
    if (current.has(permKey)) current.delete(permKey);
    else current.add(permKey);
    setRolePerms({ ...rolePerms, [roleId]: current });
    await setRolePermissions(roleId, Array.from(current));
    setSaving(null);
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
      <h2 className="font-headline font-bold" style={{ fontSize: '16px', color: '#3fff8b', marginBottom: '12px' }}>
        Roles ({roles.length}) · Permissões ({perms.length})
      </h2>

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
                <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#777575' }}>
                  {isExpanded ? 'expand_less' : 'expand_more'}
                </span>
              </div>
            </div>

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

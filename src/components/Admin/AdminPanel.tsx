// ═══════════════════════════════════════════════════════════
// AdminPanel — super admin shell with tabbed navigation
// ═══════════════════════════════════════════════════════════
//
// Visible only to users with `is_super_admin = true`. Wraps the
// individual admin pages (Users, Roles, Drive, System).

import { useState } from 'react';
import { useIsSuperAdmin } from '../../hooks/usePermission';
import { AdminUsersPage } from './AdminUsersPage';
import { AdminRolesPage } from './AdminRolesPage';
import { DriveStoragePage } from '../Settings/DriveStoragePage';

export type AdminTab = 'users' | 'roles' | 'drive' | 'system';

const TABS: { id: AdminTab; label: string; icon: string }[] = [
  { id: 'users', label: 'Utilizadores', icon: 'group' },
  { id: 'roles', label: 'Roles + Permissões', icon: 'admin_panel_settings' },
  { id: 'drive', label: 'Google Drive', icon: 'cloud' },
  { id: 'system', label: 'Sistema', icon: 'memory' },
];

export function AdminPanel({ initialTab = 'users' }: { initialTab?: AdminTab }) {
  const isSuperAdmin = useIsSuperAdmin();
  const [tab, setTab] = useState<AdminTab>(initialTab);

  if (!isSuperAdmin) {
    return (
      <div style={{
        padding: '24px', textAlign: 'center', color: '#777575',
        backgroundColor: '#0e0e0e', minHeight: '100%',
      }}>
        <span className="material-symbols-outlined" style={{ fontSize: '48px', color: '#ff716c', marginBottom: '12px' }}>
          block
        </span>
        <div style={{ fontSize: '14px', color: '#ff716c', fontWeight: 700, marginBottom: '4px' }}>
          Acesso negado
        </div>
        <div style={{ fontSize: '11px' }}>
          Esta área é apenas para super administradores.
        </div>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: '#0e0e0e', minHeight: '100%' }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        backgroundColor: '#131313',
        borderBottom: '1px solid rgba(73,72,71,0.2)',
        display: 'flex', alignItems: 'center', gap: '8px',
      }}>
        <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#ff9f43' }}>
          admin_panel_settings
        </span>
        <div>
          <div className="font-headline font-bold" style={{ fontSize: '15px', color: '#ff9f43' }}>
            Super Admin
          </div>
          <div style={{ fontSize: '9px', color: '#777575', marginTop: '1px' }}>
            Gestão da plataforma KROMI
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{
        display: 'flex',
        backgroundColor: '#131313',
        borderBottom: '1px solid rgba(73,72,71,0.2)',
        overflowX: 'auto',
      }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '10px 14px',
              background: 'none',
              border: 'none',
              borderBottom: tab === t.id ? '2px solid #ff9f43' : '2px solid transparent',
              color: tab === t.id ? '#ff9f43' : '#777575',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              whiteSpace: 'nowrap',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: '12px' }}>
        {tab === 'users' && <AdminUsersPage />}
        {tab === 'roles' && <AdminRolesPage />}
        {tab === 'drive' && <DriveStoragePage />}
        {tab === 'system' && <AdminSystemPage />}
      </div>
    </div>
  );
}

// ─── Quick System info page (simple) ─────────────────────────
function AdminSystemPage() {
  return (
    <div style={{ padding: '4px' }}>
      <h2 className="font-headline font-bold" style={{ fontSize: '16px', color: '#3fff8b', marginBottom: '12px' }}>
        Sistema
      </h2>
      <div style={{
        backgroundColor: '#131313', padding: '12px', borderRadius: '6px',
        border: '1px solid rgba(73,72,71,0.2)', fontSize: '11px', color: '#adaaaa', lineHeight: 1.5,
      }}>
        <div style={{ marginBottom: '8px' }}>
          <strong style={{ color: '#fbbf24' }}>Próximas features pendentes:</strong>
        </div>
        <ul style={{ paddingLeft: '16px', margin: 0 }}>
          <li>Refactor BikesPage / BikeFitPage / ShopManagement para usar KromiFileStore</li>
          <li>Migration script para fotos legadas em Supabase Storage</li>
          <li>Lista detalhada de impersonation_log + filtros</li>
          <li>Relatórios: storage usage por user, rides por user, etc.</li>
          <li>Ban / unban com timeline</li>
        </ul>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// AdminPanel — super admin shell with tabbed navigation
// ═══════════════════════════════════════════════════════════
//
// Visible only to users with `is_super_admin = true`. Wraps the
// individual admin pages (Users, Roles, Drive, System).

import { useEffect, useState } from 'react';
import { useIsSuperAdmin } from '../../hooks/usePermission';
import { AdminUsersPage } from './AdminUsersPage';
import { AdminRolesPage } from './AdminRolesPage';
import { AdminAuditPage } from './AdminAuditPage';
import { DriveStoragePage } from '../Settings/DriveStoragePage';
import {
  countLegacyPhotos,
  migrateLegacyPhotos,
  type MigrationProgress,
  type MigrationResult,
} from '../../services/storage/LegacyPhotoMigration';

export type AdminTab = 'users' | 'roles' | 'drive' | 'audit' | 'system';

const TABS: { id: AdminTab; label: string; icon: string }[] = [
  { id: 'users', label: 'Utilizadores', icon: 'group' },
  { id: 'roles', label: 'Roles + Permissões', icon: 'admin_panel_settings' },
  { id: 'drive', label: 'Google Drive', icon: 'cloud' },
  { id: 'audit', label: 'Auditoria', icon: 'history' },
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
        {tab === 'audit' && <AdminAuditPage />}
        {tab === 'system' && <AdminSystemPage />}
      </div>
    </div>
  );
}

// ─── System tab (migration tools, future maintenance ops) ────
function AdminSystemPage() {
  const [legacyCount, setLegacyCount] = useState<number | null>(null);
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const [result, setResult] = useState<MigrationResult | null>(null);
  const [running, setRunning] = useState(false);

  const refreshCount = async () => {
    try {
      setLegacyCount(await countLegacyPhotos());
    } catch {
      setLegacyCount(null);
    }
  };

  useEffect(() => { void refreshCount(); }, []);

  const runMigration = async () => {
    if (!confirm('Iniciar migração de fotos legadas? Esta operação pode levar minutos.')) return;
    setRunning(true);
    setResult(null);
    try {
      const r = await migrateLegacyPhotos((p) => setProgress(p));
      setResult(r);
      await refreshCount();
    } catch (e) {
      alert(`Erro: ${(e as Error).message}`);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  return (
    <div style={{ padding: '4px' }}>
      <h2 className="font-headline font-bold" style={{ fontSize: '16px', color: '#3fff8b', marginBottom: '12px' }}>
        Sistema
      </h2>

      {/* Legacy photo migration */}
      <div style={{
        backgroundColor: '#131313', padding: '14px', borderRadius: '6px',
        border: '1px solid rgba(73,72,71,0.2)', marginBottom: '10px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#fbbf24' }}>cloud_sync</span>
          <span style={{ fontSize: '12px', color: '#fbbf24', fontWeight: 700 }}>
            Migração de fotos legadas (Supabase Storage → Drive)
          </span>
        </div>
        <div style={{ fontSize: '10px', color: '#adaaaa', marginBottom: '10px', lineHeight: 1.5 }}>
          Re-faz upload via KromiFileStore das fotos com <code style={{ fontSize: '9px' }}>storage_path</code> mas
          sem <code style={{ fontSize: '9px' }}>file_id</code>. O <code style={{ fontSize: '9px' }}>storage_path</code> antigo
          mantém-se até validares manualmente.
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 10px', backgroundColor: '#0e0e0e', borderRadius: '4px', marginBottom: '8px',
        }}>
          <span style={{ fontSize: '11px', color: '#777575' }}>Por migrar:</span>
          <span style={{
            fontSize: '14px', color: legacyCount === 0 ? '#3fff8b' : '#fbbf24', fontWeight: 700,
          }}>
            {legacyCount === null ? '...' : legacyCount}
          </span>
        </div>
        <button
          onClick={() => void runMigration()}
          disabled={running || legacyCount === 0 || legacyCount === null}
          style={{
            width: '100%', padding: '8px',
            backgroundColor: running || !legacyCount ? 'rgba(251,191,36,0.15)' : '#fbbf24',
            color: running || !legacyCount ? '#777575' : '#0e0e0e',
            border: 'none', borderRadius: '4px', fontSize: '11px', fontWeight: 700,
            cursor: running || !legacyCount ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>
            {running ? 'hourglass_top' : 'play_arrow'}
          </span>
          {running ? 'A migrar...' : legacyCount === 0 ? 'Nada para migrar' : 'Iniciar migração'}
        </button>

        {progress && progress.total > 0 && (
          <div style={{ marginTop: '10px' }}>
            <div style={{
              height: '6px', backgroundColor: '#0e0e0e', borderRadius: '3px', overflow: 'hidden',
            }}>
              <div style={{
                width: `${(progress.done / progress.total) * 100}%`,
                height: '100%', backgroundColor: '#3fff8b', transition: 'width 0.3s',
              }} />
            </div>
            <div style={{ fontSize: '9px', color: '#777575', marginTop: '4px', textAlign: 'center' }}>
              {progress.done} / {progress.total} migradas
              {progress.failed > 0 && <span style={{ color: '#ff716c' }}> · {progress.failed} falharam</span>}
              {progress.current && <span> · {progress.current}</span>}
            </div>
          </div>
        )}

        {result && (
          <div style={{
            marginTop: '10px', padding: '8px',
            backgroundColor: result.failed.length === 0 ? 'rgba(63,255,139,0.05)' : 'rgba(255,113,108,0.05)',
            border: `1px solid ${result.failed.length === 0 ? 'rgba(63,255,139,0.2)' : 'rgba(255,113,108,0.2)'}`,
            borderRadius: '4px', fontSize: '10px',
          }}>
            <div style={{
              color: result.failed.length === 0 ? '#3fff8b' : '#ff716c',
              fontWeight: 700, marginBottom: '4px',
            }}>
              {result.failed.length === 0 ? '✓' : '⚠'} Migração concluída
            </div>
            <div style={{ color: '#adaaaa' }}>
              {result.migrated} / {result.total} migradas com sucesso
              {result.failed.length > 0 && (
                <div style={{ marginTop: '4px', color: '#ff716c' }}>
                  {result.failed.length} falharam:
                  <ul style={{ paddingLeft: '14px', margin: '2px 0 0' }}>
                    {result.failed.slice(0, 5).map((f) => (
                      <li key={f.id}><code style={{ fontSize: '9px' }}>{f.id.slice(0, 8)}</code>: {f.error}</li>
                    ))}
                    {result.failed.length > 5 && <li>... e mais {result.failed.length - 5}</li>}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Pending features */}
      <div style={{
        backgroundColor: '#131313', padding: '12px', borderRadius: '6px',
        border: '1px solid rgba(73,72,71,0.2)', fontSize: '11px', color: '#adaaaa', lineHeight: 1.5,
      }}>
        <div style={{ marginBottom: '8px' }}>
          <strong style={{ color: '#fbbf24' }}>Próximas features pendentes:</strong>
        </div>
        <ul style={{ paddingLeft: '16px', margin: 0 }}>
          <li>Filtros + paginação no log de auditoria</li>
          <li>Ban / unban com timeline</li>
        </ul>
      </div>
    </div>
  );
}

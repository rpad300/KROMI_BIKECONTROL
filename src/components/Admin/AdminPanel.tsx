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
import { AdminDashboardPage } from './AdminDashboardPage';
import { DriveStoragePage } from '../Settings/DriveStoragePage';
import { expireDueSuspensions } from '../../services/rbac/RBACService';
import { supaGet, supaRpc } from '../../lib/supaFetch';

export type AdminTab = 'dashboard' | 'users' | 'roles' | 'drive' | 'audit' | 'system';

const TABS: { id: AdminTab; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'users', label: 'Utilizadores', icon: 'group' },
  { id: 'roles', label: 'Roles + Permissões', icon: 'admin_panel_settings' },
  { id: 'drive', label: 'Google Drive', icon: 'cloud' },
  { id: 'audit', label: 'Auditoria', icon: 'history' },
  { id: 'system', label: 'Sistema', icon: 'memory' },
];

export function AdminPanel({ initialTab = 'dashboard' }: { initialTab?: AdminTab }) {
  const isSuperAdmin = useIsSuperAdmin();
  const [tab, setTab] = useState<AdminTab>(initialTab);

  // Session 18 scheduled unsuspend: sweep expired suspensions once per
  // admin visit. Fire-and-forget — the count is logged for visibility
  // but doesn't block the UI.
  useEffect(() => {
    if (!isSuperAdmin) return;
    void expireDueSuspensions().then((n) => {
      if (n > 0) console.log(`[AdminPanel] Auto-expired ${n} suspension(s)`);
    });
  }, [isSuperAdmin]);

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
        {tab === 'dashboard' && <AdminDashboardPage />}
        {tab === 'users' && <AdminUsersPage />}
        {tab === 'roles' && <AdminRolesPage />}
        {tab === 'drive' && <DriveStoragePage />}
        {tab === 'audit' && <AdminAuditPage />}
        {tab === 'system' && <AdminSystemPage />}
      </div>
    </div>
  );
}

// ─── System tab ──────────────────────────────────────────────
function AdminSystemPage() {
  return (
    <div style={{ padding: '4px' }}>
      <h2 className="font-headline font-bold" style={{ fontSize: '16px', color: '#3fff8b', marginBottom: '12px' }}>
        Sistema
      </h2>

      {/* Cron health */}
      <CronHealthViewer />

      {/* Rate limit viewer */}
      <RateLimitViewer />
    </div>
  );
}

// ─── Cron health viewer ────────────────────────────────────
//
// Summary of pg_cron worker status. Reads kromi_cron_job_status() RPC
// which returns one row per scheduled job with last run + 24h stats.
// The RPC is SECURITY DEFINER + gated on is_super_admin_jwt().

interface CronJobStatus {
  job_name: string;
  last_run_at: string | null;
  last_status: 'ok' | 'error' | 'running' | null;
  last_result: number | null;
  last_error: string | null;
  last_duration_ms: number | null;
  runs_24h: number;
  errors_24h: number;
}

function CronHealthViewer() {
  const [rows, setRows] = useState<CronJobStatus[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await supaRpc<CronJobStatus[]>('kromi_cron_job_status', {});
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <div style={{
      backgroundColor: '#131313', padding: '14px', borderRadius: '6px',
      border: '1px solid rgba(73,72,71,0.2)', marginBottom: '10px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#6e9bff' }}>schedule</span>
          <span style={{ fontSize: '12px', color: '#6e9bff', fontWeight: 700 }}>Cron jobs (pg_cron)</span>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          style={{
            padding: '4px 8px', fontSize: '9px', fontWeight: 700,
            backgroundColor: 'rgba(110,155,255,0.1)',
            border: '1px solid rgba(110,155,255,0.2)',
            borderRadius: '3px', color: '#6e9bff', cursor: 'pointer',
          }}
        >
          {loading ? '…' : 'Recarregar'}
        </button>
      </div>

      {error && (
        <div style={{ fontSize: '10px', color: '#ff716c' }}>{error}</div>
      )}

      {rows && rows.length === 0 && !error && (
        <div style={{ fontSize: '10px', color: '#777575' }}>
          Ainda sem execuções registadas — os jobs vão correr na próxima janela.
        </div>
      )}

      {rows && rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {rows.map((r) => {
            const statusColor =
              r.last_status === 'ok' ? '#3fff8b' :
              r.last_status === 'error' ? '#ff716c' :
              r.last_status === 'running' ? '#fbbf24' : '#777575';
            const staleMs = r.last_run_at ? Date.now() - new Date(r.last_run_at).getTime() : Infinity;
            const hoursAgo = Math.floor(staleMs / 3600000);
            return (
              <div key={r.job_name} style={{
                padding: '8px 10px', backgroundColor: '#0e0e0e', borderRadius: '4px',
                borderLeft: `3px solid ${statusColor}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontSize: '11px', color: '#adaaaa', fontWeight: 700 }}>{r.job_name}</span>
                  <span style={{ fontSize: '9px', color: statusColor, textTransform: 'uppercase', fontWeight: 700 }}>
                    {r.last_status ?? 'never run'}
                  </span>
                </div>
                <div style={{ fontSize: '9px', color: '#777575' }}>
                  {r.last_run_at
                    ? `Último run: ${hoursAgo < 1 ? '< 1h' : hoursAgo + 'h'} · ${r.last_duration_ms ?? '—'}ms · resultado: ${r.last_result ?? '—'}`
                    : 'Nunca correu'}
                </div>
                <div style={{ fontSize: '9px', color: '#777575' }}>
                  24h: {r.runs_24h} runs
                  {r.errors_24h > 0 && (
                    <span style={{ color: '#ff716c', fontWeight: 700 }}> · {r.errors_24h} erros</span>
                  )}
                </div>
                {r.last_error && (
                  <div style={{
                    fontSize: '9px', color: '#ff716c', marginTop: '4px',
                    padding: '4px', backgroundColor: 'rgba(255,113,108,0.08)',
                    borderRadius: '2px', fontFamily: 'monospace',
                  }}>
                    {r.last_error.slice(0, 200)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Rate limit viewer (Session 18) ──────────────────────────
//
// Reads the edge_function_rate_limits table, groups the most recent
// rejected windows per (function, identifier) pair. Only super admin
// has SELECT on this table via the S18 lockdown — regular users get
// 0 rows.

interface RateLimitRow {
  function_name: string;
  identifier: string;
  window_start: string;
  count: number;
}

function RateLimitViewer() {
  const [rows, setRows] = useState<RateLimitRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState(50);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await supaGet<RateLimitRow[]>(
        `/rest/v1/edge_function_rate_limits?select=*&order=window_start.desc&limit=${limit}`,
      );
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Group by function for at-a-glance caps
  const grouped = (rows ?? []).reduce((acc, r) => {
    const key = r.function_name;
    const g = acc.get(key) ?? { total: 0, maxCount: 0, identifiers: new Set<string>() };
    g.total += r.count;
    if (r.count > g.maxCount) g.maxCount = r.count;
    g.identifiers.add(r.identifier);
    acc.set(key, g);
    return acc;
  }, new Map<string, { total: number; maxCount: number; identifiers: Set<string> }>());

  return (
    <div style={{
      backgroundColor: '#131313', padding: '14px', borderRadius: '6px',
      border: '1px solid rgba(73,72,71,0.2)', marginBottom: '10px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#6e9bff' }}>speed</span>
          <span style={{ fontSize: '12px', color: '#6e9bff', fontWeight: 700 }}>
            Rate limit activity
          </span>
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <select
            value={limit}
            onChange={(e) => setLimit(parseInt(e.target.value, 10))}
            style={{
              padding: '4px 6px', backgroundColor: '#0e0e0e',
              border: '1px solid rgba(73,72,71,0.3)', borderRadius: '3px',
              color: 'white', fontSize: '10px', outline: 'none',
            }}
          >
            <option value={50}>Últimas 50</option>
            <option value={200}>Últimas 200</option>
            <option value={1000}>Últimas 1000</option>
          </select>
          <button
            onClick={() => void load()}
            disabled={loading}
            style={{
              padding: '4px 8px', fontSize: '9px', fontWeight: 700,
              backgroundColor: 'rgba(110,155,255,0.1)', border: '1px solid rgba(110,155,255,0.2)',
              borderRadius: '3px', color: '#6e9bff', cursor: 'pointer',
            }}
          >
            {loading ? '…' : 'Recarregar'}
          </button>
        </div>
      </div>

      <div style={{ fontSize: '10px', color: '#777575', marginBottom: '10px', lineHeight: 1.5 }}>
        Janelas recentes de token-bucket por função. Caps actuais:{' '}
        <code style={{ fontSize: '9px' }}>drive-storage=120/60s</code>,{' '}
        <code style={{ fontSize: '9px' }}>notify-impersonation=10/60s</code>.
      </div>

      {error && (
        <div style={{
          padding: '6px 8px', backgroundColor: 'rgba(255,113,108,0.1)',
          border: '1px solid rgba(255,113,108,0.2)', borderRadius: '3px',
          color: '#ff716c', fontSize: '10px', marginBottom: '8px',
        }}>
          {error}
        </div>
      )}

      {/* Per-function summary */}
      {grouped.size > 0 && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '6px', marginBottom: '10px',
        }}>
          {Array.from(grouped.entries()).map(([fn, g]) => (
            <div key={fn} style={{
              padding: '8px 10px', backgroundColor: '#0e0e0e', borderRadius: '4px',
              border: '1px solid rgba(73,72,71,0.2)',
            }}>
              <div style={{ fontSize: '10px', color: '#6e9bff', fontWeight: 700 }}>{fn}</div>
              <div style={{ fontSize: '9px', color: '#adaaaa', marginTop: '2px' }}>
                {g.identifiers.size} IP{g.identifiers.size !== 1 ? 's' : ''} · peak {g.maxCount}/janela
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Raw recent windows */}
      {rows === null && !loading && (
        <div style={{ fontSize: '10px', color: '#777575' }}>—</div>
      )}
      {rows && rows.length === 0 && (
        <div style={{
          padding: '12px', textAlign: 'center', color: '#3fff8b', fontSize: '10px',
          backgroundColor: 'rgba(63,255,139,0.05)', borderRadius: '4px',
        }}>
          Sem actividade de rate limit nas últimas janelas ✓
        </div>
      )}
      {rows && rows.length > 0 && (
        <div style={{
          maxHeight: '240px', overflow: 'auto',
          backgroundColor: '#0e0e0e', borderRadius: '4px', border: '1px solid rgba(73,72,71,0.2)',
        }}>
          <table style={{ width: '100%', fontSize: '9px', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, backgroundColor: '#131313' }}>
              <tr>
                <th style={rlTh}>Função</th>
                <th style={rlTh}>Identificador</th>
                <th style={{ ...rlTh, textAlign: 'right' }}>Count</th>
                <th style={rlTh}>Janela</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ borderTop: '1px solid rgba(73,72,71,0.15)' }}>
                  <td style={rlTd}>{r.function_name}</td>
                  <td style={{ ...rlTd, color: '#adaaaa' }}>{r.identifier}</td>
                  <td style={{ ...rlTd, textAlign: 'right', color: r.count >= 100 ? '#ff716c' : r.count >= 50 ? '#fbbf24' : '#3fff8b', fontWeight: 700 }}>
                    {r.count}
                  </td>
                  <td style={{ ...rlTd, color: '#777575' }}>
                    {new Date(r.window_start).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'medium' })}
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

const rlTh: React.CSSProperties = {
  textAlign: 'left', padding: '6px 8px', color: '#6e9bff',
  fontSize: '9px', fontWeight: 700, letterSpacing: '0.5px',
};
const rlTd: React.CSSProperties = {
  padding: '5px 8px', color: 'white', fontSize: '9px',
};

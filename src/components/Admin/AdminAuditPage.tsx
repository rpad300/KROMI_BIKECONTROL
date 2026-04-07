// ═══════════════════════════════════════════════════════════
// AdminAuditPage — recent impersonation log entries
// ═══════════════════════════════════════════════════════════
//
// Lists the most recent rows from `impersonation_log` joined to
// admin + target user emails. Read-only audit view for super admins.

import { useEffect, useState } from 'react';
import { listImpersonationLog, type ImpersonationLogEntry } from '../../services/rbac/RBACService';

function fmtDate(s: string): string {
  try {
    return new Date(s).toLocaleString('pt-PT', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return s;
  }
}

function fmtDuration(start: string, end: string | null): string {
  if (!end) return 'em curso';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return '—';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  return `${hours}h ${min % 60}m`;
}

export function AdminAuditPage() {
  const [entries, setEntries] = useState<ImpersonationLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    listImpersonationLog(100)
      .then(setEntries)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: '4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <h2 className="font-headline font-bold" style={{ fontSize: '16px', color: '#3fff8b', margin: 0 }}>
          Auditoria — Impersonation
        </h2>
        <button onClick={load} disabled={loading} style={{
          fontSize: '11px', padding: '4px 10px', backgroundColor: 'rgba(63,255,139,0.1)',
          border: '1px solid rgba(63,255,139,0.3)', color: '#3fff8b', borderRadius: '4px',
          cursor: loading ? 'wait' : 'pointer', fontWeight: 700,
        }}>
          {loading ? 'A carregar...' : 'Atualizar'}
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

      {!loading && entries.length === 0 && (
        <div style={{ fontSize: '11px', color: '#777575', textAlign: 'center', padding: '24px' }}>
          Sem registos de impersonation.
        </div>
      )}

      {entries.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {entries.map((e) => (
            <div key={e.id} style={{
              backgroundColor: '#131313', borderRadius: '6px', padding: '10px 12px',
              border: '1px solid rgba(73,72,71,0.2)', fontSize: '11px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '14px', color: '#ff9f43' }}>visibility</span>
                <span style={{ color: '#ff9f43', fontWeight: 700 }}>
                  {e.admin_email ?? e.admin_user_id.slice(0, 8)}
                </span>
                <span className="material-symbols-outlined" style={{ fontSize: '12px', color: '#494847' }}>arrow_forward</span>
                <span style={{ color: '#3fff8b', fontWeight: 700 }}>
                  {e.target_email ?? e.impersonated_user_id.slice(0, 8)}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '12px', color: '#777575', fontSize: '10px' }}>
                <span>{fmtDate(e.started_at)}</span>
                <span>· {fmtDuration(e.started_at, e.ended_at)}</span>
                {!e.ended_at && (
                  <span style={{ color: '#ff9f43', fontWeight: 700 }}>● ATIVO</span>
                )}
              </div>
              {e.reason && (
                <div style={{ color: '#adaaaa', fontSize: '10px', marginTop: '4px', fontStyle: 'italic' }}>
                  "{e.reason}"
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

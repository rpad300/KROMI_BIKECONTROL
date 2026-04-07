// ═══════════════════════════════════════════════════════════
// AdminAuditPage — recent impersonation log entries
// ═══════════════════════════════════════════════════════════
//
// Lists the most recent rows from `impersonation_log` joined to admin +
// target user emails. Supports filters (admin/target email, since, active
// only) and load-more pagination via the cursor returned by listImpersonationLog.

import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  listImpersonationLog,
  listAllUsers,
  type ImpersonationLogEntry,
  type ImpersonationLogFilter,
  type AdminUserRow,
} from '../../services/rbac/RBACService';

const PAGE_SIZE = 50;

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
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [entries, setEntries] = useState<ImpersonationLogEntry[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [adminId, setAdminId] = useState<string>('');
  const [targetId, setTargetId] = useState<string>('');
  const [since, setSince] = useState<string>('');
  const [until, setUntil] = useState<string>('');
  const [activeOnly, setActiveOnly] = useState(false);

  const filter: ImpersonationLogFilter = useMemo(() => ({
    admin_user_id: adminId || undefined,
    target_user_id: targetId || undefined,
    since: since ? new Date(since).toISOString() : undefined,
    until: until ? new Date(until + 'T23:59:59').toISOString() : undefined,
    active_only: activeOnly || undefined,
  }), [adminId, targetId, since, until, activeOnly]);

  const loadFirstPage = useCallback(() => {
    setLoading(true);
    setError(null);
    listImpersonationLog(filter, { limit: PAGE_SIZE, offset: 0 })
      .then((page) => {
        setEntries(page.rows);
        setTotal(page.total);
        setHasMore(page.has_more);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [filter]);

  const loadMore = useCallback(() => {
    setLoading(true);
    listImpersonationLog(filter, { limit: PAGE_SIZE, offset: entries.length })
      .then((page) => {
        setEntries((prev) => [...prev, ...page.rows]);
        setHasMore(page.has_more);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [filter, entries.length]);

  // Initial: fetch users for the filter dropdowns
  useEffect(() => {
    listAllUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

  // Re-fetch first page when filter changes
  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  const clearFilters = () => {
    setAdminId('');
    setTargetId('');
    setSince('');
    setUntil('');
    setActiveOnly(false);
  };

  const hasFilter = !!(adminId || targetId || since || until || activeOnly);

  return (
    <div style={{ padding: '4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <h2 className="font-headline font-bold" style={{ fontSize: '16px', color: '#3fff8b', margin: 0 }}>
          Auditoria — Impersonation
          {total !== null && <span style={{ color: '#777575', fontSize: '11px', fontWeight: 400, marginLeft: '6px' }}>({total})</span>}
        </h2>
        <button onClick={loadFirstPage} disabled={loading} style={btnGreen(loading)}>
          {loading ? '...' : 'Atualizar'}
        </button>
      </div>

      {/* Filters */}
      <div style={{
        backgroundColor: '#131313', padding: '10px', borderRadius: '6px',
        border: '1px solid rgba(73,72,71,0.2)', marginBottom: '10px',
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' }}>
          <Field label="Admin">
            <select value={adminId} onChange={(e) => setAdminId(e.target.value)} style={selectStyle}>
              <option value="">Todos</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.email}</option>
              ))}
            </select>
          </Field>
          <Field label="Target">
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)} style={selectStyle}>
              <option value="">Todos</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.email}</option>
              ))}
            </select>
          </Field>
          <Field label="Desde">
            <input type="date" value={since} onChange={(e) => setSince(e.target.value)} style={selectStyle} />
          </Field>
          <Field label="Até">
            <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} style={selectStyle} />
          </Field>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '8px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#adaaaa', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(e) => setActiveOnly(e.target.checked)}
              style={{ accentColor: '#ff9f43' }}
            />
            Só sessões ativas
          </label>
          {hasFilter && (
            <button onClick={clearFilters} style={{
              fontSize: '10px', color: '#777575', background: 'none', border: 'none', cursor: 'pointer',
            }}>
              Limpar filtros
            </button>
          )}
        </div>
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
          {hasFilter ? 'Nenhum registo corresponde aos filtros.' : 'Sem registos de impersonation.'}
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

      {hasMore && (
        <button
          onClick={loadMore}
          disabled={loading}
          style={{
            marginTop: '10px',
            width: '100%',
            padding: '10px',
            backgroundColor: 'rgba(63,255,139,0.05)',
            border: '1px solid rgba(63,255,139,0.2)',
            borderRadius: '4px',
            color: '#3fff8b',
            fontSize: '11px',
            fontWeight: 700,
            cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? 'A carregar...' : `Carregar mais (${entries.length}${total !== null ? ` / ${total}` : ''})`}
        </button>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '9px', color: '#777575', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>
        {label}
      </div>
      {children}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  backgroundColor: '#0e0e0e',
  border: '1px solid rgba(73,72,71,0.3)',
  borderRadius: '3px',
  color: 'white',
  fontSize: '11px',
  outline: 'none',
  fontFamily: 'inherit',
};

function btnGreen(disabled: boolean): React.CSSProperties {
  return {
    fontSize: '11px', padding: '4px 10px', backgroundColor: 'rgba(63,255,139,0.1)',
    border: '1px solid rgba(63,255,139,0.3)', color: '#3fff8b', borderRadius: '4px',
    cursor: disabled ? 'wait' : 'pointer', fontWeight: 700,
  };
}

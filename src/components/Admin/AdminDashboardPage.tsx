// ═══════════════════════════════════════════════════════════
// AdminDashboardPage — at-a-glance platform health (Session 18)
// ═══════════════════════════════════════════════════════════
//
// Three charts sourced from existing tables (no new schema):
//   1. New users per week — app_users.created_at
//   2. Storage growth (cumulative) — kromi_files.created_at + size_bytes
//   3. Impersonation frequency per day — impersonation_log.started_at
//
// Rendered as the default first tab in the AdminPanel so super admins
// see platform pulse immediately. All queries go through the normal
// JWT'd supaFetch path — the existing "super admin bypass" in the
// S18 policies lets us read every row.

import { useEffect, useMemo, useState } from 'react';
import { supaGet } from '../../lib/supaFetch';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';

interface UserRow { created_at: string; email?: string }
interface FileRow { created_at: string; size_bytes: number | null; file_name?: string }
interface ImpRow { started_at: string; admin_email?: string; target_email?: string }
interface RideRow { started_at: string; user_id: string }

type FeedItem =
  | { kind: 'user'; at: string; label: string }
  | { kind: 'file'; at: string; label: string }
  | { kind: 'imp'; at: string; label: string }
  | { kind: 'ride'; at: string; label: string };

interface Stats {
  users: UserRow[];
  files: FileRow[];
  imps: ImpRow[];
  rides: RideRow[];
  totalUsers: number;
  totalFiles: number;
  totalBytes: number;
}

export function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [users, files, imps, rides] = await Promise.all([
        supaGet<UserRow[]>('/rest/v1/app_users?select=created_at,email&order=created_at.asc&limit=5000'),
        supaGet<FileRow[]>('/rest/v1/kromi_files?select=created_at,size_bytes,file_name&order=created_at.asc&limit=10000'),
        supaGet<ImpRow[]>('/rest/v1/impersonation_log?select=started_at,admin_email,target_email&order=started_at.asc&limit=2000'),
        supaGet<RideRow[]>('/rest/v1/ride_sessions?select=started_at,user_id&order=started_at.desc&limit=200'),
      ]);
      const safeUsers = Array.isArray(users) ? users : [];
      const safeFiles = Array.isArray(files) ? files : [];
      const safeImps = Array.isArray(imps) ? imps : [];
      const safeRides = Array.isArray(rides) ? rides : [];
      setStats({
        users: safeUsers,
        files: safeFiles,
        imps: safeImps,
        rides: safeRides,
        totalUsers: safeUsers.length,
        totalFiles: safeFiles.length,
        totalBytes: safeFiles.reduce((s, f) => s + (f.size_bytes ?? 0), 0),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  // ── Derived series ────────────────────────────────────────
  const newUsersPerWeek = useMemo(() => {
    if (!stats) return [];
    return bucketByWeek(stats.users.map((u) => u.created_at));
  }, [stats]);

  const storageGrowth = useMemo(() => {
    if (!stats) return [];
    // Sort by date, compute cumulative bytes per day
    const sorted = [...stats.files].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    const byDay = new Map<string, number>();
    let running = 0;
    for (const f of sorted) {
      running += f.size_bytes ?? 0;
      const day = f.created_at.slice(0, 10);
      byDay.set(day, running);
    }
    return Array.from(byDay.entries()).map(([date, bytes]) => ({ date, bytes, mb: bytes / (1024 * 1024) }));
  }, [stats]);

  // Unified reverse-chronological activity feed — cheap, works at any data scale.
  const recentActivity = useMemo<FeedItem[]>(() => {
    if (!stats) return [];
    const items: FeedItem[] = [
      ...stats.users.map<FeedItem>((u) => ({
        kind: 'user', at: u.created_at, label: u.email ?? '(sem email)',
      })),
      ...stats.files.map<FeedItem>((f) => ({
        kind: 'file', at: f.created_at, label: f.file_name ?? '(sem nome)',
      })),
      ...stats.imps.map<FeedItem>((i) => ({
        kind: 'imp', at: i.started_at,
        label: `${i.admin_email ?? '?'} → ${i.target_email ?? '?'}`,
      })),
      ...stats.rides.map<FeedItem>((r) => ({
        kind: 'ride', at: r.started_at, label: r.user_id.slice(0, 8),
      })),
    ];
    return items
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 15);
  }, [stats]);

  const impsPerDay = useMemo(() => {
    if (!stats) return [];
    const byDay = new Map<string, number>();
    for (const i of stats.imps) {
      const day = i.started_at.slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));
  }, [stats]);

  return (
    <div style={{ padding: '4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <h2 className="font-headline font-bold" style={{ fontSize: '16px', color: '#3fff8b' }}>
          Dashboard
        </h2>
        <button
          onClick={() => void load()}
          disabled={loading}
          style={{
            padding: '6px 10px', fontSize: '10px', fontWeight: 700,
            backgroundColor: 'rgba(110,155,255,0.1)', border: '1px solid rgba(110,155,255,0.2)',
            borderRadius: '4px', color: '#6e9bff', cursor: 'pointer',
          }}
        >
          {loading ? '…' : 'Recarregar'}
        </button>
      </div>

      {error && (
        <div style={{
          padding: '8px 10px', fontSize: '10px', color: '#ff716c',
          backgroundColor: 'rgba(255,113,108,0.1)', border: '1px solid rgba(255,113,108,0.2)',
          borderRadius: '4px', marginBottom: '10px',
        }}>
          {error}
        </div>
      )}

      {/* KPI tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px', marginBottom: '14px' }}>
        <KpiTile label="Utilizadores" value={stats?.totalUsers ?? '—'} color="#3fff8b" icon="group" />
        <KpiTile label="Ficheiros" value={stats?.totalFiles ?? '—'} color="#6e9bff" icon="folder" />
        <KpiTile label="Storage total" value={stats ? formatBytes(stats.totalBytes) : '—'} color="#fbbf24" icon="cloud" />
        <KpiTile label="Impersonations" value={stats?.imps.length ?? '—'} color="#ff9f43" icon="visibility" />
      </div>

      {/* Charts */}
      <ChartCard title="Novos utilizadores por semana" color="#3fff8b">
        {newUsersPerWeek.length === 0 ? (
          <EmptyChart />
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={newUsersPerWeek} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="rgba(73,72,71,0.15)" vertical={false} />
              <XAxis dataKey="week" tick={{ fill: '#777575', fontSize: 9 }} axisLine={{ stroke: '#262626' }} />
              <YAxis tick={{ fill: '#777575', fontSize: 9 }} axisLine={{ stroke: '#262626' }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ backgroundColor: '#0e0e0e', border: '1px solid #3fff8b', borderRadius: '4px', fontSize: '11px' }}
                labelStyle={{ color: '#3fff8b' }}
              />
              <Bar dataKey="count" fill="#3fff8b" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="Crescimento de storage (cumulativo, MB)" color="#fbbf24">
        {storageGrowth.length === 0 ? (
          <EmptyChart />
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={storageGrowth} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="rgba(73,72,71,0.15)" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: '#777575', fontSize: 9 }} axisLine={{ stroke: '#262626' }} />
              <YAxis tick={{ fill: '#777575', fontSize: 9 }} axisLine={{ stroke: '#262626' }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#0e0e0e', border: '1px solid #fbbf24', borderRadius: '4px', fontSize: '11px' }}
                labelStyle={{ color: '#fbbf24' }}
                formatter={(v: number) => [`${v.toFixed(1)} MB`, 'Total']}
              />
              <Area type="monotone" dataKey="mb" stroke="#fbbf24" fill="rgba(251,191,36,0.2)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="Actividade recente" color="#6e9bff">
        {recentActivity.length === 0 ? (
          <EmptyChart />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '260px', overflowY: 'auto' }}>
            {recentActivity.map((item, idx) => (
              <FeedRow key={`${item.kind}-${item.at}-${idx}`} item={item} />
            ))}
          </div>
        )}
      </ChartCard>

      <ChartCard title="Impersonations por dia" color="#ff9f43">
        {impsPerDay.length === 0 ? (
          <EmptyChart />
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={impsPerDay} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="rgba(73,72,71,0.15)" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: '#777575', fontSize: 9 }} axisLine={{ stroke: '#262626' }} />
              <YAxis tick={{ fill: '#777575', fontSize: 9 }} axisLine={{ stroke: '#262626' }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ backgroundColor: '#0e0e0e', border: '1px solid #ff9f43', borderRadius: '4px', fontSize: '11px' }}
                labelStyle={{ color: '#ff9f43' }}
              />
              <Line type="monotone" dataKey="count" stroke="#ff9f43" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </div>
  );
}

// ─── Small presentational bits ──────────────────────────────

function KpiTile({ label, value, color, icon }: { label: string; value: number | string; color: string; icon: string }) {
  return (
    <div style={{
      backgroundColor: '#131313', padding: '12px 14px', borderRadius: '6px',
      border: '1px solid rgba(73,72,71,0.2)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
        <span className="material-symbols-outlined" style={{ fontSize: '14px', color }}>{icon}</span>
        <span style={{ fontSize: '9px', color: '#777575', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</span>
      </div>
      <div style={{ fontSize: '18px', color, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function ChartCard({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <div style={{
      backgroundColor: '#131313', padding: '12px 14px', borderRadius: '6px',
      border: '1px solid rgba(73,72,71,0.2)', marginBottom: '10px',
    }}>
      <div style={{ fontSize: '11px', color, fontWeight: 700, marginBottom: '8px' }}>{title}</div>
      {children}
    </div>
  );
}

function FeedRow({ item }: { item: FeedItem }) {
  const config: Record<FeedItem['kind'], { icon: string; color: string; label: string }> = {
    user: { icon: 'person_add', color: '#3fff8b', label: 'Novo user' },
    file: { icon: 'cloud_upload', color: '#fbbf24', label: 'Upload' },
    imp:  { icon: 'visibility',  color: '#ff9f43', label: 'Impersonation' },
    ride: { icon: 'pedal_bike',  color: '#6e9bff', label: 'Ride' },
  };
  const c = config[item.kind];
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '8px',
      padding: '6px 8px', backgroundColor: 'rgba(14,14,14,0.5)',
      borderRadius: '4px', fontSize: '10px',
    }}>
      <span className="material-symbols-outlined" style={{ fontSize: '14px', color: c.color }}>{c.icon}</span>
      <span style={{ color: c.color, fontWeight: 700, minWidth: '85px' }}>{c.label}</span>
      <span style={{ color: '#adaaaa', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {item.label}
      </span>
      <span style={{ color: '#777575', fontSize: '9px', whiteSpace: 'nowrap' }}>{formatRelative(item.at)}</span>
    </div>
  );
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  return new Date(iso).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' });
}

function EmptyChart() {
  return (
    <div style={{ textAlign: 'center', padding: '30px 0', color: '#494847', fontSize: '10px' }}>
      Sem dados ainda
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────

function bucketByWeek(isoDates: string[]): Array<{ week: string; count: number }> {
  const byWeek = new Map<string, number>();
  for (const iso of isoDates) {
    const d = new Date(iso);
    // ISO week key: YYYY-Www (UTC). Not calendar-perfect but stable for charting.
    const year = d.getUTCFullYear();
    const onejan = new Date(Date.UTC(year, 0, 1));
    const weekNum = Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getUTCDay() + 1) / 7);
    const key = `${year}-W${String(weekNum).padStart(2, '0')}`;
    byWeek.set(key, (byWeek.get(key) ?? 0) + 1);
  }
  return Array.from(byWeek.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, count]) => ({ week, count }));
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

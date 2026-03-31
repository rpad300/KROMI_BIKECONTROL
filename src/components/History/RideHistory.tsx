import { useState, useEffect } from 'react';
import { useAuthStore } from '../../store/authStore';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

interface RideSummary {
  id: string;
  created_at: string;
  status: string;
  distance_km: number;
  duration_s: number;
  elevation_gain_m: number;
  avg_power_w: number;
  max_power_w: number;
  avg_speed_kmh: number;
  battery_start: number;
  battery_end: number;
  tss: number;
}

function formatDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}h` : `${m}min`;
}

function formatDate(iso: string): { day: string; weekday: string } {
  const d = new Date(iso);
  const day = d.toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' });
  const weekday = d.toLocaleDateString('pt-PT', { weekday: 'short' });
  return { day, weekday };
}

function intensityColor(tss: number): string {
  if (tss > 200) return 'bg-red-400';
  if (tss > 100) return 'bg-yellow-400';
  return 'bg-emerald-400';
}

export function RideHistory() {
  const [rides, setRides] = useState<RideSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const userId = useAuthStore((s) => s.getUserId?.() ?? null);

  useEffect(() => {
    loadRides();
  }, []);

  async function loadRides() {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/ride_sessions?status=eq.completed&order=created_at.desc&limit=20${
          userId ? `&user_id=eq.${userId}` : ''
        }`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
        }
      );
      if (res.ok) {
        const data = await res.json();
        setRides(data);
      }
    } catch {
      // Silently fail — show empty state
    } finally {
      setLoading(false);
    }
  }

  // Monthly aggregates
  const now = new Date();
  const thisMonth = rides.filter((r) => {
    const d = new Date(r.created_at);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const totalDist = thisMonth.reduce((s, r) => s + (r.distance_km || 0), 0);
  const totalElev = thisMonth.reduce((s, r) => s + (r.elevation_gain_m || 0), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-3 gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-emerald-400">Ride History</h1>
        <button
          onClick={loadRides}
          className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center active:bg-gray-700"
        >
          <span className="material-symbols-outlined text-gray-400">filter_list</span>
        </button>
      </div>

      {/* Monthly summary */}
      <div className="flex gap-2">
        <SummaryPill icon="directions_bike" value={`${thisMonth.length}`} label="Rides" />
        <SummaryPill icon="straighten" value={`${Math.round(totalDist)}`} label="km" />
        <SummaryPill icon="terrain" value={`${Math.round(totalElev)}`} label="m ↑" />
      </div>

      {/* Ride list */}
      <div className="flex-1 space-y-2 overflow-y-auto min-h-0">
        {rides.length === 0 ? (
          <EmptyState />
        ) : (
          rides.slice(0, 10).map((ride, i) => (
            <RideCard key={ride.id} ride={ride} highlight={i === 0} />
          ))
        )}
      </div>
    </div>
  );
}

function RideCard({ ride, highlight }: { ride: RideSummary; highlight: boolean }) {
  const { day, weekday } = formatDate(ride.created_at);

  return (
    <div
      className={`bg-gray-800/60 rounded-xl p-3 flex gap-3 border-l-[3px] ${
        highlight ? 'border-l-emerald-500' : 'border-l-gray-700'
      }`}
    >
      {/* Date column */}
      <div className="flex flex-col items-center justify-center min-w-[50px]">
        <span className="text-sm font-bold text-white">{day}</span>
        <span className="text-xs text-gray-500 capitalize">{weekday}</span>
      </div>

      {/* Metrics */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
          <span>{(ride.distance_km || 0).toFixed(1)} km</span>
          <span>{formatDuration(ride.duration_s || 0)}</span>
          <span>{Math.round(ride.elevation_gain_m || 0)}m ↑</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
          <span>{Math.round(ride.avg_power_w || 0)}W avg</span>
          <span>TSS {Math.round(ride.tss || 0)}</span>
          <span>🔋 {ride.battery_start ?? 0}→{ride.battery_end ?? 0}%</span>
        </div>
      </div>

      {/* Intensity dot */}
      <div className="flex items-center">
        <div className={`w-3 h-3 rounded-full ${intensityColor(ride.tss || 0)}`} />
      </div>
    </div>
  );
}

function SummaryPill({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <div className="flex-1 bg-gray-800 rounded-lg px-3 py-2.5 flex items-center gap-2">
      <span className="material-symbols-outlined text-emerald-400 text-lg">{icon}</span>
      <div>
        <div className="text-sm font-bold text-white">{value}</div>
        <div className="text-xs text-gray-500">{label}</div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-gray-500">
      <span className="material-symbols-outlined text-6xl">history</span>
      <div className="text-center">
        <p className="text-lg font-bold text-gray-400">Sem rides gravados</p>
        <p className="text-sm mt-1">Inicia uma sessao no Dashboard para comecar a gravar</p>
      </div>
    </div>
  );
}

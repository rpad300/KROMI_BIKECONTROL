import { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '../../store/authStore';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const POLL_INTERVAL = 5000;

interface ActiveSession {
  id: string;
  started_at: string;
  battery_start: number;
  devices_connected: Record<string, boolean>;
}

interface Snapshot {
  elapsed_s: number;
  lat: number;
  lng: number;
  speed_kmh: number;
  power_watts: number;
  cadence_rpm: number;
  battery_pct: number;
  assist_mode: number;
  hr_bpm: number;
  altitude_m: number | null;
  gradient_pct: number;
  distance_km: number;
}

const MODE_NAMES: Record<number, string> = {
  0: 'MANUAL', 1: 'ECO', 2: 'TOUR', 3: 'ACTIVE', 4: 'SPORT', 5: 'POWER', 6: 'SMART',
};

/**
 * LiveRideView — desktop component that shows a live ride in progress.
 * Polls Supabase every 5s for active ride_session + latest snapshots.
 */
export function LiveRideView() {
  const userId = useAuthStore((s) => s.user?.id);
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [latest, setLatest] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!userId || !SUPABASE_URL || !SUPABASE_KEY) {
      setLoading(false);
      return;
    }

    const poll = async () => {
      try {
        // 1. Check for active session
        const sessRes = await fetch(
          `${SUPABASE_URL}/rest/v1/ride_sessions?user_id=eq.${userId}&status=eq.active&select=id,started_at,battery_start,devices_connected&limit=1&order=started_at.desc`,
          { headers: { 'apikey': SUPABASE_KEY!, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
        );
        const sessions = await sessRes.json();

        if (!Array.isArray(sessions) || sessions.length === 0) {
          setSession(null);
          setSnapshots([]);
          setLatest(null);
          setLoading(false);
          return;
        }

        const activeSession = sessions[0] as ActiveSession;
        setSession(activeSession);

        // 2. Get latest snapshots (last 500 for path + last 1 for live data)
        const snapRes = await fetch(
          `${SUPABASE_URL}/rest/v1/ride_snapshots?session_id=eq.${activeSession.id}&select=elapsed_s,lat,lng,speed_kmh,power_watts,cadence_rpm,battery_pct,assist_mode,hr_bpm,altitude_m,gradient_pct,distance_km&order=elapsed_s.asc&limit=500`,
          { headers: { 'apikey': SUPABASE_KEY!, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
        );
        const snaps = (await snapRes.json()) as Snapshot[];
        setSnapshots(snaps);
        if (snaps.length > 0) {
          setLatest(snaps[snaps.length - 1]!);
        }
      } catch (err) {
        console.warn('[LiveRide] Poll failed:', err);
      }
      setLoading(false);
    };

    poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [userId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="bg-gray-800 rounded-xl p-8 text-center">
        <span className="material-symbols-outlined text-4xl text-gray-600">directions_bike</span>
        <h3 className="text-lg font-bold text-gray-400 mt-3">Nenhuma volta activa</h3>
        <p className="text-sm text-gray-600 mt-1">
          Quando iniciares uma volta no telemóvel, os dados aparecem aqui em tempo real.
        </p>
      </div>
    );
  }

  const elapsed = latest ? latest.elapsed_s : 0;
  const hours = Math.floor(elapsed / 3600);
  const mins = Math.floor((elapsed % 3600) / 60);
  const secs = elapsed % 60;
  const timeStr = hours > 0
    ? `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    : `${mins}:${secs.toString().padStart(2, '0')}`;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
          <h2 className="text-lg font-bold text-white">Volta em curso</h2>
        </div>
        <span className="text-sm text-gray-500">{snapshots.length} pontos</span>
      </div>

      {/* Live metrics grid */}
      {latest && (
        <div className="grid grid-cols-4 gap-3">
          <MetricCard label="Velocidade" value={`${latest.speed_kmh.toFixed(1)}`} unit="km/h" color="text-white" />
          <MetricCard label="Potência" value={`${latest.power_watts}`} unit="W" color="text-yellow-400" />
          <MetricCard label="Cadência" value={`${latest.cadence_rpm}`} unit="rpm" color="text-blue-400" />
          <MetricCard label="Bateria" value={`${latest.battery_pct}`} unit="%"
            color={latest.battery_pct > 30 ? 'text-emerald-400' : latest.battery_pct > 15 ? 'text-yellow-400' : 'text-red-400'} />
          <MetricCard label="Distância" value={`${latest.distance_km.toFixed(1)}`} unit="km" color="text-white" />
          <MetricCard label="Tempo" value={timeStr} unit="" color="text-white" />
          <MetricCard label="Gradiente" value={`${latest.gradient_pct.toFixed(1)}`} unit="%" color="text-orange-400" />
          <MetricCard label="Modo" value={MODE_NAMES[latest.assist_mode] ?? '?'} unit=""
            color={latest.assist_mode === 5 ? 'text-red-400' : 'text-gray-400'} />
          {latest.hr_bpm > 0 && (
            <MetricCard label="FC" value={`${latest.hr_bpm}`} unit="bpm" color="text-red-400" />
          )}
          {latest.altitude_m && (
            <MetricCard label="Altitude" value={`${Math.round(latest.altitude_m)}`} unit="m" color="text-cyan-400" />
          )}
        </div>
      )}

      {/* Map with path */}
      {snapshots.length > 0 && snapshots[0]!.lat !== 0 && (
        <div className="bg-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-bold text-gray-400 mb-2">Percurso</h3>
          <div className="text-xs text-gray-600">
            De ({snapshots[0]!.lat.toFixed(4)}, {snapshots[0]!.lng.toFixed(4)})
            → ({snapshots[snapshots.length - 1]!.lat.toFixed(4)}, {snapshots[snapshots.length - 1]!.lng.toFixed(4)})
          </div>
          <div className="text-[10px] text-gray-700 mt-1">
            Mapa interactivo em desenvolvimento — GPS path com {snapshots.filter(s => s.lat !== 0).length} pontos
          </div>
        </div>
      )}

      {/* Session info */}
      <div className="text-xs text-gray-600 flex justify-between">
        <span>Início: {new Date(session.started_at).toLocaleTimeString()}</span>
        <span>Bateria início: {session.battery_start}%</span>
        <span>Actualiza a cada 5s</span>
      </div>
    </div>
  );
}

function MetricCard({ label, value, unit, color }: {
  label: string; value: string; unit: string; color: string;
}) {
  return (
    <div className="bg-gray-800 rounded-xl p-3">
      <div className={`text-xl font-bold tabular-nums ${color}`}>{value}<span className="text-xs text-gray-500 ml-1">{unit}</span></div>
      <div className="text-[10px] text-gray-600">{label}</div>
    </div>
  );
}

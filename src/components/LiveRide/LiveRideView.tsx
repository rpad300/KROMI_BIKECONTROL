import { useState, useEffect, useRef, useCallback } from 'react';
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { useAuthStore } from '../../store/authStore';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
const POLL_INTERVAL = 5000;

interface ActiveSession {
  id: string;
  started_at: string;
  battery_start: number;
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
  0: 'MAN', 1: 'ECO', 2: 'TOUR', 3: 'ACTIVE', 4: 'SPORT', 5: 'PWR', 6: 'SMART',
};

export function LiveRideView() {
  const userId = useAuthStore((s) => s.user?.id);
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [latest, setLatest] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);

  const poll = useCallback(async () => {
    if (!userId || !SUPABASE_URL || !SUPABASE_KEY) { setLoading(false); return; }
    try {
      const sessRes = await fetch(
        `${SUPABASE_URL}/rest/v1/ride_sessions?user_id=eq.${userId}&status=eq.active&select=id,started_at,battery_start&limit=1&order=started_at.desc`,
        { headers: { 'apikey': SUPABASE_KEY!, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
      );
      const sessions = await sessRes.json();
      if (!Array.isArray(sessions) || sessions.length === 0) {
        setSession(null); setSnapshots([]); setLatest(null); setLoading(false);
        return;
      }
      const active = sessions[0] as ActiveSession;
      setSession(active);

      const snapRes = await fetch(
        `${SUPABASE_URL}/rest/v1/ride_snapshots?session_id=eq.${active.id}&select=elapsed_s,lat,lng,speed_kmh,power_watts,cadence_rpm,battery_pct,assist_mode,hr_bpm,altitude_m,gradient_pct,distance_km&order=elapsed_s.asc&limit=2000`,
        { headers: { 'apikey': SUPABASE_KEY!, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
      );
      const snaps = (await snapRes.json()) as Snapshot[];
      setSnapshots(snaps);
      if (snaps.length > 0) setLatest(snaps[snaps.length - 1]!);
    } catch { /* silent */ }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [poll]);

  // === Google Map — init + update path ===
  useEffect(() => {
    if (!mapRef.current || !MAPS_KEY || googleMapRef.current) return;
    const gpsPoints = snapshots.filter((s) => s.lat !== 0 && s.lng !== 0);
    if (gpsPoints.length === 0) return;

    // Load Google Maps script if not loaded
    if (!window.google?.maps) {
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}`;
      script.onload = () => initMap(gpsPoints);
      document.head.appendChild(script);
    } else {
      initMap(gpsPoints);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshots.length > 0 && !googleMapRef.current]);

  function initMap(points: Snapshot[]) {
    if (!mapRef.current || googleMapRef.current) return;
    const last = points[points.length - 1]!;
    const map = new google.maps.Map(mapRef.current, {
      center: { lat: last.lat, lng: last.lng },
      zoom: 14,
      mapTypeId: 'terrain',
      disableDefaultUI: true,
      zoomControl: true,
      styles: [
        { elementType: 'geometry', stylers: [{ color: '#1a1a2e' }] },
        { elementType: 'labels.text.fill', stylers: [{ color: '#8a8a8a' }] },
        { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2a2a3e' }] },
        { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0a0a1e' }] },
      ],
    });
    googleMapRef.current = map;

    // Polyline (ride path)
    polylineRef.current = new google.maps.Polyline({
      path: points.map((p) => ({ lat: p.lat, lng: p.lng })),
      geodesic: true,
      strokeColor: '#10b981',
      strokeWeight: 3,
      map,
    });

    // Current position marker
    markerRef.current = new google.maps.Marker({
      position: { lat: last.lat, lng: last.lng },
      map,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: '#ef4444',
        fillOpacity: 1,
        strokeColor: '#fff',
        strokeWeight: 2,
      },
    });
  }

  // Update polyline + marker when new snapshots arrive
  useEffect(() => {
    if (!googleMapRef.current || !polylineRef.current || !markerRef.current) return;
    const gpsPoints = snapshots.filter((s) => s.lat !== 0 && s.lng !== 0);
    if (gpsPoints.length === 0) return;

    const path = gpsPoints.map((p) => ({ lat: p.lat, lng: p.lng }));
    polylineRef.current.setPath(path);

    const last = gpsPoints[gpsPoints.length - 1]!;
    markerRef.current.setPosition({ lat: last.lat, lng: last.lng });
    googleMapRef.current.panTo({ lat: last.lat, lng: last.lng });
  }, [snapshots]);

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

  // Altitude data for chart
  const altData = snapshots
    .filter((s) => s.altitude_m !== null)
    .map((s) => ({
      dist: Math.round(s.distance_km * 100) / 100,
      alt: Math.round(s.altitude_m!),
      gradient: s.gradient_pct,
    }));

  const hasGPS = snapshots.some((s) => s.lat !== 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
          <h2 className="text-lg font-bold text-white">Volta em curso</h2>
          <span className="text-xs text-gray-600">{timeStr}</span>
        </div>
        <span className="text-xs text-gray-600">{snapshots.length} pts · 5s refresh</span>
      </div>

      {/* Live metrics */}
      {latest && (
        <div className="grid grid-cols-5 gap-2">
          <Metric label="Velocidade" value={latest.speed_kmh.toFixed(1)} unit="km/h" />
          <Metric label="Potência" value={`${latest.power_watts}`} unit="W" color="text-yellow-400" />
          <Metric label="Cadência" value={`${latest.cadence_rpm}`} unit="rpm" color="text-blue-400" />
          <Metric label="Bateria" value={`${latest.battery_pct}`} unit="%"
            color={latest.battery_pct > 30 ? 'text-emerald-400' : 'text-red-400'} />
          <Metric label="Distância" value={latest.distance_km.toFixed(1)} unit="km" />
        </div>
      )}
      {latest && (
        <div className="grid grid-cols-5 gap-2">
          <Metric label="Gradiente" value={`${latest.gradient_pct > 0 ? '+' : ''}${latest.gradient_pct.toFixed(1)}`} unit="%"
            color={latest.gradient_pct > 5 ? 'text-red-400' : latest.gradient_pct > 0 ? 'text-orange-400' : 'text-green-400'} />
          <Metric label="Modo" value={MODE_NAMES[latest.assist_mode] ?? '?'} unit=""
            color={latest.assist_mode === 5 ? 'text-red-400' : 'text-gray-300'} />
          {latest.hr_bpm > 0 && <Metric label="FC" value={`${latest.hr_bpm}`} unit="bpm" color="text-red-400" />}
          {latest.altitude_m !== null && <Metric label="Altitude" value={`${Math.round(latest.altitude_m)}`} unit="m" color="text-cyan-400" />}
          <Metric label="Bat. início" value={`${session.battery_start}`} unit="%" color="text-gray-500" />
        </div>
      )}

      {/* Map */}
      {hasGPS && (
        <div className="bg-gray-800 rounded-xl overflow-hidden">
          <div ref={mapRef} className="w-full h-72" />
        </div>
      )}

      {/* Elevation profile */}
      {altData.length > 5 && (
        <div className="bg-gray-800 rounded-xl p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold text-gray-400">Altimetria</span>
            {altData.length > 0 && (
              <span className="text-[10px] text-gray-600">
                {altData[0]!.alt}m → {altData[altData.length - 1]!.alt}m
                ({altData[altData.length - 1]!.alt - altData[0]!.alt > 0 ? '+' : ''}
                {altData[altData.length - 1]!.alt - altData[0]!.alt}m)
              </span>
            )}
          </div>
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={altData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="altGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="dist" tick={{ fontSize: 10, fill: '#555' }} tickFormatter={(v) => `${v}km`} />
                <YAxis tick={{ fontSize: 10, fill: '#555' }} domain={['dataMin - 10', 'dataMax + 10']} width={35} tickFormatter={(v) => `${v}m`} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: 8, fontSize: 11 }}
                  labelFormatter={(v) => `${v} km`}
                  formatter={(value: number, name: string) => [
                    name === 'alt' ? `${value}m` : `${value}%`,
                    name === 'alt' ? 'Altitude' : 'Gradiente'
                  ]}
                />
                <Area type="monotone" dataKey="alt" stroke="#10b981" fill="url(#altGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, unit, color }: {
  label: string; value: string; unit: string; color?: string;
}) {
  return (
    <div className="bg-gray-800 rounded-lg p-2">
      <div className={`text-lg font-bold tabular-nums ${color ?? 'text-white'}`}>
        {value}<span className="text-[10px] text-gray-500 ml-0.5">{unit}</span>
      </div>
      <div className="text-[9px] text-gray-600">{label}</div>
    </div>
  );
}

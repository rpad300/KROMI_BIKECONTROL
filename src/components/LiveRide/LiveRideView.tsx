import { useState, useEffect, useRef, useCallback } from 'react';
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { useAuthStore } from '../../store/authStore';
import { supaGet } from '../../lib/supaFetch';

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
const POLL_INTERVAL = 5000;

/** tracking_sessions row — latest snapshot fields */
interface TrackingSession {
  id: string;
  is_active: boolean;
  started_at: string;
  ended_at: string | null;
  lat: number | null;
  lng: number | null;
  altitude: number | null;
  heading: number | null;
  speed_kmh: number;
  avg_speed_kmh: number;
  distance_km: number;
  elevation_gain_m: number;
  battery_pct: number;
  heart_rate: number;
  power_watts: number;
  cadence_rpm: number;
  assist_mode: number;
  gear: number;
  total_gears: number;
  range_km: number;
  route_name: string | null;
  route_total_km: number | null;
  route_done_km: number | null;
  route_remaining_km: number | null;
  route_eta_min: number | null;
  route_progress_pct: number | null;
  route_elevation_profile: { d: number; e: number }[] | null;
  updated_at: string;
  rider_name: string | null;
  bike_name: string | null;
}

/** tracking_points row — breadcrumb trail */
interface TrackingPoint {
  lat: number;
  lng: number;
  altitude: number | null;
  speed_kmh: number | null;
  heart_rate: number | null;
  recorded_at: string;
}

const MODE_NAMES: Record<number, string> = {
  0: 'MAN', 1: 'ECO', 2: 'TOUR', 3: 'ACTIVE', 4: 'SPORT', 5: 'KROMI', 6: 'SMART',
};

export function LiveRideView() {
  const userId = useAuthStore((s) => s.user?.id);
  const [session, setSession] = useState<TrackingSession | null>(null);
  const [points, setPoints] = useState<TrackingPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);

  const poll = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    try {
      // Fetch active tracking session for this user
      const sessions = await supaGet<TrackingSession[]>(
        `/rest/v1/tracking_sessions?user_id=eq.${userId}&is_active=eq.true&select=*&limit=1&order=started_at.desc`,
      );
      if (!Array.isArray(sessions) || sessions.length === 0) {
        setSession(null); setPoints([]); setLoading(false);
        return;
      }
      const active = sessions[0]!;
      setSession(active);

      // Fetch breadcrumb trail
      const trail = await supaGet<TrackingPoint[]>(
        `/rest/v1/tracking_points?session_id=eq.${active.id}&select=lat,lng,altitude,speed_kmh,heart_rate,recorded_at&order=recorded_at.asc&limit=2000`,
      );
      setPoints(trail);
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
    const gpsPoints = points.filter((p) => p.lat !== 0 && p.lng !== 0);
    if (gpsPoints.length === 0) return;

    if (!window.google?.maps) {
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}`;
      script.onload = () => initMap(gpsPoints);
      document.head.appendChild(script);
    } else {
      initMap(gpsPoints);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points.length > 0 && !googleMapRef.current]);

  function initMap(pts: TrackingPoint[]) {
    if (!mapRef.current || googleMapRef.current) return;
    const last = pts[pts.length - 1]!;
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

    polylineRef.current = new google.maps.Polyline({
      path: pts.map((p) => ({ lat: p.lat, lng: p.lng })),
      geodesic: true,
      strokeColor: '#10b981',
      strokeWeight: 3,
      map,
    });

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

  // Update polyline + marker when new points arrive
  useEffect(() => {
    if (!googleMapRef.current || !polylineRef.current || !markerRef.current) return;
    const gpsPoints = points.filter((p) => p.lat !== 0 && p.lng !== 0);
    if (gpsPoints.length === 0) return;

    const path = gpsPoints.map((p) => ({ lat: p.lat, lng: p.lng }));
    polylineRef.current.setPath(path);

    const last = gpsPoints[gpsPoints.length - 1]!;
    markerRef.current.setPosition({ lat: last.lat, lng: last.lng });
    googleMapRef.current.panTo({ lat: last.lat, lng: last.lng });
  }, [points]);

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

  // Elapsed time from started_at
  const elapsedS = Math.round((Date.now() - new Date(session.started_at).getTime()) / 1000);
  const hours = Math.floor(elapsedS / 3600);
  const mins = Math.floor((elapsedS % 3600) / 60);
  const secs = elapsedS % 60;
  const timeStr = hours > 0
    ? `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    : `${mins}:${secs.toString().padStart(2, '0')}`;

  // Elevation profile — prefer route profile, fallback to trail altitude
  const elevProfile = session.route_elevation_profile;
  const altData = elevProfile
    ? elevProfile.map((p) => ({ dist: Math.round((p.d / 1000) * 100) / 100, alt: Math.round(p.e) }))
    : points
        .filter((p) => p.altitude !== null)
        .map((p, i) => ({ dist: Math.round((i * 0.015) * 100) / 100, alt: Math.round(p.altitude!) }));

  const hasGPS = points.some((p) => p.lat !== 0) || (session.lat != null && session.lat !== 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
          <h2 className="text-lg font-bold text-white">Volta em curso</h2>
          <span className="text-xs text-gray-600">{timeStr}</span>
        </div>
        <div className="flex items-center gap-2">
          {session.rider_name && <span className="text-xs text-gray-500">{session.rider_name}</span>}
          {session.bike_name && <span className="text-xs text-gray-600">· {session.bike_name}</span>}
          <span className="text-xs text-gray-600">{points.length} pts · 5s refresh</span>
        </div>
      </div>

      {/* Route navigation bar (when GPX active) */}
      {session.route_name && (
        <div className="bg-gray-800 rounded-lg p-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-emerald-400 text-base">route</span>
            <span className="text-sm font-bold text-white">{session.route_name}</span>
          </div>
          <div className="flex items-center gap-4 text-xs">
            {session.route_done_km != null && (
              <span className="text-gray-400">{session.route_done_km.toFixed(1)} / {session.route_total_km?.toFixed(1) ?? '?'} km</span>
            )}
            {session.route_progress_pct != null && (
              <span className="text-emerald-400 font-bold">{session.route_progress_pct.toFixed(0)}%</span>
            )}
            {session.route_eta_min != null && (
              <span className="text-gray-500">ETA {session.route_eta_min} min</span>
            )}
          </div>
        </div>
      )}

      {/* Live metrics — row 1 */}
      <div className="grid grid-cols-5 gap-2">
        <Metric label="Velocidade" value={session.speed_kmh.toFixed(1)} unit="km/h" />
        <Metric label="Potência" value={`${session.power_watts}`} unit="W" color="text-yellow-400" />
        <Metric label="Cadência" value={`${session.cadence_rpm}`} unit="rpm" color="text-blue-400" />
        <Metric label="Bateria" value={`${session.battery_pct}`} unit="%"
          color={session.battery_pct > 30 ? 'text-emerald-400' : 'text-red-400'} />
        <Metric label="Distância" value={session.distance_km.toFixed(1)} unit="km" />
      </div>

      {/* Live metrics — row 2 */}
      <div className="grid grid-cols-5 gap-2">
        <Metric label="Vel. Média" value={session.avg_speed_kmh.toFixed(1)} unit="km/h" color="text-gray-300" />
        <Metric label="Modo" value={MODE_NAMES[session.assist_mode] ?? '?'} unit=""
          color={session.assist_mode === 5 ? 'text-red-400' : 'text-gray-300'} />
        <Metric label="Gear" value={`${session.gear}/${session.total_gears}`} unit="" color="text-gray-300" />
        {session.heart_rate > 0 && <Metric label="FC" value={`${session.heart_rate}`} unit="bpm" color="text-red-400" />}
        <Metric label="Desnível" value={`${Math.round(session.elevation_gain_m)}`} unit="m" color="text-cyan-400" />
      </div>

      {/* Range + altitude row */}
      <div className="grid grid-cols-5 gap-2">
        {session.range_km > 0 && <Metric label="Autonomia" value={session.range_km.toFixed(0)} unit="km" color="text-emerald-400" />}
        {session.altitude != null && <Metric label="Altitude" value={`${Math.round(session.altitude)}`} unit="m" color="text-cyan-400" />}
      </div>

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
            <span className="text-xs font-bold text-gray-400">
              {elevProfile ? 'Perfil da Rota' : 'Altimetria'}
            </span>
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
                  formatter={(value: number) => [`${value}m`, 'Altitude']}
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

import { useState, useEffect, useRef, useCallback } from 'react';
import { AreaChart, Area, LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { useAuthStore } from '../../store/authStore';
import { exportRideAsGPX, type TrackPoint } from '../../services/export/GPXExportService';
import { FitImport } from '../Import/FitImport';
import { simulateKromi, type SimulationSummary } from '../../services/simulation/KromiSimulator';
import type { ImportedRecord } from '../../services/import/FitImportService';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

interface RideSession {
  id: string;
  started_at: string;
  status: string;
  duration_s: number;
  total_km: number;
  total_elevation_m: number;
  avg_speed_kmh: number;
  max_speed_kmh: number;
  avg_power_w: number;
  max_power_w: number;
  avg_hr: number;
  max_hr: number;
  battery_start: number;
  battery_end: number;
  devices_connected: Record<string, unknown>;
}

interface Snapshot {
  elapsed_s: number;
  lat: number;
  lng: number;
  altitude_m: number | null;
  speed_kmh: number;
  power_watts: number;
  hr_bpm: number;
  cadence_rpm: number;
  distance_km: number;
  gradient_pct: number;
}

async function fetchJSON(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: { 'apikey': SUPABASE_KEY!, 'Authorization': `Bearer ${SUPABASE_KEY}` },
  });
  return res.json();
}

export function RideHistory() {
  const userId = useAuthStore((s) => s.user?.id);
  const [rides, setRides] = useState<RideSession[]>([]);
  const [selected, setSelected] = useState<RideSession | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);

  const loadRides = useCallback(() => {
    if (!userId || !SUPABASE_URL || !SUPABASE_KEY) { setLoading(false); return; }
    setLoading(true);
    fetchJSON(`/ride_sessions?user_id=eq.${userId}&status=eq.completed&select=*&order=started_at.desc&limit=50`)
      .then((data) => { if (Array.isArray(data)) setRides(data); })
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => { loadRides(); }, [loadRides]);

  const [simulation, setSimulation] = useState<SimulationSummary | null>(null);

  const handleSelect = async (ride: RideSession) => {
    setSelected(ride);
    setSnapshots([]);
    setSimulation(null);
    const snaps = await fetchJSON(
      `/ride_snapshots?session_id=eq.${ride.id}&select=elapsed_s,lat,lng,altitude_m,speed_kmh,power_watts,hr_bpm,cadence_rpm,distance_km,gradient_pct&order=elapsed_s.asc&limit=3000`
    );
    if (Array.isArray(snaps)) {
      setSnapshots(snaps);
      // Run KROMI simulation on this ride
      const records: ImportedRecord[] = snaps.map((s: Snapshot) => ({
        elapsed_s: s.elapsed_s, lat: s.lat, lng: s.lng, altitude_m: s.altitude_m,
        speed_kmh: s.speed_kmh, hr_bpm: s.hr_bpm, cadence_rpm: s.cadence_rpm,
        power_watts: s.power_watts, temperature: 0, distance_km: s.distance_km,
      }));
      setSimulation(simulateKromi(records));
    }
  };

  const handleDelete = async (ride: RideSession) => {
    if (!SUPABASE_URL || !SUPABASE_KEY) return;
    if (!confirm(`Apagar ride ${ride.total_km?.toFixed(1)}km de ${new Date(ride.started_at).toLocaleDateString()}?`)) return;
    await fetch(`${SUPABASE_URL}/rest/v1/ride_snapshots?session_id=eq.${ride.id}`, {
      method: 'DELETE', headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
    });
    await fetch(`${SUPABASE_URL}/rest/v1/ride_sessions?id=eq.${ride.id}`, {
      method: 'DELETE', headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
    });
    setSelected(null);
    loadRides();
  };

  const handleExportGPX = () => {
    if (!selected || snapshots.length === 0) return;
    const points: TrackPoint[] = snapshots
      .filter((s) => s.lat !== 0)
      .map((s) => ({
        lat: s.lat,
        lng: s.lng,
        elevation: s.altitude_m ?? 0,
        timestamp: new Date(selected.started_at).getTime() + s.elapsed_s * 1000,
        speed: s.speed_kmh || undefined,
        hr: s.hr_bpm || undefined,
        cadence: s.cadence_rpm || undefined,
        power: s.power_watts || undefined,
      }));
    const filename = `KROMI_${new Date(selected.started_at).toISOString().split('T')[0]}`;
    exportRideAsGPX(filename, points);
  };

  if (loading) {
    return <div className="flex justify-center py-20"><div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>;
  }

  // Detail view
  if (selected) {
    return (
      <RideDetail
        ride={selected}
        snapshots={snapshots}
        simulation={simulation}
        onBack={() => { setSelected(null); setSnapshots([]); setSimulation(null); }}
        onExport={handleExportGPX}
        onDelete={() => handleDelete(selected)}
      />
    );
  }

  // List view
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-bold text-gray-300">Histórico ({rides.length} rides)</h2>

      {/* FIT Import */}
      <FitImport onImported={loadRides} />

      {rides.length === 0 && (
        <div className="bg-gray-800 rounded-xl p-8 text-center text-gray-600">
          <span className="material-symbols-outlined text-3xl">history</span>
          <p className="mt-2 text-sm">Sem rides. Importa ficheiros .FIT acima ou faz uma volta com o KROMI.</p>
        </div>
      )}
      {rides.map((ride) => {
        const isFitImport = (ride.devices_connected as Record<string, unknown>)?.source === 'fit_import';
        return (
          <button
            key={ride.id}
            onClick={() => handleSelect(ride)}
            className="w-full bg-gray-800 rounded-xl p-4 text-left hover:bg-gray-750 active:scale-[0.99] transition-transform"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-white font-bold">
                    {ride.total_km?.toFixed(1) ?? 0}km · {formatDuration(ride.duration_s ?? 0)}
                    {ride.total_elevation_m ? ` · ${ride.total_elevation_m}m D+` : ''}
                  </span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${
                    isFitImport
                      ? 'bg-purple-900/50 text-purple-400'
                      : 'bg-emerald-900/50 text-emerald-400'
                  }`}>
                    {isFitImport ? 'FIT' : 'LIVE'}
                  </span>
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {new Date(ride.started_at).toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric', month: 'short' })}
                  {' · '}
                  {new Date(ride.started_at).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
              <div className="text-right text-xs text-gray-500">
                {ride.avg_speed_kmh?.toFixed(1)} km/h
                {ride.avg_hr > 0 && <div>{ride.avg_hr} bpm</div>}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function RideDetail({ ride, snapshots, simulation, onBack, onExport, onDelete }: {
  ride: RideSession; snapshots: Snapshot[]; simulation: SimulationSummary | null;
  onBack: () => void; onExport: () => void; onDelete: () => void;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObjRef = useRef<google.maps.Map | null>(null);

  // Init map
  useEffect(() => {
    if (!mapRef.current || !MAPS_KEY || mapObjRef.current) return;
    const gps = snapshots.filter((s) => s.lat !== 0 && s.lng !== 0);
    if (gps.length === 0) return;

    const initMap = () => {
      if (!mapRef.current || mapObjRef.current) return;
      const bounds = new google.maps.LatLngBounds();
      gps.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));

      const map = new google.maps.Map(mapRef.current, {
        center: bounds.getCenter(),
        zoom: 13,
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
      map.fitBounds(bounds);
      mapObjRef.current = map;

      new google.maps.Polyline({
        path: gps.map((p) => ({ lat: p.lat, lng: p.lng })),
        geodesic: true,
        strokeColor: '#10b981',
        strokeWeight: 3,
        map,
      });

      // Start/end markers
      new google.maps.Marker({
        position: { lat: gps[0]!.lat, lng: gps[0]!.lng },
        map,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: '#22c55e', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
      });
      new google.maps.Marker({
        position: { lat: gps[gps.length - 1]!.lat, lng: gps[gps.length - 1]!.lng },
        map,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: '#ef4444', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
      });
    };

    if (window.google?.maps) initMap();
    else {
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}`;
      script.onload = initMap;
      document.head.appendChild(script);
    }

    return () => { mapObjRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshots]);

  const altData = snapshots.filter((s) => s.altitude_m !== null).map((s) => ({
    dist: Math.round(s.distance_km * 100) / 100,
    alt: Math.round(s.altitude_m!),
  }));

  const hrData = snapshots.filter((s) => s.hr_bpm > 0).map((s) => ({
    time: Math.round(s.elapsed_s / 60),
    hr: s.hr_bpm,
    speed: Math.round(s.speed_kmh * 10) / 10,
  }));

  const hasGPS = snapshots.some((s) => s.lat !== 0);
  const hasAlt = altData.length > 5;
  const hasHR = hrData.length > 5;

  return (
    <div className="space-y-4">
      {/* Back + Export + Delete */}
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-1 text-gray-400 hover:text-white text-sm">
          <span className="material-symbols-outlined text-lg">arrow_back</span> Voltar
        </button>
        <div className="flex gap-3">
          <button onClick={onExport} className="text-xs text-emerald-400 hover:text-emerald-300">
            GPX
          </button>
          <button onClick={onDelete} className="text-xs text-red-400 hover:text-red-300">
            Apagar
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="bg-gray-800 rounded-xl p-4">
        <div className="text-xs text-gray-500">
          {new Date(ride.started_at).toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </div>
        <div className="grid grid-cols-4 gap-3 mt-3">
          <StatCard label="Distância" value={`${ride.total_km?.toFixed(1) ?? 0}`} unit="km" />
          <StatCard label="Duração" value={formatDuration(ride.duration_s ?? 0)} unit="" />
          <StatCard label="Elevação" value={`${ride.total_elevation_m ?? 0}`} unit="m D+" />
          <StatCard label="Vel média" value={`${ride.avg_speed_kmh?.toFixed(1) ?? 0}`} unit="km/h" />
          {ride.avg_hr > 0 && <StatCard label="FC média" value={`${ride.avg_hr}`} unit="bpm" />}
          {ride.max_hr > 0 && <StatCard label="FC max" value={`${ride.max_hr}`} unit="bpm" />}
          {ride.avg_power_w > 0 && <StatCard label="Potência" value={`${ride.avg_power_w}`} unit="W" />}
          <StatCard label="Bateria" value={`${ride.battery_start ?? 100}→${ride.battery_end ?? 0}`} unit="%" />
        </div>
      </div>

      {/* Map */}
      {hasGPS && (
        <div className="bg-gray-800 rounded-xl overflow-hidden">
          <div ref={mapRef} className="w-full h-64" />
        </div>
      )}

      {/* Elevation */}
      {hasAlt && (
        <div className="bg-gray-800 rounded-xl p-3">
          <span className="text-xs font-bold text-gray-400">Altimetria</span>
          <div className="h-32 mt-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={altData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="altGradH" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="dist" tick={{ fontSize: 10, fill: '#555' }} tickFormatter={(v) => `${v}km`} />
                <YAxis tick={{ fontSize: 10, fill: '#555' }} domain={['dataMin - 10', 'dataMax + 10']} width={35} />
                <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: 8, fontSize: 11 }} />
                <Area type="monotone" dataKey="alt" stroke="#10b981" fill="url(#altGradH)" strokeWidth={2} name="Altitude (m)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* HR + Speed chart */}
      {hasHR && (
        <div className="bg-gray-800 rounded-xl p-3">
          <span className="text-xs font-bold text-gray-400">FC + Velocidade</span>
          <div className="h-32 mt-1">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={hrData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#555' }} tickFormatter={(v) => `${v}min`} />
                <YAxis yAxisId="hr" tick={{ fontSize: 10, fill: '#555' }} domain={[60, 'dataMax + 10']} width={30} />
                <YAxis yAxisId="spd" orientation="right" tick={{ fontSize: 10, fill: '#555' }} width={30} />
                <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: 8, fontSize: 11 }} />
                <Line yAxisId="hr" type="monotone" dataKey="hr" stroke="#ef4444" dot={false} strokeWidth={1.5} name="FC (bpm)" />
                <Line yAxisId="spd" type="monotone" dataKey="speed" stroke="#3b82f6" dot={false} strokeWidth={1} name="Speed (km/h)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* KROMI Simulation */}
      {simulation && (
        <div className="bg-gray-800 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-bold text-emerald-400">Simulação KROMI Intelligence</h3>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-red-900/20 rounded-lg p-3 text-center">
              <div className="text-red-400 font-bold text-xl">{simulation.time_max_pct}%</div>
              <div className="text-[10px] text-gray-500">MAX (S360% T300)</div>
            </div>
            <div className="bg-yellow-900/20 rounded-lg p-3 text-center">
              <div className="text-yellow-400 font-bold text-xl">{simulation.time_mid_pct}%</div>
              <div className="text-[10px] text-gray-500">MID (S350% T250)</div>
            </div>
            <div className="bg-green-900/20 rounded-lg p-3 text-center">
              <div className="text-green-400 font-bold text-xl">{simulation.time_min_pct}%</div>
              <div className="text-[10px] text-gray-500">MIN (S300% T200)</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div><span className="text-gray-500">KROMI activo</span><div className="text-white font-bold">{simulation.time_active_pct}%</div></div>
            <div><span className="text-gray-500">Mudanças calibração</span><div className="text-white font-bold">{simulation.level_changes}×</div></div>
            <div><span className="text-gray-500">Score médio</span><div className="text-white font-bold">{simulation.avg_score}/100</div></div>
            <div><span className="text-gray-500">Score máximo</span><div className="text-white font-bold">{simulation.max_score}/100</div></div>
          </div>
          <div className="bg-gray-900 rounded-lg p-3">
            <div className="text-[10px] text-gray-500 mb-2">Bateria simulada (100% → fim da volta)</div>
            <div className="flex justify-between text-sm">
              <div><span className="text-emerald-400 font-bold">KROMI: {simulation.battery_end_kromi}%</span></div>
              <div><span className="text-red-400 font-bold">Fixo MAX: {simulation.battery_end_fixed}%</span></div>
            </div>
            {simulation.battery_saved_pct > 0 && (
              <div className="text-emerald-400 text-xs font-bold mt-1">
                KROMI poupa {simulation.battery_saved_pct}% de bateria
              </div>
            )}
          </div>
        </div>
      )}

      <div className="text-xs text-gray-600 text-center">{snapshots.length} data points</div>
    </div>
  );
}

function StatCard({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div>
      <div className="text-lg font-bold text-white tabular-nums">{value}<span className="text-xs text-gray-500 ml-0.5">{unit}</span></div>
      <div className="text-[10px] text-gray-500">{label}</div>
    </div>
  );
}

function formatDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}h` : `${m}min`;
}

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AreaChart, Area, LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { useAuthStore } from '../../store/authStore';
import { exportRideAsGPX, type TrackPoint } from '../../services/export/GPXExportService';
import { FitImport } from '../Import/FitImport';
import { simulateKromi, type SimulationSummary } from '../../services/simulation/KromiSimulator';
import type { ImportedRecord } from '../../services/import/FitImportService';
import { supaFetch, supaGet } from '../../lib/supaFetch';

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

// ── Filter types ────────────────────────────────────────────
type PeriodFilter = 'all' | '7d' | '30d' | '90d' | 'year' | 'custom';
type TypeFilter = 'all' | 'live' | 'fit';
type SortField = 'date' | 'distance' | 'elevation' | 'duration';

const PERIOD_OPTIONS: { value: PeriodFilter; label: string }[] = [
  { value: 'all', label: 'Tudo' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: '90d', label: '3 meses' },
  { value: 'year', label: 'Este ano' },
  { value: 'custom', label: 'Custom' },
];

const TYPE_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'live', label: 'Live' },
  { value: 'fit', label: 'FIT' },
];

const SORT_OPTIONS: { value: SortField; label: string; icon: string }[] = [
  { value: 'date', label: 'Data', icon: 'calendar_today' },
  { value: 'distance', label: 'Distância', icon: 'straighten' },
  { value: 'elevation', label: 'Desnível', icon: 'terrain' },
  { value: 'duration', label: 'Duração', icon: 'timer' },
];

function getPeriodCutoff(period: PeriodFilter): Date | null {
  if (period === 'all') return null;
  const now = new Date();
  if (period === '7d') return new Date(now.getTime() - 7 * 86400000);
  if (period === '30d') return new Date(now.getTime() - 30 * 86400000);
  if (period === '90d') return new Date(now.getTime() - 90 * 86400000);
  // 'year'
  return new Date(now.getFullYear(), 0, 1);
}

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
  avg_gps_accuracy: number | null;
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

async function fetchJSON<T = unknown>(path: string): Promise<T> {
  return supaGet<T>(`/rest/v1${path}`);
}

export function RideHistory() {
  const userId = useAuthStore((s) => s.user?.id);
  const [rides, setRides] = useState<RideSession[]>([]);
  const [selected, setSelected] = useState<RideSession | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Filters ──────────────────────────────────────────────
  const [period, setPeriod] = useState<PeriodFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [sortBy, setSortBy] = useState<SortField>('date');
  const [showFilters, setShowFilters] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const loadRides = useCallback(() => {
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    fetchJSON<RideSession[]>(`/ride_sessions?user_id=eq.${userId}&status=eq.completed&select=*&order=started_at.desc&limit=200`)
      .then((data) => { if (Array.isArray(data)) setRides(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => { loadRides(); }, [loadRides]);

  // ── Filtered + sorted rides ──────────────────────────────
  const filtered = useMemo(() => {
    let result = rides;

    // Period filter
    if (period === 'custom') {
      if (dateFrom) result = result.filter((r) => new Date(r.started_at) >= new Date(dateFrom));
      if (dateTo) result = result.filter((r) => new Date(r.started_at) <= new Date(dateTo + 'T23:59:59'));
    } else {
      const cutoff = getPeriodCutoff(period);
      if (cutoff) result = result.filter((r) => new Date(r.started_at) >= cutoff);
    }

    // Type filter
    if (typeFilter === 'live') result = result.filter((r) => (r.devices_connected as Record<string, unknown>)?.source !== 'fit_import');
    if (typeFilter === 'fit') result = result.filter((r) => (r.devices_connected as Record<string, unknown>)?.source === 'fit_import');

    // Sort
    const sorted = [...result];
    if (sortBy === 'date') sorted.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
    if (sortBy === 'distance') sorted.sort((a, b) => (b.total_km ?? 0) - (a.total_km ?? 0));
    if (sortBy === 'elevation') sorted.sort((a, b) => (b.total_elevation_m ?? 0) - (a.total_elevation_m ?? 0));
    if (sortBy === 'duration') sorted.sort((a, b) => (b.duration_s ?? 0) - (a.duration_s ?? 0));
    return sorted;
  }, [rides, period, typeFilter, sortBy, dateFrom, dateTo]);

  // ── Summary stats (from filtered rides) ──────────────────
  const stats = useMemo(() => {
    const totalKm = filtered.reduce((s, r) => s + (r.total_km ?? 0), 0);
    const totalElev = filtered.reduce((s, r) => s + (r.total_elevation_m ?? 0), 0);
    const totalTime = filtered.reduce((s, r) => s + (r.duration_s ?? 0), 0);
    const avgSpeed = filtered.length > 0
      ? filtered.reduce((s, r) => s + (r.avg_speed_kmh ?? 0), 0) / filtered.length
      : 0;
    return { totalKm, totalElev, totalTime, avgSpeed, count: filtered.length };
  }, [filtered]);

  const [simulation, setSimulation] = useState<SimulationSummary | null>(null);

  const handleSelect = async (ride: RideSession) => {
    setSelected(ride);
    setSnapshots([]);
    setSimulation(null);
    const snaps = await fetchJSON<Snapshot[]>(
      `/ride_snapshots?session_id=eq.${ride.id}&select=elapsed_s,lat,lng,altitude_m,speed_kmh,power_watts,hr_bpm,cadence_rpm,distance_km,gradient_pct&order=elapsed_s.asc&limit=3000`
    ).catch(() => [] as Snapshot[]);
    if (Array.isArray(snaps)) {
      setSnapshots(snaps);
      const records: ImportedRecord[] = snaps.map((s: Snapshot) => ({
        elapsed_s: s.elapsed_s, lat: s.lat, lng: s.lng, altitude_m: s.altitude_m,
        speed_kmh: s.speed_kmh, hr_bpm: s.hr_bpm, cadence_rpm: s.cadence_rpm,
        power_watts: s.power_watts, temperature: 0, distance_km: s.distance_km,
      }));
      setSimulation(simulateKromi(records));
    }
  };

  const handleDelete = async (ride: RideSession) => {
    if (!confirm(`Apagar ride ${ride.total_km?.toFixed(1)}km de ${new Date(ride.started_at).toLocaleDateString()}?`)) return;
    await supaFetch(`/rest/v1/ride_snapshots?session_id=eq.${ride.id}`, { method: 'DELETE' }).catch(() => {});
    await supaFetch(`/rest/v1/ride_sessions?id=eq.${ride.id}`, { method: 'DELETE' }).catch(() => {});
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
    return <div className="flex justify-center py-20"><div className="w-8 h-8 border-2 border-[#3fff8b] border-t-transparent rounded-full animate-spin" /></div>;
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

  // ── List view ────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-headline font-bold text-lg" style={{ color: '#e966ff' }}>Atividades</h2>
          <span className="text-[11px] text-[#777575]">{stats.count} rides · {stats.totalKm.toFixed(0)}km total</span>
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold active:scale-95 transition-transform"
          style={{
            backgroundColor: showFilters ? 'rgba(233,102,255,0.15)' : 'rgba(73,72,71,0.2)',
            color: showFilters ? '#e966ff' : '#adaaaa',
          }}
        >
          <span className="material-symbols-outlined text-sm">filter_list</span>
          Filtros
          {(period !== 'all' || typeFilter !== 'all' || sortBy !== 'date') && (
            <span className="w-1.5 h-1.5 rounded-full bg-[#e966ff]" />
          )}
        </button>
      </div>

      {/* Filters panel */}
      {showFilters && (
        <div className="rounded-xl p-3 space-y-3" style={{ backgroundColor: '#131313', border: '1px solid rgba(73,72,71,0.2)' }}>
          {/* Period chips */}
          <div>
            <div className="text-[10px] text-[#777575] uppercase tracking-wider mb-1.5">Período</div>
            <div className="flex gap-1.5 flex-wrap">
              {PERIOD_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setPeriod(opt.value)}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-bold active:scale-95 transition-all"
                  style={{
                    backgroundColor: period === opt.value ? 'rgba(233,102,255,0.2)' : 'rgba(73,72,71,0.15)',
                    color: period === opt.value ? '#e966ff' : '#adaaaa',
                    border: period === opt.value ? '1px solid rgba(233,102,255,0.3)' : '1px solid transparent',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Custom date range */}
          {period === 'custom' && (
            <div className="flex gap-2">
              <div className="flex-1">
                <div className="text-[10px] text-[#777575] mb-1">De</div>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full px-2 py-1.5 rounded-lg text-[11px] text-white bg-[#0e0e0e] border border-[#494847]/30 outline-none focus:border-[#e966ff]/50"
                />
              </div>
              <div className="flex-1">
                <div className="text-[10px] text-[#777575] mb-1">Até</div>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full px-2 py-1.5 rounded-lg text-[11px] text-white bg-[#0e0e0e] border border-[#494847]/30 outline-none focus:border-[#e966ff]/50"
                />
              </div>
            </div>
          )}

          {/* Type chips */}
          <div>
            <div className="text-[10px] text-[#777575] uppercase tracking-wider mb-1.5">Tipo</div>
            <div className="flex gap-1.5">
              {TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setTypeFilter(opt.value)}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-bold active:scale-95 transition-all"
                  style={{
                    backgroundColor: typeFilter === opt.value ? 'rgba(233,102,255,0.2)' : 'rgba(73,72,71,0.15)',
                    color: typeFilter === opt.value ? '#e966ff' : '#adaaaa',
                    border: typeFilter === opt.value ? '1px solid rgba(233,102,255,0.3)' : '1px solid transparent',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Sort chips */}
          <div>
            <div className="text-[10px] text-[#777575] uppercase tracking-wider mb-1.5">Ordenar por</div>
            <div className="flex gap-1.5 flex-wrap">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setSortBy(opt.value)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold active:scale-95 transition-all"
                  style={{
                    backgroundColor: sortBy === opt.value ? 'rgba(233,102,255,0.2)' : 'rgba(73,72,71,0.15)',
                    color: sortBy === opt.value ? '#e966ff' : '#adaaaa',
                    border: sortBy === opt.value ? '1px solid rgba(233,102,255,0.3)' : '1px solid transparent',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>{opt.icon}</span>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Clear filters */}
          {(period !== 'all' || typeFilter !== 'all' || sortBy !== 'date') && (
            <button
              onClick={() => { setPeriod('all'); setTypeFilter('all'); setSortBy('date'); setDateFrom(''); setDateTo(''); }}
              className="text-[10px] text-[#777575] hover:text-white"
            >
              Limpar filtros
            </button>
          )}
        </div>
      )}

      {/* Summary stats bar */}
      <div className="grid grid-cols-4 gap-2">
        <div className="rounded-lg p-2.5 text-center" style={{ backgroundColor: '#131313', border: '1px solid rgba(73,72,71,0.15)' }}>
          <div className="text-white font-bold text-base tabular-nums">{stats.totalKm.toFixed(0)}<span className="text-[10px] text-[#777575] ml-0.5">km</span></div>
          <div className="text-[9px] text-[#777575]">Distância</div>
        </div>
        <div className="rounded-lg p-2.5 text-center" style={{ backgroundColor: '#131313', border: '1px solid rgba(73,72,71,0.15)' }}>
          <div className="text-white font-bold text-base tabular-nums">{(stats.totalElev / 1000).toFixed(1)}<span className="text-[10px] text-[#777575] ml-0.5">km</span></div>
          <div className="text-[9px] text-[#777575]">Desnível</div>
        </div>
        <div className="rounded-lg p-2.5 text-center" style={{ backgroundColor: '#131313', border: '1px solid rgba(73,72,71,0.15)' }}>
          <div className="text-white font-bold text-base tabular-nums">{formatDuration(stats.totalTime)}</div>
          <div className="text-[9px] text-[#777575]">Tempo</div>
        </div>
        <div className="rounded-lg p-2.5 text-center" style={{ backgroundColor: '#131313', border: '1px solid rgba(73,72,71,0.15)' }}>
          <div className="text-white font-bold text-base tabular-nums">{stats.avgSpeed.toFixed(1)}<span className="text-[10px] text-[#777575] ml-0.5">km/h</span></div>
          <div className="text-[9px] text-[#777575]">Vel. média</div>
        </div>
      </div>

      {/* FIT Import */}
      <FitImport onImported={loadRides} />

      {/* Ride list */}
      {filtered.length === 0 && (
        <div className="rounded-xl p-8 text-center" style={{ backgroundColor: '#131313', border: '1px solid rgba(73,72,71,0.15)' }}>
          <span className="material-symbols-outlined text-3xl text-[#494847]">directions_bike</span>
          <p className="mt-2 text-sm text-[#777575]">
            {rides.length === 0
              ? 'Sem atividades. Importa ficheiros .FIT ou faz uma volta com o KROMI.'
              : 'Nenhuma atividade corresponde aos filtros.'}
          </p>
        </div>
      )}
      {filtered.map((ride) => {
        const isFitImport = (ride.devices_connected as Record<string, unknown>)?.source === 'fit_import';
        return (
          <button
            key={ride.id}
            onClick={() => handleSelect(ride)}
            className="w-full rounded-xl p-4 text-left active:scale-[0.99] transition-transform"
            style={{ backgroundColor: '#131313', border: '1px solid rgba(73,72,71,0.15)' }}
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
                      : 'bg-[#3fff8b]/10 text-[#3fff8b]'
                  }`}>
                    {isFitImport ? 'FIT' : 'LIVE'}
                  </span>
                </div>
                <div className="text-xs mt-0.5" style={{ color: '#777575' }}>
                  {new Date(ride.started_at).toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric', month: 'short' })}
                  {' · '}
                  {new Date(ride.started_at).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
              <div className="text-right text-xs" style={{ color: '#777575' }}>
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
  const isFitImport = (ride.devices_connected as Record<string, unknown>)?.source === 'fit_import';
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

  // Build combined chart data: altitude + KROMI simulation overlay
  const chartData = snapshots
    .filter((s) => s.distance_km > 0)
    .map((s, i) => {
      const simPt = simulation?.points[i];
      return {
        dist: Math.round(s.distance_km * 100) / 100,
        alt: s.altitude_m !== null ? Math.round(s.altitude_m) : null,
        speed: Math.round(s.speed_kmh * 10) / 10,
        hr: s.hr_bpm > 0 ? s.hr_bpm : null,
        kromiScore: simPt?.kromi_score ?? null,
        kromiBattery: simPt?.battery_pct ?? null,
        kromiSupport: simPt?.support_pct ?? null,
        kromiTorque: simPt?.torque ?? null,
        kromiLaunch: simPt?.launch ?? null,
      };
    });

  const hasGPS = snapshots.some((s) => s.lat !== 0);
  const hasAlt = chartData.some((d) => d.alt !== null && d.alt > 0);
  const hasHR = chartData.some((d) => d.hr !== null);
  const hasSim = simulation && simulation.points.length > 5;

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

      {/* Summary — Dados da volta */}
      <div className="bg-gray-800 rounded-xl p-4 space-y-3">
        <div>
          <div className="text-xs text-gray-500">
            {new Date(ride.started_at).toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
          {isFitImport && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-900/50 text-purple-400 font-bold mt-1 inline-block">
              Importado de ficheiro FIT
            </span>
          )}
        </div>

        <div className="grid grid-cols-4 gap-3">
          <StatCard label="Distância total" value={`${ride.total_km?.toFixed(1) ?? 0}`} unit="km" />
          <StatCard label="Tempo em movimento" value={formatDuration(ride.duration_s ?? 0)} unit="" />
          <StatCard label="Desnível acumulado" value={`${ride.total_elevation_m ?? 0}`} unit="m" />
          <StatCard label="Velocidade média" value={`${ride.avg_speed_kmh?.toFixed(1) ?? 0}`} unit="km/h" />
          {ride.avg_hr > 0 && <StatCard label="Freq. cardíaca média" value={`${ride.avg_hr}`} unit="bpm" />}
          {ride.max_hr > 0 && <StatCard label="Freq. cardíaca máxima" value={`${ride.max_hr}`} unit="bpm" />}
          {ride.avg_gps_accuracy != null && <StatCard label="GPS accuracy média" value={`±${ride.avg_gps_accuracy.toFixed(1)}`} unit="m" />}
          {ride.avg_power_w > 0 && <StatCard label="Potência média" value={`${ride.avg_power_w}`} unit="W" />}
          <StatCard label="Vel. máxima" value={`${ride.max_speed_kmh?.toFixed(0) ?? 0}`} unit="km/h" />
        </div>

        {/* Battery estimation */}
        {simulation && (
          <div className="border-t border-gray-700 pt-3">
            <div className="text-[10px] text-gray-500 mb-2">
              Bateria estimada no fim da volta (partindo de 100%)
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-emerald-900/10 rounded-lg p-2 text-center">
                <div className="text-emerald-400 font-bold text-xl tabular-nums">{simulation.battery_end_kromi}%</div>
                <span className="text-[8px] px-1.5 py-0.5 bg-emerald-900/50 text-emerald-400 rounded font-bold">KROMI</span>
                <div className="text-[9px] text-gray-600 mt-1">Assist inteligente — ajusta conforme terreno</div>
              </div>
              <div className="bg-orange-900/10 rounded-lg p-2 text-center">
                <div className="text-orange-400 font-bold text-xl tabular-nums">{simulation.battery_end_fixed}%</div>
                <span className="text-[8px] px-1.5 py-0.5 bg-orange-900/50 text-orange-400 rounded font-bold">CONFIG FIXA</span>
                <div className="text-[9px] text-gray-600 mt-1">{simulation.fixed_label} — sempre igual</div>
              </div>
              <div className="bg-red-900/10 rounded-lg p-2 text-center">
                <div className="text-red-400 font-bold text-xl tabular-nums">{simulation.battery_end_max}%</div>
                <span className="text-[8px] px-1.5 py-0.5 bg-red-900/50 text-red-400 rounded font-bold">SEMPRE MAX</span>
                <div className="text-[9px] text-gray-600 mt-1">S360% T85Nm — máximo consumo</div>
              </div>
            </div>
            <div className={`text-xs font-bold text-center mt-2 ${
              simulation.battery_saved_vs_fixed > 0 ? 'text-emerald-400' : 'text-orange-400'
            }`}>
              {simulation.battery_saved_vs_fixed > 0
                ? `KROMI poupa ${simulation.battery_saved_vs_fixed}% de bateria vs a tua config fixa — mais autonomia com mais performance nas subidas`
                : simulation.battery_saved_vs_fixed < 0
                  ? `KROMI gasta ${Math.abs(simulation.battery_saved_vs_fixed)}% mais que a tua config fixa — mas dá mais potência quando precisas`
                  : 'KROMI e a tua config fixa gastam o mesmo — mas o KROMI adapta a potência ao terreno'
              }
            </div>
          </div>
        )}
      </div>

      {/* Map */}
      {hasGPS && (
        <div className="bg-gray-800 rounded-xl overflow-hidden">
          <div ref={mapRef} className="w-full h-64" />
        </div>
      )}

      {/* Elevation + KROMI Score overlay */}
      {hasAlt && (
        <div className="bg-gray-800 rounded-xl p-3">
          <div className="flex items-center justify-between mb-1">
            <div>
              <span className="text-xs font-bold text-gray-400">Perfil de elevação</span>
              {hasSim && <span className="text-[9px] text-yellow-500 ml-2">+ Score KROMI (0-100)</span>}
            </div>
            {hasAlt && chartData.length > 0 && (
              <span className="text-[10px] text-gray-600">
                {chartData.find(d => d.alt)?.alt}m → {chartData.filter(d => d.alt).pop()?.alt}m
              </span>
            )}
          </div>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="altGradH" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="dist" tick={{ fontSize: 10, fill: '#555' }} tickFormatter={(v: number) => `${v}km`} />
                <YAxis yAxisId="alt" tick={{ fontSize: 10, fill: '#555' }} domain={['dataMin - 10', 'dataMax + 10']} width={35} />
                {hasSim && <YAxis yAxisId="score" orientation="right" tick={{ fontSize: 10, fill: '#555' }} domain={[0, 100]} width={25} />}
                <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: 8, fontSize: 11 }}
                  formatter={(value: number, name: string) => {
                    if (name === 'alt') return [`${value}m`, 'Altitude'];
                    if (name === 'kromiScore') return [`${value}/100`, 'KROMI Score'];
                    return [value, name];
                  }} />
                <Area yAxisId="alt" type="monotone" dataKey="alt" stroke="#10b981" fill="url(#altGradH)" strokeWidth={2} name="alt" />
                {hasSim && <Line yAxisId="score" type="monotone" dataKey="kromiScore" stroke="#f59e0b" dot={false} strokeWidth={1.5} name="kromiScore" />}
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {hasSim && (
            <div className="flex items-center gap-4 mt-1 text-[10px] text-gray-500">
              <span><span className="inline-block w-3 h-0.5 bg-emerald-500 mr-1" />Altitude</span>
              <span><span className="inline-block w-3 h-0.5 bg-yellow-500 mr-1" />KROMI Score</span>
              <span className="text-gray-600">{'Score > 65 = MAX | 35-65 = MID | < 35 = MIN'}</span>
            </div>
          )}
        </div>
      )}

      {/* HR + Speed chart */}
      {hasHR && (
        <div className="bg-gray-800 rounded-xl p-3">
          <div>
            <span className="text-xs font-bold text-gray-400">Esforço ao longo da volta</span>
            <div className="text-[9px] text-gray-600">Frequência cardíaca e velocidade por distância</div>
          </div>
          <div className="h-32 mt-1">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <XAxis dataKey="dist" tick={{ fontSize: 10, fill: '#555' }} tickFormatter={(v: number) => `${v}km`} />
                <YAxis yAxisId="hr" tick={{ fontSize: 10, fill: '#555' }} domain={[60, 'dataMax + 10']} width={30} />
                <YAxis yAxisId="spd" orientation="right" tick={{ fontSize: 10, fill: '#555' }} width={30} />
                <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: 8, fontSize: 11 }} />
                <Line yAxisId="hr" type="monotone" dataKey="hr" stroke="#ef4444" dot={false} strokeWidth={1.5} name="FC (bpm)" />
                <Line yAxisId="spd" type="monotone" dataKey="speed" stroke="#3b82f6" dot={false} strokeWidth={1} name="Speed (km/h)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center gap-4 mt-1 text-[10px] text-gray-500">
            <span><span className="inline-block w-3 h-0.5 bg-red-500 mr-1" />FC</span>
            <span><span className="inline-block w-3 h-0.5 bg-blue-500 mr-1" />Velocidade</span>
          </div>
        </div>
      )}

      {/* KROMI Calibration chart — Support%, Torque, Launch, Battery */}
      {hasSim && (
        <div className="bg-gray-800 rounded-xl p-3">
          <div>
            <span className="text-xs font-bold text-emerald-400">KROMI — Calibração do motor</span>
            <div className="text-[9px] text-gray-600">Como o motor seria ajustado a cada momento da volta</div>
          </div>
          <div className="h-44 mt-1">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <XAxis dataKey="dist" tick={{ fontSize: 10, fill: '#555' }} tickFormatter={(v: number) => `${v}km`} />
                <YAxis yAxisId="asmo" tick={{ fontSize: 10, fill: '#555' }} domain={[0, 400]} width={35} />
                <YAxis yAxisId="bat" orientation="right" tick={{ fontSize: 10, fill: '#555' }} domain={[0, 100]} width={25} />
                <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: 8, fontSize: 11 }}
                  formatter={(value: number, name: string) => {
                    if (name === 'kromiSupport') return [`${value}%`, 'Support'];
                    if (name === 'kromiTorque') return [`${value}`, 'Torque'];
                    if (name === 'kromiLaunch') return [`${value}`, 'Launch'];
                    if (name === 'kromiBattery') return [`${value}%`, 'Bateria'];
                    return [value, name];
                  }} />
                <Line yAxisId="asmo" type="stepAfter" dataKey="kromiSupport" stroke="#3b82f6" dot={false} strokeWidth={2} name="kromiSupport" />
                <Line yAxisId="asmo" type="stepAfter" dataKey="kromiTorque" stroke="#f97316" dot={false} strokeWidth={2} name="kromiTorque" />
                <Line yAxisId="asmo" type="stepAfter" dataKey="kromiLaunch" stroke="#a855f7" dot={false} strokeWidth={1.5} name="kromiLaunch" />
                <Line yAxisId="bat" type="monotone" dataKey="kromiBattery" stroke="#10b981" dot={false} strokeWidth={1.5} name="kromiBattery" />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 mt-2 text-[9px] text-gray-500">
            <span><span className="inline-block w-3 h-0.5 bg-blue-500 mr-1" />Support % — multiplicador de assist do motor</span>
            <span><span className="inline-block w-3 h-0.5 bg-orange-500 mr-1" />Torque (Nm) — força do motor</span>
            <span><span className="inline-block w-3 h-0.5 bg-purple-500 mr-1" />Launch — rapidez de resposta do motor</span>
            <span><span className="inline-block w-3 h-0.5 bg-emerald-500 mr-1" />Bateria — consumo acumulado (%)</span>
          </div>
        </div>
      )}

      {/* KROMI Simulation summary */}
      {simulation && (
        <div className="bg-gray-800 rounded-xl p-4 space-y-3">
          <div>
            <h3 className="text-sm font-bold text-emerald-400">KROMI Intelligence — Resumo da simulação</h3>
            <div className="text-[9px] text-gray-600">Se o KROMI estivesse activo nesta volta, distribuiria o assist assim:</div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-red-900/20 rounded-lg p-2 text-center">
              <div className="text-red-400 font-bold text-lg">{simulation.time_max_pct}%</div>
              <div className="text-[9px] text-gray-500">MAX — assist total</div>
              <div className="text-[8px] text-gray-600">subidas fortes</div>
            </div>
            <div className="bg-yellow-900/20 rounded-lg p-2 text-center">
              <div className="text-yellow-400 font-bold text-lg">{simulation.time_mid_pct}%</div>
              <div className="text-[9px] text-gray-500">MID — equilibrado</div>
              <div className="text-[8px] text-gray-600">terreno misto</div>
            </div>
            <div className="bg-green-900/20 rounded-lg p-2 text-center">
              <div className="text-green-400 font-bold text-lg">{simulation.time_min_pct}%</div>
              <div className="text-[9px] text-gray-500">MIN — poupar bateria</div>
              <div className="text-[8px] text-gray-600">plano e descida</div>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 text-xs">
            <div><span className="text-gray-500">Tempo activo</span><div className="text-white font-bold">{simulation.time_active_pct}%</div><div className="text-[8px] text-gray-600">a pedalar</div></div>
            <div><span className="text-gray-500">Ajustes</span><div className="text-white font-bold">{simulation.level_changes}×</div><div className="text-[8px] text-gray-600">calibrações</div></div>
            <div><span className="text-gray-500">Intensidade média</span><div className="text-white font-bold">{simulation.avg_score}/100</div><div className="text-[8px] text-gray-600">score KROMI</div></div>
            <div><span className="text-gray-500">Pico</span><div className="text-white font-bold">{simulation.max_score}/100</div><div className="text-[8px] text-gray-600">momento +difícil</div></div>
          </div>
          <div className="bg-gray-900 rounded-lg p-3 space-y-2">
            <div className="text-[10px] text-gray-500">Bateria no fim da volta (início 100%)</div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-emerald-400 font-bold text-lg">{simulation.battery_end_kromi}%</div>
                <div className="text-[9px] text-gray-500">KROMI</div>
              </div>
              <div>
                <div className="text-orange-400 font-bold text-lg">{simulation.battery_end_fixed}%</div>
                <div className="text-[9px] text-gray-500">{simulation.fixed_label}</div>
              </div>
              <div>
                <div className="text-red-400 font-bold text-lg">{simulation.battery_end_max}%</div>
                <div className="text-[9px] text-gray-500">Sempre MAX</div>
              </div>
            </div>
            <div className={`text-xs font-bold text-center ${simulation.battery_saved_vs_fixed >= 0 ? 'text-emerald-400' : 'text-orange-400'}`}>
              {simulation.battery_saved_vs_fixed >= 0
                ? `+${simulation.battery_saved_vs_fixed}% poupança vs config fixa`
                : `${simulation.battery_saved_vs_fixed}% vs config fixa (mais potência nas subidas)`}
            </div>
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

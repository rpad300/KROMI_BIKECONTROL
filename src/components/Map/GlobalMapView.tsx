import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useAuthStore } from '../../store/authStore';
import { initGoogleMaps, isMapsLoaded } from '../../services/maps/GoogleMapsService';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// ── Filter types ────────────────────────────────────────────
type MapPeriod = 'all' | '30d' | '90d' | 'year';
type MapOverlay = 'routes' | 'heatmap';

interface RouteData {
  session_id: string;
  started_at: string;
  total_km: number;
  points: { lat: number; lng: number }[];
}

async function fetchJSON(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: { 'apikey': SUPABASE_KEY!, 'Authorization': `Bearer ${SUPABASE_KEY}` },
  });
  return res.json();
}

export function GlobalMapView() {
  const userId = useAuthStore((s) => s.user?.id);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const heatmapRef = useRef<google.maps.visualization.HeatmapLayer | null>(null);

  const [ready, setReady] = useState(false);
  const [routes, setRoutes] = useState<RouteData[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<MapPeriod>('all');
  const [overlay, setOverlay] = useState<MapOverlay>('routes');
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);

  // Load Google Maps
  useEffect(() => {
    initGoogleMaps().then(() => setReady(true)).catch(() => {});
  }, []);

  // Create map
  useEffect(() => {
    if (!ready || !mapRef.current || mapInstance.current) return;
    if (!isMapsLoaded()) return;
    mapInstance.current = new google.maps.Map(mapRef.current, {
      center: { lat: 38.7, lng: -9.14 },
      zoom: 11,
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
  }, [ready]);

  // Fetch all route GPS points from ride_snapshots
  const loadRoutes = useCallback(async () => {
    if (!userId || !SUPABASE_URL || !SUPABASE_KEY) { setLoading(false); return; }
    setLoading(true);

    // First get all completed sessions
    const sessions = await fetchJSON(
      `/ride_sessions?user_id=eq.${userId}&status=eq.completed&select=id,started_at,total_km&order=started_at.desc&limit=100`
    );
    if (!Array.isArray(sessions)) { setLoading(false); return; }

    // For each session, fetch GPS points (sampled — every 5th point to keep load manageable)
    const routePromises = sessions.map(async (sess: { id: string; started_at: string; total_km: number }) => {
      const snaps = await fetchJSON(
        `/ride_snapshots?session_id=eq.${sess.id}&select=lat,lng&lat=neq.0&lng=neq.0&order=elapsed_s.asc&limit=600`
      );
      if (!Array.isArray(snaps) || snaps.length < 2) return null;
      // Sample every 3rd point
      const points = snaps.filter((_: unknown, i: number) => i % 3 === 0).map((s: { lat: number; lng: number }) => ({ lat: s.lat, lng: s.lng }));
      return { session_id: sess.id, started_at: sess.started_at, total_km: sess.total_km, points };
    });

    const results = (await Promise.all(routePromises)).filter(Boolean) as RouteData[];
    setRoutes(results);
    setLoading(false);
  }, [userId]);

  useEffect(() => { loadRoutes(); }, [loadRoutes]);

  // Filter routes by period
  const filteredRoutes = useMemo(() => {
    if (period === 'all') return routes;
    const now = Date.now();
    const cutoffs: Record<MapPeriod, number> = {
      all: 0,
      '30d': now - 30 * 86400000,
      '90d': now - 90 * 86400000,
      year: new Date(new Date().getFullYear(), 0, 1).getTime(),
    };
    return routes.filter((r) => new Date(r.started_at).getTime() >= cutoffs[period]);
  }, [routes, period]);

  // All GPS points for heatmap
  const allPoints = useMemo(() => filteredRoutes.flatMap((r) => r.points), [filteredRoutes]);

  // Clear existing overlays
  const clearOverlays = useCallback(() => {
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];
    heatmapRef.current?.setMap(null);
    heatmapRef.current = null;
  }, []);

  // Draw routes or heatmap
  useEffect(() => {
    if (!mapInstance.current || !ready) return;
    clearOverlays();

    if (filteredRoutes.length === 0) return;

    const bounds = new google.maps.LatLngBounds();

    if (overlay === 'routes') {
      // Route colors cycle
      const colors = ['#3fff8b', '#6e9bff', '#e966ff', '#fbbf24', '#ff716c', '#10b981', '#f97316', '#a855f7'];

      filteredRoutes.forEach((route, idx) => {
        const isSelected = selectedRoute === route.session_id;
        const polyline = new google.maps.Polyline({
          path: route.points,
          geodesic: true,
          strokeColor: isSelected ? '#ffffff' : colors[idx % colors.length]!,
          strokeOpacity: isSelected ? 1 : selectedRoute ? 0.2 : 0.6,
          strokeWeight: isSelected ? 4 : 2,
          map: mapInstance.current,
          zIndex: isSelected ? 10 : 1,
        });
        route.points.forEach((p) => bounds.extend(p));

        polyline.addListener('click', () => {
          setSelectedRoute((prev) => prev === route.session_id ? null : route.session_id);
        });

        polylinesRef.current.push(polyline);
      });
    } else {
      // Heatmap
      if (window.google?.maps?.visualization && allPoints.length > 0) {
        const heatmapData = allPoints.map((p) => new google.maps.LatLng(p.lat, p.lng));
        heatmapRef.current = new google.maps.visualization.HeatmapLayer({
          data: heatmapData,
          map: mapInstance.current,
          radius: 15,
          opacity: 0.7,
          gradient: [
            'rgba(0, 0, 0, 0)',
            'rgba(63, 255, 139, 0.4)',
            'rgba(63, 255, 139, 0.6)',
            'rgba(110, 155, 255, 0.7)',
            'rgba(233, 102, 255, 0.8)',
            'rgba(255, 113, 108, 0.9)',
            'rgba(251, 191, 36, 1)',
          ],
        });
        allPoints.forEach((p) => bounds.extend(p));
      }
    }

    if (!bounds.isEmpty()) mapInstance.current.fitBounds(bounds, 40);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredRoutes, overlay, selectedRoute, ready, clearOverlays]);

  // Selected route info
  const selectedInfo = selectedRoute ? filteredRoutes.find((r) => r.session_id === selectedRoute) : null;

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: '#0e0e0e' }}>
      {/* Controls bar */}
      <div className="flex-none p-2 space-y-2" style={{ borderBottom: '1px solid rgba(73,72,71,0.2)' }}>
        <div className="flex items-center justify-between">
          <h2 className="font-headline font-bold text-sm" style={{ color: '#6e9bff' }}>
            Mapa Global
            <span className="text-[10px] text-[#777575] font-normal ml-2">{filteredRoutes.length} rotas</span>
          </h2>
          {/* Overlay toggle */}
          <div className="flex gap-1">
            <button
              onClick={() => setOverlay('routes')}
              className="px-2.5 py-1 rounded-lg text-[10px] font-bold active:scale-95 transition-all"
              style={{
                backgroundColor: overlay === 'routes' ? 'rgba(110,155,255,0.2)' : 'rgba(73,72,71,0.15)',
                color: overlay === 'routes' ? '#6e9bff' : '#adaaaa',
                border: overlay === 'routes' ? '1px solid rgba(110,155,255,0.3)' : '1px solid transparent',
              }}
            >
              Rotas
            </button>
            <button
              onClick={() => setOverlay('heatmap')}
              className="px-2.5 py-1 rounded-lg text-[10px] font-bold active:scale-95 transition-all"
              style={{
                backgroundColor: overlay === 'heatmap' ? 'rgba(233,102,255,0.2)' : 'rgba(73,72,71,0.15)',
                color: overlay === 'heatmap' ? '#e966ff' : '#adaaaa',
                border: overlay === 'heatmap' ? '1px solid rgba(233,102,255,0.3)' : '1px solid transparent',
              }}
            >
              Heatmap
            </button>
          </div>
        </div>

        {/* Period filter */}
        <div className="flex gap-1.5">
          {([['all', 'Tudo'], ['30d', '30 dias'], ['90d', '3 meses'], ['year', 'Este ano']] as [MapPeriod, string][]).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setPeriod(v)}
              className="px-2.5 py-1 rounded-lg text-[10px] font-bold active:scale-95 transition-all"
              style={{
                backgroundColor: period === v ? 'rgba(110,155,255,0.15)' : 'rgba(73,72,71,0.1)',
                color: period === v ? '#6e9bff' : '#777575',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-[#0e0e0e]/80">
            <div className="w-8 h-8 border-2 border-[#6e9bff] border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        <div ref={mapRef} className="w-full h-full" />

        {/* Selected route info overlay */}
        {selectedInfo && (
          <div className="absolute bottom-3 left-3 right-3 rounded-xl p-3 z-10" style={{ backgroundColor: 'rgba(19,19,19,0.95)', border: '1px solid rgba(110,155,255,0.3)' }}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-white font-bold">
                  {selectedInfo.total_km?.toFixed(1)}km
                </div>
                <div className="text-[10px] text-[#777575]">
                  {new Date(selectedInfo.started_at).toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
              </div>
              <button onClick={() => setSelectedRoute(null)} className="text-[#777575] hover:text-white">
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>
          </div>
        )}

        {/* Stats overlay */}
        {!loading && filteredRoutes.length > 0 && !selectedInfo && (
          <div className="absolute bottom-3 left-3 rounded-xl px-3 py-2 z-10" style={{ backgroundColor: 'rgba(19,19,19,0.9)' }}>
            <div className="flex gap-4 text-[10px]">
              <div>
                <span className="text-[#777575]">Total </span>
                <span className="text-white font-bold">{filteredRoutes.reduce((s, r) => s + (r.total_km ?? 0), 0).toFixed(0)}km</span>
              </div>
              <div>
                <span className="text-[#777575]">Rotas </span>
                <span className="text-white font-bold">{filteredRoutes.length}</span>
              </div>
              <div>
                <span className="text-[#777575]">Pontos </span>
                <span className="text-white font-bold">{allPoints.length}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

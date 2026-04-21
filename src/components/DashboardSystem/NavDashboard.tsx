// src/components/DashboardSystem/NavDashboard.tsx
/**
 * NAV Dashboard — world-class GPX navigation.
 *
 * Layout (portrait, 70/30):
 *   - Satellite map 70% with GPX route (gradient-colored), position marker
 *   - Floating overlays: speed (top-right), mode+gear (top-left)
 *   - Progress bar (done/remaining/total)
 *   - Elevation mini profile with position
 *   - KPI grid 3x2: Battery, Range, ETA, Power, HR, Cadence
 *   - Intelligence footer: W' balance + route feasibility
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useBikeStore } from '../../store/bikeStore';
import { useMapStore } from '../../store/mapStore';
import { useRouteStore } from '../../store/routeStore';
import { initGoogleMaps, isMapsLoaded } from '../../services/maps/GoogleMapsService';
import { ElevationMiniProfile } from '../Dashboard/ElevationMiniProfile';
import { navigationExtras } from '../../services/routes/NavigationEngine';
import type { RoutePoint } from '../../services/routes/GPXParser';
import {
  calculateExplorationRoutes,
  shouldRecalculate,
  getLastRoutes,
  type ExplorationRoute,
  type DifficultyLevel,
} from '../../services/routes/ExplorationService';

// ── Gradient color for route segments ────────────────────────
function gradientColor(gradient: number): string {
  const abs = Math.abs(gradient);
  if (abs < 3) return '#3fff8b';   // flat — green
  if (abs < 8) return '#fbbf24';   // moderate — yellow
  return '#ff716c';                 // steep — red
}

// ── Build gradient-colored polyline segments ─────────────────
function buildGradientSegments(points: RoutePoint[], splitIdx: number): {
  doneSegments: { path: google.maps.LatLngLiteral[]; color: string }[];
  remainSegments: { path: google.maps.LatLngLiteral[]; color: string }[];
} {
  const doneSegments: { path: google.maps.LatLngLiteral[]; color: string }[] = [];
  const remainSegments: { path: google.maps.LatLngLiteral[]; color: string }[] = [];

  let currentColor = '#3fff8b';
  let currentPath: google.maps.LatLngLiteral[] = [];
  let isDone = true;

  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const pos = { lat: p.lat, lng: p.lng };

    if (i === splitIdx) isDone = false;

    // Calculate gradient
    let grad = 0;
    if (i > 0) {
      const prev = points[i - 1]!;
      const dist = p.distance_from_start_m - prev.distance_from_start_m;
      if (dist > 5) grad = ((p.elevation - prev.elevation) / dist) * 100;
    }

    const color = isDone ? '#3fff8b' : gradientColor(grad);

    if (color !== currentColor && currentPath.length > 0) {
      // Push segment
      const target = isDone || (i <= splitIdx) ? doneSegments : remainSegments;
      target.push({ path: [...currentPath, pos], color: currentColor });
      currentPath = [pos];
      currentColor = color;
    } else {
      currentPath.push(pos);
    }
  }

  // Push final segment
  if (currentPath.length > 1) {
    const target = doneSegments.length === 0 ? doneSegments : remainSegments;
    target.push({ path: currentPath, color: currentColor });
  }

  return { doneSegments, remainSegments };
}

// ── POI detection ────────────────────────────────────────────
interface RoutePOI {
  type: 'summit' | 'descent_start' | 'finish';
  lat: number;
  lng: number;
  label: string;
  icon: string;
}

function detectPOIs(points: RoutePoint[]): RoutePOI[] {
  if (points.length < 10) return [];
  const pois: RoutePOI[] = [];

  // Summit — highest elevation point
  let maxEle = -Infinity, maxIdx = 0;
  for (let i = 0; i < points.length; i++) {
    if (points[i]!.elevation > maxEle) {
      maxEle = points[i]!.elevation;
      maxIdx = i;
    }
  }
  if (maxIdx > 0 && maxIdx < points.length - 1) {
    pois.push({ type: 'summit', lat: points[maxIdx]!.lat, lng: points[maxIdx]!.lng, label: `${Math.round(maxEle)}m`, icon: '\u26F0\uFE0F' });
  }

  // Longest descent — find longest continuous negative gradient
  let bestDescentStart = 0, bestDescentLen = 0, curStart = 0, curLen = 0;
  for (let i = 1; i < points.length; i++) {
    const dist = points[i]!.distance_from_start_m - points[i - 1]!.distance_from_start_m;
    const grad = dist > 5 ? ((points[i]!.elevation - points[i - 1]!.elevation) / dist) * 100 : 0;
    if (grad < -3) {
      if (curLen === 0) curStart = i;
      curLen++;
    } else {
      if (curLen > bestDescentLen) { bestDescentLen = curLen; bestDescentStart = curStart; }
      curLen = 0;
    }
  }
  if (curLen > bestDescentLen) { bestDescentLen = curLen; bestDescentStart = curStart; }
  if (bestDescentLen > 5) {
    pois.push({ type: 'descent_start', lat: points[bestDescentStart]!.lat, lng: points[bestDescentStart]!.lng, label: 'Descida', icon: '\u2B07\uFE0F' });
  }

  // Finish
  const last = points[points.length - 1]!;
  pois.push({ type: 'finish', lat: last.lat, lng: last.lng, label: 'Chegada', icon: '\uD83C\uDFC1' });

  return pois;
}

// ── Main component ───────────────────────────────────────────

export function NavDashboard() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const posMarkerRef = useRef<google.maps.Marker | null>(null);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const poiMarkersRef = useRef<google.maps.Marker[]>([]);
  const [ready, setReady] = useState(false);

  // Store data
  const lat = useMapStore((s) => s.latitude);
  const lng = useMapStore((s) => s.longitude);
  const heading = useMapStore((s) => s.heading);
  const gpsActive = useMapStore((s) => s.gpsActive);

  const speed = useBikeStore((s) => s.speed_kmh);
  const battery = useBikeStore((s) => s.battery_percent);
  const rangeKm = useBikeStore((s) => s.range_km);
  const power = useBikeStore((s) => s.power_watts);
  const hr = useBikeStore((s) => s.hr_bpm);
  const cadence = useBikeStore((s) => s.cadence_rpm);
  const assistMode = useBikeStore((s) => s.assist_mode);
  const gear = useBikeStore((s) => s.gear);
  const totalGears = useBikeStore((s) => s.total_gears);
  const ambientLux = useBikeStore((s) => s.light_lux);

  const routePoints = useRouteStore((s) => s.activeRoutePoints);
  const nav = useRouteStore((s) => s.navigation);

  const navActive = nav?.active ?? false;
  const currentIdx = nav?.currentIndex ?? 0;
  const distDone = nav?.distanceFromStart_m ?? 0;
  const distRemaining = nav?.distanceRemaining_m ?? 0;
  const progress = nav?.progress_pct ?? 0;
  const deviation = nav?.deviationM ?? 0;

  const totalDistKm = routePoints.length > 1 ? routePoints[routePoints.length - 1]!.distance_from_start_m / 1000 : 0;
  const doneKm = distDone / 1000;
  const remainKm = distRemaining / 1000;

  // Mode label (Mode 5 = KROMI Intelligence, Mode 6 = SMART Giant native)
  const modeLabels: Record<number, string> = { 0: 'MAN', 1: 'ECO', 2: 'TOUR', 3: 'ACTIVE', 4: 'SPORT', 5: 'KROMI', 6: 'SMART' };
  const modeLabel = modeLabels[assistMode] ?? '--';
  const modeColor = assistMode === 5 ? '#3fff8b' : assistMode === 6 ? '#6e9bff' : '#fbbf24';

  // Battery color
  const batColor = battery > 30 ? '#3fff8b' : battery > 15 ? '#fbbf24' : '#ff716c';

  // Range vs remaining feasibility
  const rangeSufficient = rangeKm >= remainKm;
  const rangeColor = rangeSufficient ? '#3fff8b' : rangeKm >= remainKm * 0.8 ? '#fbbf24' : '#ff716c';

  // Map brightness based on ambient light sensor
  const mapFilter = ambientLux != null
    ? ambientLux < 50 ? 'brightness(0.6)' : ambientLux > 500 ? 'brightness(1.2) contrast(1.1)' : 'none'
    : 'none';

  // ETA
  const etaMin = navigationExtras.etaMin;
  const etaStr = etaMin > 0 ? `${Math.floor(etaMin / 60)}:${String(etaMin % 60).padStart(2, '0')}` : '--';

  // Init Google Maps
  useEffect(() => {
    initGoogleMaps().then(() => setReady(true)).catch(() => { /* no-op */ });
  }, []);

  // Create map
  useEffect(() => {
    if (!ready || !mapRef.current || mapInstance.current) return;
    if (!isMapsLoaded()) return;

    mapInstance.current = new google.maps.Map(mapRef.current, {
      center: { lat: lat || 41.19, lng: lng || -8.43 },
      zoom: 16,
      mapTypeId: 'hybrid',
      disableDefaultUI: true,
      gestureHandling: 'greedy',
      tilt: 15,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Draw route polylines (gradient-colored)
  useEffect(() => {
    if (!mapInstance.current || !isMapsLoaded() || routePoints.length < 2) return;

    // Clear old polylines
    polylinesRef.current.forEach(p => p.setMap(null));
    polylinesRef.current = [];
    poiMarkersRef.current.forEach(m => m.setMap(null));
    poiMarkersRef.current = [];

    const { doneSegments, remainSegments } = buildGradientSegments(routePoints, currentIdx);

    // Draw done segments (solid)
    for (const seg of doneSegments) {
      const pl = new google.maps.Polyline({
        path: seg.path,
        map: mapInstance.current,
        strokeColor: seg.color,
        strokeOpacity: 0.9,
        strokeWeight: 4,
      });
      polylinesRef.current.push(pl);
    }

    // Draw remaining segments (gradient-colored, slightly thinner)
    for (const seg of remainSegments) {
      const pl = new google.maps.Polyline({
        path: seg.path,
        map: mapInstance.current,
        strokeColor: seg.color,
        strokeOpacity: 0.6,
        strokeWeight: 3,
      });
      polylinesRef.current.push(pl);
    }

    // POIs
    const pois = detectPOIs(routePoints);
    for (const poi of pois) {
      const m = new google.maps.Marker({
        position: { lat: poi.lat, lng: poi.lng },
        map: mapInstance.current,
        label: { text: poi.icon, fontSize: '16px' },
        title: poi.label,
      });
      poiMarkersRef.current.push(m);
    }

    // Fit bounds on first draw
    if (currentIdx === 0) {
      const bounds = new google.maps.LatLngBounds();
      routePoints.forEach(p => bounds.extend({ lat: p.lat, lng: p.lng }));
      mapInstance.current.fitBounds(bounds, 30);
    }
  }, [routePoints, ready, currentIdx]);

  // Update position marker + pan
  useEffect(() => {
    if (!mapInstance.current || !lat || !lng) return;
    const pos = { lat, lng };

    if (!posMarkerRef.current) {
      posMarkerRef.current = new google.maps.Marker({
        map: mapInstance.current,
        position: pos,
        icon: {
          path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
          scale: 6,
          fillColor: '#3fff8b',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
          rotation: heading || 0,
        },
        zIndex: 100,
      });
    } else {
      posMarkerRef.current.setPosition(pos);
      posMarkerRef.current.setIcon({
        ...(posMarkerRef.current.getIcon() as google.maps.Symbol),
        rotation: heading || 0,
      });
    }

    // Pan map to follow rider (only when navigating)
    if (navActive) {
      mapInstance.current.panTo(pos);
      if ((mapInstance.current.getZoom() ?? 0) < 15) mapInstance.current.setZoom(16);
    }
  }, [lat, lng, heading, navActive]);

  // Off-route alert + vibrate
  useEffect(() => {
    if (navigationExtras.isOffRoute && navigationExtras.offRouteDurationS < 1) {
      try { navigator.vibrate?.([200, 100, 200]); } catch { /* no-op */ }
    }
  });

  // Route complete
  useEffect(() => {
    if (navigationExtras.isComplete && navActive) {
      const totalKm = totalDistKm.toFixed(1);
      console.log(`[NAV] Route complete! ${totalKm} km`);
    }
  });

  // ── No route → exploration mode ─────────────────────────────
  if (routePoints.length < 2) {
    return <ExplorationView />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#0e0e0e' }}>

      {/* MAP (flex-grow fills ~70%) */}
      <div style={{ flex: '1 1 0', position: 'relative', minHeight: 0 }}>
        <div ref={mapRef} style={{ width: '100%', height: '100%', filter: mapFilter }} />

        {/* GPS badge — top center */}
        {!gpsActive && (
          <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 10, background: 'rgba(239,68,68,0.9)', padding: '4px 12px', borderRadius: 6 }}>
            <span style={{ color: '#fff', fontSize: 10, fontWeight: 'bold' }}>SEM GPS</span>
          </div>
        )}

        {/* Speed — top right */}
        <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 10, background: 'rgba(14,14,14,0.88)', padding: '6px 12px', borderRadius: 6, border: '1px solid #333' }}>
          <span style={{ color: '#fff', fontSize: 28, fontWeight: 'bold', fontFamily: 'monospace' }}>{speed > 0 ? speed.toFixed(0) : '0'}</span>
          <span style={{ color: '#777', fontSize: 10, marginLeft: 3 }}>KM/H</span>
        </div>

        {/* Mode + Gear — top left */}
        <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 10, display: 'flex', gap: 4 }}>
          <div style={{ background: 'rgba(14,14,14,0.88)', padding: '5px 8px', borderRadius: 6, border: `1px solid ${modeColor}30` }}>
            <span style={{ color: modeColor, fontSize: 9, fontWeight: 'bold', letterSpacing: 0.5 }}>{modeLabel}</span>
          </div>
          {gear > 0 && (
            <div style={{ background: 'rgba(14,14,14,0.88)', padding: '5px 8px', borderRadius: 6, border: '1px solid #6e9bff30' }}>
              <span style={{ color: '#6e9bff', fontSize: 14, fontWeight: 'bold', fontFamily: 'monospace' }}>
                {gear}<span style={{ color: '#555', fontSize: 10 }}>/{totalGears || 12}</span>
              </span>
            </div>
          )}
        </div>

        {/* Off-route alert */}
        {navigationExtras.isOffRoute && (
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 20, background: 'rgba(239,68,68,0.92)', padding: '8px 16px', borderRadius: 8 }}>
            <span style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>FORA DA ROTA — {Math.round(deviation)}m</span>
          </div>
        )}
      </div>

      {/* PROGRESS BAR */}
      <div style={{ padding: '0 10px', background: '#0e0e0e', flexShrink: 0 }}>
        <div style={{ background: '#262626', height: 6, borderRadius: 3, overflow: 'hidden', margin: '6px 0 2px' }}>
          <div style={{ width: `${Math.min(100, progress)}%`, height: '100%', background: '#3fff8b', borderRadius: 3, transition: 'width 1s ease' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 2px' }}>
          <span style={{ color: '#3fff8b', fontSize: 9, fontWeight: 'bold' }}>{doneKm.toFixed(1)} km feito</span>
          <span style={{ color: '#777', fontSize: 9 }}>{totalDistKm.toFixed(1)} km total</span>
          <span style={{ color: '#fbbf24', fontSize: 9, fontWeight: 'bold' }}>{remainKm.toFixed(1)} km falta</span>
        </div>
      </div>

      {/* ELEVATION PROFILE */}
      <div style={{ padding: '4px 10px', background: '#0e0e0e', flexShrink: 0 }}>
        <ElevationMiniProfile points={routePoints} currentIndex={currentIdx} height={56} />
      </div>

      {/* KPI GRID 3x2 */}
      <div style={{ padding: '4px 10px 4px', background: '#0e0e0e', flexShrink: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 3 }}>
          <NavKPI label="BATTERY" value={String(battery)} unit="%" color={batColor} />
          <NavKPI label="RANGE" value={rangeKm > 0 ? rangeKm.toFixed(0) : '--'} unit="km" color={rangeColor} />
          <NavKPI label="ETA" value={etaStr} unit="" color="#fbbf24" />
          <NavKPI label="POWER" value={power > 0 ? String(power) : '--'} unit="W" color="#6e9bff" />
          <NavKPI label="HR" value={hr > 0 ? String(hr) : '--'} unit="bpm" color="#ff716c" />
          <NavKPI label="CADENCE" value={cadence > 0 ? String(cadence) : '--'} unit="rpm" color="#e966ff" />
        </div>

        {/* Intelligence footer */}
        <div style={{ background: '#1a1919', marginTop: 3, padding: '5px 8px', borderRadius: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#3fff8b', fontSize: 8, fontWeight: 'bold' }}>W&apos;</span>
            <div style={{ width: 60, height: 4, background: '#333', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: '72%', height: '100%', background: '#3fff8b', borderRadius: 2 }} />
            </div>
            <span style={{ color: '#777', fontSize: 8 }}>72%</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: rangeSufficient ? '#3fff8b' : '#ff716c', fontSize: 8 }}>{'\u25CF'}</span>
            <span style={{ color: rangeSufficient ? '#3fff8b' : '#ff716c', fontSize: 8, fontWeight: 'bold' }}>
              {rangeSufficient ? 'ROTA VIAVEL' : rangeKm >= remainKm * 0.8 ? 'BATERIA JUSTA' : 'BAT. INSUFICIENTE'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Difficulty labels (Portuguese) ───────────────────────────
const DIFFICULTY_LABELS: Record<DifficultyLevel, string> = {
  easy: 'Facil',
  moderate: 'Moderado',
  hard: 'Dificil',
  extreme: 'Extremo',
};

const DIFFICULTY_LEGEND: { level: DifficultyLevel; color: string }[] = [
  { level: 'easy', color: '#3fff8b' },
  { level: 'moderate', color: '#fbbf24' },
  { level: 'hard', color: '#ff716c' },
  { level: 'extreme', color: '#a855f7' },
];

// ── Haversine for cumulative distance ────────────────────────
function haversineDist(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── ExplorationView ──────────────────────────────────────────
function ExplorationView() {
  const [routes, setRoutes] = useState<ExplorationRoute[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState<ExplorationRoute | null>(null);
  const [ready, setReady] = useState(false);

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const posMarkerRef = useRef<google.maps.Marker | null>(null);
  const routePolylinesRef = useRef<google.maps.Polyline[]>([]);

  // GPS from stores
  const lat = useMapStore((s) => s.latitude);
  const lng = useMapStore((s) => s.longitude);
  const heading = useMapStore((s) => s.heading);
  const gpsActive = useMapStore((s) => s.gpsActive);
  const speed = useBikeStore((s) => s.speed_kmh);
  const battery = useBikeStore((s) => s.battery_percent);

  // Battery color
  const batColor = battery > 30 ? '#3fff8b' : battery > 15 ? '#fbbf24' : '#ff716c';

  // Init Google Maps
  useEffect(() => {
    initGoogleMaps().then(() => setReady(true)).catch(() => { /* no-op */ });
  }, []);

  // Create map
  useEffect(() => {
    if (!ready || !mapRef.current || mapInstance.current) return;
    if (!isMapsLoaded()) return;

    mapInstance.current = new google.maps.Map(mapRef.current, {
      center: { lat: lat || 41.19, lng: lng || -8.43 },
      zoom: 14,
      mapTypeId: 'hybrid',
      disableDefaultUI: true,
      gestureHandling: 'greedy',
      tilt: 0,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Draw polylines on map
  const drawRoutes = useCallback((routeList: ExplorationRoute[]) => {
    if (!mapInstance.current) return;

    // Clear old
    routePolylinesRef.current.forEach((p) => p.setMap(null));
    routePolylinesRef.current = [];

    for (const route of routeList) {
      const pl = new google.maps.Polyline({
        path: route.points,
        map: mapInstance.current,
        strokeColor: route.color,
        strokeOpacity: 0.7,
        strokeWeight: 4,
        clickable: true,
      });
      pl.addListener('click', () => setSelectedRoute(route));
      routePolylinesRef.current.push(pl);
    }

    // Fit bounds to show all routes
    if (routeList.length > 0) {
      const bounds = new google.maps.LatLngBounds();
      for (const r of routeList) {
        for (const pt of r.points) bounds.extend(pt);
      }
      mapInstance.current.fitBounds(bounds, 30);
    }
  }, []);

  // Load routes
  const loadRoutes = useCallback(async () => {
    if (!lat || !lng) return;
    setLoading(true);
    try {
      const result = await calculateExplorationRoutes(lat, lng, 5);
      setRoutes(result);
      drawRoutes(result);
    } catch {
      /* no-op */
    }
    setLoading(false);
  }, [lat, lng, drawRoutes]);

  // Calculate routes on mount and when moved >500m
  useEffect(() => {
    if (!lat || !lng || !ready) return;
    const cached = getLastRoutes();
    if (cached.length > 0 && !shouldRecalculate(lat, lng)) {
      setRoutes(cached);
      drawRoutes(cached);
      return;
    }
    loadRoutes();
  }, [lat, lng, ready, drawRoutes, loadRoutes]);

  // Update position marker
  useEffect(() => {
    if (!mapInstance.current || !lat || !lng) return;
    const pos = { lat, lng };

    if (!posMarkerRef.current) {
      posMarkerRef.current = new google.maps.Marker({
        map: mapInstance.current,
        position: pos,
        icon: {
          path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
          scale: 6,
          fillColor: '#3fff8b',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
          rotation: heading || 0,
        },
        zIndex: 100,
      });
    } else {
      posMarkerRef.current.setPosition(pos);
      posMarkerRef.current.setIcon({
        ...(posMarkerRef.current.getIcon() as google.maps.Symbol),
        rotation: heading || 0,
      });
    }
  }, [lat, lng, heading]);

  // Highlight selected route
  useEffect(() => {
    routePolylinesRef.current.forEach((pl, i) => {
      const route = routes[i];
      if (!route) return;
      const isSelected = selectedRoute?.label === route.label;
      pl.setOptions({
        strokeOpacity: isSelected ? 1 : 0.5,
        strokeWeight: isSelected ? 6 : 3,
        zIndex: isSelected ? 10 : 1,
      });
    });
  }, [selectedRoute, routes]);

  // Activate selected route as navigation
  function activateRoute(route: ExplorationRoute) {
    const routePointsList: RoutePoint[] = [];
    let cumulDist = 0;

    for (let i = 0; i < route.points.length; i++) {
      const pt = route.points[i]!;
      if (i > 0) {
        const prev = route.points[i - 1]!;
        cumulDist += haversineDist(prev.lat, prev.lng, pt.lat, pt.lng);
      }
      routePointsList.push({
        lat: pt.lat,
        lng: pt.lng,
        elevation: 0,
        distance_from_start_m: cumulDist,
      });
    }

    useRouteStore.getState().setActiveRoute(
      {
        id: `exploration-${route.label}-${Date.now()}`,
        name: `Explorar ${route.label} — ${route.distanceKm}km`,
        description: `Rota de exploracao ${DIFFICULTY_LABELS[route.difficulty]}`,
        source: 'manual' as const,
        source_url: null,
        points: routePointsList,
        total_distance_km: route.distanceKm,
        total_elevation_gain_m: route.elevationGain,
        total_elevation_loss_m: route.elevationLoss,
        surface_summary: null,
        max_gradient_pct: route.maxGradientPct,
        avg_gradient_pct: route.avgGradientPct,
        estimated_wh: null,
        estimated_time_min: route.durationMin,
        estimated_glycogen_g: null,
        bbox_north: Math.max(...route.points.map((p) => p.lat)),
        bbox_south: Math.min(...route.points.map((p) => p.lat)),
        bbox_east: Math.max(...route.points.map((p) => p.lng)),
        bbox_west: Math.min(...route.points.map((p) => p.lng)),
        is_favorite: false,
        ride_count: 0,
        last_ridden_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      routePointsList,
    );
    useRouteStore.getState().startNavigation();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#0e0e0e' }}>

      {/* MAP (fullscreen minus bottom panel) */}
      <div style={{ flex: '1 1 0', position: 'relative', minHeight: 0 }}>
        <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

        {/* GPS badge — top center */}
        {!gpsActive && (
          <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 10, background: 'rgba(239,68,68,0.9)', padding: '4px 12px', borderRadius: 6 }}>
            <span style={{ color: '#fff', fontSize: 10, fontWeight: 'bold' }}>SEM GPS</span>
          </div>
        )}

        {/* Speed — top right */}
        <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 10, background: 'rgba(14,14,14,0.88)', padding: '6px 12px', borderRadius: 6, border: '1px solid #333' }}>
          <span style={{ color: '#fff', fontSize: 28, fontWeight: 'bold', fontFamily: 'monospace' }}>{speed > 0 ? speed.toFixed(0) : '0'}</span>
          <span style={{ color: '#777', fontSize: 10, marginLeft: 3 }}>KM/H</span>
        </div>

        {/* Loading spinner */}
        {loading && (
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 20, background: 'rgba(14,14,14,0.9)', padding: '12px 20px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 20, height: 20, border: '2px solid #3fff8b', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <span style={{ color: '#ccc', fontSize: 12 }}>A calcular rotas...</span>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* Difficulty legend — bottom left of map */}
        {routes.length > 0 && (
          <div style={{ position: 'absolute', bottom: 8, left: 8, zIndex: 10, background: 'rgba(14,14,14,0.88)', padding: '6px 10px', borderRadius: 6, display: 'flex', gap: 10, border: '1px solid #333' }}>
            {DIFFICULTY_LEGEND.map(({ level, color }) => (
              <div key={level} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color }} />
                <span style={{ color: '#aaa', fontSize: 9 }}>{DIFFICULTY_LABELS[level]}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* SELECTED ROUTE INFO */}
      {selectedRoute && (
        <div style={{ padding: '8px 10px', background: '#1a1919', borderTop: `2px solid ${selectedRoute.color}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div>
              <span style={{ color: selectedRoute.color, fontSize: 14, fontWeight: 'bold' }}>{selectedRoute.label}</span>
              <span style={{ color: '#777', fontSize: 11, marginLeft: 8 }}>
                {selectedRoute.distanceKm}km
                {' \u00B7 '}
                <span style={{ color: '#fbbf24' }}>{'\u25B2'}{selectedRoute.elevationGain}m</span>
                {' \u00B7 '}
                {selectedRoute.durationMin}min
              </span>
            </div>
            <span style={{ color: selectedRoute.color, fontSize: 11, fontWeight: 'bold', background: `${selectedRoute.color}20`, padding: '2px 8px', borderRadius: 4 }}>
              {DIFFICULTY_LABELS[selectedRoute.difficulty]}
            </span>
          </div>
          <button
            onClick={() => activateRoute(selectedRoute)}
            style={{
              width: '100%',
              padding: '10px 0',
              background: '#3fff8b',
              color: '#0e0e0e',
              border: 'none',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 'bold',
              cursor: 'pointer',
              minHeight: 44,
            }}
          >
            Navegar Esta Rota
          </button>
        </div>
      )}

      {/* FOOTER BAR */}
      <div style={{ padding: '6px 10px', background: '#0e0e0e', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #262626' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: batColor, fontSize: 11, fontWeight: 'bold' }}>BAT</span>
          <span style={{ color: batColor, fontSize: 14, fontWeight: 'bold', fontFamily: 'monospace' }}>{battery}%</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: '#777', fontSize: 11 }}>SPD</span>
          <span style={{ color: '#fff', fontSize: 14, fontWeight: 'bold', fontFamily: 'monospace' }}>{speed > 0 ? speed.toFixed(0) : '0'}</span>
        </div>
        <button
          onClick={loadRoutes}
          disabled={loading}
          style={{
            padding: '8px 16px',
            background: loading ? '#333' : '#3fff8b',
            color: loading ? '#777' : '#0e0e0e',
            border: 'none',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 'bold',
            cursor: loading ? 'default' : 'pointer',
            minHeight: 44,
          }}
        >
          {loading ? 'A calcular...' : 'Explorar'}
        </button>
      </div>
    </div>
  );
}

function NavKPI({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <div style={{ background: '#1a1919', padding: '8px 6px', textAlign: 'center', borderRadius: 4, borderLeft: `2px solid ${color}` }}>
      <div style={{ color: '#777', fontSize: 7, fontWeight: 'bold', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ color, fontSize: 20, fontWeight: 'bold', fontFamily: 'monospace' }}>
        {value}<span style={{ color: '#777', fontSize: 11 }}>{unit}</span>
      </div>
    </div>
  );
}

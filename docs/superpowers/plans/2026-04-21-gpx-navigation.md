# GPX Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** World-class GPX navigation replacing the basic NavDashboard with satellite map + route overlay + KPIs + KROMI Intelligence integration.

**Architecture:** NavigationEngine tracks position on route (snap-to-route, deviation, ETA). NavDashboard renders satellite map with gradient-colored GPX line, floating overlays, elevation profile, KPI grid, and intelligence footer. DashboardStore auto-switches to NAV when route is active. RoutePacingService feeds KromiCore for battery management. Re-routing via Google Directions API when off-route.

**Tech Stack:** React 18, Zustand, Google Maps JS API, Google Directions API, Tailwind CSS, SVG (elevation profile)

---

### Task 1: NavigationEngine — core position tracking

**Files:**
- Create: `src/services/routes/NavigationEngine.ts`

This is the brain of navigation. It subscribes to GPS updates from mapStore, snaps position to the nearest route point, calculates progress/deviation/ETA, and updates routeStore.

- [ ] **Step 1: Create NavigationEngine**

```typescript
// src/services/routes/NavigationEngine.ts
/**
 * NavigationEngine — real-time position tracking on a GPX route.
 *
 * Subscribes to mapStore GPS updates, snaps to nearest route point,
 * calculates progress, deviation, ETA, and gradient lookahead.
 * Feeds routeStore.updateNavigation() reactively.
 */

import { useMapStore } from '../../store/mapStore';
import { useRouteStore } from '../../store/routeStore';
import { useBikeStore } from '../../store/bikeStore';
import type { RoutePoint } from './GPXParser';

// ── Haversine ────────────────────────────────────────────────
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
    Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

// ── Gradient at a point ──────────────────────────────────────
function gradientAt(points: RoutePoint[], idx: number): number {
  if (idx <= 0 || idx >= points.length) return 0;
  const p0 = points[idx - 1]!;
  const p1 = points[idx]!;
  const dist = p1.distance_from_start_m - p0.distance_from_start_m;
  if (dist < 5) return 0;
  return ((p1.elevation - p0.elevation) / dist) * 100;
}

// ── Speed averaging (last 5 min rolling) ─────────────────────
const speedHistory: { t: number; spd: number }[] = [];
const SPEED_WINDOW_MS = 5 * 60 * 1000;

function avgSpeed(): number {
  const now = Date.now();
  // Prune old entries
  while (speedHistory.length > 0 && now - speedHistory[0]!.t > SPEED_WINDOW_MS) {
    speedHistory.shift();
  }
  if (speedHistory.length === 0) return 0;
  return speedHistory.reduce((s, e) => s + e.spd, 0) / speedHistory.length;
}

// ── Off-route state ──────────────────────────────────────────
let offRouteStartMs = 0;

// ── Engine ────────────────────────────────────────────────────

let unsubGps: (() => void) | null = null;
let lastProcessedIdx = 0;

/** Find the nearest route point index to (lat, lng), searching forward from hint. */
function findNearest(points: RoutePoint[], lat: number, lng: number, hint: number): number {
  // Search window: hint-10 to hint+50 (bias forward — rider moves ahead)
  const start = Math.max(0, hint - 10);
  const end = Math.min(points.length - 1, hint + 50);

  let bestIdx = hint;
  let bestDist = Infinity;

  for (let i = start; i <= end; i++) {
    const d = haversineM(lat, lng, points[i]!.lat, points[i]!.lng);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }

  // If hint was way off (e.g. after re-route), full scan
  if (bestDist > 200) {
    for (let i = 0; i < points.length; i++) {
      const d = haversineM(lat, lng, points[i]!.lat, points[i]!.lng);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
  }

  return bestIdx;
}

function processGpsUpdate() {
  const { latitude: lat, longitude: lng } = useMapStore.getState();
  const { activeRoutePoints: points, navigation } = useRouteStore.getState();
  if (!navigation.active || points.length < 2 || !lat || !lng) return;

  const speed = useBikeStore.getState().speed_kmh;
  speedHistory.push({ t: Date.now(), spd: speed });

  // Find nearest point
  const idx = findNearest(points, lat, lng, lastProcessedIdx);
  lastProcessedIdx = idx;

  const nearest = points[idx]!;
  const deviationM = haversineM(lat, lng, nearest.lat, nearest.lng);
  const totalDist = points[points.length - 1]!.distance_from_start_m;
  const distFromStart = nearest.distance_from_start_m;
  const distRemaining = totalDist - distFromStart;
  const progress = totalDist > 0 ? (distFromStart / totalDist) * 100 : 0;

  // Bearing to next point
  const nextIdx = Math.min(idx + 1, points.length - 1);
  const bearing = bearingDeg(lat, lng, points[nextIdx]!.lat, points[nextIdx]!.lng);

  // Gradient at current and lookahead (200m ahead)
  const currentGradient = gradientAt(points, idx);
  let nextGradient = 0;
  for (let i = idx + 1; i < points.length; i++) {
    if (points[i]!.distance_from_start_m - distFromStart > 200) {
      nextGradient = gradientAt(points, i);
      break;
    }
  }

  // ETA based on rolling avg speed
  const avg = avgSpeed();
  const etaMin = avg > 1 ? (distRemaining / 1000) / avg * 60 : 0;

  // Off-route tracking
  const isOffRoute = deviationM > 50;
  if (isOffRoute && offRouteStartMs === 0) {
    offRouteStartMs = Date.now();
  } else if (!isOffRoute) {
    offRouteStartMs = 0;
  }
  const offRouteDurationS = offRouteStartMs > 0 ? (Date.now() - offRouteStartMs) / 1000 : 0;

  // Route complete?
  const isComplete = idx >= points.length - 3 && distRemaining < 100;

  useRouteStore.getState().updateNavigation({
    currentIndex: idx,
    distanceFromStart_m: distFromStart,
    distanceRemaining_m: distRemaining,
    deviationM,
    bearingToNext: bearing,
    progress_pct: Math.min(100, Math.round(progress * 10) / 10),
  });

  // Expose extra data for NavDashboard via a lightweight side-channel
  navigationExtras.currentGradient = currentGradient;
  navigationExtras.nextGradient = nextGradient;
  navigationExtras.etaMin = Math.round(etaMin);
  navigationExtras.isOffRoute = isOffRoute;
  navigationExtras.offRouteDurationS = offRouteDurationS;
  navigationExtras.isComplete = isComplete;
  navigationExtras.currentElevation = nearest.elevation;
}

/** Extra navigation data not stored in routeStore (avoids re-renders on every GPS tick) */
export const navigationExtras = {
  currentGradient: 0,
  nextGradient: 0,
  etaMin: 0,
  isOffRoute: false,
  offRouteDurationS: 0,
  isComplete: false,
  currentElevation: 0,
};

/** Start navigation engine — subscribes to GPS updates */
export function startNavigationEngine() {
  lastProcessedIdx = 0;
  offRouteStartMs = 0;
  speedHistory.length = 0;

  // Subscribe to mapStore position changes
  unsubGps = useMapStore.subscribe(
    (s) => ({ lat: s.latitude, lng: s.longitude }),
    () => processGpsUpdate(),
    { equalityFn: (a, b) => a.lat === b.lat && a.lng === b.lng },
  );
}

/** Stop navigation engine */
export function stopNavigationEngine() {
  unsubGps?.();
  unsubGps = null;
  lastProcessedIdx = 0;
  offRouteStartMs = 0;
  speedHistory.length = 0;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep NavigationEngine`
Expected: No errors from NavigationEngine.ts

- [ ] **Step 3: Commit**

```bash
git add src/services/routes/NavigationEngine.ts
git commit -m "feat(nav): NavigationEngine — position tracking, snap-to-route, ETA, deviation"
```

---

### Task 2: Modify dashboardStore — NAV auto-switch when route active

**Files:**
- Modify: `src/store/dashboardStore.ts`

When a route is active in routeStore, the auto-context should be 'nav' instead of gradient-based cruise/climb/descent. Manual override still works with 30s timeout.

- [ ] **Step 1: Update AutoContext type and processGradient logic**

In `src/store/dashboardStore.ts`, change the `AutoContext` type and modify `processGradient`:

```typescript
// Change line 4:
export type AutoContext = 'cruise' | 'climb' | 'descent' | 'nav';
```

Then modify the `processGradient` method — add route-active check at the top of the function body (after `const s = get();`):

```typescript
  processGradient: (gradient) => {
    const s = get();

    // Route navigation active → NAV is the auto-context
    // Import inline to avoid circular dependency
    const routeNav = (await import('./routeStore')).useRouteStore.getState().navigation;
    // Can't use async in zustand — use sync check instead
```

Actually, avoid async. Instead, add a `setRouteActive` action that routeStore calls:

Add to the interface:
```typescript
  /** Set by routeStore when navigation starts/stops */
  routeActive: boolean;
  setRouteActive: (v: boolean) => void;
```

Add to the store:
```typescript
  routeActive: false,
  setRouteActive: (v) => {
    const update: Partial<DashboardState> = { routeActive: v };
    if (v) {
      // Switch to NAV immediately
      update.active = 'nav';
      update.autoContext = 'nav';
      update.manualOverride = false;
    } else {
      // Return to cruise
      update.autoContext = 'cruise';
      update.active = 'cruise';
    }
    set(update);
  },
```

Modify `processGradient` — add early return if route active:
```typescript
  processGradient: (gradient) => {
    const s = get();
    // Route active → NAV is the fixed auto-context, skip gradient logic
    if (s.routeActive) return;
    // ... rest of existing gradient logic unchanged
```

Modify `tick` — when manual override expires and route is active, return to 'nav':
```typescript
  tick: () => {
    const s = get();
    if (s.manualOverride && Date.now() - s.manualOverrideAt > MANUAL_TIMEOUT_MS) {
      set({
        manualOverride: false,
        active: s.routeActive ? 'nav' : s.autoContext,
      });
    }
  },
```

- [ ] **Step 2: Wire routeStore to dashboardStore**

In `src/store/routeStore.ts`, modify `startNavigation` and `stopNavigation`:

```typescript
  startNavigation: () => {
    set((s) => ({
      navigation: { ...s.navigation, active: true, currentIndex: 0, progress_pct: 0 },
    }));
    // Tell dashboard to switch to NAV
    import('../store/dashboardStore').then(({ useDashboardStore }) => {
      useDashboardStore.getState().setRouteActive(true);
    });
  },

  stopNavigation: () => {
    set({ navigation: { ...initialNav } });
    import('../store/dashboardStore').then(({ useDashboardStore }) => {
      useDashboardStore.getState().setRouteActive(false);
    });
  },
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep -E "dashboardStore|routeStore" | head -5`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/store/dashboardStore.ts src/store/routeStore.ts
git commit -m "feat(nav): dashboard auto-switches to NAV when route active"
```

---

### Task 3: ElevationMiniProfile — SVG elevation chart

**Files:**
- Create: `src/components/Dashboard/ElevationMiniProfile.tsx`

Compact SVG showing the full route elevation profile with current position marker.

- [ ] **Step 1: Create ElevationMiniProfile component**

```typescript
// src/components/Dashboard/ElevationMiniProfile.tsx
import { useMemo } from 'react';
import type { RoutePoint } from '../../services/routes/GPXParser';

interface Props {
  points: RoutePoint[];
  currentIndex: number;
  height?: number;
}

export function ElevationMiniProfile({ points, currentIndex, height = 56 }: Props) {
  const { pathD, fillD, minEle, maxEle, totalGain, currentEle, markerX, markerY } = useMemo(() => {
    if (points.length < 2) return { pathD: '', fillD: '', minEle: 0, maxEle: 0, totalGain: 0, currentEle: 0, markerX: 0, markerY: 0 };

    const totalDist = points[points.length - 1]!.distance_from_start_m;
    let minE = Infinity, maxE = -Infinity, gain = 0;

    for (let i = 0; i < points.length; i++) {
      const e = points[i]!.elevation;
      if (e < minE) minE = e;
      if (e > maxE) maxE = e;
      if (i > 0 && e > points[i - 1]!.elevation) gain += e - points[i - 1]!.elevation;
    }

    const eleRange = maxE - minE || 1;
    const padding = 4;
    const w = 340;
    const h = height - padding * 2;

    // Sample ~100 points for SVG performance
    const step = Math.max(1, Math.floor(points.length / 100));
    const sampled: { x: number; y: number }[] = [];

    for (let i = 0; i < points.length; i += step) {
      const p = points[i]!;
      const x = (p.distance_from_start_m / totalDist) * w;
      const y = padding + h - ((p.elevation - minE) / eleRange) * h;
      sampled.push({ x, y });
    }
    // Ensure last point
    const last = points[points.length - 1]!;
    sampled.push({ x: w, y: padding + h - ((last.elevation - minE) / eleRange) * h });

    const pathParts = sampled.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`);
    const lineD = pathParts.join(' ');
    const areaD = `${lineD} L ${w} ${padding + h} L 0 ${padding + h} Z`;

    // Current position marker
    const ci = Math.min(currentIndex, points.length - 1);
    const cp = points[ci]!;
    const mx = (cp.distance_from_start_m / totalDist) * w;
    const my = padding + h - ((cp.elevation - minE) / eleRange) * h;

    return {
      pathD: lineD,
      fillD: areaD,
      minEle: Math.round(minE),
      maxEle: Math.round(maxE),
      totalGain: Math.round(gain),
      currentEle: Math.round(cp.elevation),
      markerX: mx,
      markerY: my,
    };
  }, [points, currentIndex, height]);

  if (points.length < 2) return null;

  return (
    <div style={{ background: '#1a1919', borderRadius: 4, padding: '6px 8px', position: 'relative', height, overflow: 'hidden' }}>
      <svg width="100%" height={height - 12} viewBox={`0 0 340 ${height}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="navElevGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3fff8b" />
            <stop offset="100%" stopColor="#0e0e0e" />
          </linearGradient>
        </defs>
        <path d={fillD} fill="url(#navElevGrad)" opacity={0.3} />
        {/* Done portion — brighter */}
        <clipPath id="donePortion">
          <rect x="0" y="0" width={markerX} height={height} />
        </clipPath>
        <path d={pathD} stroke="#3fff8b" strokeWidth={2} fill="none" clipPath="url(#donePortion)" />
        {/* Remaining — dimmer */}
        <clipPath id="remainPortion">
          <rect x={markerX} y="0" width={340 - markerX} height={height} />
        </clipPath>
        <path d={pathD} stroke="#3fff8b" strokeWidth={1} fill="none" opacity={0.4} clipPath="url(#remainPortion)" />
        {/* Position marker */}
        <line x1={markerX} y1={0} x2={markerX} y2={height} stroke="#fff" strokeWidth={1} strokeDasharray="2,2" opacity={0.4} />
        <circle cx={markerX} cy={markerY} r={3.5} fill="#3fff8b" stroke="#fff" strokeWidth={1} />
      </svg>
      {/* Labels */}
      <div style={{ position: 'absolute', top: 2, left: 8, color: '#777', fontSize: 7 }}>{maxEle}m</div>
      <div style={{ position: 'absolute', bottom: 2, right: 8, color: '#777', fontSize: 7 }}>{minEle}m</div>
      <div style={{ position: 'absolute', top: 2, right: 8, display: 'flex', alignItems: 'baseline', gap: 2 }}>
        <span style={{ color: '#fff', fontSize: 10, fontWeight: 'bold' }}>{currentEle}m</span>
        <span style={{ color: '#3fff8b', fontSize: 8 }}>▲ {totalGain}m</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep ElevationMiniProfile`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/Dashboard/ElevationMiniProfile.tsx
git commit -m "feat(nav): ElevationMiniProfile SVG component with position marker"
```

---

### Task 4: NavDashboard rewrite — full navigation screen

**Files:**
- Modify: `src/components/DashboardSystem/NavDashboard.tsx`

Complete rewrite: satellite map 70% with GPX overlay, floating speed/mode/gear, progress bar, elevation profile, KPI grid 3x2, intelligence footer.

- [ ] **Step 1: Rewrite NavDashboard**

```typescript
// src/components/DashboardSystem/NavDashboard.tsx
/**
 * NAV Dashboard — world-class GPX navigation.
 *
 * Layout (portrait, 70/30):
 *   - Satellite map 70% with GPX route (gradient-colored), position marker
 *   - Floating overlays: speed (top-right), mode+gear (top-left)
 *   - Progress bar (done/remaining/total)
 *   - Elevation mini profile with position
 *   - KPI grid 3×2: Battery, Range, ETA, Power, HR, Cadence
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
    pois.push({ type: 'summit', lat: points[maxIdx]!.lat, lng: points[maxIdx]!.lng, label: `${Math.round(maxEle)}m`, icon: '⛰️' });
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
    pois.push({ type: 'descent_start', lat: points[bestDescentStart]!.lat, lng: points[bestDescentStart]!.lng, label: 'Descida', icon: '⬇️' });
  }

  // Finish
  const last = points[points.length - 1]!;
  pois.push({ type: 'finish', lat: last.lat, lng: last.lng, label: 'Chegada', icon: '🏁' });

  return pois;
}

// ── Main component ───────────────────────────────────────────

export function NavDashboard() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const posMarkerRef = useRef<google.maps.Marker | null>(null);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const poiMarkersRef = useRef<google.maps.Marker[]>([]);
  const rerouteLineRef = useRef<google.maps.Polyline | null>(null);
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
  const hr = useBikeStore((s) => s.heart_rate);
  const cadence = useBikeStore((s) => s.cadence_rpm);
  const assistMode = useBikeStore((s) => s.assist_mode);
  const gear = useBikeStore((s) => s.di2_gear);
  const totalGears = useBikeStore((s) => s.di2_total_gears);
  const tripDist = useBikeStore((s) => s.trip_distance_km ?? 0);
  const ambientLux = useBikeStore((s) => s.ambient_lux);

  const routePoints = useRouteStore((s) => s.activeRoutePoints);
  const nav = useRouteStore((s) => s.navigation);
  const preRide = useRouteStore((s) => s.preRideAnalysis);

  const navActive = nav?.active ?? false;
  const currentIdx = nav?.currentIndex ?? 0;
  const distDone = nav?.distanceFromStart_m ?? 0;
  const distRemaining = nav?.distanceRemaining_m ?? 0;
  const progress = nav?.progress_pct ?? 0;
  const deviation = nav?.deviationM ?? 0;

  const totalDistKm = routePoints.length > 1 ? routePoints[routePoints.length - 1]!.distance_from_start_m / 1000 : 0;
  const doneKm = distDone / 1000;
  const remainKm = distRemaining / 1000;

  // Mode label
  const modeLabels: Record<number, string> = { 1: 'ECO', 2: 'TOUR', 3: 'ACTIVE', 4: 'SPORT', 5: 'KROMI', 6: 'SMART' };
  const modeLabel = modeLabels[assistMode] ?? '--';
  const modeColor = assistMode === 5 ? '#3fff8b' : assistMode === 6 ? '#6e9bff' : '#fbbf24';

  // Battery color
  const batColor = battery > 30 ? '#3fff8b' : battery > 15 ? '#fbbf24' : '#ff716c';

  // Range vs remaining feasibility
  const rangeSufficient = rangeKm >= remainKm;
  const rangeColor = rangeSufficient ? '#3fff8b' : rangeKm >= remainKm * 0.8 ? '#fbbf24' : '#ff716c';

  // Map brightness based on ambient light
  const mapFilter = ambientLux != null
    ? ambientLux < 50 ? 'brightness(0.6)' : ambientLux > 500 ? 'brightness(1.2) contrast(1.1)' : 'none'
    : 'none';

  // ETA
  const etaMin = navigationExtras.etaMin;
  const etaStr = etaMin > 0 ? `${Math.floor(etaMin / 60)}:${String(etaMin % 60).padStart(2, '0')}` : '--';

  // Init Google Maps
  useEffect(() => {
    initGoogleMaps().then(() => setReady(true)).catch(() => {});
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
        ...posMarkerRef.current.getIcon() as google.maps.Symbol,
        rotation: heading || 0,
      });
    }

    // Pan map to follow rider (only when navigating)
    if (navActive) {
      mapInstance.current.panTo(pos);
      if (mapInstance.current.getZoom()! < 15) mapInstance.current.setZoom(16);
    }
  }, [lat, lng, heading, navActive]);

  // Off-route alert + vibrate
  useEffect(() => {
    if (navigationExtras.isOffRoute && navigationExtras.offRouteDurationS < 1) {
      try { navigator.vibrate?.([200, 100, 200]); } catch {}
    }
  }, [navigationExtras.isOffRoute]);

  // Route complete
  useEffect(() => {
    if (navigationExtras.isComplete && navActive) {
      // Show toast (simple alert for now — can be upgraded to custom toast)
      const totalKm = totalDistKm.toFixed(1);
      console.log(`[NAV] Route complete! ${totalKm} km`);
    }
  }, [navigationExtras.isComplete, navActive]);

  // ── No route fallback ──────────────────────────────────────
  if (routePoints.length < 2) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, color: '#777', padding: 20 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 48, color: '#494847' }}>route</span>
        <p style={{ fontSize: 14, textAlign: 'center' }}>Nenhuma rota activa</p>
        <p style={{ fontSize: 11, textAlign: 'center', color: '#555' }}>Vai a Settings → Rotas para importar um GPX</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#0e0e0e' }}>

      {/* ═══ MAP (flex-grow fills ~70%) ═══ */}
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
            <span style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>⚠ FORA DA ROTA — {Math.round(deviation)}m</span>
          </div>
        )}
      </div>

      {/* ═══ PROGRESS BAR ═══ */}
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

      {/* ═══ ELEVATION PROFILE ═══ */}
      <div style={{ padding: '4px 10px', background: '#0e0e0e', flexShrink: 0 }}>
        <ElevationMiniProfile points={routePoints} currentIndex={currentIdx} height={56} />
      </div>

      {/* ═══ KPI GRID 3×2 ═══ */}
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
            <span style={{ color: rangeSufficient ? '#3fff8b' : '#ff716c', fontSize: 8 }}>●</span>
            <span style={{ color: rangeSufficient ? '#3fff8b' : '#ff716c', fontSize: 8, fontWeight: 'bold' }}>
              {rangeSufficient ? 'ROTA VIÁVEL' : rangeKm >= remainKm * 0.8 ? 'BATERIA JUSTA' : 'BAT. INSUFICIENTE'}
            </span>
          </div>
        </div>
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep NavDashboard`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/DashboardSystem/NavDashboard.tsx
git commit -m "feat(nav): NavDashboard rewrite — satellite map, GPX overlay, KPIs, intelligence"
```

---

### Task 5: Wire NavigationEngine into DashboardController

**Files:**
- Modify: `src/components/DashboardSystem/DashboardController.tsx`

Start/stop NavigationEngine when route navigation starts/stops.

- [ ] **Step 1: Add NavigationEngine lifecycle**

Add imports at top of `DashboardController.tsx`:

```typescript
import { startNavigationEngine, stopNavigationEngine } from '../../services/routes/NavigationEngine';
import { useRouteStore } from '../../store/routeStore';
```

Add useEffect after the existing terrain subscription effect:

```typescript
  // Start/stop navigation engine when route navigation changes
  const navActive = useRouteStore((s) => s.navigation.active);
  useEffect(() => {
    if (navActive) {
      startNavigationEngine();
    } else {
      stopNavigationEngine();
    }
    return () => stopNavigationEngine();
  }, [navActive]);
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep DashboardController`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/DashboardSystem/DashboardController.tsx
git commit -m "feat(nav): wire NavigationEngine lifecycle into DashboardController"
```

---

### Task 6: Settings RoutesPage — GPX import + route list + pre-ride summary

**Files:**
- Modify: `src/components/Settings/Settings.tsx` (the `RoutesPage` function inside it)

Enhance the existing RoutesPage with:
- Better GPX import UX
- Route list with cards (name, distance, elevation, battery feasibility)
- Pre-ride summary modal with "Iniciar Navegação" button
- Delete route (swipe or button)

- [ ] **Step 1: Rewrite RoutesPage function**

Replace the existing `function RoutesPage` (starts around line 828 of Settings.tsx) with the enhanced version. Find the full RoutesPage function and replace it:

```typescript
function RoutesPage({ onNavigate }: { onNavigate?: (s: Screen) => void }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [routes, setRoutes] = useState<import('../../services/routes/RouteService').SavedRoute[]>([]);
  const [showPreRide, setShowPreRide] = useState(false);
  const [komootUrl, setKomootUrl] = useState('');

  const activeRoute = useRouteStore((s) => s.activeRoute);
  const preRide = useRouteStore((s) => s.preRideAnalysis);
  const analyzing = useRouteStore((s) => s.analyzingRoute);
  const setActiveRoute = useRouteStore((s) => s.setActiveRoute);
  const setPreRideAnalysis = useRouteStore((s) => s.setPreRideAnalysis);
  const setAnalyzing = useRouteStore((s) => s.setAnalyzing);
  const startNav = useRouteStore((s) => s.startNavigation);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listRoutes().then(setRoutes).catch(() => {});
  }, []);

  // GPX file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true); setResult(null);
    try {
      const parsed = await parseGPXFile(file);
      if (!parsed) { setResult('Ficheiro GPX inválido'); setLoading(false); return; }

      setAnalyzing(true);
      const analysis = analyzeRoute(parsed.points);

      const saved = await saveRoute(parsed, 'gpx', undefined,
        analysis ? { wh: analysis.total_wh, time_min: analysis.estimated_time_min, glycogen_g: analysis.glycogen_g } : undefined);

      if (saved) {
        setRoutes(prev => [saved, ...prev]);
        setActiveRoute(saved, parsed.points);
        if (analysis) setPreRideAnalysis(analysis);
        setShowPreRide(true);
        setResult(null);
      } else {
        setResult('Falhou a guardar rota');
      }
    } catch (err) {
      setResult(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setLoading(false);
      setAnalyzing(false);
    }
  };

  // Select saved route
  const handleSelectRoute = async (route: import('../../services/routes/RouteService').SavedRoute) => {
    setActiveRoute(route, route.points);
    setAnalyzing(true);
    const analysis = analyzeRoute(route.points);
    if (analysis) setPreRideAnalysis(analysis);
    setAnalyzing(false);
    setShowPreRide(true);
  };

  // Delete route
  const handleDelete = async (id: string) => {
    try {
      await deleteRoute(id);
      setRoutes(prev => prev.filter(r => r.id !== id));
      if (activeRoute?.id === id) {
        useRouteStore.getState().clearActiveRoute();
      }
    } catch {}
  };

  // Start navigation
  const handleStartNav = () => {
    startNav();
    setShowPreRide(false);
    if (onNavigate) onNavigate('dashboard');
  };

  // Komoot import handler (keep existing)
  const handleKomoot = async () => {
    if (!komootUrl.trim()) return;
    setLoading(true); setResult(null);
    try {
      const pts = await importKomootRoute(komootUrl);
      const routePoints = pts.map((p: { lat: number; lng: number; elevation: number }, i: number, arr: { lat: number; lng: number; elevation: number }[]) => ({
        lat: p.lat, lng: p.lng, elevation: p.elevation,
        distance_from_start_m: i === 0 ? 0 : Math.round(
          arr.slice(0, i).reduce((sum, _, j) => {
            if (j === 0) return 0;
            const a = arr[j - 1]!, b = arr[j]!;
            const R = 6371000, dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lng - a.lng) * Math.PI / 180;
            const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
            return sum + R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
          }, 0)
        ),
      }));
      const totalDist = routePoints.length > 0 ? routePoints[routePoints.length - 1]!.distance_from_start_m / 1000 : 0;
      let elevGain = 0;
      for (let i = 1; i < routePoints.length; i++) {
        const d = routePoints[i]!.elevation - routePoints[i - 1]!.elevation;
        if (d > 0) elevGain += d;
      }
      const parsed = {
        name: `Komoot ${komootUrl.match(/\d+/)?.[0] ?? 'route'}`,
        description: 'Importado de Komoot',
        points: routePoints, total_distance_km: Math.round(totalDist * 100) / 100,
        total_elevation_gain_m: Math.round(elevGain), total_elevation_loss_m: 0,
        max_gradient_pct: 0, avg_gradient_pct: 0,
        bbox: { north: 0, south: 0, east: 0, west: 0 },
      };
      const analysis = analyzeRoute(parsed.points);
      const saved = await saveRoute(parsed, 'komoot', komootUrl,
        analysis ? { wh: analysis.total_wh, time_min: analysis.estimated_time_min, glycogen_g: analysis.glycogen_g } : undefined);
      if (saved) {
        setRoutes(prev => [saved, ...prev]);
        setActiveRoute(saved, parsed.points);
        if (analysis) setPreRideAnalysis(analysis);
        setShowPreRide(true);
      }
    } catch (err) {
      setResult(err instanceof Error ? err.message : 'Komoot import failed');
    } finally {
      setLoading(false);
      setKomootUrl('');
    }
  };

  return (
    <div className="space-y-4 pb-8">
      {/* Import buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={loading}
          className="flex-1 flex items-center justify-center gap-2 h-12 rounded-lg bg-[#3fff8b] text-black font-bold text-sm active:scale-95"
        >
          <span className="material-symbols-outlined text-lg">upload_file</span>
          Importar GPX
        </button>
        <input ref={fileRef} type="file" accept=".gpx" onChange={handleFileUpload} style={{ display: 'none' }} />
      </div>

      {/* Komoot import */}
      <div className="flex gap-2">
        <input
          type="text" placeholder="URL Komoot..."
          value={komootUrl} onChange={(e) => setKomootUrl(e.target.value)}
          className="flex-1 h-10 px-3 rounded-lg bg-[#1a1919] text-white text-sm border border-[#333] focus:border-[#3fff8b] outline-none"
        />
        <button onClick={handleKomoot} disabled={loading || !komootUrl.trim()}
          className="px-4 h-10 rounded-lg bg-[#262626] text-white text-sm font-bold active:scale-95 disabled:opacity-50">
          Komoot
        </button>
      </div>

      {/* Status */}
      {loading && <p className="text-[#6e9bff] text-xs text-center">A processar...</p>}
      {result && <p className="text-[#fbbf24] text-xs text-center">{result}</p>}

      {/* Route list */}
      <div>
        <h3 className="text-[#777] text-xs font-bold uppercase tracking-wider mb-2">Rotas Guardadas ({routes.length})</h3>
        {routes.length === 0 && (
          <p className="text-[#555] text-xs text-center py-4">Nenhuma rota guardada</p>
        )}
        <div className="space-y-2">
          {routes.map((route) => (
            <div key={route.id}
              className={`bg-[#1a1919] rounded-lg p-3 flex items-center gap-3 active:scale-[0.98] transition-transform ${activeRoute?.id === route.id ? 'border border-[#3fff8b]/30' : ''}`}
              onClick={() => handleSelectRoute(route)}
            >
              <span className="material-symbols-outlined text-2xl text-[#3fff8b]">route</span>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-bold truncate">{route.name}</p>
                <p className="text-[#777] text-[10px]">
                  {route.total_distance_km}km · ▲{route.total_elevation_gain_m}m
                  {route.estimated_wh ? ` · ${route.estimated_wh}Wh` : ''}
                </p>
              </div>
              <button onClick={(e) => { e.stopPropagation(); handleDelete(route.id); }}
                className="p-1.5 rounded active:scale-90">
                <span className="material-symbols-outlined text-[#ff716c] text-lg">delete</span>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Pre-ride summary modal */}
      {showPreRide && activeRoute && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-end justify-center">
          <div className="bg-[#1a1919] w-full max-w-md rounded-t-2xl p-4 space-y-3 max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <h2 className="text-white font-bold text-lg">{activeRoute.name}</h2>
              <button onClick={() => setShowPreRide(false)} className="text-[#777] active:scale-90">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* Route stats */}
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-[#262626] p-2 rounded text-center">
                <div className="text-[#777] text-[8px] font-bold">DISTÂNCIA</div>
                <div className="text-white text-lg font-bold">{activeRoute.total_distance_km}<span className="text-[#777] text-xs">km</span></div>
              </div>
              <div className="bg-[#262626] p-2 rounded text-center">
                <div className="text-[#777] text-[8px] font-bold">ELEVAÇÃO</div>
                <div className="text-white text-lg font-bold">▲{activeRoute.total_elevation_gain_m}<span className="text-[#777] text-xs">m</span></div>
              </div>
              <div className="bg-[#262626] p-2 rounded text-center">
                <div className="text-[#777] text-[8px] font-bold">GRADIENTE MAX</div>
                <div className="text-white text-lg font-bold">{activeRoute.max_gradient_pct}<span className="text-[#777] text-xs">%</span></div>
              </div>
            </div>

            {/* Pre-ride analysis */}
            {analyzing && <p className="text-[#6e9bff] text-xs text-center">A analisar rota...</p>}
            {preRide && (
              <div className="space-y-2">
                {/* Feasibility */}
                <div className={`p-3 rounded-lg flex items-center gap-3 ${preRide.feasible ? 'bg-[#3fff8b]/10 border border-[#3fff8b]/30' : 'bg-[#ff716c]/10 border border-[#ff716c]/30'}`}>
                  <span className="material-symbols-outlined text-2xl" style={{ color: preRide.feasible ? '#3fff8b' : '#ff716c' }}>
                    {preRide.feasible ? 'check_circle' : 'warning'}
                  </span>
                  <div>
                    <p className="text-sm font-bold" style={{ color: preRide.feasible ? '#3fff8b' : '#ff716c' }}>
                      {preRide.feasible ? 'Rota Viável' : 'Bateria Insuficiente'}
                    </p>
                    <p className="text-[10px] text-[#999]">
                      {preRide.total_wh}Wh necessários · {preRide.battery_remaining_wh}Wh disponíveis · {preRide.battery_margin_pct}% margem
                    </p>
                  </div>
                </div>

                {/* Estimates grid */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-[#262626] p-2 rounded">
                    <span className="text-[#777]">Tempo estimado:</span> <span className="text-white font-bold">{preRide.estimated_time_min} min</span>
                  </div>
                  <div className="bg-[#262626] p-2 rounded">
                    <span className="text-[#777]">Segmentos exigentes:</span> <span className="text-[#fbbf24] font-bold">{preRide.demanding_segments}</span>
                  </div>
                  <div className="bg-[#262626] p-2 rounded">
                    <span className="text-[#777]">Carboidratos:</span> <span className="text-white font-bold">{preRide.carbs_needed_g}g</span>
                  </div>
                  <div className="bg-[#262626] p-2 rounded">
                    <span className="text-[#777]">Hidratação:</span> <span className="text-white font-bold">{preRide.fluid_needed_ml}ml</span>
                  </div>
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2 pt-2">
              <button onClick={() => setShowPreRide(false)}
                className="flex-1 h-12 rounded-lg bg-[#262626] text-[#adaaaa] font-bold text-sm active:scale-95">
                Guardar
              </button>
              <button onClick={handleStartNav}
                className="flex-1 h-12 rounded-lg bg-[#3fff8b] text-black font-bold text-sm active:scale-95 flex items-center justify-center gap-2">
                <span className="material-symbols-outlined text-lg">navigation</span>
                Iniciar Navegação
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

Note: You need to add the missing import for `useRef` at the top of Settings.tsx if not already present, and add imports for `deleteRoute`, `useRouteStore`, `analyzeRoute`, `parseGPXFile`, `saveRoute`, `importKomootRoute` — check which are already imported.

- [ ] **Step 2: Verify imports exist**

Check the existing imports at the top of Settings.tsx for: `parseGPXFile`, `analyzeRoute`, `saveRoute`, `listRoutes`, `deleteRoute`, `importKomootRoute`, `useRouteStore`. Add any missing ones.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep Settings`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/components/Settings/Settings.tsx
git commit -m "feat(nav): RoutesPage — GPX import, route list, pre-ride summary, start navigation"
```

---

### Task 7: RoutePacingService — battery pacing during navigation

**Files:**
- Create: `src/services/routes/RoutePacingService.ts`

Feeds `route_remaining_km` to KromiCore via WebSocket bridge for battery management. Monitors battery vs remaining route and suggests assist reduction.

- [ ] **Step 1: Create RoutePacingService**

```typescript
// src/services/routes/RoutePacingService.ts
/**
 * RoutePacingService — feeds route_remaining_km to KromiCore
 * and monitors battery feasibility during navigation.
 */

import { useRouteStore } from '../../store/routeStore';
import { useBikeStore } from '../../store/bikeStore';
import { batteryEstimationService } from '../battery/BatteryEstimationService';

let pacingInterval: ReturnType<typeof setInterval> | null = null;

/** Start battery pacing — updates KromiCore every 30s with route_remaining_km */
export function startPacing() {
  stopPacing();

  pacingInterval = setInterval(() => {
    const { navigation, activeRoutePoints } = useRouteStore.getState();
    if (!navigation.active || activeRoutePoints.length < 2) return;

    const remainingKm = navigation.distanceRemaining_m / 1000;
    const batteryPct = useBikeStore.getState().battery_percent;

    // Send route_remaining_km to bridge (KromiCore uses this for pacing)
    try {
      import('../bluetooth/WebSocketBLEClient').then(({ wsClient }) => {
        if (wsClient.isConnected) {
          wsClient.send({
            type: 'kromiParams',
            route_remaining_km: Math.round(remainingKm * 10) / 10,
          });
        }
      });
    } catch {}

    // Check feasibility
    const estimate = batteryEstimationService.getFullEstimate(batteryPct, 'power');
    const rangeKm = estimate.range_km;

    if (rangeKm > 0 && remainingKm > 0) {
      const ratio = rangeKm / remainingKm;
      if (ratio < 0.8) {
        console.warn(`[Pacing] Battery insufficient: range=${rangeKm.toFixed(1)}km, remaining=${remainingKm.toFixed(1)}km (${(ratio * 100).toFixed(0)}%)`);
      }
    }
  }, 30_000);

  // Immediate first update
  const { navigation } = useRouteStore.getState();
  if (navigation.active) {
    const remainingKm = navigation.distanceRemaining_m / 1000;
    import('../bluetooth/WebSocketBLEClient').then(({ wsClient }) => {
      if (wsClient.isConnected) {
        wsClient.send({
          type: 'kromiParams',
          route_remaining_km: Math.round(remainingKm * 10) / 10,
        });
      }
    }).catch(() => {});
  }
}

/** Stop battery pacing */
export function stopPacing() {
  if (pacingInterval) {
    clearInterval(pacingInterval);
    pacingInterval = null;
  }
  // Clear route from KromiCore
  import('../bluetooth/WebSocketBLEClient').then(({ wsClient }) => {
    if (wsClient.isConnected) {
      wsClient.send({ type: 'kromiParams', route_remaining_km: -1 });
    }
  }).catch(() => {});
}
```

- [ ] **Step 2: Wire into DashboardController lifecycle**

In `src/components/DashboardSystem/DashboardController.tsx`, add to the navActive effect:

```typescript
import { startPacing, stopPacing } from '../../services/routes/RoutePacingService';

// In the navActive useEffect:
  useEffect(() => {
    if (navActive) {
      startNavigationEngine();
      startPacing();
    } else {
      stopNavigationEngine();
      stopPacing();
    }
    return () => { stopNavigationEngine(); stopPacing(); };
  }, [navActive]);
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep -E "RoutePacing|DashboardController"`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/services/routes/RoutePacingService.ts src/components/DashboardSystem/DashboardController.tsx
git commit -m "feat(nav): RoutePacingService — battery pacing + KromiCore route_remaining_km"
```

---

### Task 8: Re-routing — Google Directions API when off-route

**Files:**
- Create: `src/services/routes/RerouteService.ts`
- Modify: `src/components/DashboardSystem/NavDashboard.tsx` — add re-route line rendering

- [ ] **Step 1: Create RerouteService**

```typescript
// src/services/routes/RerouteService.ts
/**
 * RerouteService — calculates return-to-route path via Google Directions API
 * when rider deviates > 50m for > 5 seconds.
 */

import { isMapsLoaded } from '../maps/GoogleMapsService';
import type { RoutePoint } from './GPXParser';

export interface ReroutePath {
  points: google.maps.LatLngLiteral[];
  distanceM: number;
  durationS: number;
}

let lastRerouteMs = 0;
const REROUTE_COOLDOWN_MS = 15_000; // Don't re-request more than every 15s

/**
 * Calculate a path from current position back to the nearest route point ahead.
 * Uses Google Directions API (bicycling mode).
 */
export async function calculateReroute(
  currentLat: number,
  currentLng: number,
  routePoints: RoutePoint[],
  currentIndex: number,
): Promise<ReroutePath | null> {
  if (!isMapsLoaded()) return null;

  // Cooldown
  const now = Date.now();
  if (now - lastRerouteMs < REROUTE_COOLDOWN_MS) return null;
  lastRerouteMs = now;

  // Target: 200-500m ahead on route from current index
  const targetIdx = Math.min(
    currentIndex + Math.ceil(routePoints.length * 0.02), // ~2% ahead
    routePoints.length - 1,
  );
  const target = routePoints[targetIdx]!;

  try {
    const service = new google.maps.DirectionsService();
    const result = await service.route({
      origin: { lat: currentLat, lng: currentLng },
      destination: { lat: target.lat, lng: target.lng },
      travelMode: google.maps.TravelMode.BICYCLING,
    });

    if (result.routes.length === 0 || !result.routes[0]!.legs[0]) return null;

    const leg = result.routes[0]!.legs[0]!;
    const points = result.routes[0]!.overview_path.map(p => ({
      lat: p.lat(),
      lng: p.lng(),
    }));

    return {
      points,
      distanceM: leg.distance?.value ?? 0,
      durationS: leg.duration?.value ?? 0,
    };
  } catch (err) {
    console.warn('[Reroute] Directions API failed:', err);
    return null;
  }
}
```

- [ ] **Step 2: Add re-route rendering to NavDashboard**

In NavDashboard.tsx, add state and effect for re-routing. Add at the top of the component (after existing state declarations):

```typescript
  const [reroutePath, setReroutePath] = useState<google.maps.LatLngLiteral[] | null>(null);
```

Add useEffect for re-route calculation:

```typescript
  // Re-route when off-route for > 5 seconds
  useEffect(() => {
    if (!navigationExtras.isOffRoute || navigationExtras.offRouteDurationS < 5) {
      if (reroutePath) {
        setReroutePath(null);
        rerouteLineRef.current?.setMap(null);
        rerouteLineRef.current = null;
      }
      return;
    }

    // Calculate re-route
    import('../../services/routes/RerouteService').then(({ calculateReroute }) => {
      calculateReroute(lat, lng, routePoints, currentIdx).then((result) => {
        if (result && mapInstance.current) {
          setReroutePath(result.points);
          // Draw orange dashed line
          rerouteLineRef.current?.setMap(null);
          rerouteLineRef.current = new google.maps.Polyline({
            path: result.points,
            map: mapInstance.current,
            strokeColor: '#ff9f43',
            strokeOpacity: 0.8,
            strokeWeight: 3,
            icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 }, offset: '0', repeat: '15px' }],
          });
        }
      });
    });
  }, [navigationExtras.isOffRoute, navigationExtras.offRouteDurationS > 5]);
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep -E "RerouteService|NavDashboard"`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/services/routes/RerouteService.ts src/components/DashboardSystem/NavDashboard.tsx
git commit -m "feat(nav): re-routing via Google Directions API when off-route > 5s"
```

---

### Task 9: Build, deploy, and verify

**Files:** None new — verification only

- [ ] **Step 1: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors (ignore pre-existing ones in unrelated files)

- [ ] **Step 2: Build for production**

Run: `npm run build`
Expected: Build succeeds, dist/ generated

- [ ] **Step 3: Deploy**

```bash
rm -rf .vercel/output
npx vercel build --prod
npx vercel deploy --prebuilt --prod
```

- [ ] **Step 4: Commit all remaining changes**

```bash
git add -A
git commit -m "feat(nav): GPX navigation — complete implementation

World-class GPX navigation for KROMI BikeControl:
- NavigationEngine: position tracking, snap-to-route, deviation, ETA
- NavDashboard: satellite map 70% + gradient-colored GPX line + KPIs
- ElevationMiniProfile: SVG elevation chart with position marker
- Dashboard auto-switch to NAV when route active (30s timeout)
- RoutePacingService: battery management via KromiCore
- RerouteService: Google Directions API re-routing when off-route
- Settings RoutesPage: GPX import, route list, pre-ride summary
- POI detection: summit, descent start, finish markers
- Dark mode adaptive: map brightness by ambient light sensor"

git push
```

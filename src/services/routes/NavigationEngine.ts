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
let lastLat = 0;
let lastLng = 0;

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
  lastLat = 0;
  lastLng = 0;

  // Subscribe to mapStore position changes (plain subscribe — no subscribeWithSelector)
  unsubGps = useMapStore.subscribe((state) => {
    const { latitude: lat, longitude: lng } = state;
    // Only process when position actually changed
    if (lat !== lastLat || lng !== lastLng) {
      lastLat = lat;
      lastLng = lng;
      processGpsUpdate();
    }
  });
}

/** Stop navigation engine */
export function stopNavigationEngine() {
  unsubGps?.();
  unsubGps = null;
  lastProcessedIdx = 0;
  offRouteStartMs = 0;
  speedHistory.length = 0;
  lastLat = 0;
  lastLng = 0;
}

/**
 * ExplorationService — Calculates 8 radial routes from the rider's position
 * and classifies each by elevation difficulty.
 *
 * Uses Google Directions API (bicycling mode) + Google Elevation API to
 * sample elevation along each route and compute gain, loss, and gradients.
 *
 * Results are cached and only recalculated when the rider moves >500m.
 */

import { isMapsLoaded, destinationFromHeading } from '../maps/GoogleMapsService';

// ── Types ──────────────────────────────────────────────────────────────

export type DifficultyLevel = 'easy' | 'moderate' | 'hard' | 'extreme';

export interface ExplorationRoute {
  heading: number;           // 0=N, 45=NE, 90=E, etc.
  label: string;             // "N", "NE", "E", etc.
  points: google.maps.LatLngLiteral[];  // route path from Directions API
  distanceKm: number;
  elevationGain: number;     // meters
  elevationLoss: number;     // meters
  maxGradientPct: number;
  avgGradientPct: number;
  difficulty: DifficultyLevel;
  color: string;             // hex color for map rendering
  durationMin: number;       // estimated time in minutes
}

// ── Constants ──────────────────────────────────────────────────────────

const DIRECTIONS = [
  { heading: 0,   label: 'N'  },
  { heading: 45,  label: 'NE' },
  { heading: 90,  label: 'E'  },
  { heading: 135, label: 'SE' },
  { heading: 180, label: 'S'  },
  { heading: 225, label: 'SW' },
  { heading: 270, label: 'W'  },
  { heading: 315, label: 'NW' },
] as const;

const ELEVATION_SAMPLES = 20;
const RECALC_THRESHOLD_M = 500;
const EARTH_RADIUS_M = 6_371_000;

const DIFFICULTY_COLORS: Record<DifficultyLevel, string> = {
  easy:     '#3fff8b',
  moderate: '#fbbf24',
  hard:     '#ff716c',
  extreme:  '#a855f7',
};

// ── Cache ──────────────────────────────────────────────────────────────

let cachedRoutes: ExplorationRoute[] = [];
let lastCalcLat = 0;
let lastCalcLng = 0;

// ── Haversine distance (meters) ────────────────────────────────────────

function haversineM(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Difficulty classification ──────────────────────────────────────────

function classifyDifficulty(
  avgGradientPct: number,
  maxGradientPct: number,
  elevationGain: number,
): DifficultyLevel {
  if (avgGradientPct < 3 && maxGradientPct < 5 && elevationGain < 100) {
    return 'easy';
  }
  if (avgGradientPct < 6 && maxGradientPct < 10 && elevationGain < 300) {
    return 'moderate';
  }
  if (avgGradientPct < 10 && maxGradientPct < 15 && elevationGain < 500) {
    return 'hard';
  }
  return 'extreme';
}

// ── Elevation analysis ─────────────────────────────────────────────────

interface ElevationStats {
  elevationGain: number;
  elevationLoss: number;
  maxGradientPct: number;
  avgGradientPct: number;
}

function analyseElevation(
  results: google.maps.ElevationResult[],
  totalDistanceM: number,
): ElevationStats {
  let gain = 0;
  let loss = 0;
  let maxGrad = 0;
  const segmentDistance = totalDistanceM / (results.length - 1 || 1);
  const gradients: number[] = [];

  for (let i = 1; i < results.length; i++) {
    const curr = results[i]!;
    const prev = results[i - 1]!;
    const diff = curr.elevation - prev.elevation;
    if (diff > 0) gain += diff;
    else loss += Math.abs(diff);

    const grad = segmentDistance > 0
      ? Math.abs(diff / segmentDistance) * 100
      : 0;
    gradients.push(grad);
    if (grad > maxGrad) maxGrad = grad;
  }

  const avgGrad = gradients.length > 0
    ? gradients.reduce((s, g) => s + g, 0) / gradients.length
    : 0;

  return {
    elevationGain: Math.round(gain),
    elevationLoss: Math.round(loss),
    maxGradientPct: Math.round(maxGrad * 10) / 10,
    avgGradientPct: Math.round(avgGrad * 10) / 10,
  };
}

// ── Single-direction route fetch ───────────────────────────────────────

async function fetchDirectionRoute(
  origin: google.maps.LatLngLiteral,
  destination: google.maps.LatLngLiteral,
): Promise<{ points: google.maps.LatLngLiteral[]; distanceM: number; durationSec: number } | null> {
  const svc = new google.maps.DirectionsService();

  try {
    const result = await svc.route({
      origin,
      destination,
      travelMode: google.maps.TravelMode.BICYCLING,
    });

    const firstRoute = result.routes[0];
    if (!firstRoute || firstRoute.legs.length === 0) {
      return null;
    }

    const leg = firstRoute.legs[0];
    if (!leg) return null;

    const points: google.maps.LatLngLiteral[] = [];

    for (const step of leg.steps) {
      for (const pt of step.path) {
        points.push({ lat: pt.lat(), lng: pt.lng() });
      }
    }

    return {
      points,
      distanceM: leg.distance?.value ?? 0,
      durationSec: leg.duration?.value ?? 0,
    };
  } catch (err) {
    console.warn('[ExplorationService] Directions failed:', err);
    return null;
  }
}

// ── Elevation sampling ─────────────────────────────────────────────────

async function sampleElevation(
  points: google.maps.LatLngLiteral[],
): Promise<google.maps.ElevationResult[] | null> {
  if (points.length < 2) return null;

  const elevator = new google.maps.ElevationService();

  try {
    const response = await elevator.getElevationAlongPath({
      path: points,
      samples: ELEVATION_SAMPLES,
    });
    return response.results ?? null;
  } catch (err) {
    console.warn('[ExplorationService] Elevation failed:', err);
    return null;
  }
}

// ── Build one exploration route ────────────────────────────────────────

async function buildRoute(
  origin: google.maps.LatLngLiteral,
  heading: number,
  label: string,
  radiusKm: number,
): Promise<ExplorationRoute | null> {
  const dest = destinationFromHeading(origin, heading, radiusKm * 1000);
  const route = await fetchDirectionRoute(origin, dest);
  if (!route) return null;

  const distanceKm = Math.round((route.distanceM / 1000) * 10) / 10;
  const durationMin = Math.round(route.durationSec / 60);

  // Elevation analysis — fall back to 'moderate' on failure
  const elevResults = await sampleElevation(route.points);

  let stats: ElevationStats;
  if (elevResults && elevResults.length >= 2) {
    stats = analyseElevation(elevResults, route.distanceM);
  } else {
    stats = {
      elevationGain: 0,
      elevationLoss: 0,
      maxGradientPct: 0,
      avgGradientPct: 0,
    };
  }

  const difficulty = elevResults
    ? classifyDifficulty(stats.avgGradientPct, stats.maxGradientPct, stats.elevationGain)
    : 'moderate';

  return {
    heading,
    label,
    points: route.points,
    distanceKm,
    elevationGain: stats.elevationGain,
    elevationLoss: stats.elevationLoss,
    maxGradientPct: stats.maxGradientPct,
    avgGradientPct: stats.avgGradientPct,
    difficulty,
    color: DIFFICULTY_COLORS[difficulty],
    durationMin,
  };
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Returns true if the rider has moved far enough from the last calculated
 * position to justify a new exploration calculation.
 */
export function shouldRecalculate(lat: number, lng: number): boolean {
  if (lastCalcLat === 0 && lastCalcLng === 0) return true;
  return haversineM(lat, lng, lastCalcLat, lastCalcLng) > RECALC_THRESHOLD_M;
}

/**
 * Returns the last computed exploration routes without triggering a new
 * calculation. Returns an empty array if none have been calculated yet.
 */
export function getLastRoutes(): ExplorationRoute[] {
  return cachedRoutes;
}

/**
 * Calculates 8 radial exploration routes from the given position.
 *
 * Each route follows the nearest bicycle-friendly road towards one of the
 * 8 cardinal/intercardinal directions, with elevation-based difficulty.
 *
 * Skips directions where no route is available.
 */
export async function calculateExplorationRoutes(
  lat: number,
  lng: number,
  radiusKm: number = 5,
): Promise<ExplorationRoute[]> {
  if (!isMapsLoaded()) {
    console.warn('[ExplorationService] Google Maps not loaded');
    return [];
  }

  const origin: google.maps.LatLngLiteral = { lat, lng };

  // Fire all 8 directions in parallel
  const promises = DIRECTIONS.map(({ heading, label }) =>
    buildRoute(origin, heading, label, radiusKm),
  );

  const results = await Promise.allSettled(promises);

  const routes: ExplorationRoute[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value !== null) {
      routes.push(r.value);
    }
  }

  // Update cache
  cachedRoutes = routes;
  lastCalcLat = lat;
  lastCalcLng = lng;

  return routes;
}

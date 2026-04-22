/**
 * PostRideProcessor.ts — Post-ride trail simplification + elevation correction.
 *
 * Runs after a ride ends:
 *  1. Reads GPS snapshots from IndexedDB via localRideStore.
 *  2. Filters out zero-lat/lng points.
 *  3. Simplifies the trail with Douglas-Peucker (5 m tolerance).
 *  4. Computes raw elevation gain from GPS altitude.
 *  5. Optionally corrects elevation via Google Elevation API (DEM).
 *  6. Persists simplified_trail + elevation_gain_corrected on the session.
 */

import { douglasPeucker } from './DouglasPeucker';
import { localRideStore } from '../storage/LocalRideStore';
import type { LocalSnapshot } from '../storage/LocalRideStore';

// ── Types ────────────────────────────────────────────────────────────────────

export interface PostRideResult {
  /** Number of points after Douglas-Peucker simplification. */
  simplifiedCount: number;
  /** Number of GPS points before simplification (valid lat/lng only). */
  originalCount: number;
  /** Elevation gain (m) after DEM correction — null if correction was skipped. */
  correctedElevGain: number | null;
  /** Elevation gain (m) from raw GPS altitude. */
  rawElevGain: number;
}

/** Subset of LocalSnapshot used for trail processing. */
interface TrailPoint {
  lat: number;
  lng: number;
  altitude_m: number | null;
  elapsed_s: number;
  speed_kmh: number;
  // index signature required by douglasPeucker generic constraint
  [key: string]: unknown;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Sum of positive altitude differences across an ordered sequence. */
function computeElevGain(points: TrailPoint[]): number {
  let gain = 0;
  for (let i = 1; i < points.length; i++) {
    const prevPt = points[i - 1];
    const currPt = points[i];
    if (!prevPt || !currPt) continue;
    const prev = prevPt.altitude_m;
    const curr = currPt.altitude_m;
    if (prev != null && curr != null) {
      const diff = curr - prev;
      if (diff > 0) gain += diff;
    }
  }
  return gain;
}

/**
 * Linearly interpolate a numeric correction value between two known samples
 * based on elapsed_s. Falls back to nearest endpoint when out of range.
 */
function interpolateCorrection(
  elapsed: number,
  samples: { elapsed_s: number; offset: number }[],
): number {
  if (samples.length === 0) return 0;
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last) return 0;
  if (elapsed <= first.elapsed_s) return first.offset;
  if (elapsed >= last.elapsed_s) return last.offset;

  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const next = samples[i];
    if (!prev || !next) continue;
    if (elapsed >= prev.elapsed_s && elapsed <= next.elapsed_s) {
      const t = (elapsed - prev.elapsed_s) / (next.elapsed_s - prev.elapsed_s);
      return prev.offset + t * (next.offset - prev.offset);
    }
  }
  return 0;
}

// ── Google Elevation API ─────────────────────────────────────────────────────

interface GElevResult {
  elevation: number;
  location: { lat: number; lng: number };
}

interface GElevResponse {
  results: GElevResult[];
  status: string;
}

const MAX_SAMPLE_POINTS = 100;
const ELEV_API_BASE = 'https://maps.googleapis.com/maps/api/elevation/json';

async function fetchDEMElevations(
  points: TrailPoint[],
  apiKey: string,
): Promise<number[] | null> {
  // Sample up to MAX_SAMPLE_POINTS evenly from the simplified trail
  const total = points.length;
  const indices: number[] = [];
  if (total <= MAX_SAMPLE_POINTS) {
    for (let i = 0; i < total; i++) indices.push(i);
  } else {
    for (let i = 0; i < MAX_SAMPLE_POINTS; i++) {
      indices.push(Math.round((i * (total - 1)) / (MAX_SAMPLE_POINTS - 1)));
    }
  }

  const locations = indices
    .map((idx) => {
      const pt = points[idx];
      return pt ? `${pt.lat},${pt.lng}` : null;
    })
    .filter((s): s is string => s !== null)
    .join('|');

  const url = `${ELEV_API_BASE}?locations=${encodeURIComponent(locations)}&key=${apiKey}`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn('[PostRideProcessor] Elevation API HTTP error:', resp.status);
      return null;
    }
    const data: GElevResponse = await resp.json();
    if (data.status !== 'OK' || !data.results?.length) {
      console.warn('[PostRideProcessor] Elevation API status:', data.status);
      return null;
    }
    return data.results.map((r) => r.elevation);
  } catch (err) {
    console.warn('[PostRideProcessor] Elevation API fetch failed:', err);
    return null;
  }
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Process a completed ride session:
 *  - simplify GPS trail
 *  - optionally correct elevation via Google DEM
 *  - persist results on the session record
 *
 * Designed to be called fire-and-forget after `set({ state: 'finished' })`.
 */
export async function processRide(sessionId: string): Promise<PostRideResult> {
  console.log('[PostRideProcessor] Starting post-ride processing for session:', sessionId);

  // 1. Load snapshots
  await localRideStore.init();
  const rawSnapshots: LocalSnapshot[] = await localRideStore.getSessionSnapshots(sessionId);

  // 2. Filter to valid GPS points and map to TrailPoint
  const validPoints: TrailPoint[] = rawSnapshots
    .filter((s) => s.lat !== 0 && s.lng !== 0)
    .map((s) => ({
      lat: s.lat,
      lng: s.lng,
      altitude_m: s.altitude_m,
      elapsed_s: s.elapsed_s,
      speed_kmh: s.speed_kmh,
    }));

  const originalCount = validPoints.length;
  console.log(`[PostRideProcessor] Valid GPS points: ${originalCount} / ${rawSnapshots.length}`);

  if (originalCount === 0) {
    const result: PostRideResult = {
      simplifiedCount: 0,
      originalCount: 0,
      correctedElevGain: null,
      rawElevGain: 0,
    };
    console.log('[PostRideProcessor] No valid GPS points — skipping', result);
    return result;
  }

  // 3. Douglas-Peucker simplification (5 m tolerance)
  const simplified = douglasPeucker(validPoints, 5);
  const simplifiedCount = simplified.length;
  console.log(`[PostRideProcessor] Simplified: ${originalCount} → ${simplifiedCount} points`);

  // 4. Raw elevation gain
  const rawElevGain = computeElevGain(simplified);
  console.log(`[PostRideProcessor] Raw elevation gain: ${rawElevGain.toFixed(1)} m`);

  // 5. Optional Google Elevation API correction
  let correctedElevGain: number | null = null;

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

  if (apiKey && navigator.onLine && simplified.length > 2) {
    const demElevations = await fetchDEMElevations(simplified, apiKey);

    if (demElevations && demElevations.length > 0) {
      // Build a correction sample set: for each sampled point, compute offset = DEM - GPS
      const total = simplified.length;
      const sampledIndices: number[] = [];
      if (total <= MAX_SAMPLE_POINTS) {
        for (let i = 0; i < total; i++) sampledIndices.push(i);
      } else {
        for (let i = 0; i < MAX_SAMPLE_POINTS; i++) {
          sampledIndices.push(Math.round((i * (total - 1)) / (MAX_SAMPLE_POINTS - 1)));
        }
      }

      const correctionSamples: { elapsed_s: number; offset: number }[] = [];
      for (let i = 0; i < sampledIndices.length && i < demElevations.length; i++) {
        const idx = sampledIndices[i];
        const pt = idx !== undefined ? simplified[idx] : undefined;
        const demAlt = demElevations[i];
        if (!pt || demAlt === undefined) continue;
        const gpsAlt = pt.altitude_m;
        if (gpsAlt != null) {
          correctionSamples.push({
            elapsed_s: pt.elapsed_s,
            offset: demAlt - gpsAlt,
          });
        }
      }

      if (correctionSamples.length > 0) {
        // Apply interpolated corrections across all simplified points
        const correctedPoints: TrailPoint[] = simplified.map((pt) => {
          const correction = interpolateCorrection(pt.elapsed_s, correctionSamples);
          return {
            ...pt,
            altitude_m: pt.altitude_m != null ? pt.altitude_m + correction : null,
          };
        });

        correctedElevGain = computeElevGain(correctedPoints);
        console.log(`[PostRideProcessor] Corrected elevation gain: ${correctedElevGain.toFixed(1)} m`);
      }
    }
  } else if (!apiKey) {
    console.log('[PostRideProcessor] No Google Maps API key — skipping elevation correction');
  } else if (!navigator.onLine) {
    console.log('[PostRideProcessor] Offline — skipping elevation correction');
  } else {
    console.log('[PostRideProcessor] Too few points for elevation correction');
  }

  // 6. Persist results on the session
  const simplifiedTrail = simplified.map((pt) => ({
    lat: pt.lat,
    lng: pt.lng,
    alt: pt.altitude_m,
    t: pt.elapsed_s,
  }));

  await localRideStore.updateSession(sessionId, {
    // Store as JSON-serialisable fields that the sync engine will forward to Supabase.
    // Using the `metrics` partial-update path keeps things within the existing schema.
    // The fields below are stored in the freeform `devices_connected` column for now
    // (a dedicated column can be added via migration later).
    devices_connected: {
      simplified_trail: simplifiedTrail,
      simplified_count: simplifiedCount,
      original_gps_count: originalCount,
      elev_gain_raw_m: Math.round(rawElevGain * 10) / 10,
      elev_gain_corrected_m:
        correctedElevGain != null ? Math.round(correctedElevGain * 10) / 10 : null,
    },
  } as Parameters<typeof localRideStore.updateSession>[1]);

  const result: PostRideResult = {
    simplifiedCount,
    originalCount,
    correctedElevGain,
    rawElevGain,
  };

  console.log('[PostRideProcessor] Done:', result);
  return result;
}

/**
 * ElevationPredictor — 4km rolling horizon lookahead.
 *
 * Three modes with automatic transition:
 *   Mode A (GPX Known): Pre-calculated from loaded route. Full segment profile.
 *   Mode B (Discovery): Projects 4km ahead from current position + heading.
 *   Mode C (Hybrid): GPX loaded but rider deviated >50m for 20s → Discovery
 *                     until re-entry into route corridor.
 *
 * Every 10s: builds segment array (100m each), classifies grade,
 * estimates power + Wh per segment, projects physiological cost.
 */

import type { ElevationPoint } from '../../types/elevation.types';
import { computeForces, type PhysicsInput } from '../intelligence/PhysicsEngine';

// ── Types ──────────────────────────────────────────────────────

export type SegmentGrade = 'gentle' | 'moderate' | 'demanding' | 'extreme';
export type LookaheadMode = 'gpx' | 'discovery' | 'hybrid';

export interface LookaheadSegment {
  distance_start_m: number;
  distance_end_m: number;
  gradient_pct: number;
  grade: SegmentGrade;
  elevation_start: number;
  elevation_end: number;
  P_total_est: number;
  wh_motor_est: number;
  time_est_s: number;
  motor_active: boolean;
}

export interface LookaheadResult {
  segments: LookaheadSegment[];
  total_wh_motor: number;
  next_transition_m: number | null;
  next_transition_gradient: number | null;
  seconds_to_transition: number | null;
  gear_suggestion: number | null;
  summary: string;
  mode: LookaheadMode;
  route_remaining_km: number | null;
}

/** GPX route point */
export interface RoutePoint {
  lat: number;
  lng: number;
  elevation: number;
  distance_from_start_m: number;
}

// ── Lookahead Controller (stateful) ───────────────────────────

const DEVIATION_THRESHOLD_M = 50;
const DEVIATION_TIMEOUT_MS = 20_000;
const CORRIDOR_REENTRY_M = 30;

export class LookaheadController {
  private gpxRoute: RoutePoint[] | null = null;
  private gpxProgress = 0;          // index of nearest route point
  private mode: LookaheadMode = 'discovery';

  // Deviation tracking for Mode C auto-switch
  private deviationStartTs = 0;
  private deviatedFlag = false;

  /** Load a GPX route. Switches to Mode A. */
  loadRoute(route: RoutePoint[]): void {
    this.gpxRoute = route;
    this.gpxProgress = 0;
    this.mode = 'gpx';
    this.deviatedFlag = false;
    this.deviationStartTs = 0;
  }

  /** Clear route. Switches to Mode B. */
  clearRoute(): void {
    this.gpxRoute = null;
    this.gpxProgress = 0;
    this.mode = 'discovery';
    this.deviatedFlag = false;
  }

  getMode(): LookaheadMode { return this.mode; }
  isDeviated(): boolean { return this.deviatedFlag; }
  getRouteRemainingKm(): number | null {
    if (!this.gpxRoute || this.gpxProgress >= this.gpxRoute.length - 1) return null;
    const total = this.gpxRoute[this.gpxRoute.length - 1]!.distance_from_start_m;
    const current = this.gpxRoute[this.gpxProgress]!.distance_from_start_m;
    return (total - current) / 1000;
  }

  /**
   * Main tick — builds lookahead using appropriate mode.
   * Handles auto-transition between modes.
   */
  tick(
    lat: number, lng: number,
    discoveryProfile: ElevationPoint[],
    currentSpeed: number,
    physicsBase: Omit<PhysicsInput, 'speed_kmh' | 'gradient_pct'>,
    sprockets: number[],
    currentGear: number,
  ): LookaheadResult {
    // Check mode transitions
    this.updateMode(lat, lng);

    if (this.mode === 'gpx' && this.gpxRoute) {
      return this.buildGpxLookahead(currentSpeed, physicsBase, sprockets, currentGear);
    }

    // Mode B (discovery) or Mode C (hybrid using discovery)
    return {
      ...buildSegmentLookahead(discoveryProfile, currentSpeed, physicsBase, sprockets, currentGear),
      mode: this.mode,
      route_remaining_km: this.getRouteRemainingKm(),
    };
  }

  /** Reset for new ride */
  reset(): void {
    this.gpxProgress = 0;
    this.deviatedFlag = false;
    this.deviationStartTs = 0;
    if (this.gpxRoute) this.mode = 'gpx';
    else this.mode = 'discovery';
  }

  // ── Mode Transition Logic ────────────────────────────────

  private updateMode(lat: number, lng: number): void {
    if (!this.gpxRoute || this.gpxRoute.length === 0) {
      this.mode = 'discovery';
      return;
    }

    // Find nearest route point
    const { idx, dist } = this.findNearestRoutePoint(lat, lng);
    this.gpxProgress = idx;

    const now = Date.now();

    if (this.mode === 'gpx') {
      // Check for deviation: >50m from route
      if (dist > DEVIATION_THRESHOLD_M) {
        if (this.deviationStartTs === 0) {
          this.deviationStartTs = now;
        } else if (now - this.deviationStartTs > DEVIATION_TIMEOUT_MS) {
          // Deviated for 20s → switch to hybrid
          this.mode = 'hybrid';
          this.deviatedFlag = true;
        }
      } else {
        this.deviationStartTs = 0;
      }
    } else if (this.mode === 'hybrid') {
      // Check for re-entry: <30m from route
      if (dist < CORRIDOR_REENTRY_M) {
        this.mode = 'gpx';
        this.deviatedFlag = false;
        this.deviationStartTs = 0;
      }
    }
  }

  private findNearestRoutePoint(lat: number, lng: number): { idx: number; dist: number } {
    if (!this.gpxRoute || this.gpxRoute.length === 0) return { idx: 0, dist: Infinity };

    // Search around current progress (±50 points for efficiency)
    const start = Math.max(0, this.gpxProgress - 20);
    const end = Math.min(this.gpxRoute.length, this.gpxProgress + 50);
    let bestIdx = this.gpxProgress;
    let bestDist = Infinity;

    for (let i = start; i < end; i++) {
      const p = this.gpxRoute[i]!;
      const d = haversineM(lat, lng, p.lat, p.lng);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    return { idx: bestIdx, dist: bestDist };
  }

  // ── Mode A: GPX Lookahead ────────────────────────────────

  private buildGpxLookahead(
    currentSpeed: number,
    physicsBase: Omit<PhysicsInput, 'speed_kmh' | 'gradient_pct'>,
    sprockets: number[],
    currentGear: number,
  ): LookaheadResult {
    if (!this.gpxRoute) return { ...emptyResult(), mode: 'gpx', route_remaining_km: null };

    // Extract next 4km from current position
    const lookaheadM = 4000;
    const startIdx = this.gpxProgress;
    const startDist = this.gpxRoute[startIdx]?.distance_from_start_m ?? 0;
    const endDist = startDist + lookaheadM;

    const profile: ElevationPoint[] = [];
    for (let i = startIdx; i < this.gpxRoute.length; i++) {
      const pt = this.gpxRoute[i]!;
      if (pt.distance_from_start_m > endDist) break;
      profile.push({
        lat: pt.lat,
        lng: pt.lng,
        elevation: pt.elevation,
        distance_from_current: pt.distance_from_start_m - startDist,
        gradient_pct: 0, // will be calculated in buildSegmentLookahead
      });
    }

    return {
      ...buildSegmentLookahead(profile, currentSpeed, physicsBase, sprockets, currentGear),
      mode: 'gpx',
      route_remaining_km: this.getRouteRemainingKm(),
    };
  }
}

// ── Segment Builder (shared by all modes) ──────────────────

function classifyGrade(gradient: number): SegmentGrade {
  const abs = Math.abs(gradient);
  if (abs <= 5) return 'gentle';
  if (abs <= 10) return 'moderate';
  if (abs <= 15) return 'demanding';
  return 'extreme';
}

/**
 * Build segment lookahead from elevation profile.
 * Used by Mode A (GPX points), Mode B (discovery), and Mode C (hybrid).
 */
export function buildSegmentLookahead(
  profile: ElevationPoint[],
  currentSpeed: number,
  physicsBase: Omit<PhysicsInput, 'speed_kmh' | 'gradient_pct'>,
  sprockets: number[],
  currentGear: number,
): Omit<LookaheadResult, 'mode' | 'route_remaining_km'> {
  if (!profile || profile.length < 2) return emptyResult();

  const segments: LookaheadSegment[] = [];
  let totalWhMotor = 0;
  const SEGMENT_LENGTH = 100;

  let segStart = 0;
  while (segStart < profile.length - 1) {
    let segEnd = segStart + 1;
    while (
      segEnd < profile.length - 1 &&
      profile[segEnd]!.distance_from_current - profile[segStart]!.distance_from_current < SEGMENT_LENGTH
    ) {
      segEnd++;
    }

    const startPt = profile[segStart]!;
    const endPt = profile[segEnd]!;
    const distM = endPt.distance_from_current - startPt.distance_from_current;
    if (distM < 10) { segStart = segEnd; continue; }

    const gradient = ((endPt.elevation - startPt.elevation) / distM) * 100;
    const grade = classifyGrade(gradient);
    const estSpeed = estimateSegmentSpeed(currentSpeed, gradient);
    const speedMs = estSpeed / 3.6;
    const time_est_s = speedMs > 0 ? distM / speedMs : 999;
    const motor_active = estSpeed < 25;

    let P_total_est = 0;
    let wh_motor_est = 0;
    if (motor_active && speedMs > 0) {
      const forces = computeForces({ ...physicsBase, speed_kmh: estSpeed, gradient_pct: gradient });
      P_total_est = forces.P_total;
      wh_motor_est = (forces.P_motor_gap * forces.fadeFactor * time_est_s) / 3600;
    }
    totalWhMotor += wh_motor_est;

    segments.push({
      distance_start_m: startPt.distance_from_current,
      distance_end_m: endPt.distance_from_current,
      gradient_pct: Math.round(gradient * 10) / 10,
      grade, elevation_start: startPt.elevation, elevation_end: endPt.elevation,
      P_total_est: Math.round(P_total_est),
      wh_motor_est: Math.round(wh_motor_est * 10) / 10,
      time_est_s: Math.round(time_est_s), motor_active,
    });
    segStart = segEnd;
  }

  const transition = findNextTransition(segments, 3);
  const gear_suggestion = suggestGear(transition, currentSpeed, currentGear, sprockets);
  const summary = buildSummary(segments, totalWhMotor);

  return {
    segments,
    total_wh_motor: Math.round(totalWhMotor * 10) / 10,
    next_transition_m: transition?.distance_m ?? null,
    next_transition_gradient: transition?.gradient ?? null,
    seconds_to_transition: transition && currentSpeed > 0
      ? (transition.distance_m / (currentSpeed / 3.6)) : null,
    gear_suggestion, summary,
  };
}

// ── Legacy export for backward compatibility ───────────────

export const buildDiscoveryLookahead = (
  profile: ElevationPoint[],
  currentSpeed: number,
  physicsBase: Omit<PhysicsInput, 'speed_kmh' | 'gradient_pct'>,
  sprockets: number[],
  currentGear: number,
): LookaheadResult => ({
  ...buildSegmentLookahead(profile, currentSpeed, physicsBase, sprockets, currentGear),
  mode: 'discovery',
  route_remaining_km: null,
});

// ── Helpers ────────────────────────────────────────────────────

function estimateSegmentSpeed(currentSpeed: number, gradient: number): number {
  if (gradient > 15) return Math.min(currentSpeed, 8);
  if (gradient > 10) return Math.min(currentSpeed, 12);
  if (gradient > 5) return Math.min(currentSpeed, 18);
  if (gradient > 0) return Math.min(currentSpeed, 22);
  if (gradient > -5) return Math.max(currentSpeed, 20);
  return Math.max(currentSpeed, 25);
}

interface TransitionInfo { distance_m: number; gradient: number; }

function findNextTransition(segments: LookaheadSegment[], thresholdPct: number): TransitionInfo | null {
  if (segments.length < 2) return null;
  const currentGrad = segments[0]!.gradient_pct;
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i]!;
    if (Math.abs(seg.gradient_pct - currentGrad) > thresholdPct) {
      return { distance_m: seg.distance_start_m, gradient: seg.gradient_pct };
    }
  }
  return null;
}

function suggestGear(
  transition: TransitionInfo | null, currentSpeed: number,
  currentGear: number, sprockets: number[],
): number | null {
  if (!transition || transition.distance_m > 300) return null;
  const targetCadence = 82;
  const estSpeed = estimateSegmentSpeed(currentSpeed, transition.gradient);
  const speedMs = estSpeed / 3.6;
  if (speedMs <= 0) return null;
  let bestGear = currentGear;
  let bestDiff = Infinity;
  for (let g = 0; g < sprockets.length; g++) {
    const cadence = (speedMs * 60) / ((34 / sprockets[g]!) * 2.290);
    const diff = Math.abs(cadence - targetCadence);
    if (diff < bestDiff) { bestDiff = diff; bestGear = g + 1; }
  }
  return bestGear !== currentGear ? bestGear : null;
}

function buildSummary(segments: LookaheadSegment[], totalWh: number): string {
  if (segments.length === 0) return '';
  const demanding = segments.filter(s => s.grade === 'demanding' || s.grade === 'extreme');
  const descent = segments.filter(s => s.gradient_pct < -3);
  const parts: string[] = [];
  if (demanding.length > 0) {
    const f = demanding[0]!;
    parts.push(`Subida ${Math.abs(f.gradient_pct).toFixed(0)}% a ${Math.round(f.distance_start_m)}m`);
  }
  if (descent.length > 0 && demanding.length === 0) {
    parts.push(`Descida a ${Math.round(descent[0]!.distance_start_m)}m, motor inativo`);
  }
  if (totalWh > 0) parts.push(`~${totalWh.toFixed(0)} Wh nos proximos ${segments.length * 100}m`);
  return parts.join('. ');
}

function emptyResult(): Omit<LookaheadResult, 'mode' | 'route_remaining_km'> {
  return {
    segments: [], total_wh_motor: 0,
    next_transition_m: null, next_transition_gradient: null,
    seconds_to_transition: null, gear_suggestion: null, summary: '',
  };
}

/** Haversine distance in meters */
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * ElevationPredictor — 4km rolling horizon lookahead.
 *
 * Three modes:
 *   Mode A (GPX Known): Pre-calculated from loaded route (future)
 *   Mode B (Discovery): Projects 4km ahead from current position + heading
 *   Mode C (Hybrid): GPX loaded but rider deviated, uses Mode B until re-entry
 *
 * Every 10s: builds segment array (100m each), classifies grade,
 * estimates power + Wh per segment, projects physiological cost.
 */

import type { ElevationPoint } from '../../types/elevation.types';
import { computeForces, type PhysicsInput } from '../intelligence/PhysicsEngine';

// ── Types ──────────────────────────────────────────────────────

export type SegmentGrade = 'gentle' | 'moderate' | 'demanding' | 'extreme';

export interface LookaheadSegment {
  distance_start_m: number;
  distance_end_m: number;
  gradient_pct: number;
  grade: SegmentGrade;
  elevation_start: number;
  elevation_end: number;
  /** Estimated total power needed (W) */
  P_total_est: number;
  /** Estimated motor Wh for this segment */
  wh_motor_est: number;
  /** Estimated time to traverse (s) */
  time_est_s: number;
  /** Is motor active in this segment? */
  motor_active: boolean;
}

export interface LookaheadResult {
  segments: LookaheadSegment[];
  /** Total estimated motor Wh for full horizon */
  total_wh_motor: number;
  /** Distance where next significant gradient change occurs (m) */
  next_transition_m: number | null;
  /** Gradient after next transition */
  next_transition_gradient: number | null;
  /** Seconds until reaching next transition at current speed */
  seconds_to_transition: number | null;
  /** Suggested gear for upcoming segment */
  gear_suggestion: number | null;
  /** Summary text for rider display */
  summary: string;
}

// ── Segment Classification ─────────────────────────────────────

function classifyGrade(gradient: number): SegmentGrade {
  const abs = Math.abs(gradient);
  if (abs <= 5) return 'gentle';
  if (abs <= 10) return 'moderate';
  if (abs <= 15) return 'demanding';
  return 'extreme';
}

// ── Mode B: Discovery Lookahead ────────────────────────────────

/**
 * Build lookahead from elevation profile (already fetched by ElevationService).
 * Groups points into 100m segments, estimates power and Wh per segment.
 *
 * @param profile - ElevationPoint[] from ElevationService (up to 4km)
 * @param currentSpeed - Current speed km/h for time estimates
 * @param physicsBase - Base physics input for power calculations
 * @param sprockets - Cassette sprockets array (descending)
 * @param currentGear - Current gear position (1-12)
 */
export function buildDiscoveryLookahead(
  profile: ElevationPoint[],
  currentSpeed: number,
  physicsBase: Omit<PhysicsInput, 'speed_kmh' | 'gradient_pct'>,
  sprockets: number[],
  currentGear: number,
): LookaheadResult {
  if (!profile || profile.length < 2) {
    return emptyResult();
  }

  const segments: LookaheadSegment[] = [];
  let totalWhMotor = 0;
  const SEGMENT_LENGTH = 100; // 100m segments

  // Group profile points into 100m segments
  let segStart = 0;
  while (segStart < profile.length - 1) {
    // Find end of this 100m segment
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

    const gradient = distM > 0 ? ((endPt.elevation - startPt.elevation) / distM) * 100 : 0;
    const grade = classifyGrade(gradient);

    // Estimate speed for this segment (slower on climbs, faster on descents)
    const estSpeed = estimateSegmentSpeed(currentSpeed, gradient);
    const speedMs = estSpeed / 3.6;
    const time_est_s = speedMs > 0 ? distM / speedMs : 999;

    // Motor active?
    const motor_active = estSpeed < 25;

    // Estimate power using PhysicsEngine
    let P_total_est = 0;
    let wh_motor_est = 0;
    if (motor_active && speedMs > 0) {
      const forces = computeForces({
        ...physicsBase,
        speed_kmh: estSpeed,
        gradient_pct: gradient,
      });
      P_total_est = forces.P_total;
      const motorW = forces.P_motor_gap * forces.fadeFactor;
      wh_motor_est = (motorW * time_est_s) / 3600;
    }

    totalWhMotor += wh_motor_est;

    segments.push({
      distance_start_m: startPt.distance_from_current,
      distance_end_m: endPt.distance_from_current,
      gradient_pct: Math.round(gradient * 10) / 10,
      grade,
      elevation_start: startPt.elevation,
      elevation_end: endPt.elevation,
      P_total_est: Math.round(P_total_est),
      wh_motor_est: Math.round(wh_motor_est * 10) / 10,
      time_est_s: Math.round(time_est_s),
      motor_active,
    });

    segStart = segEnd;
  }

  // Find next significant transition
  const transition = findNextTransition(segments, 3);

  // Gear suggestion for upcoming segment
  const gear_suggestion = suggestGear(transition, currentSpeed, currentGear, sprockets);

  // Build summary text
  const summary = buildSummary(segments, totalWhMotor);

  return {
    segments,
    total_wh_motor: Math.round(totalWhMotor * 10) / 10,
    next_transition_m: transition?.distance_m ?? null,
    next_transition_gradient: transition?.gradient ?? null,
    seconds_to_transition: transition && currentSpeed > 0
      ? (transition.distance_m / (currentSpeed / 3.6))
      : null,
    gear_suggestion,
    summary,
  };
}

// ── Helpers ────────────────────────────────────────────────────

/** Estimate speed on a segment given current speed and gradient */
function estimateSegmentSpeed(currentSpeed: number, gradient: number): number {
  // Simple model: speed reduces on climbs, increases on descents
  // With 159kg and motor, typical speed adjustments:
  if (gradient > 15) return Math.min(currentSpeed, 8);
  if (gradient > 10) return Math.min(currentSpeed, 12);
  if (gradient > 5) return Math.min(currentSpeed, 18);
  if (gradient > 0) return Math.min(currentSpeed, 22);
  if (gradient > -5) return Math.max(currentSpeed, 20);
  return Math.max(currentSpeed, 25); // descent
}

interface TransitionInfo {
  distance_m: number;
  gradient: number;
}

/** Find next gradient change > threshold from current */
function findNextTransition(
  segments: LookaheadSegment[],
  thresholdPct: number,
): TransitionInfo | null {
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

/** Suggest gear for upcoming gradient */
function suggestGear(
  transition: TransitionInfo | null,
  currentSpeed: number,
  currentGear: number,
  sprockets: number[],
): number | null {
  if (!transition || transition.distance_m > 300) return null;

  // Target cadence: 75-90 rpm
  const targetCadence = 82;
  const estSpeed = estimateSegmentSpeed(currentSpeed, transition.gradient);
  const speedMs = estSpeed / 3.6;
  if (speedMs <= 0) return null;

  // Find gear that gives closest to target cadence
  // cadence = (speedMs × 60) / (GR × wheelCircum)
  const wheelCircum = 2.290;
  let bestGear = currentGear;
  let bestDiff = Infinity;

  for (let g = 0; g < sprockets.length; g++) {
    const gr = 34 / sprockets[g]!;
    const cadence = (speedMs * 60) / (gr * wheelCircum);
    const diff = Math.abs(cadence - targetCadence);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestGear = g + 1;
    }
  }

  return bestGear !== currentGear ? bestGear : null;
}

/** Build Portuguese summary of upcoming terrain */
function buildSummary(segments: LookaheadSegment[], totalWh: number): string {
  if (segments.length === 0) return '';

  const demanding = segments.filter(s => s.grade === 'demanding' || s.grade === 'extreme');
  const descent = segments.filter(s => s.gradient_pct < -3);

  const parts: string[] = [];

  if (demanding.length > 0) {
    const first = demanding[0]!;
    const dist = Math.round(first.distance_start_m);
    const grad = Math.abs(first.gradient_pct);
    parts.push(`Subida ${grad.toFixed(0)}% a ${dist}m`);
  }

  if (descent.length > 0 && demanding.length === 0) {
    const first = descent[0]!;
    const dist = Math.round(first.distance_start_m);
    parts.push(`Descida a ${dist}m, motor inativo`);
  }

  if (totalWh > 0) {
    parts.push(`~${totalWh.toFixed(0)} Wh nos proximos ${segments.length * 100}m`);
  }

  return parts.join('. ');
}

function emptyResult(): LookaheadResult {
  return {
    segments: [],
    total_wh_motor: 0,
    next_transition_m: null,
    next_transition_gradient: null,
    seconds_to_transition: null,
    gear_suggestion: null,
    summary: '',
  };
}

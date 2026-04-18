/**
 * ElevationPredictor — adaptive rolling horizon lookahead.
 *
 * Three modes with automatic transition:
 *   Mode A (GPX Known): Pre-calculated from loaded route. Full segment profile.
 *   Mode B (Discovery): Projects ahead from current position + heading.
 *   Mode C (Hybrid): GPX loaded but rider deviated >50m for 20s → Discovery
 *                     until re-entry into route corridor.
 *
 * Gap #5: Adaptive lookahead distance (500m-8km) based on terrain variability and speed.
 * Gap #7: Cold start bootstrapping from GPS altitude readings.
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

  // ── Gap #5: Adaptive lookahead distance ────────────────
  private recentGradients: number[] = [];
  private readonly MAX_RECENT_GRADIENTS = 20;

  // ── Gap #7: Cold start improvement ─────────────────────
  private coldStartBootstrap: { alt: number; dist: number; ts: number }[] = [];
  private coldStartGradient = 0;
  private coldStartConfidence = 0;

  // ── Median altitude pre-filtering ──────────────────────
  private altitudeBuffer: number[] = [];
  private readonly ALTITUDE_SMOOTH_WINDOW = 5;

  /**
   * Median-filter raw altitude before gradient calculation.
   * Robust to GPS spikes (unlike simple averaging).
   * Apply BEFORE computing gradient, not after.
   */
  smoothAltitude(rawAltitude: number): number {
    this.altitudeBuffer.push(rawAltitude);
    if (this.altitudeBuffer.length > this.ALTITUDE_SMOOTH_WINDOW) {
      this.altitudeBuffer.shift();
    }
    // Median filter (robust to GPS spikes)
    const sorted = [...this.altitudeBuffer].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1]! + sorted[mid]!) / 2
      : sorted[mid]!;
  }

  // ── Gap #1: Barometer altitude correction ──────────────
  private lastBaroAlt: number | null = null;
  private lastGpsAlt: number | null = null;

  /** Feed barometric altitude from phone sensor (bikeStore.barometric_altitude_m) */
  setBarometricAltitude(baroAlt: number): void {
    this.lastBaroAlt = baroAlt > 0 ? baroAlt : null;
  }

  /** Feed GPS altitude for blending */
  setGpsAltitude(gpsAlt: number | null): void {
    this.lastGpsAlt = gpsAlt;
  }

  /**
   * Get corrected altitude blending barometer and GPS.
   * Barometer is more precise for relative changes (gradient),
   * GPS is better for absolute calibration.
   */
  getCorrectedAltitude(gpsAlt: number | null, baroAlt: number | null): number {
    if (baroAlt != null && baroAlt > 0 && gpsAlt != null && gpsAlt > 0) {
      // Barometer-weighted blend: baro is ±0.1m precision vs GPS ±3m
      return baroAlt * 0.7 + gpsAlt * 0.3;
    }
    return baroAlt != null && baroAlt > 0 ? baroAlt : gpsAlt ?? 0;
  }

  // ── Gap #2 + Gap #9: Switchback detection (hardened) ───
  private headingHistory: number[] = [];
  private readonly MAX_HEADING_HISTORY = 20; // increased for stability check
  private lastSwitchbackDist = 0; // km — distance filter
  private currentDistKm = 0;

  /** Track heading for switchback detection */
  trackHeading(headingDeg: number): void {
    this.headingHistory.push(headingDeg);
    if (this.headingHistory.length > this.MAX_HEADING_HISTORY) {
      this.headingHistory.shift();
    }
  }

  /** Update current distance for switchback distance filter */
  setCurrentDistance(distKm: number): void {
    this.currentDistKm = distKm;
  }

  /**
   * Detect tight switchback from heading changes (>90deg in consecutive readings).
   * Gap #9: Hardened with distance filter (>0.3km between detections) and
   * heading stability check (previous heading must be stable for 3+ readings).
   */
  isSwitchback(): boolean {
    if (this.headingHistory.length < 3) return false;

    // Distance filter: require >0.3km since last switchback detection
    if (this.currentDistKm - this.lastSwitchbackDist < 0.3) return false;

    const recent = this.headingHistory.slice(-3);
    for (let i = 1; i < recent.length; i++) {
      let delta = Math.abs(recent[i]! - recent[i - 1]!);
      if (delta > 180) delta = 360 - delta;
      if (delta > 90) {
        // Heading stability check: require previous heading stable for 3+ readings
        const stableCount = this.countStableHeadings(this.headingHistory.length - (recent.length - i + 1));
        if (stableCount < 3) continue; // transient flip, not real switchback

        this.lastSwitchbackDist = this.currentDistKm;
        return true;
      }
    }
    return false;
  }

  /** Count consecutive stable headings ending at endIdx (within 15 degrees) */
  private countStableHeadings(endIdx: number): number {
    if (endIdx < 0 || endIdx >= this.headingHistory.length) return 0;
    let count = 0;
    const refHeading = this.headingHistory[endIdx]!;
    for (let i = endIdx; i >= 0; i--) {
      let delta = Math.abs(this.headingHistory[i]! - refHeading);
      if (delta > 180) delta = 360 - delta;
      if (delta < 15) count++;
      else break;
    }
    return count;
  }

  // ── Gap #3: Dead-reckoning in tunnels ──────────────────
  private lastGpsTimestamp = 0;
  private deadReckoningActive = false;
  private deadReckonPosition = { lat: 0, lng: 0, alt: 0 };
  private deadReckonGradient = 0;
  private lastKnownAltitude = 0;
  private lastKnownGradient = 0;

  /** Detect GPS loss and enter/exit dead-reckoning mode */
  detectGpsLoss(gpsTimestamp: number, currentLat: number, currentLng: number): void {
    if (gpsTimestamp === this.lastGpsTimestamp && gpsTimestamp > 0) {
      // GPS hasn't updated — might be in tunnel
      const elapsed = Date.now() - this.lastGpsTimestamp;
      if (elapsed > 5000 && !this.deadReckoningActive) {
        console.log('[Lookahead] GPS stale for 5s — entering dead-reckoning mode');
        this.deadReckoningActive = true;
        this.deadReckonPosition = {
          lat: currentLat,
          lng: currentLng,
          alt: this.lastKnownAltitude,
        };
        this.deadReckonGradient = this.lastKnownGradient;
      }
    } else {
      if (this.deadReckoningActive) {
        console.log('[Lookahead] GPS restored — exiting dead-reckoning');
      }
      this.deadReckoningActive = false;
      this.lastGpsTimestamp = gpsTimestamp;
    }
  }

  /** Project forward using last speed + heading during GPS loss */
  deadReckonTick(speed_kmh: number, heading: number, dt_s: number): void {
    if (!this.deadReckoningActive) return;

    const dist_m = (speed_kmh / 3.6) * dt_s;
    const gradRad = Math.atan(this.deadReckonGradient / 100);

    // Update projected altitude
    this.deadReckonPosition.alt += dist_m * Math.sin(gradRad);

    // Update projected position (haversine forward)
    const R = 6371000;
    const lat1 = this.deadReckonPosition.lat * Math.PI / 180;
    const lng1 = this.deadReckonPosition.lng * Math.PI / 180;
    const brng = heading * Math.PI / 180;
    const d = dist_m / R;

    this.deadReckonPosition.lat = Math.asin(
      Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng),
    ) * 180 / Math.PI;
    this.deadReckonPosition.lng = (lng1 + Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(this.deadReckonPosition.lat * Math.PI / 180),
    )) * 180 / Math.PI;
  }

  /** Get effective position (real GPS or dead-reckoned) */
  getEffectivePosition(lat: number, lng: number, alt: number): { lat: number; lng: number; alt: number } {
    if (this.deadReckoningActive) {
      return { ...this.deadReckonPosition };
    }
    // Update last known values for dead-reckoning fallback
    this.lastKnownAltitude = alt;
    return { lat, lng, alt };
  }

  isDeadReckoning(): boolean {
    return this.deadReckoningActive;
  }

  // ── Gap #5 + Gap #13: Adaptive Lookahead Methods ────────

  /** Confidence of last lookahead result (0-1) */
  private lastLookaheadConfidence = 1.0;

  /** Set lookahead confidence from last result quality */
  setLookaheadConfidence(confidence: number): void {
    this.lastLookaheadConfidence = Math.max(0, Math.min(1, confidence));
  }

  /**
   * Calculate terrain-adaptive lookahead distance.
   * Gap #13: Improved with speed-based minimum (15s ahead),
   * confidence adjustment, and better terrain variability response.
   */
  getAdaptiveLookaheadM(speed_kmh: number): number {
    const speedMs = speed_kmh / 3.6;

    // Gap #13: Minimum: 15 seconds worth of travel (at least 300m)
    const minLookahead = Math.max(300, speedMs * 15);

    // Maximum: 120 seconds worth of travel, capped at 8km
    const maxLookahead = Math.min(8000, speedMs * 120);

    const variability = this.calculateTerrainVariability();

    let distance: number;
    if (variability > 5) {
      // Highly variable terrain (mountain switchbacks): short lookahead
      distance = Math.max(minLookahead, Math.min(1500, minLookahead * 1.5));
    } else if (variability > 2) {
      // Rolling terrain: medium lookahead
      distance = (minLookahead + maxLookahead) / 2;
    } else {
      // Stable terrain (flat road, steady climb): long lookahead
      distance = maxLookahead;
    }

    // Gap #13: Confidence adjustment — low confidence = shorter, more conservative
    if (this.lastLookaheadConfidence < 0.5) {
      distance = Math.max(minLookahead, distance * 0.7);
    }

    return Math.round(distance);
  }

  /** Standard deviation of gradient over recent segments */
  private calculateTerrainVariability(): number {
    if (this.recentGradients.length < 3) return 0;
    const mean = this.recentGradients.reduce((a, b) => a + b, 0) / this.recentGradients.length;
    const variance = this.recentGradients.reduce((sum, g) => sum + (g - mean) ** 2, 0) / this.recentGradients.length;
    return Math.sqrt(variance);
  }

  /** Track a gradient sample for terrain variability calculation */
  trackGradient(gradient: number): void {
    this.recentGradients.push(gradient);
    if (this.recentGradients.length > this.MAX_RECENT_GRADIENTS) {
      this.recentGradients.shift();
    }
  }

  // ── Gap #7: Cold Start Methods ─────────────────────────

  /** Bootstrap gradient estimation from GPS altitude readings (cold start) */
  bootstrapFromGps(altitude: number, distanceKm: number): void {
    this.coldStartBootstrap.push({ alt: altitude, dist: distanceKm, ts: Date.now() });

    // Keep last 20 readings (1km of data at 50m spacing)
    if (this.coldStartBootstrap.length > 20) this.coldStartBootstrap.shift();

    // Once we have 5+ readings, calculate trend
    if (this.coldStartBootstrap.length >= 5) {
      const first = this.coldStartBootstrap[0]!;
      const last = this.coldStartBootstrap[this.coldStartBootstrap.length - 1]!;
      const distM = (last.dist - first.dist) * 1000;
      if (distM > 100) {
        this.coldStartGradient = ((last.alt - first.alt) / distM) * 100;
        this.coldStartConfidence = Math.min(0.6, 0.2 + this.coldStartBootstrap.length * 0.04);
      }
    }
  }

  /** Estimate terrain type from altitude heuristic (cold start without route) */
  estimateTerrainFromLocation(altitude: number): string {
    if (altitude > 1500) return 'mountain';
    if (altitude > 500) return 'hilly';
    if (altitude < 100) return 'flat';
    return 'mixed';
  }

  /** Get cold start gradient and confidence */
  getColdStartPrediction(): { gradient: number; confidence: number } | null {
    if (this.coldStartConfidence < 0.2) return null;
    return { gradient: this.coldStartGradient, confidence: this.coldStartConfidence };
  }

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
   * Integrates switchback detection (Gap #2) and dead-reckoning (Gap #3).
   */
  tick(
    lat: number, lng: number,
    discoveryProfile: ElevationPoint[],
    currentSpeed: number,
    physicsBase: Omit<PhysicsInput, 'speed_kmh' | 'gradient_pct'>,
    sprockets: number[],
    currentGear: number,
  ): LookaheadResult {
    // Gap #5: Track gradients from discovery profile for terrain variability
    if (discoveryProfile.length >= 2) {
      for (let i = 1; i < Math.min(discoveryProfile.length, 10); i++) {
        const dElev = discoveryProfile[i]!.elevation - discoveryProfile[i - 1]!.elevation;
        const dDist = Math.max(1, discoveryProfile[i]!.distance_from_current - discoveryProfile[i - 1]!.distance_from_current);
        this.trackGradient((dElev / dDist) * 100);
      }
    }

    // Gap #3: Use effective position (dead-reckoned if GPS lost)
    const correctedAlt = this.getCorrectedAltitude(this.lastGpsAlt, this.lastBaroAlt);
    const pos = this.getEffectivePosition(lat, lng, correctedAlt);

    // Check mode transitions
    this.updateMode(pos.lat, pos.lng);

    if (this.mode === 'gpx' && this.gpxRoute) {
      return this.buildGpxLookahead(currentSpeed, physicsBase, sprockets, currentGear);
    }

    // Gap #2: Switchback detection — use momentum-based prediction instead of heading projection
    if (this.mode === 'discovery' && this.isSwitchback()) {
      console.log('[Lookahead] Switchback detected — using momentum prediction');
      const currentGradient = discoveryProfile.length >= 2
        ? ((discoveryProfile[1]!.elevation - discoveryProfile[0]!.elevation) /
           Math.max(1, discoveryProfile[1]!.distance_from_current - discoveryProfile[0]!.distance_from_current)) * 100
        : 0;
      // Track last known gradient for dead-reckoning
      this.lastKnownGradient = currentGradient;
      return this.buildMomentumLookahead(currentGradient, currentSpeed);
    }

    // Gap #3: If dead-reckoning, use momentum prediction (no API calls with stale position)
    if (this.deadReckoningActive) {
      console.log('[Lookahead] Dead-reckoning active — using momentum prediction');
      return this.buildMomentumLookahead(this.deadReckonGradient, currentSpeed);
    }

    // Track gradient for dead-reckoning fallback
    if (discoveryProfile.length >= 2) {
      const dElev = discoveryProfile[1]!.elevation - discoveryProfile[0]!.elevation;
      const dDist = Math.max(1, discoveryProfile[1]!.distance_from_current - discoveryProfile[0]!.distance_from_current);
      this.lastKnownGradient = (dElev / dDist) * 100;
    }

    // Mode B (discovery) or Mode C (hybrid using discovery)
    return {
      ...buildSegmentLookahead(discoveryProfile, currentSpeed, physicsBase, sprockets, currentGear),
      mode: this.mode,
      route_remaining_km: this.getRouteRemainingKm(),
    };
  }

  /**
   * Gap #2: Momentum-based lookahead — assumes gradient continues at current rate.
   * Used when switchback detected or during dead-reckoning (GPS lost).
   * Gap #9: Confidence parameter based on whether barometric altitude is available.
   * Conservative: low confidence, no heading-based API call.
   */
  private buildMomentumLookahead(currentGradient: number, speed: number): LookaheadResult {
    // Use higher confidence if we have altitude data backing up the gradient
    const confidence = this.lastBaroAlt != null ? 0.5 : 0.3;

    const segments: LookaheadSegment[] = [];
    const speedMs = speed / 3.6;
    const grade = classifyGrade(currentGradient);
    // Scale segment count by confidence — more data = more segments
    const segmentCount = confidence >= 0.5 ? 5 : 3;
    const segmentLength = 100;

    for (let d = 0; d < segmentCount * segmentLength; d += segmentLength) {
      const time_est_s = speedMs > 0 ? 100 / speedMs : 999;
      segments.push({
        distance_start_m: d,
        distance_end_m: d + segmentLength,
        gradient_pct: Math.round(currentGradient * confidence * 10) / 10,
        grade,
        elevation_start: d * (currentGradient / 100),
        elevation_end: (d + segmentLength) * (currentGradient / 100),
        P_total_est: 0,
        wh_motor_est: 0,
        time_est_s: Math.round(time_est_s),
        motor_active: speed < 25,
      });
    }

    return {
      segments,
      total_wh_motor: 0,
      next_transition_m: null,
      next_transition_gradient: null,
      seconds_to_transition: null,
      gear_suggestion: null,
      summary: this.deadReckoningActive
        ? 'Dead-reckoning — GPS indisponivel'
        : 'Switchback — predicao por momento',
      mode: this.deadReckoningActive ? 'discovery' : 'discovery',
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
    // Altitude pre-filtering
    this.altitudeBuffer = [];
    // Gap #1
    this.lastBaroAlt = null;
    this.lastGpsAlt = null;
    // Gap #2 + Gap #9
    this.headingHistory = [];
    this.lastSwitchbackDist = 0;
    this.currentDistKm = 0;
    // Gap #3
    this.lastGpsTimestamp = 0;
    // Gap #5
    this.recentGradients = [];
    // Gap #7
    this.coldStartBootstrap = [];
    this.coldStartGradient = 0;
    this.coldStartConfidence = 0;
    this.deadReckoningActive = false;
    this.deadReckonPosition = { lat: 0, lng: 0, alt: 0 };
    this.deadReckonGradient = 0;
    this.lastKnownAltitude = 0;
    this.lastKnownGradient = 0;
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

    // Gap #5: Use adaptive lookahead distance instead of fixed 4km
    const lookaheadM = this.getAdaptiveLookaheadM(currentSpeed);
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
 * Median-smooth an array of elevations (window=5) for segment gradient calculation.
 * Applied to the entire profile before gradient computation to remove GPS spikes.
 */
function medianSmoothElevations(elevations: number[], windowSize = 5): number[] {
  return elevations.map((_, i, arr) => {
    const half = Math.floor(windowSize / 2);
    const start = Math.max(0, i - half);
    const end = Math.min(arr.length, i + half + 1);
    const window = arr.slice(start, end);
    const sorted = [...window].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1]! + sorted[mid]!) / 2
      : sorted[mid]!;
  });
}

/**
 * Build segment lookahead from elevation profile.
 * Used by Mode A (GPX points), Mode B (discovery), and Mode C (hybrid).
 * Applies median smoothing to altitudes BEFORE gradient calculation
 * to eliminate GPS spikes (segment-based, not point-to-point).
 */
export function buildSegmentLookahead(
  profile: ElevationPoint[],
  currentSpeed: number,
  physicsBase: Omit<PhysicsInput, 'speed_kmh' | 'gradient_pct'>,
  sprockets: number[],
  currentGear: number,
): Omit<LookaheadResult, 'mode' | 'route_remaining_km'> {
  if (!profile || profile.length < 2) return emptyResult();

  // Pre-smooth all elevations with median filter before gradient calculation
  const rawElevations = profile.map(p => p.elevation);
  const smoothedElevations = medianSmoothElevations(rawElevations);

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

    // Use median-smoothed elevations for gradient (not raw point-to-point)
    const gradient = ((smoothedElevations[segEnd]! - smoothedElevations[segStart]!) / distM) * 100;
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
      grade, elevation_start: smoothedElevations[segStart]!, elevation_end: smoothedElevations[segEnd]!,
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

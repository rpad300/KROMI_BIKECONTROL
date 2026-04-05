/**
 * TerrainDiscovery — learns terrain in real-time for unplanned rides.
 *
 * When riding without a GPX route, this engine:
 * 1. Records gradient segments as they happen (every 50m of wheel distance)
 * 2. Detects terrain patterns (climb start, sustained climb, descent, rolling)
 * 3. Provides short-term prediction based on momentum (if climbing, likely to continue)
 * 4. Caches terrain by GPS coordinates — if you ride the same path again, it knows
 *
 * Used by KromiEngine when no route is active (LookaheadController mode B: Discovery).
 */

// ── Types ──────────────────────────────────────────────────────

export interface TerrainSegment {
  lat: number;
  lng: number;
  gradient_pct: number;
  distance_m: number;     // segment length
  altitude_start: number;
  altitude_end: number;
  speed_avg_kmh: number;
  timestamp: number;
}

export type TerrainPattern = 'flat' | 'climbing' | 'descending' | 'rolling' | 'steep_climb' | 'steep_descent';

export interface TerrainPrediction {
  /** Predicted gradient for next ~200m */
  predicted_gradient: number;
  /** Confidence 0-1 (higher = more data supporting prediction) */
  confidence: number;
  /** Current terrain pattern */
  pattern: TerrainPattern;
  /** How long this pattern has been sustained (meters) */
  pattern_distance_m: number;
  /** Suggested pre-adjustment: if climb is starting, pre-boost support */
  pre_adjust_support: number;  // 0 = no change, positive = boost
  pre_adjust_torque: number;
}

// ── Constants ──────────────────────────────────────────────────

const SEGMENT_LENGTH_M = 50;        // Record a segment every 50m
const HISTORY_SEGMENTS = 200;       // Keep last 10km of segments
const PATTERN_WINDOW = 6;           // Last 6 segments (300m) for pattern detection
const MOMENTUM_FACTOR = 0.7;        // How much current trend predicts future
const CACHE_GRID_SIZE = 0.0005;     // ~50m GPS grid for terrain cache

// ── Engine ─────────────────────────────────────────────────────

export class TerrainDiscovery {
  private segments: TerrainSegment[] = [];
  private currentSegment: { startDist: number; startAlt: number; startLat: number; startLng: number; speedSum: number; samples: number } | null = null;

  /** Cached terrain grid: key = `lat_grid:lng_grid`, value = avg gradient */
  private terrainCache: Map<string, { gradient: number; samples: number }> = new Map();

  /** Feed current position. Call every tick (~1s). */
  feed(lat: number, lng: number, altitude: number, distanceKm: number, speedKmh: number): void {
    const dist_m = distanceKm * 1000;

    if (!this.currentSegment) {
      this.currentSegment = { startDist: dist_m, startAlt: altitude, startLat: lat, startLng: lng, speedSum: speedKmh, samples: 1 };
      return;
    }

    this.currentSegment.speedSum += speedKmh;
    this.currentSegment.samples++;

    const segDist = dist_m - this.currentSegment.startDist;
    if (segDist >= SEGMENT_LENGTH_M) {
      // Close segment
      const dAlt = altitude - this.currentSegment.startAlt;
      const gradient = segDist > 0 ? (dAlt / segDist) * 100 : 0;
      const clampedGrad = Math.max(-25, Math.min(25, gradient));

      const segment: TerrainSegment = {
        lat, lng,
        gradient_pct: Math.round(clampedGrad * 10) / 10,
        distance_m: segDist,
        altitude_start: this.currentSegment.startAlt,
        altitude_end: altitude,
        speed_avg_kmh: this.currentSegment.speedSum / this.currentSegment.samples,
        timestamp: Date.now(),
      };

      this.segments.push(segment);
      if (this.segments.length > HISTORY_SEGMENTS) this.segments.shift();

      // Cache this terrain point
      this.cacheTerrainPoint(lat, lng, clampedGrad);

      // Start new segment
      this.currentSegment = { startDist: dist_m, startAlt: altitude, startLat: lat, startLng: lng, speedSum: speedKmh, samples: 1 };
    }
  }

  /** Get terrain prediction for the next ~200m */
  predict(lat: number, lng: number, heading: number): TerrainPrediction {
    const pattern = this.detectPattern();
    const recentGrads = this.segments.slice(-PATTERN_WINDOW).map(s => s.gradient_pct);

    if (recentGrads.length < 2) {
      return { predicted_gradient: 0, confidence: 0, pattern: 'flat', pattern_distance_m: 0, pre_adjust_support: 0, pre_adjust_torque: 0 };
    }

    // Momentum prediction: weighted average of recent gradients, biased to most recent
    let weightedSum = 0, weightTotal = 0;
    for (let i = 0; i < recentGrads.length; i++) {
      const w = (i + 1) / recentGrads.length; // more recent = higher weight
      weightedSum += recentGrads[i]! * w;
      weightTotal += w;
    }
    const momentumGrad = weightedSum / weightTotal;

    // Check terrain cache for what's ahead (if we've been here before)
    const cachedGrad = this.lookupAhead(lat, lng, heading);
    const hasCachedData = cachedGrad !== null;

    // Blend momentum with cached data
    const predicted = hasCachedData
      ? momentumGrad * 0.4 + cachedGrad * 0.6  // trust cache more
      : momentumGrad * MOMENTUM_FACTOR;          // pure momentum

    const confidence = Math.min(1, (recentGrads.length / PATTERN_WINDOW) * (hasCachedData ? 1.0 : 0.6));

    // Pattern distance
    const patternDist = this.getPatternDistance(pattern);

    // Pre-adjustment: if transitioning to climb, boost early
    let preSupport = 0, preTorque = 0;
    if (pattern === 'flat' && predicted > 3) {
      // Flat → climb transition starting
      preSupport = Math.min(50, predicted * 8);
      preTorque = Math.min(15, predicted * 2);
    } else if (pattern === 'climbing' && predicted > recentGrads[recentGrads.length - 1]!) {
      // Climb getting steeper
      preSupport = Math.min(30, (predicted - recentGrads[recentGrads.length - 1]!) * 5);
    }

    return {
      predicted_gradient: Math.round(predicted * 10) / 10,
      confidence,
      pattern,
      pattern_distance_m: patternDist,
      pre_adjust_support: Math.round(preSupport),
      pre_adjust_torque: Math.round(preTorque),
    };
  }

  /** Get recent segments for UI display */
  getRecentSegments(count: number = 20): TerrainSegment[] {
    return this.segments.slice(-count);
  }

  /** Get terrain cache size (for debug) */
  getCacheSize(): number {
    return this.terrainCache.size;
  }

  reset(): void {
    this.segments = [];
    this.currentSegment = null;
    // Keep terrain cache — it's valuable across rides
  }

  // ── Private ──────────────────────────────────────────────────

  private detectPattern(): TerrainPattern {
    const recent = this.segments.slice(-PATTERN_WINDOW);
    if (recent.length < 3) return 'flat';

    const avgGrad = recent.reduce((s, seg) => s + seg.gradient_pct, 0) / recent.length;
    const variance = recent.reduce((s, seg) => s + (seg.gradient_pct - avgGrad) ** 2, 0) / recent.length;
    const stdDev = Math.sqrt(variance);

    if (avgGrad > 8) return 'steep_climb';
    if (avgGrad > 2) return 'climbing';
    if (avgGrad < -8) return 'steep_descent';
    if (avgGrad < -2) return 'descending';
    if (stdDev > 3) return 'rolling';  // alternating up/down
    return 'flat';
  }

  private getPatternDistance(pattern: TerrainPattern): number {
    let dist = 0;
    for (let i = this.segments.length - 1; i >= 0; i--) {
      const seg = this.segments[i]!;
      const segPattern = seg.gradient_pct > 2 ? 'climbing' : seg.gradient_pct < -2 ? 'descending' : 'flat';
      const matches = (pattern === 'climbing' || pattern === 'steep_climb') ? segPattern === 'climbing'
        : (pattern === 'descending' || pattern === 'steep_descent') ? segPattern === 'descending'
        : segPattern === 'flat';
      if (!matches) break;
      dist += seg.distance_m;
    }
    return dist;
  }

  private cacheTerrainPoint(lat: number, lng: number, gradient: number): void {
    const key = `${Math.round(lat / CACHE_GRID_SIZE) * CACHE_GRID_SIZE}:${Math.round(lng / CACHE_GRID_SIZE) * CACHE_GRID_SIZE}`;
    const existing = this.terrainCache.get(key);
    if (existing) {
      // Blend with existing
      const alpha = 0.3;
      existing.gradient = existing.gradient * (1 - alpha) + gradient * alpha;
      existing.samples++;
    } else {
      this.terrainCache.set(key, { gradient, samples: 1 });
    }
  }

  /** Look ahead ~200m in the direction of travel using terrain cache */
  private lookupAhead(lat: number, lng: number, heading: number): number | null {
    if (this.terrainCache.size === 0) return null;

    const headingRad = (heading * Math.PI) / 180;
    const lookDistances = [100, 200, 300]; // look 100, 200, 300m ahead
    let totalGrad = 0, found = 0;

    for (const dist of lookDistances) {
      // Approximate position ahead (1° lat ≈ 111km, 1° lng ≈ 111km × cos(lat))
      const dLat = (dist * Math.cos(headingRad)) / 111000;
      const dLng = (dist * Math.sin(headingRad)) / (111000 * Math.cos(lat * Math.PI / 180));
      const aheadLat = lat + dLat;
      const aheadLng = lng + dLng;

      const key = `${Math.round(aheadLat / CACHE_GRID_SIZE) * CACHE_GRID_SIZE}:${Math.round(aheadLng / CACHE_GRID_SIZE) * CACHE_GRID_SIZE}`;
      const cached = this.terrainCache.get(key);
      if (cached && cached.samples >= 2) {
        totalGrad += cached.gradient;
        found++;
      }
    }

    return found > 0 ? totalGrad / found : null;
  }
}

export const terrainDiscovery = new TerrainDiscovery();

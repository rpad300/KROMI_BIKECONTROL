/**
 * TerrainPatternLearner — Gap #8: lightweight pattern recognition for terrain transitions.
 *
 * NOT a full ML model. Records terrain transition timing and learns
 * what typically comes next (e.g., flat → gentle_climb after ~45s).
 * Persists patterns to localStorage across rides for progressive learning.
 *
 * Integration:
 * - Call feed() every tick with current gradient + distance
 * - Call predictNext() to get pre-adjustment hints
 * - Call save() at ride end, load() at ride start
 */

// ── Types ──────────────────────────────────────────────────────

export type TerrainCategory = 'descent' | 'flat' | 'gentle_climb' | 'steep_climb';

export interface TerrainPattern {
  from: TerrainCategory;
  to: TerrainCategory;
  avgDuration_s: number;
  avgGradient: number;
  count: number;
}

export interface TerrainPredictionResult {
  terrain: TerrainCategory;
  in_seconds: number;
  confidence: number;
}

// ── Constants ──────────────────────────────────────────────────

const STORAGE_KEY = 'kromi-terrain-patterns';
const MIN_OBSERVATIONS = 3; // Need at least 3 observations for a reliable prediction
const MAX_CONFIDENCE = 0.7;

// ── Learner ───────────────────────────────────────────────────

export class TerrainPatternLearner {
  private patterns = new Map<string, TerrainPattern>();
  private currentTerrain: TerrainCategory = 'flat';
  private terrainStartTime = Date.now();

  /**
   * Feed current gradient and distance. Call on every tick (~1s).
   * Detects terrain transitions and records patterns.
   */
  feed(gradient: number, _distance_km: number): void {
    const newTerrain = this.classifyTerrain(gradient);

    if (newTerrain !== this.currentTerrain) {
      // Transition detected — record pattern
      const duration = (Date.now() - this.terrainStartTime) / 1000;

      // Only record transitions that lasted at least 5s (filter noise)
      if (duration >= 5) {
        const key = `${this.currentTerrain}_to_${newTerrain}`;

        const existing = this.patterns.get(key);
        if (existing) {
          // Running average update
          existing.avgDuration_s =
            (existing.avgDuration_s * existing.count + duration) / (existing.count + 1);
          existing.avgGradient =
            (existing.avgGradient * existing.count + gradient) / (existing.count + 1);
          existing.count++;
        } else {
          this.patterns.set(key, {
            from: this.currentTerrain,
            to: newTerrain,
            avgDuration_s: duration,
            avgGradient: gradient,
            count: 1,
          });
        }
      }

      this.currentTerrain = newTerrain;
      this.terrainStartTime = Date.now();
      // distance_km available for future segment-length analysis
    }
  }

  /**
   * Predict: given current terrain, what comes next and when?
   * Returns null if not enough data (< MIN_OBSERVATIONS).
   */
  predictNext(currentTerrain?: TerrainCategory): TerrainPredictionResult | null {
    const terrain = currentTerrain ?? this.currentTerrain;

    // Find most common transition from current terrain
    let best: TerrainPattern | null = null;
    let bestCount = 0;

    for (const [, pattern] of this.patterns) {
      if (pattern.from === terrain && pattern.count > bestCount) {
        best = pattern;
        bestCount = pattern.count;
      }
    }

    if (!best || best.count < MIN_OBSERVATIONS) return null;

    const elapsed = (Date.now() - this.terrainStartTime) / 1000;
    const remaining = Math.max(0, best.avgDuration_s - elapsed);

    return {
      terrain: best.to,
      in_seconds: remaining,
      confidence: Math.min(MAX_CONFIDENCE, 0.3 + best.count * 0.05),
    };
  }

  /** Get the current terrain classification */
  getCurrentTerrain(): TerrainCategory {
    return this.currentTerrain;
  }

  /** Get all learned patterns (for debug/UI) */
  getPatterns(): TerrainPattern[] {
    return Array.from(this.patterns.values());
  }

  /** Get total number of transition observations */
  getTotalObservations(): number {
    let total = 0;
    for (const [, pattern] of this.patterns) {
      total += pattern.count;
    }
    return total;
  }

  /** Classify gradient into terrain category */
  private classifyTerrain(gradient: number): TerrainCategory {
    if (gradient < -3) return 'descent';
    if (gradient < 3) return 'flat';
    if (gradient < 8) return 'gentle_climb';
    return 'steep_climb';
  }

  // ── Persistence ─────────────────────────────────────────────

  /** Persist patterns to localStorage. Call at ride end. */
  save(): void {
    try {
      const data: Record<string, TerrainPattern> = {};
      for (const [key, pattern] of this.patterns) {
        data[key] = pattern;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // localStorage unavailable or full
    }
  }

  /** Load patterns from localStorage. Call at ride start. */
  load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as Record<string, TerrainPattern>;
      for (const [key, pattern] of Object.entries(data)) {
        // Validate pattern structure
        if (
          pattern.from && pattern.to && typeof pattern.avgDuration_s === 'number' &&
          typeof pattern.count === 'number' && pattern.count > 0
        ) {
          this.patterns.set(key, pattern);
        }
      }
      console.log(`[TerrainPattern] Loaded ${this.patterns.size} patterns (${this.getTotalObservations()} observations)`);
    } catch {
      // localStorage unavailable or corrupted data
    }
  }

  /** Reset ride-specific state (keep patterns). */
  resetRide(): void {
    this.currentTerrain = 'flat';
    this.terrainStartTime = Date.now();
  }

  /** Full reset including learned patterns. */
  resetAll(): void {
    this.patterns.clear();
    this.resetRide();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}

/** Singleton instance */
export const terrainPatternLearner = new TerrainPatternLearner();

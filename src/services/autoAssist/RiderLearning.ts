/**
 * RiderLearning — progressive calibration of athlete model.
 *
 * Calibrates per ride and across rides:
 *   - CP (Critical Power) from sustained high-effort segments
 *   - W' (anaerobic capacity) and τ (recovery constant) from depletion/recovery events
 *   - Crr_effective from flat segments with known wind/speed
 *   - EF baseline per effort category
 *   - Override detection for motor preference learning
 */

import { AssistMode } from '../../types/bike.types';

// ── Types ──────────────────────────────────────────────────────

export interface CalibratedParams {
  cp_watts: number;
  w_prime_joules: number;
  tau_seconds: number;
  crr_adjustments: Record<string, number>;   // surface → Crr correction
  ef_baselines: Record<string, number>;       // effort_category → EF baseline
  confidence: number;                         // 0-1 based on data points
}

export interface OverrideEvent {
  gradient: number;
  hr_zone: number;
  direction: 'more' | 'less';
  timestamp: number;
  support_at_override: number;
  torque_at_override: number;
}

interface CPDataPoint {
  power_avg: number;
  duration_s: number;
  timestamp: number;
}

interface CrrObservation {
  surface: string;
  predicted_speed: number;
  actual_speed: number;
  crr_used: number;
  timestamp: number;
}

// ── Learning Engine ────────────────────────────────────────────

const LEARNING_RATE = 0.1;
const MIN_CP_SEGMENT_S = 480;  // 8 minutes minimum for CP detection
const CP_POWER_THRESHOLD = 0.8; // 80% of current CP estimate

export class RiderLearning {
  private params: CalibratedParams;
  private cpDataPoints: CPDataPoint[] = [];
  private crrObservations: CrrObservation[] = [];
  private overrideHistory: OverrideEvent[] = [];
  private consecutiveOverrides: Map<string, number> = new Map();

  // Override detection state
  private lastEngineCommand: { support: number; torque: number; launch: number; ts: number } | null = null;
  private lastAssistMode: AssistMode = AssistMode.POWER;

  constructor(initial?: Partial<CalibratedParams>) {
    this.params = {
      cp_watts: initial?.cp_watts ?? 150,
      w_prime_joules: initial?.w_prime_joules ?? 15000,
      tau_seconds: initial?.tau_seconds ?? 300,
      crr_adjustments: initial?.crr_adjustments ?? {},
      ef_baselines: initial?.ef_baselines ?? {},
      confidence: initial?.confidence ?? 0,
    };
  }

  getParams(): CalibratedParams { return this.params; }
  getOverrideHistory(): OverrideEvent[] { return this.overrideHistory; }

  // ── CP Calibration ─────────────────────────────────────────

  /**
   * Feed sustained effort segment for CP detection.
   * Call periodically with average power over recent window.
   *
   * Auto-detects sustained high-effort: P_human > 80% of CP for > 8 min.
   */
  feedEffortSegment(power_avg: number, duration_s: number): void {
    if (duration_s < MIN_CP_SEGMENT_S) return;
    if (power_avg < this.params.cp_watts * CP_POWER_THRESHOLD) return;

    this.cpDataPoints.push({
      power_avg,
      duration_s,
      timestamp: Date.now(),
    });

    // Keep last 20 data points
    if (this.cpDataPoints.length > 20) {
      this.cpDataPoints = this.cpDataPoints.slice(-20);
    }

    this.recalculateCP();
  }

  /** Recalculate CP from data points. Weighted: recent rides + longer efforts score higher. */
  private recalculateCP(): void {
    if (this.cpDataPoints.length < 2) return;

    const now = Date.now();
    let weightedSum = 0;
    let weightSum = 0;

    for (const dp of this.cpDataPoints) {
      // Recency weight: halves every 30 days
      const ageDays = (now - dp.timestamp) / 86_400_000;
      const recencyWeight = Math.exp(-ageDays / 43); // ~30 day half-life

      // Duration weight: longer efforts are more reliable
      const durationWeight = Math.min(1, dp.duration_s / 1200); // max at 20 min

      const w = recencyWeight * durationWeight;
      weightedSum += dp.power_avg * w;
      weightSum += w;
    }

    if (weightSum > 0) {
      const newCP = weightedSum / weightSum;
      this.params.cp_watts = Math.round(
        this.params.cp_watts * (1 - LEARNING_RATE) + newCP * LEARNING_RATE
      );
      this.params.confidence = Math.min(1, this.cpDataPoints.length / 10);
    }
  }

  // ── W' and τ Calibration ───────────────────────────────────

  /**
   * Calibrate W' from observed depletion event.
   * Called when W' balance reaches critical and HR confirms exhaustion.
   *
   * @param depleted_joules - How much W' was spent before exhaustion
   * @param recovery_time_s - Time to recover to 70% at sub-CP effort
   */
  calibrateWPrime(depleted_joules: number, recovery_time_s: number): void {
    if (depleted_joules > 0) {
      // Blend with existing estimate
      this.params.w_prime_joules = Math.round(
        this.params.w_prime_joules * (1 - LEARNING_RATE) +
        depleted_joules * LEARNING_RATE
      );
    }

    if (recovery_time_s > 30) {
      // τ ≈ time to recover 63% (1 - 1/e)
      // If they recovered 70% in recovery_time_s, τ ≈ recovery_time_s / 1.2
      const newTau = recovery_time_s / 1.2;
      this.params.tau_seconds = Math.round(
        this.params.tau_seconds * (1 - LEARNING_RATE) +
        newTau * LEARNING_RATE
      );
    }
  }

  // ── Crr Calibration ────────────────────────────────────────

  /**
   * Observe speed vs predicted on flat segment.
   * On flat (grade < 1%) with known wind: compare model vs actual.
   */
  feedCrrObservation(
    surface: string,
    predicted_speed: number,
    actual_speed: number,
    crr_used: number,
  ): void {
    if (Math.abs(predicted_speed - actual_speed) < 0.5) return; // close enough

    this.crrObservations.push({
      surface, predicted_speed, actual_speed, crr_used,
      timestamp: Date.now(),
    });

    // Keep last 50 observations
    if (this.crrObservations.length > 50) {
      this.crrObservations = this.crrObservations.slice(-50);
    }

    // Calculate adjustment for this surface
    const surfaceObs = this.crrObservations.filter(o => o.surface === surface);
    if (surfaceObs.length < 3) return;

    // If actual speed consistently lower than predicted → Crr is too low
    const avgRatio = surfaceObs.reduce((sum, o) => sum + (o.predicted_speed / o.actual_speed), 0) / surfaceObs.length;

    if (avgRatio > 1.05) {
      // Model over-predicts speed → increase Crr
      this.params.crr_adjustments[surface] = (this.params.crr_adjustments[surface] ?? 0) + 0.001;
    } else if (avgRatio < 0.95) {
      // Model under-predicts speed → decrease Crr
      this.params.crr_adjustments[surface] = (this.params.crr_adjustments[surface] ?? 0) - 0.001;
    }
  }

  /** Get adjusted Crr for surface */
  getAdjustedCrr(baseCrr: number, surface: string): number {
    const adj = this.params.crr_adjustments[surface] ?? 0;
    return Math.max(0.002, Math.min(0.020, baseCrr + adj));
  }

  // ── EF Baseline ────────────────────────────────────────────

  /** Update EF baseline for an effort category */
  updateEfBaseline(category: string, ef_value: number): void {
    const existing = this.params.ef_baselines[category];
    if (existing === undefined) {
      this.params.ef_baselines[category] = ef_value;
    } else {
      this.params.ef_baselines[category] =
        existing * (1 - LEARNING_RATE) + ef_value * LEARNING_RATE;
    }
  }

  getEfBaseline(category: string): number {
    return this.params.ef_baselines[category] ?? 0;
  }

  // ── Override Detection ─────────────────────────────────────

  /** Record the last command sent by KromiEngine */
  recordEngineCommand(support: number, torque: number, launch: number): void {
    this.lastEngineCommand = { support, torque, launch, ts: Date.now() };
  }

  /**
   * Check if rider overrode the engine.
   * Call on every mode change from bikeStore.
   */
  detectOverride(
    currentMode: AssistMode,
    gradient: number,
    hr_zone: number,
  ): OverrideEvent | null {
    const prev = this.lastAssistMode;
    this.lastAssistMode = currentMode;

    // Only detect overrides within 15s of engine command
    if (!this.lastEngineCommand) return null;
    if (Date.now() - this.lastEngineCommand.ts > 15_000) return null;
    if (currentMode === prev) return null;

    const direction: 'more' | 'less' = currentMode > prev ? 'more' : 'less';

    const event: OverrideEvent = {
      gradient, hr_zone, direction,
      timestamp: Date.now(),
      support_at_override: this.lastEngineCommand.support,
      torque_at_override: this.lastEngineCommand.torque,
    };

    this.overrideHistory.push(event);
    if (this.overrideHistory.length > 100) {
      this.overrideHistory = this.overrideHistory.slice(-100);
    }

    // Track consecutive overrides in same conditions
    const condKey = `${Math.round(gradient)}_z${hr_zone}_${direction}`;
    const count = (this.consecutiveOverrides.get(condKey) ?? 0) + 1;
    this.consecutiveOverrides.set(condKey, count);

    return event;
  }

  /**
   * Check if there are enough consecutive overrides to justify
   * a permanent base parameter adjustment.
   * Returns adjustment direction if 3+ consecutive overrides in same conditions.
   */
  shouldAdjustBase(gradient: number, hr_zone: number): 'more' | 'less' | null {
    for (const dir of ['more', 'less'] as const) {
      const condKey = `${Math.round(gradient)}_z${hr_zone}_${dir}`;
      const count = this.consecutiveOverrides.get(condKey) ?? 0;
      if (count >= 3) {
        // Reset counter after adjustment
        this.consecutiveOverrides.set(condKey, 0);
        return dir;
      }
    }
    return null;
  }

  /** Reset for new ride (keep calibrated params) */
  resetRide(): void {
    this.lastEngineCommand = null;
    this.lastAssistMode = AssistMode.POWER;
    this.consecutiveOverrides.clear();
  }
}

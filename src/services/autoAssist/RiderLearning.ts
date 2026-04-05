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
import { useSettingsStore, safeBikeConfig } from '../../store/settingsStore';

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

/**
 * Mode Feedback Event — captured when rider switches FROM POWER to another mode.
 * The target mode encodes what they actually wanted:
 *   SPORT(4)=~280%, ACTIVE(3)=~180%, TOUR(2)=~120%, ECO(1)=~70%
 * Combined with context, this teaches KROMI what support level the rider
 * prefers for specific gradient × HR zone conditions.
 */
export interface ModeFeedbackEvent {
  /** Context when rider left POWER */
  gradient_bucket: number;     // rounded to nearest 2% (-inf, -4, -2, 0, 2, 4, 6, 8, 10+)
  hr_zone: number;             // 0-5
  speed_kmh: number;
  gear: number;
  w_prime_pct: number;         // 0-100
  /** What KROMI was doing */
  kromi_support_pct: number;   // 50-350
  kromi_torque_nm: number;     // 20-85
  /** What the rider switched to */
  target_mode: AssistMode;     // 1-4 (ECO/TOUR/ACTIVE/SPORT)
  target_approx_support: number; // estimated support % of target mode
  /** Calculated correction: how much KROMI should adjust for this context */
  correction_pct: number;      // negative = less, positive = more
  timestamp: number;
  /** Duration in non-POWER mode before returning (filled on return) */
  duration_s: number | null;
}

/**
 * Approximate support % for each Giant assist mode × tuning level.
 * Source: Giant SyncDrive Pro specs + observed behavior.
 * Key: `mode:tuning_level` where tuning 1=low, 2=mid, 3=high
 * These are fallback values — real support is measured from motor current.
 */
const MODE_SUPPORT_APPROX: Record<number, Record<number, number>> = {
  1: { 1: 50, 2: 70, 3: 100 },   // ECO
  2: { 1: 100, 2: 120, 3: 150 },  // TOUR
  3: { 1: 140, 2: 180, 3: 220 },  // ACTIVE
  4: { 1: 220, 2: 280, 3: 340 },  // SPORT
};

/**
 * Get support % for a mode. Uses rider's RideControl config if available,
 * falls back to approximate table.
 */
function getModeSupportApprox(mode: number, tuningLevel?: number): number {
  // Try to read from bike config (rider's actual RideControl values)
  try {
    const bike = safeBikeConfig(useSettingsStore.getState().bikeConfig);
    const modeKey = ['', 'eco', 'tour', 'active', 'sport'][mode] as 'eco' | 'tour' | 'active' | 'sport' | undefined;
    if (modeKey && bike.ridecontrol_modes[modeKey]) {
      const levelKey = tuningLevel === 1 ? 'low' : tuningLevel === 3 ? 'high' : 'mid';
      return bike.ridecontrol_modes[modeKey][levelKey].support_pct;
    }
  } catch { /* store not ready */ }

  // Fallback to approximate table
  const levels = MODE_SUPPORT_APPROX[mode];
  if (!levels) return 150;
  return levels[tuningLevel ?? 2] ?? levels[2] ?? 150;
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

  // Mode Feedback Learning
  private modeFeedbackHistory: ModeFeedbackEvent[] = [];
  /** Active feedback event (rider left POWER, hasn't returned yet) */
  private pendingFeedback: ModeFeedbackEvent | null = null;
  /**
   * Learned support correction by context bucket.
   * Key: `gradient_bucket:hr_zone` e.g. "4:3" = 4% gradient, HR zone 3
   * Value: support correction in % (e.g. +30 means add 30% to KROMI's support)
   */
  private supportCorrections: Map<string, { correction: number; samples: number }> = new Map();

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

  // ── CP/W' Field Test Protocol ───────────────────────────────

  /**
   * Structured field test: two all-out efforts to calculate CP and W'.
   *
   * Protocol:
   *   1. Warmup 15 min
   *   2. 12-minute all-out effort → record avg power (P12)
   *   3. Rest 30 min (full recovery)
   *   4. 3-minute all-out effort → record avg power (P3)
   *
   * Physics:
   *   Work_12 = P12 × 720s
   *   Work_3  = P3  × 180s
   *   CP = (Work_12 - Work_3) / (720 - 180)
   *   W' = 720 × (P12 - CP)   [joules]
   *   τ  = W' / (P3 - CP)     [seconds, recovery constant estimate]
   *
   * Call this after the rider completes the test with both power values.
   */
  applyFieldTest(P12_watts: number, P3_watts: number): {
    cp: number; w_prime: number; tau: number;
  } | null {
    if (P3_watts <= P12_watts || P12_watts <= 0) return null;

    const W12 = P12_watts * 720;
    const W3 = P3_watts * 180;
    const cp = Math.round((W12 - W3) / (720 - 180));
    const w_prime = Math.round(720 * (P12_watts - cp));
    const tau = P3_watts > cp ? Math.round(w_prime / (P3_watts - cp)) : 300;

    if (cp < 50 || cp > 400 || w_prime < 3000 || w_prime > 40000) {
      return null; // sanity check failed
    }

    this.params.cp_watts = cp;
    this.params.w_prime_joules = w_prime;
    this.params.tau_seconds = Math.max(120, Math.min(600, tau));
    this.params.confidence = 0.9; // field test = high confidence

    // Record as high-quality data points
    this.cpDataPoints.push(
      { power_avg: P12_watts, duration_s: 720, timestamp: Date.now() },
      { power_avg: P3_watts, duration_s: 180, timestamp: Date.now() },
    );

    return { cp, w_prime, tau: this.params.tau_seconds };
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

  // ── Mode Feedback Learning ──────────────────────────────────

  /**
   * Called when rider leaves POWER mode. Captures full context snapshot.
   * The target mode tells us what support level they actually wanted.
   */
  recordModeExit(context: {
    targetMode: AssistMode;
    targetTuningLevel?: number;  // 1-3 from tuningStore, if available
    gradient: number;
    hr_zone: number;
    speed_kmh: number;
    gear: number;
    w_prime_pct: number;
    kromi_support_pct: number;
    kromi_torque_nm: number;
  }): ModeFeedbackEvent {
    const gradBucket = this.gradientBucket(context.gradient);
    const targetSupport = getModeSupportApprox(context.targetMode, context.targetTuningLevel);
    const correction = targetSupport - context.kromi_support_pct;

    const event: ModeFeedbackEvent = {
      gradient_bucket: gradBucket,
      hr_zone: context.hr_zone,
      speed_kmh: context.speed_kmh,
      gear: context.gear,
      w_prime_pct: context.w_prime_pct,
      kromi_support_pct: context.kromi_support_pct,
      kromi_torque_nm: context.kromi_torque_nm,
      target_mode: context.targetMode,
      target_approx_support: targetSupport,
      correction_pct: correction,
      timestamp: Date.now(),
      duration_s: null,
    };

    this.pendingFeedback = event;
    return event;
  }

  /**
   * Called when rider returns to POWER mode.
   * Closes the pending feedback event and applies the learning.
   */
  recordModeReturn(): ModeFeedbackEvent | null {
    if (!this.pendingFeedback) return null;

    const event = this.pendingFeedback;
    event.duration_s = (Date.now() - event.timestamp) / 1000;
    this.pendingFeedback = null;

    // Only learn from events where rider stayed > 30s in the other mode
    // (< 30s might be accidental or just checking something)
    if (event.duration_s < 30) return event;

    this.modeFeedbackHistory.push(event);
    if (this.modeFeedbackHistory.length > 200) {
      this.modeFeedbackHistory = this.modeFeedbackHistory.slice(-200);
    }

    // Apply learning: blend correction into the context bucket
    this.applySupportCorrection(event);

    return event;
  }

  /**
   * Get the learned support correction for current riding context.
   * Returns a % adjustment to apply on top of KROMI's calculated support.
   *
   * Example: returns +25 → KROMI should add 25% to its support calculation.
   * Example: returns -15 → KROMI should subtract 15%.
   */
  getSupportCorrection(gradient: number, hr_zone: number): number {
    const key = `${this.gradientBucket(gradient)}:${hr_zone}`;
    const entry = this.supportCorrections.get(key);
    if (!entry || entry.samples < 2) return 0; // need at least 2 samples to trust
    return entry.correction;
  }

  /** Get all learned corrections (for logging/debug) */
  getAllCorrections(): Map<string, { correction: number; samples: number }> {
    return new Map(this.supportCorrections);
  }

  /** Get feedback history for PostRideAnalysis */
  getModeFeedbackHistory(): ModeFeedbackEvent[] {
    return [...this.modeFeedbackHistory];
  }

  private applySupportCorrection(event: ModeFeedbackEvent): void {
    const key = `${event.gradient_bucket}:${event.hr_zone}`;
    const existing = this.supportCorrections.get(key);

    if (!existing) {
      // First observation for this context — start with reduced learning rate
      this.supportCorrections.set(key, {
        correction: event.correction_pct * 0.5, // 50% of first observation
        samples: 1,
      });
    } else {
      // Exponential moving average: more samples → slower change
      const alpha = Math.max(0.05, 0.3 / Math.sqrt(existing.samples));
      const blended = existing.correction * (1 - alpha) + event.correction_pct * alpha;
      this.supportCorrections.set(key, {
        correction: Math.round(blended),
        samples: existing.samples + 1,
      });
    }
  }

  /** Round gradient to bucket: ...-4, -2, 0, 2, 4, 6, 8, 10+ */
  private gradientBucket(gradient: number): number {
    if (gradient <= -4) return -4;
    if (gradient >= 10) return 10;
    return Math.round(gradient / 2) * 2;
  }

  /** Reset for new ride (keep calibrated params AND learned corrections) */
  resetRide(): void {
    this.lastEngineCommand = null;
    this.lastAssistMode = AssistMode.POWER;
    this.consecutiveOverrides.clear();
    this.pendingFeedback = null;
    // NOTE: modeFeedbackHistory and supportCorrections persist across rides
  }
}

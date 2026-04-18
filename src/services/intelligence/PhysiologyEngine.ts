/**
 * PhysiologyEngine — tracks athlete state and projects capability forward.
 *
 * Inputs: HR current, HR series (10min), P_human from PhysicsEngine.
 * Outputs: hrModifier for motor control, fatigue flags, W' balance state.
 *
 * Models implemented:
 *   - HR Zone tracking with margin to ceiling
 *   - Cardiac Drift detection (fatigue signal)
 *   - W' Balance (Skiba model) — anaerobic capacity
 *   - Efficiency Factor (EF) — P_human / HR ratio
 *   - Cardiac Recovery Index (IRC) — recovery quality
 *   - Zone breach projection — pre-emptive protection
 */

import type { HRZone } from '../../types/athlete.types';

// ── Types ──────────────────────────────────────────────────────

export interface PhysiologyInput {
  hr_bpm: number;
  P_human: number;            // watts from PhysicsEngine
  gradient_pct: number;       // for constant-effort detection
  speed_kmh: number;          // for constant-effort detection
  zones: HRZone[];            // 5 HR zones from rider profile
  target_zone: number;        // 1-5
  cp_watts: number;           // Critical Power (≈FTP), from profile or calibrated
  w_prime_joules: number;     // W' total capacity (default 15000 J for recreational)
  tau_seconds: number;        // W' recovery time constant (default 400s recreational)
}

export interface PhysiologyOutput {
  /** Motor modifier: <1.0 = reduce load, >1.0 = can push more */
  hrModifier: number;
  /** Current HR zone (1-5, 0 if no HR) */
  zone_current: number;
  /** BPM margin to zone ceiling */
  margin_bpm: number;
  /** Cardiac drift rate (bpm/min). >0.3 = fatigue emerging */
  drift_bpm_per_min: number;
  /** Minutes until zone breach at current drift. Infinity if safe. */
  t_breach_minutes: number;
  /** W' balance as fraction 0.0-1.0 */
  w_prime_balance: number;
  /** W' state: green (>70%), amber (30-70%), critical (<30%) */
  w_prime_state: 'green' | 'amber' | 'critical';
  /** Efficiency Factor: P_human / HR. 0 if no data. */
  ef_current: number;
  /** True if EF < 85% of baseline */
  ef_degraded: boolean;
  /** Cardiac Recovery Index (0-1). -1 if not measured. */
  irc: number;
  /** True if IRC < 0.6 */
  residual_fatigue: boolean;
  /** Active flags for decision tree */
  flags: PhysiologyFlag[];
}

export type PhysiologyFlag =
  | 'w_prime_critical'
  | 'zone_breach_imminent'
  | 'cardiovascular_fatigue_emerging'
  | 'functional_efficiency_degraded'
  | 'residual_fatigue_significant'
  | 'inefficient_cadence';

// ── Engine ─────────────────────────────────────────────────────

export class PhysiologyEngine {
  // HR history (last 10 min, 1 sample/sec)
  private hrHistory: { ts: number; hr: number; power: number; gradient: number; speed: number }[] = [];
  private readonly HR_HISTORY_WINDOW_MS = 10 * 60 * 1000;

  // W' balance
  private wPrimeBalance: number;
  private wPrimeTotal: number;
  private lastTickTs: number = 0;

  // EF baseline (accumulated across rides)
  private efBaseline: number = 0;
  private efSampleCount: number = 0;

  // IRC tracking
  private ircState: 'idle' | 'recovering' = 'idle';
  private ircStartHr: number = 0;
  private ircStartTs: number = 0;
  private ircReferenceDropBpm: number = 25; // default: 25bpm drop in 60s at fresh
  private lastIrc: number = -1;

  // Gap #24: IRC auto-calibration — learn per-rider recovery baseline
  private ircSamples: number[] = [];
  /** Callback fired when IRC reference is auto-calibrated — caller should persist */
  onIrcCalibrated: ((newRef: number) => void) | null = null;

  // Recovery tracking for W'
  private timeBelowCpMs: number = 0;

  constructor(w_prime_joules: number = 15000) {
    this.wPrimeTotal = w_prime_joules;
    this.wPrimeBalance = w_prime_joules;
  }

  /** Reset state for new ride */
  reset(w_prime_joules?: number): void {
    this.hrHistory = [];
    if (w_prime_joules !== undefined) this.wPrimeTotal = w_prime_joules;
    this.wPrimeBalance = this.wPrimeTotal;
    this.lastTickTs = 0;
    this.timeBelowCpMs = 0;
    this.ircState = 'idle';
    this.lastIrc = -1;
  }

  /** Called every 1s with current state */
  tick(input: PhysiologyInput): PhysiologyOutput {
    const now = Date.now();
    const dt = this.lastTickTs > 0 ? (now - this.lastTickTs) / 1000 : 1;
    this.lastTickTs = now;

    const flags: PhysiologyFlag[] = [];

    // Record HR history
    if (input.hr_bpm > 0) {
      this.hrHistory.push({
        ts: now, hr: input.hr_bpm, power: input.P_human,
        gradient: input.gradient_pct, speed: input.speed_kmh,
      });
      // Trim to 10 min window
      const cutoff = now - this.HR_HISTORY_WINDOW_MS;
      while (this.hrHistory.length > 0 && this.hrHistory[0]!.ts < cutoff) {
        this.hrHistory.shift();
      }
    }

    // ── Zone tracking ──
    const zone_current = this.getCurrentZone(input.hr_bpm, input.zones);
    const margin_bpm = this.getMarginToCeiling(input.hr_bpm, zone_current, input.zones);

    // ── Cardiac Drift ──
    const drift_bpm_per_min = this.computeDrift(now);
    if (drift_bpm_per_min > 0.3) {
      flags.push('cardiovascular_fatigue_emerging');
    }

    // ── Zone breach projection ──
    let t_breach_minutes = Infinity;
    if (drift_bpm_per_min > 0 && margin_bpm > 0) {
      t_breach_minutes = margin_bpm / drift_bpm_per_min;
    }
    if (t_breach_minutes < 8) {
      flags.push('zone_breach_imminent');
    }

    // ── W' Balance (Skiba) ──
    this.updateWPrime(input.P_human, input.cp_watts, input.tau_seconds, dt);
    const w_prime_balance = this.wPrimeBalance / this.wPrimeTotal;
    let w_prime_state: PhysiologyOutput['w_prime_state'] = 'green';
    if (w_prime_balance < 0.30) {
      w_prime_state = 'critical';
      flags.push('w_prime_critical');
    } else if (w_prime_balance < 0.70) {
      w_prime_state = 'amber';
    }

    // ── Efficiency Factor ──
    const ef_current = input.hr_bpm > 40 ? input.P_human / input.hr_bpm : 0;
    const ef_degraded = this.efBaseline > 0 && ef_current < this.efBaseline * 0.85;
    if (ef_degraded) flags.push('functional_efficiency_degraded');

    // Update EF baseline (rolling)
    if (ef_current > 0 && input.P_human > input.cp_watts * 0.5) {
      this.efSampleCount++;
      this.efBaseline += (ef_current - this.efBaseline) / Math.min(this.efSampleCount, 100);
    }

    // ── Cardiac Recovery Index ──
    const irc = this.updateIRC(input.hr_bpm, input.P_human, input.cp_watts, now);
    const residual_fatigue = irc >= 0 && irc < 0.6;
    if (residual_fatigue) flags.push('residual_fatigue_significant');

    // ── hrModifier for Layer 1 ──
    const target = input.target_zone;
    let hrModifier = 1.0;
    if (input.hr_bpm <= 0) {
      hrModifier = 1.0; // no HR data, neutral
    } else if (t_breach_minutes < 8) {
      hrModifier = 0.6; // pre-emptive protection
    } else if (zone_current > target) {
      hrModifier = 0.7; // reduce load urgently
    } else if (zone_current < target) {
      hrModifier = 1.1; // can push motor more
    }
    // else zone_current === target → 1.0

    return {
      hrModifier,
      zone_current, margin_bpm,
      drift_bpm_per_min, t_breach_minutes,
      w_prime_balance, w_prime_state,
      ef_current, ef_degraded,
      irc, residual_fatigue,
      flags,
    };
  }

  /** Inject EF baseline from previous rides */
  setEfBaseline(baseline: number, sampleCount: number): void {
    this.efBaseline = baseline;
    this.efSampleCount = sampleCount;
  }

  /** Inject IRC reference from previous rides */
  setIrcReference(dropBpm: number): void {
    this.ircReferenceDropBpm = dropBpm;
  }

  /**
   * Gap #24: IRC auto-calibration.
   * Called internally each time an IRC measurement completes (after 60s recovery window).
   * Uses median of last 20 observed drops as the reference (robust to outliers).
   */
  private calibrateIRC(observedDrop: number): void {
    if (observedDrop <= 0) return; // ignore non-recovery events

    this.ircSamples.push(observedDrop);
    if (this.ircSamples.length > 20) this.ircSamples.shift(); // keep last 20

    if (this.ircSamples.length < 3) return; // need at least 3 samples

    // Use median (robust to outliers)
    const sorted = [...this.ircSamples].sort((a, b) => a - b);
    const newRef = sorted[Math.floor(sorted.length / 2)]!;

    if (Math.abs(newRef - this.ircReferenceDropBpm) > 1) {
      console.log(`[Physiology] IRC reference calibrated to ${newRef} bpm (was ${this.ircReferenceDropBpm}, ${this.ircSamples.length} samples)`);
      this.ircReferenceDropBpm = newRef;
      this.onIrcCalibrated?.(newRef);
    }
  }

  /** Get current IRC reference (for persistence in rider profile) */
  getIrcReference(): number {
    return this.ircReferenceDropBpm;
  }

  /** Update W' total and tau from calibration */
  calibrate(w_prime_joules: number, _tau_seconds: number): void {
    const ratio = this.wPrimeBalance / this.wPrimeTotal;
    this.wPrimeTotal = w_prime_joules;
    this.wPrimeBalance = ratio * w_prime_joules; // preserve relative balance
  }

  getWPrimeBalance(): number { return this.wPrimeBalance; }
  getWPrimeTotal(): number { return this.wPrimeTotal; }
  getEfBaseline(): number { return this.efBaseline; }

  // ── Private methods ──────────────────────────────────────────

  private getCurrentZone(hr: number, zones: HRZone[]): number {
    if (hr <= 0 || zones.length === 0) return 0;
    for (let i = zones.length - 1; i >= 0; i--) {
      if (hr >= zones[i]!.min_bpm) return i + 1;
    }
    return 1;
  }

  private getMarginToCeiling(hr: number, zone: number, zones: HRZone[]): number {
    if (zone <= 0 || zone > zones.length) return 999;
    return zones[zone - 1]!.max_bpm - hr;
  }

  /**
   * Cardiac drift: compare HR now vs HR 10 min ago at similar effort.
   * Returns bpm/min. Positive = drift (fatigue).
   */
  private computeDrift(now: number): number {
    if (this.hrHistory.length < 120) return 0; // need at least 2 min of data

    // Find sample ~10 min ago
    const target_ts = now - 10 * 60 * 1000;
    let oldSample = this.hrHistory[0]!;
    for (const s of this.hrHistory) {
      if (s.ts >= target_ts) break;
      oldSample = s;
    }

    const elapsed_min = (now - oldSample.ts) / 60_000;
    if (elapsed_min < 2) return 0;

    // Check if effort is roughly constant (gradient and speed similar)
    const recent = this.hrHistory.slice(-30); // last 30s
    const avgGradientNow = recent.reduce((s, r) => s + r.gradient, 0) / recent.length;
    const avgSpeedNow = recent.reduce((s, r) => s + r.speed, 0) / recent.length;

    const gradientDiff = Math.abs(avgGradientNow - oldSample.gradient);
    const speedDiff = Math.abs(avgSpeedNow - oldSample.speed);

    // Only measure drift at roughly constant effort
    if (gradientDiff > 3 || speedDiff > 5) return 0;

    const currentHr = recent.reduce((s, r) => s + r.hr, 0) / recent.length;
    const hrDelta = currentHr - oldSample.hr;

    return hrDelta / elapsed_min;
  }

  /**
   * W' Balance — Skiba differential model with dead zone.
   * Above CP+margin: deplete. Below CP: recover exponentially.
   * Dead zone (CP to CP+5%) prevents false drain from noise around CP boundary.
   */
  private updateWPrime(P_human: number, cp: number, tau: number, dt: number): void {
    const deadZone = cp * 0.05; // 5% of CP — filter noise around threshold
    if (P_human > cp + deadZone) {
      // Depletion — only count excess above the dead zone
      const drain = (P_human - cp - deadZone) * dt;
      this.wPrimeBalance = Math.max(0, this.wPrimeBalance - drain);
      this.timeBelowCpMs = 0;
    } else if (P_human <= cp) {
      // Recovery: W'_recovered = (W'_total - W'_bal) × (1 - e^(-dt/τ))
      this.timeBelowCpMs += dt * 1000;
      const recovery = (this.wPrimeTotal - this.wPrimeBalance) * (1 - Math.exp(-dt / tau));
      this.wPrimeBalance = Math.min(this.wPrimeTotal, this.wPrimeBalance + recovery);
    }
    // In dead zone (CP < P_human <= CP+5%): neither drain nor recover
  }

  /**
   * Cardiac Recovery Index — measured during low-effort segments.
   * Tracks HR drop in first 60s after transitioning to easy effort.
   */
  private updateIRC(hr: number, P_human: number, cp: number, now: number): number {
    if (hr <= 0) return this.lastIrc;

    const isLowEffort = P_human < cp * 0.4;

    if (this.ircState === 'idle' && isLowEffort && this.hrHistory.length > 60) {
      // Check if we just transitioned from high effort
      const recentHigh = this.hrHistory.slice(-65, -5);
      const wasHighEffort = recentHigh.length > 0 &&
        recentHigh.some(s => s.power > cp * 0.7);
      if (wasHighEffort) {
        this.ircState = 'recovering';
        this.ircStartHr = hr;
        this.ircStartTs = now;
      }
    }

    if (this.ircState === 'recovering') {
      const elapsed_s = (now - this.ircStartTs) / 1000;
      if (elapsed_s >= 60) {
        // Measure drop
        const drop = this.ircStartHr - hr;
        this.lastIrc = Math.max(0, Math.min(1, drop / this.ircReferenceDropBpm));
        this.ircState = 'idle';
        // Gap #24: auto-calibrate IRC reference from successful measurements
        this.calibrateIRC(drop);
      } else if (!isLowEffort) {
        // Effort resumed, cancel IRC measurement
        this.ircState = 'idle';
      }
    }

    return this.lastIrc;
  }
}

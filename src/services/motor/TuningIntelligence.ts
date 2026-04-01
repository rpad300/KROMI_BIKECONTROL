/**
 * TuningIntelligence — the brain of KROMI dynamic assist.
 *
 * Combines all available inputs into a single 0-100 score:
 *   > 65 → level 1 (MAX assist)
 *   35-65 → level 2 (MID assist)
 *   < 35 → level 3 (MIN assist)
 *
 * Only runs when bike is in POWER mode.
 *
 * Inputs:
 * - Terrain gradient (%) — from Google Elevation API
 * - Battery SOC (%) — from motor telemetry
 * - Speed (km/h) — from motor sensor
 * - Cadence (RPM) — from CSC or power meter
 * - Rider power (W) — from power meter
 * - Pre-emptive terrain — climb/descent detected ahead
 *
 * Each factor has clear, understandable logic. No magic numbers.
 */

export interface TuningInput {
  gradient: number;         // Current gradient % (positive = uphill)
  speed: number;            // km/h
  cadence: number;          // RPM (0 = not pedaling)
  riderPower: number;       // watts from power meter
  batterySoc: number;       // 0-100%
  // Pre-emptive (optional)
  upcomingGradient: number | null;  // gradient ahead (300m lookahead)
  distanceToChange: number | null;  // meters until terrain changes
}

export interface TuningDecision {
  score: number;            // 0-100 raw score
  level: 1 | 2 | 3;        // final tuning level
  factors: TuningFactor[];  // breakdown for UI transparency
  preemptive: string | null; // pre-emptive alert text
}

export interface TuningFactor {
  name: string;
  value: number;       // contribution to score
  detail: string;      // human-readable explanation
}

// === Scoring constants ===

const LEVEL_THRESHOLDS = { max: 65, mid: 35 } as const;

// Smoothing: need N consecutive same-level decisions to actually change
const SMOOTHING_WINDOW = 3;

class TuningIntelligence {
  private static instance: TuningIntelligence;
  private levelHistory: (1 | 2 | 3)[] = [];
  private currentLevel: 1 | 2 | 3 = 2;
  private lastDecision: TuningDecision | null = null;

  static getInstance(): TuningIntelligence {
    if (!TuningIntelligence.instance) {
      TuningIntelligence.instance = new TuningIntelligence();
    }
    return TuningIntelligence.instance;
  }

  /**
   * Main decision function — called every 2s by useMotorControl.
   * Returns null if no change needed.
   */
  evaluate(input: TuningInput): TuningDecision {
    const factors: TuningFactor[] = [];

    // === 1. TERRAIN (primary signal, 0-100) ===
    const terrainScore = this.scoreGradient(input.gradient);
    factors.push({
      name: 'Terreno',
      value: terrainScore,
      detail: this.describeGradient(input.gradient),
    });

    // === 2. BATTERY (multiplier 0.4-1.0) ===
    const batteryMult = this.scoreBattery(input.batterySoc);
    factors.push({
      name: 'Bateria',
      value: Math.round((batteryMult - 1) * 100),
      detail: this.describeBattery(input.batterySoc, batteryMult),
    });

    // === 3. SPEED (modifier -20 to +25) ===
    const speedMod = this.scoreSpeed(input.speed, input.gradient);
    if (speedMod !== 0) {
      factors.push({
        name: 'Velocidade',
        value: speedMod,
        detail: this.describeSpeed(input.speed, input.gradient),
      });
    }

    // === 4. CADENCE (modifier -10 to +20) ===
    const cadenceMod = this.scoreCadence(input.cadence, input.gradient);
    if (cadenceMod !== 0) {
      factors.push({
        name: 'Cadência',
        value: cadenceMod,
        detail: this.describeCadence(input.cadence),
      });
    }

    // === 5. RIDER POWER (modifier -15 to +10) ===
    const powerMod = this.scoreRiderPower(input.riderPower);
    if (powerMod !== 0) {
      factors.push({
        name: 'Potência',
        value: powerMod,
        detail: this.describeRiderPower(input.riderPower),
      });
    }

    // === 6. PRE-EMPTIVE (modifier 0 to +20) ===
    let preemptive: string | null = null;
    let preemptiveMod = 0;
    if (input.upcomingGradient !== null && input.distanceToChange !== null) {
      const result = this.scorePreemptive(
        input.gradient, input.upcomingGradient, input.distanceToChange, input.speed
      );
      preemptiveMod = result.mod;
      preemptive = result.alert;
      if (preemptiveMod !== 0) {
        factors.push({
          name: 'Antecipação',
          value: preemptiveMod,
          detail: preemptive ?? '',
        });
      }
    }

    // === COMBINE ===
    const rawScore = terrainScore * batteryMult + speedMod + cadenceMod + powerMod + preemptiveMod;
    const score = Math.max(0, Math.min(100, Math.round(rawScore)));

    // Score → Level
    const targetLevel: 1 | 2 | 3 =
      score > LEVEL_THRESHOLDS.max ? 1 :
      score > LEVEL_THRESHOLDS.mid ? 2 : 3;

    // Smoothing: only change if stable for N samples
    this.levelHistory.push(targetLevel);
    if (this.levelHistory.length > SMOOTHING_WINDOW) {
      this.levelHistory.shift();
    }

    const stableLevel = this.getStableLevel();
    const level = stableLevel ?? this.currentLevel;

    if (stableLevel !== null) {
      this.currentLevel = stableLevel;
    }

    this.lastDecision = { score, level, factors, preemptive };
    return this.lastDecision;
  }

  getLastDecision(): TuningDecision | null {
    return this.lastDecision;
  }

  getCurrentLevel(): 1 | 2 | 3 {
    return this.currentLevel;
  }

  reset(): void {
    this.levelHistory = [];
    this.currentLevel = 2;
    this.lastDecision = null;
  }

  // ── Gradient scoring ──────────────────────────

  private scoreGradient(gradient: number): number {
    if (gradient > 12) return 100;  // steep climb
    if (gradient > 8) return 85;    // hard climb
    if (gradient > 5) return 70;    // moderate climb
    if (gradient > 3) return 55;    // gentle climb
    if (gradient > 1) return 40;    // slight incline
    if (gradient > -2) return 25;   // flat-ish
    if (gradient > -5) return 10;   // gentle descent
    return 0;                       // descent — no assist needed
  }

  private describeGradient(g: number): string {
    if (g > 12) return `Subida forte ${g.toFixed(0)}%`;
    if (g > 8) return `Subida dura ${g.toFixed(0)}%`;
    if (g > 5) return `Subida moderada ${g.toFixed(0)}%`;
    if (g > 3) return `Subida suave ${g.toFixed(0)}%`;
    if (g > 1) return `Ligeira inclinação ${g.toFixed(0)}%`;
    if (g > -2) return `Plano`;
    if (g > -5) return `Descida suave ${g.toFixed(0)}%`;
    return `Descida ${g.toFixed(0)}%`;
  }

  // ── Battery scoring ───────────────────────────

  private scoreBattery(soc: number): number {
    if (soc > 60) return 1.0;
    if (soc > 30) return 0.7 + (soc - 30) / 100;  // 0.7-1.0
    if (soc > 15) return 0.5 + (soc - 15) / 75;   // 0.5-0.7
    return 0.4;                                      // emergency
  }

  private describeBattery(soc: number, mult: number): string {
    if (soc > 60) return `${soc}% — normal`;
    if (soc > 30) return `${soc}% — conservar (×${mult.toFixed(1)})`;
    if (soc > 15) return `${soc}% — economia (×${mult.toFixed(1)})`;
    return `${soc}% — emergência!`;
  }

  // ── Speed scoring ─────────────────────────────

  private scoreSpeed(speed: number, gradient: number): number {
    if (speed > 25) return -20;                // fast enough, reduce
    if (speed < 5 && gradient > 5) return 25;  // struggling on steep climb
    if (speed < 10 && gradient > 3) return 15; // slow on climb
    if (speed < 3) return -10;                 // basically stopped, save battery
    return 0;
  }

  private describeSpeed(speed: number, gradient: number): string {
    if (speed > 25) return `${speed.toFixed(0)}km/h — rápido, reduzir`;
    if (speed < 5 && gradient > 5) return `${speed.toFixed(0)}km/h — lento em subida`;
    if (speed < 10 && gradient > 3) return `${speed.toFixed(0)}km/h — esforço em subida`;
    if (speed < 3) return `Quase parado`;
    return `${speed.toFixed(0)}km/h`;
  }

  // ── Cadence scoring ───────────────────────────

  private scoreCadence(cadence: number, gradient: number): number {
    if (cadence === 0) return 0;                      // not pedaling
    if (cadence > 90) return -10;                     // spinning free
    if (cadence < 40 && gradient > 3) return 20;      // grinding on climb
    if (cadence < 60) return 10;                      // below optimal
    return 0;                                          // 60-90 optimal
  }

  private describeCadence(cadence: number): string {
    if (cadence === 0) return 'Sem pedalar';
    if (cadence > 90) return `${cadence}rpm — spinning`;
    if (cadence < 40) return `${cadence}rpm — grinding`;
    if (cadence < 60) return `${cadence}rpm — baixa`;
    return `${cadence}rpm — óptima`;
  }

  // ── Rider power scoring ───────────────────────

  private scoreRiderPower(watts: number): number {
    if (watts > 250) return 15;   // working very hard
    if (watts > 150) return 10;   // working hard
    if (watts < 30) return -15;   // barely pedaling
    if (watts < 80) return -5;    // easy pedaling
    return 0;                     // normal effort
  }

  private describeRiderPower(watts: number): string {
    if (watts > 250) return `${watts}W — esforço máximo`;
    if (watts > 150) return `${watts}W — esforço alto`;
    if (watts < 30) return `${watts}W — pouco esforço`;
    if (watts < 80) return `${watts}W — passeio`;
    return `${watts}W — normal`;
  }

  // ── Pre-emptive scoring ───────────────────────

  private scorePreemptive(
    currentGradient: number,
    upcomingGradient: number,
    distance: number,
    speed: number,
  ): { mod: number; alert: string | null } {
    // Only pre-empt within 100m and if significant change
    if (distance > 100) return { mod: 0, alert: null };

    const delta = upcomingGradient - currentGradient;

    // Flat/descent → climb transition
    if (currentGradient < 3 && upcomingGradient > 5) {
      const timeToReach = speed > 2 ? (distance / (speed / 3.6)) : 999;
      return {
        mod: 20,
        alert: `Subida ${upcomingGradient.toFixed(0)}% em ${Math.round(distance)}m (~${Math.round(timeToReach)}s)`,
      };
    }

    // Climb → descent transition
    if (currentGradient > 3 && upcomingGradient < -2) {
      return {
        mod: -15,
        alert: `Descida em ${Math.round(distance)}m — reduzir`,
      };
    }

    // Significant gradient increase
    if (delta > 5 && upcomingGradient > 8) {
      return {
        mod: 15,
        alert: `Gradient sobe para ${upcomingGradient.toFixed(0)}% em ${Math.round(distance)}m`,
      };
    }

    return { mod: 0, alert: null };
  }

  // ── Smoothing ─────────────────────────────────

  private getStableLevel(): (1 | 2 | 3) | null {
    if (this.levelHistory.length < SMOOTHING_WINDOW) return null;
    const window = this.levelHistory.slice(-SMOOTHING_WINDOW);
    const allSame = window.every((l) => l === window[0]);
    return allSame ? window[0]! : null;
  }
}

export const tuningIntelligence = TuningIntelligence.getInstance();

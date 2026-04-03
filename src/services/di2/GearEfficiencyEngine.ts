import type { TransitionEvent } from '../../types/elevation.types';
import { useSettingsStore, safeBikeConfig, type BikeConfig } from '../../store/settingsStore';

// ── Default XT M8100 12v ratios (fallback when BikeConfig has no sprockets) ──
const DEFAULT_SPROCKETS = [51, 45, 39, 34, 30, 26, 23, 20, 17, 15, 13, 10];
const DEFAULT_CHAINRING = 34;

export interface GearAdvisory {
  target_gear: number;
  current_gear: number;
  gears_to_drop: number;
  distance_m: number;
  gradient_pct: number;
  urgency: 'urgent' | 'advisory';
}

export interface GearEffort {
  /** Gear ratio (chainring/sprocket) — lower = easier */
  ratio: number;
  /** Theoretical cadence at current speed and gear */
  theoreticalCadence: number;
  /** Effort score 0-100: 0=very easy (spinning), 100=grinding hard */
  effortScore: number;
  /** How much assist should adjust: negative=reduce, positive=increase */
  assistAdjustment: number;
  /** Human-readable reason */
  reason: string;
}

class GearEfficiencyEngine {
  private static instance: GearEfficiencyEngine;

  static getInstance(): GearEfficiencyEngine {
    if (!GearEfficiencyEngine.instance) {
      GearEfficiencyEngine.instance = new GearEfficiencyEngine();
    }
    return GearEfficiencyEngine.instance;
  }

  // ── Get real gear ratios from BikeConfig ──────────────────
  private getConfig(): { sprockets: number[]; chainring: number; wheelCircumM: number; speeds: number } {
    const bike = safeBikeConfig(useSettingsStore.getState().bikeConfig);
    const chainringTeeth = this.parseChainring(bike);
    const sprockets = this.parseSprockets(bike);
    const wheelCircumM = (bike.wheel_circumference_mm || 2290) / 1000;
    return { sprockets, chainring: chainringTeeth, wheelCircumM, speeds: sprockets.length };
  }

  private parseChainring(bike: BikeConfig): number {
    // Try to get from chainring_teeth string: "34T" or "50/34T"
    const ct = bike.chainring_teeth;
    if (ct) {
      const match = ct.match(/(\d+)T?$/i); // last number (smallest ring for MTB 1x)
      if (match) return parseInt(match[1]!);
      const nums = ct.match(/\d+/g);
      if (nums && nums.length > 0) return parseInt(nums[nums.length - 1]!);
    }
    return DEFAULT_CHAINRING;
  }

  private parseSprockets(bike: BikeConfig): number[] {
    // Priority 1: exact sprocket teeth from config (best accuracy)
    if (bike.cassette_sprockets?.length >= 2) {
      // Sort descending (gear 1 = biggest sprocket = easiest)
      return [...bike.cassette_sprockets].sort((a, b) => b - a);
    }

    // Priority 2: generate from cassette_range string
    const cr = bike.cassette_range;
    const speeds = bike.cassette_speeds || 12;
    if (cr) {
      const match = cr.match(/(\d+)-(\d+)/);
      if (match) {
        const smallest = parseInt(match[1]!);
        const largest = parseInt(match[2]!);
        return this.generateSprockets(smallest, largest, speeds);
      }
    }

    // Priority 3: fallback defaults
    return DEFAULT_SPROCKETS.slice(0, speeds);
  }

  /** Generate approximate sprocket teeth from range (logarithmic spacing like real cassettes) */
  private generateSprockets(smallest: number, largest: number, speeds: number): number[] {
    if (speeds <= 1) return [largest];
    const result: number[] = [];
    const logSmall = Math.log(smallest);
    const logLarge = Math.log(largest);
    for (let i = 0; i < speeds; i++) {
      const t = i / (speeds - 1);
      const teeth = Math.round(Math.exp(logSmall + t * (logLarge - logSmall)));
      result.push(teeth);
    }
    // Sort descending (gear 1 = biggest sprocket = easiest)
    result.sort((a, b) => b - a);
    // Deduplicate
    return [...new Set(result)];
  }

  /** Get gear ratio for a specific gear number (1-based, 1=easiest) */
  getRatio(gear: number): number {
    const { sprockets, chainring } = this.getConfig();
    const idx = gear - 1;
    if (idx < 0 || idx >= sprockets.length) return 1;
    return chainring / sprockets[idx]!;
  }

  /** Get all gear ratios as array */
  getAllRatios(): { gear: number; ratio: number; sprocket: number; chainring: number }[] {
    const { sprockets, chainring } = this.getConfig();
    return sprockets.map((s, i) => ({
      gear: i + 1,
      ratio: chainring / s,
      sprocket: s,
      chainring,
    }));
  }

  /** Optimal gear for speed + target cadence (uses real bike config) */
  getOptimalGear(speedKmh: number, targetCadence: number = 80): number {
    const { sprockets, chainring, wheelCircumM } = this.getConfig();
    const speedMs = speedKmh / 3.6;
    const wheelRpm = (speedMs / wheelCircumM) * 60;

    let bestGear = Math.ceil(sprockets.length / 2);
    let bestDiff = Infinity;

    sprockets.forEach((sprocket, idx) => {
      const ratio = chainring / sprocket;
      const cadence = wheelRpm / ratio;
      const diff = Math.abs(cadence - targetCadence);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestGear = idx + 1;
      }
    });

    return bestGear;
  }

  /** Get cadence at current speed and gear */
  getCadenceAtGear(speedKmh: number, gear: number): number {
    const { sprockets, chainring, wheelCircumM } = this.getConfig();
    const idx = gear - 1;
    if (idx < 0 || idx >= sprockets.length) return 0;
    const ratio = chainring / sprockets[idx]!;
    const speedMs = speedKmh / 3.6;
    const wheelRpm = (speedMs / wheelCircumM) * 60;
    return Math.round(wheelRpm / ratio);
  }

  /** Pre-shift advisory: warn before reaching a climb */
  getPreClimbAdvisory(
    nextTransition: TransitionEvent | null,
    currentGear: number,
    speedKmh: number,
  ): GearAdvisory | null {
    if (!nextTransition) return null;
    if (nextTransition.type !== 'flat_to_climb' && nextTransition.type !== 'descent_to_climb') return null;
    if (nextTransition.distance_m > 150) return null;

    const optimal = this.getOptimalGear(speedKmh);
    if (optimal >= currentGear) return null;

    return {
      target_gear: optimal,
      current_gear: currentGear,
      gears_to_drop: currentGear - optimal,
      distance_m: nextTransition.distance_m,
      gradient_pct: nextTransition.gradient_after_pct,
      urgency: nextTransition.distance_m < 50 ? 'urgent' : 'advisory',
    };
  }

  // ═══════════════════════════════════════════════════════════
  // GEAR EFFORT ASSESSMENT — the core intelligence for motor
  // ═══════════════════════════════════════════════════════════

  /**
   * Assess rider effort based on gear ratio + cadence + HR + gradient.
   * Returns an assist adjustment (-20 to +15) for TuningIntelligence.
   *
   * Logic:
   * - Light gear + high cadence + low HR = easy spinning → reduce assist
   * - Heavy gear + low cadence + rising HR = grinding → increase assist
   * - Cadence in sweet spot (70-90) + HR in zone = efficient → no change
   * - Near speed limit + light gear = don't waste motor on spinning
   */
  assessEffort(
    currentGear: number,
    cadenceRpm: number,
    speedKmh: number,
    hrBpm: number,
    hrZoneMax: number,
    gradientPct: number,
  ): GearEffort {
    if (currentGear <= 0 || cadenceRpm <= 0) {
      return { ratio: 0, theoreticalCadence: 0, effortScore: 50, assistAdjustment: 0, reason: 'Sem dados de gear/cadência' };
    }

    const { speeds } = this.getConfig();
    const ratio = this.getRatio(currentGear);
    const theoreticalCadence = this.getCadenceAtGear(speedKmh, currentGear);

    // ── Gear position score (where in the cassette range) ──
    // 0% = easiest gear, 100% = hardest gear
    const gearPosition = speeds > 1 ? (currentGear - 1) / (speeds - 1) : 0.5;

    // ── Cadence efficiency score ──
    // Sweet spot: 70-90 RPM = neutral
    // Below 55: grinding (high torque per stroke)
    // Above 100: spinning (wasting energy on leg speed)
    let cadenceScore = 50; // neutral
    if (cadenceRpm < 55) cadenceScore = 80 + (55 - cadenceRpm); // grinding = high effort
    else if (cadenceRpm < 70) cadenceScore = 60 + (70 - cadenceRpm); // below sweet spot
    else if (cadenceRpm <= 90) cadenceScore = 40 + (cadenceRpm - 70) * 0.5; // sweet spot
    else if (cadenceRpm <= 100) cadenceScore = 30; // slightly spinning
    else cadenceScore = Math.max(10, 30 - (cadenceRpm - 100) * 0.5); // spinning fast = easy

    // ── Combine into effort score ──
    // Heavy gear (high position) + low cadence = high effort
    // Light gear (low position) + high cadence = low effort
    const effortScore = Math.round(
      gearPosition * 40 +          // gear weight: 0-40
      cadenceScore * 0.4 +         // cadence weight: 0-40
      (gradientPct > 0 ? Math.min(20, gradientPct * 2) : 0), // gradient: 0-20
    );

    // ── Assist adjustment decision ──
    let assistAdjustment = 0;
    let reason = '';

    // CASE 1: Easy spinning — light gear + high cadence + low HR
    const hrLow = hrBpm > 0 && hrBpm < hrZoneMax * 0.75;
    const spinning = cadenceRpm > 90 && gearPosition < 0.4;
    if (spinning && hrLow) {
      assistAdjustment = -15;
      reason = `Gear ${currentGear}/${speeds} leve + ${cadenceRpm}rpm + HR ${hrBpm}bpm baixo — motor pode poupar`;
    }
    // CASE 2: Moderate spinning — light gear + decent cadence
    else if (cadenceRpm > 85 && gearPosition < 0.3 && gradientPct < 3) {
      assistAdjustment = -10;
      reason = `Gear leve (${currentGear}/${speeds}) em plano/suave — cadência ${cadenceRpm}rpm alta`;
    }
    // CASE 3: Grinding hard — heavy gear + low cadence on climb
    else if (cadenceRpm < 55 && gearPosition > 0.5 && gradientPct > 3) {
      assistAdjustment = 12;
      reason = `Gear ${currentGear}/${speeds} pesada + ${cadenceRpm}rpm baixa em ${gradientPct}% — a moer`;
    }
    // CASE 4: Cadence dropping + heavy gear = fatigue onset
    else if (cadenceRpm < 65 && gearPosition > 0.6 && gradientPct > 5) {
      assistAdjustment = 8;
      reason = `Gear pesada (${currentGear}/${speeds}) + cadência a cair em subida ${gradientPct}%`;
    }
    // CASE 5: Efficient riding — in sweet spot, matching gear to terrain
    else if (cadenceRpm >= 70 && cadenceRpm <= 90) {
      assistAdjustment = 0;
      reason = `Eficiente: gear ${currentGear}/${speeds}, ${cadenceRpm}rpm sweet spot`;
    }
    // CASE 6: Light gear on flat = coasting / recovery
    else if (gearPosition < 0.25 && gradientPct < 2 && cadenceRpm > 60) {
      assistAdjustment = -8;
      reason = `Gear muito leve (${currentGear}/${speeds}) em plano — recuperação`;
    }
    else {
      reason = `Gear ${currentGear}/${speeds}, ratio ${ratio.toFixed(2)}, ${cadenceRpm}rpm`;
    }

    return {
      ratio,
      theoreticalCadence,
      effortScore: Math.max(0, Math.min(100, effortScore)),
      assistAdjustment: Math.max(-20, Math.min(15, assistAdjustment)),
      reason,
    };
  }
}

export const gearEfficiencyEngine = GearEfficiencyEngine.getInstance();

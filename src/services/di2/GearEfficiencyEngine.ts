import type { TransitionEvent } from '../../types/elevation.types';

// XT M8100 12v cassette 10-51T with 36T chainring
const GEAR_RATIOS: Record<number, number> = {
  1: 36 / 51, 2: 36 / 45, 3: 36 / 39, 4: 36 / 34, 5: 36 / 30, 6: 36 / 26,
  7: 36 / 23, 8: 36 / 20, 9: 36 / 17, 10: 36 / 15, 11: 36 / 13, 12: 36 / 10,
};

const WHEEL_CIRCUM_M = 2.290;

export interface GearAdvisory {
  target_gear: number;
  current_gear: number;
  gears_to_drop: number;
  distance_m: number;
  gradient_pct: number;
  urgency: 'urgent' | 'advisory';
}

class GearEfficiencyEngine {
  private static instance: GearEfficiencyEngine;

  static getInstance(): GearEfficiencyEngine {
    if (!GearEfficiencyEngine.instance) {
      GearEfficiencyEngine.instance = new GearEfficiencyEngine();
    }
    return GearEfficiencyEngine.instance;
  }

  /** Optimal gear for gradient + speed + target cadence */
  getOptimalGear(speedKmh: number, targetCadence: number = 80): number {
    const speedMs = speedKmh / 3.6;
    const wheelRpm = (speedMs / WHEEL_CIRCUM_M) * 60;

    let bestGear = 6;
    let bestDiff = Infinity;

    for (const [gearStr, ratio] of Object.entries(GEAR_RATIOS)) {
      const cadence = wheelRpm / ratio;
      const diff = Math.abs(cadence - targetCadence);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestGear = parseInt(gearStr);
      }
    }

    return bestGear;
  }

  /** Pre-shift advisory: warn before reaching a climb */
  getPreClimbAdvisory(
    nextTransition: TransitionEvent | null,
    currentGear: number,
    speedKmh: number
  ): GearAdvisory | null {
    if (!nextTransition) return null;
    if (nextTransition.type !== 'flat_to_climb' && nextTransition.type !== 'descent_to_climb') return null;
    if (nextTransition.distance_m > 150) return null;

    const optimal = this.getOptimalGear(speedKmh);
    if (optimal >= currentGear) return null; // Already in low enough gear

    return {
      target_gear: optimal,
      current_gear: currentGear,
      gears_to_drop: currentGear - optimal,
      distance_m: nextTransition.distance_m,
      gradient_pct: nextTransition.gradient_after_pct,
      urgency: nextTransition.distance_m < 50 ? 'urgent' : 'advisory',
    };
  }

  /** Get cadence at current speed and gear */
  getCadenceAtGear(speedKmh: number, gear: number): number {
    const ratio = GEAR_RATIOS[gear];
    if (!ratio) return 0;
    const speedMs = speedKmh / 3.6;
    const wheelRpm = (speedMs / WHEEL_CIRCUM_M) * 60;
    return Math.round(wheelRpm / ratio);
  }
}

export const gearEfficiencyEngine = GearEfficiencyEngine.getInstance();

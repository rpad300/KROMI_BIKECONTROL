import type { TerrainAnalysis } from '../../types/elevation.types';

export enum ClimbType {
  SHORT_STEEP = 'short_steep',
  SHORT_MODERATE = 'short_mod',
  LONG_STEEP = 'long_steep',
  LONG_MODERATE = 'long_mod',
  PUNCHY = 'punchy',
  ROLLING = 'rolling',
  FLAT = 'flat',
  DESCENT = 'descent',
}

export interface TorqueCommand {
  torque_nm: number;      // 0-85
  support_pct: number;    // 0-360
  launch_value: number;   // 0-10
  climb_type: ClimbType;
  reason: string;
}

interface TorqueProfile {
  torque_nm: number;
  support_pct: number;
  launch_value: number;
}

const TORQUE_PROFILES: Record<ClimbType, TorqueProfile> = {
  [ClimbType.SHORT_STEEP]:    { torque_nm: 82, support_pct: 320, launch_value: 9 },
  [ClimbType.SHORT_MODERATE]: { torque_nm: 65, support_pct: 220, launch_value: 6 },
  [ClimbType.PUNCHY]:         { torque_nm: 78, support_pct: 290, launch_value: 8 },
  [ClimbType.LONG_STEEP]:     { torque_nm: 65, support_pct: 240, launch_value: 4 },
  [ClimbType.LONG_MODERATE]:  { torque_nm: 45, support_pct: 160, launch_value: 3 },
  [ClimbType.ROLLING]:        { torque_nm: 55, support_pct: 200, launch_value: 5 },
  [ClimbType.FLAT]:           { torque_nm: 25, support_pct: 80,  launch_value: 2 },
  [ClimbType.DESCENT]:        { torque_nm: 0,  support_pct: 0,   launch_value: 0 },
};

const CLIMB_NAMES: Record<ClimbType, string> = {
  [ClimbType.SHORT_STEEP]:    'rampa curta ingreme',
  [ClimbType.SHORT_MODERATE]: 'rampa curta moderada',
  [ClimbType.PUNCHY]:         'subida explosiva',
  [ClimbType.LONG_STEEP]:     'subida longa ingreme',
  [ClimbType.LONG_MODERATE]:  'subida longa suave',
  [ClimbType.ROLLING]:        'terreno variado',
  [ClimbType.FLAT]:           'plano',
  [ClimbType.DESCENT]:        'descida',
};

class TorqueEngine {
  private static instance: TorqueEngine;
  private currentTorque = 55;
  private currentSupport = 200;
  private currentLaunch = 5;
  private lastUpdateMs = 0;
  private readonly UPDATE_INTERVAL_MS = 2000;
  private globalMultiplier = 1.0;

  static getInstance(): TorqueEngine {
    if (!TorqueEngine.instance) {
      TorqueEngine.instance = new TorqueEngine();
    }
    return TorqueEngine.instance;
  }

  setGlobalMultiplier(m: number): void { this.globalMultiplier = m; }

  calculateOptimalTorque(
    terrain: TerrainAnalysis,
    hrZone: number,
    hrTrend: 'rising' | 'falling' | 'stable',
    currentGear: number,
    batteryPct: number,
  ): TorqueCommand | null {
    const now = Date.now();
    if (now - this.lastUpdateMs < this.UPDATE_INTERVAL_MS) return null;

    // 1. Classify climb type
    const climbType = this.classifyClimb(terrain.current_gradient_pct, 300);

    // 2. Base profile
    const base = TORQUE_PROFILES[climbType];
    let torque = base.torque_nm;
    let support = base.support_pct;
    let launch = base.launch_value;

    // 3. HR adjustment
    if (hrZone >= 4) {
      support = Math.min(support * 1.25, 360);
      torque = Math.min(torque * 1.15, 85);
    } else if (hrZone <= 2 && hrZone > 0) {
      support = Math.max(support * 0.7, 40);
      torque = Math.max(torque * 0.75, 20);
    }
    if (hrTrend === 'rising' && hrZone >= 3) {
      support = Math.min(support * 1.15, 360);
    }

    // 4. Gear adjustment (protect chain in low gears)
    if (currentGear > 0 && currentGear <= 2) {
      torque = Math.min(torque, 55);
      launch = Math.min(launch, 4);
    }
    if (currentGear >= 10 && terrain.current_gradient_pct > 4) {
      support = Math.min(support * 1.2, 360);
    }

    // 5. Battery scaling
    if (batteryPct < 30) {
      const scale = 0.7 + (batteryPct / 30) * 0.3;
      torque *= scale;
      support *= scale;
    }
    if (batteryPct < 15) {
      torque = Math.min(torque, 35);
      support = Math.min(support, 120);
    }

    // 6. Global multiplier (from athlete form score)
    torque *= this.globalMultiplier;
    support *= this.globalMultiplier;

    // 7. Smoothing
    torque = this.smooth(this.currentTorque, torque, 0.3);
    support = this.smooth(this.currentSupport, support, 0.3);
    launch = this.smooth(this.currentLaunch, launch, 0.4);

    // 8. Skip if insignificant change
    if (Math.abs(torque - this.currentTorque) < 3 && Math.abs(support - this.currentSupport) < 10) {
      return null;
    }

    this.currentTorque = torque;
    this.currentSupport = support;
    this.currentLaunch = launch;
    this.lastUpdateMs = now;

    let reason = CLIMB_NAMES[climbType];
    if (hrZone >= 4) reason += ' + FC elevada';
    if (batteryPct < 30) reason += ' + economia';

    return {
      torque_nm: Math.round(torque),
      support_pct: Math.round(support),
      launch_value: Math.round(launch),
      climb_type: climbType,
      reason,
    };
  }

  private classifyClimb(gradientPct: number, lengthM: number): ClimbType {
    if (gradientPct < -3) return ClimbType.DESCENT;
    if (gradientPct < 2) return ClimbType.FLAT;
    if (gradientPct >= 9) {
      return lengthM < 150 ? ClimbType.SHORT_STEEP : lengthM < 400 ? ClimbType.PUNCHY : ClimbType.LONG_STEEP;
    }
    if (gradientPct >= 4) {
      return lengthM < 150 ? ClimbType.SHORT_MODERATE : lengthM < 400 ? ClimbType.ROLLING : ClimbType.LONG_MODERATE;
    }
    return lengthM > 400 ? ClimbType.LONG_MODERATE : ClimbType.ROLLING;
  }

  private smooth(current: number, target: number, factor: number): number {
    return current + (target - current) * factor;
  }

  getCurrentValues() {
    return { torque_nm: Math.round(this.currentTorque), support_pct: Math.round(this.currentSupport), launch_value: Math.round(this.currentLaunch) };
  }
}

export const torqueEngine = TorqueEngine.getInstance();

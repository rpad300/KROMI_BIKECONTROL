/**
 * TuningIntelligence — HR-zone regulated motor calibration.
 *
 * PRIMARY GOAL: maintain rider in their chosen HR zone.
 *   HR above target → increase motor assist (help the rider)
 *   HR within target → maintain current assist
 *   HR below target → decrease assist (save battery, rider can do more)
 *
 * SECONDARY: terrain anticipation
 *   Climb detected ahead → pre-boost to prevent HR spike
 *   Descent detected → pre-reduce to save battery
 *
 * TERTIARY: battery conservation
 *   Low SOC → progressively limit max assist
 *
 * The motor acts as a HR zone REGULATOR, not a terrain reactor.
 */

import { useSettingsStore, safeBikeConfig } from '../../store/settingsStore';
import { getTargetZone } from '../../types/athlete.types';

export interface TuningInput {
  gradient: number;
  speed: number;
  cadence: number;
  riderPower: number;
  batterySoc: number;
  hr: number;
  altitude: number;
  upcomingGradient: number | null;
  distanceToChange: number | null;
}

export interface TuningFactor {
  name: string;
  value: number;
  detail: string;
}

export interface TuningDecision {
  intensity: number;
  supportIntensity: number;
  torqueIntensity: number;
  launchIntensity: number;
  calibration: import('../../types/tuning.types').AsmoCalibration;
  actual: { support: number; torque: number; midTorque: number; lowTorque: number; launch: number };
  factors: TuningFactor[];
  preemptive: string | null;
}

import { type AsmoCalibration, type AsmoWire, DU7_TABLES, resolveCalibration } from '../../types/tuning.types';

const SMOOTHING_WINDOW = 3;

function intensityToWire(intensity: number): AsmoWire {
  return intensity > 65 ? 0 : intensity > 35 ? 1 : 2;
}

class TuningIntelligence {
  private static instance: TuningIntelligence;
  private history: AsmoCalibration[] = [];
  private current: AsmoCalibration = { support: 1, torque: 1, midTorque: 1, lowTorque: 1, launch: 1 };
  private lastDecision: TuningDecision | null = null;

  static getInstance(): TuningIntelligence {
    if (!TuningIntelligence.instance) {
      TuningIntelligence.instance = new TuningIntelligence();
    }
    return TuningIntelligence.instance;
  }

  evaluate(input: TuningInput): TuningDecision {
    const rider = useSettingsStore.getState().riderProfile;
    const bike = safeBikeConfig(useSettingsStore.getState().bikeConfig);
    const factors: TuningFactor[] = [];
    const totalWh = bike.main_battery_wh + (bike.has_range_extender ? bike.sub_battery_wh : 0);
    const targetZone = getTargetZone(rider);

    // ═══════════════════════════════════════════════
    // PRIMARY: HR Zone Regulation (0-100 base score)
    // ═══════════════════════════════════════════════
    let hrScore = 50; // neutral when no HR data
    let hrDetail = 'Sem sensor HR';

    if (input.hr > 0 && rider.hr_max > 0) {
      const deviation = input.hr - targetZone.max_bpm;
      // Above target zone → increase assist (positive score = more motor)
      // Below target zone → decrease assist (negative score = less motor)
      // Within target → moderate assist (around 50)

      if (input.hr > targetZone.max_bpm) {
        // HR TOO HIGH — motor needs to help more
        // +5 per bpm above target, capped at 100
        hrScore = Math.min(100, 50 + deviation * 5);
        hrDetail = `${input.hr}bpm — acima de ${targetZone.name} (${targetZone.max_bpm}), +assist`;
      } else if (input.hr < targetZone.min_bpm) {
        // HR TOO LOW — rider can do more, reduce motor
        const below = targetZone.min_bpm - input.hr;
        hrScore = Math.max(0, 50 - below * 3);
        hrDetail = `${input.hr}bpm — abaixo de ${targetZone.name} (${targetZone.min_bpm}), -assist`;
      } else {
        // IN TARGET — maintain current level
        // Position within zone: lower half → slight reduce, upper half → slight increase
        const zoneRange = targetZone.max_bpm - targetZone.min_bpm;
        const posInZone = (input.hr - targetZone.min_bpm) / zoneRange;
        hrScore = 35 + Math.round(posInZone * 30); // 35-65 within zone
        hrDetail = `${input.hr}bpm — dentro de ${targetZone.name} ✓`;
      }
    }

    factors.push({ name: 'FC Zona', value: Math.round(hrScore - 50), detail: hrDetail });

    // ═══════════════════════════════════════════════
    // SECONDARY: Terrain Anticipation (modifier -20 to +30)
    // ═══════════════════════════════════════════════
    // Terrain doesn't drive the score — it ANTICIPATES HR changes
    let terrainMod = 0;
    let preemptive: string | null = null;

    // Current gradient: mild influence (HR is primary)
    if (input.gradient > 8) terrainMod = 15;       // steep → HR will rise, pre-boost
    else if (input.gradient > 5) terrainMod = 10;
    else if (input.gradient > 3) terrainMod = 5;
    else if (input.gradient < -5) terrainMod = -10; // descent → HR will drop, pre-reduce

    // Weight factor on climbs
    if (input.gradient > 3 && rider.weight_kg > 0) {
      terrainMod = Math.round(terrainMod * (0.8 + 0.2 * (rider.weight_kg / 75)));
    }

    // Pre-emptive: terrain change ahead
    if (input.upcomingGradient !== null && input.distanceToChange !== null && input.distanceToChange < 100) {
      if (input.gradient < 3 && input.upcomingGradient > 5) {
        terrainMod += 20; // climb ahead → pre-boost before HR spikes
        const t = input.speed > 2 ? Math.round(input.distanceToChange / (input.speed / 3.6)) : 999;
        preemptive = `Subida ${input.upcomingGradient.toFixed(0)}% em ${Math.round(input.distanceToChange)}m (~${t}s) — pre-boost`;
      } else if (input.gradient > 3 && input.upcomingGradient < -2) {
        terrainMod -= 15;
        preemptive = `Descida em ${Math.round(input.distanceToChange)}m — reduzir`;
      }
    }

    if (terrainMod !== 0) {
      factors.push({ name: 'Terreno', value: terrainMod, detail: this.descGradient(input.gradient) });
    }

    // ═══════════════════════════════════════════════
    // TERTIARY: Battery Conservation (multiplier 0.4-1.0)
    // ═══════════════════════════════════════════════
    const batteryMult = this.scoreBattery(input.batterySoc, totalWh);
    if (batteryMult < 1) {
      factors.push({ name: 'Bateria', value: Math.round((batteryMult - 1) * 100), detail: `${input.batterySoc}% — conservar (×${batteryMult.toFixed(2)})` });
    }

    // ═══════════════════════════════════════════════
    // AUXILIARY: Speed limit, cadence, altitude
    // ═══════════════════════════════════════════════
    let auxMod = 0;

    // Speed limit
    if (input.speed > bike.speed_limit_kmh - 2) { auxMod -= 25; factors.push({ name: 'Velocidade', value: -25, detail: `${input.speed.toFixed(0)}km/h — limite motor` }); }
    else if (input.speed > bike.speed_limit_kmh - 5) { auxMod -= 10; }
    // Stopped
    if (input.speed < 2) { auxMod -= 20; }

    // Altitude
    if (input.altitude > 1500) {
      const altBoost = Math.min(10, Math.round((input.altitude - 1500) / 250));
      auxMod += altBoost;
    }

    // ═══════════════════════════════════════════════
    // COMBINE: HR base + terrain anticipation + battery + aux
    // ═══════════════════════════════════════════════
    const rawIntensity = (hrScore + terrainMod) * batteryMult + auxMod;
    const overallIntensity = Math.max(0, Math.min(100, Math.round(rawIntensity)));

    // ═══════════════════════════════════════════════
    // PER-PARAMETER INTENSITIES
    // ═══════════════════════════════════════════════
    // Support: follows overall (main HR regulator)
    const supportI = overallIntensity;

    // Torque: similar but capped on technical terrain (prevent wheel spin)
    let torqueI = overallIntensity;
    if (input.cadence > 0 && input.cadence < 50 && input.gradient > 8) {
      torqueI = Math.min(torqueI, 55); // cap torque, keep support
    }

    // Launch: lower baseline, spikes on starts and steep transitions
    let launchI = overallIntensity * 0.7;
    if (input.speed < 5 && input.gradient > 3) launchI += 25;
    if (input.speed > 20) launchI -= 15;
    launchI = Math.max(0, Math.min(100, Math.round(launchI * batteryMult)));

    // Map to wire values
    const target: AsmoCalibration = {
      support: intensityToWire(supportI),
      torque: intensityToWire(torqueI),
      midTorque: intensityToWire(Math.max(0, torqueI - 10)),
      lowTorque: intensityToWire(Math.max(0, torqueI - 20)),
      launch: intensityToWire(launchI),
    };

    // Smoothing
    this.history.push(target);
    if (this.history.length > SMOOTHING_WINDOW) this.history.shift();
    const stable = this.getStable();
    if (stable) this.current = stable;

    const actual = resolveCalibration(this.current, DU7_TABLES);

    // Target zone info
    factors.push({ name: 'Alvo', value: 0, detail: `${targetZone.name} (${targetZone.min_bpm}-${targetZone.max_bpm}bpm)` });
    factors.push({ name: 'Motor', value: 0, detail: `S${actual.support}% T${actual.torque} M${actual.midTorque} L${actual.lowTorque} R${actual.launch}` });

    this.lastDecision = {
      intensity: overallIntensity,
      supportIntensity: supportI,
      torqueIntensity: torqueI,
      launchIntensity: Math.round(launchI),
      calibration: { ...this.current },
      actual,
      factors,
      preemptive,
    };
    return this.lastDecision;
  }

  getLastDecision(): TuningDecision | null { return this.lastDecision; }
  getCurrentCalibration(): AsmoCalibration { return { ...this.current }; }
  reset(): void { this.history = []; this.current = { support: 1, torque: 1, midTorque: 1, lowTorque: 1, launch: 1 }; this.lastDecision = null; }

  private scoreBattery(soc: number, totalWh: number): number {
    const f = Math.min(totalWh / 1050, 1.2);
    return soc > 60 ? 1.0 : soc > 30 * f ? 0.7 + (soc - 30 * f) / (60 - 30 * f) * 0.3 : soc > 15 * f ? 0.5 + (soc - 15 * f) / (15 * f) * 0.2 : 0.4;
  }

  private descGradient(g: number): string {
    return g > 12 ? `Forte ${g.toFixed(0)}%` : g > 8 ? `Dura ${g.toFixed(0)}%` :
      g > 5 ? `Moderada ${g.toFixed(0)}%` : g > 3 ? `Suave ${g.toFixed(0)}%` :
      g > -2 ? 'Plano' : `Descida ${g.toFixed(0)}%`;
  }

  private getStable(): AsmoCalibration | null {
    if (this.history.length < SMOOTHING_WINDOW) return null;
    const w = this.history.slice(-SMOOTHING_WINDOW);
    const first = w[0]!;
    return w.every((c) =>
      c.support === first.support && c.torque === first.torque &&
      c.midTorque === first.midTorque && c.lowTorque === first.lowTorque &&
      c.launch === first.launch
    ) ? first : null;
  }
}

export const tuningIntelligence = TuningIntelligence.getInstance();

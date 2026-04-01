/**
 * TuningIntelligence — continuous 5-ASMO motor calibration.
 *
 * Independently controls each motor parameter based on riding conditions:
 *   ASMO1 Support % — how much the motor multiplies rider input
 *   ASMO2 Torque    — high-range torque response
 *   ASMO3 Mid torque — mid-range torque
 *   ASMO4 Low torque — low-range torque
 *   ASMO5 Launch    — initial response aggressiveness
 *
 * Each parameter gets a 0-100 intensity score, mapped to wire 0/1/2.
 * Different parameters respond differently to the same conditions:
 *   - Steep climb: max support + max torque + max launch
 *   - Technical climb: max support + LOW torque (prevent spin) + high launch
 *   - Flat cruising: min everything (save battery)
 *   - Near speed limit: reduce support (motor cuts at 25km/h anyway)
 */

import { useSettingsStore, safeBikeConfig } from '../../store/settingsStore';
import { type AsmoCalibration, type AsmoWire, DU7_TABLES, resolveCalibration } from '../../types/tuning.types';

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
  /** Continuous overall intensity 0-100% */
  intensity: number;
  /** Per-parameter intensity (0-100) */
  supportIntensity: number;
  torqueIntensity: number;
  launchIntensity: number;
  /** Wire values sent to motor */
  calibration: AsmoCalibration;
  /** Resolved actual values from DU7 tables */
  actual: { support: number; torque: number; midTorque: number; lowTorque: number; launch: number };
  /** Factor breakdown */
  factors: TuningFactor[];
  /** Pre-emptive alert */
  preemptive: string | null;
}

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
    const hrMax = rider.hr_max > 0 ? rider.hr_max : (220 - rider.age);
    const weightFactor = rider.weight_kg / 75;

    // === BASE SCORES (shared) ===
    const terrainBase = this.scoreTerrain(input.gradient);
    const batteryMult = this.scoreBattery(input.batterySoc, totalWh);
    const hrMod = this.scoreHR(input.hr, hrMax);
    const cadMod = this.scoreCadence(input.cadence, input.gradient);
    const pwrMod = this.scorePower(input.riderPower, rider.weight_kg);
    const altMod = input.altitude > 1500 ? Math.min(10, Math.round((input.altitude - 1500) / 250)) : 0;

    let preemptive: string | null = null;
    let preMod = 0;
    if (input.upcomingGradient !== null && input.distanceToChange !== null && input.distanceToChange < 100) {
      if (input.gradient < 3 && input.upcomingGradient > 5) {
        preMod = 20;
        const t = input.speed > 2 ? Math.round(input.distanceToChange / (input.speed / 3.6)) : 999;
        preemptive = `Subida ${input.upcomingGradient.toFixed(0)}% em ${Math.round(input.distanceToChange)}m (~${t}s)`;
      } else if (input.gradient > 3 && input.upcomingGradient < -2) {
        preMod = -15;
        preemptive = `Descida em ${Math.round(input.distanceToChange)}m`;
      }
    }

    // === SUPPORT % (ASMO1) ===
    // Responds most to: gradient, weight, speed limit, battery
    let supportI = terrainBase * weightFactor * batteryMult + hrMod + preMod;
    // Near speed limit: reduce support (motor cuts off anyway)
    if (input.speed > bike.speed_limit_kmh - 3) supportI -= 30;
    else if (input.speed > bike.speed_limit_kmh - 6) supportI -= 15;
    supportI = Math.max(0, Math.min(100, Math.round(supportI)));

    // === TORQUE (ASMO2 high + ASMO3 mid + ASMO4 low) ===
    // Responds to: gradient, cadence (low = more torque), power effort
    let torqueI = terrainBase * batteryMult + cadMod + pwrMod + altMod;
    // Technical terrain: LOW cadence + steep = need torque but controlled
    if (input.cadence > 0 && input.cadence < 50 && input.gradient > 8) {
      torqueI = Math.min(torqueI, 60); // cap torque to prevent wheel spin
    }
    torqueI = Math.max(0, Math.min(100, Math.round(torqueI)));

    // === LAUNCH (ASMO5) ===
    // Responds to: gradient (steep = aggressive launch), speed (slow = need boost)
    let launchI = terrainBase * 0.7 + preMod;
    if (input.speed < 5 && input.gradient > 3) launchI += 25; // stopped on climb = aggressive launch
    if (input.speed > 20) launchI -= 20; // already moving = less launch
    launchI = Math.max(0, Math.min(100, Math.round(launchI * batteryMult)));

    // === MAP TO WIRE VALUES ===
    const target: AsmoCalibration = {
      support: intensityToWire(supportI),
      torque: intensityToWire(torqueI),
      midTorque: intensityToWire(Math.max(0, torqueI - 10)), // slightly less than main torque
      lowTorque: intensityToWire(Math.max(0, torqueI - 20)), // even less
      launch: intensityToWire(launchI),
    };

    // Smoothing
    this.history.push(target);
    if (this.history.length > SMOOTHING_WINDOW) this.history.shift();
    const stable = this.getStable();
    if (stable) this.current = stable;

    const actual = resolveCalibration(this.current, DU7_TABLES);
    const intensity = Math.round((supportI + torqueI + launchI) / 3);

    // Factors
    factors.push({ name: 'Terreno', value: Math.round(terrainBase), detail: this.descGradient(input.gradient, rider.weight_kg) });
    if (batteryMult < 1) factors.push({ name: 'Bateria', value: Math.round((batteryMult - 1) * 100), detail: `${input.batterySoc}% — ×${batteryMult.toFixed(2)}` });
    if (hrMod !== 0) factors.push({ name: 'FC', value: hrMod, detail: `${input.hr}bpm (${hrMax > 0 ? Math.round(input.hr / hrMax * 100) : '?'}%max)` });
    if (cadMod !== 0) factors.push({ name: 'Cadência', value: cadMod, detail: `${input.cadence}rpm` });
    if (pwrMod !== 0) factors.push({ name: 'W/kg', value: pwrMod, detail: `${input.riderPower}W (${(input.riderPower / rider.weight_kg).toFixed(1)}W/kg)` });
    if (preMod !== 0) factors.push({ name: 'Antecipação', value: preMod, detail: preemptive ?? '' });
    factors.push({ name: 'Calibração', value: 0, detail: `S${actual.support}% T${actual.torque} M${actual.midTorque} L${actual.lowTorque} R${actual.launch}` });

    this.lastDecision = {
      intensity,
      supportIntensity: supportI,
      torqueIntensity: torqueI,
      launchIntensity: launchI,
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

  // ── Scoring ───────────────────────────────────

  private scoreTerrain(g: number): number {
    return g > 12 ? 100 : g > 8 ? 85 : g > 5 ? 70 : g > 3 ? 55 : g > 1 ? 40 : g > -2 ? 25 : g > -5 ? 10 : 0;
  }
  private scoreBattery(soc: number, totalWh: number): number {
    const f = Math.min(totalWh / 1050, 1.2);
    return soc > 60 ? 1.0 : soc > 30 * f ? 0.7 + (soc - 30 * f) / (60 - 30 * f) * 0.3 : soc > 15 * f ? 0.5 + (soc - 15 * f) / (15 * f) * 0.2 : 0.4;
  }
  private scoreHR(hr: number, max: number): number {
    if (hr <= 0 || max <= 0) return 0;
    const p = hr / max;
    return p > 0.92 ? 20 : p > 0.85 ? 15 : p > 0.75 ? 5 : p < 0.55 ? -10 : 0;
  }
  private scoreCadence(c: number, g: number): number {
    return c <= 0 ? 0 : c > 90 ? -10 : c < 40 && g > 3 ? 20 : c < 60 ? 10 : 0;
  }
  private scorePower(w: number, kg: number): number {
    if (w <= 0 || kg <= 0) return 0;
    const wkg = w / kg;
    return wkg > 3.5 ? 15 : wkg > 2.5 ? 10 : wkg < 0.5 ? -15 : wkg < 1.0 ? -5 : 0;
  }
  private descGradient(g: number, w: number): string {
    const wn = w > 85 ? ' (pesado)' : w < 65 ? ' (leve)' : '';
    return g > 12 ? `Forte ${g.toFixed(0)}%${wn}` : g > 8 ? `Dura ${g.toFixed(0)}%${wn}` :
      g > 5 ? `Moderada ${g.toFixed(0)}%${wn}` : g > 3 ? `Suave ${g.toFixed(0)}%${wn}` :
      g > -2 ? 'Plano' : `Descida ${g.toFixed(0)}%`;
  }

  private getStable(): AsmoCalibration | null {
    if (this.history.length < SMOOTHING_WINDOW) return null;
    const w = this.history.slice(-SMOOTHING_WINDOW);
    const first = w[0]!;
    const allSame = w.every((c) =>
      c.support === first.support && c.torque === first.torque &&
      c.midTorque === first.midTorque && c.lowTorque === first.lowTorque &&
      c.launch === first.launch
    );
    return allSame ? first : null;
  }
}

export const tuningIntelligence = TuningIntelligence.getInstance();

/**
 * TuningIntelligence — continuous motor calibration engine.
 *
 * NOT a "level picker". Continuously calculates optimal motor intensity
 * (0-100%) from all inputs, then maps to the closest wire value the
 * motor accepts via SET_TUNING.
 *
 * Wire values: 0 (max power) → 1 → 2 (min power)
 * Value 3 untested (may be ultra-min or default).
 *
 * The motor's internal response (assist%, torque, launch) is determined
 * by the wire value. We estimate those characteristics in bikeConfig
 * for battery/range calculations.
 *
 * Inputs: terrain, battery, speed, HR, cadence, power, altitude, rider profile, bike specs
 */

import { useSettingsStore } from '../../store/settingsStore';

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

export interface TuningDecision {
  /** Continuous intensity 0-100% (the real calculation) */
  intensity: number;
  /** Wire value sent to motor via SET_TUNING (0=max, 1=mid, 2=min) */
  wireValue: 0 | 1 | 2;
  /** Display label for UI */
  label: 'MAX' | 'MID' | 'MIN';
  /** Factor breakdown */
  factors: TuningFactor[];
  /** Pre-emptive alert */
  preemptive: string | null;
  /** Motor specs at current wire value */
  motorAssistPct: number;
  motorTorqueNm: number;
  motorLaunch: number;
  motorConsumptionWhKm: number;
}

export interface TuningFactor {
  name: string;
  value: number;
  detail: string;
}

// Wire value mapping: intensity% → wire value
// 0 = max power (highest assist), 2 = min power (lowest assist)
const WIRE_THRESHOLDS = { toMax: 65, toMid: 35 } as const;

const SMOOTHING_WINDOW = 3;

class TuningIntelligence {
  private static instance: TuningIntelligence;
  private wireHistory: (0 | 1 | 2)[] = [];
  private currentWire: 0 | 1 | 2 = 1;
  private lastDecision: TuningDecision | null = null;

  static getInstance(): TuningIntelligence {
    if (!TuningIntelligence.instance) {
      TuningIntelligence.instance = new TuningIntelligence();
    }
    return TuningIntelligence.instance;
  }

  evaluate(input: TuningInput): TuningDecision {
    const rider = useSettingsStore.getState().riderProfile;
    const bike = useSettingsStore.getState().bikeConfig;
    const factors: TuningFactor[] = [];

    // === CALCULATE CONTINUOUS INTENSITY (0-100%) ===

    // 1. Terrain + weight (0-100 base)
    const terrainScore = this.scoreTerrain(input.gradient, rider.weight_kg);
    factors.push({ name: 'Terreno', value: terrainScore, detail: this.descGradient(input.gradient, rider.weight_kg) });

    // 2. Battery (multiplier 0.4-1.0)
    const totalWh = bike.main_battery_wh + (bike.has_range_extender ? bike.sub_battery_wh : 0);
    const batteryMult = this.scoreBattery(input.batterySoc, totalWh);
    if (batteryMult < 1) factors.push({ name: 'Bateria', value: Math.round((batteryMult - 1) * 100), detail: `${input.batterySoc}% (${Math.round(input.batterySoc / 100 * totalWh)}Wh) — ×${batteryMult.toFixed(2)}` });

    // 3. Speed + speed limit (-25 to +25)
    const speedMod = this.scoreSpeed(input.speed, input.gradient, bike.speed_limit_kmh);
    if (speedMod !== 0) factors.push({ name: 'Velocidade', value: speedMod, detail: this.descSpeed(input.speed, bike.speed_limit_kmh) });

    // 4. Heart rate effort (-10 to +20)
    const hrMax = rider.hr_max > 0 ? rider.hr_max : (220 - rider.age);
    const hrMod = this.scoreHR(input.hr, hrMax);
    if (hrMod !== 0) factors.push({ name: 'FC', value: hrMod, detail: this.descHR(input.hr, hrMax) });

    // 5. Cadence (-10 to +20)
    const cadMod = this.scoreCadence(input.cadence, input.gradient);
    if (cadMod !== 0) factors.push({ name: 'Cadência', value: cadMod, detail: this.descCadence(input.cadence) });

    // 6. Rider power W/kg (-15 to +15)
    const pwrMod = this.scorePower(input.riderPower, rider.weight_kg);
    if (pwrMod !== 0) factors.push({ name: 'Potência', value: pwrMod, detail: this.descPower(input.riderPower, rider.weight_kg) });

    // 7. Altitude (0 to +10)
    const altMod = input.altitude > 1500 ? Math.min(10, Math.round((input.altitude - 1500) / 250)) : 0;
    if (altMod > 0) factors.push({ name: 'Altitude', value: altMod, detail: `${Math.round(input.altitude)}m` });

    // 8. Pre-emptive (-15 to +20)
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
      if (preMod !== 0) factors.push({ name: 'Antecipação', value: preMod, detail: preemptive ?? '' });
    }

    // === CONTINUOUS INTENSITY ===
    const rawIntensity = terrainScore * batteryMult + speedMod + hrMod + cadMod + pwrMod + altMod + preMod;
    const intensity = Math.max(0, Math.min(100, Math.round(rawIntensity)));

    // === MAP TO WIRE VALUE ===
    const targetWire: 0 | 1 | 2 = intensity > WIRE_THRESHOLDS.toMax ? 0
      : intensity > WIRE_THRESHOLDS.toMid ? 1 : 2;

    // Smoothing
    this.wireHistory.push(targetWire);
    if (this.wireHistory.length > SMOOTHING_WINDOW) this.wireHistory.shift();
    const stable = this.getStableWire();
    if (stable !== null) this.currentWire = stable;

    // Motor specs at current wire value
    const spec = this.currentWire === 0 ? bike.tuning_max
      : this.currentWire === 1 ? bike.tuning_mid : bike.tuning_min;
    const label = this.currentWire === 0 ? 'MAX' : this.currentWire === 1 ? 'MID' : 'MIN';

    factors.push({ name: 'Motor', value: 0, detail: `${spec.assist_pct}% · ${spec.torque_nm}Nm · L${spec.launch} · ${spec.consumption_wh_km}Wh/km` });

    this.lastDecision = {
      intensity,
      wireValue: this.currentWire,
      label,
      factors,
      preemptive,
      motorAssistPct: spec.assist_pct,
      motorTorqueNm: spec.torque_nm,
      motorLaunch: spec.launch,
      motorConsumptionWhKm: spec.consumption_wh_km,
    };
    return this.lastDecision;
  }

  getLastDecision(): TuningDecision | null { return this.lastDecision; }
  getCurrentWireValue(): 0 | 1 | 2 { return this.currentWire; }
  reset(): void { this.wireHistory = []; this.currentWire = 1; this.lastDecision = null; }

  // ── Scoring functions ─────────────────────────

  private scoreTerrain(g: number, weight: number): number {
    let base = g > 12 ? 100 : g > 8 ? 85 : g > 5 ? 70 : g > 3 ? 55 : g > 1 ? 40 : g > -2 ? 25 : g > -5 ? 10 : 0;
    if (g > 2 && weight > 0) base = Math.min(100, Math.round(base * (0.8 + 0.2 * (weight / 75))));
    return base;
  }

  private scoreBattery(soc: number, totalWh: number): number {
    const f = Math.min(totalWh / 1050, 1.2);
    if (soc > 60) return 1.0;
    if (soc > 30 * f) return 0.7 + (soc - 30 * f) / (60 - 30 * f) * 0.3;
    if (soc > 15 * f) return 0.5 + (soc - 15 * f) / (15 * f) * 0.2;
    return 0.4;
  }

  private scoreSpeed(speed: number, gradient: number, limit: number): number {
    if (speed > limit - 2) return -25;
    if (speed > limit - 5) return -15;
    if (speed < 5 && gradient > 5) return 25;
    if (speed < 10 && gradient > 3) return 15;
    if (speed < 3) return -10;
    return 0;
  }

  private scoreHR(hr: number, hrMax: number): number {
    if (hr <= 0 || hrMax <= 0) return 0;
    const p = hr / hrMax;
    return p > 0.92 ? 20 : p > 0.85 ? 15 : p > 0.75 ? 5 : p < 0.55 ? -10 : 0;
  }

  private scoreCadence(cad: number, gradient: number): number {
    if (cad <= 0) return 0;
    return cad > 90 ? -10 : cad < 40 && gradient > 3 ? 20 : cad < 60 ? 10 : 0;
  }

  private scorePower(watts: number, weight: number): number {
    if (watts <= 0 || weight <= 0) return 0;
    const wkg = watts / weight;
    return wkg > 3.5 ? 15 : wkg > 2.5 ? 10 : wkg < 0.5 ? -15 : wkg < 1.0 ? -5 : 0;
  }

  // ── Descriptions ──────────────────────────────

  private descGradient(g: number, w: number): string {
    const wn = w > 85 ? ' (pesado)' : w < 65 ? ' (leve)' : '';
    return g > 12 ? `Forte ${g.toFixed(0)}%${wn}` : g > 8 ? `Dura ${g.toFixed(0)}%${wn}` :
      g > 5 ? `Moderada ${g.toFixed(0)}%${wn}` : g > 3 ? `Suave ${g.toFixed(0)}%${wn}` :
      g > -2 ? 'Plano' : `Descida ${g.toFixed(0)}%`;
  }

  private descSpeed(s: number, limit: number): string {
    return s > limit - 2 ? `${s.toFixed(0)}km/h — limite motor` : s < 5 ? `${s.toFixed(0)}km/h — lento` : `${s.toFixed(0)}km/h`;
  }

  private descHR(hr: number, max: number): string {
    if (hr <= 0) return '';
    const p = max > 0 ? Math.round(hr / max * 100) : 0;
    return `${hr}bpm (${p}%max)`;
  }

  private descCadence(c: number): string {
    return c > 90 ? `${c}rpm spin` : c < 40 ? `${c}rpm grind` : c < 60 ? `${c}rpm baixa` : `${c}rpm`;
  }

  private descPower(w: number, kg: number): string {
    if (w <= 0) return '';
    return `${w}W (${(w / kg).toFixed(1)}W/kg)`;
  }

  private getStableWire(): (0 | 1 | 2) | null {
    if (this.wireHistory.length < SMOOTHING_WINDOW) return null;
    const w = this.wireHistory.slice(-SMOOTHING_WINDOW);
    return w.every((v) => v === w[0]) ? w[0]! : null;
  }
}

export const tuningIntelligence = TuningIntelligence.getInstance();

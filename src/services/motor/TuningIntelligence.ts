/**
 * TuningIntelligence — personalized KROMI brain.
 *
 * Combines terrain, battery, speed, cadence, power, AND athlete/bike profiles
 * into a single 0-100 score → tuning level (MAX >65, MID 35-65, MIN <35).
 *
 * Personalization factors:
 * - Rider weight → heavier = more assist on climbs
 * - Rider HR max/age → calibrates effort zones
 * - Rider fitness trend → declining = more help
 * - Bike motor specs → scales what MAX/MID/MIN mean
 * - Bike battery → smarter economy thresholds
 * - Bike speed limit → reduce near 25km/h (motor cuts off anyway)
 */

import { useSettingsStore } from '../../store/settingsStore';

export interface TuningInput {
  gradient: number;
  speed: number;
  cadence: number;
  riderPower: number;
  batterySoc: number;
  hr: number;                       // current HR (0 if no sensor)
  altitude: number;                 // meters above sea level
  upcomingGradient: number | null;
  distanceToChange: number | null;
}

export interface TuningDecision {
  score: number;
  level: 1 | 2 | 3;
  factors: TuningFactor[];
  preemptive: string | null;
}

export interface TuningFactor {
  name: string;
  value: number;
  detail: string;
}

const LEVEL_THRESHOLDS = { max: 65, mid: 35 } as const;
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

  evaluate(input: TuningInput): TuningDecision {
    const rider = useSettingsStore.getState().riderProfile;
    const bike = useSettingsStore.getState().bikeConfig;
    const factors: TuningFactor[] = [];

    // === 1. TERRAIN + WEIGHT (0-100 base) ===
    const terrainScore = this.scoreTerrainWithWeight(input.gradient, rider.weight_kg);
    factors.push({ name: 'Terreno', value: terrainScore, detail: this.describeGradient(input.gradient, rider.weight_kg) });

    // === 2. BATTERY (multiplier 0.4-1.0) ===
    const totalWh = bike.main_battery_wh + (bike.has_range_extender ? bike.sub_battery_wh : 0);
    const batteryMult = this.scoreBattery(input.batterySoc, totalWh);
    factors.push({ name: 'Bateria', value: Math.round((batteryMult - 1) * 100), detail: this.describeBattery(input.batterySoc, totalWh) });

    // === 3. SPEED + SPEED LIMIT (modifier -25 to +25) ===
    const speedMod = this.scoreSpeed(input.speed, input.gradient, bike.speed_limit_kmh);
    if (speedMod !== 0) factors.push({ name: 'Velocidade', value: speedMod, detail: this.describeSpeed(input.speed, bike.speed_limit_kmh) });

    // === 4. HEART RATE EFFORT (modifier -10 to +20) ===
    const hrMod = this.scoreHR(input.hr, rider.hr_max, rider.age);
    if (hrMod !== 0) factors.push({ name: 'FC', value: hrMod, detail: this.describeHR(input.hr, rider.hr_max) });

    // === 5. CADENCE (modifier -10 to +20) ===
    const cadenceMod = this.scoreCadence(input.cadence, input.gradient);
    if (cadenceMod !== 0) factors.push({ name: 'Cadência', value: cadenceMod, detail: this.describeCadence(input.cadence) });

    // === 6. RIDER POWER (modifier -15 to +15) ===
    const powerMod = this.scoreRiderPower(input.riderPower, rider.weight_kg);
    if (powerMod !== 0) factors.push({ name: 'Potência', value: powerMod, detail: this.describeRiderPower(input.riderPower, rider.weight_kg) });

    // === 7. ALTITUDE (modifier 0 to +10) ===
    const altMod = this.scoreAltitude(input.altitude);
    if (altMod !== 0) factors.push({ name: 'Altitude', value: altMod, detail: `${Math.round(input.altitude)}m — menos O₂` });

    // === 8. PRE-EMPTIVE (modifier -15 to +20) ===
    let preemptive: string | null = null;
    let preemptiveMod = 0;
    if (input.upcomingGradient !== null && input.distanceToChange !== null) {
      const result = this.scorePreemptive(input.gradient, input.upcomingGradient, input.distanceToChange, input.speed);
      preemptiveMod = result.mod;
      preemptive = result.alert;
      if (preemptiveMod !== 0) factors.push({ name: 'Antecipação', value: preemptiveMod, detail: preemptive ?? '' });
    }

    // === COMBINE ===
    const rawScore = terrainScore * batteryMult + speedMod + hrMod + cadenceMod + powerMod + altMod + preemptiveMod;
    const score = Math.max(0, Math.min(100, Math.round(rawScore)));

    const targetLevel: 1 | 2 | 3 = score > LEVEL_THRESHOLDS.max ? 1 : score > LEVEL_THRESHOLDS.mid ? 2 : 3;

    this.levelHistory.push(targetLevel);
    if (this.levelHistory.length > SMOOTHING_WINDOW) this.levelHistory.shift();

    const stableLevel = this.getStableLevel();
    if (stableLevel !== null) this.currentLevel = stableLevel;

    this.lastDecision = { score, level: this.currentLevel, factors, preemptive };
    return this.lastDecision;
  }

  getLastDecision(): TuningDecision | null { return this.lastDecision; }
  getCurrentLevel(): 1 | 2 | 3 { return this.currentLevel; }
  reset(): void { this.levelHistory = []; this.currentLevel = 2; this.lastDecision = null; }

  // ── Terrain + Weight ──────────────────────────

  private scoreTerrainWithWeight(gradient: number, weight: number): number {
    // Base terrain score
    let base = 0;
    if (gradient > 12) base = 100;
    else if (gradient > 8) base = 85;
    else if (gradient > 5) base = 70;
    else if (gradient > 3) base = 55;
    else if (gradient > 1) base = 40;
    else if (gradient > -2) base = 25;
    else if (gradient > -5) base = 10;

    // Weight factor: heavier riders need more help on climbs
    // Reference: 75kg. Above = boost, below = reduce.
    if (gradient > 2 && weight > 0) {
      const weightFactor = weight / 75;
      // +10% per 10kg above 75, -10% per 10kg below
      base = Math.round(base * (0.8 + 0.2 * weightFactor));
    }

    return Math.min(100, base);
  }

  private describeGradient(g: number, weight: number): string {
    const weightNote = weight > 85 ? ' (peso elevado)' : weight < 65 ? ' (peso leve)' : '';
    if (g > 12) return `Subida forte ${g.toFixed(0)}%${weightNote}`;
    if (g > 8) return `Subida dura ${g.toFixed(0)}%${weightNote}`;
    if (g > 5) return `Moderada ${g.toFixed(0)}%${weightNote}`;
    if (g > 3) return `Suave ${g.toFixed(0)}%${weightNote}`;
    if (g > 1) return `Inclinação ${g.toFixed(0)}%`;
    if (g > -2) return 'Plano';
    return `Descida ${g.toFixed(0)}%`;
  }

  // ── Battery ───────────────────────────────────

  private scoreBattery(soc: number, totalWh: number): number {
    // Bigger battery = can be more aggressive longer
    // 1050Wh = reference. Smaller battery = start conserving earlier.
    const batteryFactor = Math.min(totalWh / 1050, 1.2);
    const conserveAt = 30 * batteryFactor; // start conserving at ~30% for 1050Wh
    const emergencyAt = 15 * batteryFactor;

    if (soc > 60) return 1.0;
    if (soc > conserveAt) return 0.7 + (soc - conserveAt) / (60 - conserveAt) * 0.3;
    if (soc > emergencyAt) return 0.5 + (soc - emergencyAt) / (conserveAt - emergencyAt) * 0.2;
    return 0.4;
  }

  private describeBattery(soc: number, totalWh: number): string {
    const whRemaining = Math.round(soc / 100 * totalWh);
    if (soc > 60) return `${soc}% (${whRemaining}Wh) — normal`;
    if (soc > 30) return `${soc}% (${whRemaining}Wh) — conservar`;
    if (soc > 15) return `${soc}% (${whRemaining}Wh) — economia`;
    return `${soc}% (${whRemaining}Wh) — emergência!`;
  }

  // ── Speed + Speed Limit ───────────────────────

  private scoreSpeed(speed: number, gradient: number, speedLimit: number): number {
    // Near speed limit: motor cuts off anyway, reduce assist
    if (speed > speedLimit - 2) return -25;
    if (speed > speedLimit - 5) return -15;
    if (speed > 25) return -20;
    if (speed < 5 && gradient > 5) return 25;
    if (speed < 10 && gradient > 3) return 15;
    if (speed < 3) return -10;
    return 0;
  }

  private describeSpeed(speed: number, speedLimit: number): string {
    if (speed > speedLimit - 2) return `${speed.toFixed(0)}km/h — limite motor (${speedLimit})`;
    if (speed > 25) return `${speed.toFixed(0)}km/h — rápido`;
    if (speed < 5) return `${speed.toFixed(0)}km/h — lento em subida`;
    return `${speed.toFixed(0)}km/h`;
  }

  // ── Heart Rate ────────────────────────────────

  private scoreHR(hr: number, hrMax: number, age: number): number {
    if (hr <= 0) return 0;
    // Use observed HR max, or estimate from age
    const effectiveMax = hrMax > 0 ? hrMax : (220 - age);
    const pct = hr / effectiveMax;

    if (pct > 0.92) return 20;   // near max — serious help needed
    if (pct > 0.85) return 15;   // threshold — boost
    if (pct > 0.75) return 5;    // tempo — slight boost
    if (pct < 0.55) return -10;  // recovery — save battery
    return 0;                    // endurance zone — normal
  }

  private describeHR(hr: number, hrMax: number): string {
    if (hr <= 0) return 'Sem HR';
    const pct = hrMax > 0 ? Math.round(hr / hrMax * 100) : 0;
    if (pct > 92) return `${hr}bpm (${pct}% max) — máximo!`;
    if (pct > 85) return `${hr}bpm (${pct}% max) — limiar`;
    if (pct > 75) return `${hr}bpm (${pct}% max) — tempo`;
    if (pct < 55) return `${hr}bpm (${pct}% max) — recovery`;
    return `${hr}bpm (${pct}% max) — endurance`;
  }

  // ── Cadence ───────────────────────────────────

  private scoreCadence(cadence: number, gradient: number): number {
    if (cadence === 0) return 0;
    if (cadence > 90) return -10;
    if (cadence < 40 && gradient > 3) return 20;
    if (cadence < 60) return 10;
    return 0;
  }

  private describeCadence(cadence: number): string {
    if (cadence === 0) return 'Sem pedalar';
    if (cadence > 90) return `${cadence}rpm — spinning`;
    if (cadence < 40) return `${cadence}rpm — grinding`;
    if (cadence < 60) return `${cadence}rpm — baixa`;
    return `${cadence}rpm — óptima`;
  }

  // ── Rider Power (W/kg aware) ──────────────────

  private scoreRiderPower(watts: number, weight: number): number {
    if (watts <= 0) return 0;
    const wkg = weight > 0 ? watts / weight : watts / 75;
    if (wkg > 3.5) return 15;   // race effort — max help
    if (wkg > 2.5) return 10;   // hard effort
    if (wkg < 0.5) return -15;  // barely pedaling
    if (wkg < 1.0) return -5;   // easy
    return 0;
  }

  private describeRiderPower(watts: number, weight: number): string {
    if (watts <= 0) return 'Sem dados';
    const wkg = weight > 0 ? (watts / weight).toFixed(1) : '?';
    if (Number(wkg) > 3.5) return `${watts}W (${wkg}W/kg) — máximo`;
    if (Number(wkg) > 2.5) return `${watts}W (${wkg}W/kg) — forte`;
    if (Number(wkg) < 0.5) return `${watts}W (${wkg}W/kg) — pouco`;
    return `${watts}W (${wkg}W/kg)`;
  }

  // ── Altitude ──────────────────────────────────

  private scoreAltitude(altitude: number): number {
    // Above 1500m: less oxygen, more effort needed
    if (altitude > 2500) return 10;
    if (altitude > 2000) return 7;
    if (altitude > 1500) return 4;
    return 0;
  }

  // ── Pre-emptive ───────────────────────────────

  private scorePreemptive(
    currentGradient: number, upcomingGradient: number, distance: number, speed: number
  ): { mod: number; alert: string | null } {
    if (distance > 100) return { mod: 0, alert: null };

    if (currentGradient < 3 && upcomingGradient > 5) {
      const t = speed > 2 ? Math.round(distance / (speed / 3.6)) : 999;
      return { mod: 20, alert: `Subida ${upcomingGradient.toFixed(0)}% em ${Math.round(distance)}m (~${t}s)` };
    }
    if (currentGradient > 3 && upcomingGradient < -2) {
      return { mod: -15, alert: `Descida em ${Math.round(distance)}m — reduzir` };
    }
    if (upcomingGradient - currentGradient > 5 && upcomingGradient > 8) {
      return { mod: 15, alert: `Gradient sobe para ${upcomingGradient.toFixed(0)}% em ${Math.round(distance)}m` };
    }
    return { mod: 0, alert: null };
  }

  // ── Smoothing ─────────────────────────────────

  private getStableLevel(): (1 | 2 | 3) | null {
    if (this.levelHistory.length < SMOOTHING_WINDOW) return null;
    const w = this.levelHistory.slice(-SMOOTHING_WINDOW);
    return w.every((l) => l === w[0]) ? w[0]! : null;
  }
}

export const tuningIntelligence = TuningIntelligence.getInstance();

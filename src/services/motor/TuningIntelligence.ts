/**
 * TuningIntelligence — HR Zone Regulator (reviewed, bugs fixed).
 *
 * LAYERED architecture:
 *   intensity = clamp(hrTarget + anticipationBias, 0, 100) × batteryConstraint
 *
 * SMOOTHING: asymmetric, named by rider experience
 *   HR above zone → motor increases → 1 sample (urgent)
 *   HR below zone → motor decreases → 3 samples (gradual)
 *   Dwell time: 15s minimum at MID after HR-above event (prevent cycling)
 */

import { useSettingsStore, safeBikeConfig } from '../../store/settingsStore';
import { getTargetZone } from '../../types/athlete.types';
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
  intensity: number;
  supportIntensity: number;
  torqueIntensity: number;
  launchIntensity: number;
  calibration: AsmoCalibration;
  actual: { support: number; torque: number; midTorque: number; lowTorque: number; launch: number };
  factors: TuningFactor[];
  preemptive: string | null;
}

function intensityToWire(intensity: number): AsmoWire {
  // Bug 2 fix: thresholds with margin to avoid boundary flipping
  return intensity > 62 ? 0 : intensity > 38 ? 1 : 2;
}

class TuningIntelligence {
  private static instance: TuningIntelligence;
  private current: AsmoCalibration = { support: 1, torque: 1, midTorque: 1, lowTorque: 1, launch: 1 };
  private lastDecision: TuningDecision | null = null;
  private rampUpCount = 0;
  private rampDownCount = 0;
  private lastHrAboveEvent = 0;  // Lacuna 2: dwell time tracking
  private lastHrValid = 0;       // Lacuna 1: HR dropout tracking
  private cadenceHistory: number[] = [];  // Track cadence trend (last 5 samples = 10s)
  private speedHistory: number[] = [];    // Track speed trend (last 5 samples = 10s)

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
    // LAYER 1: HR Target (0-100)
    // Bug 1 fix: continuous function, no boundary jump
    // Bug 2 fix: in-zone range is 40-60 (safely within wire 1)
    // ═══════════════════════════════════════════════
    let hrTarget = 50;
    let hrDetail = 'Sem sensor HR — terreno como fallback';
    let hasHR = false;

    // Lacuna 1: HR dropout detection
    if (input.hr > 0) {
      this.lastHrValid = Date.now();
      hasHR = true;
    } else if (Date.now() - this.lastHrValid < 10_000) {
      // HR was valid <10s ago — sensor dropout, keep last behavior
      hasHR = false;
      hrDetail = 'HR sensor dropout — a usar último estado';
    }

    if (hasHR) {
      if (input.hr > targetZone.max_bpm) {
        // HR ABOVE zone — motor must help more
        const above = input.hr - targetZone.max_bpm;
        // Bug 1 fix: starts at 60 (matches top of in-zone range)
        hrTarget = Math.min(100, 60 + above * 8);
        hrDetail = `${input.hr}bpm — ${above}bpm acima de ${targetZone.name}, +assist`;
        this.lastHrAboveEvent = Date.now();
      } else if (input.hr < targetZone.min_bpm) {
        // HR BELOW zone — motor can help less
        const below = targetZone.min_bpm - input.hr;
        // Bug 1 fix: starts at 40 (matches bottom of in-zone range)
        hrTarget = Math.max(0, 40 - below * 5);
        hrDetail = `${input.hr}bpm — ${below}bpm abaixo de ${targetZone.name}, -assist`;
      } else {
        // IN TARGET ZONE — fine-tune
        // Bug 2 fix: range 40-60 (safely within wire 1 thresholds 38-62)
        const zoneRange = targetZone.max_bpm - targetZone.min_bpm;
        const posInZone = zoneRange > 0 ? (input.hr - targetZone.min_bpm) / zoneRange : 0.5;
        hrTarget = 40 + Math.round(posInZone * 20); // 40-60
        hrDetail = `${input.hr}bpm — dentro de ${targetZone.name} ✓`;
      }
    }

    // Fallback: terrain as proxy when no HR
    if (!hasHR) {
      hrTarget = this.terrainAsProxy(input.gradient, rider.weight_kg);
      if (!hrDetail.includes('dropout')) {
        hrDetail = `Sem HR — estimativa por terreno (${input.gradient > 0 ? '+' : ''}${input.gradient.toFixed(0)}%)`;
      }
    }

    factors.push({ name: 'FC Zona', value: Math.round(hrTarget - 50), detail: hrDetail });

    // ═══════════════════════════════════════════════
    // LAYER 2: Terrain Anticipation (-20 to +25)
    // Lacuna 3 note: heading variance not yet implemented
    // Lacuna 4 note: technical descent not yet covered
    // ═══════════════════════════════════════════════
    let anticipation = 0;
    let preemptive: string | null = null;

    // Sub-component 1: current gradient bias (0 to +15)
    // Even mid-climb, terrain provides anticipation of continued effort
    if (input.gradient > 8) anticipation += 15;
    else if (input.gradient > 5) anticipation += 10;
    else if (input.gradient > 3) anticipation += 5;
    else if (input.gradient < -5) anticipation -= 10;

    // Sub-component 2: transition bias from lookahead (+25 / -15)
    if (input.upcomingGradient !== null && input.distanceToChange !== null) {
      const safeLookahead = Math.min(100, input.speed > 10 ? 100 : input.speed > 5 ? 60 : 30);

      if (input.distanceToChange < safeLookahead) {
        if (input.gradient < 3 && input.upcomingGradient > 5) {
          anticipation += 25;
          const t = input.speed > 2 ? Math.round(input.distanceToChange / (input.speed / 3.6)) : 999;
          preemptive = `Subida ${input.upcomingGradient.toFixed(0)}% em ${Math.round(input.distanceToChange)}m (~${t}s)`;
        } else if (input.gradient > 3 && input.upcomingGradient < -2) {
          anticipation += -15;
          preemptive = `Descida em ${Math.round(input.distanceToChange)}m`;
        }
      }
    }

    // Sub-component 3: weight bias on steep climbs (with HR only)
    if (hasHR && input.gradient > 8 && rider.weight_kg > 75) {
      anticipation += Math.min(10, Math.round((rider.weight_kg - 75) / 10 * 3));
    }

    // Sub-component 4: power anticipation (watts = immediate effort signal)
    // Rider producing high watts NOW → HR will rise in 30-60s
    // Covers: headwind, sprint, technical passages on flat
    if (input.riderPower > 0 && rider.weight_kg > 0) {
      const wkg = input.riderPower / rider.weight_kg;
      let powerBias = 0;
      if (wkg > 3.0) powerBias = 15;       // hard effort → HR will spike
      else if (wkg > 2.0) powerBias = 8;   // moderate effort → HR rising
      else if (wkg < 0.8 && wkg > 0) powerBias = -10; // coasting → HR will drop
      if (powerBias !== 0) {
        anticipation += powerBias;
        factors.push({ name: 'Esforço', value: powerBias, detail: `${input.riderPower}W (${wkg.toFixed(1)}W/kg)` });
      }
    }

    // Sub-component 5: cadence trend (falling cadence = fatigue signal)
    // If cadence dropped >15rpm in last 10s → rider is grinding → HR will rise
    this.cadenceHistory.push(input.cadence);
    if (this.cadenceHistory.length > 5) this.cadenceHistory.shift(); // keep last 5 samples (10s)
    if (this.cadenceHistory.length >= 3 && input.cadence > 0) {
      const oldest = this.cadenceHistory[0]!;
      const cadenceDrop = oldest - input.cadence;
      if (cadenceDrop > 15 && oldest > 55) {
        anticipation += 10; // cadence falling fast → HR will spike
        factors.push({ name: 'Cadência ↓', value: 10, detail: `${oldest}→${input.cadence}rpm em ${this.cadenceHistory.length * 2}s` });
      }
    }

    // Sub-component 6: speed context (predictive, replaces binary penalty)
    // Speed + gradient predicts effort; speed trend predicts fatigue
    this.speedHistory.push(input.speed);
    if (this.speedHistory.length > 5) this.speedHistory.shift();

    // 6a: slow on climb = struggling (HR will spike)
    // Only contributes what terrainBias hasn't already captured (prevents double-counting)
    const terrainBias = anticipation; // snapshot before speed modifies it
    if (input.speed < 8 && input.speed > 2 && input.gradient > 5) {
      const climbSpeedBias = Math.max(0, 10 - terrainBias); // only adds gap
      if (climbSpeedBias > 0) {
        anticipation += climbSpeedBias;
        factors.push({ name: 'Vel+subida', value: climbSpeedBias, detail: `${input.speed.toFixed(0)}km/h em ${input.gradient.toFixed(0)}% — lento` });
      }
    }

    // 6b: speed dropping on climb = fatigue
    if (this.speedHistory.length >= 3 && input.gradient > 3) {
      const oldestSpeed = this.speedHistory[0]!;
      const speedDrop = oldestSpeed - input.speed;
      if (speedDrop > 3 && oldestSpeed > 5) {
        anticipation += 8;
        factors.push({ name: 'Vel ↓', value: 8, detail: `${oldestSpeed.toFixed(0)}→${input.speed.toFixed(0)}km/h — a perder força` });
      }
    }

    // 6c: approaching speed limit — gradual curve (replaces binary -25)
    const speedPenaltyStart = bike.speed_limit_kmh - 5; // start 5km/h before limit
    if (input.speed > speedPenaltyStart && input.speed <= bike.speed_limit_kmh) {
      const range = bike.speed_limit_kmh - speedPenaltyStart;
      const progress = (input.speed - speedPenaltyStart) / (range > 0 ? range : 1);
      const speedPenalty = -Math.round(progress * 25);
      anticipation += speedPenalty;
      if (speedPenalty < -5) {
        factors.push({ name: 'Vel→limite', value: speedPenalty, detail: `${input.speed.toFixed(0)}km/h → motor corta a ${bike.speed_limit_kmh}` });
      }
    }

    // Cap total anticipation
    anticipation = Math.max(-25, Math.min(55, anticipation));

    if (anticipation !== 0) {
      factors.push({ name: 'Antecipação', value: anticipation, detail: preemptive ?? this.descGradient(input.gradient) });
    }

    // ═══════════════════════════════════════════════
    // LAYER 3: Battery Constraint (×0.4-1.0)
    // Lacuna 5 fix: explicit linear formula
    // Lacuna 6 fix: capacity adjustment restored
    // ═══════════════════════════════════════════════
    const batteryConstraint = this.getBatteryConstraint(input.batterySoc, totalWh);
    if (batteryConstraint < 1) {
      factors.push({ name: 'Bateria', value: Math.round((batteryConstraint - 1) * 100), detail: `${input.batterySoc}% — limite ×${batteryConstraint.toFixed(2)}` });
    }

    // ═══════════════════════════════════════════════
    // COMBINE: layered
    // ═══════════════════════════════════════════════
    // Stopped: override (save battery, no pedalling)
    const stoppedPenalty = input.speed < 2 ? -20 : 0;

    // Altitude boost (less O₂ at altitude)
    const altitudeBoost = input.altitude > 1500
      ? Math.min(10, Math.round((input.altitude - 1500) / 250)) : 0;

    const rawIntensity = Math.max(0, Math.min(100,
      hrTarget + anticipation + stoppedPenalty + altitudeBoost));
    const overallIntensity = Math.round(rawIntensity * batteryConstraint);

    // ═══════════════════════════════════════════════
    // BUG 5 FIX: Per-parameter ASMO intensities (restored)
    // Support follows overall, torque has safety cap, launch independent
    // ═══════════════════════════════════════════════
    const supportI = overallIntensity;

    // TORQUE: safety cap on technical terrain (prevent wheel spin)
    let torqueI = overallIntensity;
    if (input.cadence > 0 && input.cadence < 50 && input.gradient > 8) {
      torqueI = Math.min(torqueI, 55); // cap torque, keep support high
      factors.push({ name: 'Torque cap', value: 0, detail: `Cadência ${input.cadence}rpm em ${input.gradient}% — limitar torque` });
    }

    // LAUNCH: lower baseline, spikes on starts
    let launchI = Math.round(overallIntensity * 0.7);
    if (input.speed < 5 && input.gradient > 3) launchI += 25;
    if (input.speed > 20) launchI -= 15;
    launchI = Math.max(0, Math.min(100, launchI));

    // Map to wire values — progressive torque curve restored
    const target: AsmoCalibration = {
      support: intensityToWire(supportI),
      torque: intensityToWire(torqueI),
      midTorque: intensityToWire(Math.max(0, torqueI - 10)),   // progressive: slightly less
      lowTorque: intensityToWire(Math.max(0, torqueI - 20)),   // progressive: even less
      launch: intensityToWire(launchI),
    };

    // ═══════════════════════════════════════════════
    // ASYMMETRIC SMOOTHING + DWELL TIME (Lacuna 2 fix)
    // ═══════════════════════════════════════════════
    const HR_ABOVE_ZONE_SAMPLES = 1;
    const HR_BELOW_ZONE_SAMPLES = 3;
    const NO_HR_SAMPLES = 2;
    const DWELL_TIME_MS = 15_000; // 15s minimum at current level after HR-above event

    const motorWantsMore = this.isHigherIntensity(target, this.current);
    const motorWantsLess = this.isLowerIntensity(target, this.current);

    // Lacuna 2: dwell time — after HR-above event, don't reduce for 15s
    // Dwell override: if rider stopped pedalling (cadence=0 >3s), cancel dwell
    const dwellOverride = input.cadence === 0 && input.speed < 3;
    const inDwellPeriod = !dwellOverride && (Date.now() - this.lastHrAboveEvent) < DWELL_TIME_MS;

    if (motorWantsMore) {
      this.rampUpCount++;
      this.rampDownCount = 0;
      const threshold = hasHR ? HR_ABOVE_ZONE_SAMPLES : NO_HR_SAMPLES;
      if (this.rampUpCount >= threshold) {
        this.current = target;
        this.rampUpCount = 0;
      }
    } else if (motorWantsLess) {
      if (inDwellPeriod) {
        // Don't reduce yet — prevent HR cycling
        this.rampDownCount = 0;
      } else {
        this.rampDownCount++;
        this.rampUpCount = 0;
        const threshold = hasHR ? HR_BELOW_ZONE_SAMPLES : NO_HR_SAMPLES;
        if (this.rampDownCount >= threshold) {
          this.current = target;
          this.rampDownCount = 0;
        }
      }
    } else {
      this.rampUpCount = 0;
      this.rampDownCount = 0;
    }

    const actual = resolveCalibration(this.current, DU7_TABLES);

    factors.push({ name: 'Alvo', value: 0, detail: `${targetZone.name} (${targetZone.min_bpm}-${targetZone.max_bpm}bpm)` });
    factors.push({ name: 'Motor', value: 0, detail: `S${actual.support}% T${actual.torque} M${actual.midTorque} L${actual.lowTorque} R${actual.launch}` });

    this.lastDecision = {
      intensity: overallIntensity,
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
  reset(): void {
    this.current = { support: 1, torque: 1, midTorque: 1, lowTorque: 1, launch: 1 };
    this.lastDecision = null;
    this.rampUpCount = 0;
    this.rampDownCount = 0;
    this.lastHrAboveEvent = 0;
    this.lastHrValid = 0;
    this.cadenceHistory = [];
    this.speedHistory = [];
  }

  // ── Terrain as HR proxy ───────────────────────
  private terrainAsProxy(gradient: number, weight: number): number {
    let base = gradient > 12 ? 85 : gradient > 8 ? 72 : gradient > 5 ? 60 :
      gradient > 3 ? 48 : gradient > 1 ? 38 : gradient > -2 ? 25 : 10;
    if (gradient > 2 && weight > 0) base = Math.min(100, Math.round(base * (0.8 + 0.2 * (weight / 75))));
    return base;
  }

  // ── Battery constraint (Lacuna 5+6 fix: explicit linear + capacity adj) ──
  private getBatteryConstraint(soc: number, totalWh: number): number {
    // Lacuna 6: capacity adjustment — larger battery conserves later
    const capacityFactor = Math.min(totalWh / 1050, 1.2);
    const conserveAt = 30 * capacityFactor;  // ~30% for 1050Wh, ~36% for 500Wh
    const emergencyAt = 15 * capacityFactor;

    // Lacuna 5: explicit linear interpolation
    if (soc > 60) return 1.0;
    if (soc > conserveAt) return 0.7 + ((soc - conserveAt) / (60 - conserveAt)) * 0.3;  // linear 0.7→1.0
    if (soc > emergencyAt) return 0.5 + ((soc - emergencyAt) / (conserveAt - emergencyAt)) * 0.2;  // linear 0.5→0.7
    return 0.4;
  }

  private descGradient(g: number): string {
    return g > 12 ? `Forte ${g.toFixed(0)}%` : g > 8 ? `Dura ${g.toFixed(0)}%` :
      g > 5 ? `Moderada ${g.toFixed(0)}%` : g > 3 ? `Suave ${g.toFixed(0)}%` :
      g > -2 ? 'Plano' : `Descida ${g.toFixed(0)}%`;
  }

  private isLowerIntensity(a: AsmoCalibration, b: AsmoCalibration): boolean {
    return a.support > b.support || a.torque > b.torque;
  }

  private isHigherIntensity(a: AsmoCalibration, b: AsmoCalibration): boolean {
    return a.support < b.support || a.torque < b.torque;
  }
}

export const tuningIntelligence = TuningIntelligence.getInstance();

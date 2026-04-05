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
import { useLearningStore } from '../../store/learningStore';
import { getCachedTrail } from '../maps/TerrainService';
import { getCachedWeather } from '../weather/WeatherService';
import { useBikeStore } from '../../store/bikeStore';
import { gearEfficiencyEngine } from '../di2/GearEfficiencyEngine';

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
  /** Current gear position (1=easiest, 12=hardest). 0=unknown. */
  currentGear: number;
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
    // LAYER 1: HR Target (0-100) — Continuous Regulator
    // Philosophy: motor adjusts GRADUALLY to MAINTAIN HR in zone
    //   In-zone comfortable → MIN assist (motor barely helps)
    //   In-zone top → transitioning to MID (HR rising, motor responds)
    //   Above zone → MID→MAX gradual ramp (proportional to deviation)
    //   Below zone → LOW (rider not working hard enough)
    // ═══════════════════════════════════════════════
    let hrTarget = 30;
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
        // HR ABOVE zone — motor increases proportionally to help rider
        const above = input.hr - targetZone.max_bpm;
        hrTarget = Math.min(100, 42 + above * 2);
        hrDetail = `${input.hr}bpm — ${above}bpm acima de ${targetZone.name}, +assist gradual`;
        this.lastHrAboveEvent = Date.now();
      } else if (input.hr < targetZone.min_bpm) {
        // HR BELOW zone — rider comfortable, minimal assist
        const below = targetZone.min_bpm - input.hr;
        hrTarget = Math.max(0, 20 - below * 2);
        hrDetail = `${input.hr}bpm — ${below}bpm abaixo de ${targetZone.name}, -assist`;
      } else {
        // IN TARGET ZONE — regulate: low assist at bottom, rising toward top
        const zoneRange = targetZone.max_bpm - targetZone.min_bpm;
        const posInZone = zoneRange > 0 ? (input.hr - targetZone.min_bpm) / zoneRange : 0.5;
        hrTarget = 20 + Math.round(posInZone * 22); // 20-42
        hrDetail = `${input.hr}bpm — dentro de ${targetZone.name} (${Math.round(posInZone * 100)}%)`;
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

    // Scale anticipation by rider comfort (Option B)
    // When HR is low in zone → rider is comfortable → anticipation has little effect (30%)
    // When HR is high in zone → approaching limit → anticipation has full effect (100%)
    // When HR is above zone → already urgent → anticipation at 100%
    // When HR is below zone → very comfortable → anticipation at 30%
    if (hasHR && input.hr > 0) {
      let anticipationScale = 0.3; // default: comfortable
      if (input.hr > targetZone.max_bpm) {
        anticipationScale = 1.0; // above zone: full anticipation
      } else if (input.hr >= targetZone.min_bpm) {
        // In zone: scale 0.3 → 1.0 based on position
        const zoneRange = targetZone.max_bpm - targetZone.min_bpm;
        const zonePos = zoneRange > 0 ? (input.hr - targetZone.min_bpm) / zoneRange : 0.5;
        anticipationScale = 0.3 + zonePos * 0.7;
      }
      // Below zone: stays at 0.3
      anticipation = Math.round(anticipation * anticipationScale);
    }

    // Hard cap: even with full scale, anticipation can't dominate hrTarget
    anticipation = Math.max(-20, Math.min(35, anticipation));

    if (anticipation !== 0) {
      factors.push({ name: 'Antecipação', value: anticipation, detail: preemptive ?? this.descGradient(input.gradient) });
    }

    // ═══════════════════════════════════════════════
    // LAYER 3: Battery — NO constraint in POWER/KROMI mode
    // The rider chose POWER = full KROMI control.
    // KROMI optimizes for rider needs, not battery conservation.
    // Battery management is the rider's responsibility in POWER mode.
    // ═══════════════════════════════════════════════
    const batteryConstraint = 1.0; // Always 1.0 — no battery limiting

    // ═══════════════════════════════════════════════
    // COMBINE: layered
    // ═══════════════════════════════════════════════
    // Stopped: override (save battery, no pedalling)
    const stoppedPenalty = input.speed < 2 ? -20 : 0;

    // Altitude boost (less O₂ at altitude)
    const altitudeBoost = input.altitude > 1500
      ? Math.min(10, Math.round((input.altitude - 1500) / 250)) : 0;

    // Adaptive learning: apply learned adjustment for this context
    const hrZone = hasHR && input.hr > 0
      ? (input.hr >= targetZone.max_bpm ? Math.min(5, Math.ceil(input.hr / targetZone.max_bpm * 3))
        : input.hr >= targetZone.min_bpm ? Math.round(1 + (input.hr - targetZone.min_bpm) / (targetZone.max_bpm - targetZone.min_bpm) * 2)
        : 1) : 0;
    const learnedAdj = useLearningStore.getState().getAdjustment(input.gradient, hrZone);
    if (learnedAdj !== 0) {
      factors.push({ name: 'Aprendido', value: learnedAdj, detail: `Ajuste aprendido de overrides anteriores` });
    }

    // ═══════════════════════════════════════════════
    // LAYER 4: Environment context (terrain + weather)
    // ═══════════════════════════════════════════════
    const trail = getCachedTrail();
    const weather = getCachedWeather();
    let envAdj = 0;

    // Terrain: dirt/technical = more effort needed → more assist
    if (trail) {
      if (trail.category === 'technical') { envAdj += 8; }
      else if (trail.category === 'dirt') { envAdj += 4; }
      else if (trail.category === 'gravel') { envAdj += 2; }
      // MTB scale S3+ = very technical → significant boost
      if (trail.mtb_scale !== null && trail.mtb_scale >= 3) { envAdj += 5; }
      if (envAdj > 0) {
        factors.push({ name: 'Terreno', value: envAdj, detail: `${trail.category}${trail.mtb_scale !== null ? ` S${trail.mtb_scale}` : ''} — ${trail.surface || trail.highway}` });
      }
    }

    // Weather: headwind = more effort, extreme temp = fatigue
    if (weather) {
      // Wind: compare with rider heading for head/tailwind
      const windSpeed = weather.wind_speed_kmh;
      if (windSpeed > 15) {
        // Simplified: strong wind always adds effort (proper head/tail needs heading comparison)
        const windAdj = Math.min(8, Math.round((windSpeed - 15) / 5) * 2);
        envAdj += windAdj;
        factors.push({ name: 'Vento', value: windAdj, detail: `${Math.round(windSpeed)}km/h` });
      }
      // Extreme heat: rider fatigues faster
      if (weather.temp_c > 32) {
        const heatAdj = Math.min(6, Math.round((weather.temp_c - 32) / 3) * 2);
        envAdj += heatAdj;
        factors.push({ name: 'Calor', value: heatAdj, detail: `${Math.round(weather.temp_c)}°C` });
      }
    }

    // Battery: cold temperature reduces effective capacity
    let coldBatteryMod = 1.0;
    if (weather && weather.temp_c < 5) {
      // Lithium batteries lose ~1% capacity per °C below 5°C
      coldBatteryMod = Math.max(0.7, 1 - (5 - weather.temp_c) * 0.015);
    }

    // ═══════════════════════════════════════════════
    // LAYER 5: Gear Ratio Intelligence (-20 to +15)
    // Uses real cassette sprockets + chainring from BikeConfig
    // Assesses rider effort from gear position + cadence + HR
    // ═══════════════════════════════════════════════
    let gearAdj = 0;
    if (input.currentGear > 0 && input.cadence > 0) {
      const gearEffort = gearEfficiencyEngine.assessEffort(
        input.currentGear,
        input.cadence,
        input.speed,
        input.hr,
        targetZone.max_bpm,
        input.gradient,
      );
      gearAdj = gearEffort.assistAdjustment;
      if (gearAdj !== 0) {
        factors.push({
          name: 'Gear',
          value: gearAdj,
          detail: gearEffort.reason,
        });
      }
    }

    const rawIntensity = Math.max(0, Math.min(100,
      hrTarget + anticipation + stoppedPenalty + altitudeBoost + learnedAdj + envAdj + gearAdj));
    const overallIntensity = Math.round(rawIntensity * batteryConstraint * coldBatteryMod);

    // ═══════════════════════════════════════════════
    // Per-parameter ASMO intensities
    // Support follows overall, torque adjusted by terrain, launch independent
    // ═══════════════════════════════════════════════
    const supportI = overallIntensity;

    // TORQUE: terrain-aware safety cap
    let torqueI = overallIntensity;
    const isTechnical = trail?.category === 'technical' || trail?.category === 'dirt';
    if (input.cadence > 0 && input.cadence < 50 && input.gradient > 8) {
      torqueI = Math.min(torqueI, 55);
      factors.push({ name: 'Torque cap', value: 0, detail: `Cadência ${input.cadence}rpm em ${input.gradient}% — limitar torque` });
    }
    // Technical/dirt terrain: reduce torque to prevent wheel spin
    if (isTechnical && torqueI > 50) {
      torqueI = Math.round(torqueI * 0.8);
      factors.push({ name: 'Torque terreno', value: -Math.round(overallIntensity * 0.2), detail: `${trail!.category} — torque reduzido para tração` });
    }

    // LAUNCH: lower baseline, spikes on starts, reduce on loose terrain
    let launchI = Math.round(overallIntensity * 0.7);
    if (input.speed < 5 && input.gradient > 3) launchI += 25;
    if (input.speed > 20) launchI -= 15;
    if (isTechnical) launchI = Math.round(launchI * 0.7); // gentle launch on dirt
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

  // ── Battery constraint — uses motor range data when available ──
  private getBatteryConstraint(soc: number, totalWh: number): number {
    // Use motor-reported range for smarter conservation
    const rangePerMode = useBikeStore.getState().range_per_mode;

    if (rangePerMode && rangePerMode.power > 0) {
      // Motor knows real remaining range — use POWER mode as reference
      const powerRange = rangePerMode.power;
      const ecoRange = rangePerMode.eco;

      if (powerRange > 40) return 1.0;
      if (powerRange > 20) return 0.8 + (powerRange - 20) / 20 * 0.2;
      if (powerRange > 10) return 0.6 + (powerRange - 10) / 10 * 0.2;
      if (powerRange > 5) return 0.5 + (powerRange - 5) / 5 * 0.1;
      // Under 5km in POWER — emergency
      return ecoRange > 10 ? 0.4 : 0.2;
    }

    // Fallback: SOC-based (no motor range data)
    const capacityFactor = Math.min(totalWh / 1050, 1.2);
    const conserveAt = 30 * capacityFactor;
    const emergencyAt = 15 * capacityFactor;

    if (soc > 60) return 1.0;
    if (soc > conserveAt) return 0.7 + ((soc - conserveAt) / (60 - conserveAt)) * 0.3;
    if (soc > emergencyAt) return 0.5 + ((soc - emergencyAt) / (conserveAt - emergencyAt)) * 0.2;
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

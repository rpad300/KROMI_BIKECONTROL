/**
 * KromiSimulator — personalized simulation over past rides.
 *
 * Uses the same logic as TuningIntelligence but replays over imported records.
 * Considers: rider weight/age/HR, bike motor/battery specs, terrain, speed.
 */

import { useSettingsStore, safeBikeConfig } from '../../store/settingsStore';
import { getTargetZone } from '../../types/athlete.types';
import { useLearningStore } from '../../store/learningStore';
import type { ImportedRecord } from '../import/FitImportService';

export interface SimulationPoint {
  elapsed_s: number;
  distance_km: number;
  altitude_m: number;
  gradient_pct: number;
  speed_kmh: number;
  hr_bpm: number;
  kromi_score: number;
  kromi_level: 1 | 2 | 3;
  kromi_active: boolean;
  battery_pct: number;
  consumption_wh: number;
  // Resolved ASMO values at this point
  support_pct: number;
  torque: number;
  launch: number;
  terrain_score: number;
  hr_mod: number;
  speed_mod: number;
  weight_factor: number;
}

export interface SimulationSummary {
  points: SimulationPoint[];
  time_max_pct: number;
  time_mid_pct: number;
  time_min_pct: number;
  time_active_pct: number;
  battery_start: number;
  battery_end_kromi: number;
  battery_end_fixed: number;    // fixed baseline (user's normal config)
  battery_end_max: number;      // always MAX for reference
  battery_saved_vs_fixed: number;
  battery_saved_vs_max: number;
  fixed_label: string;          // what the baseline config is
  avg_score: number;
  max_score: number;
  level_changes: number;
  // Personalization context
  rider_weight: number;
  rider_hr_max: number;
  bike_battery_wh: number;
  bike_motor: string;
}

/**
 * Physics-based motor consumption model.
 * Calculates Watts consumed by the motor based on terrain, speed, weight, and assist level.
 * Returns electrical power in Watts (multiply by dt_hours for Wh).
 */
/** Rolling resistance by surface type (Crr) */
const SURFACE_CRR: Record<string, number> = {
  paved: 0.004,      // smooth asphalt
  gravel: 0.008,     // compacted gravel
  dirt: 0.012,       // dirt/earth trail
  technical: 0.018,  // roots, rocks, loose
};

function motorConsumptionW(
  speed_kmh: number, gradient_pct: number, riderWeight_kg: number,
  support_pct: number, torque_nm: number, maxPower_w: number,
  surfaceType: string = 'gravel',
): number {
  if (speed_kmh < 2) return 0; // motor off when stopped

  const totalMass = riderWeight_kg + 25; // rider + bike (~25kg for e-MTB)
  const speedMs = speed_kmh / 3.6;
  const g = 9.81;
  const crr = SURFACE_CRR[surfaceType] ?? 0.008;

  // Forces (Newtons)
  const gradeAngle = Math.atan(gradient_pct / 100);
  const gradeForce = totalMass * g * Math.sin(gradeAngle);
  const rollingForce = totalMass * g * crr;
  const aeroForce = 0.5 * 0.5 * 0.8 * 1.225 * speedMs * speedMs; // CdA ~0.4

  // Total force needed (negative = downhill, motor not needed)
  const totalForce = Math.max(0, gradeForce + rollingForce + aeroForce);
  const totalPowerW = totalForce * speedMs;

  // Motor share: assist_pct means motor adds (assist/100) × rider input
  // So motor provides assist/(100+assist) of total
  const motorShare = support_pct / (100 + support_pct);
  let motorPowerW = totalPowerW * motorShare;

  // Cap by torque limit (torque × estimated angular velocity)
  const estCadenceRpm = speed_kmh < 10 ? 55 : speed_kmh < 20 ? 65 : 75;
  const torqueCap = torque_nm * estCadenceRpm * 2 * Math.PI / 60;
  motorPowerW = Math.min(motorPowerW, torqueCap);

  // Cap by motor max power
  motorPowerW = Math.min(motorPowerW, maxPower_w);

  // Electrical consumption (motor efficiency ~80%)
  return motorPowerW / 0.80;
}

import type { SurfaceCategory } from '../import/RouteTerrainService';
import type { HistoricalWeather } from '../import/HistoricalWeatherService';

export function simulateKromi(
  records: ImportedRecord[],
  terrainSurfaces?: SurfaceCategory[],
  weather?: HistoricalWeather,
): SimulationSummary {
  const rider = useSettingsStore.getState().riderProfile;
  const bike = safeBikeConfig(useSettingsStore.getState().bikeConfig);
  const totalWh = bike.main_battery_wh + (bike.has_range_extender ? bike.sub_battery_wh : 0);
  const hrMax = rider.hr_max > 0 ? rider.hr_max : (220 - rider.age);
  const weightFactor = rider.weight_kg / 75; // ref 75kg

  const points: SimulationPoint[] = [];
  let prevAlt: number | null = null;
  let currentLevel: 1 | 2 | 3 = 2;
  let levelChanges = 0;
  let batteryWh = totalWh;
  let batteryFixedWh = totalWh;
  let batteryMaxWh = totalWh;
  const cadenceHist: number[] = [];
  const speedHist: number[] = [];
  let scoreSum = 0;
  let maxScore = 0;
  let countMax = 0, countMid = 0, countMin = 0, countActive = 0;

  // Smoothing state — prevents oscillation, gives time for HR to react
  let smoothedScore = 30;          // EMA of score (starts at neutral)
  let lastLevelChangeElapsed = 0;  // elapsed_s of last level change
  const HOLD_TIME_S = 15;          // minimum seconds between level changes
  const EMA_ALPHA = 0.15;          // smoothing factor (lower = slower reaction)

  for (let i = 0; i < records.length; i++) {
    const r = records[i]!;
    const alt = r.altitude_m ?? 0;

    // Gradient
    let gradient = 0;
    if (prevAlt !== null && i > 0) {
      const distDelta = (r.distance_km - records[i - 1]!.distance_km) * 1000;
      if (distDelta > 1) gradient = Math.max(-30, Math.min(30, ((alt - prevAlt) / distDelta) * 100));
    }
    prevAlt = alt;

    const isActive = r.speed_kmh > 2;

    // === LAYER 1: HR Zone Target — Continuous Regulator (identical to TuningIntelligence) ===
    // In-zone comfortable → MIN assist. Top of zone → transitioning to MID.
    // Above zone → MID→MAX gradual. Below zone → minimal assist.
    const targetZone = getTargetZone(rider);
    let hrTarget = 30;
    const hasHR = r.hr_bpm > 0 && hrMax > 0;

    if (hasHR) {
      if (r.hr_bpm > targetZone.max_bpm) {
        const above = r.hr_bpm - targetZone.max_bpm;
        hrTarget = Math.min(100, 42 + above * 2);
      } else if (r.hr_bpm < targetZone.min_bpm) {
        const below = targetZone.min_bpm - r.hr_bpm;
        hrTarget = Math.max(0, 20 - below * 2);
      } else {
        const zoneRange = targetZone.max_bpm - targetZone.min_bpm;
        const posInZone = zoneRange > 0 ? (r.hr_bpm - targetZone.min_bpm) / zoneRange : 0.5;
        hrTarget = 20 + Math.round(posInZone * 22); // 20-42
      }
    } else {
      // Terrain proxy when no HR
      hrTarget = gradient > 12 ? 70 : gradient > 8 ? 55 : gradient > 5 ? 42 :
        gradient > 3 ? 32 : gradient > 1 ? 22 : gradient > -2 ? 15 : 5;
      if (gradient > 2 && rider.weight_kg > 0) hrTarget = Math.min(100, Math.round(hrTarget * (0.8 + 0.2 * weightFactor)));
    }

    // === LAYER 2: Anticipation (6 sub-components) ===
    let anticipation = 0;

    // Sub 1: terrain
    const terrainBias = gradient > 8 ? 15 : gradient > 5 ? 10 : gradient > 3 ? 5 : gradient < -5 ? -10 : 0;
    anticipation += terrainBias;

    // Sub 3: weight (gradient > 8, weight > 75, with HR)
    if (hasHR && gradient > 8 && rider.weight_kg > 75) {
      anticipation += Math.min(10, Math.round((rider.weight_kg - 75) / 10 * 3));
    }

    // Sub 4: power anticipation
    if (r.power_watts > 0 && rider.weight_kg > 0) {
      const wkg = r.power_watts / rider.weight_kg;
      if (wkg > 3.0) anticipation += 15;
      else if (wkg > 2.0) anticipation += 8;
      else if (wkg < 0.8 && wkg > 0) anticipation -= 10;
    }

    // Sub 5: cadence trend
    cadenceHist.push(r.cadence_rpm);
    if (cadenceHist.length > 5) cadenceHist.shift();
    if (cadenceHist.length >= 3 && r.cadence_rpm > 0) {
      const oldCad = cadenceHist[0]!;
      if (oldCad - r.cadence_rpm > 15 && oldCad > 55) anticipation += 10;
    }

    // Sub 6a: slow on climb (anti-overlap with terrain)
    if (r.speed_kmh < 8 && r.speed_kmh > 2 && gradient > 5) {
      anticipation += Math.max(0, 10 - terrainBias);
    }
    // Sub 6b: speed dropping on climb
    speedHist.push(r.speed_kmh);
    if (speedHist.length > 5) speedHist.shift();
    if (speedHist.length >= 3 && gradient > 3) {
      const oldSpd = speedHist[0]!;
      if (oldSpd - r.speed_kmh > 3 && oldSpd > 5) anticipation += 8;
    }
    // Sub 6c: approaching speed limit (gradual)
    const speedPenaltyStart = bike.speed_limit_kmh - 5;
    if (r.speed_kmh > speedPenaltyStart && r.speed_kmh <= bike.speed_limit_kmh) {
      const range = bike.speed_limit_kmh - speedPenaltyStart;
      anticipation -= Math.round(((r.speed_kmh - speedPenaltyStart) / (range || 1)) * 25);
    }

    // === CONTEXT OVERRIDE: speed increasing or downhill → reduce assist ===
    // If speed is rising, rider doesn't need help (even if HR is high from adrenaline)
    let contextPenalty = 0;
    if (speedHist.length >= 3) {
      const speedDelta = r.speed_kmh - speedHist[0]!;
      // Speed increasing >3 km/h over last samples → reduce assist proportionally
      if (speedDelta > 3 && r.speed_kmh > 15) {
        contextPenalty -= Math.min(20, Math.round(speedDelta * 2));
      }
    }
    // Downhill: gradient negative → motor not needed, scale by steepness
    if (gradient < -2) {
      contextPenalty -= Math.min(30, Math.round(Math.abs(gradient) * 3));
    }
    // Above speed limit: motor off
    if (r.speed_kmh > bike.speed_limit_kmh) {
      contextPenalty = -100;
    }

    // Scale anticipation by rider comfort
    if (hasHR) {
      let anticipationScale = 0.3;
      if (r.hr_bpm > targetZone.max_bpm) {
        anticipationScale = 1.0;
      } else if (r.hr_bpm >= targetZone.min_bpm) {
        const zoneRange = targetZone.max_bpm - targetZone.min_bpm;
        const zonePos = zoneRange > 0 ? (r.hr_bpm - targetZone.min_bpm) / zoneRange : 0.5;
        anticipationScale = 0.3 + zonePos * 0.7;
      }
      anticipation = Math.round(anticipation * anticipationScale);
    }
    anticipation = Math.max(-20, Math.min(35, anticipation));

    // === LAYER 3: Battery constraint ===
    const soc = (batteryWh / totalWh) * 100;
    const bf = Math.min(totalWh / 1050, 1.2);
    const conserveAt = 30 * bf;
    const emergencyAt = 15 * bf;
    let batteryMod = 1.0;
    if (soc <= 60 && soc > conserveAt) batteryMod = 0.7 + (soc - conserveAt) / (60 - conserveAt) * 0.3;
    else if (soc <= conserveAt && soc > emergencyAt) batteryMod = 0.5 + (soc - emergencyAt) / (conserveAt - emergencyAt) * 0.2;
    else if (soc <= emergencyAt) batteryMod = 0.4;

    // === COMBINE: layered ===
    const stoppedPenalty = r.speed_kmh < 2 ? -20 : 0;

    // Adaptive learning: apply learned adjustment for this context
    const hrZoneForLearning = hasHR ? (r.hr_bpm >= targetZone.max_bpm ? 4
      : r.hr_bpm >= targetZone.min_bpm ? 2 : 1) : 0;
    const learnedAdj = useLearningStore.getState().getAdjustment(gradient, hrZoneForLearning);

    // === ENVIRONMENT: terrain + weather (from enrichment) ===
    let envAdj = 0;
    const surface: SurfaceCategory = terrainSurfaces?.[i] ?? 'gravel';
    if (surface === 'technical') envAdj += 8;
    else if (surface === 'dirt') envAdj += 4;
    else if (surface === 'gravel') envAdj += 2;

    if (weather) {
      if (weather.wind_speed_kmh > 15) envAdj += Math.min(8, Math.round((weather.wind_speed_kmh - 15) / 5) * 2);
      if (weather.temp_c > 32) envAdj += Math.min(6, Math.round((weather.temp_c - 32) / 3) * 2);
    }

    let coldBatteryMod = 1.0;
    if (weather && weather.temp_c < 5) {
      coldBatteryMod = Math.max(0.7, 1 - (5 - weather.temp_c) * 0.015);
    }

    const rawScore = Math.max(0, Math.min(100, hrTarget + anticipation + contextPenalty + stoppedPenalty + learnedAdj + envAdj));
    const instantScore = Math.round(rawScore * batteryMod * coldBatteryMod);

    // === SMOOTHING: EMA prevents oscillation, gives time for HR to react ===
    smoothedScore = smoothedScore + EMA_ALPHA * (instantScore - smoothedScore);
    const score = Math.round(smoothedScore);

    // Display level for summary stats
    const targetLevel: 1 | 2 | 3 = score > 62 ? 1 : score > 38 ? 2 : 3;

    // Level changes: only if held long enough (HOLD_TIME_S minimum)
    if (targetLevel !== currentLevel && (r.elapsed_s - lastLevelChangeElapsed) >= HOLD_TIME_S) {
      levelChanges++;
      currentLevel = targetLevel;
      lastLevelChangeElapsed = r.elapsed_s;
    }

    // === INTERPOLATE ASMO VALUES from smoothed score ===
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const asmo = score <= 50
      ? {
          support_pct: Math.round(lerp(bike.tuning_min.assist_pct, bike.tuning_mid.assist_pct, score / 50)),
          torque: Math.round(lerp(bike.tuning_min.torque_nm, bike.tuning_mid.torque_nm, score / 50)),
          launch: Math.round(lerp(bike.tuning_min.launch, bike.tuning_mid.launch, score / 50)),
        }
      : {
          support_pct: Math.round(lerp(bike.tuning_mid.assist_pct, bike.tuning_max.assist_pct, (score - 50) / 50)),
          torque: Math.round(lerp(bike.tuning_mid.torque_nm, bike.tuning_max.torque_nm, (score - 50) / 50)),
          launch: Math.round(lerp(bike.tuning_mid.launch, bike.tuning_max.launch, (score - 50) / 50)),
        };

    // === BATTERY SIMULATION (physics-based) ===
    const dt = i > 0 ? (r.elapsed_s - records[i - 1]!.elapsed_s) : 0;
    const dtH = dt / 3600;
    if (r.speed_kmh > 2 && dtH > 0) {
      // KROMI: consumption from physics model with surface-aware rolling resistance
      const kromiW = motorConsumptionW(r.speed_kmh, gradient, rider.weight_kg, asmo.support_pct, asmo.torque, bike.max_power_w, surface);
      batteryWh = Math.max(0, batteryWh - kromiW * dtH);
      // Fixed baseline: same physics + surface
      const fixedW = motorConsumptionW(r.speed_kmh, gradient, rider.weight_kg, bike.fixed_baseline.assist_pct, bike.fixed_baseline.torque_nm, bike.max_power_w, surface);
      batteryFixedWh = Math.max(0, batteryFixedWh - fixedW * dtH);
      // Always MAX: worst case
      const maxW = motorConsumptionW(r.speed_kmh, gradient, rider.weight_kg, bike.tuning_max.assist_pct, bike.tuning_max.torque_nm, bike.max_power_w, surface);
      batteryMaxWh = Math.max(0, batteryMaxWh - maxW * dtH);
    }

    scoreSum += score;
    if (score > maxScore) maxScore = score;
    if (isActive) {
      countActive++;
      if (currentLevel === 1) countMax++;
      else if (currentLevel === 2) countMid++;
      else countMin++;
    }

    points.push({
      elapsed_s: r.elapsed_s,
      distance_km: r.distance_km,
      altitude_m: alt,
      gradient_pct: Math.round(gradient * 10) / 10,
      speed_kmh: r.speed_kmh,
      hr_bpm: r.hr_bpm,
      kromi_score: score,
      kromi_level: currentLevel,
      kromi_active: isActive,
      battery_pct: Math.round((batteryWh / totalWh) * 100),
      consumption_wh: Math.round(totalWh - batteryWh),
      support_pct: asmo.support_pct,
      torque: asmo.torque,
      launch: asmo.launch,
      terrain_score: terrainBias,
      hr_mod: Math.round(hrTarget - 30),
      speed_mod: anticipation,
      weight_factor: weightFactor,
    });
  }

  const total = countMax + countMid + countMin;
  const batteryEndKromi = Math.round((batteryWh / totalWh) * 100);
  const batteryEndFixed = Math.round((batteryFixedWh / totalWh) * 100);

  return {
    points,
    time_max_pct: total > 0 ? Math.round(countMax / total * 100) : 0,
    time_mid_pct: total > 0 ? Math.round(countMid / total * 100) : 0,
    time_min_pct: total > 0 ? Math.round(countMin / total * 100) : 0,
    time_active_pct: records.length > 0 ? Math.round(countActive / records.length * 100) : 0,
    battery_start: 100,
    battery_end_kromi: batteryEndKromi,
    battery_end_fixed: batteryEndFixed,
    battery_end_max: Math.round((batteryMaxWh / totalWh) * 100),
    battery_saved_vs_fixed: batteryEndKromi - batteryEndFixed,
    battery_saved_vs_max: batteryEndKromi - Math.round((batteryMaxWh / totalWh) * 100),
    fixed_label: `S${bike.fixed_baseline.assist_pct}% T${bike.fixed_baseline.torque_nm}Nm L${bike.fixed_baseline.launch}`,
    avg_score: records.length > 0 ? Math.round(scoreSum / records.length) : 0,
    max_score: maxScore,
    level_changes: levelChanges,
    rider_weight: rider.weight_kg,
    rider_hr_max: hrMax,
    bike_battery_wh: totalWh,
    bike_motor: bike.motor_name,
  };
}

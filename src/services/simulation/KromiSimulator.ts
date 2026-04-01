/**
 * KromiSimulator — personalized simulation over past rides.
 *
 * Uses the same logic as TuningIntelligence but replays over imported records.
 * Considers: rider weight/age/HR, bike motor/battery specs, terrain, speed.
 */

import { useSettingsStore, safeBikeConfig } from '../../store/settingsStore';
import { getTargetZone } from '../../types/athlete.types';
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

export function simulateKromi(records: ImportedRecord[]): SimulationSummary {
  const rider = useSettingsStore.getState().riderProfile;
  const bike = safeBikeConfig(useSettingsStore.getState().bikeConfig);
  const totalWh = bike.main_battery_wh + (bike.has_range_extender ? bike.sub_battery_wh : 0);
  const hrMax = rider.hr_max > 0 ? rider.hr_max : (220 - rider.age);
  const weightFactor = rider.weight_kg / 75; // ref 75kg

  const points: SimulationPoint[] = [];
  let prevAlt: number | null = null;
  let currentLevel: 1 | 2 | 3 = 2;
  const levelHistory: (1 | 2 | 3)[] = [];
  let levelChanges = 0;
  let batteryWh = totalWh;
  let batteryFixedWh = totalWh;
  let batteryMaxWh = totalWh;
  const cadenceHist: number[] = [];
  const speedHist: number[] = [];
  let scoreSum = 0;
  let maxScore = 0;
  let countMax = 0, countMid = 0, countMin = 0, countActive = 0;

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

    // === LAYER 1: HR Zone Target (identical to TuningIntelligence) ===
    const targetZone = getTargetZone(rider);
    let hrTarget = 50;
    const hasHR = r.hr_bpm > 0 && hrMax > 0;

    if (hasHR) {
      if (r.hr_bpm > targetZone.max_bpm) {
        hrTarget = Math.min(100, 60 + (r.hr_bpm - targetZone.max_bpm) * 8);
      } else if (r.hr_bpm < targetZone.min_bpm) {
        hrTarget = Math.max(0, 40 - (targetZone.min_bpm - r.hr_bpm) * 5);
      } else {
        const zoneRange = targetZone.max_bpm - targetZone.min_bpm;
        const posInZone = zoneRange > 0 ? (r.hr_bpm - targetZone.min_bpm) / zoneRange : 0.5;
        hrTarget = 40 + Math.round(posInZone * 20);
      }
    } else {
      // Terrain proxy when no HR
      hrTarget = gradient > 12 ? 85 : gradient > 8 ? 72 : gradient > 5 ? 60 :
        gradient > 3 ? 48 : gradient > 1 ? 38 : gradient > -2 ? 25 : 10;
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

    // Scale by rider comfort (Option B)
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
    const rawScore = Math.max(0, Math.min(100, hrTarget + anticipation + stoppedPenalty));
    const score = Math.round(rawScore * batteryMod);

    const targetLevel: 1 | 2 | 3 = score > 62 ? 1 : score > 38 ? 2 : 3;

    levelHistory.push(targetLevel);
    if (levelHistory.length > 3) levelHistory.shift();
    if (levelHistory.length >= 3 && levelHistory.every((l) => l === levelHistory[0])) {
      if (currentLevel !== levelHistory[0]!) { levelChanges++; currentLevel = levelHistory[0]!; }
    }

    // === BATTERY SIMULATION ===
    const dt = i > 0 ? (r.elapsed_s - records[i - 1]!.elapsed_s) : 0;
    const dtH = dt / 3600;
    if (r.speed_kmh > 2 && dtH > 0) {
      // KROMI: consumption based on actual tuning level specs
      const levelSpec = currentLevel === 1 ? bike.tuning_max
        : currentLevel === 2 ? bike.tuning_mid
        : bike.tuning_min;
      batteryWh = Math.max(0, batteryWh - levelSpec.consumption_wh_km * r.speed_kmh * dtH);
      // Fixed baseline: user's normal config (e.g., Support 125%, Torque 40Nm, Launch 3)
      batteryFixedWh = Math.max(0, batteryFixedWh - bike.fixed_baseline.consumption_wh_km * r.speed_kmh * dtH);
      // Always MAX: worst case reference
      batteryMaxWh = Math.max(0, batteryMaxWh - bike.tuning_max.consumption_wh_km * r.speed_kmh * dtH);
    }

    scoreSum += score;
    if (score > maxScore) maxScore = score;
    if (isActive) {
      countActive++;
      if (currentLevel === 1) countMax++;
      else if (currentLevel === 2) countMid++;
      else countMin++;
    }

    // Resolve ASMO values for this level
    const levelSpec = currentLevel === 1 ? bike.tuning_max
      : currentLevel === 2 ? bike.tuning_mid : bike.tuning_min;

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
      support_pct: levelSpec.assist_pct,
      torque: levelSpec.torque_nm,
      launch: levelSpec.launch,
      terrain_score: terrainBias,
      hr_mod: Math.round(hrTarget - 50),
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
    battery_saved_vs_fixed: Math.max(0, batteryEndKromi - batteryEndFixed),
    battery_saved_vs_max: Math.max(0, batteryEndKromi - Math.round((batteryMaxWh / totalWh) * 100)),
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

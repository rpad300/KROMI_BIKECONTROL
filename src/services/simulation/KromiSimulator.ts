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
  let batteryFixedWh = totalWh;   // user's normal config
  let batteryMaxWh = totalWh;      // always MAX for reference
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

    // === PRIMARY: HR Zone Regulation ===
    const targetZone = getTargetZone(rider);
    let hrScore = 50; // neutral when no HR
    if (r.hr_bpm > 0 && hrMax > 0) {
      if (r.hr_bpm > targetZone.max_bpm) {
        hrScore = Math.min(100, 50 + (r.hr_bpm - targetZone.max_bpm) * 5);
      } else if (r.hr_bpm < targetZone.min_bpm) {
        hrScore = Math.max(0, 50 - (targetZone.min_bpm - r.hr_bpm) * 3);
      } else {
        const zoneRange = targetZone.max_bpm - targetZone.min_bpm;
        const posInZone = (r.hr_bpm - targetZone.min_bpm) / (zoneRange || 1);
        hrScore = 35 + Math.round(posInZone * 30);
      }
    }

    // === SECONDARY: Terrain Anticipation ===
    let terrainMod = 0;
    if (gradient > 8) terrainMod = 15;
    else if (gradient > 5) terrainMod = 10;
    else if (gradient > 3) terrainMod = 5;
    else if (gradient < -5) terrainMod = -10;
    if (gradient > 3 && rider.weight_kg > 0) {
      terrainMod = Math.round(terrainMod * (0.8 + 0.2 * weightFactor));
    }

    // === TERTIARY: Battery ===
    const soc = (batteryWh / totalWh) * 100;
    const bf = Math.min(totalWh / 1050, 1.2);
    let batteryMod = 1.0;
    if (soc <= 60 && soc > 30 * bf) batteryMod = 0.7 + (soc - 30 * bf) / (60 - 30 * bf) * 0.3;
    else if (soc <= 30 * bf && soc > 15 * bf) batteryMod = 0.5 + (soc - 15 * bf) / (15 * bf) * 0.2;
    else if (soc <= 15 * bf) batteryMod = 0.4;

    // === AUXILIARY ===
    let speedMod = 0;
    if (r.speed_kmh > bike.speed_limit_kmh - 2) speedMod = -25;
    else if (r.speed_kmh < 2) speedMod = -20;

    // === COMBINE: HR base + terrain anticipation + battery ===
    const rawScore = (hrScore + terrainMod) * batteryMod + speedMod;
    const score = Math.max(0, Math.min(100, Math.round(rawScore)));

    const targetLevel: 1 | 2 | 3 = score > 65 ? 1 : score > 35 ? 2 : 3;

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
      terrain_score: terrainMod,
      hr_mod: Math.round(hrScore - 50),
      speed_mod: speedMod,
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

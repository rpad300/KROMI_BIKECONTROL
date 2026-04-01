/**
 * KromiSimulator — personalized simulation over past rides.
 *
 * Uses the same logic as TuningIntelligence but replays over imported records.
 * Considers: rider weight/age/HR, bike motor/battery specs, terrain, speed.
 */

import { useSettingsStore } from '../../store/settingsStore';
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
  battery_end_fixed: number;
  battery_saved_pct: number;
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
  const bike = useSettingsStore.getState().bikeConfig;
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

    // === TERRAIN + WEIGHT ===
    let terrainScore = 0;
    if (gradient > 12) terrainScore = 100;
    else if (gradient > 8) terrainScore = 85;
    else if (gradient > 5) terrainScore = 70;
    else if (gradient > 3) terrainScore = 55;
    else if (gradient > 1) terrainScore = 40;
    else if (gradient > -2) terrainScore = 25;
    else if (gradient > -5) terrainScore = 10;

    // Weight: heavier = more help on climbs
    if (gradient > 2) {
      terrainScore = Math.min(100, Math.round(terrainScore * (0.8 + 0.2 * weightFactor)));
    }

    // === BATTERY MODIFIER ===
    const soc = (batteryWh / totalWh) * 100;
    const batteryFactor = Math.min(totalWh / 1050, 1.2);
    const conserveAt = 30 * batteryFactor;
    const emergencyAt = 15 * batteryFactor;
    let batteryMod = 1.0;
    if (soc <= 60 && soc > conserveAt) batteryMod = 0.7 + (soc - conserveAt) / (60 - conserveAt) * 0.3;
    else if (soc <= conserveAt && soc > emergencyAt) batteryMod = 0.5 + (soc - emergencyAt) / (conserveAt - emergencyAt) * 0.2;
    else if (soc <= emergencyAt) batteryMod = 0.4;

    // === SPEED + SPEED LIMIT ===
    let speedMod = 0;
    if (r.speed_kmh > bike.speed_limit_kmh - 2) speedMod = -25;
    else if (r.speed_kmh > bike.speed_limit_kmh - 5) speedMod = -15;
    else if (r.speed_kmh > 25) speedMod = -20;
    else if (r.speed_kmh < 5 && gradient > 5) speedMod = 25;
    else if (r.speed_kmh < 10 && gradient > 3) speedMod = 15;
    else if (r.speed_kmh < 3 && isActive) speedMod = -10;

    // === HEART RATE ===
    let hrMod = 0;
    if (r.hr_bpm > 0 && hrMax > 0) {
      const pct = r.hr_bpm / hrMax;
      if (pct > 0.92) hrMod = 20;
      else if (pct > 0.85) hrMod = 15;
      else if (pct > 0.75) hrMod = 5;
      else if (pct < 0.55) hrMod = -10;
    }

    // === CADENCE ===
    let cadMod = 0;
    if (r.cadence_rpm > 0) {
      if (r.cadence_rpm > 90) cadMod = -10;
      else if (r.cadence_rpm < 40 && gradient > 3) cadMod = 20;
      else if (r.cadence_rpm < 60) cadMod = 10;
    }

    // === RIDER POWER (W/kg) ===
    let powerMod = 0;
    if (r.power_watts > 0 && rider.weight_kg > 0) {
      const wkg = r.power_watts / rider.weight_kg;
      if (wkg > 3.5) powerMod = 15;
      else if (wkg > 2.5) powerMod = 10;
      else if (wkg < 0.5) powerMod = -15;
      else if (wkg < 1.0) powerMod = -5;
    }

    // === ALTITUDE ===
    let altMod = 0;
    if (alt > 2500) altMod = 10;
    else if (alt > 2000) altMod = 7;
    else if (alt > 1500) altMod = 4;

    // === COMBINE ===
    const rawScore = terrainScore * batteryMod + speedMod + hrMod + cadMod + powerMod + altMod;
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
      // Fixed POWER at MAX: always highest consumption
      batteryFixedWh = Math.max(0, batteryFixedWh - bike.tuning_max.consumption_wh_km * r.speed_kmh * dtH);
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
      terrain_score: terrainScore,
      hr_mod: hrMod,
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
    battery_saved_pct: Math.max(0, batteryEndKromi - batteryEndFixed),
    avg_score: records.length > 0 ? Math.round(scoreSum / records.length) : 0,
    max_score: maxScore,
    level_changes: levelChanges,
    rider_weight: rider.weight_kg,
    rider_hr_max: hrMax,
    bike_battery_wh: totalWh,
    bike_motor: bike.motor_name,
  };
}

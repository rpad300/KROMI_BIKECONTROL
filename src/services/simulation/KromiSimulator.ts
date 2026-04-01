/**
 * KromiSimulator — simulate KROMI Intelligence over a past ride.
 *
 * Takes imported ride records (with altitude) and replays the
 * TuningIntelligence scoring for each point. Shows what KROMI
 * would have done: when it activates, tuning levels, battery impact.
 *
 * This lets users see the value of KROMI before riding with it.
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
  // KROMI simulation
  kromi_score: number;
  kromi_level: 1 | 2 | 3;
  kromi_active: boolean;
  // Battery simulation
  battery_pct: number;
  consumption_wh: number;
  // Factors
  terrain_score: number;
  battery_modifier: number;
  speed_mod: number;
}

export interface SimulationSummary {
  points: SimulationPoint[];
  // Tuning stats
  time_max_pct: number;      // % of time at MAX
  time_mid_pct: number;      // % of time at MID
  time_min_pct: number;      // % of time at MIN
  time_active_pct: number;   // % of time KROMI would be active
  // Battery
  battery_start: number;
  battery_end_kromi: number;  // estimated with KROMI
  battery_end_fixed: number;  // estimated with fixed POWER mode
  battery_saved_pct: number;  // how much KROMI saves vs fixed
  // Score stats
  avg_score: number;
  max_score: number;
  level_changes: number;
}

/** Run KROMI simulation over imported ride records */
export function simulateKromi(records: ImportedRecord[]): SimulationSummary {
  const cfg = useSettingsStore.getState().bikeConfig;
  const totalWh = cfg.main_battery_wh + (cfg.has_range_extender ? cfg.sub_battery_wh : 0);

  const points: SimulationPoint[] = [];
  let prevAlt: number | null = null;
  let currentLevel: 1 | 2 | 3 = 2;
  let levelHistory: (1 | 2 | 3)[] = [];
  let levelChanges = 0;
  let batteryWh = totalWh;
  let batteryFixedWh = totalWh;
  let scoreSum = 0;
  let maxScore = 0;
  let countMax = 0, countMid = 0, countMin = 0, countActive = 0;

  for (let i = 0; i < records.length; i++) {
    const r = records[i]!;
    const alt = r.altitude_m ?? 0;

    // Calculate gradient from altitude difference
    let gradient = 0;
    if (prevAlt !== null && i > 0) {
      const prev = records[i - 1]!;
      const distDelta = (r.distance_km - prev.distance_km) * 1000; // meters
      if (distDelta > 1) {
        gradient = ((alt - prevAlt) / distDelta) * 100;
        gradient = Math.max(-30, Math.min(30, gradient)); // clamp extremes
      }
    }
    prevAlt = alt;

    // Would KROMI be active? (only makes sense at speed > 2km/h)
    const isActive = r.speed_kmh > 2;

    // Score terrain (same logic as TuningIntelligence)
    let terrainScore = 0;
    if (gradient > 12) terrainScore = 100;
    else if (gradient > 8) terrainScore = 85;
    else if (gradient > 5) terrainScore = 70;
    else if (gradient > 3) terrainScore = 55;
    else if (gradient > 1) terrainScore = 40;
    else if (gradient > -2) terrainScore = 25;
    else if (gradient > -5) terrainScore = 10;

    // Battery modifier
    const soc = (batteryWh / totalWh) * 100;
    let batteryMod = 1.0;
    if (soc <= 60 && soc > 30) batteryMod = 0.7 + (soc - 30) / 100;
    else if (soc <= 30 && soc > 15) batteryMod = 0.5 + (soc - 15) / 75;
    else if (soc <= 15) batteryMod = 0.4;

    // Speed modifier
    let speedMod = 0;
    if (r.speed_kmh > 25) speedMod = -20;
    else if (r.speed_kmh < 5 && gradient > 5) speedMod = 25;
    else if (r.speed_kmh < 10 && gradient > 3) speedMod = 15;
    else if (r.speed_kmh < 3 && isActive) speedMod = -10;

    const rawScore = terrainScore * batteryMod + speedMod;
    const score = Math.max(0, Math.min(100, Math.round(rawScore)));

    // Score → level
    const targetLevel: 1 | 2 | 3 = score > 65 ? 1 : score > 35 ? 2 : 3;

    // Smoothing (3 samples)
    levelHistory.push(targetLevel);
    if (levelHistory.length > 3) levelHistory.shift();
    if (levelHistory.length >= 3 && levelHistory.every((l) => l === levelHistory[0])) {
      if (currentLevel !== levelHistory[0]!) {
        levelChanges++;
        currentLevel = levelHistory[0]!;
      }
    }

    // Battery simulation (Wh consumed per interval)
    // Interval between records (typically ~5s)
    const dt = i > 0 ? (r.elapsed_s - records[i - 1]!.elapsed_s) : 0;
    const dtH = dt / 3600;

    if (r.speed_kmh > 2 && dtH > 0) {
      // KROMI consumption: varies by level
      const kromiConsumptionRate = currentLevel === 1 ? cfg.consumption_power
        : currentLevel === 2 ? (cfg.consumption_power + cfg.consumption_sport) / 2
        : cfg.consumption_sport;
      const kromiWh = kromiConsumptionRate * r.speed_kmh * dtH;
      batteryWh = Math.max(0, batteryWh - kromiWh);

      // Fixed POWER consumption (always max)
      const fixedWh = cfg.consumption_power * r.speed_kmh * dtH;
      batteryFixedWh = Math.max(0, batteryFixedWh - fixedWh);
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
      battery_modifier: Math.round(batteryMod * 100) / 100,
      speed_mod: speedMod,
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
    battery_saved_pct: batteryEndKromi - batteryEndFixed,
    avg_score: records.length > 0 ? Math.round(scoreSum / records.length) : 0,
    max_score: maxScore,
    level_changes: levelChanges,
  };
}

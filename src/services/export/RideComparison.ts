/**
 * Ride Comparison Service
 *
 * Compares two rides (same or different routes) and calculates
 * percentage deltas for key metrics.
 */

import type { RideAnalysis } from './RideAnalysis';

export interface RideComparisonEntry {
  date: string;
  duration_s: number;
  distance_km: number;
  avg_power: number | null;
  np: number | null;
  tss: number | null;
  battery_used: number;
  elevation_gain: number;
  hr_avg: number | null;
  speed_avg: number;
}

export interface RideComparisonDelta {
  duration_pct: number;      // + = slower, - = faster
  power_pct: number;         // + = more power
  tss_pct: number;
  battery_pct: number;
  elevation_pct: number;
  speed_pct: number;         // + = faster
  hr_pct: number;
  improvement: boolean;      // overall assessment
}

export interface RideComparison {
  ride1: RideComparisonEntry;
  ride2: RideComparisonEntry;
  delta: RideComparisonDelta;
}

function pctDelta(newVal: number, oldVal: number): number {
  if (oldVal === 0) return 0;
  return Math.round(((newVal - oldVal) / oldVal) * 1000) / 10;
}

/**
 * Compare two ride analyses. ride2 is the newer ride.
 */
export function compareRides(
  ride1: RideAnalysis,
  ride1Date: string,
  ride2: RideAnalysis,
  ride2Date: string,
): RideComparison {
  const entry1: RideComparisonEntry = {
    date: ride1Date,
    duration_s: ride1.duration_s,
    distance_km: ride1.distance_km,
    avg_power: ride1.power_avg_w,
    np: ride1.power_normalized_w,
    tss: ride1.tss,
    battery_used: ride1.battery_used_pct,
    elevation_gain: ride1.elevation_gain_m,
    hr_avg: ride1.hr_avg_bpm,
    speed_avg: ride1.speed_avg_kmh,
  };

  const entry2: RideComparisonEntry = {
    date: ride2Date,
    duration_s: ride2.duration_s,
    distance_km: ride2.distance_km,
    avg_power: ride2.power_avg_w,
    np: ride2.power_normalized_w,
    tss: ride2.tss,
    battery_used: ride2.battery_used_pct,
    elevation_gain: ride2.elevation_gain_m,
    hr_avg: ride2.hr_avg_bpm,
    speed_avg: ride2.speed_avg_kmh,
  };

  const delta: RideComparisonDelta = {
    duration_pct: pctDelta(ride2.duration_s, ride1.duration_s),
    power_pct: ride1.power_avg_w != null && ride2.power_avg_w != null
      ? pctDelta(ride2.power_avg_w, ride1.power_avg_w)
      : 0,
    tss_pct: ride1.tss != null && ride2.tss != null
      ? pctDelta(ride2.tss, ride1.tss)
      : 0,
    battery_pct: pctDelta(ride2.battery_used_pct, ride1.battery_used_pct),
    elevation_pct: pctDelta(ride2.elevation_gain_m, ride1.elevation_gain_m),
    speed_pct: pctDelta(ride2.speed_avg_kmh, ride1.speed_avg_kmh),
    hr_pct: ride1.hr_avg_bpm != null && ride2.hr_avg_bpm != null
      ? pctDelta(ride2.hr_avg_bpm, ride1.hr_avg_bpm)
      : 0,
    // Improvement: faster, less battery, similar or more power
    improvement: ride2.duration_s < ride1.duration_s || ride2.speed_avg_kmh > ride1.speed_avg_kmh,
  };

  return { ride1: entry1, ride2: entry2, delta };
}

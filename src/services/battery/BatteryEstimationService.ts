/**
 * BatteryEstimationService — Giant Trance X E+ 2 (2023)
 *
 * Dual battery system:
 *   Main: EnergyPak Smart 800Wh (36V, 40× Panasonic 22700 cells)
 *   Sub:  EnergyPak Plus 250Wh (36V, 20× Panasonic 22700 cells)
 *   Total: 1050Wh
 *
 * Motor: SyncDrive Pro — 250W nominal, 600W+ peak, 85Nm max, 25km/h limit
 *
 * Estimation uses real-time consumption (Wh/km) from motor power + speed,
 * with mode-based defaults when no data is available yet.
 */

import { useSettingsStore, type BikeConfig } from '../../store/settingsStore';

/** Get current bike config from settings (user-editable) */
function getBikeConfig(): BikeConfig {
  return useSettingsStore.getState().bikeConfig;
}

/** Get consumption default for a mode from bike config */
function getConsumption(modeName: string): number {
  const cfg = getBikeConfig();
  const map: Record<string, number> = {
    eco: cfg.consumption_eco,
    tour: cfg.consumption_tour,
    active: cfg.consumption_active,
    sport: cfg.consumption_sport,
    pwr: cfg.consumption_power,
    power: cfg.consumption_power,
    smart: (cfg.consumption_active + cfg.consumption_sport) / 2,
    man: 0,
    manual: 0,
    off: 0,
  };
  return map[modeName] ?? cfg.consumption_power;
}

// === Sample management ===
const MAX_SAMPLES = 120;        // 2 minutes at 1s intervals
const MIN_SPEED_KMH = 2;
const SAMPLE_WEIGHT_RECENT = 0.7;  // recent samples weighted more

interface ConsumptionSample {
  wh_per_km: number;
  motor_watts: number;
  speed_kmh: number;
  timestamp: number;
}

export interface RangeEstimate {
  /** Estimated range in km */
  range_km: number;
  /** Remaining energy in Wh */
  remaining_wh: number;
  /** Current consumption rate (Wh/km) */
  consumption_wh_km: number;
  /** Data source: 'live' (from samples) or 'default' (mode-based) */
  source: 'live' | 'default';
  /** Estimated time remaining at current speed (minutes) */
  time_remaining_min: number;
  /** Battery health factor (0-1, from bat life %) */
  health_factor: number;
  /** Main battery remaining Wh */
  main_remaining_wh: number;
  /** Sub battery remaining Wh */
  sub_remaining_wh: number;
}

class BatteryEstimationService {
  private samples: ConsumptionSample[] = [];
  private avgConsumption = 0;
  private lastSpeed = 0;

  /**
   * Add a consumption sample from motor telemetry.
   * Called every time we get speed + power data.
   */
  addSample(speed_kmh: number, motor_watts: number, _battery_pct: number): void {
    this.lastSpeed = speed_kmh;

    if (speed_kmh < MIN_SPEED_KMH || motor_watts <= 0) return;

    // Wh/km = watts / (km/h) = watt-hours per kilometer
    const wh_per_km = motor_watts / speed_kmh;

    this.samples.push({
      wh_per_km,
      motor_watts,
      speed_kmh,
      timestamp: Date.now(),
    });

    if (this.samples.length > MAX_SAMPLES) {
      this.samples = this.samples.slice(-MAX_SAMPLES);
    }

    // Weighted average: recent samples count more
    this.avgConsumption = this.calculateWeightedAvg();
  }

  /**
   * Get full range estimate with dual battery breakdown.
   */
  getFullEstimate(
    soc: number,
    modeName: string = 'power',
    bat1Life: number = 100,
    bat2Life: number = 100,
  ): RangeEstimate {
    const cfg = getBikeConfig();
    const mainWh = cfg.main_battery_wh;
    const subWh = cfg.has_range_extender ? cfg.sub_battery_wh : 0;

    // Health factor: average of both battery health percentages
    const health_factor = ((bat1Life + bat2Life) / 2) / 100;

    // Effective capacity adjusted for battery health
    const effective_main = mainWh * (bat1Life / 100);
    const effective_sub = subWh * (bat2Life / 100);
    const effective_total = effective_main + effective_sub;

    // Remaining energy from SOC
    const remaining_wh = (soc / 100) * effective_total;
    const main_remaining_wh = (soc / 100) * effective_main;
    const sub_remaining_wh = (soc / 100) * effective_sub;

    // Consumption: use live data if available, otherwise mode default
    const hasLiveData = this.samples.length >= 10;
    const consumption = hasLiveData
      ? this.avgConsumption
      : getConsumption(modeName);

    // Range
    const range_km = consumption > 0 ? remaining_wh / consumption : 0;

    // Time remaining
    const speed = this.lastSpeed > MIN_SPEED_KMH ? this.lastSpeed : 15; // default 15km/h
    const time_remaining_min = (range_km / speed) * 60;

    return {
      range_km: Math.round(range_km * 10) / 10,
      remaining_wh: Math.round(remaining_wh),
      consumption_wh_km: Math.round(consumption * 10) / 10,
      source: hasLiveData ? 'live' : 'default',
      time_remaining_min: Math.round(time_remaining_min),
      health_factor: Math.round(health_factor * 100) / 100,
      main_remaining_wh: Math.round(main_remaining_wh),
      sub_remaining_wh: Math.round(sub_remaining_wh),
    };
  }

  /** Simple range estimate (backwards compatible) */
  getEstimatedRange(battery_pct?: number): number {
    const pct = battery_pct ?? 0;
    if (pct <= 0) return 0;
    const estimate = this.getFullEstimate(pct);
    return estimate.range_km;
  }

  getAvgConsumption(): number { return this.avgConsumption; }
  getSampleCount(): number { return this.samples.length; }

  reset(): void {
    this.samples = [];
    this.avgConsumption = 0;
    this.lastSpeed = 0;
  }

  private calculateWeightedAvg(): number {
    if (this.samples.length === 0) return 0;

    const n = this.samples.length;
    let weightedSum = 0;
    let weightTotal = 0;

    for (let i = 0; i < n; i++) {
      // More recent samples get higher weight
      const recency = i / n; // 0 (oldest) to ~1 (newest)
      const weight = (1 - SAMPLE_WEIGHT_RECENT) + SAMPLE_WEIGHT_RECENT * recency;
      weightedSum += this.samples[i]!.wh_per_km * weight;
      weightTotal += weight;
    }

    return weightedSum / weightTotal;
  }
}

export const batteryEstimationService = new BatteryEstimationService();

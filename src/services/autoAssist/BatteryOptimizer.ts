/**
 * BatteryOptimizer — Wh budget calculation per segment.
 *
 * 6-level constraint states based on budget ratio (remaining vs needed).
 * Temperature correction for Li-ion cold performance.
 * Uses BatteryEstimationService for live consumption data.
 *
 * Constraint factor (0.20-1.0) is applied to motor support/torque in KromiEngine.
 */

import { batteryEstimationService } from '../battery/BatteryEstimationService';

// ── Types ──────────────────────────────────────────────────────

export interface BatteryBudget {
  remaining_wh: number;
  consumption_wh_km: number;
  estimated_range_km: number;
  route_remaining_km: number | null;
  budget_ratio: number;          // remaining / needed. Infinity if no route.
  constraint_factor: number;     // 0.20 - 1.0, applied to motor params
  is_emergency: boolean;         // range < 5km
  temp_correction: number;       // 0.75 - 1.0 for cold battery
}

// ── 5-min Rolling Consumption Tracker ──────────────────────────

const ROLLING_WINDOW_MS = 5 * 60 * 1000;

interface ConsumptionPoint {
  ts: number;
  wh: number;   // cumulative Wh at this point
  km: number;   // cumulative km at this point
}

let consumptionLog: ConsumptionPoint[] = [];
let cumulativeWh = 0;
let lastTickTs = 0;

/**
 * Feed real-time telemetry to the rolling tracker.
 * Call every 1s with current motor power and distance.
 */
export function feedConsumption(motor_watts: number, distance_km: number): void {
  const now = Date.now();
  const dt_h = lastTickTs > 0 ? (now - lastTickTs) / 3_600_000 : 0;
  lastTickTs = now;

  // Accumulate Wh from motor power
  if (motor_watts > 0 && dt_h > 0) {
    cumulativeWh += motor_watts * dt_h;
  }
  consumptionLog.push({ ts: now, wh: cumulativeWh, km: distance_km });

  // Trim to 5-min window
  const cutoff = now - ROLLING_WINDOW_MS;
  while (consumptionLog.length > 1 && consumptionLog[0]!.ts < cutoff) {
    consumptionLog.shift();
  }
}

/** Get Wh/km from last 5 minutes of actual riding data */
function getRollingConsumption(): number | null {
  if (consumptionLog.length < 10) return null; // need at least 10s of data
  const first = consumptionLog[0]!;
  const last = consumptionLog[consumptionLog.length - 1]!;
  const dKm = last.km - first.km;
  const dWh = last.wh - first.wh;
  if (dKm < 0.05) return null; // need at least 50m
  return dWh / dKm;
}

// ── Budget Calculation ─────────────────────────────────────────

/**
 * Compute battery budget and constraint factor.
 *
 * @param batterySoc - Current battery SOC (0-100%)
 * @param routeRemainingKm - Remaining route distance (null if no route)
 * @param temp_c - Ambient temperature for cold correction
 */
export function computeBatteryBudget(
  batterySoc: number,
  routeRemainingKm: number | null,
  temp_c: number | null,
): BatteryBudget {
  // Get estimate from BatteryEstimationService
  const estimate = batteryEstimationService.getFullEstimate(batterySoc, 'power');

  // Prefer rolling consumption if available, else use service estimate
  const rollingRate = getRollingConsumption();
  const consumption_wh_km = rollingRate ?? estimate.consumption_wh_km;
  const remaining_wh = estimate.remaining_wh;

  // Temperature correction for Li-ion
  let temp_correction = 1.0;
  if (temp_c !== null) {
    if (temp_c < 0) temp_correction = 0.75;
    else if (temp_c < 10) temp_correction = 0.85;
  }
  const effective_wh = remaining_wh * temp_correction;

  // Range estimate
  const estimated_range_km = consumption_wh_km > 0
    ? effective_wh / consumption_wh_km
    : 999;

  // Emergency check
  const is_emergency = estimated_range_km < 5;

  // Budget ratio
  let budget_ratio = Infinity;
  if (routeRemainingKm !== null && routeRemainingKm > 0) {
    const neededWh = consumption_wh_km * routeRemainingKm;
    budget_ratio = neededWh > 0 ? effective_wh / neededWh : Infinity;
  }

  // 6-level constraint factor
  let constraint_factor = 1.0;
  if (is_emergency) {
    constraint_factor = 0.20;
  } else if (budget_ratio < 0.5) {
    constraint_factor = 0.40;
  } else if (budget_ratio < 0.7) {
    constraint_factor = 0.65;
  } else if (budget_ratio < 1.0) {
    constraint_factor = 0.85;
  }
  // budget_ratio >= 1.0 or no route → 1.0

  return {
    remaining_wh: effective_wh,
    consumption_wh_km,
    estimated_range_km,
    route_remaining_km: routeRemainingKm,
    budget_ratio,
    constraint_factor,
    is_emergency,
    temp_correction,
  };
}

/** Reset tracker (new ride) */
export function resetBatteryTracker(): void {
  consumptionLog = [];
  cumulativeWh = 0;
  lastTickTs = 0;
}

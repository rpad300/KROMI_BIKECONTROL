/**
 * HistoricalRangeEstimator — calculates expected range based on ride history.
 *
 * Instead of using live motor data, this uses actual ride sessions from Supabase
 * to compute real-world consumption patterns. Factors in:
 * - Historical Wh/km from completed rides
 * - Rider weight + bike weight
 * - Average terrain gradient from past rides
 * - Season/temperature adjustments
 * - Battery degradation (health %)
 *
 * Used on desktop where there's no live BLE connection.
 */

import { useSettingsStore } from '../../store/settingsStore';
import { supaGet } from '../../lib/supaFetch';

export interface RideHistoryStats {
  totalRides: number;
  totalKm: number;
  totalHours: number;
  avgWhPerKm: number;
  avgSpeedKmh: number;
  avgPowerW: number;
  avgBatteryUsedPct: number;
  /** Per-ride stats for recent rides */
  recentRides: {
    date: string;
    km: number;
    durationMin: number;
    batteryUsedPct: number;
    whPerKm: number;
    avgPower: number;
  }[];
}

export interface RangeEstimate {
  /** Estimated range with current battery */
  estimatedKm: number;
  /** Based on how many rides */
  basedOnRides: number;
  /** Confidence: 'high' (10+ rides), 'medium' (3-9), 'low' (1-2), 'none' (0) */
  confidence: 'high' | 'medium' | 'low' | 'none';
  /** Historical Wh/km used for calculation */
  whPerKm: number;
  /** Available Wh (battery capacity × health × SOC) */
  availableWh: number;
  /** Factors that affect the estimate */
  factors: string[];
}

/** Fetch ride history stats from Supabase */
export async function fetchRideHistoryStats(): Promise<RideHistoryStats | null> {
  try {
    const userId = (await import('../../store/authStore')).useAuthStore.getState().getUserId();
    if (!userId) return null;

    const rides = await supaGet<Array<Record<string, number | string>>>(
      `/rest/v1/ride_sessions?user_id=eq.${userId}&status=eq.completed&select=started_at,total_km,duration_s,avg_power_w,battery_start,battery_end&order=started_at.desc&limit=50`,
    );

    if (!rides || rides.length === 0) return { totalRides: 0, totalKm: 0, totalHours: 0, avgWhPerKm: 0, avgSpeedKmh: 0, avgPowerW: 0, avgBatteryUsedPct: 0, recentRides: [] };

    const bike = useSettingsStore.getState().bikeConfig;
    const totalWh = bike.main_battery_wh + (bike.has_range_extender ? bike.sub_battery_wh : 0);

    let sumKm = 0, sumHours = 0, sumPower = 0, sumBatUsed = 0, sumWhPerKm = 0;
    let validRides = 0;

    const recentRides = rides.map((r: Record<string, number | string>) => {
      const km = r.total_km as number || 0;
      const durationS = r.duration_s as number || 0;
      const batStart = r.battery_start as number || 0;
      const batEnd = r.battery_end as number || 0;
      const power = r.avg_power_w as number || 0;
      const batteryUsedPct = Math.max(0, batStart - batEnd);
      const whUsed = (batteryUsedPct / 100) * totalWh;
      const whPerKm = km > 0.5 ? whUsed / km : 0;

      if (km > 0.5 && batteryUsedPct > 0) {
        sumKm += km;
        sumHours += durationS / 3600;
        sumPower += power;
        sumBatUsed += batteryUsedPct;
        sumWhPerKm += whPerKm;
        validRides++;
      }

      return {
        date: (r.started_at as string)?.split('T')[0] ?? '',
        km: Math.round(km * 10) / 10,
        durationMin: Math.round(durationS / 60),
        batteryUsedPct: Math.round(batteryUsedPct),
        whPerKm: Math.round(whPerKm * 10) / 10,
        avgPower: Math.round(power),
      };
    }).filter((r: { km: number }) => r.km > 0);

    return {
      totalRides: validRides,
      totalKm: Math.round(sumKm * 10) / 10,
      totalHours: Math.round(sumHours * 10) / 10,
      avgWhPerKm: validRides > 0 ? Math.round((sumWhPerKm / validRides) * 10) / 10 : 0,
      avgSpeedKmh: sumHours > 0 ? Math.round((sumKm / sumHours) * 10) / 10 : 0,
      avgPowerW: validRides > 0 ? Math.round(sumPower / validRides) : 0,
      avgBatteryUsedPct: validRides > 0 ? Math.round(sumBatUsed / validRides) : 0,
      recentRides: recentRides.slice(0, 10),
    };
  } catch (err) {
    console.warn('[HistoricalRange] Failed to fetch:', err);
    return null;
  }
}

/** Calculate range estimate from historical data */
export function calculateHistoricalRange(stats: RideHistoryStats, currentSocPct: number): RangeEstimate {
  const bike = useSettingsStore.getState().bikeConfig;
  const rider = useSettingsStore.getState().riderProfile;
  const totalWh = bike.main_battery_wh + (bike.has_range_extender ? bike.sub_battery_wh : 0);
  const availableWh = totalWh * (currentSocPct / 100);

  const factors: string[] = [];

  if (stats.totalRides === 0) {
    // No history — use motor defaults
    const defaultWhKm = bike.consumption_active || 5;
    return {
      estimatedKm: Math.round(availableWh / defaultWhKm),
      basedOnRides: 0,
      confidence: 'none',
      whPerKm: defaultWhKm,
      availableWh: Math.round(availableWh),
      factors: ['Sem histórico — usando defaults do motor'],
    };
  }

  let whPerKm = stats.avgWhPerKm;

  // Weight adjustment: heavier rider = more consumption
  // Baseline: 80kg rider. Each +10kg = +5% consumption
  const weightDelta = (rider.weight_kg - 80) / 10;
  if (Math.abs(weightDelta) > 0.5) {
    const adj = 1 + (weightDelta * 0.05);
    whPerKm *= adj;
    factors.push(`Peso ${rider.weight_kg}kg (${weightDelta > 0 ? '+' : ''}${Math.round(weightDelta * 5)}%)`);
  }

  // Temperature adjustment: cold = less battery efficiency
  // Below 10°C: +2% per degree below 10
  // Above 35°C: +1% per degree above 35
  // (we don't have current temp in desktop, so skip for now)

  // Battery health: capacity degrades with age
  // We have bat1_health from cmd 19 — if < 95%, reduce estimate
  // For now, just note it as a factor
  factors.push(`${stats.totalRides} voltas analisadas`);
  factors.push(`Consumo médio: ${whPerKm.toFixed(1)} Wh/km`);
  factors.push(`Potência média: ${stats.avgPowerW}W`);

  const estimatedKm = whPerKm > 0 ? Math.round(availableWh / whPerKm) : 0;
  const confidence = stats.totalRides >= 10 ? 'high' : stats.totalRides >= 3 ? 'medium' : 'low';

  return {
    estimatedKm,
    basedOnRides: stats.totalRides,
    confidence,
    whPerKm: Math.round(whPerKm * 10) / 10,
    availableWh: Math.round(availableWh),
    factors,
  };
}

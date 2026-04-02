/**
 * ConsumptionCalibration — auto-calibrates consumption values from motor range data.
 *
 * The motor calculates real range per mode (cmd 17). From this we derive
 * actual Wh/km consumption for each mode, which is far more accurate than
 * our hardcoded defaults because the motor considers:
 * - Real battery health + capacity
 * - Rider weight (configured in RideControl)
 * - Recent riding patterns
 * - Temperature effects on battery
 *
 * These calibrated values feed into:
 * - BatteryEstimationService (range display)
 * - KromiSimulator (battery simulation)
 * - Physics model (motor consumption baseline)
 */

import { useSettingsStore } from '../../store/settingsStore';
import { useBikeStore } from '../../store/bikeStore';

export interface CalibratedConsumption {
  eco: number;
  tour: number;
  active: number;
  sport: number;
  power: number;
  /** Effective total Wh used for calibration */
  totalWh: number;
  /** When calibrated */
  calibrated_at: number;
}

let lastCalibration: CalibratedConsumption | null = null;

/**
 * Calibrate consumption from motor-reported ranges.
 * Called when rangePerMode arrives from BLE (cmd 17).
 */
export function calibrateFromMotorRanges(ranges: {
  eco: number; tour: number; active: number; sport: number; power: number;
}): CalibratedConsumption | null {
  const bike = useSettingsStore.getState().bikeConfig;
  const bat1Soc = useBikeStore.getState().battery_main_pct;
  const bat2Soc = useBikeStore.getState().battery_sub_pct;

  // Calculate available Wh from individual battery SOCs
  const mainWh = bike.main_battery_wh * (bat1Soc > 0 ? bat1Soc / 100 : 1);
  const subWh = bike.has_range_extender ? bike.sub_battery_wh * (bat2Soc > 0 ? bat2Soc / 100 : 1) : 0;
  const totalWh = mainWh + subWh;

  if (totalWh < 50) return null; // Not enough data
  if (ranges.power <= 0) return null; // Need at least POWER to calibrate

  // Derive consumption: Wh/km = available_Wh / range_km
  // Skip overflow modes (0 or negative = bridge flagged uint8 overflow)
  const derive = (range: number) => range > 0 ? Math.round((totalWh / range) * 100) / 100 : 0;
  const cal: CalibratedConsumption = {
    eco: derive(ranges.eco),
    tour: derive(ranges.tour),
    active: derive(ranges.active),
    sport: derive(ranges.sport),
    power: derive(ranges.power),
    totalWh,
    calibrated_at: Date.now(),
  };

  console.log(`[Calibration] From motor ranges (${Math.round(totalWh)}Wh available):`);
  console.log(`  ECO: ${ranges.eco > 0 ? `${ranges.eco}km → ${cal.eco} Wh/km` : 'overflow (skipped)'}`);
  console.log(`  TOUR: ${ranges.tour > 0 ? `${ranges.tour}km → ${cal.tour} Wh/km` : 'overflow (skipped)'}`);
  console.log(`  ACTIVE: ${ranges.active}km → ${cal.active} Wh/km`);
  console.log(`  SPORT: ${ranges.sport}km → ${cal.sport} Wh/km`);
  console.log(`  POWER: ${ranges.power}km → ${cal.power} Wh/km`);

  // Update settingsStore with calibrated values (only for valid modes)
  const update: Record<string, number> = {};
  if (cal.eco > 0) update.consumption_eco = cal.eco;
  if (cal.tour > 0) update.consumption_tour = cal.tour;
  if (cal.active > 0) update.consumption_active = cal.active;
  if (cal.sport > 0) update.consumption_sport = cal.sport;
  if (cal.power > 0) update.consumption_power = cal.power;
  useSettingsStore.getState().updateBikeConfig(update);

  lastCalibration = cal;
  return cal;
}

export function getLastCalibration(): CalibratedConsumption | null {
  return lastCalibration;
}

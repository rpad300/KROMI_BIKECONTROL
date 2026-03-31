/**
 * BatteryEstimationService
 * Estimates remaining range from battery %, power consumption, and speed.
 * Giant Trance X E+ 2 (2023) has a 750Wh battery.
 */

const BATTERY_CAPACITY_WH = 750;
const MAX_SAMPLES = 60;
const MIN_SPEED_KMH = 2; // ignore stationary samples

interface ConsumptionSample {
  wh_per_km: number;
  timestamp: number;
}

class BatteryEstimationService {
  private samples: ConsumptionSample[] = [];
  private avgConsumption = 0; // Wh/km running average

  /** Add a sample from BLE notification data */
  addSample(speed_kmh: number, power_watts: number, _battery_pct: number): void {
    // Skip if stationary or no power data
    if (speed_kmh < MIN_SPEED_KMH || power_watts <= 0) return;

    const wh_per_km = power_watts / speed_kmh;

    this.samples.push({ wh_per_km, timestamp: Date.now() });

    // Keep only last MAX_SAMPLES
    if (this.samples.length > MAX_SAMPLES) {
      this.samples = this.samples.slice(-MAX_SAMPLES);
    }

    // Calculate running average
    const sum = this.samples.reduce((acc, s) => acc + s.wh_per_km, 0);
    this.avgConsumption = sum / this.samples.length;
  }

  /** Get estimated remaining range in km */
  getEstimatedRange(battery_pct?: number): number {
    const pct = battery_pct ?? 0;
    if (pct <= 0) return 0;

    const remainingWh = (pct / 100) * BATTERY_CAPACITY_WH;

    // If we have consumption data, use it; otherwise use a default (~25 Wh/km for SPORT mode)
    const consumption = this.avgConsumption > 0 ? this.avgConsumption : 25;

    return Math.max(0, remainingWh / consumption);
  }

  /** Get current average consumption in Wh/km */
  getAvgConsumption(): number {
    return this.avgConsumption;
  }

  /** Get number of samples collected */
  getSampleCount(): number {
    return this.samples.length;
  }

  /** Reset all samples */
  reset(): void {
    this.samples = [];
    this.avgConsumption = 0;
  }
}

export const batteryEstimationService = new BatteryEstimationService();

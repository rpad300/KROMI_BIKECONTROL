import { AssistMode } from '../../types/bike.types';

// Estimated consumption per mode (% battery per km)
const CONSUMPTION: Record<number, number> = {
  [AssistMode.OFF]: 0.3,
  [AssistMode.ECO]: 1.5,
  [AssistMode.TOUR]: 2.8,
  [AssistMode.SPORT]: 4.5,
  [AssistMode.POWER]: 7.0,
};

class BatteryEfficiencyTracker {
  private static instance: BatteryEfficiencyTracker;
  private fixedModeConsumption = 0;
  private actualConsumption = 0;

  static getInstance(): BatteryEfficiencyTracker {
    if (!BatteryEfficiencyTracker.instance) {
      BatteryEfficiencyTracker.instance = new BatteryEfficiencyTracker();
    }
    return BatteryEfficiencyTracker.instance;
  }

  /** Call every second with current mode and speed */
  tick(currentMode: AssistMode, speed_kmh: number): void {
    const distKm = speed_kmh / 3600; // km in this second
    this.actualConsumption += (CONSUMPTION[currentMode] ?? 2.8) * distKm;
    this.fixedModeConsumption += CONSUMPTION[AssistMode.SPORT]! * distKm;
  }

  /** % saved vs fixed SPORT mode */
  getSavingPercent(): number {
    if (this.fixedModeConsumption === 0) return 0;
    return Math.round(
      ((this.fixedModeConsumption - this.actualConsumption) / this.fixedModeConsumption) * 100
    );
  }

  /** Extra km gained from battery savings */
  getExtraRangeKm(remainingBatteryPct: number): number {
    const savingPct = this.getSavingPercent();
    const savedBattery = (remainingBatteryPct * savingPct) / 100;
    return Math.round((savedBattery / 4.5) * 10) / 10; // 4.5 = SPORT avg consumption
  }

  reset(): void {
    this.fixedModeConsumption = 0;
    this.actualConsumption = 0;
  }
}

export const batteryEfficiencyTracker = BatteryEfficiencyTracker.getInstance();

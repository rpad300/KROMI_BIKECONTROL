import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_RIDER_PROFILE, type RiderProfile } from '../types/athlete.types';

export interface BikeConfig {
  name: string;
  // Battery
  main_battery_wh: number;
  has_range_extender: boolean;
  sub_battery_wh: number;
  // Motor
  motor_name: string;
  max_torque_nm: number;
  max_power_w: number;
  speed_limit_kmh: number;
  // Wheels
  wheel_circumference_mm: number;
  // Consumption defaults (Wh/km)
  consumption_eco: number;
  consumption_tour: number;
  consumption_active: number;
  consumption_sport: number;
  consumption_power: number;
}

export const DEFAULT_BIKE_CONFIG: BikeConfig = {
  name: 'Giant Trance X E+ 2 (2023)',
  main_battery_wh: 800,
  has_range_extender: true,
  sub_battery_wh: 250,
  motor_name: 'SyncDrive Pro',
  max_torque_nm: 85,
  max_power_w: 600,
  speed_limit_kmh: 25,
  wheel_circumference_mm: 2290,
  consumption_eco: 6,
  consumption_tour: 15,
  consumption_active: 22,
  consumption_sport: 28,
  consumption_power: 35,
};

interface AutoAssistConfig {
  enabled: boolean;
  lookahead_m: number;
  preempt_distance_m: number;
  override_duration_s: number;
  battery_conservation: boolean;
  min_battery_reserve: number;
  smoothing_window: number;
  climb_threshold_pct: number;
  descent_threshold_pct: number;
}

interface SettingsState {
  riderProfile: RiderProfile;
  bikeConfig: BikeConfig;
  autoAssist: AutoAssistConfig;
  simulation_mode: boolean;

  updateRiderProfile: (partial: Partial<RiderProfile>) => void;
  updateBikeConfig: (partial: Partial<BikeConfig>) => void;
  updateAutoAssist: (partial: Partial<AutoAssistConfig>) => void;
  setSimulationMode: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      riderProfile: DEFAULT_RIDER_PROFILE,
      bikeConfig: DEFAULT_BIKE_CONFIG,

      autoAssist: {
        enabled: false,
        lookahead_m: 300,
        preempt_distance_m: 50,
        override_duration_s: 60,
        battery_conservation: true,
        min_battery_reserve: 10,
        smoothing_window: 3,
        climb_threshold_pct: 3,
        descent_threshold_pct: -4,
      },

      simulation_mode: false,

      updateRiderProfile: (partial) =>
        set((state) => ({
          riderProfile: { ...state.riderProfile, ...partial },
        })),

      updateBikeConfig: (partial) =>
        set((state) => ({
          bikeConfig: { ...state.bikeConfig, ...partial },
        })),

      updateAutoAssist: (partial) =>
        set((state) => ({
          autoAssist: { ...state.autoAssist, ...partial },
        })),

      setSimulationMode: (v) => set({ simulation_mode: v }),
    }),
    {
      name: 'bikecontrol-settings',
    }
  )
);

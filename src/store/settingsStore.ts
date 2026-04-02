import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_RIDER_PROFILE, type RiderProfile } from '../types/athlete.types';

/** Motor tuning level characteristics — what each SET_TUNING level does */
export interface TuningLevelSpec {
  assist_pct: number;     // Motor support % (e.g., 400% = 4x rider input)
  torque_nm: number;      // Max torque at this level
  launch: number;         // Response aggressiveness (1-10)
  consumption_wh_km: number; // Typical Wh/km at this level
}

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
  // Consumption defaults (Wh/km) per assist mode
  consumption_eco: number;
  consumption_tour: number;
  consumption_active: number;
  consumption_sport: number;
  consumption_power: number;
  // Tuning level specs (what SET_TUNING levels do in POWER mode)
  tuning_max: TuningLevelSpec;   // Level 1 = MAX
  tuning_mid: TuningLevelSpec;   // Level 2 = MID
  tuning_min: TuningLevelSpec;   // Level 3 = MIN
  // Fixed baseline for comparison — what rider uses without KROMI
  fixed_baseline: TuningLevelSpec;
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
  wheel_circumference_mm: 2369,  // From RideControl bike details
  consumption_eco: 6,
  consumption_tour: 15,
  consumption_active: 22,
  consumption_sport: 28,
  consumption_power: 35,
  // SyncDrive Pro tuning levels in POWER mode (calibrated for 1050Wh total)
  // MIN→~115km range, MID→~65km range, MAX→~40km range
  tuning_max: { assist_pct: 360, torque_nm: 85, launch: 9, consumption_wh_km: 26 },
  tuning_mid: { assist_pct: 240, torque_nm: 65, launch: 5, consumption_wh_km: 16 },
  tuning_min: { assist_pct: 140, torque_nm: 45, launch: 3, consumption_wh_km: 9 },
  // Fixed comparison baseline — what the rider normally uses without KROMI
  // 125% assist < MIN 140%, so consumption must be < MIN 9 Wh/km
  fixed_baseline: { assist_pct: 125, torque_nm: 40, launch: 3, consumption_wh_km: 7 },
};

/** Deep merge bikeConfig with defaults — handles missing nested objects from old DB/localStorage */
export function safeBikeConfig(raw: Partial<BikeConfig> | undefined): BikeConfig {
  const d = DEFAULT_BIKE_CONFIG;
  if (!raw) return d;
  return {
    ...d,
    ...raw,
    tuning_max: { ...d.tuning_max, ...(raw.tuning_max ?? {}) },
    tuning_mid: { ...d.tuning_mid, ...(raw.tuning_mid ?? {}) },
    tuning_min: { ...d.tuning_min, ...(raw.tuning_min ?? {}) },
    fixed_baseline: { ...d.fixed_baseline, ...(raw.fixed_baseline ?? {}) },
  };
}

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
          bikeConfig: safeBikeConfig({ ...state.bikeConfig, ...partial }),
        })),

      updateAutoAssist: (partial) =>
        set((state) => ({
          autoAssist: { ...state.autoAssist, ...partial },
        })),

      setSimulationMode: (v) => set({ simulation_mode: v }),
    }),
    {
      name: 'bikecontrol-settings',
      // Deep merge on hydration — ensures new fields (tuning_max etc) get defaults
      merge: (persisted, current) => {
        const p = persisted as Partial<SettingsState> ?? {};
        return {
          ...current,
          ...p,
          bikeConfig: safeBikeConfig(p.bikeConfig),
          riderProfile: { ...(current as SettingsState).riderProfile, ...(p.riderProfile ?? {}) },
          autoAssist: { ...(current as SettingsState).autoAssist, ...(p.autoAssist ?? {}) },
        };
      },
    }
  )
);

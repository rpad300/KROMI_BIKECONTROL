import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_RIDER_PROFILE, type RiderProfile } from '../types/athlete.types';

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
  autoAssist: AutoAssistConfig;
  simulation_mode: boolean;

  updateRiderProfile: (partial: Partial<RiderProfile>) => void;
  updateAutoAssist: (partial: Partial<AutoAssistConfig>) => void;
  setSimulationMode: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      riderProfile: DEFAULT_RIDER_PROFILE,

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

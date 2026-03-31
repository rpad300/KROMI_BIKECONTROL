import { create } from 'zustand';
import { AssistMode, type BLEConnectionStatus, type BLEServiceStatus } from '../types/bike.types';

interface BikeState {
  // Real-time data
  battery_percent: number;
  speed_kmh: number;
  cadence_rpm: number;
  power_watts: number;
  assist_mode: AssistMode;
  distance_km: number;

  // Session stats
  ride_time_s: number;
  power_avg: number;
  power_max: number;
  speed_max: number;

  // Heart rate (Phase 3)
  hr_bpm: number;
  hr_zone: number;

  // Gear (Phase 3 - Di2)
  gear: number;
  is_shifting: boolean;

  // BLE state
  ble_status: BLEConnectionStatus;
  ble_services: BLEServiceStatus;
  last_update_ms: number;

  // Actions
  setBatteryPercent: (v: number) => void;
  setSpeed: (v: number) => void;
  setCadence: (v: number) => void;
  setPower: (v: number) => void;
  setAssistMode: (v: number) => void;
  setDistance: (v: number) => void;
  setHR: (bpm: number, zone: number) => void;
  setGear: (gear: number) => void;
  setShifting: (v: boolean) => void;
  setBLEStatus: (status: BLEConnectionStatus) => void;
  setServiceConnected: (service: keyof BLEServiceStatus, connected: boolean) => void;
  resetSession: () => void;
}

export const useBikeStore = create<BikeState>((set) => ({
  // Initial state
  battery_percent: 0,
  speed_kmh: 0,
  cadence_rpm: 0,
  power_watts: 0,
  assist_mode: AssistMode.ECO,
  distance_km: 0,
  ride_time_s: 0,
  power_avg: 0,
  power_max: 0,
  speed_max: 0,
  hr_bpm: 0,
  hr_zone: 0,
  gear: 0,
  is_shifting: false,
  ble_status: 'disconnected',
  ble_services: {
    battery: false,
    csc: false,
    power: false,
    gev: false,
    sram: false,
    heartRate: false,
    di2: false,
  },
  last_update_ms: 0,

  // Actions
  setBatteryPercent: (v) => set({ battery_percent: v, last_update_ms: Date.now() }),

  setSpeed: (v) =>
    set((state) => ({
      speed_kmh: Math.round(v * 10) / 10,
      speed_max: Math.max(state.speed_max, v),
      last_update_ms: Date.now(),
    })),

  setCadence: (v) => set({ cadence_rpm: v }),

  setPower: (v) =>
    set((state) => ({
      power_watts: v,
      power_max: Math.max(state.power_max, v),
      power_avg:
        state.ride_time_s > 0
          ? (state.power_avg * state.ride_time_s + v) / (state.ride_time_s + 1)
          : v,
    })),

  setAssistMode: (v) => set({ assist_mode: v as AssistMode }),

  setDistance: (v) => set({ distance_km: Math.round(v * 100) / 100 }),

  setHR: (bpm, zone) => set({ hr_bpm: bpm, hr_zone: zone }),

  setGear: (gear) => set({ gear, is_shifting: false }),

  setShifting: (v) => set({ is_shifting: v }),

  setBLEStatus: (status) => set({ ble_status: status }),

  setServiceConnected: (service, connected) =>
    set((state) => ({
      ble_services: { ...state.ble_services, [service]: connected },
    })),

  resetSession: () =>
    set({
      distance_km: 0,
      ride_time_s: 0,
      power_avg: 0,
      power_max: 0,
      speed_max: 0,
    }),
}));

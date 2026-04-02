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

  // Range & ODO
  range_km: number;
  range_per_mode: { eco: number; tour: number; active: number; sport: number; power: number; smart: number } | null;
  /** Modes where range was estimated (overflow from uint8 protocol) rather than motor-reported */
  range_estimated_modes: Set<string>;
  odo_km: number;
  service_interval_km: number;

  // Dual battery
  battery_main_pct: number;
  battery_sub_pct: number;
  battery_voltage: number;

  // Motor details
  torque_nm: number;
  assist_current_a: number;

  // Trip
  calories: number;
  elevation_gain_m: number;

  // eShift (Di2/internal gear)
  front_gear: number;
  rear_gear: number;

  // Trip (from FC23 cmd 0x40)
  trip_distance_km: number;
  trip_time_s: number;

  // Motor stats (from GEV commands)
  motor_odo_km: number;
  motor_total_hours: number;

  // Error
  error_code: number;

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

  // Device info
  firmware_version: string;
  hardware_version: string;
  software_version: string;

  // TPMS
  tpms_front_psi: number;
  tpms_rear_psi: number;

  // Phone sensors
  barometric_altitude_m: number;
  pressure_hpa: number;
  lean_angle_deg: number;
  temperature_c: number;

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
  setRange: (v: number) => void;
  setRangePerMode: (v: { eco: number; tour: number; active: number; sport: number; power: number; smart: number }, estimated?: Set<string>) => void;
  setOdo: (v: number) => void;
  setServiceInterval: (v: number) => void;
  setBatteryMain: (v: number) => void;
  setBatterySub: (v: number) => void;
  setBatteryVoltage: (v: number) => void;
  setTorque: (v: number) => void;
  setAssistCurrent: (v: number) => void;
  setTripDistance: (v: number) => void;
  setTripTime: (v: number) => void;
  setGears: (front: number, rear: number) => void;
  setMotorOdo: (odo: number, hours: number) => void;
  setCalories: (v: number) => void;
  setElevationGain: (v: number) => void;
  setErrorCode: (v: number) => void;
  setHR: (bpm: number, zone: number) => void;
  setGear: (gear: number) => void;
  setBarometer: (pressure: number, altitude: number) => void;
  setLeanAngle: (deg: number) => void;
  setTemperature: (c: number) => void;
  setFirmwareVersion: (v: string) => void;
  setHardwareVersion: (v: string) => void;
  setSoftwareVersion: (v: string) => void;
  setTPMSFront: (psi: number) => void;
  setTPMSRear: (psi: number) => void;
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

  // Range & ODO
  range_km: 0,
  range_per_mode: null,
  range_estimated_modes: new Set<string>(),
  odo_km: 0,
  service_interval_km: 0,

  // Dual battery
  battery_main_pct: 0,
  battery_sub_pct: 0,
  battery_voltage: 0,

  // Motor details
  torque_nm: 0,
  assist_current_a: 0,

  // Trip
  calories: 0,
  elevation_gain_m: 0,

  // eShift
  front_gear: 0,
  rear_gear: 0,

  // Trip
  trip_distance_km: 0,
  trip_time_s: 0,

  // Motor stats
  motor_odo_km: 0,
  motor_total_hours: 0,

  // Error
  error_code: 0,

  ride_time_s: 0,
  power_avg: 0,
  power_max: 0,
  speed_max: 0,
  hr_bpm: 0,
  hr_zone: 0,
  gear: 0,
  is_shifting: false,
  firmware_version: '',
  hardware_version: '',
  software_version: '',
  tpms_front_psi: 0,
  tpms_rear_psi: 0,
  barometric_altitude_m: 0,
  pressure_hpa: 0,
  lean_angle_deg: 0,
  temperature_c: 0,
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

  setRange: (v) => set({ range_km: Math.round(v * 10) / 10 }),
  setRangePerMode: (v, estimated) => set({ range_per_mode: v, range_estimated_modes: estimated ?? new Set() }),
  setOdo: (v) => set({ odo_km: v }),
  setServiceInterval: (v) => set({ service_interval_km: v }),
  setBatteryMain: (v) => set({ battery_main_pct: v }),
  setBatterySub: (v) => set({ battery_sub_pct: v }),
  setBatteryVoltage: (v) => set({ battery_voltage: v }),
  setTorque: (v) => set({ torque_nm: v }),
  setAssistCurrent: (v) => set({ assist_current_a: v }),
  setTripDistance: (v) => set({ trip_distance_km: Math.round(v * 10) / 10 }),
  setTripTime: (v) => set({ trip_time_s: v }),
  setGears: (front, rear) => set({ front_gear: front, rear_gear: rear }),
  setMotorOdo: (odo, hours) => set({ motor_odo_km: odo, motor_total_hours: hours }),
  setCalories: (v) => set({ calories: Math.round(v) }),
  setElevationGain: (v) => set({ elevation_gain_m: Math.round(v) }),
  setErrorCode: (v) => set({ error_code: v }),

  setHR: (bpm, zone) => set({ hr_bpm: bpm, hr_zone: zone }),

  setGear: (gear) => set({ gear, is_shifting: false }),

  setBarometer: (pressure, altitude) => set({
    pressure_hpa: Math.round(pressure * 10) / 10,
    barometric_altitude_m: Math.round(altitude * 10) / 10,
  }),

  setLeanAngle: (deg) => set({ lean_angle_deg: Math.round(deg * 10) / 10 }),

  setTemperature: (c) => set({ temperature_c: Math.round(c * 10) / 10 }),

  setFirmwareVersion: (v) => set({ firmware_version: v }),
  setHardwareVersion: (v) => set({ hardware_version: v }),
  setSoftwareVersion: (v) => set({ software_version: v }),
  setTPMSFront: (psi) => set({ tpms_front_psi: Math.round(psi * 10) / 10 }),
  setTPMSRear: (psi) => set({ tpms_rear_psi: Math.round(psi * 10) / 10 }),

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

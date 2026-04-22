import { create } from 'zustand';
import { AssistMode, type BLEConnectionStatus, type BLEServiceStatus, type BikeBrand } from '../types/bike.types';

/** Individual light state (front or rear) */
export interface LightInfo {
  id: string;                 // Unique ID (device address or generated)
  name: string;               // Device name (e.g. "VS1800S", "LR60")
  position: 'front' | 'rear'; // Light position
  brand: 'igpsport' | 'garmin' | 'unknown';
  battery_pct: number;        // 0-100
  mode: number;               // LightMode enum value
  connected: boolean;
}

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
  power_sample_count: number;
  speed_max: number;

  // Heart rate (Phase 3)
  hr_bpm: number;
  hr_zone: number;
  spo2_pct: number;  // Live SpO2 from sensor (0 = no data)

  // Gear (Phase 3 - Di2 / Shimano STEPS)
  gear: number;
  is_shifting: boolean;
  di2_battery: number;
  shift_count: number;
  total_gears: number;

  // Device info
  firmware_version: string;
  hardware_version: string;
  software_version: string;

  // TPMS
  tpms_front_psi: number;
  tpms_rear_psi: number;

  // Accessories (lights + radar)
  lights: LightInfo[];                 // Multi-light: front + rear
  light_battery_pct: number;           // Legacy: first light battery (compat)
  light_mode: number;                  // Legacy: first light mode (compat)
  light_device_name: string;           // Legacy: first light name (compat)
  radar_threat_level: number; // 0=none, 1=low, 2=mid, 3=high
  radar_distance_m: number;
  radar_speed_kmh: number;

  // Phone sensors
  barometric_altitude_m: number;
  pressure_hpa: number;
  lean_angle_deg: number;
  temperature_c: number;
  light_lux: number;
  mag_heading_deg: number;
  gyro_x: number;
  gyro_y: number;
  gyro_z: number;
  crash_magnitude: number;
  last_crash_at: number;

  // Bike brand (detected on connect)
  bike_brand: BikeBrand;

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
  setLightLux: (lux: number) => void;
  setMagHeading: (deg: number) => void;
  setGyro: (x: number, y: number, z: number) => void;
  setCrash: (magnitude: number) => void;
  setFirmwareVersion: (v: string) => void;
  setHardwareVersion: (v: string) => void;
  setSoftwareVersion: (v: string) => void;
  setTPMSFront: (psi: number) => void;
  setTPMSRear: (psi: number) => void;
  setLightBattery: (pct: number) => void;
  setLightMode: (mode: number) => void;
  setLightDeviceName: (name: string) => void;
  // Multi-light actions
  addLight: (light: LightInfo) => void;
  removeLight: (id: string) => void;
  updateLight: (id: string, partial: Partial<LightInfo>) => void;
  setRadarTarget: (level: number, distanceM: number, speedKmh: number) => void;
  setShifting: (v: boolean) => void;
  setDi2Battery: (pct: number) => void;
  setShiftCount: (n: number) => void;
  setTotalGears: (n: number) => void;
  setBikeBrand: (brand: BikeBrand) => void;
  setBLEStatus: (status: BLEConnectionStatus) => void;
  setServiceConnected: (service: keyof BLEServiceStatus, connected: boolean) => void;
  resetSession: () => void;
  /** Batch multiple state updates into a single Zustand notify cycle (one re-render). */
  batchUpdate: (updates: Partial<Pick<BikeState,
    | 'battery_percent' | 'speed_kmh' | 'cadence_rpm' | 'power_watts' | 'assist_mode'
    | 'distance_km' | 'range_km' | 'range_per_mode' | 'range_estimated_modes'
    | 'odo_km' | 'service_interval_km' | 'battery_main_pct' | 'battery_sub_pct'
    | 'battery_voltage' | 'torque_nm' | 'assist_current_a' | 'calories'
    | 'elevation_gain_m' | 'front_gear' | 'rear_gear' | 'trip_distance_km'
    | 'trip_time_s' | 'motor_odo_km' | 'motor_total_hours' | 'error_code'
    | 'ride_time_s' | 'power_avg' | 'power_max' | 'power_sample_count' | 'speed_max'
    | 'hr_bpm' | 'hr_zone' | 'spo2_pct' | 'gear' | 'is_shifting'
    | 'di2_battery' | 'shift_count' | 'total_gears' | 'tpms_front_psi' | 'tpms_rear_psi'
    | 'radar_threat_level' | 'radar_distance_m' | 'radar_speed_kmh' | 'last_update_ms'
  >>) => void;
}

export const useBikeStore = create<BikeState>((set, get) => ({
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
  power_sample_count: 0,
  speed_max: 0,
  hr_bpm: 0,
  hr_zone: 0,
  spo2_pct: 0,
  gear: 0,
  is_shifting: false,
  di2_battery: 0,
  shift_count: 0,
  total_gears: 12,
  firmware_version: '',
  hardware_version: '',
  software_version: '',
  tpms_front_psi: 0,
  tpms_rear_psi: 0,
  lights: [],
  light_battery_pct: 0,
  light_mode: 0,
  light_device_name: '',
  radar_threat_level: 0,
  radar_distance_m: 0,
  radar_speed_kmh: 0,
  barometric_altitude_m: 0,
  pressure_hpa: 0,
  lean_angle_deg: 0,
  temperature_c: 0,
  light_lux: 0,
  mag_heading_deg: 0,
  gyro_x: 0,
  gyro_y: 0,
  gyro_z: 0,
  crash_magnitude: 0,
  last_crash_at: 0,
  bike_brand: 'giant' as BikeBrand,
  ble_status: 'disconnected',
  ble_services: {
    battery: false,
    csc: false,
    power: false,
    gev: false,
    sram: false,
    heartRate: false,
    di2: false,
    cadence: false,
    light: false,
    radar: false,
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
    set((state) => {
      const count = state.power_sample_count;
      return {
        power_watts: v,
        power_max: Math.max(state.power_max, v),
        power_avg: count > 0 ? (state.power_avg * count + v) / (count + 1) : v,
        power_sample_count: count + 1,
      };
    }),

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
  setSpO2: (pct: number) => set({ spo2_pct: pct }),

  setGear: (gear) => set({ gear, is_shifting: false }),

  setBarometer: (pressure, altitude) => set({
    pressure_hpa: Math.round(pressure * 10) / 10,
    barometric_altitude_m: Math.round(altitude * 10) / 10,
  }),

  setLeanAngle: (deg) => set({ lean_angle_deg: Math.round(deg * 10) / 10 }),
  setTemperature: (c) => set({ temperature_c: Math.round(c * 10) / 10 }),
  setLightLux: (lux: number) => set({ light_lux: Math.round(lux) }),
  setMagHeading: (deg: number) => set({ mag_heading_deg: Math.round(deg * 10) / 10 }),
  setGyro: (x: number, y: number, z: number) => set({ gyro_x: Math.round(x * 100) / 100, gyro_y: Math.round(y * 100) / 100, gyro_z: Math.round(z * 100) / 100 }),
  setCrash: (magnitude: number) => set({ crash_magnitude: Math.round(magnitude * 10) / 10, last_crash_at: Date.now() }),

  setFirmwareVersion: (v) => set({ firmware_version: v }),
  setHardwareVersion: (v) => set({ hardware_version: v }),
  setSoftwareVersion: (v) => set({ software_version: v }),
  setTPMSFront: (psi) => set({ tpms_front_psi: Math.round(psi * 10) / 10 }),
  setTPMSRear: (psi) => set({ tpms_rear_psi: Math.round(psi * 10) / 10 }),
  setLightBattery: (pct) => set({ light_battery_pct: pct }),
  setLightMode: (mode) => set({ light_mode: mode }),
  setLightDeviceName: (name) => set({ light_device_name: name }),

  // Multi-light actions
  addLight: (light) => set((s) => {
    // Replace if same position already exists
    const filtered = s.lights.filter((l) => l.position !== light.position);
    const lights = [...filtered, light];
    // Sync legacy fields from first connected light
    const first = lights.find((l) => l.connected) ?? lights[0];
    return {
      lights,
      ...(first ? { light_battery_pct: first.battery_pct, light_mode: first.mode, light_device_name: first.name } : {}),
    };
  }),

  removeLight: (id) => set((s) => {
    const lights = s.lights.filter((l) => l.id !== id);
    const first = lights.find((l) => l.connected) ?? lights[0];
    return {
      lights,
      light_battery_pct: first?.battery_pct ?? 0,
      light_mode: first?.mode ?? 0,
      light_device_name: first?.name ?? '',
    };
  }),

  updateLight: (id, partial) => set((s) => {
    const lights = s.lights.map((l) => l.id === id ? { ...l, ...partial } : l);
    // Sync legacy fields
    const first = lights.find((l) => l.connected) ?? lights[0];
    return {
      lights,
      ...(first ? { light_battery_pct: first.battery_pct, light_mode: first.mode, light_device_name: first.name } : {}),
    };
  }),

  setRadarTarget: (level, distanceM, speedKmh) => set({
    radar_threat_level: level,
    radar_distance_m: Math.round(distanceM * 10) / 10,
    radar_speed_kmh: Math.round(speedKmh),
  }),

  setShifting: (v) => set({ is_shifting: v }),
  setDi2Battery: (pct) => set({ di2_battery: pct }),
  setShiftCount: (n) => set({ shift_count: n }),
  setTotalGears: (n) => set({ total_gears: n }),

  setBikeBrand: (brand) => {
    const prev = get().bike_brand;
    if (prev === brand) return; // no-op guard breaks mutual import cycle
    set({ bike_brand: brand });
    // Also persist to active bike config
    import('./settingsStore').then(({ useSettingsStore }) => {
      const motorBrand = brand === 'unknown' ? 'other' : brand;
      const current = useSettingsStore.getState().bikeConfig.motor_brand;
      if (current !== motorBrand && motorBrand !== 'other') {
        useSettingsStore.getState().updateBikeConfig({ motor_brand: motorBrand as typeof current });
      }
    });
  },
  setBLEStatus: (status) => set({ ble_status: status }),

  setServiceConnected: (service, connected) =>
    set((state) => ({
      ble_services: { ...state.ble_services, [service]: connected },
    })),

  batchUpdate: (updates) => set(updates),

  resetSession: () =>
    set({
      distance_km: 0,
      ride_time_s: 0,
      power_avg: 0,
      power_max: 0,
      power_sample_count: 0,
      speed_max: 0,
      elevation_gain_m: 0,
    }),
}));

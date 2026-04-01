// === Assist Modes (Giant SyncDrive Pro — Trance X E+ 2 2023) ===
// Physical RideControl order: ECO → TOUR → ACTIVE → SPORT → POWER
// No AUTO on this model. WALK is hold-button only.
export enum AssistMode {
  OFF = 0,
  ECO = 1,
  TOUR = 2,
  ACTIVE = 3,
  SPORT = 4,
  POWER = 5,
  SMART = 6,  // Startup default — SyncDrive Pro smart assist, not in UP/DOWN cycle
}

export const ASSIST_MODE_LABELS: Record<AssistMode, string> = {
  [AssistMode.OFF]: 'OFF',
  [AssistMode.ECO]: 'ECO',
  [AssistMode.TOUR]: 'TOUR',
  [AssistMode.ACTIVE]: 'ACTIVE',
  [AssistMode.SPORT]: 'SPORT',
  [AssistMode.POWER]: 'PWR',
  [AssistMode.SMART]: 'SMART',
};

export const ASSIST_MODE_COLORS: Record<AssistMode, string> = {
  [AssistMode.OFF]: 'bg-gray-600',
  [AssistMode.ECO]: 'bg-green-600',
  [AssistMode.TOUR]: 'bg-blue-600',
  [AssistMode.ACTIVE]: 'bg-orange-500',
  [AssistMode.SPORT]: 'bg-yellow-600',
  [AssistMode.POWER]: 'bg-red-600',
  [AssistMode.SMART]: 'bg-purple-600',
};

// === CSC (Cycling Speed and Cadence) ===
export interface CSCState {
  wheelRevs: number;
  wheelTime: number;
  crankRevs: number;
  crankTime: number;
  distance_km: number;
}

export interface CSCResult {
  speed_kmh: number;
  cadence_rpm: number;
  distance_km: number;
}

// === Cycling Power ===
export interface PowerResult {
  power_watts: number;
}

// === BLE Connection State ===
export type BLEConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface BLEServiceStatus {
  battery: boolean;
  csc: boolean;
  power: boolean;
  gev: boolean;
  sram: boolean;
  heartRate: boolean;
  di2: boolean;
}

// === Bike Constants ===
export const WHEEL_CIRCUMFERENCE_MM = 2290; // 29" wheel
export const WHEEL_CIRCUMFERENCE_M = WHEEL_CIRCUMFERENCE_MM / 1000;

// === Giant Smart Gateway ===
export const GIANT_DEVICE_NAME = 'GBHA25704';

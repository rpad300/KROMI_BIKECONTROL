// === Bike Brand ===
export type BikeBrand = 'giant' | 'bosch' | 'shimano' | 'specialized' | 'fazua' | 'yamaha' | 'unknown';

// === Assist Modes (normalized 0-6, shared across all brands) ===
// Each brand maps its native modes to this normalized scale.
export enum AssistMode {
  OFF = 0,
  ECO = 1,     // Lowest assist (all brands)
  TOUR = 2,    // Giant: TOUR, Bosch: TOUR, Shimano: TRAIL, Specialized: TRAIL
  ACTIVE = 3,  // Giant: ACTIVE, Bosch: SPORT, Shimano: —, Specialized: —
  SPORT = 4,   // Giant: SPORT, Bosch: TURBO, Shimano: BOOST, Specialized: TURBO
  POWER = 5,   // Giant: POWER (KROMI), Bosch: —, Shimano: —, Specialized: —
  SMART = 6,   // Giant: SMART (native auto)
}

/** Brand-specific mode labels (indexed by AssistMode value) */
export const BRAND_MODE_LABELS: Record<BikeBrand, Record<number, string>> = {
  giant:       { 0: 'MAN', 1: 'ECO', 2: 'TOUR', 3: 'ACTIVE', 4: 'SPORT', 5: 'KROMI', 6: 'SMART' },
  bosch:       { 0: 'OFF', 1: 'ECO', 2: 'TOUR', 3: 'SPORT', 4: 'TURBO' },
  shimano:     { 0: 'OFF', 1: 'ECO', 2: 'TRAIL', 3: 'BOOST' },
  specialized: { 0: 'OFF', 1: 'ECO', 2: 'TRAIL', 3: 'TURBO' },
  fazua:       { 0: 'OFF', 1: 'RIVER', 2: 'VALLEY', 3: 'PEAK' },
  yamaha:      { 0: 'OFF', 1: 'ECO', 2: 'STD', 3: 'HIGH', 4: 'EXPW' },
  unknown:     { 0: 'OFF', 1: 'ECO', 2: 'MID', 3: 'HIGH' },
};

/** Brand-specific max assist mode (how many modes) */
export const BRAND_MAX_MODE: Record<BikeBrand, number> = {
  giant: 6, bosch: 4, shimano: 3, specialized: 3, fazua: 3, yamaha: 4, unknown: 3,
};

// Default labels (Giant, for backwards compatibility)
export const ASSIST_MODE_LABELS: Record<AssistMode, string> = {
  [AssistMode.OFF]: 'MAN',
  [AssistMode.ECO]: 'ECO',
  [AssistMode.TOUR]: 'TOUR',
  [AssistMode.ACTIVE]: 'ACTIVE',
  [AssistMode.SPORT]: 'SPORT',
  [AssistMode.POWER]: 'KROMI',
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

/**
 * Map native brand mode to normalized AssistMode.
 * Each brand's native mode values → our universal 0-6 scale.
 */
export function mapNativeToAssistMode(brand: BikeBrand, nativeMode: number): AssistMode {
  switch (brand) {
    case 'giant': return nativeMode as AssistMode; // Giant uses our enum directly
    case 'bosch': // Bosch: 1=ECO, 2=TOUR, 3=SPORT→ACTIVE, 4=TURBO→SPORT
      return [AssistMode.OFF, AssistMode.ECO, AssistMode.TOUR, AssistMode.ACTIVE, AssistMode.SPORT][nativeMode] ?? AssistMode.OFF;
    case 'shimano': // Shimano: 1=ECO, 2=TRAIL→TOUR, 3=BOOST→SPORT
      return [AssistMode.OFF, AssistMode.ECO, AssistMode.TOUR, AssistMode.SPORT][nativeMode] ?? AssistMode.OFF;
    case 'specialized': // Specialized: 0=ECO, 1=TRAIL→TOUR, 2=TURBO→SPORT
      return [AssistMode.ECO, AssistMode.TOUR, AssistMode.SPORT][nativeMode] ?? AssistMode.ECO;
    default: return Math.min(nativeMode, AssistMode.SMART) as AssistMode;
  }
}

/**
 * Map normalized AssistMode back to brand-native mode value.
 */
export function mapAssistToNative(brand: BikeBrand, mode: AssistMode): number {
  switch (brand) {
    case 'giant': return mode;
    case 'bosch':
      return { [AssistMode.OFF]: 0, [AssistMode.ECO]: 1, [AssistMode.TOUR]: 2, [AssistMode.ACTIVE]: 3, [AssistMode.SPORT]: 4, [AssistMode.POWER]: 4, [AssistMode.SMART]: 4 }[mode] ?? 0;
    case 'shimano':
      return { [AssistMode.OFF]: 0, [AssistMode.ECO]: 1, [AssistMode.TOUR]: 2, [AssistMode.ACTIVE]: 2, [AssistMode.SPORT]: 3, [AssistMode.POWER]: 3, [AssistMode.SMART]: 3 }[mode] ?? 0;
    case 'specialized':
      return { [AssistMode.OFF]: 0, [AssistMode.ECO]: 0, [AssistMode.TOUR]: 1, [AssistMode.ACTIVE]: 1, [AssistMode.SPORT]: 2, [AssistMode.POWER]: 2, [AssistMode.SMART]: 2 }[mode] ?? 0;
    default: return mode;
  }
}

/** Get mode label for a specific brand + mode combination */
export function getModeLabel(brand: BikeBrand, mode: AssistMode): string {
  return BRAND_MODE_LABELS[brand]?.[mode] ?? ASSIST_MODE_LABELS[mode] ?? `Mode ${mode}`;
}

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
  cadence: boolean;
  light: boolean;
  radar: boolean;
}

// === Bike Constants ===
export const WHEEL_CIRCUMFERENCE_MM = 2290; // 29" wheel
export const WHEEL_CIRCUMFERENCE_M = WHEEL_CIRCUMFERENCE_MM / 1000;

// === Giant Smart Gateway ===
export const GIANT_DEVICE_NAME = 'GBHA25704';

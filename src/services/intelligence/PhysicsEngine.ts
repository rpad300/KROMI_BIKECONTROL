/**
 * PhysicsEngine — pure force model for e-bike motor control.
 *
 * Calculates: Frr (rolling), Faero (aero+wind), Fg (gravity), P_total, P_human.
 * All functions are stateless — state lives in KromiEngine.
 *
 * Rider mass and bike mass are configurable via settingsStore (riderProfile.weight_kg
 * and bikeConfig.weight_kg). Default: 135kg + 24kg = 159kg total.
 * Motor: Shimano EP800, max 85Nm, EU 25km/h cutoff with fade from 22km/h
 *
 * NOTE: Giant Trance X E+ 2 (Shimano EP800) does NOT support regenerative
 * braking. Motor assist is one-way only. On descents, motor cuts to 0%
 * and the rider relies on mechanical brakes. Battery does not recharge
 * during descent. This is a hardware limitation of the EP800 motor.
 * Future motors (EP801+) may support limited regen — add motorSupportsRegen
 * flag to bike config when available.
 */

// ── Constants ──────────────────────────────────────────────────

const G = 9.81;
const SPEED_LIMIT_KMH = 25;
const FADE_START_KMH = 22;
const SPEED_HYSTERESIS_KMH = 1.0;

// ── CDA Presets (Drag Coefficient × Frontal Area) ─────────────

/** CDA presets for different bike positions (m²) */
export const CDA_PRESETS = {
  mtb_upright: 0.6,      // Mountain bike, upright position (default)
  mtb_aero: 0.45,        // Mountain bike, tucked position
  road_hoods: 0.35,      // Road bike, hands on hoods
  road_drops: 0.30,      // Road bike, drops position
  road_aero: 0.25,       // Road bike, aero bars/TT
  gravel: 0.50,          // Gravel bike, upright
} as const;

export type CdaPreset = keyof typeof CDA_PRESETS;

// ── Surface Rolling Resistance ────────────────────────────────

/** Surface → rolling resistance coefficient */
export const CRR_TABLE: Record<string, number> = {
  paved: 0.004,      // smooth asphalt
  gravel: 0.006,     // packed gravel
  dirt: 0.009,       // hardpack dirt/forest road
  technical: 0.012,  // rocky/rooty singletrack
  mud: 0.015,        // wet/muddy conditions
  sand: 0.020,       // beach/deep sand
  unknown: 0.006,
};

// ── Wheel Circumference Presets ───────────────────────────────

/** Wheel size → circumference in mm */
export const WHEEL_PRESETS: Record<string, number> = {
  '29x2.4': 2290,    // mm — Giant Trance X E+ default
  '29x2.2': 2260,    // mm
  '29x2.6': 2320,    // mm
  '27.5x2.4': 2180,  // mm
  '27.5x2.8': 2240,  // mm
  '27.5x2.2': 2150,  // mm
  '26x2.2': 2060,    // mm
  '700x25c': 2105,   // mm — road bike
  '700x28c': 2136,   // mm
  '700x32c': 2155,   // mm
};

// ── Power Source Tracking ──────────────────────────────────────

/** Distinguishes motor-estimated power from pedal power meter */
export interface PowerSource {
  type: 'pedal_power_meter' | 'motor_estimated' | 'none';
  value: number;        // watts
  confidence: number;   // 0-1
}

// ── Types ──────────────────────────────────────────────────────

export interface PhysicsInput {
  speed_kmh: number;
  gradient_pct: number;
  cadence_rpm: number;
  power_watts: number;        // from power meter (0 if unavailable)
  power_source?: 'pedal' | 'motor' | undefined;  // source of power_watts
  currentGear: number;        // 1-12, 0=unknown
  totalMass: number;          // kg (rider + bike)
  wheelCircumM: number;       // meters
  chainring: number;          // teeth
  sprockets: number[];        // descending: gear1=biggest
  crr: number;                // effective rolling resistance
  cda: number;                // drag coefficient × frontal area (m²)
  airDensity: number;         // kg/m³
  windComponent: number;      // m/s headwind(+) tailwind(-)
  tire_pressure_bar?: number; // tire pressure for Crr adjustment
  /** Gap #15: Regional compliance override for speed limits */
  compliance_speedLimit_kmh?: number;
  compliance_fadeStart_kmh?: number;
  compliance_hardCutoff?: boolean;
}

export interface PhysicsOutput {
  /** Total resistance force (N). Negative on steep descents. */
  F_total: number;
  F_gravity: number;
  F_rolling: number;
  F_aero: number;
  /** Total power to maintain speed (W). Clamped ≥ 0. */
  P_total: number;
  /** Estimated human power output (W) */
  P_human: number;
  /** Power source metadata (type, confidence) */
  powerSource: PowerSource;
  /** Power gap the motor must fill (W). 0 when motor off. */
  P_motor_gap: number;
  /** Speed zone: active(<22), fade(22-25), free(>25) */
  speedZone: 'active' | 'fade' | 'free';
  /** Motor fade factor: 1.0 (full) → 0.0 (off) */
  fadeFactor: number;
  /** Estimated cadence (from speed+gear when sensor reads 0) */
  cadence_effective: number;
  /** True if cadence < 65 rpm — signal for gear suggestion */
  inefficient_gear: boolean;
  /** Gear ratio in use */
  gearRatio: number;
}

// ── Gap #8: Speed Fade Zone with Hysteresis + Gradient Awareness ──

/**
 * Stateful speed zone calculator with hysteresis to prevent zone flicker
 * at the fade boundary and gradient-aware fade reduction on climbs.
 */
class SpeedZoneCalculator {
  private lastSpeedZone: 'active' | 'fade' | 'free' = 'active';

  getSpeedZone(speed_kmh: number, gradient_pct: number): { zone: 'active' | 'fade' | 'free'; fadeFactor: number } {
    // Hysteresis: use different thresholds depending on current zone
    const effectiveFadeStart = this.lastSpeedZone === 'active'
      ? FADE_START_KMH + SPEED_HYSTERESIS_KMH / 2   // 22.5 to enter fade
      : FADE_START_KMH - SPEED_HYSTERESIS_KMH / 2;  // 21.5 to leave fade

    // Gradient-aware fade: on climbs, motor is more important → reduce fade
    let gradientBoost = 0;
    if (gradient_pct > 3) {
      gradientBoost = Math.min(0.3, gradient_pct * 0.03); // up to 30% fade reduction on climbs
    }

    let zone: 'active' | 'fade' | 'free';
    let fadeFactor: number;

    if (speed_kmh >= SPEED_LIMIT_KMH) {
      zone = 'free';
      fadeFactor = 0;
    } else if (speed_kmh >= effectiveFadeStart) {
      zone = 'fade';
      const rawFade = (SPEED_LIMIT_KMH - speed_kmh) / (SPEED_LIMIT_KMH - FADE_START_KMH);
      fadeFactor = Math.min(1, rawFade + gradientBoost);
    } else {
      zone = 'active';
      fadeFactor = 1;
    }

    this.lastSpeedZone = zone;
    return { zone, fadeFactor };
  }

  reset(): void {
    this.lastSpeedZone = 'active';
  }
}

/** Singleton speed zone calculator (stateful for hysteresis) */
const speedZoneCalc = new SpeedZoneCalculator();

/** Reset speed zone state (call on new ride) */
export function resetSpeedZone(): void {
  speedZoneCalc.reset();
}

// ── Core Functions ─────────────────────────────────────────────

/** Calculate all resistive forces and power split */
export function computeForces(input: PhysicsInput): PhysicsOutput {
  const speedMs = input.speed_kmh / 3.6;
  const gradRad = Math.atan(input.gradient_pct / 100);

  // Adjust Crr for tire pressure if provided
  const effectiveCrr = input.tire_pressure_bar != null
    ? adjustCrrForPressure(input.crr, input.tire_pressure_bar)
    : input.crr;

  // Forces (Newtons)
  const F_gravity = input.totalMass * G * Math.sin(gradRad);
  const F_rolling = effectiveCrr * input.totalMass * G * Math.cos(gradRad);
  const effectiveSpeed = speedMs + input.windComponent;
  const cda = input.cda ?? CDA_PRESETS.mtb_upright;
  const F_aero = 0.5 * input.airDensity * cda * effectiveSpeed * Math.abs(effectiveSpeed);
  const F_total = F_gravity + F_rolling + F_aero;

  // Power to maintain speed
  const P_total = Math.max(0, F_total * speedMs);

  // Speed zone model — Gap #8: hysteresis + gradient-aware
  // Gap #15: Regional compliance overrides (default: EU 25km/h)
  let speedZone: PhysicsOutput['speedZone'];
  let fadeFactor: number;

  if (input.compliance_speedLimit_kmh != null) {
    const limit = input.compliance_speedLimit_kmh;
    const fadeStart = input.compliance_fadeStart_kmh ?? (limit - 3);
    const hardCutoff = input.compliance_hardCutoff ?? false;

    if (input.speed_kmh >= limit) {
      speedZone = 'free';
      fadeFactor = 0;
    } else if (input.speed_kmh > fadeStart) {
      speedZone = 'fade';
      fadeFactor = hardCutoff ? 0 : (limit - input.speed_kmh) / (limit - fadeStart);
    } else {
      speedZone = 'active';
      fadeFactor = 1;
    }
  } else {
    const szResult = speedZoneCalc.getSpeedZone(input.speed_kmh, input.gradient_pct);
    speedZone = szResult.zone;
    fadeFactor = szResult.fadeFactor;
  }

  // Gear ratio
  const sprocketIdx = input.currentGear > 0 ? input.currentGear - 1 : 5; // default mid
  const sprocket = sprocketIdx < input.sprockets.length ? input.sprockets[sprocketIdx]! : 20;
  const gearRatio = input.chainring / sprocket;

  // Cadence: use sensor if available, else estimate from speed+gear
  let cadence_effective = input.cadence_rpm;
  if (cadence_effective <= 0 && input.speed_kmh > 2 && input.currentGear > 0) {
    cadence_effective = (speedMs * 60) / (gearRatio * input.wheelCircumM);
  }

  // Human power estimate with source tracking
  const powerSource = getHumanPower(input, cadence_effective, gearRatio);
  const P_human = powerSource.value;

  // Motor gap (only when motor is active)
  // NOTE: No regen — on descents motor cuts to 0%, battery does NOT recharge
  const P_motor_gap = fadeFactor > 0 ? Math.max(0, P_total - P_human) : 0;

  return {
    F_total, F_gravity, F_rolling, F_aero,
    P_total, P_human, powerSource, P_motor_gap,
    speedZone, fadeFactor,
    cadence_effective,
    inefficient_gear: cadence_effective > 0 && cadence_effective < 65,
    gearRatio,
  };
}

/**
 * Get human power with source tracking.
 * Priority: 1) Pedal power meter, 2) Motor-estimated, 3) Cadence+gear estimate.
 * The W' model should use different confidence weights based on source type.
 */
function getHumanPower(
  input: PhysicsInput,
  cadence: number,
  gearRatio: number,
): PowerSource {
  // Priority 1: Pedal power meter (BLE Power Service 0x1818)
  if (input.power_source === 'pedal' && input.power_watts > 0 && input.power_watts < 600) {
    return { type: 'pedal_power_meter', value: input.power_watts, confidence: 0.95 };
  }

  // Priority 2: Motor-estimated power (FC23 telemetry)
  if (input.power_watts > 0 && input.power_watts < 600) {
    return { type: 'motor_estimated', value: input.power_watts, confidence: 0.6 };
  }

  // Priority 3: Estimate from cadence + gear
  const estimated = estimateFromCadence(input, cadence, gearRatio);
  return { type: 'none', value: estimated, confidence: 0.3 };
}

/** Estimate rider power from cadence + gear when no power meter is available */
function estimateFromCadence(
  input: PhysicsInput,
  cadence: number,
  gearRatio: number,
): number {
  // Filter sensor noise: need meaningful speed AND cadence
  if (input.speed_kmh < 5 || cadence < 20) return 0;
  // Consistency: expected speed from cadence×gear vs actual (reject >2x mismatch)
  const expectedSpeedKmh = (cadence * gearRatio * input.wheelCircumM * 60) / 1000;
  if (expectedSpeedKmh > 0 && (input.speed_kmh / expectedSpeedKmh > 2 || input.speed_kmh / expectedSpeedKmh < 0.5)) return 0;

  const riderWeightKg = input.totalMass - 24;
  const cadenceFactor = cadence < 60 ? 1.2 : cadence < 80 ? 1.0 : 0.85;
  const pedalTorqueNm = riderWeightKg * 0.015 * cadenceFactor * gearRatio;
  return pedalTorqueNm * (2 * Math.PI * cadence / 60);
}

/**
 * Adjust Crr based on tire pressure.
 * Lower pressure = more rolling resistance.
 * Reference: 2.0 bar (29 psi) is the baseline for MTB.
 */
export function adjustCrrForPressure(baseCrr: number, pressureBar: number): number {
  const referencePressure = 2.0; // bar
  // Every 0.5 bar below reference adds ~15% to Crr
  const pressureFactor = 1 + (referencePressure - pressureBar) * 0.3;
  return baseCrr * Math.max(0.7, Math.min(1.5, pressureFactor));
}

/**
 * Auto-detect terrain type from speed variance.
 * High variance at low speed = technical terrain.
 */
export function autoDetectTerrain(speedVariance: number, avgSpeed: number): string {
  if (avgSpeed > 25) return 'paved';
  if (speedVariance > 5 && avgSpeed < 12) return 'technical';
  if (speedVariance > 3) return 'dirt';
  return 'gravel';
}

/**
 * Giant Trance X E+ 2 dual battery system:
 * - Battery 1 (internal, 800Wh nominal): Mounted in the downtube, ~76% of total capacity
 * - Battery 2 (range extender, 250Wh nominal): External, ~24% of total capacity
 * - Combined formula: weighted average reflecting capacity ratio
 * - If only one battery present: bat2 reads 0, formula degrades to bat1 only
 * - Failure mode: if bat1 fails, combined SOC drops to ~24% (bat2 only)
 *
 * NOTE: The 800/250 values are the nominal Wh ratings from Giant. The actual
 * capacity is read from bikeConfig (main_battery_wh / sub_battery_wh) to
 * support other bikes with different battery sizes.
 */
export function combinedBatterySOC(bat1: number, bat2: number, mainWh = 800, subWh = 250): number {
  const totalWh = mainWh + subWh;
  if (totalWh <= 0) return bat1;
  return (bat1 * mainWh + bat2 * subWh) / totalWh;
}

/** Calculate air density from temperature */
export function airDensityFromTemp(temp_c: number): number {
  return 1.225 * (273.15 / (273.15 + temp_c));
}

/** Project wind speed onto rider heading → headwind component (m/s) */
export function windHeadComponent(
  wind_speed_kmh: number,
  wind_dir_deg: number,
  rider_heading_deg: number,
): number {
  const angleDiff = ((wind_dir_deg - rider_heading_deg + 180) % 360) - 180;
  const angleRad = (angleDiff * Math.PI) / 180;
  return (wind_speed_kmh / 3.6) * Math.cos(angleRad);
}

/** Map TerrainService category to Crr */
export function surfaceToCrr(category: string | null): number {
  if (!category) return CRR_TABLE.unknown!;
  return CRR_TABLE[category] ?? CRR_TABLE.unknown!;
}

// ── Gap #11: Wind Estimation from Power Surplus ───────────────

/**
 * Estimate headwind from power surplus vs expected speed.
 * Only works when power meter data is available (power_w > 0).
 * Returns 0 if no power meter.
 *
 * Logic: calculate expected speed from power + gradient (no wind),
 * then attribute the speed difference to wind.
 */
export function estimateHeadwind(
  speed_kmh: number,
  power_w: number,
  gradient_pct: number,
  mass_kg: number,
  cda: number = CDA_PRESETS.mtb_upright,
): number {
  if (power_w <= 0 || speed_kmh < 2) return 0;

  const expectedSpeed = speedFromPowerNoWind(power_w, gradient_pct, mass_kg, cda);
  if (expectedSpeed <= 0) return 0;

  // Difference between expected and actual = wind effect (km/h)
  const estimatedWind = expectedSpeed - speed_kmh; // positive = headwind
  return Math.max(-30, Math.min(30, estimatedWind)); // clamp +/- 30 km/h
}

/**
 * Inverse model: estimate speed from power on a given gradient, assuming no wind.
 * Uses iterative Newton's method to solve: P = F_total(v) * v for v.
 */
function speedFromPowerNoWind(
  power_w: number,
  gradient_pct: number,
  mass_kg: number,
  cda: number,
): number {
  if (power_w <= 0) return 0;

  const gradRad = Math.atan(gradient_pct / 100);
  const Fg = mass_kg * G * Math.sin(gradRad);
  const Frr = CRR_TABLE.unknown! * mass_kg * G * Math.cos(gradRad);
  const rho = 1.225; // default air density

  // Newton's method: solve P = (Fg + Frr + 0.5*rho*cda*v^2) * v
  let v = power_w / Math.max(1, Fg + Frr + 50); // initial guess (m/s)
  v = Math.max(0.5, Math.min(15, v)); // clamp initial guess

  for (let i = 0; i < 10; i++) {
    const Faero = 0.5 * rho * cda * v * v;
    const Ftotal = Fg + Frr + Faero;
    const Pest = Ftotal * v;
    const dPdv = Ftotal + rho * cda * v * v; // derivative of P w.r.t v

    if (Math.abs(dPdv) < 0.01) break;
    const vNew = v - (Pest - power_w) / dPdv;
    if (Math.abs(vNew - v) < 0.01) { v = vNew; break; }
    v = Math.max(0.1, vNew);
  }

  return v * 3.6; // m/s to km/h
}

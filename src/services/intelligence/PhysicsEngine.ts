/**
 * PhysicsEngine — pure force model for e-bike motor control.
 *
 * Calculates: Frr (rolling), Faero (aero+wind), Fg (gravity), P_total, P_human.
 * All functions are stateless — state lives in KromiEngine.
 *
 * Rider: 135kg + bike 24kg = 159kg total
 * Motor: Shimano EP800, max 85Nm, EU 25km/h cutoff with fade from 22km/h
 */

// ── Constants ──────────────────────────────────────────────────

const G = 9.81;
const CDA_MTB = 0.6;             // m² — upright MTB position
const SPEED_LIMIT_KMH = 25;
const FADE_START_KMH = 22;

/** Surface → rolling resistance coefficient */
export const CRR_TABLE: Record<string, number> = {
  paved: 0.004,
  gravel: 0.006,
  dirt: 0.009,
  technical: 0.011,
  unknown: 0.006,
};

// ── Types ──────────────────────────────────────────────────────

export interface PhysicsInput {
  speed_kmh: number;
  gradient_pct: number;
  cadence_rpm: number;
  power_watts: number;        // from power meter (0 if unavailable)
  currentGear: number;        // 1-12, 0=unknown
  totalMass: number;          // kg (rider + bike)
  wheelCircumM: number;       // meters
  chainring: number;          // teeth
  sprockets: number[];        // descending: gear1=biggest
  crr: number;                // effective rolling resistance
  airDensity: number;         // kg/m³
  windComponent: number;      // m/s headwind(+) tailwind(-)
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

// ── Core Functions ─────────────────────────────────────────────

/** Calculate all resistive forces and power split */
export function computeForces(input: PhysicsInput): PhysicsOutput {
  const speedMs = input.speed_kmh / 3.6;
  const gradRad = Math.atan(input.gradient_pct / 100);

  // Forces (Newtons)
  const F_gravity = input.totalMass * G * Math.sin(gradRad);
  const F_rolling = input.crr * input.totalMass * G * Math.cos(gradRad);
  const effectiveSpeed = speedMs + input.windComponent;
  const F_aero = 0.5 * input.airDensity * CDA_MTB * effectiveSpeed * Math.abs(effectiveSpeed);
  const F_total = F_gravity + F_rolling + F_aero;

  // Power to maintain speed
  const P_total = Math.max(0, F_total * speedMs);

  // Speed zone model (EU 25km/h cutoff)
  let fadeFactor = 1.0;
  let speedZone: PhysicsOutput['speedZone'] = 'active';
  if (input.speed_kmh >= SPEED_LIMIT_KMH) {
    fadeFactor = 0;
    speedZone = 'free';
  } else if (input.speed_kmh > FADE_START_KMH) {
    fadeFactor = (SPEED_LIMIT_KMH - input.speed_kmh) / (SPEED_LIMIT_KMH - FADE_START_KMH);
    speedZone = 'fade';
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

  // Human power estimate
  let P_human = estimateHumanPower(input, cadence_effective, gearRatio);

  // Motor gap (only when motor is active)
  const P_motor_gap = fadeFactor > 0 ? Math.max(0, P_total - P_human) : 0;

  return {
    F_total, F_gravity, F_rolling, F_aero,
    P_total, P_human, P_motor_gap,
    speedZone, fadeFactor,
    cadence_effective,
    inefficient_gear: cadence_effective > 0 && cadence_effective < 65,
    gearRatio,
  };
}

/** Estimate rider power from cadence + gear, or use power meter */
function estimateHumanPower(
  input: PhysicsInput,
  cadence: number,
  gearRatio: number,
): number {
  // Prefer power meter if available and plausible
  if (input.power_watts > 0 && input.power_watts < 600) {
    return input.power_watts;
  }

  // Estimate from cadence + gear ratio + rider weight
  if (cadence <= 0) return 0;

  const riderWeightKg = input.totalMass - 24; // approximate bike weight
  const cadenceFactor = cadence < 60 ? 1.2 : cadence < 80 ? 1.0 : 0.85;
  const pedalTorqueNm = riderWeightKg * 0.015 * cadenceFactor * gearRatio;
  return pedalTorqueNm * (2 * Math.PI * cadence / 60);
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

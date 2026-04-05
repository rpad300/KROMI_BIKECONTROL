import { useEffect, useRef } from 'react';
import { useBikeStore } from '../store/bikeStore';
import { useMapStore } from '../store/mapStore';
import { useAutoAssistStore } from '../store/autoAssistStore';
import { useSettingsStore, safeBikeConfig } from '../store/settingsStore';
import { useIntelligenceStore } from '../store/intelligenceStore';
import { autoAssistEngine } from '../services/autoAssist/AutoAssistEngine';
import { tuningIntelligence, type TuningInput } from '../services/motor/TuningIntelligence';
import { setAdvancedTuning, isTuningAvailable } from '../services/bluetooth/BLEBridge';
import { AssistMode } from '../types/bike.types';
// encodeCalibration no longer needed — KROMI only changes POWER level

const TICK_INTERVAL_MS = 1000;

// Track last sent values to avoid redundant writes
let lastAdvancedTuning = { support: -1, torque: -1, launch: -1 };

// Motor tuning ranges (from Giant RideControl → SyncDrive Pro)
const SUPPORT_MIN = 50;   // 50%
const SUPPORT_MAX = 350;  // 350%
const TORQUE_MIN = 20;    // 20 Nm
const TORQUE_MAX = 85;    // 85 Nm
const LAUNCH_MIN = 1;     // level 1
const LAUNCH_MAX = 7;     // level 7

// Map a real value to wire 0-15
function toWire(value: number, min: number, max: number): number {
  const clamped = Math.max(min, Math.min(max, value));
  return Math.round(((clamped - min) / (max - min)) * 15);
}

/**
 * KROMI Physics Engine — calculates exact motor parameters from real data.
 *
 * Uses: gradient, speed, cadence, gear ratio, rider weight, bike weight,
 * HR zones, wheel circumference — to compute the physics of what the
 * rider needs from the motor.
 *
 * Returns: support % (50-350), torque Nm (20-85), launch level (1-7)
 */
function computeKromiPhysics(input: TuningInput): { supportPct: number; torqueNm: number; launchLvl: number; score: number } {
  const settings = useSettingsStore.getState();
  const rider = settings.riderProfile;
  const bike = safeBikeConfig(settings.bikeConfig);

  const riderWeightKg = rider.weight_kg || 80;
  const bikeWeightKg = bike.weight_kg || 24;
  const totalMass = riderWeightKg + bikeWeightKg;
  const wheelCircumM = (bike.wheel_circumference_mm || 2290) / 1000;
  const speedLimitKmh = bike.speed_limit_kmh || 25;
  const chainring = parseInt(bike.chainring_teeth?.replace(/\D/g, '') || '34') || 34;
  const sprockets = bike.cassette_sprockets?.length >= 2
    ? [...bike.cassette_sprockets].sort((a, b) => b - a) // gear 1 = biggest sprocket
    : [51, 45, 39, 34, 30, 26, 23, 20, 17, 15, 13, 10];

  const speedMs = input.speed / 3.6;
  const gradientRad = Math.atan(input.gradient / 100);

  // ── 1. RESISTANCE FORCES (Newtons) ──
  const gravity = totalMass * 9.81 * Math.sin(gradientRad);  // climbing force
  const rolling = totalMass * 9.81 * 0.006 * Math.cos(gradientRad); // Crr ≈ 0.006 MTB
  const aero = 0.5 * 1.2 * 0.6 * speedMs * speedMs; // CdA ≈ 0.6 for MTB upright
  const totalResistance = gravity + rolling + aero; // can be negative on descent

  // ── 2. POWER NEEDED to maintain speed (Watts) ──
  const powerNeeded = Math.max(0, totalResistance * speedMs);

  // ── 3. RIDER POWER ESTIMATE (from cadence + gear ratio) ──
  let riderPowerW = 0;
  if (input.cadence > 0 && input.currentGear > 0) {
    const sprocketIdx = input.currentGear - 1;
    const sprocket = sprocketIdx < sprockets.length ? sprockets[sprocketIdx]! : 20;
    const gearRatio = chainring / sprocket;
    // Pedal torque estimate: ~1.2 Nm per kg at moderate effort, scaled by cadence
    // At 60rpm sweet spot ≈ baseline, lower cadence = more torque per stroke
    const cadenceFactor = input.cadence < 60 ? 1.2 : input.cadence < 80 ? 1.0 : 0.85;
    const pedalTorqueNm = riderWeightKg * 0.015 * cadenceFactor * gearRatio;
    riderPowerW = pedalTorqueNm * (2 * Math.PI * input.cadence / 60);
    // Sanity: use actual power if available and plausible
    if (input.riderPower > 0 && input.riderPower < 500) {
      riderPowerW = input.riderPower;
    }
  }

  // ── 4. MOTOR POWER GAP ──
  const motorPowerNeeded = Math.max(0, powerNeeded - riderPowerW);

  // ── 5. HR EFFORT MODIFIER ──
  // If HR is high, rider is struggling → increase support
  // If HR is low, rider is comfortable → decrease support
  let hrModifier = 1.0;
  if (input.hr > 0) {
    if (input.hr > 160) hrModifier = 1.4;       // struggling hard
    else if (input.hr > 140) hrModifier = 1.2;  // high effort
    else if (input.hr > 120) hrModifier = 1.05; // moderate
    else if (input.hr < 90) hrModifier = 0.6;   // very comfortable
    else if (input.hr < 110) hrModifier = 0.8;  // comfortable
  }

  // ── 6. SPEED LIMIT TAPER ──
  // Gradually reduce as approaching e-bike speed limit
  let speedTaper = 1.0;
  if (input.speed > speedLimitKmh - 3) {
    speedTaper = Math.max(0.1, (speedLimitKmh - input.speed) / 3);
  }

  // ── 7. CALCULATE SUPPORT % ──
  // Support = ratio of motor power to rider power
  let supportPct = SUPPORT_MIN; // baseline minimum
  if (riderPowerW > 10) {
    const rawSupport = (motorPowerNeeded / riderPowerW) * 100 * hrModifier * speedTaper;
    supportPct = Math.max(SUPPORT_MIN, Math.min(SUPPORT_MAX, rawSupport));
  } else if (powerNeeded > 20) {
    // Not pedalling but needs power (steep start) → high support
    supportPct = Math.min(SUPPORT_MAX, 200 * hrModifier);
  }

  // Descent: minimal support
  if (input.gradient < -3) {
    supportPct = Math.min(supportPct, SUPPORT_MIN + 20);
  }

  // ── 8. CALCULATE TORQUE Nm ──
  // Based on resistance + gradient
  let torqueNm = TORQUE_MIN;
  if (totalResistance > 0) {
    // Motor torque needed at wheel
    const wheelRadius = wheelCircumM / (2 * Math.PI);
    const motorTorqueNeeded = (totalResistance * wheelRadius) * hrModifier * speedTaper;
    torqueNm = Math.max(TORQUE_MIN, Math.min(TORQUE_MAX, motorTorqueNeeded));
  }
  // Grinding uphill: boost torque
  if (input.cadence > 0 && input.cadence < 50 && input.gradient > 3) {
    torqueNm = Math.min(TORQUE_MAX, torqueNm * 1.3);
  }

  // ── 9. CALCULATE LAUNCH ──
  let launchLvl = 3; // neutral
  if (input.speed < 3 && input.gradient > 5) launchLvl = 7; // steep hill start
  else if (input.speed < 3 && input.gradient > 2) launchLvl = 5; // hill start
  else if (input.speed < 5) launchLvl = 4; // normal start
  else if (input.speed > 20) launchLvl = 1; // cruising, no launch needed

  // ── 10. OVERALL SCORE for logging ──
  const score = Math.round(((supportPct - SUPPORT_MIN) / (SUPPORT_MAX - SUPPORT_MIN)) * 100);

  return { supportPct, torqueNm, launchLvl, score };
}

// Simple GPS-based gradient from altitude changes over time
// More reliable than depending on Elevation API which may fail
const gradientHistory: { alt: number; ts: number }[] = [];
function getGpsGradient(altitude: number | null, speedKmh: number): number {
  if (!altitude || altitude === 0 || speedKmh < 1) return 0;
  const now = Date.now();
  gradientHistory.push({ alt: altitude, ts: now });
  // Keep 10s window
  while (gradientHistory.length > 0 && now - gradientHistory[0]!.ts > 10000) {
    gradientHistory.shift();
  }
  if (gradientHistory.length < 2) return 0;
  const first = gradientHistory[0]!;
  const last = gradientHistory[gradientHistory.length - 1]!;
  const dtSec = (last.ts - first.ts) / 1000;
  if (dtSec < 2) return 0; // need at least 2s of data
  const dAlt = last.alt - first.alt; // meters
  // Estimate horizontal distance from speed × time
  const dDistM = (speedKmh / 3.6) * dtSec;
  if (dDistM < 3) return 0;
  const grad = (dAlt / dDistM) * 100;
  // Clamp to reasonable range (-30% to +30%)
  return Math.max(-30, Math.min(30, Math.round(grad * 10) / 10));
}

/**
 * Central motor control loop — KROMI intelligent assist.
 *
 * Only active in POWER mode. Every 2s:
 * 1. Gather all inputs (terrain, speed, cadence, power, battery)
 * 2. TuningIntelligence scores and decides level (1-3)
 * 3. Send SET_TUNING if level changed
 *
 * Terrain data is optional — works with just speed/cadence/power/battery.
 * GPS + Elevation API adds terrain awareness and pre-emptive detection.
 */
export function useMotorControl() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Sync auto-assist config
    const unsub = useSettingsStore.subscribe((state) => {
      autoAssistEngine.updateConfig(state.autoAssist);
      useAutoAssistStore.getState().setEnabled(state.autoAssist.enabled);
    });
    autoAssistEngine.updateConfig(useSettingsStore.getState().autoAssist);

    intervalRef.current = setInterval(async () => {
      const bike = useBikeStore.getState();
      const intelligence = useIntelligenceStore.getState();

      const dlog = (window as unknown as Record<string, (m: string) => void>).__dlog;

      // === Gate: KROMI only in POWER mode ===
      if (bike.assist_mode !== AssistMode.POWER) {
        if (intelligence.active) {
          useIntelligenceStore.getState().setActive(false);
          useAutoAssistStore.getState().setLastDecision({
            action: 'none',
            reason: 'Muda para POWER para activar KROMI',
            terrain: null,
          });
          dlog?.(`[KROMI] DEACTIVATED — mode=${bike.assist_mode} (not POWER=5)`);
        }
        return;
      }

      if (!intelligence.active) {
        useIntelligenceStore.getState().setActive(true);
        dlog?.(`[KROMI] ACTIVATED — mode=POWER gear=${bike.gear} ble=${bike.ble_status} tuning=${isTuningAvailable()}`);
      }

      // === Gather inputs (personalized via settingsStore) ===
      const map = useMapStore.getState();
      const altitude = map.altitude ?? bike.barometric_altitude_m;

      // Direct GPS gradient calculation (backup for when autoAssistEngine fails)
      const liveGradient = getGpsGradient(altitude, bike.speed_kmh);

      const input: TuningInput = {
        gradient: liveGradient,
        speed: bike.speed_kmh,
        cadence: bike.cadence_rpm,
        riderPower: bike.power_watts,
        batterySoc: bike.battery_percent,
        hr: bike.hr_bpm,
        altitude,
        upcomingGradient: null,
        distanceToChange: null,
        currentGear: bike.gear,
      };

      // Terrain data — always active in POWER mode (no toggle needed)
      if (map.gpsActive && map.latitude !== 0) {
        const modeDecision = await autoAssistEngine.tick(
          map.latitude, map.longitude, map.heading,
          bike.speed_kmh, bike.assist_mode,
        );

        // Update terrain UI
        const aaStore = useAutoAssistStore.getState();
        aaStore.setLastDecision(modeDecision);
        if (modeDecision.terrain) {
          aaStore.setTerrain(modeDecision.terrain);
          input.gradient = modeDecision.terrain.current_gradient_pct;

          // Pre-emptive data
          if (modeDecision.terrain.next_transition) {
            input.upcomingGradient = modeDecision.terrain.next_transition.gradient_after_pct;
            input.distanceToChange = modeDecision.terrain.next_transition.distance_m;
          }
        }
        aaStore.setOverride(
          autoAssistEngine.isOverrideActive(),
          autoAssistEngine.getOverrideRemaining(),
        );
      }

      // === Evaluate: still use TuningIntelligence for UI/IntelligenceWidget ===
      const decision = tuningIntelligence.evaluate(input);
      useIntelligenceStore.getState().setDecision(decision);

      // === KROMI Physics Engine — calculates exact motor parameters ===
      const physics = computeKromiPhysics(input);
      const support = toWire(physics.supportPct, SUPPORT_MIN, SUPPORT_MAX);
      const torque = toWire(physics.torqueNm, TORQUE_MIN, TORQUE_MAX);
      const launch = toWire(physics.launchLvl, LAUNCH_MIN, LAUNCH_MAX);

      // Log every 10s
      if (Date.now() % 10000 < 1100) {
        dlog?.(`[KROMI] support=${physics.supportPct.toFixed(0)}%(${support}/15) torque=${physics.torqueNm.toFixed(0)}Nm(${torque}/15) launch=${physics.launchLvl}(${launch}/15) | grad=${input.gradient.toFixed(1)} gear=${input.currentGear} spd=${input.speed.toFixed(0)} cad=${input.cadence} hr=${input.hr} score=${physics.score}`);
      }

      // === Execute: Advanced tuning — 16 levels, ONLY POWER mode ===
      if (isTuningAvailable()) {
        const last = lastAdvancedTuning;
        if (support !== last.support || torque !== last.torque || launch !== last.launch) {
          dlog?.(`[KROMI] → S=${support}/15(${physics.supportPct.toFixed(0)}%) T=${torque}/15(${physics.torqueNm.toFixed(0)}Nm) L=${launch}/15 | grad=${input.gradient.toFixed(1)} gear=${input.currentGear} spd=${input.speed.toFixed(0)} cad=${input.cadence} hr=${input.hr}`);
          setAdvancedTuning({
            powerSupport: support,
            powerTorque: torque,
            powerLaunch: launch,
          });
          lastAdvancedTuning = { support, torque, launch };
        }
      }
    }, TICK_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      unsub();
    };
  }, []);
}

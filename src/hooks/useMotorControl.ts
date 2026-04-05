import { useEffect, useRef } from 'react';
import { useBikeStore } from '../store/bikeStore';
import { useMapStore } from '../store/mapStore';
import { useAutoAssistStore } from '../store/autoAssistStore';
import { useSettingsStore } from '../store/settingsStore';
import { useIntelligenceStore } from '../store/intelligenceStore';
import { autoAssistEngine } from '../services/autoAssist/AutoAssistEngine';
import { tuningIntelligence, type TuningInput } from '../services/motor/TuningIntelligence';
import { setAdvancedTuning, isTuningAvailable } from '../services/bluetooth/BLEBridge';
import { AssistMode } from '../types/bike.types';
// encodeCalibration no longer needed — KROMI only changes POWER level

const TICK_INTERVAL_MS = 1000;

// Track last sent values to avoid redundant writes
let lastAdvancedTuning = { support: -1, torque: -1, launch: -1 };

/**
 * KROMI Score: 0-100. Crosses ALL rider inputs into a single "need motor" score.
 * Higher = rider needs more motor assist.
 *
 * Considers: gradient, HR, cadence, gear, speed — weighted together.
 * No battery constraint — POWER mode means rider wants full KROMI control.
 */
function computeKromiScore(input: TuningInput): number {
  let score = 40; // baseline: neutral

  // ── GRADIENT (biggest factor: -25 to +30) ──
  if (input.gradient > 10) score += 30;       // steep climb: max motor
  else if (input.gradient > 6) score += 22;   // hard climb
  else if (input.gradient > 3) score += 15;   // moderate climb
  else if (input.gradient > 1) score += 5;    // slight incline
  else if (input.gradient < -8) score -= 25;  // steep descent: minimal motor
  else if (input.gradient < -4) score -= 18;  // descent
  else if (input.gradient < -1) score -= 10;  // slight descent

  // ── HR (effort indicator: -15 to +20) ──
  if (input.hr > 0) {
    if (input.hr > 160) score += 20;         // very high: rider struggling
    else if (input.hr > 140) score += 12;    // high effort
    else if (input.hr > 120) score += 5;     // moderate effort
    else if (input.hr < 90) score -= 15;     // very low: rider coasting
    else if (input.hr < 110) score -= 8;     // comfortable
  }

  // ── CADENCE (pedalling efficiency: -10 to +15) ──
  if (input.cadence > 0) {
    if (input.cadence < 40) score += 15;      // grinding hard: needs help
    else if (input.cadence < 55) score += 8;  // low cadence
    else if (input.cadence > 95) score -= 10; // spinning easy
    else if (input.cadence > 80) score -= 3;  // efficient
    // 55-80: sweet spot, no change
  }

  // ── GEAR POSITION (effort proxy: -8 to +10) ──
  if (input.currentGear > 0) {
    const gearPct = (input.currentGear - 1) / 11; // 0=easiest, 1=hardest (12-speed)
    if (gearPct > 0.75) score += 10;     // heavy gear: hard effort
    else if (gearPct > 0.5) score += 4;  // mid-heavy
    else if (gearPct < 0.2) score -= 8;  // very light gear: easy
    else if (gearPct < 0.35) score -= 3; // light
  }

  // ── SPEED (context: -5 to +5) ──
  if (input.speed > 25) score -= 5;       // high speed: motor cuts at 25, reduce
  else if (input.speed < 5 && input.speed > 0 && input.gradient > 2) score += 5; // slow on climb: help

  // ── COMBINED PATTERNS ──
  // Grinding: heavy gear + low cadence + climb = emergency boost
  if (input.currentGear > 8 && input.cadence > 0 && input.cadence < 50 && input.gradient > 3) {
    score += 10; // extra boost for grinding uphill
  }
  // Coasting: light gear + high cadence + flat/descent = save motor
  if (input.currentGear > 0 && input.currentGear < 5 && input.cadence > 80 && input.gradient < 1) {
    score -= 8; // spinning easy on flat
  }

  return Math.max(0, Math.min(100, score));
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

      // === KROMI Direct Decision — crosses ALL inputs ===
      // Score 0-100 → map to 0-15 for support, torque, launch
      const kromiScore = computeKromiScore(input);

      // Map score to 16-level values (0=min, 15=max)
      const support = Math.round((kromiScore / 100) * 15);
      const torque = Math.round((kromiScore / 100) * 15);
      // Launch: boost on low speed climbs, reduce at high speed
      const launchScore = Math.max(0, Math.min(100,
        kromiScore + (input.speed < 5 && input.gradient > 2 ? 20 : 0) - (input.speed > 20 ? 15 : 0)
      ));
      const launch = Math.round((launchScore / 100) * 15);

      // Log every 10s
      if (Date.now() % 10000 < 1100) {
        dlog?.(`[KROMI] score=${kromiScore} → S=${support}/15 T=${torque}/15 L=${launch}/15 | grad=${input.gradient.toFixed(1)} gear=${input.currentGear} spd=${input.speed.toFixed(0)} cad=${input.cadence} hr=${input.hr}`);
      }

      // === Execute: Advanced tuning — 16 levels, ONLY POWER mode ===
      if (isTuningAvailable()) {
        const last = lastAdvancedTuning;
        if (support !== last.support || torque !== last.torque || launch !== last.launch) {
          dlog?.(`[KROMI] POWER → support=${support} torque=${torque} launch=${launch} (score=${kromiScore}) | grad=${input.gradient.toFixed(1)} gear=${input.currentGear} spd=${input.speed.toFixed(0)} cad=${input.cadence} hr=${input.hr}`);
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

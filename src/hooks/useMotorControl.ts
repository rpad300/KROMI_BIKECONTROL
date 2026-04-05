import { useEffect, useRef } from 'react';
import { useBikeStore } from '../store/bikeStore';
import { useMapStore } from '../store/mapStore';
import { useAutoAssistStore } from '../store/autoAssistStore';
import { useSettingsStore } from '../store/settingsStore';
import { useIntelligenceStore } from '../store/intelligenceStore';
import { autoAssistEngine } from '../services/autoAssist/AutoAssistEngine';
import { tuningIntelligence, type TuningInput } from '../services/motor/TuningIntelligence';
import { setAdvancedTuning, isTuningAvailable } from '../services/bluetooth/BLEBridge';
import { kromiEngine } from '../services/intelligence/KromiEngine';
import { useNutritionStore } from '../store/nutritionStore';
import { AssistMode } from '../types/bike.types';

const TICK_INTERVAL_MS = 1000;

// Map a real value to wire 0-15
function toWire(value: number, min: number, max: number): number {
  const clamped = Math.max(min, Math.min(max, value));
  return Math.round(((clamped - min) / (max - min)) * 15);
}

// Motor tuning ranges (from Giant RideControl → SyncDrive Pro)
const SUPPORT_MIN = 50;
const SUPPORT_MAX = 350;
const TORQUE_MIN = 20;
const TORQUE_MAX = 85;
const LAUNCH_MIN = 1;
const LAUNCH_MAX = 7;

// Track last sent values to avoid redundant writes
let lastAdvancedTuning = { support: -1, torque: -1, launch: -1 };

// Track last KROMI output for mode feedback learning
let lastKromiOutput: {
  supportPct: number; torqueNm: number; gradient: number;
  speed: number; gear: number; hr_zone: number; wPrimePct: number;
} | null = null;

/**
 * Gradient from GPS altitude + wheel distance (not GPS position).
 * Uses real wheel distance (CSC sensor) which is centimetre-accurate,
 * combined with GPS altitude (which has ±2-3m noise).
 */
const gradientSamples: { alt: number; dist_m: number; ts: number }[] = [];
let smoothedGradient = 0;
function getGpsGradient(altitude: number | null, speedKmh: number, distanceKm: number): number {
  if (!altitude || altitude === 0 || speedKmh < 2) {
    // Fast decay to 0 when stopped — gradient is meaningless at rest
    smoothedGradient *= 0.7;
    if (Math.abs(smoothedGradient) < 0.3) smoothedGradient = 0;
    return smoothedGradient;
  }

  const now = Date.now();
  const dist_m = distanceKm * 1000; // wheel distance in meters (precise)
  gradientSamples.push({ alt: altitude, dist_m, ts: now });

  // Keep 20s window
  while (gradientSamples.length > 0 && now - gradientSamples[0]!.ts > 20000) {
    gradientSamples.shift();
  }
  if (gradientSamples.length < 3) return smoothedGradient;

  const first = gradientSamples[0]!;
  const last = gradientSamples[gradientSamples.length - 1]!;
  const dDistM = last.dist_m - first.dist_m; // REAL wheel distance, not GPS estimated
  if (dDistM < 15) return smoothedGradient;   // need 15m+ of actual riding

  const dAlt = last.alt - first.alt;
  const rawGrad = (dAlt / dDistM) * 100;
  const clampedGrad = Math.max(-20, Math.min(20, rawGrad));

  // Speed-adaptive EMA
  const alpha = speedKmh > 15 ? 0.4 : speedKmh > 8 ? 0.3 : speedKmh > 4 ? 0.2 : 0.1;
  const prevGrad = smoothedGradient;

  // Anti-spike: max 5%/s rate of change
  const dtSec = (last.ts - first.ts) / 1000;
  const maxDelta = 5 * Math.max(1, dtSec) * alpha;
  const delta = clampedGrad - prevGrad;
  if (Math.abs(delta) > maxDelta) {
    smoothedGradient = prevGrad + Math.sign(delta) * maxDelta;
  } else {
    smoothedGradient = prevGrad + alpha * delta;
  }

  return Math.round(smoothedGradient * 10) / 10;
}

/**
 * Central motor control loop — KROMI Intelligence v2.
 *
 * Only active in POWER mode. Every 1s:
 * 1. Gather inputs (terrain, speed, cadence, power, battery, HR, GPS)
 * 2. KromiEngine.tick() runs 6-layer intelligence
 * 3. TuningIntelligence runs for IntelligenceWidget UI
 * 4. Send SET_TUNING if wire values changed
 */
export function useMotorControl() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Sync auto-assist config with 500m lookahead for v2
    const unsub = useSettingsStore.subscribe((state) => {
      autoAssistEngine.updateConfig({ ...state.autoAssist, lookahead_m: 500 });
      useAutoAssistStore.getState().setEnabled(state.autoAssist.enabled);
    });
    const settings = useSettingsStore.getState();
    autoAssistEngine.updateConfig({ ...settings.autoAssist, lookahead_m: 500 });

    intervalRef.current = setInterval(async () => {
      const bike = useBikeStore.getState();
      const intelligence = useIntelligenceStore.getState();

      const dlog = (window as unknown as Record<string, (m: string) => void>).__dlog;

      // === Gate: KROMI only in POWER mode ===
      if (bike.assist_mode !== AssistMode.POWER) {
        if (intelligence.active) {
          // ── MODE FEEDBACK: rider left POWER → capture WHY ──
          if (lastKromiOutput && bike.assist_mode >= AssistMode.ECO && bike.assist_mode <= AssistMode.SPORT) {
            const feedback = kromiEngine.getLearning().recordModeExit({
              targetMode: bike.assist_mode,
              gradient: lastKromiOutput.gradient,
              hr_zone: lastKromiOutput.hr_zone,
              speed_kmh: lastKromiOutput.speed,
              gear: lastKromiOutput.gear,
              w_prime_pct: lastKromiOutput.wPrimePct,
              kromi_support_pct: lastKromiOutput.supportPct,
              kromi_torque_nm: lastKromiOutput.torqueNm,
            });
            dlog?.(`[KROMI] MODE FEEDBACK: POWER→${['','ECO','TOUR','ACTV','SPRT'][bike.assist_mode]} | KROMI was S=${lastKromiOutput.supportPct.toFixed(0)}% grad=${lastKromiOutput.gradient.toFixed(1)} z${lastKromiOutput.hr_zone} | correction=${feedback.correction_pct > 0 ? '+' : ''}${feedback.correction_pct.toFixed(0)}%`);
          }

          useIntelligenceStore.getState().setActive(false);
          useAutoAssistStore.getState().setLastDecision({
            action: 'none',
            reason: 'Muda para POWER para activar KROMI',
            terrain: null,
          });
          dlog?.(`[KROMI] DEACTIVATED — mode=${bike.assist_mode} (not POWER=5)`);
          kromiEngine.reset();
        }
        return;
      }

      if (!intelligence.active) {
        // ── MODE FEEDBACK: rider returned to POWER ──
        const returnEvent = kromiEngine.getLearning().recordModeReturn();
        if (returnEvent) {
          dlog?.(`[KROMI] MODE RETURN: stayed ${returnEvent.duration_s?.toFixed(0)}s in mode ${returnEvent.target_mode} | learned correction: ${returnEvent.correction_pct > 0 ? '+' : ''}${returnEvent.correction_pct.toFixed(0)}% for grad=${returnEvent.gradient_bucket} z${returnEvent.hr_zone}`);
        }

        useIntelligenceStore.getState().setActive(true);
        dlog?.(`[KROMI] ACTIVATED v2 — 6-layer intelligence | gear=${bike.gear} ble=${bike.ble_status} tuning=${isTuningAvailable()}`);
      }

      // === Gather inputs ===
      const map = useMapStore.getState();
      const altitude = map.altitude ?? bike.barometric_altitude_m;
      const liveGradient = getGpsGradient(altitude, bike.speed_kmh, bike.distance_km);

      const tuningInput: TuningInput = {
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

      // Terrain data from AutoAssistEngine (elevation lookahead)
      if (map.gpsActive && map.latitude !== 0) {
        const modeDecision = await autoAssistEngine.tick(
          map.latitude, map.longitude, map.heading,
          bike.speed_kmh, bike.assist_mode,
        );

        const aaStore = useAutoAssistStore.getState();
        aaStore.setLastDecision(modeDecision);
        if (modeDecision.terrain) {
          aaStore.setTerrain(modeDecision.terrain);
          tuningInput.gradient = modeDecision.terrain.current_gradient_pct;
          if (modeDecision.terrain.next_transition) {
            tuningInput.upcomingGradient = modeDecision.terrain.next_transition.gradient_after_pct;
            tuningInput.distanceToChange = modeDecision.terrain.next_transition.distance_m;
          }
        }
        aaStore.setOverride(
          autoAssistEngine.isOverrideActive(),
          autoAssistEngine.getOverrideRemaining(),
        );
      }

      // === TuningIntelligence — for IntelligenceWidget UI ===
      const decision = tuningIntelligence.evaluate(tuningInput);
      useIntelligenceStore.getState().setDecision(decision);

      // === KROMI Intelligence v2 — 6-layer engine ===
      const kromi = kromiEngine.tick({
        speed_kmh: bike.speed_kmh,
        gradient_pct: tuningInput.gradient,
        cadence_rpm: bike.cadence_rpm,
        power_watts: bike.power_watts,
        hr_bpm: bike.hr_bpm,
        currentGear: bike.gear,
        batterySoc: bike.battery_percent,
        altitude,
        latitude: map.latitude,
        longitude: map.longitude,
        heading: map.heading,
        distanceKm: bike.distance_km,
        gpsActive: map.gpsActive && map.latitude !== 0,
        upcomingGradient: tuningInput.upcomingGradient,
        distanceToChange: tuningInput.distanceToChange,
      });

      // Pipe nutrition + physiology state to store for UI
      if (kromi.nutrition) {
        useNutritionStore.getState().setState(kromi.nutrition);
      }
      if (kromi.physiology) {
        useNutritionStore.getState().setPhysiology(kromi.physiology);
      }

      // Cache output for mode feedback learning (used if rider switches mode)
      lastKromiOutput = {
        supportPct: kromi.supportPct,
        torqueNm: kromi.torqueNm,
        gradient: tuningInput.gradient,
        speed: bike.speed_kmh,
        gear: bike.gear,
        hr_zone: kromi.physiology?.zone_current ?? 0,
        wPrimePct: kromi.physiology ? kromi.physiology.w_prime_balance * 100 : 100,
      };

      const support = toWire(kromi.supportPct, SUPPORT_MIN, SUPPORT_MAX);
      const torque = toWire(kromi.torqueNm, TORQUE_MIN, TORQUE_MAX);
      const launch = toWire(kromi.launchLvl, LAUNCH_MIN, LAUNCH_MAX);

      // Log every 10s
      if (Date.now() % 10000 < 1100) {
        const w = kromi.physiology;
        dlog?.(`[KROMI v2] S=${kromi.supportPct.toFixed(0)}%(${support}/15) T=${kromi.torqueNm.toFixed(0)}Nm(${torque}/15) L=${kromi.launchLvl}(${launch}/15) | zone=${kromi.speedZone} grad=${tuningInput.gradient.toFixed(1)} gear=${bike.gear} spd=${bike.speed_kmh.toFixed(0)} cad=${bike.cadence_rpm} hr=${bike.hr_bpm} bat×${kromi.batteryFactor.toFixed(2)} W'=${w ? (w.w_prime_balance * 100).toFixed(0) + '%' : '-'} score=${kromi.score} | ${kromi.reason}`);
      }

      // === Execute: Send to motor via BLE ===
      // If native KromiCore is active, it handles motor commands directly (~15ms).
      // PWA only sends if native is NOT available (fallback via WebSocket ~110ms).
      const nativeBridge = (window as unknown as Record<string, unknown>).KromiBridge as
        | { isKromiCoreActive?: () => boolean }
        | undefined;
      const nativeActive = nativeBridge?.isKromiCoreActive?.() === true;

      if (!nativeActive && isTuningAvailable()) {
        const last = lastAdvancedTuning;
        if (support !== last.support || torque !== last.torque || launch !== last.launch) {
          dlog?.(`[KROMI v2 fallback] → S=${support}/15(${kromi.supportPct.toFixed(0)}%) T=${torque}/15(${kromi.torqueNm.toFixed(0)}Nm) L=${launch}/15 | ${kromi.reason}`);
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
      kromiEngine.reset();
      unsub();
    };
  }, []);
}

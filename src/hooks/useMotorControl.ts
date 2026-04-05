import { useEffect, useRef } from 'react';
import { useBikeStore } from '../store/bikeStore';
import { useMapStore } from '../store/mapStore';
import { useAutoAssistStore } from '../store/autoAssistStore';
import { useSettingsStore } from '../store/settingsStore';
import { useTuningStore } from '../store/tuningStore';
import { useIntelligenceStore } from '../store/intelligenceStore';
import { autoAssistEngine } from '../services/autoAssist/AutoAssistEngine';
import { tuningIntelligence, type TuningInput } from '../services/motor/TuningIntelligence';
import { setTuning, isTuningAvailable } from '../services/bluetooth/BLEBridge';
import { AssistMode } from '../types/bike.types';
// encodeCalibration no longer needed — KROMI only changes POWER level

const TICK_INTERVAL_MS = 1000; // 1s — fast reaction to gear/gradient/HR changes

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
      const input: TuningInput = {
        gradient: 0,
        speed: bike.speed_kmh,
        cadence: bike.cadence_rpm,
        riderPower: bike.power_watts,
        batterySoc: bike.battery_percent,
        hr: bike.hr_bpm,
        altitude: map.altitude ?? bike.barometric_altitude_m,
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

      // === Evaluate ===
      const decision = tuningIntelligence.evaluate(input);
      useIntelligenceStore.getState().setDecision(decision);

      // Log decision every 10s for diagnostics (not every 1s to avoid spam)
      if (Date.now() % 10000 < 1100) {
        dlog?.(`[KROMI] EVAL: P=${decision.calibration.support} S=${decision.calibration.torque} A=${decision.calibration.midTorque} T=${decision.calibration.lowTorque} E=${decision.calibration.launch} | spd=${input.speed} cad=${input.cadence} hr=${input.hr} gear=${input.currentGear} grad=${input.gradient.toFixed(1)} bat=${input.batterySoc}`);
      }

      // === Execute: ONLY change POWER mode level, leave other modes untouched ===
      if (isTuningAvailable()) {
        const tuning = useTuningStore.getState();
        // KROMI decision → single POWER level (0=max, 1=mid, 2=min)
        const powerLevel = decision.calibration.support; // primary output

        if (powerLevel !== tuning.current.power) {
          // Keep other modes at their original values, only change POWER
          const newLevels = {
            ...tuning.current,
            power: powerLevel,
          };
          dlog?.(`[KROMI] POWER → ${powerLevel} (${powerLevel === 0 ? 'MAX' : powerLevel === 1 ? 'MID' : 'MIN'}) | gear=${bike.gear} spd=${bike.speed_kmh} cad=${bike.cadence_rpm} hr=${bike.hr_bpm} grad=${input.gradient.toFixed(1)} bat=${bike.battery_percent}`);
          setTuning(newLevels);
          tuning.setCurrent(newLevels);
        }
      }
    }, TICK_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      unsub();
    };
  }, []);
}

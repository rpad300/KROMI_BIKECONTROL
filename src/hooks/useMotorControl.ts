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
import { encodeCalibration } from '../types/tuning.types';

const TICK_INTERVAL_MS = 2000;

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
      const settings = useSettingsStore.getState();
      const bike = useBikeStore.getState();
      const intelligence = useIntelligenceStore.getState();

      // === Gate: KROMI only in POWER mode ===
      // POWER mode = KROMI controls tuning (torque/support/launch)
      // SMART mode = Giant's native auto-assist (for comparison)
      if (bike.assist_mode !== AssistMode.POWER) {
        if (intelligence.active) {
          useIntelligenceStore.getState().setActive(false);
          useAutoAssistStore.getState().setLastDecision({
            action: 'none',
            reason: 'Muda para POWER para activar KROMI',
            terrain: null,
          });
        }
        return;
      }

      if (!intelligence.active) {
        useIntelligenceStore.getState().setActive(true);
        console.log('[KROMI] Intelligence ACTIVATED — mode=POWER, gear=%d, ble=%s, tuning=%s',
          bike.gear, bike.ble_status, isTuningAvailable() ? 'available' : 'unavailable');
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

      // Terrain data (optional — needs GPS + auto-assist enabled)
      if (settings.autoAssist.enabled && map.gpsActive && map.latitude !== 0) {
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

      // === Execute: send 5-ASMO calibration to motor ===
      if (isTuningAvailable()) {
        const tuning = useTuningStore.getState();
        const [b0, b1, b2] = encodeCalibration(decision.calibration);
        const current = tuning.current;
        // Check if any ASMO changed
        const prevBytes = [
          (current.power + 1) | ((current.sport + 1) << 4),
          (current.active + 1) | ((current.tour + 1) << 4),
          current.eco + 1,
        ];
        if (b0 !== prevBytes[0] || b1 !== prevBytes[1] || b2 !== prevBytes[2]) {
          // Map 5 ASMOs to the 5-mode tuning format for the existing setTuning API
          setTuning({
            power: decision.calibration.support,
            sport: decision.calibration.torque,
            active: decision.calibration.midTorque,
            tour: decision.calibration.lowTorque,
            eco: decision.calibration.launch,
          });
          tuning.setCurrent({
            power: decision.calibration.support,
            sport: decision.calibration.torque,
            active: decision.calibration.midTorque,
            tour: decision.calibration.lowTorque,
            eco: decision.calibration.launch,
          });
        }
      }
    }, TICK_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      unsub();
    };
  }, []);
}

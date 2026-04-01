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
      if (bike.assist_mode !== AssistMode.POWER) {
        if (intelligence.active) {
          useIntelligenceStore.getState().setActive(false);
          useAutoAssistStore.getState().setLastDecision({
            action: 'none',
            reason: 'KROMI activo apenas em PWR',
            terrain: null,
          });
        }
        return;
      }

      if (!intelligence.active) {
        useIntelligenceStore.getState().setActive(true);
      }

      // === Gather inputs ===
      const input: TuningInput = {
        gradient: 0,
        speed: bike.speed_kmh,
        cadence: bike.cadence_rpm,
        riderPower: bike.power_watts,
        batterySoc: bike.battery_percent,
        upcomingGradient: null,
        distanceToChange: null,
      };

      // Terrain data (optional — needs GPS + auto-assist enabled)
      const map = useMapStore.getState();
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

      // === Execute: change tuning if level changed ===
      const tuning = useTuningStore.getState();
      if (decision.level !== tuning.current.power && isTuningAvailable()) {
        const newLevels = { ...tuning.current, power: decision.level };
        setTuning(newLevels);
        tuning.setCurrent(newLevels);
      }
    }, TICK_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      unsub();
    };
  }, []);
}

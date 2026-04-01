import { useEffect, useRef } from 'react';
import { useBikeStore } from '../store/bikeStore';
import { useMapStore } from '../store/mapStore';
import { useAutoAssistStore } from '../store/autoAssistStore';
import { useSettingsStore } from '../store/settingsStore';
import { useTuningStore } from '../store/tuningStore';
import { useTorqueStore } from '../store/torqueStore';
import { autoAssistEngine } from '../services/autoAssist/AutoAssistEngine';
import { torqueEngine } from '../services/torque/TorqueEngine';
import { motorController } from '../services/motor/MotorController';
import { sendAssistMode, setTuning, isTuningAvailable } from '../services/bluetooth/BLEBridge';

const TICK_INTERVAL_MS = 2000;

/**
 * Central motor control loop.
 *
 * Every 2s:
 * 1. AutoAssistEngine → terrain-based mode decision
 * 2. TorqueEngine → intensity based on climb type + battery
 * 3. MotorController → merges both → mode + tuning output
 * 4. Sends via BLEBridge (mode) + WebSocket (tuning)
 *
 * Replaces useAutoAssist as the single motor output path.
 * Modular: HR, Di2, Learning can be plugged into MotorController later.
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
      if (!settings.autoAssist.enabled) return;

      const map = useMapStore.getState();
      if (!map.gpsActive || map.latitude === 0) return;

      const bike = useBikeStore.getState();
      const tuning = useTuningStore.getState();

      // === 1. Terrain → Mode decision (AutoAssist) ===
      const modeDecision = await autoAssistEngine.tick(
        map.latitude,
        map.longitude,
        map.heading,
        bike.speed_kmh,
        bike.assist_mode,
      );

      // Update auto-assist store (for UI: terrain viz, override countdown)
      const aaStore = useAutoAssistStore.getState();
      aaStore.setLastDecision(modeDecision);
      if (modeDecision.terrain) aaStore.setTerrain(modeDecision.terrain);
      aaStore.setOverride(
        autoAssistEngine.isOverrideActive(),
        autoAssistEngine.getOverrideRemaining(),
      );

      // === 2. Terrain + Battery → Torque/Intensity (TorqueEngine) ===
      // Only runs if we have terrain data
      let torqueCmd = null;
      if (modeDecision.terrain) {
        torqueCmd = torqueEngine.calculateOptimalTorque(
          modeDecision.terrain,
          /* hrZone */ 0,      // No HR provider yet
          /* hrTrend */ 'stable',
          /* gear */ 0,        // No Di2 provider yet
          bike.battery_percent,
        );

        // Update torque store for UI
        if (torqueCmd) {
          useTorqueStore.getState().setLastCommand(torqueCmd);
        }
      }

      // === 3. MotorController → merge and decide ===
      const decision = motorController.decide(
        bike.assist_mode,
        tuning.current,
        modeDecision,
        torqueCmd,
      );

      // === 4. Execute ===
      // Mode change → via BLEBridge (works on all BLE modes)
      if (decision.modeChange !== null) {
        await sendAssistMode(decision.modeChange);
      }

      // Tuning change → via WebSocket bridge only
      if (decision.tuningChange && isTuningAvailable()) {
        setTuning(decision.tuningChange);
        tuning.setCurrent(decision.tuningChange);
      }
    }, TICK_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      unsub();
    };
  }, []);
}

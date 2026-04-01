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
import { setTuning, isTuningAvailable } from '../services/bluetooth/BLEBridge';
import { AssistMode } from '../types/bike.types';

const TICK_INTERVAL_MS = 2000;

/**
 * Central motor control loop — KROMI intelligent assist.
 *
 * ONLY active when the bike is in POWER mode (set via physical RideControl).
 * In any other mode, KROMI is passive — shows telemetry but doesn't touch the motor.
 *
 * When in POWER mode, every 2s:
 * 1. AutoAssistEngine → terrain analysis (elevation lookahead)
 * 2. TorqueEngine → optimal intensity for climb type + battery
 * 3. MotorController → translates to tuning level (1-3) for POWER mode
 * 4. Sends SET_TUNING via WebSocket bridge
 *
 * The user's choice is clear:
 * - Want KROMI intelligence? → Switch to POWER on RideControl
 * - Want simple/factory assist? → Use ECO/TOUR/ACTIVE/SPORT
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

      const bike = useBikeStore.getState();

      // === KROMI only active in POWER or SMART mode ===
      if (bike.assist_mode !== AssistMode.POWER && bike.assist_mode !== AssistMode.SMART) {
        // Passive: update UI state but don't send commands
        useAutoAssistStore.getState().setLastDecision({
          action: 'none',
          reason: 'KROMI activo apenas em PWR',
          terrain: null,
        });
        return;
      }

      const map = useMapStore.getState();
      if (!map.gpsActive || map.latitude === 0) return;

      const tuning = useTuningStore.getState();

      // === 1. Terrain → analysis (AutoAssist) ===
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

      // === 2. Terrain + Battery → Torque/Intensity ===
      let torqueCmd = null;
      if (modeDecision.terrain) {
        torqueCmd = torqueEngine.calculateOptimalTorque(
          modeDecision.terrain,
          /* hrZone */ 0,
          /* hrTrend */ 'stable',
          /* gear */ 0,
          bike.battery_percent,
        );

        if (torqueCmd) {
          useTorqueStore.getState().setLastCommand(torqueCmd);
        }
      }

      // === 3. MotorController → decide tuning level ===
      // In POWER-only mode, we don't change modes — only tuning intensity
      const decision = motorController.decide(
        bike.assist_mode,
        tuning.current,
        null,       // No mode changes — user controls mode via RideControl
        torqueCmd,
      );

      // === 4. Execute tuning change ===
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

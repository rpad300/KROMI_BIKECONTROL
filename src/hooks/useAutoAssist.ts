import { useEffect, useRef } from 'react';
import { useBikeStore } from '../store/bikeStore';
import { useMapStore } from '../store/mapStore';
import { useAutoAssistStore } from '../store/autoAssistStore';
import { useSettingsStore } from '../store/settingsStore';
import { useTorqueStore } from '../store/torqueStore';
import { autoAssistEngine } from '../services/autoAssist/AutoAssistEngine';
import { sendAssistMode, isBikeConnected } from '../services/bluetooth/BLEBridge';
import { torqueEngine } from '../services/torque/TorqueEngine';
import { AssistMode } from '../types/bike.types';

const TICK_INTERVAL_MS = 2000; // Run every 2 seconds

/**
 * Main auto-assist loop. Connects GPS + elevation + engine + BLE.
 * Runs every 2s when auto-assist is enabled and GPS is active.
 */
export function useAutoAssist() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Sync config from settings store to engine
    const unsub = useSettingsStore.subscribe((state) => {
      autoAssistEngine.updateConfig(state.autoAssist);
      useAutoAssistStore.getState().setEnabled(state.autoAssist.enabled);
    });

    // Initial sync
    autoAssistEngine.updateConfig(useSettingsStore.getState().autoAssist);

    // Start tick loop
    intervalRef.current = setInterval(async () => {
      const settings = useSettingsStore.getState();
      if (!settings.autoAssist.enabled) return;

      const map = useMapStore.getState();
      if (!map.gpsActive || map.latitude === 0) return;

      const bike = useBikeStore.getState();

      // Run engine tick
      const decision = await autoAssistEngine.tick(
        map.latitude,
        map.longitude,
        map.heading,
        bike.speed_kmh,
        bike.assist_mode
      );

      // Update auto-assist store
      const aaStore = useAutoAssistStore.getState();
      aaStore.setLastDecision(decision);

      if (decision.terrain) {
        aaStore.setTerrain(decision.terrain);
      }

      // Update override status
      aaStore.setOverride(
        autoAssistEngine.isOverrideActive(),
        autoAssistEngine.getOverrideRemaining()
      );

      // Execute mode change via BLE Bridge (routes to WebSocket or Web BLE)
      if (decision.action === 'change_mode' && decision.new_mode !== undefined) {
        try {
          await sendAssistMode(decision.new_mode);
        } catch (err) {
          console.warn('[AutoAssist] Failed to send assist mode:', err);
        }
      }

      // ── TorqueEngine — fine-tune torque/support for current terrain ──
      try {
        const terrain = aaStore.terrain;
        if (terrain && isBikeConnected()) {
          const torqueCmd = torqueEngine.calculateOptimalTorque(
            terrain,
            bike.hr_zone,
            'stable', // TODO: derive HR trend from history
            bike.gear,
            bike.battery_percent,
          );
          if (torqueCmd) {
            useTorqueStore.getState().setLastCommand(torqueCmd);
          }
        }
      } catch (err) {
        console.warn('[AutoAssist] TorqueEngine error:', err);
      }

      // ── BiometricAssist — HR Zone 5 emergency override to POWER ──
      try {
        if (
          bike.hr_bpm > 0 &&
          bike.hr_zone >= 5 &&
          !autoAssistEngine.isOverrideActive() &&
          bike.assist_mode !== AssistMode.POWER
        ) {
          await sendAssistMode(AssistMode.POWER);
          aaStore.setLastDecision({
            action: 'change_mode',
            new_mode: AssistMode.POWER,
            reason: 'HR ZONA 5 — Assistencia maxima',
            terrain: aaStore.terrain,
          });
        }
      } catch (err) {
        console.warn('[AutoAssist] BiometricAssist error:', err);
      }
    }, TICK_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      unsub();
    };
  }, []);
}

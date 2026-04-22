import { useEffect } from 'react';
import { subscribeRideTick2s } from '../services/RideTickService';
import { useBikeStore } from '../store/bikeStore';
import { useMapStore } from '../store/mapStore';
import { useAutoAssistStore } from '../store/autoAssistStore';
import { useSettingsStore } from '../store/settingsStore';
import { useTorqueStore } from '../store/torqueStore';
import { autoAssistEngine } from '../services/autoAssist/AutoAssistEngine';
import { sendAssistMode, isBikeConnected } from '../services/bluetooth/BLEBridge';
import { torqueEngine } from '../services/torque/TorqueEngine';
import { AssistMode } from '../types/bike.types';

/**
 * Main auto-assist loop. Connects GPS + elevation + engine + BLE.
 * Runs every 2s (via master RideTickService 2s cadence) when auto-assist is enabled and GPS is active.
 */
export function useAutoAssist() {
  useEffect(() => {
    // Sync config from settings store to engine
    const unsub = useSettingsStore.subscribe((state) => {
      autoAssistEngine.updateConfig(state.autoAssist);
      useAutoAssistStore.getState().setEnabled(state.autoAssist.enabled);
    });

    // Initial sync
    autoAssistEngine.updateConfig(useSettingsStore.getState().autoAssist);

    // Start tick loop (2s cadence via master RideTickService)
    const tickFn = async () => {
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
        // Haptic AFTER mode change, in separate try so vibrate failure
        // does NOT make the mode change appear to have failed
        try { navigator.vibrate?.([50, 30, 50]); } catch { /* vibrate unsupported */ }
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
          try {
            await sendAssistMode(AssistMode.POWER);
          } catch (err) {
            console.warn('[AutoAssist] BiometricAssist send failed:', err);
          }
          // HR Zone 5 emergency — stronger haptic AFTER mode change, separate try
          try { navigator.vibrate?.([200, 100, 200, 100, 200]); } catch { /* vibrate unsupported */ }
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
    };

    const unsubTick = subscribeRideTick2s(tickFn);

    return () => {
      unsubTick();
      unsub();
    };
  }, []);
}

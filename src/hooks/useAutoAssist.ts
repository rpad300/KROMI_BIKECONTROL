import { useEffect, useRef } from 'react';
import { useBikeStore } from '../store/bikeStore';
import { useMapStore } from '../store/mapStore';
import { useAutoAssistStore } from '../store/autoAssistStore';
import { useSettingsStore } from '../store/settingsStore';
import { autoAssistEngine } from '../services/autoAssist/AutoAssistEngine';
import { giantBLEService } from '../services/bluetooth/GiantBLEService';

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

      // Execute mode change via BLE
      if (decision.action === 'change_mode' && decision.new_mode !== undefined) {
        await giantBLEService.sendAssistMode(decision.new_mode);
      }
    }, TICK_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      unsub();
    };
  }, []);
}

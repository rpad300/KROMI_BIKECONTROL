import { useSettingsStore } from '../store/settingsStore';

/** Returns true if the active bike is electric (has motor/battery) */
export function useIsEBike(): boolean {
  return useSettingsStore((s) => (s.bikeConfig as { bike_type?: string }).bike_type !== 'mechanical');
}

/**
 * SettingsSyncService — syncs all user settings to/from Supabase.
 *
 * Persists: bikeConfig, riderProfile, autoAssist, savedDevice.
 * Linked to authenticated user (user_id from authStore).
 *
 * Flow:
 * - Login → load settings from DB → merge into Zustand stores
 * - Any setting change → debounced save to DB
 * - Desktop configures → mobile picks up on next load
 */

import { useSettingsStore, type BikeConfig } from '../../store/settingsStore';
import { useAuthStore } from '../../store/authStore';
import { getSavedDevice, saveDevice, getSavedSensorDevice, saveSensorDevice, type SavedDevice } from '../bluetooth/BLEBridge';
import type { RiderProfile } from '../../types/athlete.types';

const SENSOR_TYPES = ['hr', 'di2', 'sram', 'power'] as const;

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

function isConfigured(): boolean {
  return !!SUPABASE_URL && !!SUPABASE_KEY && !SUPABASE_URL.includes('your-project');
}

function getUserId(): string | null {
  return useAuthStore.getState().user?.id ?? null;
}

async function supabaseFetch(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      'apikey': SUPABASE_KEY!,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

interface SavedSensors {
  bike?: SavedDevice;
  hr?: SavedDevice;
  di2?: SavedDevice;
  sram?: SavedDevice;
  power?: SavedDevice;
}

interface DBSettings {
  bike_config: BikeConfig;
  rider_profile: RiderProfile;
  auto_assist: Record<string, unknown>;
  saved_device: SavedSensors | SavedDevice | null;
  active_bike_id?: string;
  dashboard_layouts?: Record<string, string[]>;
  privacy_settings?: Record<string, string>;
}

/** Load settings from Supabase and merge into local stores */
export async function loadSettingsFromDB(): Promise<boolean> {
  if (!isConfigured()) return false;
  const userId = getUserId();
  if (!userId) return false;

  try {
    const res = await supabaseFetch(
      `/user_settings?user_id=eq.${userId}&select=bike_config,rider_profile,auto_assist,saved_device,active_bike_id,dashboard_layouts,privacy_settings&limit=1`,
      { headers: { 'Prefer': 'return=representation' } }
    );
    const data = await res.json();

    if (!Array.isArray(data) || data.length === 0) {
      console.log('[Sync] No settings in DB — using local defaults');
      // First time: push local settings to DB
      await saveSettingsToDB();
      return false;
    }

    const row = data[0] as DBSettings;
    const settings = useSettingsStore.getState();

    // Load bike hardware profile (wheel circ, etc.) from bike_configs
    try {
      const bikeRes = await supabaseFetch(
        `/bike_configs?user_id=eq.${userId}&select=wheel_circumference_mm,total_odo_km,bat1_capacity_pct,bat1_health_pct,bat1_cycles,bat2_capacity_pct,bat2_health_pct,bat2_cycles&limit=1`,
        { headers: { 'Prefer': 'return=representation' } }
      );
      const bikeData = await bikeRes.json();
      if (Array.isArray(bikeData) && bikeData.length > 0) {
        const hw = bikeData[0];
        if (hw.wheel_circumference_mm) {
          settings.updateBikeConfig({ wheel_circumference_mm: hw.wheel_circumference_mm });
          console.log(`[Sync] Wheel circumference from DB: ${hw.wheel_circumference_mm}mm`);
        }
      }
    } catch { /* bike_configs may not exist yet */ }

    // Merge DB settings into local stores
    if (row.bike_config && Object.keys(row.bike_config).length > 0) {
      settings.updateBikeConfig(row.bike_config);
    }
    if (row.rider_profile && Object.keys(row.rider_profile).length > 0) {
      settings.updateRiderProfile(row.rider_profile);
    }
    if (row.auto_assist && Object.keys(row.auto_assist).length > 0) {
      settings.updateAutoAssist(row.auto_assist);
    }
    if (row.saved_device) {
      // Handle both old format (single device) and new format (all sensors)
      const sd = row.saved_device;
      if ('address' in sd && 'name' in sd) {
        // Old format: single bike device
        saveDevice(sd as SavedDevice);
      } else {
        // New format: all sensors
        const sensors = sd as SavedSensors;
        if (sensors.bike) saveDevice(sensors.bike);
        for (const type of SENSOR_TYPES) {
          if (sensors[type]) saveSensorDevice(type, sensors[type]!);
        }
      }
    }

    // Load dashboard layouts
    if (row.dashboard_layouts && typeof row.dashboard_layouts === 'object') {
      try {
        const { useLayoutStore } = await import('../../store/layoutStore');
        const layoutStore = useLayoutStore.getState();
        for (const [dashId, widgetIds] of Object.entries(row.dashboard_layouts as Record<string, string[]>)) {
          if (Array.isArray(widgetIds)) layoutStore.setLayout(dashId as 'cruise' | 'climb' | 'descent' | 'data' | 'map', widgetIds);
        }
      } catch { /* layoutStore may not be available */ }
    }

    // Load active bike selection
    if (row.active_bike_id) {
      settings.selectBike?.(row.active_bike_id);
    }

    console.log('[Sync] Settings loaded from DB');
    return true;
  } catch (err) {
    console.warn('[Sync] Load settings failed:', err);
    return false;
  }
}

/** Save all current settings to Supabase */
export async function saveSettingsToDB(): Promise<boolean> {
  if (!isConfigured()) return false;
  const userId = getUserId();
  if (!userId) return false;

  try {
    const settings = useSettingsStore.getState();

    // Collect all saved devices (bike + sensors)
    const savedDevices: SavedSensors = {};
    const bike = getSavedDevice();
    if (bike) savedDevices.bike = bike;
    for (const type of SENSOR_TYPES) {
      const sensor = getSavedSensorDevice(type);
      if (sensor) savedDevices[type] = sensor;
    }

    // Include multi-bike, active selection, layouts, and personal fields
    const { useLayoutStore } = await import('../../store/layoutStore');
    const layouts = useLayoutStore.getState().layouts;

    await supabaseFetch('/user_settings?on_conflict=user_id', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        user_id: userId,
        bike_config: settings.bikeConfig,
        rider_profile: settings.riderProfile,
        auto_assist: settings.autoAssist,
        saved_device: savedDevices,
        active_bike_id: settings.activeBikeId,
        rider_name: settings.riderProfile.name ?? null,
        rider_birthdate: settings.riderProfile.birthdate ?? null,
        rider_gender: settings.riderProfile.gender ?? null,
        rider_club_id: settings.riderProfile.club_id ?? null,
        privacy_settings: settings.riderProfile.privacy ?? {},
        dashboard_layouts: Object.keys(layouts).length > 0 ? layouts : null,
        updated_at: new Date().toISOString(),
      }),
    });

    console.log('[Sync] Settings saved to DB');
    return true;
  } catch (err) {
    console.warn('[Sync] Save settings failed:', err);
    return false;
  }
}

// === Debounced auto-save ===

let saveTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 2000;

/** Schedule a debounced save (call on any setting change) */
export function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveSettingsToDB();
    saveTimer = null;
  }, DEBOUNCE_MS);
}

/** Start auto-sync: subscribe to settings changes and save on change */
export function startSettingsSync(): () => void {
  // Load from DB on start
  loadSettingsFromDB();

  // Subscribe to settings store changes → auto-save
  const unsub = useSettingsStore.subscribe(() => {
    scheduleSave();
  });

  return unsub;
}

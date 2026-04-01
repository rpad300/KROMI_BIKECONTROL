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
import { getSavedDevice, saveDevice, type SavedDevice } from '../bluetooth/BLEBridge';
import type { RiderProfile } from '../../types/athlete.types';

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

interface DBSettings {
  bike_config: BikeConfig;
  rider_profile: RiderProfile;
  auto_assist: Record<string, unknown>;
  saved_device: SavedDevice | null;
}

/** Load settings from Supabase and merge into local stores */
export async function loadSettingsFromDB(): Promise<boolean> {
  if (!isConfigured()) return false;
  const userId = getUserId();
  if (!userId) return false;

  try {
    const res = await supabaseFetch(
      `/user_settings?user_id=eq.${userId}&select=bike_config,rider_profile,auto_assist,saved_device&limit=1`,
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
      saveDevice(row.saved_device);
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
    const savedDevice = getSavedDevice();

    await supabaseFetch('/user_settings?on_conflict=user_id', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        user_id: userId,
        bike_config: settings.bikeConfig,
        rider_profile: settings.riderProfile,
        auto_assist: settings.autoAssist,
        saved_device: savedDevice,
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

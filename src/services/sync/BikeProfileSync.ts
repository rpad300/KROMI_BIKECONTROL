/**
 * BikeProfileSync — auto-populates bike hardware profile from BLE data.
 * Listens to bikeStore and WebSocket messages, saves to Supabase bike_configs.
 * Runs once per connection (debounced 10s after last data received).
 */

import { useAuthStore } from '../../store/authStore';
import { getSavedDevice } from '../bluetooth/BLEBridge';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

interface BikeHardwareProfile {
  // Identity
  frame_number?: string;
  wheel_circumference_mm?: number;
  total_odo_km?: number;

  // Gateway
  sg_type?: string;
  sg_hw_version?: string;
  sg_sw_version?: string;

  // Motor
  motor_hw_version?: string;
  motor_sw_version?: string;
  motor_model?: string;

  // Main battery
  bat1_hw_version?: string;
  bat1_sw_version?: string;
  bat1_capacity_pct?: number;
  bat1_health_pct?: number;
  bat1_cycles?: number;

  // Sub battery
  bat2_hw_version?: string;
  bat2_sw_version?: string;
  bat2_capacity_pct?: number;
  bat2_health_pct?: number;
  bat2_cycles?: number;

  // Remote
  remote_type?: string;
  remote_hw_version?: string;
  remote_sw_version?: string;
}

const profile: BikeHardwareProfile = {};
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saved = false;

/** Record a hardware field — debounces save */
export function recordBikeData(field: keyof BikeHardwareProfile, value: string | number): void {
  if (value === undefined || value === null || value === '' || value === 0) return;
  (profile as Record<string, string | number>)[field] = value;
  debounceSave();
}

/** Record battery info from batteryInfo message */
export function recordBatteryInfo(msg: Record<string, unknown>): void {
  const bat = msg.battery as string;
  const field = msg.field as string;
  const prefix = bat === 'main' ? 'bat1' : 'bat2';

  if (field === 'level') {
    recordBikeData(`${prefix}_capacity_pct` as keyof BikeHardwareProfile, msg.capacity as number);
    recordBikeData(`${prefix}_health_pct` as keyof BikeHardwareProfile, msg.health as number);
  } else if (field === 'cycles') {
    recordBikeData(`${prefix}_cycles` as keyof BikeHardwareProfile, msg.cycles as number);
  } else if (field === 'firmware') {
    if (msg.softwareVersion) recordBikeData(`${prefix}_sw_version` as keyof BikeHardwareProfile, msg.softwareVersion as string);
    if (msg.hardwareVersion) recordBikeData(`${prefix}_hw_version` as keyof BikeHardwareProfile, msg.hardwareVersion as string);
  }
}

/** Record device info from BLE reads (0x180A) */
export function recordDeviceInfo(charUuid: string, value: string): void {
  switch (charUuid.toLowerCase()) {
    case '2a29': // Manufacturer
      break; // Always "GIANT"
    case '2a24': // Model (SG type)
      recordBikeData('sg_type', value);
      break;
    case '2a27': // HW revision (SG)
      recordBikeData('sg_hw_version', value);
      break;
    case '2a28': // SW revision (SG)
      recordBikeData('sg_sw_version', value);
      break;
  }
}

function debounceSave(): void {
  if (saved) return; // Only save once per connection
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveBikeProfile(), 10_000);
}

async function saveBikeProfile(): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return;

  const savedDevice = getSavedDevice();
  const nonEmpty = Object.entries(profile).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== 0);
  if (nonEmpty.length < 3) return; // Not enough data

  try {
    // Check if bike exists
    const res = await fetch(`${SUPABASE_URL}/rest/v1/bike_configs?user_id=eq.${userId}&select=id&limit=1`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
    });
    const existing = await res.json();

    const data = {
      user_id: userId,
      name: 'Giant Trance X E+ 2 (2023)',
      ble_device_name: savedDevice?.name ?? 'GBHA25704',
      frame_number: profile.frame_number,
      wheel_circumference_mm: profile.wheel_circumference_mm,
      total_odo_km: profile.total_odo_km,
      sg_type: profile.sg_type,
      sg_hw_version: profile.sg_hw_version,
      sg_sw_version: profile.sg_sw_version,
      motor_hw_version: profile.motor_hw_version,
      motor_sw_version: profile.motor_sw_version,
      motor_model: profile.motor_model,
      bat1_hw_version: profile.bat1_hw_version,
      bat1_sw_version: profile.bat1_sw_version,
      bat1_capacity_pct: profile.bat1_capacity_pct,
      bat1_health_pct: profile.bat1_health_pct,
      bat1_cycles: profile.bat1_cycles,
      bat2_hw_version: profile.bat2_hw_version,
      bat2_sw_version: profile.bat2_sw_version,
      bat2_capacity_pct: profile.bat2_capacity_pct,
      bat2_health_pct: profile.bat2_health_pct,
      bat2_cycles: profile.bat2_cycles,
      remote_type: profile.remote_type,
      remote_hw_version: profile.remote_hw_version,
      remote_sw_version: profile.remote_sw_version,
      hw_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (existing.length > 0) {
      await fetch(`${SUPABASE_URL}/rest/v1/bike_configs?id=eq.${existing[0].id}`, {
        method: 'PATCH',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify(data),
      });
    } else {
      await fetch(`${SUPABASE_URL}/rest/v1/bike_configs`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify(data),
      });
    }

    saved = true;
    console.log('[BikeProfile] Saved to Supabase:', nonEmpty.length, 'fields');
  } catch (err) {
    console.warn('[BikeProfile] Save failed:', err);
  }
}

/** Reset on disconnect (allow new save on next connect) */
export function resetBikeProfile(): void {
  saved = false;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
}

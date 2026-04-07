/**
 * BikeProfileSync — auto-populates bike hardware profile from BLE data.
 * Listens to bikeStore and WebSocket messages, saves to Supabase bike_configs.
 * Runs once per connection (debounced 10s after last data received).
 */

import { useAuthStore } from '../../store/authStore';
import { getSavedDevice } from '../bluetooth/BLEBridge';
import { supaFetch, supaGet } from '../../lib/supaFetch';

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

  // Motor stats (GEV cmd 18)
  motor_odo_km?: number;
  motor_total_hours?: number;

  // Battery capacity (GEV cmd 16)
  bat_capacity_ah?: number;
  bat_not_charged_days?: number;
  bat_not_charged_cycles?: number;

  // Service stats (GEV cmd 10)
  service_tool_times?: number;
  last_service_hours?: number;
  last_service_km?: number;

  // JSONB fields
  mode_avg_current?: Record<string, number>;
  mode_usage_pct?: Record<string, number>;
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

/** Record motor ODO + hours from GEV cmd 18 */
export function recordMotorOdoHours(odo: number, hours: number): void {
  if (odo > 0) recordBikeData('motor_odo_km', odo);
  if (hours > 0) recordBikeData('motor_total_hours', hours);
}

/** Record battery capacity details from GEV cmd 16 */
export function recordBatteryCapacity(capacityAh: number, notChargedDays: number, notChargedCycles: number): void {
  if (capacityAh > 0) recordBikeData('bat_capacity_ah', capacityAh);
  recordBikeData('bat_not_charged_days', notChargedDays);
  recordBikeData('bat_not_charged_cycles', notChargedCycles);
}

/** Record motor avg current per mode from GEV cmd 10 */
export function recordMotorAvgCurrent(data: Record<string, number>): void {
  // Only save non-zero data
  const nonZero = Object.entries(data).filter(([, v]) => v > 0);
  if (nonZero.length > 0) {
    profile.mode_avg_current = { ...profile.mode_avg_current, ...Object.fromEntries(nonZero) };
    debounceSave();
  }
}

/** Record mode usage percentages from GEV cmd 6 */
export function recordModeUsage(data: Record<string, number>): void {
  profile.mode_usage_pct = data;
  debounceSave();
}

/** Record service tool stats from GEV cmd 10 */
export function recordServiceStats(times: number, hours: number, km: number): void {
  if (times > 0) recordBikeData('service_tool_times', times);
  if (hours > 0) recordBikeData('last_service_hours', hours);
  if (km > 0) recordBikeData('last_service_km', km);
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
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return;

  const savedDevice = getSavedDevice();
  const nonEmpty = Object.entries(profile).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== 0);
  if (nonEmpty.length < 3) return; // Not enough data

  try {
    // Use BLE device name as bike identifier (supports multiple bikes per user)
    const deviceName = savedDevice?.name ?? profile.sg_type ?? 'Unknown';

    // Check if this specific bike exists for this user
    const existing = await supaGet<Array<{ id: string }>>(
      `/rest/v1/bike_configs?user_id=eq.${userId}&ble_device_name=eq.${encodeURIComponent(deviceName)}&select=id&limit=1`,
    );

    const data = {
      user_id: userId,
      name: deviceName,
      ble_device_name: deviceName,
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
      // Motor stats (GEV cmd 18)
      motor_odo_km: profile.motor_odo_km,
      motor_total_hours: profile.motor_total_hours,
      // Battery capacity (GEV cmd 16)
      bat_capacity_ah: profile.bat_capacity_ah,
      bat_not_charged_days: profile.bat_not_charged_days,
      bat_not_charged_cycles: profile.bat_not_charged_cycles,
      // Service stats (GEV cmd 10)
      service_tool_times: profile.service_tool_times,
      last_service_hours: profile.last_service_hours,
      last_service_km: profile.last_service_km,
      // JSONB (mode data)
      mode_avg_current: profile.mode_avg_current,
      mode_usage_pct: profile.mode_usage_pct,
      hw_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (existing.length > 0) {
      await supaFetch(`/rest/v1/bike_configs?id=eq.${existing[0]!.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify(data),
      });
    } else {
      await supaFetch('/rest/v1/bike_configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
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

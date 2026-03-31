import type { AthleteProfile } from './AdaptiveLearningEngine';
import type { RideSummary } from './RideDataCollector';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

function isConfigured(): boolean {
  return !!SUPABASE_URL && !!SUPABASE_KEY && !SUPABASE_URL.includes('your-project');
}

async function supabaseFetch(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      'apikey': SUPABASE_KEY!,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
      ...options.headers,
    },
  });
}

/** Generate a stable device ID for this browser */
function getDeviceId(): string {
  let id = localStorage.getItem('bikecontrol_device_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('bikecontrol_device_id', id);
  }
  return id;
}

export async function syncProfile(profile: AthleteProfile): Promise<void> {
  if (!isConfigured()) return;

  try {
    const deviceId = getDeviceId();
    await supabaseFetch('/athlete_profiles?on_conflict=device_id', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({
        id: profile.id,
        device_id: deviceId,
        profile_data: profile,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch (err) {
    console.warn('[Sync] Profile sync failed:', err);
  }
}

export async function loadProfile(): Promise<AthleteProfile | null> {
  if (!isConfigured()) return null;

  try {
    const deviceId = getDeviceId();
    const res = await supabaseFetch(
      `/athlete_profiles?device_id=eq.${deviceId}&select=profile_data&limit=1`,
      { headers: { 'Prefer': 'return=representation' } }
    );
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      return data[0].profile_data as AthleteProfile;
    }
  } catch (err) {
    console.warn('[Sync] Profile load failed:', err);
  }
  return null;
}

export async function syncRide(profile: AthleteProfile, ride: RideSummary): Promise<void> {
  if (!isConfigured()) return;

  try {
    await supabaseFetch('/ride_summaries', {
      method: 'POST',
      body: JSON.stringify({
        athlete_id: profile.id,
        duration_s: ride.duration_s,
        total_km: ride.total_km,
        total_elevation_m: ride.total_elevation_m,
        avg_speed_kmh: ride.avg_speed_kmh,
        max_speed_kmh: ride.max_speed_kmh,
        avg_power_w: ride.avg_power_w,
        max_power_w: ride.max_power_w,
        avg_cadence: ride.avg_cadence,
        max_hr: ride.max_hr,
        avg_hr: ride.avg_hr,
        battery_start: ride.battery_start,
        battery_end: ride.battery_end,
        override_rate: ride.override_rate,
        ftp_estimate: ride.ftp_estimate,
        tss_score: ride.tss_score,
        stats: {
          avg_gradient: 0,
          climb_types_used: [...new Set(ride.override_events.map((s) => s.climb_type))],
        },
      }),
    });
  } catch (err) {
    console.warn('[Sync] Ride sync failed:', err);
  }
}

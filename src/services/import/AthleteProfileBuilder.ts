/**
 * AthleteProfileBuilder — evolve athlete profile from imported rides.
 *
 * Each ride updates:
 * - HR max (observed, keeps highest)
 * - HR zones (weighted average across rides)
 * - Fitness indicators (avg speed, distance patterns, endurance)
 * - Ride count and totals
 *
 * The more rides imported, the more accurate the profile.
 * This data feeds TuningIntelligence for personalized motor control.
 */

import type { ImportedRide, HRZoneDistribution } from './FitImportService';
import { useAuthStore } from '../../store/authStore';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export interface AthleteStats {
  // HR
  hr_max_observed: number;
  hr_avg_typical: number;
  hr_zones_avg: HRZoneDistribution;
  // Performance
  avg_speed_all: number;
  avg_distance_km: number;
  avg_ascent_m: number;
  avg_duration_min: number;
  max_distance_km: number;
  max_ascent_m: number;
  // Fitness
  total_rides: number;
  total_km: number;
  total_ascent_m: number;
  total_time_h: number;
  // Recent form
  rides_last_30d: number;
  km_last_30d: number;
  fitness_trend: 'improving' | 'maintaining' | 'declining' | 'unknown';
}

const DEFAULT_STATS: AthleteStats = {
  hr_max_observed: 0,
  hr_avg_typical: 0,
  hr_zones_avg: { z1_pct: 0, z2_pct: 0, z3_pct: 0, z4_pct: 0, z5_pct: 0 },
  avg_speed_all: 0,
  avg_distance_km: 0,
  avg_ascent_m: 0,
  avg_duration_min: 0,
  max_distance_km: 0,
  max_ascent_m: 0,
  total_rides: 0,
  total_km: 0,
  total_ascent_m: 0,
  total_time_h: 0,
  rides_last_30d: 0,
  km_last_30d: 0,
  fitness_trend: 'unknown',
};

/** Load current athlete stats from Supabase */
export async function loadAthleteStats(): Promise<AthleteStats> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return DEFAULT_STATS;
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return DEFAULT_STATS;

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/athlete_profiles?user_id=eq.${userId}&select=profile_data&limit=1`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'return=representation' } }
    );
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0 && data[0].profile_data?.athlete_stats) {
      return { ...DEFAULT_STATS, ...data[0].profile_data.athlete_stats };
    }
  } catch { /* use defaults */ }
  return DEFAULT_STATS;
}

/** Update athlete stats with a new imported ride */
export async function updateStatsFromRide(ride: ImportedRide): Promise<AthleteStats> {
  const stats = await loadAthleteStats();

  // HR max — keep highest observed
  if (ride.max_hr > stats.hr_max_observed) {
    stats.hr_max_observed = ride.max_hr;
  }

  // HR zones — running weighted average
  const n = stats.total_rides;
  if (n > 0) {
    stats.hr_zones_avg = {
      z1_pct: Math.round((stats.hr_zones_avg.z1_pct * n + ride.hrZones.z1_pct) / (n + 1)),
      z2_pct: Math.round((stats.hr_zones_avg.z2_pct * n + ride.hrZones.z2_pct) / (n + 1)),
      z3_pct: Math.round((stats.hr_zones_avg.z3_pct * n + ride.hrZones.z3_pct) / (n + 1)),
      z4_pct: Math.round((stats.hr_zones_avg.z4_pct * n + ride.hrZones.z4_pct) / (n + 1)),
      z5_pct: Math.round((stats.hr_zones_avg.z5_pct * n + ride.hrZones.z5_pct) / (n + 1)),
    };
  } else {
    stats.hr_zones_avg = { ...ride.hrZones };
  }

  // HR avg typical
  stats.hr_avg_typical = n > 0
    ? Math.round((stats.hr_avg_typical * n + ride.avg_hr) / (n + 1))
    : ride.avg_hr;

  // Totals
  stats.total_rides = n + 1;
  stats.total_km = Math.round((stats.total_km + ride.distance_km) * 10) / 10;
  stats.total_ascent_m = Math.round(stats.total_ascent_m + ride.ascent_m);
  stats.total_time_h = Math.round((stats.total_time_h + ride.duration_s / 3600) * 10) / 10;

  // Averages
  stats.avg_speed_all = Math.round((stats.avg_speed_all * n + ride.avg_speed) / (n + 1) * 10) / 10;
  stats.avg_distance_km = Math.round(stats.total_km / stats.total_rides * 10) / 10;
  stats.avg_ascent_m = Math.round(stats.total_ascent_m / stats.total_rides);
  stats.avg_duration_min = Math.round(stats.total_time_h * 60 / stats.total_rides);

  // Maxes
  if (ride.distance_km > stats.max_distance_km) stats.max_distance_km = ride.distance_km;
  if (ride.ascent_m > stats.max_ascent_m) stats.max_ascent_m = Math.round(ride.ascent_m);

  // Recent form (crude — check if ride is within 30 days)
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const rideDate = new Date(ride.startedAt).getTime();
  if (rideDate > thirtyDaysAgo) {
    stats.rides_last_30d++;
    stats.km_last_30d = Math.round((stats.km_last_30d + ride.distance_km) * 10) / 10;
  }

  // Fitness trend
  if (stats.total_rides < 3) stats.fitness_trend = 'unknown';
  else if (stats.rides_last_30d >= 8) stats.fitness_trend = 'improving';
  else if (stats.rides_last_30d >= 4) stats.fitness_trend = 'maintaining';
  else stats.fitness_trend = 'declining';

  // Save to Supabase
  await saveAthleteStats(stats);

  return stats;
}

async function saveAthleteStats(stats: AthleteStats): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return;

  try {
    // Upsert into athlete_profiles
    const deviceId = localStorage.getItem('bikecontrol_device_id') ?? crypto.randomUUID();
    await fetch(`${SUPABASE_URL}/rest/v1/athlete_profiles?on_conflict=device_id`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        device_id: deviceId,
        user_id: userId,
        profile_data: { athlete_stats: stats },
        updated_at: new Date().toISOString(),
      }),
    });
  } catch (err) {
    console.warn('[AthleteProfile] Save failed:', err);
  }
}

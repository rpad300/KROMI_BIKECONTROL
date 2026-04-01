/**
 * FitImportService — parse .FIT files and import as ride history.
 *
 * Extracts: session summary, GPS records, HR, speed, cadence, power, altitude.
 * Stores in Supabase as ride_session + ride_snapshots.
 * Updates athlete profile with observed data (HR max, zones, fitness).
 */

import FitParser from 'fit-file-parser';
import { useAuthStore } from '../../store/authStore';

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export interface ImportedRide {
  id: string;
  sport: string;
  startedAt: string;
  duration_s: number;
  distance_km: number;
  ascent_m: number;
  descent_m: number;
  avg_speed: number;
  max_speed: number;
  avg_hr: number;
  max_hr: number;
  avg_cadence: number;
  avg_power: number;
  max_power: number;
  calories: number;
  temperature: number;
  records: ImportedRecord[];
  hrZones: HRZoneDistribution;
}

export interface ImportedRecord {
  elapsed_s: number;
  lat: number;
  lng: number;
  altitude_m: number | null;
  speed_kmh: number;
  hr_bpm: number;
  cadence_rpm: number;
  power_watts: number;
  temperature: number;
  distance_km: number;
}

export interface HRZoneDistribution {
  z1_pct: number;  // Recovery < 60%
  z2_pct: number;  // Endurance 60-70%
  z3_pct: number;  // Tempo 70-80%
  z4_pct: number;  // Threshold 80-90%
  z5_pct: number;  // VO2max > 90%
}

/** Parse a .FIT file buffer into ride data */
export function parseFitFile(buffer: ArrayBuffer): Promise<ImportedRide> {
  return new Promise((resolve, reject) => {
    const parser = new FitParser({
      force: true,
      speedUnit: 'km/h',
      lengthUnit: 'km',
      elapsedRecordField: true,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parser.parse(new Uint8Array(buffer) as any, (err: any, data: any) => {
      if (err) { reject(new Error(String(err))); return; }

      const sessions = data.sessions as Record<string, unknown>[] | undefined;
      const rawRecords = data.records as Record<string, unknown>[] | undefined;

      if (!sessions?.length) { reject(new Error('No session data in FIT file')); return; }

      const s = sessions[0]!;
      const startTime = (rawRecords?.[0]?.timestamp as string) ?? new Date().toISOString();

      // Parse records
      const records: ImportedRecord[] = [];
      let maxHR = 0;
      const hrCounts = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
      let hrTotal = 0;
      let hrCount = 0;
      let firstTimestamp: number | null = null;

      (rawRecords ?? []).forEach((r) => {
        const ts = new Date(r.timestamp as string).getTime();
        if (firstTimestamp === null) firstTimestamp = ts;
        const elapsed = Math.round((ts - firstTimestamp!) / 1000);

        const hr = (r.heart_rate as number) ?? 0;
        if (hr > maxHR) maxHR = hr;
        if (hr > 0) { hrTotal += hr; hrCount++; }

        records.push({
          elapsed_s: elapsed,
          lat: (r.position_lat as number) ?? 0,
          lng: (r.position_long as number) ?? 0,
          altitude_m: (r.altitude as number) ?? (r.enhanced_altitude as number) ?? null,
          speed_kmh: (r.speed as number) ?? (r.enhanced_speed as number) ?? 0,
          hr_bpm: hr,
          cadence_rpm: (r.cadence as number) ?? 0,
          power_watts: (r.power as number) ?? 0,
          temperature: (r.temperature as number) ?? 0,
          distance_km: (r.distance as number) ?? 0,
        });
      });

      // Calculate HR zones (using observed max)
      const hrMax = maxHR || (s.max_heart_rate as number) || 163;
      records.forEach((r) => {
        if (r.hr_bpm <= 0) return;
        const pct = r.hr_bpm / hrMax;
        if (pct < 0.6) hrCounts.z1++;
        else if (pct < 0.7) hrCounts.z2++;
        else if (pct < 0.8) hrCounts.z3++;
        else if (pct < 0.9) hrCounts.z4++;
        else hrCounts.z5++;
      });

      const hrWithData = hrCounts.z1 + hrCounts.z2 + hrCounts.z3 + hrCounts.z4 + hrCounts.z5;
      const hrZones: HRZoneDistribution = hrWithData > 0 ? {
        z1_pct: Math.round(hrCounts.z1 / hrWithData * 100),
        z2_pct: Math.round(hrCounts.z2 / hrWithData * 100),
        z3_pct: Math.round(hrCounts.z3 / hrWithData * 100),
        z4_pct: Math.round(hrCounts.z4 / hrWithData * 100),
        z5_pct: Math.round(hrCounts.z5 / hrWithData * 100),
      } : { z1_pct: 0, z2_pct: 0, z3_pct: 0, z4_pct: 0, z5_pct: 0 };

      resolve({
        id: crypto.randomUUID(),
        sport: (s.sport as string) ?? 'cycling',
        startedAt: startTime,
        duration_s: Math.round((s.total_timer_time as number) ?? 0),
        distance_km: Math.round(((s.total_distance as number) ?? 0) * 100) / 100,
        ascent_m: Math.round(((s.total_ascent as number) ?? 0) * 1000) / 1000,
        descent_m: Math.round(((s.total_descent as number) ?? 0) * 1000) / 1000,
        avg_speed: Math.round(((s.avg_speed as number) ?? 0) * 10) / 10,
        max_speed: Math.round(((s.max_speed as number) ?? 0) * 10) / 10,
        avg_hr: hrCount > 0 ? Math.round(hrTotal / hrCount) : (s.avg_heart_rate as number) ?? 0,
        max_hr: hrMax,
        avg_cadence: (s.avg_cadence as number) ?? 0,
        avg_power: (s.avg_power as number) ?? 0,
        max_power: (s.max_power as number) ?? 0,
        calories: (s.total_calories as number) ?? 0,
        temperature: (s.avg_temperature as number) ?? 0,
        records,
        hrZones,
      });
    });
  });
}

/**
 * Enrich ride records with altitude from Google Maps ElevationService.
 * Saves results to Supabase elevation_cache for reuse.
 */
export async function enrichWithElevation(ride: ImportedRide): Promise<void> {
  console.log('[Elevation] Starting enrichment...');

  // Check if FIT has meaningful altitude (range > 5m means real data)
  const alts = ride.records.map((r) => r.altitude_m).filter((a): a is number => a !== null && a !== 0);
  if (alts.length > 10) {
    const altRange = Math.max(...alts) - Math.min(...alts);
    if (altRange > 5) {
      console.log(`[Elevation] FIT has real altitude (range ${altRange.toFixed(0)}m), skipping enrichment`);
      return;
    }
    console.log(`[Elevation] FIT altitude range too small (${altRange.toFixed(2)}m) — fetching from Google`);
    // Clear bad altitude data
    ride.records.forEach((r) => { r.altitude_m = null; });
  }

  const gpsRecords = ride.records.filter((r) => r.lat !== 0 && r.lng !== 0);
  console.log(`[Elevation] ${gpsRecords.length} GPS records (${ride.records.length} total)`);
  if (gpsRecords.length < 2) { console.log('[Elevation] Not enough GPS points'); return; }

  // Sample every Nth point (max ~200 for API)
  const step = Math.max(1, Math.floor(gpsRecords.length / 200));
  const sampledIdx: number[] = [];
  for (let i = 0; i < gpsRecords.length; i++) {
    if (i % step === 0 || i === gpsRecords.length - 1) sampledIdx.push(i);
  }
  console.log(`[Elevation] Sampled ${sampledIdx.length} points (step=${step})`);

  // Load Google Maps JS API
  if (!window.google?.maps) {
    if (!MAPS_KEY) { console.warn('[Elevation] No MAPS_KEY, cannot fetch'); return; }
    console.log('[Elevation] Loading Google Maps JS API...');
    await new Promise<void>((resolve) => {
      if (document.querySelector('script[src*="maps.googleapis.com"]')) {
        // Already loading, wait
        const check = setInterval(() => {
          if (window.google?.maps) { clearInterval(check); resolve(); }
        }, 200);
        setTimeout(() => { clearInterval(check); resolve(); }, 5000);
      } else {
        const s = document.createElement('script');
        s.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}`;
        s.onload = () => resolve();
        s.onerror = () => { console.error('[Elevation] Maps script failed to load'); resolve(); };
        document.head.appendChild(s);
      }
    });
  }

  if (!window.google?.maps) { console.error('[Elevation] Google Maps not available'); return; }
  console.log('[Elevation] Google Maps loaded, calling ElevationService...');

  const elevator = new google.maps.ElevationService();
  const elevations: { idx: number; alt: number }[] = [];
  const cacheEntries: { lat_key: number; lng_key: number; altitude_m: number }[] = [];

  // Process in batches of 200 (API limit ~512 but safer)
  for (let b = 0; b < sampledIdx.length; b += 200) {
    const batchIdx = sampledIdx.slice(b, b + 200);
    const locations = batchIdx.map((i) => ({ lat: gpsRecords[i]!.lat, lng: gpsRecords[i]!.lng }));

    console.log(`[Elevation] Batch ${Math.floor(b / 200) + 1}: ${locations.length} points`);

    try {
      const results = await new Promise<google.maps.ElevationResult[]>((resolve, reject) => {
        elevator.getElevationForLocations({ locations }, (res, status) => {
          if (status === google.maps.ElevationStatus.OK && res) resolve(res);
          else reject(new Error(`ElevationService: ${status}`));
        });
      });

      console.log(`[Elevation] Got ${results.length} elevations`);

      for (let i = 0; i < results.length; i++) {
        const idx = batchIdx[i]!;
        const alt = Math.round(results[i]!.elevation * 10) / 10;
        elevations.push({ idx, alt });
        gpsRecords[idx]!.altitude_m = alt;
        cacheEntries.push({
          lat_key: Math.round(gpsRecords[idx]!.lat * 10000) / 10000,
          lng_key: Math.round(gpsRecords[idx]!.lng * 10000) / 10000,
          altitude_m: alt,
        });
      }
    } catch (err) {
      console.error('[Elevation] Batch failed:', err);
    }
  }

  if (elevations.length === 0) { console.warn('[Elevation] No elevations retrieved'); return; }

  // Interpolate between sampled points
  elevations.sort((a, b) => a.idx - b.idx);
  for (let i = 0; i < elevations.length - 1; i++) {
    const from = elevations[i]!;
    const to = elevations[i + 1]!;
    for (let j = from.idx + 1; j < to.idx; j++) {
      const t = (j - from.idx) / (to.idx - from.idx);
      gpsRecords[j]!.altitude_m = Math.round((from.alt + (to.alt - from.alt) * t) * 10) / 10;
    }
  }

  const altMin = Math.min(...elevations.map((e) => e.alt));
  const altMax = Math.max(...elevations.map((e) => e.alt));
  console.log(`[Elevation] Done: ${elevations.length} samples, ${gpsRecords.length} interpolated, range ${altMin}m-${altMax}m`);

  // Save to Supabase cache (best-effort)
  if (cacheEntries.length > 0 && SUPABASE_URL && SUPABASE_KEY) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/elevation_cache?on_conflict=lat_key,lng_key`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY!,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=ignore-duplicates,return=minimal',
        },
        body: JSON.stringify(cacheEntries),
      });
      console.log(`[Elevation] Cached ${cacheEntries.length} points in Supabase`);
    } catch (err) {
      console.warn('[Elevation] Cache save failed:', err);
    }
  }
}

/** Save imported ride to Supabase (with optional simulation results) */
export async function saveImportedRide(ride: ImportedRide, sim?: { battery_end_kromi: number; battery_end_fixed: number; battery_end_max: number; avg_score: number; time_max_pct: number; time_mid_pct: number; time_min_pct: number; level_changes: number; fixed_label: string }): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return false;

  try {
    // 1. Create ride_session
    await fetch(`${SUPABASE_URL}/rest/v1/ride_sessions`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        id: ride.id,
        user_id: userId,
        status: 'completed',
        started_at: ride.startedAt,
        ended_at: new Date(new Date(ride.startedAt).getTime() + ride.duration_s * 1000).toISOString(),
        duration_s: ride.duration_s,
        total_km: ride.distance_km,
        // Calculate real elevation from enriched altitudes (FIT session data may be wrong)
        total_elevation_m: (() => {
          const alts = ride.records.filter(r => r.altitude_m !== null && r.altitude_m > 1).map(r => r.altitude_m!);
          if (alts.length < 2) return Math.round(ride.ascent_m);
          let gain = 0;
          for (let i = 1; i < alts.length; i++) { if (alts[i]! > alts[i-1]!) gain += alts[i]! - alts[i-1]!; }
          return Math.round(gain);
        })(),
        avg_speed_kmh: ride.avg_speed,
        max_speed_kmh: ride.max_speed,
        avg_power_w: ride.avg_power,
        max_power_w: ride.max_power,
        avg_cadence: ride.avg_cadence,
        max_hr: ride.max_hr,
        avg_hr: ride.avg_hr,
        battery_start: 100,
        battery_end: sim ? sim.battery_end_kromi : 100,
        start_lat: ride.records[0]?.lat || null,
        start_lng: ride.records[0]?.lng || null,
        end_lat: ride.records[ride.records.length - 1]?.lat || null,
        end_lng: ride.records[ride.records.length - 1]?.lng || null,
        devices_connected: {
          source: 'fit_import',
          sport: ride.sport,
          ...(sim ? {
            kromi_simulation: {
              battery_end_kromi: sim.battery_end_kromi,
              battery_end_fixed: sim.battery_end_fixed,
              battery_end_max: sim.battery_end_max,
              fixed_label: sim.fixed_label,
              avg_score: sim.avg_score,
              time_max_pct: sim.time_max_pct,
              time_mid_pct: sim.time_mid_pct,
              time_min_pct: sim.time_min_pct,
              level_changes: sim.level_changes,
            }
          } : {}),
        },
      }),
    });

    // 2. Save snapshots in batches of 200
    const gpsRecords = ride.records.filter((r) => r.lat !== 0 || r.speed_kmh > 0);
    for (let i = 0; i < gpsRecords.length; i += 200) {
      const batch = gpsRecords.slice(i, i + 200).map((r) => ({
        session_id: ride.id,
        elapsed_s: r.elapsed_s,
        lat: r.lat,
        lng: r.lng,
        altitude_m: r.altitude_m,
        speed_kmh: r.speed_kmh,
        cadence_rpm: r.cadence_rpm,
        power_watts: r.power_watts,
        battery_pct: 100,
        assist_mode: 0,
        distance_km: r.distance_km,
        hr_bpm: r.hr_bpm,
        hr_zone: getHRZone(r.hr_bpm, ride.max_hr),
        gradient_pct: 0,
        auto_assist_active: false,
        was_overridden: false,
      }));

      await fetch(`${SUPABASE_URL}/rest/v1/ride_snapshots`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify(batch),
      });
    }

    console.log(`[FIT Import] Saved ride: ${ride.distance_km}km, ${gpsRecords.length} snapshots`);
    return true;
  } catch (err) {
    console.error('[FIT Import] Save failed:', err);
    return false;
  }
}

function getHRZone(hr: number, hrMax: number): number {
  if (hr <= 0 || hrMax <= 0) return 0;
  const pct = hr / hrMax;
  if (pct < 0.6) return 1;
  if (pct < 0.7) return 2;
  if (pct < 0.8) return 3;
  if (pct < 0.9) return 4;
  return 5;
}

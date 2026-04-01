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
 * Enrich ride records with altitude.
 * 1. Check Supabase elevation_cache (free, instant)
 * 2. Missing points → Google ElevationService (costs API calls)
 * 3. Save new elevations to cache (never ask Google twice for same spot)
 *
 * Resolution: 4 decimal places (~10m grid).
 */
export async function enrichWithElevation(ride: ImportedRide): Promise<void> {
  const hasAlt = ride.records.some((r) => r.altitude_m !== null && r.altitude_m !== 0);
  if (hasAlt) return;

  const gpsRecords = ride.records.filter((r) => r.lat !== 0 && r.lng !== 0);
  if (gpsRecords.length < 2) return;

  // Sample points
  const step = Math.max(1, Math.floor(gpsRecords.length / 250));
  const sampled = gpsRecords.filter((_, i) => i % step === 0 || i === gpsRecords.length - 1);
  const sampledIndices = gpsRecords.map((_, i) => i).filter((i) => i % step === 0 || i === gpsRecords.length - 1);

  console.log(`[Elevation] ${sampled.length} samples from ${gpsRecords.length} points`);

  // === 1. Check Supabase cache ===
  const cached = new Map<string, number>();
  const uncached: { point: ImportedRecord; idx: number; sampleIdx: number }[] = [];

  if (SUPABASE_URL && SUPABASE_KEY) {
    // Build unique coordinate keys (4 decimal places = ~10m)
    const keys = sampled.map((r) => ({ lat: round4(r.lat), lng: round4(r.lng) }));
    const uniqueKeys = [...new Set(keys.map((k) => `${k.lat},${k.lng}`))];

    // Batch lookup (max 200 per query via filter)
    for (let i = 0; i < uniqueKeys.length; i += 100) {
      const batch = uniqueKeys.slice(i, i + 100);
      const filter = batch.map((k) => {
        const [lat, lng] = k.split(',');
        return `and(lat_key.eq.${lat},lng_key.eq.${lng})`;
      }).join(',');

      try {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/elevation_cache?or=(${filter})&select=lat_key,lng_key,altitude_m`,
          { headers: { 'apikey': SUPABASE_KEY!, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
        );
        const rows = await res.json();
        if (Array.isArray(rows)) {
          rows.forEach((r: { lat_key: number; lng_key: number; altitude_m: number }) => {
            cached.set(`${r.lat_key},${r.lng_key}`, r.altitude_m);
          });
        }
      } catch { /* continue without cache */ }
    }

    console.log(`[Elevation] Cache: ${cached.size} hits from ${uniqueKeys.length} unique coords`);
  }

  // Apply cached + identify uncached
  const elevations: { idx: number; alt: number }[] = [];

  for (let si = 0; si < sampled.length; si++) {
    const r = sampled[si]!;
    const key = `${round4(r.lat)},${round4(r.lng)}`;
    const cachedAlt = cached.get(key);

    if (cachedAlt !== undefined) {
      const idx = sampledIndices[si]!;
      elevations.push({ idx, alt: cachedAlt });
      gpsRecords[idx]!.altitude_m = cachedAlt;
    } else {
      uncached.push({ point: r, idx: sampledIndices[si]!, sampleIdx: si });
    }
  }

  // === 2. Fetch uncached from Google ===
  if (uncached.length > 0) {
    console.log(`[Elevation] Fetching ${uncached.length} from Google...`);

    // Load Google Maps if needed
    if (!window.google?.maps && MAPS_KEY) {
      await new Promise<void>((resolve) => {
        const s = document.createElement('script');
        s.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}`;
        s.onload = () => resolve();
        s.onerror = () => resolve();
        document.head.appendChild(s);
      });
    }

    if (window.google?.maps) {
      const elevator = new google.maps.ElevationService();
      const newCacheEntries: { lat_key: number; lng_key: number; altitude_m: number }[] = [];

      for (let batch = 0; batch < uncached.length; batch += 250) {
        const batchItems = uncached.slice(batch, batch + 250);
        const locations = batchItems.map((u) => ({ lat: u.point.lat, lng: u.point.lng }));

        try {
          const result = await new Promise<google.maps.ElevationResult[]>((resolve, reject) => {
            elevator.getElevationForLocations({ locations }, (results, status) => {
              if (status === google.maps.ElevationStatus.OK && results) resolve(results);
              else reject(new Error(`Elevation: ${status}`));
            });
          });

          for (let i = 0; i < result.length; i++) {
            const item = batchItems[i]!;
            const alt = Math.round(result[i]!.elevation * 10) / 10;
            elevations.push({ idx: item.idx, alt });
            gpsRecords[item.idx]!.altitude_m = alt;

            newCacheEntries.push({
              lat_key: round4(item.point.lat),
              lng_key: round4(item.point.lng),
              altitude_m: alt,
            });
          }
        } catch (err) {
          console.warn('[Elevation] Google batch failed:', err);
        }
      }

      // === 3. Save to Supabase cache ===
      if (newCacheEntries.length > 0 && SUPABASE_URL && SUPABASE_KEY) {
        try {
          await fetch(`${SUPABASE_URL}/rest/v1/elevation_cache?on_conflict=lat_key,lng_key`, {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_KEY!,
              'Authorization': `Bearer ${SUPABASE_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'resolution=ignore-duplicates,return=minimal',
            },
            body: JSON.stringify(newCacheEntries),
          });
          console.log(`[Elevation] Cached ${newCacheEntries.length} new points in Supabase`);
        } catch { /* cache save is best-effort */ }
      }
    }
  }

  // === 4. Interpolate between sampled points ===
  elevations.sort((a, b) => a.idx - b.idx);
  for (let i = 0; i < elevations.length - 1; i++) {
    const from = elevations[i]!;
    const to = elevations[i + 1]!;
    for (let j = from.idx + 1; j < to.idx; j++) {
      const t = (j - from.idx) / (to.idx - from.idx);
      gpsRecords[j]!.altitude_m = Math.round((from.alt + (to.alt - from.alt) * t) * 10) / 10;
    }
  }

  const googleHits = uncached.length;
  const cacheHits = sampled.length - uncached.length;
  console.log(`[Elevation] Done: ${cacheHits} cache + ${googleHits} Google → ${gpsRecords.length} points enriched`);
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Save imported ride to Supabase */
export async function saveImportedRide(ride: ImportedRide): Promise<boolean> {
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
        total_elevation_m: Math.round(ride.ascent_m),
        avg_speed_kmh: ride.avg_speed,
        max_speed_kmh: ride.max_speed,
        avg_power_w: ride.avg_power,
        max_power_w: ride.max_power,
        avg_cadence: ride.avg_cadence,
        max_hr: ride.max_hr,
        avg_hr: ride.avg_hr,
        battery_start: 100,
        battery_end: 100,
        start_lat: ride.records[0]?.lat || null,
        start_lng: ride.records[0]?.lng || null,
        end_lat: ride.records[ride.records.length - 1]?.lat || null,
        end_lng: ride.records[ride.records.length - 1]?.lng || null,
        devices_connected: { source: 'fit_import', sport: ride.sport },
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

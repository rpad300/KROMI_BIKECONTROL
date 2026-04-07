/**
 * FitImportService — parse .FIT files and import as ride history.
 *
 * Extracts: session summary, GPS records, HR, speed, cadence, power, altitude.
 * Stores in Supabase as ride_session + ride_snapshots.
 * Updates athlete profile with observed data (HR max, zones, fitness).
 */

import FitParser from 'fit-file-parser';
import { useAuthStore } from '../../store/authStore';
import type { SimulationSummary } from '../simulation/KromiSimulator';
import { supaFetch, supaGet } from '../../lib/supaFetch';

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

/** Detected platform/device that created the FIT file */
export interface FitPlatform {
  source: string;        // 'strava' | 'garmin' | 'wahoo' | 'igpsport' | 'hammerhead' | 'amazfit' | 'polar' | 'suunto' | 'coros' | 'bryton' | 'unknown'
  manufacturer: string;  // raw manufacturer field
  product: string;       // raw product/model
  serial?: string;       // device serial number
  software?: string;     // firmware/app version
}

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
  platform: FitPlatform;
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

/** Detect platform/device from FIT metadata */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function detectPlatform(data: any): FitPlatform {
  const fileId = data.file_ids?.[0] ?? {};
  const device = data.device_infos?.[0] ?? {};
  const mfr = (fileId.manufacturer ?? device.manufacturer ?? '').toString().toLowerCase();
  const prod = (fileId.product ?? device.product ?? '').toString();
  const serial = (fileId.serial_number ?? device.serial_number ?? '').toString() || undefined;
  const sw = device.software_version ? String(device.software_version) : undefined;

  // Known platform signatures
  const PLATFORMS: [string, (m: string, p: string) => boolean][] = [
    ['strava',      (m, p) => m === 'development' && p === '1'],
    ['garmin',      (m) => m === 'garmin' || m.startsWith('garmin')],
    ['wahoo',       (m) => m === 'wahoo_fitness' || m === 'wahoo'],
    ['igpsport',    (m) => m === 'igpsport'],
    ['hammerhead',  (m) => m === 'hammerhead'],
    ['stages',      (m) => m === 'stages_cycling'],
    ['polar',       (m) => m === 'polar'],
    ['suunto',      (m) => m === 'suunto'],
    ['coros',       (m) => m === 'coros'],
    ['bryton',      (m) => m === 'bryton'],
    ['amazfit',     (m) => m === 'huami' || m === 'amazfit' || m === 'zepp'],
    ['zwift',       (m) => m === 'zwift'],
    ['trainerroad', (m) => m === 'trainerroad'],
    ['sigma',       (m) => m === 'sigmasport' || m === 'sigma_sport'],
    ['lezyne',      (m) => m === 'lezyne'],
    ['giant',       (m) => m === 'giant_manufacturing'],
    ['shimano',     (m) => m === 'shimano'],
    ['sram',        (m) => m === 'sram'],
  ];

  for (const [name, test] of PLATFORMS) {
    if (test(mfr, prod)) {
      return { source: name, manufacturer: mfr, product: prod, serial, software: sw };
    }
  }

  return { source: 'unknown', manufacturer: mfr || 'unknown', product: prod || 'unknown', serial, software: sw };
}

/** Estimate rider power from physics when FIT has no power data */
function estimateRiderPower(records: ImportedRecord[], riderWeightKg: number, bikeWeightKg = 24.2): void {
  const totalMass = riderWeightKg + bikeWeightKg;
  const g = 9.81;
  const CdA = 0.45; // MTB position
  const Crr = 0.006; // mixed surface
  const rho = 1.2;   // air density

  for (let i = 1; i < records.length; i++) {
    const r = records[i]!;
    if (r.power_watts > 0) continue; // already has power
    if (r.speed_kmh < 1) { r.power_watts = 0; continue; }

    const v = r.speed_kmh / 3.6; // m/s

    // Calculate gradient from altitude changes
    let gradient = 0;
    const prev = records[i - 1]!;
    if (r.altitude_m !== null && prev.altitude_m !== null && r.distance_km > prev.distance_km) {
      const dAlt = r.altitude_m - prev.altitude_m;
      const dDist = (r.distance_km - prev.distance_km) * 1000;
      if (dDist > 0) gradient = dAlt / dDist;
    }

    // Physics: P = F × v
    const fGrade = totalMass * g * gradient;
    const fRoll = totalMass * g * Crr;
    const fAero = 0.5 * rho * CdA * v * v;
    const totalForce = fGrade + fRoll + fAero;
    const mechPower = Math.max(0, totalForce * v);

    // On e-bike in SMART mode, rider provides ~40-60% of total power
    // Without knowing exact assist level, estimate 50% rider contribution
    r.power_watts = Math.round(mechPower * 0.5);
  }
}

/** Parse a .FIT file buffer into ride data */
export function parseFitFile(buffer: ArrayBuffer, riderWeightKg = 135): Promise<ImportedRide> {
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

      const platform = detectPlatform(data);
      console.log(`[FIT] Platform: ${platform.source} (${platform.manufacturer}/${platform.product})`);

      // Estimate rider power if FIT has no power data
      const hasPower = records.some((r) => r.power_watts > 0);
      if (!hasPower && records.length > 10) {
        estimateRiderPower(records, riderWeightKg);
        console.log('[FIT] Power estimated from physics model');
      }

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
        platform,
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
  if (cacheEntries.length > 0) {
    try {
      await supaFetch('/rest/v1/elevation_cache?on_conflict=lat_key,lng_key', {
        method: 'POST',
        headers: {
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
export async function saveImportedRide(ride: ImportedRide, sim?: SimulationSummary): Promise<boolean> {
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return false;

  try {
    // 1. Create ride_session
    await supaFetch('/rest/v1/ride_sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
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
          platform: ride.platform,
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
    // Build elapsed_s → sim point lookup for O(1) matching
    const simByElapsed = new Map<number, SimulationSummary['points'][number]>();
    if (sim) {
      for (const pt of sim.points) simByElapsed.set(pt.elapsed_s, pt);
    }

    const gpsRecords = ride.records.filter((r) => r.lat !== 0 || r.speed_kmh > 0);
    for (let i = 0; i < gpsRecords.length; i += 200) {
      const batch = gpsRecords.slice(i, i + 200).map((r) => {
        const sp = simByElapsed.get(r.elapsed_s);
        return {
          session_id: ride.id,
          elapsed_s: r.elapsed_s,
          lat: r.lat,
          lng: r.lng,
          altitude_m: r.altitude_m,
          speed_kmh: r.speed_kmh,
          cadence_rpm: r.cadence_rpm,
          power_watts: r.power_watts,
          battery_pct: sp?.battery_pct ?? 100,
          assist_mode: sp?.kromi_level ?? 0,
          distance_km: r.distance_km,
          hr_bpm: r.hr_bpm,
          hr_zone: getHRZone(r.hr_bpm, ride.max_hr),
          gradient_pct: sp?.gradient_pct ?? 0,
          torque_nm: sp?.torque ?? 0,
          support_pct: sp?.support_pct ?? 0,
          launch_value: sp?.launch ?? 0,
          auto_assist_active: sp?.kromi_active ?? false,
          was_overridden: false,
        };
      });

      await supaFetch('/rest/v1/ride_snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
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

/**
 * Find an existing live ride session that overlaps with the FIT file's time window.
 * Returns the session ID if found, null otherwise.
 */
export async function findOverlappingSession(ride: ImportedRide): Promise<string | null> {
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return null;

  const fitStart = new Date(ride.startedAt).toISOString();
  const fitEnd = new Date(new Date(ride.startedAt).getTime() + ride.duration_s * 1000).toISOString();

  try {
    // Find sessions that overlap: session started before FIT ends AND ended after FIT starts
    const sessions = await supaGet<Array<{ id: string; started_at: string; ended_at: string; duration_s: number; total_km: number; devices_connected: { source?: string } }>>(
      `/rest/v1/ride_sessions?user_id=eq.${userId}&started_at=lte.${fitEnd}&ended_at=gte.${fitStart}&select=id,started_at,ended_at,duration_s,total_km,devices_connected&limit=1`,
    );
    if (sessions.length === 0) return null;

    const existing = sessions[0]!;
    // Only merge if NOT already a FIT import
    const source = existing.devices_connected?.source;
    if (source === 'fit_import' || source === 'fit_import+ble_bridge') return null;

    console.log(`[FIT Merge] Found overlapping live session: ${existing.id}`);
    return existing.id;
  } catch {
    return null;
  }
}

/**
 * Merge FIT data (GPS, HR, altitude) into an existing live ride session's snapshots.
 * The live session has motor data (power, battery, assist, torque, cadence).
 * The FIT has GPS + HR that the live session may be missing.
 */
export async function mergeIntoSession(sessionId: string, ride: ImportedRide): Promise<boolean> {
  try {
    // 1. Fetch existing snapshots
    const existingSnaps = await supaGet<{ id: number; elapsed_s: number; lat: number; lng: number; altitude_m: number | null; hr_bpm: number; speed_kmh: number; cadence_rpm: number; power_watts: number }[]>(
      `/rest/v1/ride_snapshots?session_id=eq.${sessionId}&select=id,elapsed_s,lat,lng,altitude_m,hr_bpm,hr_zone,speed_kmh,cadence_rpm,power_watts&order=elapsed_s`,
    );

    if (existingSnaps.length === 0) return false;

    // 2. Build FIT record lookup by elapsed_s (offset by session start vs FIT start)
    // The FIT may start earlier or later than the live session
    const sessionData = await supaGet<Array<{ started_at: string }>>(
      `/rest/v1/ride_sessions?id=eq.${sessionId}&select=started_at`,
    );
    const sessionStart = new Date(sessionData[0]?.started_at ?? 0).getTime();
    const fitStart = new Date(ride.startedAt).getTime();
    const offsetS = Math.round((sessionStart - fitStart) / 1000); // FIT elapsed → session elapsed

    // Map FIT records by adjusted elapsed_s for O(1) lookup
    const fitByElapsed = new Map<number, ImportedRecord>();
    for (const r of ride.records) {
      const adjElapsed = r.elapsed_s - offsetS;
      fitByElapsed.set(adjElapsed, r);
      // Also set ±1s and ±2s for fuzzy matching
      fitByElapsed.set(adjElapsed - 1, r);
      fitByElapsed.set(adjElapsed + 1, r);
      fitByElapsed.set(adjElapsed - 2, r);
      fitByElapsed.set(adjElapsed + 2, r);
    }

    // 3. Merge: enrich live snapshots with FIT GPS + HR
    let merged = 0;
    const updates: { id: number; patch: Record<string, unknown> }[] = [];

    for (const snap of existingSnaps) {
      const fitRec = fitByElapsed.get(snap.elapsed_s);
      if (!fitRec) continue;

      const patch: Record<string, unknown> = {};
      // GPS: use FIT if live has 0,0
      if ((snap.lat === 0 || !snap.lat) && fitRec.lat !== 0) {
        patch.lat = fitRec.lat;
        patch.lng = fitRec.lng;
      }
      // Altitude: use FIT if live has none
      if (snap.altitude_m === null && fitRec.altitude_m !== null) {
        patch.altitude_m = fitRec.altitude_m;
      }
      // HR: use FIT if live has 0
      if (snap.hr_bpm === 0 && fitRec.hr_bpm > 0) {
        patch.hr_bpm = fitRec.hr_bpm;
        patch.hr_zone = getHRZone(fitRec.hr_bpm, ride.max_hr);
      }

      if (Object.keys(patch).length > 0) {
        updates.push({ id: snap.id, patch });
        merged++;
      }
    }

    // 4. Apply patches in batches
    for (const { id, patch } of updates) {
      await supaFetch(`/rest/v1/ride_snapshots?id=eq.${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify(patch),
      });
    }

    // 5. Update session with FIT data (HR, elevation, platform)
    const updateSession: Record<string, unknown> = {};
    if (ride.avg_hr > 0) { updateSession.avg_hr = ride.avg_hr; updateSession.max_hr = ride.max_hr; }
    if (ride.ascent_m > 0) updateSession.total_elevation_m = Math.round(ride.ascent_m);
    updateSession.devices_connected = {
      source: 'live+fit_merge',
      fit_platform: ride.platform,
      fit_file: ride.platform.source,
    };

    if (Object.keys(updateSession).length > 0) {
      await supaFetch(`/rest/v1/ride_sessions?id=eq.${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify(updateSession),
      });
    }

    console.log(`[FIT Merge] Merged ${merged}/${existingSnaps.length} snapshots with FIT data (GPS+HR+altitude)`);
    return true;
  } catch (err) {
    console.error('[FIT Merge] Failed:', err);
    return false;
  }
}

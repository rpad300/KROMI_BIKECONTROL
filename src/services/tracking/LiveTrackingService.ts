/**
 * LiveTrackingService — broadcasts rider position + KPIs every 15s.
 *
 * Uses Supabase REST (via supaFetch) to:
 *   - POST tracking_sessions to start a session (returns share token)
 *   - PATCH tracking_sessions every 15s with latest snapshot
 *   - INSERT tracking_points every 15s for the breadcrumb trail
 *
 * Public viewers can follow by token without authentication.
 * RLS: owner CRUD via kromi_uid(), public SELECT unrestricted.
 */

import { supaFetch } from '../../lib/supaFetch';
import { useAuthStore } from '../../store/authStore';
import { useBikeStore } from '../../store/bikeStore';
import { useMapStore } from '../../store/mapStore';
import { useRouteStore } from '../../store/routeStore';
import { useSettingsStore } from '../../store/settingsStore';

// ─── Constants ───────────────────────────────────────────────────────────────

const BROADCAST_INTERVAL_MS = 15_000;
const SESSIONS_PATH = '/rest/v1/tracking_sessions';
const POINTS_PATH = '/rest/v1/tracking_points';

// ─── Module-level state ───────────────────────────────────────────────────────

let _sessionId: string | null = null;
let _token: string | null = null;
let _intervalHandle: ReturnType<typeof setInterval> | null = null;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Start a live tracking session.
 * Creates a tracking_sessions row, starts the 15s broadcast loop.
 * Returns the share token, or null if the user is not authenticated.
 */
export async function startTracking(): Promise<string | null> {
  if (_token) {
    // Already tracking — return existing token
    return _token;
  }

  const user = useAuthStore.getState().user;
  if (!user?.id) {
    console.warn('[LiveTracking] Cannot start — user not authenticated');
    return null;
  }

  const settings = useSettingsStore.getState();
  const riderName = settings.riderProfile?.name ?? null;
  const bikeName = settings.bikeConfig?.name ?? null;

  try {
    const res = await supaFetch(SESSIONS_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        user_id: user.id,
        rider_name: riderName,
        bike_name: bikeName,
      }),
    });

    const rows = (await res.json()) as Array<{ id: string; token: string }>;
    const row = rows[0];
    if (!row?.id || !row?.token) {
      console.error('[LiveTracking] Unexpected response from tracking_sessions POST', rows);
      return null;
    }

    _sessionId = row.id;
    _token = row.token;

    // Broadcast immediately, then every 15s
    await broadcastUpdate();
    _intervalHandle = setInterval(() => {
      broadcastUpdate().catch((err) =>
        console.warn('[LiveTracking] Broadcast error:', err),
      );
    }, BROADCAST_INTERVAL_MS);

    console.info(`[LiveTracking] Session started — token: ${_token}`);
    return _token;
  } catch (err) {
    console.error('[LiveTracking] Failed to start session:', err);
    return null;
  }
}

/**
 * Stop the active tracking session.
 * Patches is_active=false + ended_at, clears the interval.
 */
export async function stopTracking(): Promise<void> {
  if (!_sessionId) return;

  // Clear interval immediately so no more broadcasts fire
  if (_intervalHandle !== null) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
  }

  const sessionId = _sessionId;
  _sessionId = null;
  _token = null;

  try {
    await supaFetch(`${SESSIONS_PATH}?id=eq.${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        is_active: false,
        ended_at: new Date().toISOString(),
      }),
    });
    console.info('[LiveTracking] Session stopped');
  } catch (err) {
    console.warn('[LiveTracking] Error stopping session:', err);
  }
}

/**
 * Return the current share token (null if not tracking).
 */
export function getTrackingToken(): string | null {
  return _token;
}

/**
 * Return true when a tracking session is active.
 */
export function isTracking(): boolean {
  return _token !== null && _sessionId !== null;
}

// ─── Internal broadcast ───────────────────────────────────────────────────────

/**
 * Read current state from all relevant stores and push a snapshot to
 * tracking_sessions (PATCH) + tracking_points (INSERT).
 */
async function broadcastUpdate(): Promise<void> {
  if (!_sessionId) return;

  // ── Gather state ───────────────────────────────────────────────
  const map = useMapStore.getState();
  const bike = useBikeStore.getState();
  const route = useRouteStore.getState();
  const settings = useSettingsStore.getState();

  const lat = map.latitude;
  const lng = map.longitude;
  const altitude = map.altitude ?? undefined;
  const heading = map.heading;

  const speedKmh = bike.speed_kmh;
  const batteryPct = bike.battery_percent;
  const heartRate = bike.hr_bpm;
  const powerWatts = bike.power_watts;
  const cadenceRpm = bike.cadence_rpm;
  const assistMode = bike.assist_mode as number;
  const gear = bike.gear;
  const totalGears = bike.total_gears;
  const rangeKm = bike.range_km;
  const distanceKm = bike.trip_distance_km ?? 0;
  const elevationGainM = bike.elevation_gain_m;

  // Compute running avg speed from ride time + distance
  const avgSpeedKmh =
    bike.ride_time_s > 0
      ? Math.round((distanceKm / (bike.ride_time_s / 3600)) * 10) / 10
      : 0;

  // ── Route navigation fields (only when active) ─────────────────
  let routeName: string | null = null;
  let routeTotalKm: number | null = null;
  let routeDoneKm: number | null = null;
  let routeRemainingKm: number | null = null;
  let routeEtaMin: number | null = null;
  let routeProgressPct: number | null = null;

  const nav = route.navigation;
  if (nav.active && route.activeRoute) {
    routeName = route.activeRoute.name ?? null;
    routeTotalKm = route.activeRoute.total_distance_km ?? null;
    routeDoneKm =
      Math.round((nav.distanceFromStart_m / 1000) * 100) / 100;
    routeRemainingKm =
      Math.round((nav.distanceRemaining_m / 1000) * 100) / 100;
    routeProgressPct = Math.round(nav.progress_pct * 10) / 10;
    // ETA from pre-ride analysis adjusted by progress (rough estimate)
    if (route.preRideAnalysis?.estimated_time_min) {
      const remainingFraction = 1 - nav.progress_pct / 100;
      routeEtaMin = Math.round(
        route.preRideAnalysis.estimated_time_min * remainingFraction,
      );
    }
  }

  const now = new Date().toISOString();
  const riderName = settings.riderProfile?.name ?? null;
  const bikeName = settings.bikeConfig?.name ?? null;

  // ── PATCH tracking_sessions ────────────────────────────────────
  const sessionPatch = {
    lat,
    lng,
    ...(altitude !== undefined ? { altitude } : {}),
    heading,
    speed_kmh: speedKmh,
    avg_speed_kmh: avgSpeedKmh,
    distance_km: distanceKm,
    elevation_gain_m: elevationGainM,
    battery_pct: batteryPct,
    heart_rate: heartRate,
    power_watts: powerWatts,
    cadence_rpm: cadenceRpm,
    assist_mode: assistMode,
    gear,
    total_gears: totalGears,
    range_km: rangeKm,
    route_name: routeName,
    route_total_km: routeTotalKm,
    route_done_km: routeDoneKm,
    route_remaining_km: routeRemainingKm,
    route_eta_min: routeEtaMin,
    route_progress_pct: routeProgressPct,
    updated_at: now,
    rider_name: riderName,
    bike_name: bikeName,
  };

  // ── INSERT tracking_points ─────────────────────────────────────
  const point = {
    session_id: _sessionId,
    lat,
    lng,
    ...(altitude !== undefined ? { altitude } : {}),
    speed_kmh: speedKmh,
    heart_rate: heartRate,
    recorded_at: now,
  };

  // Fire both in parallel; failures are logged but don't crash the app
  await Promise.allSettled([
    supaFetch(`${SESSIONS_PATH}?id=eq.${_sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sessionPatch),
    }),
    supaFetch(POINTS_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(point),
    }),
  ]).then((results) => {
    for (const r of results) {
      if (r.status === 'rejected') {
        console.warn('[LiveTracking] Broadcast partial failure:', r.reason);
      }
    }
  });
}

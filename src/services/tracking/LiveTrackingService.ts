/**
 * LiveTrackingService — always-on auto-tracking using permanent user token.
 *
 * Uses the rider's `emergency_qr_token` as a permanent share token.
 * Automatically starts broadcasting when BLE connects (bike on)
 * and stops when BLE disconnects (bike off / app closes).
 *
 * The share URL never changes: `live.html?t={emergency_qr_token}`
 *
 * Uses Supabase REST (via supaFetch) to:
 *   - GET/POST/PATCH tracking_sessions (one row per user, reused)
 *   - PATCH tracking_sessions every 15s with latest snapshot
 *   - INSERT tracking_points every 15s for the breadcrumb trail
 *
 * Public viewers can follow by token without authentication.
 * RLS: owner CRUD via kromi_uid(), public SELECT unrestricted.
 */

import { supaFetch, supaGet } from '../../lib/supaFetch';
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
let _bleUnsub: (() => void) | null = null;
let _broadcasting = false;

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrackingSessionRow {
  id: string;
  token: string;
  user_id: string;
  is_active: boolean;
  started_at: string;
  ended_at: string | null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialize auto-tracking — call once on app boot.
 * Subscribes to bikeStore ble_status changes and auto-starts/stops
 * broadcasting when the bike connects/disconnects.
 */
export function initAutoTracking(): void {
  // Prevent double init
  if (_bleUnsub) return;

  const user = useAuthStore.getState().user;
  if (!user?.id) {
    console.warn('[LiveTracking] Cannot init — user not authenticated');
    return;
  }

  const token = useSettingsStore.getState().riderProfile?.emergency_qr_token;
  if (!token || token.length < 32) {
    console.info('[LiveTracking] Skipping — no emergency_qr_token set');
    return;
  }

  _token = token;

  // React to BLE status changes (plain subscribe — no subscribeWithSelector)
  let prevBleStatus = useBikeStore.getState().ble_status;
  _bleUnsub = useBikeStore.subscribe((state) => {
    const status = state.ble_status;
    if (status === prevBleStatus) return;
    prevBleStatus = status;

    if (status === 'connected') {
      startBroadcasting().catch((err) =>
        console.warn('[LiveTracking] Error starting broadcast:', err),
      );
    } else {
      stopBroadcasting().catch((err) =>
        console.warn('[LiveTracking] Error stopping broadcast:', err),
      );
    }
  });

  // If already connected at init time, start immediately
  if (useBikeStore.getState().ble_status === 'connected') {
    startBroadcasting().catch((err) =>
      console.warn('[LiveTracking] Error starting broadcast on init:', err),
    );
  }

  console.info('[LiveTracking] Auto-tracking initialized');
}

/**
 * Stop tracking and cleanup — call on app unmount.
 */
export function cleanupAutoTracking(): void {
  if (_bleUnsub) {
    _bleUnsub();
    _bleUnsub = null;
  }
  stopBroadcasting().catch(() => {});
  _token = null;
}

/**
 * Get the permanent share URL for this user.
 * Returns null if no emergency_qr_token is configured.
 */
export function getShareUrl(): string | null {
  const token =
    _token ?? useSettingsStore.getState().riderProfile?.emergency_qr_token;
  if (!token || token.length < 32) return null;
  return `https://www.kromi.online/live.html?t=${token}`;
}

/**
 * Check if currently broadcasting (BLE connected + session active).
 */
export function isLiveBroadcasting(): boolean {
  return _broadcasting;
}

// ─── Legacy compat exports (used by Settings page) ──────────────────────────

/** @deprecated Use isLiveBroadcasting() */
export function isTracking(): boolean {
  return _broadcasting;
}

/** @deprecated Use getShareUrl() */
export function getTrackingToken(): string | null {
  return _token;
}

// ─── Internal: start/stop broadcasting ────────────────────────────────────────

async function startBroadcasting(): Promise<void> {
  if (_broadcasting) return;

  const user = useAuthStore.getState().user;
  if (!user?.id || !_token) return;

  const settings = useSettingsStore.getState();
  const riderName = settings.riderProfile?.name ?? null;
  const bikeName = settings.bikeConfig?.name ?? null;

  try {
    // Try to find existing session row for this user+token
    const existing = await supaGet<TrackingSessionRow[]>(
      `${SESSIONS_PATH}?user_id=eq.${user.id}&token=eq.${encodeURIComponent(_token)}&limit=1`,
    );

    if (existing && existing.length > 0 && existing[0]) {
      // Reuse existing row — PATCH to reactivate
      _sessionId = existing[0].id;
      await supaFetch(`${SESSIONS_PATH}?id=eq.${_sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_active: true,
          started_at: new Date().toISOString(),
          ended_at: null,
          rider_name: riderName,
          bike_name: bikeName,
        }),
      });
    } else {
      // Create new session row with permanent token
      const res = await supaFetch(SESSIONS_PATH, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          user_id: user.id,
          token: _token,
          rider_name: riderName,
          bike_name: bikeName,
        }),
      });

      const rows = (await res.json()) as TrackingSessionRow[];
      const row = rows[0];
      if (!row?.id) {
        console.error('[LiveTracking] Unexpected response from POST', rows);
        return;
      }
      _sessionId = row.id;
    }

    _broadcasting = true;

    // Broadcast immediately, then every 15s
    await broadcastUpdate();
    _intervalHandle = setInterval(() => {
      broadcastUpdate().catch((err) =>
        console.warn('[LiveTracking] Broadcast error:', err),
      );
    }, BROADCAST_INTERVAL_MS);

    console.info(`[LiveTracking] Broadcasting started — session ${_sessionId}`);
  } catch (err) {
    console.error('[LiveTracking] Failed to start broadcasting:', err);
  }
}

async function stopBroadcasting(): Promise<void> {
  if (!_broadcasting && !_sessionId) return;

  // Clear interval immediately
  if (_intervalHandle !== null) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
  }

  _broadcasting = false;

  // Mark session as inactive (but keep the row for "last seen")
  if (_sessionId) {
    const sessionId = _sessionId;
    try {
      await supaFetch(`${SESSIONS_PATH}?id=eq.${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_active: false,
          ended_at: new Date().toISOString(),
        }),
      });
      console.info('[LiveTracking] Broadcasting stopped');
    } catch (err) {
      console.warn('[LiveTracking] Error marking session inactive:', err);
    }
  }

  // Don't clear _sessionId — we'll reuse it on next connect
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

/**
 * KalmanFilter.ts — Pure 2D Kalman filter for GPS position smoothing.
 *
 * Models position (lat/lng in degrees) and velocity (deg/s).
 * Process noise assumes max 2 m/s² acceleration.
 * Measurement noise derived from GPS accuracy (meters).
 */

/** Degrees per meter (approximate, valid for typical GPS use). */
const DEG_PER_METER = 1 / 111_320;

/** Maximum gap (ms) before resetting the filter instead of predicting. */
const MAX_GAP_MS = 30_000;

/** Assumed max acceleration for process noise (m/s²). */
const PROCESS_ACCEL_MS2 = 2;

export interface KalmanState {
  /** Estimated latitude (degrees). */
  lat: number;
  /** Estimated longitude (degrees). */
  lng: number;
  /** Estimated velocity in latitude direction (deg/s). */
  vLat: number;
  /** Estimated velocity in longitude direction (deg/s). */
  vLng: number;
  /** Estimated position accuracy (meters). */
  accuracy: number;
  /** Timestamp of the last update (ms since epoch). 0 = uninitialised. */
  timestamp: number;
  /** Position covariance scalar (deg²). Represents uncertainty in position. */
  p: number;
}

export interface GpsMeasurement {
  lat: number;
  lng: number;
  /** GPS-reported accuracy in meters (1-sigma). */
  accuracy: number;
  /** Measurement timestamp (ms since epoch). */
  timestamp: number;
}

/**
 * Returns a zeroed KalmanState with high initial uncertainty.
 * timestamp=0 signals "not yet initialised" to updateKalman.
 */
export function createKalmanState(): KalmanState {
  return {
    lat: 0,
    lng: 0,
    vLat: 0,
    vLng: 0,
    accuracy: 999,
    timestamp: 0,
    p: 1,
  };
}

/**
 * Pure Kalman update — returns a new state, never mutates the input.
 *
 * Algorithm (per axis, applied identically to lat and lng):
 *   Predict:
 *     pos_pred  = pos + v * dt
 *     v_pred    = v  (constant-velocity model)
 *     p_pred    = p + Q          where Q = (accel * dt²)² converted to deg²
 *   Update:
 *     R         = (accuracy_m * DEG_PER_METER)²
 *     K         = p_pred / (p_pred + R)
 *     pos_new   = pos_pred + K * (measurement - pos_pred)
 *     v_new     = v_pred  + K * (measurement - pos_pred) / dt  (only if dt > 0)
 *     p_new     = (1 - K) * p_pred
 */
export function updateKalman(
  state: KalmanState,
  measurement: GpsMeasurement,
): KalmanState {
  const { lat, lng, accuracy: measAccuracy, timestamp: measTs } = measurement;

  // ── First fix or stale state: reset filter to raw measurement ──────────────
  const isFirstFix = state.timestamp === 0;
  const gap = measTs - state.timestamp;
  const isStale = gap > MAX_GAP_MS;

  if (isFirstFix || isStale) {
    return {
      lat,
      lng,
      vLat: 0,
      vLng: 0,
      accuracy: measAccuracy,
      timestamp: measTs,
      p: (measAccuracy * DEG_PER_METER) ** 2,
    };
  }

  // ── Time delta (seconds) ───────────────────────────────────────────────────
  const dt = Math.max(gap / 1_000, 0); // seconds, clamp to ≥ 0

  // ── Predict ────────────────────────────────────────────────────────────────
  const predLat = state.lat + state.vLat * dt;
  const predLng = state.lng + state.vLng * dt;

  // Process noise: model uncertainty growth due to unknown acceleration.
  // Q = (accel_deg * dt²)² = ((accel_ms2 * DEG_PER_METER) * dt²)²
  // Using a simplified scalar Q shared across both axes.
  const accelDeg = PROCESS_ACCEL_MS2 * DEG_PER_METER;
  const Q = (accelDeg * dt * dt) ** 2;

  const predP = state.p + Q;

  // ── Measurement noise ──────────────────────────────────────────────────────
  // R = (accuracy in degrees)²
  const R = (measAccuracy * DEG_PER_METER) ** 2;

  // ── Kalman gain ────────────────────────────────────────────────────────────
  const K = predP / (predP + R);

  // ── Update position ────────────────────────────────────────────────────────
  const innovLat = lat - predLat;
  const innovLng = lng - predLng;

  const newLat = predLat + K * innovLat;
  const newLng = predLng + K * innovLng;

  // ── Update velocity (only meaningful when dt > 0) ─────────────────────────
  let newVLat = state.vLat;
  let newVLng = state.vLng;
  if (dt > 0) {
    newVLat = state.vLat + (K * innovLat) / dt;
    newVLng = state.vLng + (K * innovLng) / dt;
  }

  // ── Update covariance ──────────────────────────────────────────────────────
  const newP = (1 - K) * predP;

  // ── Estimated accuracy back in meters ─────────────────────────────────────
  const estimatedAccuracy = Math.sqrt(newP) / DEG_PER_METER;

  return {
    lat: newLat,
    lng: newLng,
    vLat: newVLat,
    vLng: newVLng,
    accuracy: estimatedAccuracy,
    timestamp: measTs,
    p: newP,
  };
}

/**
 * GPSFilterEngine.ts — Brain of GPS recording decisions for KROMI BikeControl.
 *
 * Combines a Kalman filter for position smoothing, altitude median buffering,
 * adaptive-interval recording, and heading-change boost logic.
 *
 * Usage:
 *   resetEngine();                         // call on trip start
 *   const result = processGPSFix(raw, bikeSpeed);
 */

import { createKalmanState, updateKalman, type KalmanState } from './KalmanFilter';
import { haversineM } from './DouglasPeucker';

// ── Constants ────────────────────────────────────────────────────────────────

const ACCURACY_REJECT    = 50;   // metres — gate; worse = skip fix
const ACCURACY_DEGRADED  = 25;   // metres — threshold for 'good' vs 'degraded'
const MIN_DISTANCE_M     =  3;   // metres — min distance between recorded points
const HEADING_CHANGE_DEG = 15;   // degrees — heading delta that triggers forced record
const MAX_INTERVAL_MS    = 10_000; // ms — safety-net: force record if moving and no point yet
const ELEV_THRESHOLD_M   =  2;   // metres — default gain accumulation threshold
const ELEV_BUFFER_SIZE   =  5;   // samples in the rolling altitude median buffer

// ── Exported Types ───────────────────────────────────────────────────────────

export type GpsQuality = 'good' | 'degraded' | 'poor';

export interface GPSFixResult {
  lat: number;
  lng: number;
  altitude: number | null;
  heading: number | null;
  accuracy: number;
  gpsQuality: GpsQuality;
  shouldRecord: boolean;
  elevationGain: number;
}

// ── Raw fix input (mirrors GeolocationCoordinates subset) ────────────────────

export interface RawGPSFix {
  lat: number;
  lng: number;
  altitude: number | null;
  heading: number | null;
  accuracy: number;
  timestamp: number; // ms since epoch
}

// ── Internal recorded-point snapshot ─────────────────────────────────────────

interface RecordedPoint {
  lat: number;
  lng: number;
  heading: number | null;
}

// ── Mutable singleton state (reset per ride) ──────────────────────────────────

let _kalman: KalmanState = createKalmanState();
let _lastRecorded: RecordedPoint | null = null;
let _lastRecordedAt: number = 0;

let _altBuffer: number[] = [];
let _smoothedAlt: number | null = null;
let _prevSmoothedAlt: number | null = null;

let _elevGain: number = 0;
let _pointCount: number = 0;
let _consecutiveAltTrend: number = 0; // positive = ascending, negative = descending

// ── Exported lifecycle helpers ────────────────────────────────────────────────

/** Zero all state. Call before every new trip. */
export function resetEngine(): void {
  _kalman           = createKalmanState();
  _lastRecorded     = null;
  _lastRecordedAt   = 0;
  _altBuffer        = [];
  _smoothedAlt      = null;
  _prevSmoothedAlt  = null;
  _elevGain         = 0;
  _pointCount       = 0;
  _consecutiveAltTrend = 0;
}

/** Returns the accumulated elevation gain (metres) for the current ride. */
export function getElevationGain(): number {
  return _elevGain;
}

/** Returns the number of recorded GPS points in the current ride. */
export function getPointCount(): number {
  return _pointCount;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Returns the median value of a numeric array (does not mutate). */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    // mid >= 1 because length >= 2 when even
    return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
  }
  return sorted[mid] as number;
}

/** Computes the shortest angular difference between two headings (0-360). */
function headingDelta(a: number, b: number): number {
  let diff = Math.abs(a - b) % 360;
  if (diff > 180) diff = 360 - diff;
  return diff;
}

// ── Speed-adaptive recording interval (ms) ────────────────────────────────────

function recordingIntervalMs(bikeSpeed: number): number {
  if (bikeSpeed < 10)  return 5_000;
  if (bikeSpeed <= 30) return 2_000;
  return 1_000;
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Process a single raw GPS fix and decide whether it should be recorded.
 *
 * @param raw        Raw GPS fix from Navigator.geolocation or simulation.
 * @param bikeSpeed  Current bike speed in km/h (from CSC or GEV).
 * @returns          Smoothed position + recording decision.
 */
export function processGPSFix(raw: RawGPSFix, bikeSpeed: number): GPSFixResult {
  const now = raw.timestamp;

  // ── 1. Accuracy gate ────────────────────────────────────────────────────────
  if (raw.accuracy > ACCURACY_REJECT) {
    // Use last Kalman estimate if available, otherwise fall back to raw.
    const lat = _kalman.timestamp > 0 ? _kalman.lat : raw.lat;
    const lng = _kalman.timestamp > 0 ? _kalman.lng : raw.lng;
    return {
      lat,
      lng,
      altitude: _smoothedAlt,
      heading: raw.heading,
      accuracy: raw.accuracy,
      gpsQuality: 'poor',
      shouldRecord: false,
      elevationGain: _elevGain,
    };
  }

  // ── 2. Kalman filter update ─────────────────────────────────────────────────
  _kalman = updateKalman(_kalman, {
    lat: raw.lat,
    lng: raw.lng,
    accuracy: raw.accuracy,
    timestamp: now,
  });

  const filteredLat = _kalman.lat;
  const filteredLng = _kalman.lng;
  const filteredAccuracy = _kalman.accuracy;

  // ── 3. Altitude smoothing ───────────────────────────────────────────────────
  if (raw.altitude !== null) {
    _altBuffer.push(raw.altitude);
    if (_altBuffer.length > ELEV_BUFFER_SIZE) {
      _altBuffer.shift();
    }
    const med = median(_altBuffer);
    // Exponential smooth: 0.3 weight on new median, 0.7 on previous.
    _prevSmoothedAlt = _smoothedAlt;
    _smoothedAlt = _smoothedAlt === null ? med : 0.7 * _smoothedAlt + 0.3 * med;
  }

  // ── 4. Elevation gain accumulation ─────────────────────────────────────────
  if (_smoothedAlt !== null && _prevSmoothedAlt !== null) {
    const delta = _smoothedAlt - _prevSmoothedAlt;

    // Track consecutive trend direction.
    if (delta > 0) {
      _consecutiveAltTrend = _consecutiveAltTrend > 0 ? _consecutiveAltTrend + 1 : 1;
    } else if (delta < 0) {
      _consecutiveAltTrend = _consecutiveAltTrend < 0 ? _consecutiveAltTrend - 1 : -1;
    }
    // (delta === 0 leaves the streak unchanged)

    // Reduce threshold to 1m when slow-speed and same-direction for 5+ samples.
    const highConfidence =
      bikeSpeed > 5 && Math.abs(_consecutiveAltTrend) >= 5;
    const threshold = highConfidence ? 1 : ELEV_THRESHOLD_M;

    if (delta > threshold) {
      _elevGain += delta;
    }
  }

  // ── 5. GPS quality ──────────────────────────────────────────────────────────
  const gpsQuality: GpsQuality = filteredAccuracy <= ACCURACY_DEGRADED ? 'good' : 'degraded';

  // ── 6. Recording decision ───────────────────────────────────────────────────
  let shouldRecord = false;

  if (bikeSpeed >= 2) {
    const elapsed = _lastRecordedAt > 0 ? now - _lastRecordedAt : Infinity;
    const interval = recordingIntervalMs(bikeSpeed);

    // a) Normal interval elapsed.
    if (elapsed >= interval) {
      shouldRecord = true;
    }

    // b) Heading-change boost.
    if (!shouldRecord && _lastRecorded !== null) {
      const dist = haversineM(
        { lat: _lastRecorded.lat, lng: _lastRecorded.lng },
        { lat: filteredLat, lng: filteredLng },
      );
      if (
        dist > MIN_DISTANCE_M &&
        raw.heading !== null &&
        _lastRecorded.heading !== null &&
        headingDelta(raw.heading, _lastRecorded.heading) > HEADING_CHANGE_DEG
      ) {
        shouldRecord = true;
      }
    }

    // c) Safety net: > MAX_INTERVAL_MS with no recorded point.
    if (!shouldRecord && elapsed > MAX_INTERVAL_MS) {
      shouldRecord = true;
    }

    // d) Minimum distance gate — override shouldRecord if too close.
    if (shouldRecord && _lastRecorded !== null) {
      const dist = haversineM(
        { lat: _lastRecorded.lat, lng: _lastRecorded.lng },
        { lat: filteredLat, lng: filteredLng },
      );
      if (dist < MIN_DISTANCE_M) {
        shouldRecord = false;
      }
    }
  }
  // bikeSpeed < 2 km/h → shouldRecord remains false.

  // ── 7. Commit recorded point ────────────────────────────────────────────────
  if (shouldRecord) {
    _lastRecorded = { lat: filteredLat, lng: filteredLng, heading: raw.heading };
    _lastRecordedAt = now;
    _pointCount++;
  }

  return {
    lat: filteredLat,
    lng: filteredLng,
    altitude: _smoothedAlt,
    heading: raw.heading,
    accuracy: filteredAccuracy,
    gpsQuality,
    shouldRecord,
    elevationGain: _elevGain,
  };
}

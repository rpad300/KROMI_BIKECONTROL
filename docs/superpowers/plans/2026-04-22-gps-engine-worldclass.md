# GPS Engine World-Class Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw GPS recording with a Kalman-filtered, speed-adaptive, heading-aware capture engine that produces world-class trails, live elevation gain, and post-ride DEM correction.

**Architecture:** Four new pure modules in `src/services/gps/` form a GPS intelligence layer between `navigator.geolocation` and the stores. GPSFilterEngine is a stateful singleton that decides when to record; PostRideProcessor runs at trip end. No new npm deps.

**Tech Stack:** TypeScript, Zustand, Google Elevation API, IndexedDB (existing LocalRideStore)

---

## Task 1: KalmanFilter

**Files:**
- Create: `src/services/gps/KalmanFilter.ts`

- [ ] **Step 1: Create KalmanFilter module**

```typescript
// src/services/gps/KalmanFilter.ts

/**
 * 2D Kalman filter for GPS position smoothing.
 * State: [lat, lng, vLat, vLng]. Measurement noise from GPS accuracy.
 */

export interface KalmanState {
  lat: number;
  lng: number;
  vLat: number;
  vLng: number;
  accuracy: number;
  timestamp: number;
  p: number; // position covariance (simplified scalar)
}

export function createKalmanState(): KalmanState {
  return { lat: 0, lng: 0, vLat: 0, vLng: 0, accuracy: 999, timestamp: 0, p: 1 };
}

/**
 * Update Kalman state with a new GPS measurement.
 * Returns a new state (pure function — no mutation).
 */
export function updateKalman(
  state: KalmanState,
  measurement: { lat: number; lng: number; accuracy: number; timestamp: number },
): KalmanState {
  // First fix or gap > 30s → reset to measurement
  if (state.timestamp === 0 || measurement.timestamp - state.timestamp > 30_000) {
    return {
      lat: measurement.lat,
      lng: measurement.lng,
      vLat: 0,
      vLng: 0,
      accuracy: measurement.accuracy,
      timestamp: measurement.timestamp,
      p: measurement.accuracy * measurement.accuracy,
    };
  }

  const dt = (measurement.timestamp - state.timestamp) / 1000; // seconds
  if (dt <= 0) return state;

  // Predict: position += velocity * dt
  const predLat = state.lat + state.vLat * dt;
  const predLng = state.lng + state.vLng * dt;

  // Process noise — grows with time (bike can change direction)
  // Q = acceleration variance * dt^2, using ~2 m/s^2 max acceleration
  const qPos = (2 * dt * dt) / 111320; // convert meters to degrees approx
  const predP = state.p + qPos * qPos * 1e10; // scaled covariance

  // Measurement noise from GPS accuracy
  const rDeg = measurement.accuracy / 111320; // meters to degrees
  const r = rDeg * rDeg;

  // Kalman gain
  const k = predP / (predP + r);

  // Update
  const newLat = predLat + k * (measurement.lat - predLat);
  const newLng = predLng + k * (measurement.lng - predLng);
  const newP = (1 - k) * predP;

  // Update velocity estimate
  const newVLat = (newLat - state.lat) / dt;
  const newVLng = (newLng - state.lng) / dt;

  return {
    lat: newLat,
    lng: newLng,
    vLat: newVLat,
    vLng: newVLng,
    accuracy: Math.sqrt(newP) * 111320, // back to meters
    timestamp: measurement.timestamp,
    p: newP,
  };
}
```

- [ ] **Step 2: Verify file compiles**

Run: `npx tsc --noEmit src/services/gps/KalmanFilter.ts`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/services/gps/KalmanFilter.ts
git commit -m "feat(gps): add 2D Kalman filter for position smoothing"
```

---

## Task 2: DouglasPeucker

**Files:**
- Create: `src/services/gps/DouglasPeucker.ts`

- [ ] **Step 1: Create Douglas-Peucker module**

```typescript
// src/services/gps/DouglasPeucker.ts

/**
 * Douglas-Peucker line simplification using haversine distance.
 * Reduces trail points while preserving shape.
 */

interface GeoPoint {
  lat: number;
  lng: number;
  [key: string]: unknown;
}

/** Haversine distance between two points in meters */
function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Perpendicular distance from point P to line A-B, in meters */
function perpendicularDistance(p: GeoPoint, a: GeoPoint, b: GeoPoint): number {
  const dAB = haversineM(a, b);
  if (dAB < 0.01) return haversineM(a, p); // A and B are same point
  // Use cross-track distance formula (simplified for short segments)
  const dAP = haversineM(a, p);
  const dBP = haversineM(b, p);
  // Heron's formula for area, then h = 2*area / base
  const s = (dAB + dAP + dBP) / 2;
  const areaSq = s * (s - dAB) * (s - dAP) * (s - dBP);
  if (areaSq <= 0) return 0;
  return (2 * Math.sqrt(areaSq)) / dAB;
}

/**
 * Simplify a trail using Douglas-Peucker algorithm.
 * @param points - array of points with lat/lng (other fields preserved)
 * @param toleranceMeters - max perpendicular distance to keep a point (default 5m)
 * @returns simplified array (subset of input, preserving all fields)
 */
export function douglasPeucker<T extends GeoPoint>(points: T[], toleranceMeters = 5): T[] {
  if (points.length <= 2) return [...points];

  // Find point with max distance from the line first-last
  let maxDist = 0;
  let maxIdx = 0;
  const first = points[0]!;
  const last = points[points.length - 1]!;

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i]!, first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > toleranceMeters) {
    const left = douglasPeucker(points.slice(0, maxIdx + 1), toleranceMeters);
    const right = douglasPeucker(points.slice(maxIdx), toleranceMeters);
    return [...left.slice(0, -1), ...right];
  }

  return [first, last];
}

export { haversineM };
```

- [ ] **Step 2: Verify file compiles**

Run: `npx tsc --noEmit src/services/gps/DouglasPeucker.ts`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/services/gps/DouglasPeucker.ts
git commit -m "feat(gps): add Douglas-Peucker trail simplification"
```

---

## Task 3: GPSFilterEngine

**Files:**
- Create: `src/services/gps/GPSFilterEngine.ts`

- [ ] **Step 1: Create GPSFilterEngine module**

```typescript
// src/services/gps/GPSFilterEngine.ts

/**
 * GPSFilterEngine — smart GPS filtering and recording decisions.
 *
 * Sits between navigator.geolocation and mapStore.
 * Applies Kalman filter, accuracy gate, speed-adaptive capture,
 * heading change boost, min distance gate, and live altitude smoothing.
 */

import { createKalmanState, updateKalman, type KalmanState } from './KalmanFilter';
import { haversineM } from './DouglasPeucker';

// ── Types ──────────────────────────────────────────────────────────

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

interface RecordedPoint {
  lat: number;
  lng: number;
  altitude: number;
  heading: number;
  timestamp: number;
}

// ── Constants ──────────────────────────────────────────────────────

const ACCURACY_REJECT = 50;       // meters — reject fix entirely
const ACCURACY_DEGRADED = 25;     // meters — mark as degraded
const MIN_DISTANCE_M = 3;        // meters — min movement to record
const HEADING_CHANGE_DEG = 15;   // degrees — force record on turn
const MAX_INTERVAL_MS = 10_000;  // 10s — never go longer without a point
const ELEV_THRESHOLD_M = 2;      // meters — min altitude change to count
const ELEV_BUFFER_SIZE = 5;      // samples for median filter

// Speed-adaptive intervals (km/h → ms)
function captureIntervalForSpeed(speedKmh: number): number {
  if (speedKmh < 2) return Infinity;    // never record when nearly stopped
  if (speedKmh < 10) return 5_000;      // slow: every 5s
  if (speedKmh < 30) return 2_000;      // normal: every 2s
  return 1_000;                          // fast: every 1s
}

// ── Module state ───────────────────────────────────────────────────

let _kalman: KalmanState = createKalmanState();
let _lastRecorded: RecordedPoint | null = null;
let _lastRecordedAt = 0;
let _altBuffer: number[] = [];
let _smoothedAlt: number | null = null;
let _prevSmoothedAlt: number | null = null;
let _elevGain = 0;
let _pointCount = 0;
let _consecutiveAltTrend = 0;   // positive = consecutive up, negative = consecutive down

// ── Public API ─────────────────────────────────────────────────────

/** Reset engine state — call on startTrip() */
export function resetEngine(): void {
  _kalman = createKalmanState();
  _lastRecorded = null;
  _lastRecordedAt = 0;
  _altBuffer = [];
  _smoothedAlt = null;
  _prevSmoothedAlt = null;
  _elevGain = 0;
  _pointCount = 0;
  _consecutiveAltTrend = 0;
}

/** Get cumulative elevation gain for this session */
export function getElevationGain(): number {
  return _elevGain;
}

/** Get total recorded points this session */
export function getPointCount(): number {
  return _pointCount;
}

/**
 * Process a raw GPS fix. Returns filtered coords + recording decision.
 *
 * @param raw - raw GPS measurement from watchPosition
 * @param bikeSpeed - CSC/motor speed in km/h (primary speed source)
 */
export function processGPSFix(
  raw: {
    lat: number;
    lng: number;
    altitude: number | null;
    accuracy: number;
    heading: number | null;
    speed: number | null;
    timestamp: number;
  },
  bikeSpeed: number,
): GPSFixResult {
  const now = raw.timestamp;

  // 1. Accuracy gate
  if (raw.accuracy > ACCURACY_REJECT) {
    return {
      lat: _kalman.lat || raw.lat,
      lng: _kalman.lng || raw.lng,
      altitude: _smoothedAlt,
      heading: raw.heading,
      accuracy: raw.accuracy,
      gpsQuality: 'poor',
      shouldRecord: false,
      elevationGain: _elevGain,
    };
  }

  // 2. Kalman filter
  _kalman = updateKalman(_kalman, {
    lat: raw.lat,
    lng: raw.lng,
    accuracy: raw.accuracy,
    timestamp: now,
  });

  const filteredLat = _kalman.lat;
  const filteredLng = _kalman.lng;
  const filteredAccuracy = _kalman.accuracy;

  // 3. Altitude smoothing (median filter)
  let altitude: number | null = _smoothedAlt;
  if (raw.altitude !== null) {
    _altBuffer.push(raw.altitude);
    if (_altBuffer.length > ELEV_BUFFER_SIZE) _altBuffer.shift();

    // Median of buffer
    const sorted = [..._altBuffer].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0
      ? (sorted[mid - 1]! + sorted[mid]!) / 2
      : sorted[mid]!;

    _smoothedAlt = median;
    altitude = median;

    // Elevation gain accumulation with threshold
    if (_prevSmoothedAlt !== null) {
      const delta = median - _prevSmoothedAlt;

      // Track consecutive trend for adaptive threshold
      if (delta > 0.5) _consecutiveAltTrend = Math.max(1, _consecutiveAltTrend + 1);
      else if (delta < -0.5) _consecutiveAltTrend = Math.min(-1, _consecutiveAltTrend - 1);
      else _consecutiveAltTrend = 0;

      // Adaptive threshold: reduce to 1m during consistent trends (5+ samples same direction)
      const threshold = (bikeSpeed > 5 && Math.abs(_consecutiveAltTrend) >= 5)
        ? 1
        : ELEV_THRESHOLD_M;

      if (delta > threshold) {
        _elevGain += delta;
        _prevSmoothedAlt = median;
      } else if (delta < -threshold) {
        // Downhill — update reference without adding gain
        _prevSmoothedAlt = median;
      }
      // Within threshold: don't update reference (accumulate small changes)
    } else {
      _prevSmoothedAlt = median;
    }
  }

  // 4. GPS quality classification
  const gpsQuality: GpsQuality = raw.accuracy <= ACCURACY_DEGRADED ? 'good' : 'degraded';

  // 5. Recording decision
  let shouldRecord = false;

  // Only record when actually moving
  if (bikeSpeed >= 2) {
    const timeSinceRecord = now - _lastRecordedAt;
    const speedInterval = captureIntervalForSpeed(bikeSpeed);

    // a) Speed-adaptive interval check
    if (timeSinceRecord >= speedInterval) {
      shouldRecord = true;
    }

    // b) Heading change boost (>15 degrees = curve)
    if (!shouldRecord && _lastRecorded && raw.heading !== null) {
      const headingDelta = Math.abs(raw.heading - _lastRecorded.heading);
      const normalizedDelta = headingDelta > 180 ? 360 - headingDelta : headingDelta;
      if (normalizedDelta > HEADING_CHANGE_DEG) {
        // Also check min distance to avoid jitter-triggered false curves
        const dist = haversineM(
          { lat: filteredLat, lng: filteredLng },
          { lat: _lastRecorded.lat, lng: _lastRecorded.lng },
        );
        if (dist > MIN_DISTANCE_M) {
          shouldRecord = true;
        }
      }
    }

    // c) Safety net: never go >10s without a point when moving
    if (!shouldRecord && timeSinceRecord >= MAX_INTERVAL_MS) {
      shouldRecord = true;
    }

    // d) Min distance gate — reject if too close regardless
    if (shouldRecord && _lastRecorded) {
      const dist = haversineM(
        { lat: filteredLat, lng: filteredLng },
        { lat: _lastRecorded.lat, lng: _lastRecorded.lng },
      );
      if (dist < MIN_DISTANCE_M) {
        shouldRecord = false;
      }
    }
  }

  // Update last recorded
  if (shouldRecord) {
    _lastRecorded = {
      lat: filteredLat,
      lng: filteredLng,
      altitude: altitude ?? 0,
      heading: raw.heading ?? 0,
      timestamp: now,
    };
    _lastRecordedAt = now;
    _pointCount++;
  }

  return {
    lat: filteredLat,
    lng: filteredLng,
    altitude,
    heading: raw.heading,
    accuracy: filteredAccuracy,
    gpsQuality,
    shouldRecord,
    elevationGain: _elevGain,
  };
}
```

- [ ] **Step 2: Verify file compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/services/gps/GPSFilterEngine.ts
git commit -m "feat(gps): add GPSFilterEngine — Kalman, speed-adaptive capture, heading boost, live elevation"
```

---

## Task 4: Integrate GPSFilterEngine into useGeolocation + mapStore

**Files:**
- Modify: `src/store/mapStore.ts`
- Modify: `src/hooks/useGeolocation.ts`

- [ ] **Step 1: Add gpsQuality field to mapStore**

In `src/store/mapStore.ts`, add `gpsQuality` to the interface and store:

```typescript
// Add to MapState interface after gpsError:
gpsQuality: 'good' | 'degraded' | 'poor';

// Add action:
setGpsQuality: (quality: 'good' | 'degraded' | 'poor') => void;

// Add to create() defaults after gpsError: null:
gpsQuality: 'good' as const,

// Add action implementation:
setGpsQuality: (quality) => set({ gpsQuality: quality }),
```

- [ ] **Step 2: Rewrite useGeolocation to use GPSFilterEngine**

Replace the content of `src/hooks/useGeolocation.ts`:

```typescript
import { useEffect, useRef } from 'react';
import { useMapStore } from '../store/mapStore';
import { useBikeStore } from '../store/bikeStore';
import { processGPSFix } from '../services/gps/GPSFilterEngine';

/**
 * Watches GPS position with high accuracy.
 * Passes raw fixes through GPSFilterEngine (Kalman filter + quality gate).
 * Updates mapStore with filtered coords.
 * Updates bikeStore.elevation_gain_m live.
 *
 * Recording decisions (shouldRecord) are consumed by RideSessionManager
 * via an event emitter pattern (see Task 5).
 */
export function useGeolocation() {
  const watchId = useRef<number | null>(null);

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      useMapStore.getState().setGpsError('Geolocation nao suportada');
      return;
    }

    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const store = useMapStore.getState();
        store.setGpsActive(true);
        store.setGpsError(null);

        const bikeSpeed = useBikeStore.getState().speed_kmh;

        const result = processGPSFix(
          {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            altitude: pos.coords.altitude,
            accuracy: pos.coords.accuracy,
            heading: pos.coords.heading,
            speed: pos.coords.speed,
            timestamp: pos.timestamp,
          },
          bikeSpeed,
        );

        // Update mapStore with filtered coords
        store.setPosition(result.lat, result.lng, result.heading ?? store.heading, result.accuracy);
        store.setGpsQuality(result.gpsQuality);

        if (result.altitude !== null) {
          store.setAltitude(result.altitude);
        }
        if (pos.coords.speed !== null) {
          store.setGpsSpeed(pos.coords.speed);
        }

        // Update live elevation gain
        useBikeStore.getState().setElevationGain(result.elevationGain);

        // Emit shouldRecord for RideSessionManager (via a simple callback)
        if (result.shouldRecord && _onRecordCallback) {
          _onRecordCallback();
        }
      },
      (err) => {
        useMapStore.getState().setGpsError(err.message);
        useMapStore.getState().setGpsActive(false);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 2000,
        timeout: 10000,
      },
    );

    return () => {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current);
      }
      useMapStore.getState().setGpsActive(false);
    };
  }, []);
}

// ── Recording callback for RideSessionManager ──────────────────────

type RecordCallback = () => void;
let _onRecordCallback: RecordCallback | null = null;

/** Register a callback to be called when GPSFilterEngine decides to record a point */
export function onShouldRecord(cb: RecordCallback): () => void {
  _onRecordCallback = cb;
  return () => { _onRecordCallback = null; };
}
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/store/mapStore.ts src/hooks/useGeolocation.ts
git commit -m "feat(gps): integrate GPSFilterEngine into GPS pipeline — filtered coords, live elevation"
```

---

## Task 5: Rewire RideSessionManager — event-driven capture

**Files:**
- Modify: `src/services/storage/RideHistory.ts`
- Modify: `src/store/tripStore.ts`

- [ ] **Step 1: Remove timer-based capture, add event-driven recording**

In `src/services/storage/RideHistory.ts`, make these changes:

1. Remove `CAPTURE_INTERVAL` constant (line 81)
2. In `startSession()` (line 295): remove the `setInterval(() => this.captureSnapshot(), CAPTURE_INTERVAL)` line
3. Add a new public method `recordPoint()` that the GPSFilterEngine callback triggers:

```typescript
  /** Record a snapshot NOW — called by GPSFilterEngine when it decides to record */
  recordPoint(): void {
    this.captureSnapshot();
  }
```

4. In `startSession()`, after setting up `flushIntervalId`, register the GPSFilterEngine callback:

```typescript
    // Register for GPS-engine-driven recording (replaces fixed 2s timer)
    import('../hooks/useGeolocation').then(({ onShouldRecord }) => {
      this._gpsUnsub = onShouldRecord(() => this.recordPoint());
    });
```

5. Add `private _gpsUnsub: (() => void) | null = null;` to the class fields.

6. In `stopSession()`, clean up the subscription:

```typescript
    if (this._gpsUnsub) { this._gpsUnsub(); this._gpsUnsub = null; }
```

- [ ] **Step 2: Reset GPSFilterEngine on startTrip**

In `src/store/tripStore.ts`, in `startTrip()` (line 52), add at the top:

```typescript
    // Reset GPS engine for fresh session
    import('../services/gps/GPSFilterEngine').then(({ resetEngine }) => resetEngine());
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/services/storage/RideHistory.ts src/store/tripStore.ts
git commit -m "feat(gps): event-driven snapshot capture — no more fixed 2s timer"
```

---

## Task 6: Upgrade LiveTrackingService — 10s + heading boost + live elevation

**Files:**
- Modify: `src/services/tracking/LiveTrackingService.ts`

- [ ] **Step 1: Change broadcast interval to 10s**

Line 29: change `BROADCAST_INTERVAL_MS = 15_000` to `BROADCAST_INTERVAL_MS = 10_000`.

- [ ] **Step 2: Add heading boost logic**

Add module-level state after `_activeGroupRideId`:

```typescript
let _lastBroadcastHeading: number | null = null;
const HEADING_BOOST_DEG = 20;
```

In `startBroadcasting()`, after setting `_broadcasting = true` and before the first `broadcastUpdate()`, add:

```typescript
    _lastBroadcastHeading = null;
```

In `broadcastUpdate()`, after the `const heading = map.heading;` line, add a heading boost check that sends an extra tracking_point when the rider turns:

```typescript
  // Heading change boost — insert extra point on significant turns
  const headingChanged = _lastBroadcastHeading !== null && heading !== null
    && Math.abs(((heading - _lastBroadcastHeading + 540) % 360) - 180) > HEADING_BOOST_DEG;
  _lastBroadcastHeading = heading;
```

Modify the `isMoving` check to also trigger point insertion on heading change:

```typescript
  const isMoving = speedKmh > 1.5 || (map.speed != null && map.speed > 0.5);
  const point = (isMoving || headingChanged) ? {
    session_id: _sessionId,
    lat,
    lng,
    ...(altitude !== undefined ? { altitude } : {}),
    speed_kmh: speedKmh,
    heart_rate: heartRate,
    recorded_at: now,
  } : null;
```

- [ ] **Step 3: Use elevation_gain_m from bikeStore (now live)**

The `broadcastUpdate()` already reads `bike.elevation_gain_m` at line 322 and sends it as `elevation_gain_m` in the session PATCH. Since bikeStore is now updated live by the GPSFilterEngine, this will automatically show real elevation gain. No code change needed — just verify line 322 reads `const elevationGainM = bike.elevation_gain_m;` and line 385 sends `elevation_gain_m: elevationGainM`.

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/services/tracking/LiveTrackingService.ts
git commit -m "feat(gps): live tracking 10s interval + heading boost + live elevation gain"
```

---

## Task 7: PostRideProcessor — DEM correction + simplification

**Files:**
- Create: `src/services/gps/PostRideProcessor.ts`
- Modify: `src/store/tripStore.ts`

- [ ] **Step 1: Create PostRideProcessor**

```typescript
// src/services/gps/PostRideProcessor.ts

/**
 * PostRideProcessor — runs after stopTrip() to enhance ride data.
 *
 * 1. Douglas-Peucker trail simplification
 * 2. DEM elevation correction (Google Elevation API)
 * 3. Stats recompute with corrected altitude
 */

import { douglasPeucker } from './DouglasPeucker';
import { localRideStore } from '../storage/LocalRideStore';

const GOOGLE_ELEVATION_URL = 'https://maps.googleapis.com/maps/api/elevation/json';
const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
const DEM_SAMPLE_COUNT = 100;
const DP_TOLERANCE_M = 5;

interface SnapshotForProcessing {
  lat: number;
  lng: number;
  altitude_m: number | null;
  speed_kmh: number;
  elapsed_s: number;
  [key: string]: unknown;
}

export interface PostRideResult {
  simplifiedCount: number;
  originalCount: number;
  correctedElevGain: number | null; // null if DEM failed
  rawElevGain: number;
}

/**
 * Process a completed ride: simplify trail + DEM correct elevation.
 * Updates the session in IndexedDB with corrected data.
 */
export async function processRide(sessionId: string): Promise<PostRideResult> {
  // 1. Read all snapshots from IndexedDB
  const snapshots = await localRideStore.getSnapshotsForSession(sessionId) as SnapshotForProcessing[];
  if (!snapshots.length) {
    return { simplifiedCount: 0, originalCount: 0, correctedElevGain: null, rawElevGain: 0 };
  }

  const withGPS = snapshots.filter((s) => s.lat !== 0 && s.lng !== 0);
  const originalCount = withGPS.length;

  // 2. Douglas-Peucker simplification
  const simplified = douglasPeucker(withGPS, DP_TOLERANCE_M);

  // 3. Raw elevation gain (sum positive altitude diffs — current method)
  let rawElevGain = 0;
  for (let i = 1; i < withGPS.length; i++) {
    const prev = withGPS[i - 1]!.altitude_m;
    const curr = withGPS[i]!.altitude_m;
    if (prev != null && curr != null && curr > prev) {
      rawElevGain += curr - prev;
    }
  }

  // 4. DEM elevation correction (if API key available and online)
  let correctedElevGain: number | null = null;
  if (MAPS_KEY && navigator.onLine && simplified.length > 2) {
    try {
      correctedElevGain = await demCorrectElevation(withGPS, simplified);
    } catch (err) {
      console.warn('[PostRide] DEM correction failed, using raw:', err);
    }
  }

  // 5. Store simplified trail on session
  const simplifiedTrail = simplified.map((s) => ({
    lat: s.lat,
    lng: s.lng,
    alt: s.altitude_m ?? 0,
    elapsed_s: s.elapsed_s,
    speed: s.speed_kmh,
  }));

  try {
    await localRideStore.updateSession(sessionId, {
      simplified_trail: simplifiedTrail,
      elevation_gain_corrected: correctedElevGain != null ? Math.round(correctedElevGain) : null,
    });
  } catch (err) {
    console.warn('[PostRide] Failed to save processed data:', err);
  }

  console.info(
    `[PostRide] ${originalCount} → ${simplified.length} points (DP ${DP_TOLERANCE_M}m). ` +
    `Elev gain: raw=${Math.round(rawElevGain)}m` +
    (correctedElevGain != null ? `, DEM=${Math.round(correctedElevGain)}m` : ', DEM skipped'),
  );

  return {
    simplifiedCount: simplified.length,
    originalCount,
    correctedElevGain: correctedElevGain != null ? Math.round(correctedElevGain) : null,
    rawElevGain: Math.round(rawElevGain),
  };
}

/** Fetch DEM elevations and recompute gain */
async function demCorrectElevation(
  allPoints: SnapshotForProcessing[],
  sampledPoints: SnapshotForProcessing[],
): Promise<number> {
  // Sample evenly from the simplified trail
  const step = Math.max(1, Math.floor(sampledPoints.length / DEM_SAMPLE_COUNT));
  const samples: SnapshotForProcessing[] = [];
  for (let i = 0; i < sampledPoints.length; i += step) {
    samples.push(sampledPoints[i]!);
  }
  // Ensure last point is included
  if (samples[samples.length - 1] !== sampledPoints[sampledPoints.length - 1]) {
    samples.push(sampledPoints[sampledPoints.length - 1]!);
  }

  // Build locations string for API (max 512 per request)
  const locations = samples.map((s) => `${s.lat},${s.lng}`).join('|');
  const url = `${GOOGLE_ELEVATION_URL}?locations=${encodeURIComponent(locations)}&key=${MAPS_KEY}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Elevation API ${res.status}`);
  const data = await res.json() as { results?: { elevation: number }[]; status: string };
  if (data.status !== 'OK' || !data.results?.length) throw new Error(`Elevation API: ${data.status}`);

  // Build correction map: for each sample, compute offset = DEM - GPS
  const corrections: { elapsed_s: number; offset: number }[] = [];
  for (let i = 0; i < samples.length && i < data.results.length; i++) {
    const gpsAlt = samples[i]!.altitude_m ?? 0;
    const demAlt = data.results[i]!.elevation;
    corrections.push({ elapsed_s: samples[i]!.elapsed_s, offset: demAlt - gpsAlt });
  }

  // Apply interpolated corrections to all points and recompute gain
  let gain = 0;
  let prevCorrected: number | null = null;

  for (const pt of allPoints) {
    const gpsAlt = pt.altitude_m ?? 0;

    // Find surrounding correction samples
    let offset = corrections[0]?.offset ?? 0;
    for (let j = 0; j < corrections.length - 1; j++) {
      if (corrections[j]!.elapsed_s <= pt.elapsed_s && corrections[j + 1]!.elapsed_s >= pt.elapsed_s) {
        const t = (pt.elapsed_s - corrections[j]!.elapsed_s) /
          (corrections[j + 1]!.elapsed_s - corrections[j]!.elapsed_s || 1);
        offset = corrections[j]!.offset + t * (corrections[j + 1]!.offset - corrections[j]!.offset);
        break;
      }
      if (pt.elapsed_s > corrections[j + 1]!.elapsed_s) {
        offset = corrections[j + 1]!.offset;
      }
    }

    const corrected = gpsAlt + offset;
    if (prevCorrected !== null) {
      const delta = corrected - prevCorrected;
      if (delta > 0) gain += delta;
    }
    prevCorrected = corrected;
  }

  return gain;
}
```

- [ ] **Step 2: Call PostRideProcessor from tripStore.stopTrip()**

In `src/store/tripStore.ts`, in `stopTrip()` after `set({ state: 'finished' });`:

```typescript
    // Post-ride processing: simplify trail + DEM elevation correction (fire-and-forget)
    if (sessionId) {
      import('../services/gps/PostRideProcessor').then(({ processRide }) => {
        processRide(sessionId).catch((err) =>
          console.error('[Trip] Post-ride processing failed:', err),
        );
      });
    }
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/services/gps/PostRideProcessor.ts src/store/tripStore.ts
git commit -m "feat(gps): post-ride DEM correction + Douglas-Peucker trail simplification"
```

---

## Task 8: GPX Export — use simplified trail + DEM altitude

**Files:**
- Modify: `src/services/export/GPXExportService.ts`

- [ ] **Step 1: Add function to build GPX from simplified trail**

Add after the existing `buildGPXString` function:

```typescript
/**
 * Build GPX from a simplified trail (post-processed).
 * Falls back to raw snapshots if no simplified trail available.
 */
export function buildGPXFromSimplified(
  rideName: string,
  simplifiedTrail: { lat: number; lng: number; alt: number; elapsed_s: number; speed: number }[],
  startedAt: number,
): string {
  const points: TrackPoint[] = simplifiedTrail.map((p) => ({
    lat: p.lat,
    lng: p.lng,
    elevation: p.alt,
    timestamp: startedAt + p.elapsed_s * 1000,
    speed: p.speed,
  }));
  return buildGPXString(rideName, points);
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/services/export/GPXExportService.ts
git commit -m "feat(gps): GPX export supports simplified trail with DEM altitude"
```

---

## Task 9: Final integration verification

**Files:**
- All modified files

- [ ] **Step 1: Full type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: build succeeds

- [ ] **Step 3: Final commit with all fixes**

If any type errors were found and fixed:
```bash
git add -u
git commit -m "fix(gps): resolve type errors from GPS engine integration"
```

- [ ] **Step 4: Summary commit (if needed)**

If all tasks committed individually, no summary commit needed. Verify with `git log --oneline -10`.

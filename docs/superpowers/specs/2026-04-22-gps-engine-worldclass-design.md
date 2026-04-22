# GPS Engine World-Class — Design Spec

> **Date:** 2026-04-22
> **Status:** Approved
> **Goal:** Replace the raw GPS recording pipeline with a world-class filtering, recording, and post-processing system that produces clean trails, accurate elevation data, and efficient live tracking — better than Strava.

---

## Problem Statement

The current GPS pipeline records every 2 seconds unconditionally, with no quality filtering. This produces:
- Stationary point clusters at rest stops
- Noisy trails from bad GPS fixes (accuracy > 50m)
- GPS "dance" when stationary (position drift)
- Elevation gain always 0 during live ride (never computed)
- Post-ride elevation gain over-counted by 30-50% (raw GPS altitude noise)
- Bloated GPX exports (3600 raw points per 2-hour ride)
- Angular live tracking trail (15s interval)

## Design Overview

Four new modules form a GPS intelligence layer:

```
GPS Hardware → GPSFilterEngine → mapStore (filtered)
                                    ↓
                    ┌───────────────┼────────────────┐
                    ↓               ↓                ↓
             RideSessionManager  LiveTracking   bikeStore
             (smart capture)     (10s+heading)  (live elev gain)
                    ↓
              PostRideProcessor (on stopTrip)
              ├── Douglas-Peucker simplification
              ├── DEM elevation correction
              └── Stats recompute
```

---

## Module 1: KalmanFilter (`src/services/gps/KalmanFilter.ts`)

Pure function module. No dependencies. No state management.

### Interface

```typescript
interface KalmanState {
  lat: number;
  lng: number;
  vLat: number;        // velocity in lat direction (deg/s)
  vLng: number;        // velocity in lng direction (deg/s)
  accuracy: number;    // current estimated accuracy (meters)
  timestamp: number;   // last update time (ms)
}

function createKalmanState(): KalmanState;
function updateKalman(state: KalmanState, measurement: {
  lat: number;
  lng: number;
  accuracy: number;    // GPS reported accuracy (meters)
  timestamp: number;   // measurement time (ms)
}): KalmanState;
```

### Algorithm

Standard 2D Kalman filter for position + velocity:
- **Process noise** (Q): scales with time delta — longer gaps = more uncertainty
- **Measurement noise** (R): directly from GPS `accuracy` field — high accuracy = low noise = trust measurement more
- **State**: [lat, lng, vLat, vLng] — predicts next position from velocity, corrects with measurement
- When `accuracy > 50m`: increase R dramatically (distrust the measurement)
- When `accuracy < 5m`: near-zero R (trust fully)
- On first fix or after >30s gap: reset state to measurement (no prediction)

### Why not a library

The 2D position Kalman filter is ~60 lines of math. No npm dependency needed. Easier to tune for our specific GPS characteristics (Android Chrome, 1s updates, e-bike speeds).

---

## Module 2: GPSFilterEngine (`src/services/gps/GPSFilterEngine.ts`)

Stateful singleton. The brain of GPS recording decisions.

### State

```typescript
interface GPSEngineState {
  kalman: KalmanState;
  lastRecordedPoint: { lat: number; lng: number; altitude: number; heading: number; timestamp: number } | null;
  lastRecordedAt: number;           // timestamp of last recorded point
  altitudeBuffer: number[];         // rolling window for altitude smoothing (5 samples)
  smoothedAltitude: number | null;  // EMA-smoothed altitude
  cumulativeElevGain: number;       // live elevation gain (2m threshold)
  prevSmoothedAlt: number | null;   // for elevation gain delta
  pointCount: number;               // total points recorded this session
}
```

### Public API

```typescript
// Initialize/reset — called on startTrip()
function resetEngine(): void;

// Process a raw GPS fix — called from useGeolocation on every watchPosition update (~1s)
// Returns: { filtered coords, shouldRecord boolean, gpsQuality }
function processGPSFix(raw: {
  lat: number;
  lng: number;
  altitude: number | null;
  accuracy: number;
  heading: number | null;
  speed: number | null;      // GPS speed m/s (backup)
  timestamp: number;
}, bikeSpeed: number           // CSC/motor speed km/h (primary)
): {
  lat: number;                 // Kalman-filtered
  lng: number;                 // Kalman-filtered
  altitude: number | null;     // EMA-smoothed
  heading: number | null;
  accuracy: number;            // Kalman estimated accuracy
  gpsQuality: 'good' | 'degraded' | 'poor';
  shouldRecord: boolean;       // true = record this as a trail point
  elevationGain: number;       // cumulative gain so far
};

// Get current cumulative elevation gain
function getElevationGain(): number;

// Get total points recorded this session
function getPointCount(): number;
```

### Recording Decision Logic (`shouldRecord`)

The engine decides whether to record each fix as a trail point:

```
1. REJECT if accuracy > 50m (gpsQuality = 'poor')

2. REJECT if distance from lastRecordedPoint < 3m
   (uses haversine — prevents micro-jitter points)

3. Speed-adaptive interval:
   bikeSpeed = 0          → NEVER record (stationary suppression)
   bikeSpeed < 2 km/h     → NEVER record (walking/stopped noise)
   bikeSpeed 2-10 km/h    → record if ≥5s since last point
   bikeSpeed 10-30 km/h   → record if ≥2s since last point
   bikeSpeed > 30 km/h    → record if ≥1s since last point

4. HEADING CHANGE BOOST: override interval if:
   |currentHeading - lastRecordedHeading| > 15°
   AND distance > 3m
   → record immediately (captures curve geometry)

5. FORCE record if ≥10s since last point and moving
   (safety net — never go >10s without a point when riding)
```

### Altitude Processing

```
1. Raw GPS altitude → 5-sample rolling buffer
2. Median filter (reject outliers) → smoothed altitude
3. Delta from previous smoothed altitude:
   if delta > +2m → add to cumulativeElevGain (uphill)
   if delta < -2m → accept (downhill) but don't subtract from gain
   if |delta| ≤ 2m → ignore (noise threshold)
```

The 2m threshold eliminates ~80% of GPS altitude noise (typical ±3-5m per sample) while still catching real elevation changes. At 10 km/h on a 5% grade, real altitude change over 2s = 0.28m, over 5s = 0.69m, over 10s = 1.39m — so the threshold needs the adaptive capture to accumulate enough real change. A 10% grade over 5s at 10 km/h = 1.39m, still under threshold. This means very gradual climbs will be captured with some delay but the total will converge within a few percent.

Refinement: if `bikeSpeed > 5 km/h` AND consecutive altitude readings all trend in the same direction for 5+ samples, reduce threshold to 1m for that segment. This catches gradual climbs better.

---

## Module 3: PostRideProcessor (`src/services/gps/PostRideProcessor.ts`)

Called automatically by `tripStore.stopTrip()` after `RideSessionManager.stopSession()` completes.

### Pipeline

```typescript
async function processRide(sessionId: string): Promise<{
  simplifiedPoints: TrackPoint[];
  correctedElevGain: number;
  correctedClimbs: Climb[];
  stats: RideStats;
}>;
```

#### Step 1: Douglas-Peucker Simplification

Input: all recorded snapshots for the session (from IndexedDB)
Output: simplified trail with ~60-70% fewer points

```
tolerance = 5 meters (preserves curves visible on a map)
```

The algorithm:
- Find the point farthest from the line between first and last
- If distance > tolerance, recursively subdivide
- Points within tolerance are removed
- Always keep first, last, and max-speed points

Result: a 2-hour ride goes from ~1200-1800 smart points down to ~400-600.

Stored as a new field on the session: `simplified_trail` (JSON array).

#### Step 2: DEM Elevation Correction

Sample ~100 evenly-spaced points from the simplified trail.

```typescript
// Google Elevation API — max 512 points per request
const elevations = await fetchElevations(sampledPoints);
```

For each recorded point, interpolate the DEM correction:
```
correction[i] = dem_altitude[nearest_sample] - gps_altitude[nearest_sample]
corrected_altitude[i] = gps_altitude[i] + interpolated_correction
```

Recalculate elevation gain from corrected altitudes (no threshold needed — DEM is accurate to ±1m).

If offline: skip DEM correction, keep the GPSFilterEngine's filtered gain (still much better than raw).

#### Step 3: Stats Recompute

With corrected altitudes:
- `elevation_gain_m` — sum of positive deltas
- `elevation_loss_m` — sum of negative deltas
- `max_altitude_m`, `min_altitude_m`
- Climb detection rerun with clean gradients
- Update session row in IndexedDB + sync to Supabase

---

## Module 4: DouglasPeucker (`src/services/gps/DouglasPeucker.ts`)

Pure function, no dependencies.

```typescript
interface Point {
  lat: number;
  lng: number;
  [key: string]: any;  // preserve all other fields
}

function douglasPeucker(points: Point[], toleranceMeters: number): Point[];
```

Uses perpendicular distance in meters (haversine-based) for the tolerance check.

~40 lines of recursive implementation.

---

## Integration Changes

### `useGeolocation.ts`

```diff
- setPosition(lat, lng, ...)
+ const result = GPSFilterEngine.processGPSFix(raw, bikeStore.speed_kmh);
+ setPosition(result.lat, result.lng, result.altitude, result.heading, result.accuracy);
+ setGpsQuality(result.gpsQuality);
+ if (result.shouldRecord) {
+   RideSessionManager.recordFilteredPoint(result);
+ }
+ bikeStore.setElevationGain(result.elevationGain);
```

### `mapStore.ts`

Add field:
```typescript
gpsQuality: 'good' | 'degraded' | 'poor';  // for UI indicators
```

### `bikeStore.ts`

`setElevationGain()` already exists but is never called. Now called from useGeolocation on every processed fix.

### `RideHistory.ts` (RideSessionManager)

- Remove the `CAPTURE_INTERVAL = 2000` timer
- Replace with `recordFilteredPoint(point)` called by GPSFilterEngine
- The engine decides WHEN to record, not the timer
- `captureSnapshot()` still assembles the full snapshot (BLE data, HR, power, etc.) but is triggered by the engine
- Auto-pause: engine returns `shouldRecord = false` when speed < 2 km/h → no more stationary clusters

### `LiveTrackingService.ts`

- Change `BROADCAST_INTERVAL_MS` from 15000 to 10000
- Use Kalman-filtered coords from mapStore (already updated by engine)
- Use live `elevation_gain_m` from bikeStore (now populated)
- Add heading change boost: on each broadcast, check if heading changed >20° since last broadcast → if so, insert an extra tracking_point immediately
- Use filtered altitude instead of raw

### `tripStore.ts`

```diff
  stopTrip: async () => {
    await rideSessionManager.stopSession();
+   // Post-ride processing: simplify trail + DEM elevation correction
+   if (sessionId) {
+     PostRideProcessor.processRide(sessionId).catch(console.error);
+   }
    set({ state: 'finished' });
  },
+
+ startTrip: () => {
+   GPSFilterEngine.resetEngine();
    ...
  },
```

### `GPXExportService.ts`

- Use `simplified_trail` if available, fallback to raw snapshots
- Use DEM-corrected altitude if available, fallback to filtered
- Result: clean GPX that Strava imports without needing its own correction

### `RideAnalysis.ts`

- Use DEM-corrected altitudes for climb detection
- Use corrected `elevation_gain_m` instead of raw sum

---

## Performance Considerations

| Aspect | Impact |
|---|---|
| Kalman filter per GPS fix | ~0.1ms — trivial |
| Capture decision logic | ~0.05ms — trivial |
| Altitude EMA smoothing | ~0.01ms — trivial |
| Douglas-Peucker on 1800 points | ~5ms — imperceptible |
| Google Elevation API (100 points) | ~200ms network — runs async after ride ends |
| IndexedDB writes | Fewer writes (smart capture) — actually improves |
| Supabase sync | Fewer snapshots to sync — improves |
| Live tracking broadcast | 10s vs 15s = 50% more requests — still only 6/min, negligible |

---

## What This Achieves vs Strava

| Capability | Before | After | Strava |
|---|---|---|---|
| Stationary suppression | No (2s timer) | Yes (speed gate) | Yes |
| Kalman filter | None | 2D position+velocity | Internal (similar) |
| Accuracy rejection | 100m heading only | 50m full rejection | Dynamic |
| Min distance gate | None | 3m | ~3m |
| Adaptive recording | Fixed 2s | 1-5s by speed+heading | ~1s fixed |
| Heading change capture | None | 15° trigger | Internal |
| Live elevation gain | Always 0 | Real-time, 2m threshold | Real-time |
| Post-ride DEM correction | None | Google Elevation API | Yes (internal DEM) |
| Trail simplification | None | Douglas-Peucker 5m | Yes |
| GPX quality | Raw 3600 pts | Clean ~500 pts, DEM altitude | Clean |
| Live tracking interval | 15s | 10s + heading boost | N/A (not live) |

**Result: KROMI will produce cleaner trails than Strava** because we have CSC wheel speed (more accurate than GPS speed for the recording gate) and motor distance (more accurate than GPS distance). Strava relies on GPS-only for both.

---

## Files Summary

### New files (4)
```
src/services/gps/KalmanFilter.ts        ~60 lines
src/services/gps/GPSFilterEngine.ts     ~200 lines
src/services/gps/PostRideProcessor.ts   ~180 lines
src/services/gps/DouglasPeucker.ts      ~45 lines
```

### Modified files (8)
```
src/hooks/useGeolocation.ts
src/store/mapStore.ts
src/store/bikeStore.ts
src/store/tripStore.ts
src/services/storage/RideHistory.ts
src/services/tracking/LiveTrackingService.ts
src/services/export/GPXExportService.ts
src/services/export/RideAnalysis.ts
```

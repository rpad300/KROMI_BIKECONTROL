# Skill 11 -- Ride Data Collection & Adaptive Learning

## Role

You are a ride data and adaptive learning specialist for KROMI BikeControl.
You understand the full pipeline: real-time sensor collection during rides,
IndexedDB persistence, override pattern learning, fatigue modeling, TSS
calculation, and athlete profile management.

## Architecture Overview

```
BLE Sensors (speed, power, HR, cadence, gear)
  |
  v
Zustand Stores (bikeStore, athleteStore, autoAssistStore)
  |
  v
RideDataCollector                    <-- samples every 1s during ride
  |
  v
LocalRideStore (IndexedDB)           <-- persistent ride storage
  |
  v
AdaptiveLearningEngine               <-- learns from override patterns
  |
  v
ProfileSyncService                   <-- syncs to Supabase + Drive
```

## Key Files

```
src/services/learning/
  RideDataCollector.ts               -- real-time sensor sampling
  AdaptiveLearningEngine.ts          -- override learning + preference model
  ProfileSyncService.ts              -- athlete profile sync to backend

src/services/storage/
  RideHistory.ts                     -- IndexedDB CRUD for ride sessions

src/store/
  athleteStore.ts                    -- rider profile, FTP, FCmax, W'
  bikeStore.ts                       -- live sensor data
  autoAssistStore.ts                 -- auto-assist state + overrides

src/types/
  athlete.types.ts                   -- AthleteProfile, TrainingLoad, RideSession
```

## RideDataCollector

Samples all sensor data at 1-second intervals during an active ride.

### Data Points Collected

| Channel      | Source Store    | Unit      | Notes                          |
|--------------|----------------|-----------|--------------------------------|
| speed        | bikeStore      | km/h      | From CSC wheel revolutions     |
| power        | bikeStore      | watts     | From power meter BLE           |
| cadence      | bikeStore      | RPM       | From CSC crank revolutions     |
| heartRate    | bikeStore      | BPM       | From HR monitor BLE            |
| elevation    | mapStore       | meters    | From GPS + elevation API       |
| gradient     | mapStore       | %         | Calculated from elevation      |
| gear         | bikeStore      | index     | From Di2 BLE                   |
| assistMode   | autoAssistStore| enum      | ECO/TRAIL/BOOST/TURBO/KROMI    |
| torque       | bikeStore      | Nm        | From GEV motor telemetry       |
| battery      | bikeStore      | %         | From battery BLE service       |
| latitude     | mapStore       | degrees   | GPS position                   |
| longitude    | mapStore       | degrees   | GPS position                   |
| timestamp    | --             | ms        | Date.now()                     |

### Lifecycle

```typescript
// Start recording when ride begins
RideDataCollector.start(rideId: string);

// Samples automatically every 1s via setInterval
// Each sample is a RideDataPoint appended to the current session

// Pause on app background (visibilitychange)
RideDataCollector.pause();

// Resume when app returns to foreground
RideDataCollector.resume();

// Stop and finalize when ride ends
const session = RideDataCollector.stop();
// -> saves complete session to IndexedDB via LocalRideStore
```

## LocalRideStore (IndexedDB)

Persistent storage for ride sessions. Survives app restarts, offline use,
and browser cache clears (IndexedDB is durable).

### Schema

```typescript
interface RideSession {
  id: string;                    // UUID
  startTime: number;             // epoch ms
  endTime: number | null;        // null if interrupted
  duration: number;              // seconds (active riding)
  distance: number;              // meters
  avgSpeed: number;              // km/h
  maxSpeed: number;              // km/h
  avgPower: number;              // watts
  maxPower: number;              // watts
  avgHR: number;                 // BPM
  maxHR: number;                 // BPM
  avgCadence: number;            // RPM
  totalAscent: number;           // meters
  totalDescent: number;          // meters
  batteryStart: number;          // %
  batteryEnd: number;            // %
  tss: number;                   // Training Stress Score
  intensityFactor: number;       // IF = NP / FTP
  normalizedPower: number;       // NP (30s rolling avg)
  dataPoints: RideDataPoint[];   // full 1s resolution data
  overrides: OverrideEvent[];    // manual assist overrides
  status: 'active' | 'paused' | 'completed' | 'interrupted';
}
```

### Session Persistence (save/resume)

Interrupted rides (app crash, phone call, battery) are recoverable:

1. Every 30s, `RideDataCollector` checkpoints the current session to IndexedDB.
2. On app start, check for sessions with `status: 'active'` or `'paused'`.
3. Offer the rider to resume or discard the interrupted session.
4. Resume restores all accumulated data points and continues sampling.

## AdaptiveLearningEngine

Learns rider preferences from manual override patterns to improve auto-assist.

### Override Learning

When the rider manually changes the assist mode (overriding auto-assist),
the engine records the context:

```typescript
interface OverrideEvent {
  timestamp: number;
  fromMode: AssistMode;          // what auto-assist set
  toMode: AssistMode;            // what rider chose instead
  gradient: number;              // terrain gradient at override
  speed: number;                 // speed at override
  heartRate: number;             // HR at override
  cadence: number;               // cadence at override
  power: number;                 // power at override
  fatigue: number;               // estimated fatigue level (0-1)
  gear: number;                  // gear index at override
  batteryLevel: number;          // battery % at override
}
```

### Preference Model

The engine builds a preference matrix indexed by terrain context:

```
Context = (gradient_bin, speed_bin, fatigue_bin, battery_bin)
Preference = weighted average of rider's chosen modes in that context
```

Gradient bins: flat (-2 to 2%), mild climb (2-6%), steep climb (6-12%),
very steep (>12%), descent (<-2%).

After sufficient data (>20 overrides in a context bin), the learned preference
replaces the default auto-assist algorithm for that context.

### Learning Decay

- Recent overrides weighted more heavily (exponential decay, half-life 10 rides).
- If rider stops overriding in a context, preference slowly reverts to default.
- Complete reset available via Settings > Auto-Assist > "Resetar aprendizagem".

## TSS Calculation

Training Stress Score quantifies ride intensity relative to the rider's FTP.

```
NP = Normalized Power (30-second rolling average of power^4, then 4th root)
IF = Intensity Factor = NP / FTP
TSS = (duration_seconds * NP * IF) / (FTP * 3600) * 100
```

### Implementation Notes

- NP uses a 30-second sliding window over power data points.
- Zero-power samples (coasting) ARE included in NP calculation.
- FTP comes from `athleteStore.profile.ftp` (rider-configured).
- TSS is calculated at ride end and stored in the RideSession.

## Fatigue Model

Tracks acute and chronic training load for recovery and performance.

### Acute Training Load (ATL)

```
ATL_today = ATL_yesterday * exp(-1/7) + TSS_today * (1 - exp(-1/7))
```

7-day exponentially weighted moving average of daily TSS.

### Chronic Training Load (CTL)

```
CTL_today = CTL_yesterday * exp(-1/42) + TSS_today * (1 - exp(-1/42))
```

42-day exponentially weighted moving average of daily TSS.

### Training Stress Balance (TSB)

```
TSB = CTL - ATL
```

- TSB > 0: fresh (recovered, ready for hard effort)
- TSB < 0: fatigued (accumulated stress exceeds fitness)
- TSB < -30: high fatigue risk, auto-assist biases toward lower modes

### W' (W-prime) Depletion

Tracks anaerobic work capacity above FTP:

```
W'_remaining = W'_max - integral(power - FTP) for power > FTP
W'_recovery = W'_depleted * (1 - exp(-t/tau))  // tau from recovery rate
```

- W' comes from `athleteStore.profile.wPrime` (typically 15-25 kJ).
- When W' < 30%, auto-assist may preemptively increase support.

## Athlete Profile

Stored in `athleteStore` (Zustand), synced to Supabase via ProfileSyncService.

```typescript
interface AthleteProfile {
  weight: number;           // kg (used for W/kg calculations)
  height: number;           // cm
  ftp: number;              // Functional Threshold Power (watts)
  fcMax: number;            // max heart rate (observed, NOT 220-age)
  fcRest: number;           // resting heart rate
  wPrime: number;           // W' anaerobic capacity (joules)
  recoveryRate: number;     // W' recovery time constant (seconds)
  vo2max: number;           // estimated VO2max
  trainingHistory: {
    atl: number;            // current acute training load
    ctl: number;            // current chronic training load
    tsb: number;            // current training stress balance
  };
}
```

### FCmax Rule

Heart rate zones are based on OBSERVED FCmax, never theoretical (220-age).
The system tracks the highest HR seen in rides and suggests FCmax updates.

### Profile Sync

ProfileSyncService syncs the athlete profile:
1. Local changes saved to Zustand (immediate).
2. Debounced sync to Supabase (5s delay, via `supaFetch`).
3. On login, remote profile merged with local (remote wins on conflict).

## Integration with Auto-Assist

The learning engine feeds back into auto-assist decisions:

```
autoAssistStore.setLearnedPreference(context, preferredMode)
```

The auto-assist engine checks learned preferences BEFORE applying its
default gradient-based logic. Manual override always takes priority
(60-second pause on override).

## Hard Rules

1. **IndexedDB for ride data** -- never localStorage (size limits).
2. **1-second sampling interval** -- no faster (battery drain), no slower (data loss).
3. **Checkpoint every 30s** -- ride data must survive app crashes.
4. **NP uses 30s window** -- standard cycling power analysis.
5. **FCmax from observation** -- never use 220-age formula.
6. **Override pause = 60s** -- always respect manual override.
7. **Smoothing window = 10s for HR** -- prevents noisy zone changes.
8. **Learning decay half-life = 10 rides** -- prevents stale preferences.
9. **Profile sync via supaFetch** -- never raw fetch to Supabase.
10. **W' recovery uses rider-specific tau** -- not a fixed constant.

## Adding New Sensor Channels

1. Add the channel to `RideDataPoint` type in `athlete.types.ts`.
2. Add sampling in `RideDataCollector.sample()`.
3. Add aggregation in `RideSession` summary fields if needed.
4. Add to override context in `OverrideEvent` if relevant to learning.
5. Update IndexedDB schema version if structure changes.

## Troubleshooting

| Symptom                        | Cause                           | Fix                              |
|--------------------------------|---------------------------------|----------------------------------|
| Ride data lost after crash     | Checkpoint interval too long    | Verify 30s checkpoint timer      |
| NP seems wrong                 | Window size incorrect           | Must be exactly 30 samples       |
| TSS always 0                   | FTP not configured              | Check athleteStore.profile.ftp   |
| Overrides not learning         | < 20 overrides in context bin   | Need more data in that context   |
| Profile not syncing            | supaFetch not used              | Check ProfileSyncService imports |
| HR zones erratic               | Smoothing window too small      | Must be 10s minimum              |

# 05 — Auto-Assist Engine Specialist

## Role

You implement and maintain the auto-assist algorithm that automatically adjusts motor assist mode based on terrain, heart rate, gear, battery, fatigue, rider profile, and manual overrides. You understand the 7-layer intelligence stack and ensure each layer respects the priority chain. You never bypass manual override, never oscillate modes without smoothing, and never interfere with SMART(6) mode (Giant native).

---

## Architecture Overview

```
7-Layer Intelligence Stack (priority order):
  Layer 7: Manual Override     — 60s pause, absolute priority
  Layer 6: Rider Profile       — learned support corrections per context
  Layer 5: Fatigue Model       — W' depletion, HR drift detection
  Layer 4: Battery Optimizer   — progressive constraint factor (0.20-1.0)
  Layer 3: Gear Efficiency     — cadence/torque-based assist adjustment
  Layer 2: Heart Rate Zones    — biometric assist with 15-30s lag compensation
  Layer 1: Elevation Lookahead — pre-emptive mode changes (the foundation)
```

The engine runs on a 1-2 second tick cycle. Each tick evaluates all layers and produces an `AssistDecision`.

---

## Key Files

```
src/services/autoAssist/
  AutoAssistEngine.ts     — Main loop, gradient mapping, smoothing, override
  ElevationPredictor.ts   — 4km lookahead (GPX/Discovery/Hybrid modes)
  BatteryOptimizer.ts     — Wh budget, 6-level constraint, temp correction
  RiderLearning.ts        — CP/W' calibration, override detection, mode feedback

src/store/autoAssistStore.ts  — Zustand store for auto-assist state
src/store/bikeStore.ts        — assist_mode, battery, speed, distance
src/hooks/useAutoAssist.ts    — React hook binding engine to UI
```

---

## Assist Modes

```typescript
enum AssistMode {
  OFF    = 0,
  ECO    = 1,
  TOUR   = 2,   // called TRAIL in some Giant docs
  ACTIVE = 3,
  SPORT  = 4,
  POWER  = 5,   // KROMI-controlled — engine writes motor params
  SMART  = 6,   // Giant native — NEVER interfere
}
```

**Critical rule:** POWER(5) = KROMI controlled. When in POWER mode, KROMI sets support % and torque Nm directly via GEV protocol. SMART(6) = Giant's own algorithm. KROMI must NEVER send commands when mode is SMART.

---

## AutoAssistEngine — Main Loop

The `tick()` method is the core. Called every 1-2 seconds with GPS position, heading, speed, and current mode.

```typescript
// Priority chain inside tick():
// 1. Manual override active? → return 'none' with countdown
// 2. Stopped (< 2 km/h)?    → return 'none'
// 3. Fetch elevation ahead   → getElevationByHeading(lat, lng, heading, 4000m)
// 4. Pre-emptive activation  → detect climb/descent transitions within 150m
// 5. Normal gradient mapping → gradientToMode()
// 6. Smoothing               → require N consecutive same-mode before changing
```

### Gradient-to-Mode Mapping

```typescript
// gradient > 12%  → POWER    (steep climb, maximum assist)
// gradient > 8%   → SPORT    (moderate-steep climb)
// gradient > 5%   → ACTIVE   (moderate climb)
// gradient > 3%   → TOUR     (gentle climb)
// gradient > -4%  → ECO      (flat to gentle descent)
// gradient <= -4% → OFF      (steep descent, no motor needed)
```

### GPS Fallback

When Google Elevation API is unavailable, the engine falls back to GPS altitude from `mapStore`. It maintains a 30-second sliding window of altitude/distance samples to compute local gradient. Requires at least 5m of movement.

### Pre-emptive Activation

The engine detects terrain transitions using a sliding window of 3 elevation points. If a climb is detected within `preempt_distance_m` (default 150m), the mode changes early. Transition types:

- `flat_to_climb` / `descent_to_climb` — increase assist before the climb
- `climb_to_descent` / `climb_to_flat` — reduce assist before flat/descent

---

## ElevationPredictor — Lookahead Controller

Three modes with automatic transition:

```
Mode A (GPX Known):   Pre-calculated from loaded route. Full segment profile.
Mode B (Discovery):   Projects 4km ahead from current position + heading.
Mode C (Hybrid):      GPX loaded but rider deviated >50m for 20s → Discovery.
                      Auto-returns to Mode A when within 30m of route corridor.
```

### Segment Analysis

The lookahead divides the upcoming terrain into 100m segments, classifying each:

```typescript
type SegmentGrade = 'gentle' | 'moderate' | 'demanding' | 'extreme';
// gentle:    |gradient| <= 5%
// moderate:  |gradient| <= 10%
// demanding: |gradient| <= 15%
// extreme:   |gradient| > 15%
```

Each segment includes estimated power, Wh consumption, and time based on PhysicsEngine.

---

## BatteryOptimizer

Computes a constraint factor (0.20-1.0) applied to motor support and torque.

### 6-Level Constraint States

```typescript
// is_emergency (range < 5km)   → constraint = 0.20
// budget_ratio < 0.5           → constraint = 0.40
// budget_ratio < 0.7           → constraint = 0.65
// budget_ratio < 1.0           → constraint = 0.85
// budget_ratio >= 1.0 / no rt  → constraint = 1.00
```

### Temperature Correction

```typescript
// temp < 0C   → capacity × 0.75 (Li-ion cold penalty)
// temp < 10C  → capacity × 0.85
// temp >= 10C → capacity × 1.00
```

### 5-Minute Rolling Consumption

Tracks actual Wh/km over a 5-minute rolling window. Uses `feedConsumption(motor_watts, distance_km)` called every 1s. Falls back to BatteryEstimationService estimates when insufficient data.

---

## RiderLearning

### Override Detection

When the rider manually changes mode (within 15s of an engine command), this is logged as an override event. Context captured: gradient, HR zone, direction (more/less assist), support/torque at override.

After 3 consecutive overrides in the same conditions (gradient + HR zone + direction), the engine permanently adjusts its base parameters.

### Mode Feedback Learning

When rider leaves POWER mode for another mode (ECO/TOUR/ACTIVE/SPORT), the target mode encodes their desired support level. The system:

1. Captures full context snapshot (gradient, HR, speed, gear, W', KROMI output)
2. Calculates correction: `target_support - kromi_support`
3. When rider returns to POWER (after >30s), applies exponential moving average to the context bucket
4. Buckets: gradient (rounded to 2%) x HR zone

```typescript
// Get learned correction for current context
const correction = riderLearning.getSupportCorrection(gradient, hrZone);
// Returns: +25 means KROMI should add 25% to its calculated support
```

### CP/W' Calibration

- **Progressive:** Feed effort segments (>8 min at >80% CP), weighted by recency (30-day half-life) and duration
- **Field test:** 12-min + 3-min all-out efforts → CP = (W12 - W3) / (720 - 180)

---

## Manual Override Rules

```
TRIGGER: Mode changes from Ergo 3 physical button OR app assist button
ACTION:  autoAssistEngine.notifyManualOverride('ergo3' | 'app_button')
EFFECT:  60-second pause timer starts. Mode history cleared.
         Engine returns 'none' with countdown until timer expires.
```

Both sources MUST trigger the override. Missing one means the rider's choice gets overwritten.

---

## Smoothing

The engine maintains a `modeHistory` array (sliding window of `smoothing_window` size, default 3). A mode change only fires when all samples in the window agree on the same target mode. This prevents oscillation at gradient boundaries.

```typescript
// Only change if last 3 calculations all agree
private getStableMode(): AssistMode | null {
  if (this.modeHistory.length < this.config.smoothing_window) return null;
  const window = this.modeHistory.slice(-this.config.smoothing_window);
  const allSame = window.every((m) => m === window[0]);
  return allSame ? window[0]! : null;
}
```

---

## Configuration Defaults

```typescript
const DEFAULT_CONFIG = {
  enabled: false,              // must be explicitly enabled
  lookahead_m: 4000,           // 4km lookahead
  preempt_distance_m: 150,     // pre-activate within 150m of transition
  override_duration_s: 60,     // 60s manual override pause
  smoothing_window: 3,         // 3 samples for stable mode
  climb_threshold_pct: 3,      // gradient >= 3% = climb
  descent_threshold_pct: -4,   // gradient <= -4% = descent
};
```

---

## Checklist for Changes

- [ ] Manual override from BOTH Ergo 3 and app button triggers `notifyManualOverride()`
- [ ] SMART(6) mode is never touched by the engine
- [ ] POWER(5) is the only mode where KROMI writes motor params
- [ ] Smoothing window of 3 samples before any mode change
- [ ] Elevation cache 30s, throttle 3s, max 15 points per lookahead
- [ ] GPS fallback uses 30s altitude sliding window
- [ ] Pre-emptive activation only within `preempt_distance_m` (150m)
- [ ] Battery constraint factor applied to support and torque
- [ ] Override detection only within 15s of last engine command
- [ ] Mode feedback learning requires >30s in non-POWER mode
- [ ] CP calibration requires >8 min at >80% current CP estimate
- [ ] Temperature correction applied to battery capacity
- [ ] Gradient mapping thresholds: 12/8/5/3/-4

---

## Anti-Patterns

```
NEVER: Change mode without smoothing (causes oscillation on boundary gradients)
NEVER: Ignore manual override (rider safety/preference is absolute)
NEVER: Send motor commands in SMART(6) mode (Giant native algorithm)
NEVER: Use raw GPS altitude without sliding window (too noisy)
NEVER: Skip battery constraint factor (can strand rider)
NEVER: Use theoretical HR max (220-age) — always observed FCmax
NEVER: Override without logging context (breaks learning system)
```

# 07 — Heart Rate & Biometrics Engineer

## Role

You implement and maintain the heart rate monitoring, zone calculation, biometric assist integration, fatigue detection, and physiological modeling systems. You understand the interplay between HR lag (15-30s), elevation lookahead (anticipative), and motor assist. You use observed FCmax (NOT theoretical 220-age), apply 10s smoothing windows, and integrate W' depletion models for intelligent fatigue management.

---

## Architecture Overview

```
BLE HRM (0x180D)
    |
    v
  parseHeartRate(DataView)    → raw BPM
    |
    v
  HRZoneEngine.addReading()  → 10s smoothed HR
    |                            |
    v                            v
  getCurrentZone()           getTrend()
    |                            |
    v                            v
  BiometricAssistEngine.tick()
    |
    v
  Combine: terrain decision + HR zone + HR trend
    |
    v
  Final assist mode + reason
    |
    v
  TorqueEngine (hrZone, hrTrend inputs)
```

---

## Key Files

```
src/services/heartRate/
  HRZoneEngine.ts           — Zone calculation, smoothing, trend detection
  BiometricAssistEngine.ts  — Combines HR + elevation for assist decisions

src/store/athleteStore.ts   — Rider physiology (weight, height, FCmax, FTP, W')
src/store/bikeStore.ts      — hr_bpm, hr_zone (from BLE notifications)
src/services/bluetooth/
  BLEBridge.ts              — HR characteristic subscription
```

---

## BLE Heart Rate Service

Standard Bluetooth HRM service (0x180D), compatible with any Polar/Garmin/Wahoo strap or watch.

### Parsing

```typescript
export function parseHeartRate(data: DataView): number {
  const flags = data.getUint8(0);
  const isUint16 = (flags & 0x01) !== 0;
  return isUint16 ? data.getUint16(1, true) : data.getUint8(1);
}
```

Flags byte bit 0: `0` = uint8 BPM (offset 1), `1` = uint16 BPM (offset 1-2, little-endian). Most chest straps use uint8. Some optical sensors use uint16.

---

## HRZoneEngine

### Construction

```typescript
const hrEngine = new HRZoneEngine(hrMax, targetZone);
// hrMax: observed maximum HR (NOT 220-age)
// targetZone: rider's preferred training zone (default 3 = Aerobic)
```

**Critical:** Always use observed FCmax from the athlete profile, never the theoretical formula. For the current rider (rdias300@gmail.com): this is stored in `athleteStore.hr_max`.

### HR Zones

```typescript
const HR_ZONES: HRZone[] = [
  { zone: 1, name: 'Recuperacao', min_pct: 0,  max_pct: 60,  motor_multiplier: 0.2 },
  { zone: 2, name: 'Base',       min_pct: 60, max_pct: 70,  motor_multiplier: 0.4 },
  { zone: 3, name: 'Aerobico',   min_pct: 70, max_pct: 80,  motor_multiplier: 0.7 },
  { zone: 4, name: 'Limiar',     min_pct: 80, max_pct: 90,  motor_multiplier: 1.0 },
  { zone: 5, name: 'Maximo',     min_pct: 90, max_pct: 100, motor_multiplier: 1.2 },
];
```

Zone boundaries are percentages of observed FCmax. `motor_multiplier` indicates how much motor support should scale relative to the base calculation.

### 10-Second Smoothing Window

All HR readings are smoothed over a 10-second window to filter out noise, dropped readings, and momentary spikes:

```typescript
getSmoothedHR(): number {
  const now = Date.now();
  const recent = this.history.filter((r) => now - r.timestamp < 10_000);
  if (recent.length === 0) return 0;
  return Math.round(recent.reduce((sum, r) => sum + r.value, 0) / recent.length);
}
```

The raw history buffer keeps 30 seconds of data for trend analysis.

### Trend Detection

```typescript
getTrend(): 'rising' | 'falling' | 'stable' {
  // Uses last 4 readings
  // diff > 5 bpm  → 'rising'
  // diff < -5 bpm → 'falling'
  // otherwise     → 'stable'
}
```

### HR Reserve

```typescript
getHRReserve(): number {
  // BPM remaining until target zone ceiling
  // Positive = below target zone max (safe)
  // Negative = above target zone max (overexerting)
}
```

---

## BiometricAssistEngine

Combines HR zones with terrain lookahead to produce the final assist decision. HR has a 15-30 second physiological lag — the elevation lookahead compensates by being anticipative.

### Decision Priority

```typescript
// 1. No HR data → terrain-only decision (append "sem FC" to reason)
// 2. HR zone 5  → POWER immediately (max effort, needs max assist)
// 3. HR zone 4 + rising → anticipate, jump to at least SPORT
// 4. HR zone 1-2 + no pre-emptive terrain → reduce mode (save battery)
// 5. HR zone 3 (target) + pre-emptive terrain → follow terrain
// 6. HR zone 3 (target) + stable terrain → maintain current mode
// 7. Default → follow terrain decision
```

### Key Logic

```typescript
// Zone 5: Override everything — rider is at maximum effort
if (hrZone.zone === 5) {
  return { mode: AssistMode.POWER, reason: `FC zona 5 (${hr}bpm)` };
}

// Zone 4 + rising: Anticipate zone 5, don't wait
if (hrZone.zone === 4 && hrTrend === 'rising') {
  const targetMode = Math.max(terrainMode, AssistMode.SPORT);
  return { mode: targetMode, reason: `FC zona 4 subindo (${hr}bpm)` };
}

// Zone 1-2 + no terrain urgency: Save battery
if (hrZone.zone <= 2 && !terrainDecision.is_preemptive) {
  return { mode: reduceMode(currentMode), reason: `FC zona ${hrZone.zone} — poupar bateria` };
}
```

---

## Fatigue Detection

### HR Drift (Cardiac Decoupling)

HR drift is when heart rate rises over time despite constant power output. This indicates cardiovascular fatigue.

```
EF (Efficiency Factor) = Power / HR
EF baseline established in first 30 minutes of ride.
If EF drops > 5% from baseline → early fatigue signal
If EF drops > 10% → significant fatigue → increase motor support
```

Integration: The `RiderLearning` engine tracks EF baselines per effort category and detects drift.

### W' (W-Prime) Depletion Model

W' represents the finite anaerobic work capacity above Critical Power (CP). It depletes during high-intensity efforts and recovers at sub-CP intensities.

```typescript
// Depletion (when power > CP):
W'_balance -= (power - CP) * dt

// Recovery (when power < CP):
W'_balance += (W'_max - W'_balance) * (1 - e^(-dt/tau)) * (CP - power)

// tau = recovery time constant (default 400s for recreational riders)
```

When W' balance drops below 30%: reduce motor aggressiveness (fatigue warning).
When W' balance drops below 10%: emergency mode, maximize motor support.

### TSS (Training Stress Score)

```typescript
TSS = (duration_s * NP * IF) / (FTP * 3600) * 100
// NP = Normalized Power (30s rolling average, 4th power)
// IF = Intensity Factor = NP / FTP
// FTP = Functional Threshold Power (~ CP for practical purposes)
```

TSS informs the global multiplier in TorqueEngine:
- TSS < 100: normal ride, multiplier 1.0
- TSS 100-200: moderate fatigue, multiplier 0.9
- TSS > 200: high fatigue, multiplier 0.8

---

## Athlete Profile Integration

```typescript
// athleteStore holds:
interface AthleteProfile {
  weight_kg: number;       // 135 (current rider)
  height_cm: number;       // 192
  hr_max: number;          // observed maximum HR
  hr_rest: number;         // resting HR
  ftp_watts: number;       // functional threshold power
  cp_watts: number;        // critical power (from field test or learning)
  w_prime_joules: number;  // anaerobic capacity
  vo2max_ml: number;       // estimated VO2max
}
```

**Critical:** The current rider weighs 135kg and is 192cm. This significantly impacts power-to-weight calculations. The motor compensation must account for the high total system weight (rider + bike ~160kg).

---

## Battery Efficiency by HR Zone

Track how much motor energy (Wh) is consumed per HR zone to optimize battery usage:

```
Zone 1-2: Motor should be minimal → < 5 Wh/km target
Zone 3:   Motor moderate → 8-12 Wh/km target
Zone 4:   Motor active → 12-18 Wh/km target
Zone 5:   Motor maximum → 18-25 Wh/km (accept high consumption)
```

The BatteryOptimizer uses these targets to constrain motor output based on remaining capacity.

---

## Checklist for Changes

- [ ] HR smoothing uses 10-second window (NOT raw readings)
- [ ] Zone boundaries use observed FCmax (NEVER 220-age formula)
- [ ] BiometricAssist returns terrain-only decision when HR = 0
- [ ] Zone 5 always returns POWER mode regardless of terrain
- [ ] Zone 4 + rising trend anticipates by jumping to at least SPORT
- [ ] Zone 1-2 reduces mode ONLY when no pre-emptive terrain event
- [ ] W' recovery uses tau = 400s default (recreational rider)
- [ ] EF drift detection requires >30 min baseline establishment
- [ ] TSS calculated with 30s rolling normalized power
- [ ] Trend detection uses 4 readings with +/-5 bpm threshold
- [ ] Raw history buffer keeps 30s of data
- [ ] HRM parsing handles both uint8 and uint16 BPM formats
- [ ] Motor multiplier per zone applied in TorqueEngine

---

## Anti-Patterns

```
NEVER: Use 220-age for HRmax (always use observed/tested value)
NEVER: Use raw HR readings without 10s smoothing (too noisy for motor control)
NEVER: Ignore HR zone 5 (rider at max effort MUST get maximum assist)
NEVER: Override pre-emptive terrain decisions in zone 3 (terrain takes priority)
NEVER: Set W' tau below 120s or above 600s (physiological bounds)
NEVER: Apply HR-based mode changes when HR = 0 (sensor disconnected)
NEVER: Use same EF baseline for different effort categories
NEVER: React to HR trend with fewer than 4 data points
```

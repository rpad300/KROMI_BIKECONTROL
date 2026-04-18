# 08 — Di2 & SRAM AXS Integration Engineer

## Role

You implement and maintain the Shimano Di2 electronic shifting integration, motor inhibit during shifts, gear efficiency analysis, and SRAM AXS Flight Attendant suspension control. You understand the WebSocket bridge architecture (PWA talks to APK, APK handles BLE), the shift-motor inhibit pattern (ECO not OFF), and gear ratio calculations for a 12-speed cassette. You never cut motor to OFF during shifts, always resume within 400ms, and use real bike configuration for gear ratios.

---

## Architecture Overview

```
APK (Android native)               PWA (React)
├── Shimano BLE auth               ├── Di2Service (commands + message handler)
├── Xorshift128 + AES-128-ECB      ├── ShiftMotorInhibit (ECO during shift)
├── PCE protocol decode            ├── GearEfficiencyEngine (ratios + advisory)
├── Gear tracking                  └── bikeStore (currentGear, shifting, etc.)
└── WebSocket server (8765)
         ↕ JSON messages ↕
```

The PWA does NOT connect directly to Di2 via Web Bluetooth. Shimano requires proprietary authentication (Xorshift128 challenge + AES-128-ECB) that only runs in the native APK. The PWA receives gear data via WebSocket bridge.

---

## Key Files

```
src/services/di2/
  Di2Service.ts          — WebSocket message handler, commands, state
  ShiftMotorInhibit.ts   — Motor reduction during shift events
  GearEfficiencyEngine.ts — Gear ratio math, effort scoring, pre-shift advisory

src/store/bikeStore.ts   — currentGear, shifting, shiftCount, totalGears
src/store/settingsStore.ts — BikeConfig (cassette_sprockets, chainring_teeth, etc.)
src/services/bluetooth/BLEBridge.ts — sendAssistMode() for motor control
```

---

## Di2Service — WebSocket Bridge

### Message Types (APK to PWA)

```typescript
// Connection lifecycle
'shimanoConnected'   — { serial, firmware } — auth successful
'shimanoStatus'      — { status: 'disconnected' }
'shimanoFound'       — { name, address, rssi } — scan result
'shimanoError'       — { error: string }

// Data
'shimanoGear'        — { gear, previousGear, direction, totalGears, shiftCount }
'shimanoBattery'     — { level: number }
'shimanoComponents'  — { components: ShimanoComponent[] }
'shimanoGearStats'   — ride statistics response
'shimanoPce'         — { hex: string } — raw PCE data
'shimanoRealtime'    — { hex: string } — real-time notifications
```

### Message Types (PWA to APK)

```typescript
'shimanoScan'         — Start scanning for STEPS devices
'shimanoConnect'      — { address: string } — Connect to specific device
'shimanoDisconnect'   — Disconnect
'shimanoBattery'      — Request battery level
'shimanoGearState'    — Request current gear
'shimanoGearStats'    — Request usage statistics
'shimanoResetStats'   — Reset shift counters
'shimanoPceCommand'   — { controlInfo, data } — Raw PCE command
```

### Gear Change Processing

When a `shimanoGear` message arrives:

```typescript
// 1. Update Di2Service internal state
this.state.gear = gear;
this.state.totalGears = totalGears;
this.state.shiftCount = shiftCount;

// 2. Update bikeStore (triggers UI + intelligence layers)
store.setGear(gear);
store.setShiftCount(shiftCount);
store.setTotalGears(totalGears);

// 3. Set shifting flag for motor inhibit (auto-clears after 300ms)
store.setShifting(true);
setTimeout(() => store.setShifting(false), 300);

// 4. Record shift event in history
this.shiftHistory.push({ gear_from, gear_to, direction, timestamp });

// 5. Fire callbacks → ShiftMotorInhibit + GearEfficiencyEngine
this.onShiftStartCbs.forEach(cb => cb(shiftEvent));
this.onGearChangedCbs.forEach(cb => cb(gear));
```

---

## ShiftMotorInhibit

Reduces motor to ECO during gear shifts to protect the chain and eliminate chain drops. **Critical: reduces to ECO, NOT OFF.** OFF causes an abrupt torque jerk that is worse than a chain drop.

### Flow

```
Di2 shift event detected
    |
    v
  Save current mode (e.g., SPORT)
    |
    v
  sendAssistMode(ECO)           ← reduce motor immediately
    |
    v
  Start 400ms safety timer
    |
    ├── Di2 gear confirmation arrives → resume saved mode
    |
    └── 400ms timer fires (no confirmation) → resume saved mode anyway
```

### Implementation

```typescript
di2Service.onShiftStart(async (event) => {
  this.savedMode = useBikeStore.getState().assist_mode;

  // Reduce to ECO (not OFF)
  if (currentMode !== AssistMode.ECO && currentMode !== AssistMode.OFF) {
    await sendAssistMode(AssistMode.ECO);
  }

  // Safety: resume after 400ms even without Di2 confirmation
  this.timer = setTimeout(() => this.resume(), 400);
});

di2Service.onGearChanged(async (gear) => {
  await this.resume();  // gear confirmed, resume immediately
});
```

### Timing

- Shimano wireless Di2 shifts are essentially instant (~50ms mechanical)
- The 300ms `shifting` flag in bikeStore is for UI indication
- The 400ms safety timer in ShiftMotorInhibit ensures motor always resumes
- Typical cycle: shift event → ECO → gear confirm (50-100ms) → resume saved mode

---

## GearEfficiencyEngine

### Bike Configuration

Reads from `settingsStore.bikeConfig`:

```typescript
// Priority 1: exact sprocket teeth (best accuracy)
bike.cassette_sprockets = [51, 45, 39, 34, 30, 26, 23, 20, 17, 15, 13, 10]

// Priority 2: generate from range string
bike.cassette_range = "10-52"
bike.cassette_speeds = 12

// Priority 3: fallback defaults (Shimano XT M8100)
DEFAULT_SPROCKETS = [51, 45, 39, 34, 30, 26, 23, 20, 17, 15, 13, 10]
DEFAULT_CHAINRING = 34
```

Gear 1 = biggest sprocket (51T) = easiest. Gear 12 = smallest sprocket (10T) = hardest.

### Gear Ratio Calculation

```typescript
ratio = chainring / sprocket
// Gear 1:  34/51 = 0.667 (easy, high cadence)
// Gear 6:  34/26 = 1.308 (moderate)
// Gear 12: 34/10 = 3.400 (hard, low cadence)
```

### Cadence at Speed

```typescript
getCadenceAtGear(speedKmh: number, gear: number): number {
  const speedMs = speedKmh / 3.6;
  const wheelRpm = (speedMs / wheelCircumM) * 60;  // wheelCircumM = 2.290m
  return Math.round(wheelRpm / ratio);
}
```

### Optimal Gear Selection

Finds the gear that produces cadence closest to target (default 80 RPM):

```typescript
getOptimalGear(speedKmh: number, targetCadence: number = 80): number
```

### Effort Assessment

Scores rider effort (0-100) based on gear position, cadence, HR, and gradient:

```typescript
assessEffort(currentGear, cadenceRpm, speedKmh, hrBpm, hrZoneMax, gradientPct): GearEffort

// Returns assistAdjustment: -20 to +15
// Cases:
//   Light gear + high cadence + low HR  → -15 (reduce assist, save battery)
//   Light gear + decent cadence + flat  → -10 (moderate reduction)
//   Heavy gear + low cadence + climb    → +12 (grinding, boost assist)
//   Cadence dropping + heavy gear + climb → +8 (fatigue onset)
//   Cadence 70-90 RPM (sweet spot)      →  0 (efficient, no change)
//   Very light gear on flat             → -8 (recovery/coasting)
```

### Pre-Shift Advisory

Warns rider before reaching a climb that they should downshift:

```typescript
getPreClimbAdvisory(nextTransition, currentGear, speedKmh): GearAdvisory | null

// Returns advisory when:
// - Next transition is flat_to_climb or descent_to_climb
// - Distance < 150m
// - Optimal gear < current gear (need to downshift)
// Urgency: 'urgent' if < 50m, 'advisory' if < 150m
```

---

## SRAM AXS Flight Attendant

BLE service `4D500001` for SRAM AXS wireless electronic shifting with Flight Attendant automatic suspension control.

### Integration Points

- Suspension lockout/open based on terrain detection
- Gear position tracking (similar to Di2 but different protocol)
- Chain tension management during shifts

**Note:** SRAM AXS integration is secondary. The primary drivetrain is Shimano Di2. SRAM support is for accessories (dropper post, suspension lockout).

---

## Ride Statistics

Di2Service tracks shift history for post-ride analysis:

```typescript
getRideGearStats(): {
  shiftCount: number;
  shiftHistory: ShiftEvent[];
  gearUsageMs: Record<number, number>;  // gear → milliseconds spent
}
```

---

## Checklist for Changes

- [ ] Motor inhibit reduces to ECO (NEVER OFF) during shifts
- [ ] Safety timer of 400ms ensures motor always resumes
- [ ] Gear confirmation from Di2 triggers immediate resume
- [ ] bikeStore.shifting flag auto-clears after 300ms
- [ ] Gear ratios use real BikeConfig (sprockets, chainring, wheel circumference)
- [ ] Gear 1 = biggest sprocket = easiest (sorted descending)
- [ ] Default wheel circumference is 2290mm (29" MTB)
- [ ] Effort assessment returns adjustment range -20 to +15
- [ ] Pre-shift advisory only fires within 150m of terrain transition
- [ ] Cadence sweet spot is 70-90 RPM
- [ ] Target cadence for optimal gear is 80 RPM
- [ ] Di2 communication goes through WebSocket bridge (not direct BLE)
- [ ] sendAssistMode() from BLEBridge works in both WebSocket and Web Bluetooth modes

---

## Anti-Patterns

```
NEVER: Cut motor to OFF during shifts (causes abrupt jerk, worse than chain drop)
NEVER: Keep motor inhibited longer than 400ms (rider loses momentum)
NEVER: Connect to Di2 via Web Bluetooth directly (requires Shimano auth in native code)
NEVER: Hardcode gear ratios (always read from BikeConfig)
NEVER: Assume 11-speed (bike is 12-speed, configurable in settings)
NEVER: Send motor commands during shifting flag (bikeStore.shifting = true)
NEVER: Ignore gear position in torque calculation (low gears need torque cap)
NEVER: Use cadence < 55 RPM as normal (it indicates grinding/fatigue)
```

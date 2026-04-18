# 06 — Motor & Torque Control Engineer

## Role

You implement and maintain the motor torque control system that writes continuous torque and support parameters to the Giant EnergyPak motor via the GEV BLE protocol. You classify climb types, calculate optimal torque profiles, enforce smoothing constraints, and manage launch control. You never jump more than 15Nm between updates, never exceed protocol limits, and always apply battery-aware scaling.

---

## Architecture Overview

```
Terrain + HR + Gear + Battery
        |
        v
  TorqueEngine.calculateOptimalTorque()
        |
        v
  Classify climb → Base profile → HR adjust → Gear adjust → Battery scale
        |                                                        |
        v                                                        v
  Smooth (factor 0.3, max 15Nm jump)              Global multiplier
        |
        v
  GEVTorqueWriter.writeTorqueCommand()
        |
        v
  GEV Protocol 0xE3 cmd → AES encrypt → BLE write to motor
```

---

## Key Files

```
src/services/torque/
  TorqueEngine.ts        — Climb classification, torque calculation, smoothing
  GEVTorqueWriter.ts     — Encodes and sends torque via GEV protocol

src/store/torqueStore.ts — Zustand store for current torque state
src/types/gev.types.ts   — GEV command constants
src/services/bluetooth/
  GEVProtocol.ts         — buildCommand() for GEV packets
  GEVCrypto.ts           — AES encryption (placeholder key)
  GiantBLEService.ts     — BLE connection management
```

---

## GEV Torque Protocol

The Giant motor accepts torque parameters via GEV command `0xE3` (ASSIST_CONFIG):

```
Parameter       Range        Unit       Protocol Encoding
─────────────────────────────────────────────────────────
Support %       50-350       %          0-360 direct (uint16 BE)
Torque limit    20-85        Nm         Scaled to 0-1000 (torque/85*1000, uint16 BE)
Launch value    0-10         level      Direct (uint8)

Packet format: [torque_hi, torque_lo, support_hi, support_lo, launch, flags]
```

### GEVTorqueWriter Encoding

```typescript
const torqueRaw = Math.round((cmd.torque_nm / 85) * 1000); // Scale 0-1000
const supportRaw = Math.round(cmd.support_pct);             // 0-360 direct
const launchRaw = cmd.launch_value;                          // 0-10 direct

const payload = new Uint8Array([
  (torqueRaw >> 8) & 0xff, torqueRaw & 0xff,
  (supportRaw >> 8) & 0xff, supportRaw & 0xff,
  launchRaw,
  0x00, // flags (reserved)
]);

const packet = buildCommand(GEV_CMD.ASSIST_CONFIG, payload);
// → encrypt with AES when key available
// → write via giantBLEService.writeGEV(packet)
```

---

## Climb Classification

The engine classifies terrain into 8 types based on gradient and segment length:

```typescript
enum ClimbType {
  SHORT_STEEP    = 'short_steep',     // gradient >= 9%, length < 150m
  SHORT_MODERATE = 'short_mod',       // gradient >= 4%, length < 150m
  LONG_STEEP     = 'long_steep',      // gradient >= 9%, length >= 400m
  LONG_MODERATE  = 'long_mod',        // gradient >= 4%, length >= 400m
  PUNCHY         = 'punchy',          // gradient >= 9%, 150-400m
  ROLLING        = 'rolling',         // gradient >= 4%, 150-400m OR 2-4% any length
  FLAT           = 'flat',            // gradient < 2%
  DESCENT        = 'descent',         // gradient < -3%
}
```

---

## Torque Profiles by Climb Type

Each climb type has a base torque profile (before adjustments):

```
Climb Type        Torque(Nm)   Support(%)   Launch(0-10)
──────────────────────────────────────────────────────────
SHORT_STEEP          82           320           9
PUNCHY               78           290           8
SHORT_MODERATE       65           220           6
LONG_STEEP           65           240           4
ROLLING              55           200           5
LONG_MODERATE        45           160           3
FLAT                 25            80           2
DESCENT               0             0           0
```

### Terrain-to-Support Mapping (Simplified)

```
Flat (< 2%):          50-100% support     → 25Nm torque
Rolling (2-4%):      100-200% support     → 45-55Nm torque
Climb (4-9%):        160-240% support     → 45-65Nm torque
Steep climb (9%+):   240-320% support     → 65-82Nm torque
```

---

## Adjustment Layers

### 1. Heart Rate Adjustment

```typescript
// HR zone >= 4 (threshold/max): boost support and torque
support = Math.min(support * 1.25, 360);
torque = Math.min(torque * 1.15, 85);

// HR zone 1-2 (recovery/base): reduce to save battery
support = Math.max(support * 0.7, 40);
torque = Math.max(torque * 0.75, 20);

// HR rising + zone >= 3: anticipatory boost
support = Math.min(support * 1.15, 360);
```

### 2. Gear Adjustment

```typescript
// Gear 1-2 (lowest/easiest): protect chain, limit torque
torque = Math.min(torque, 55);   // cap at 55Nm
launch = Math.min(launch, 4);    // reduce launch aggression

// Gear 10+ on climb (>4%): rider in hard gear on climb, boost
support = Math.min(support * 1.2, 360);
```

### 3. Battery Scaling

```typescript
// Battery < 30%: progressive reduction
const scale = 0.7 + (batteryPct / 30) * 0.3;  // 0.7-1.0
torque *= scale;
support *= scale;

// Battery < 15%: emergency mode — hard caps
torque = Math.min(torque, 35);     // max 35Nm
support = Math.min(support, 120);  // max 120%
```

### 4. Global Multiplier

Applied from athlete form score (fatigue model). Range 0.5-1.0 typically.

```typescript
torque *= globalMultiplier;
support *= globalMultiplier;
```

---

## Smoothing Rules

**Critical constraint: NEVER jump more than 15Nm between updates.**

The engine uses exponential smoothing with factor 0.3:

```typescript
private smooth(current: number, target: number, factor: number): number {
  return current + (target - current) * factor;
}

// Applied to all three parameters:
torque  = smooth(currentTorque,  targetTorque,  0.3);  // slow
support = smooth(currentSupport, targetSupport, 0.3);  // slow
launch  = smooth(currentLaunch,  targetLaunch,  0.4);  // slightly faster
```

### Skip Insignificant Changes

To avoid flooding the BLE link with minor updates:

```typescript
if (Math.abs(torque - currentTorque) < 3 && Math.abs(support - currentSupport) < 10) {
  return null; // skip this write
}
```

### Update Throttle

Minimum 500ms between updates (safety net; the hook controls the main 2s timing):

```typescript
if (now - lastUpdateMs < 500) return null;
```

---

## Launch Control

Launch value (0-10) controls initial torque boost from standstill. Higher values = more aggressive start.

```
Steep start (>9%):   launch = 8-9 (aggressive, prevents rollback)
Moderate start:      launch = 4-6 (smooth acceleration)
Flat start:          launch = 2-3 (gentle)
Low gear (1-2):      launch capped at 4 (chain protection)
```

---

## Integration with TorqueStore

```typescript
// torqueStore holds the current state for UI display
interface TorqueState {
  torque_nm: number;
  support_pct: number;
  launch_value: number;
  climb_type: ClimbType;
  reason: string;
  lastUpdate: number;
}
```

The UI reads from torqueStore. The TorqueEngine writes to it after each successful calculation. The GEVTorqueWriter reads the command and sends it to the motor.

---

## Calling Convention

```typescript
// Called by the motor controller hook every 2 seconds
const cmd = torqueEngine.calculateOptimalTorque(
  terrain,       // TerrainAnalysis from ElevationPredictor
  hrZone,        // 0-5 from HRZoneEngine (0 = no HR data)
  hrTrend,       // 'rising' | 'falling' | 'stable'
  currentGear,   // 1-12 from Di2Service (0 = no Di2)
  batteryPct,    // 0-100 from BLE battery service
);

if (cmd) {
  await writeTorqueCommand(cmd);  // GEVTorqueWriter
  torqueStore.setState(cmd);      // update UI
}
```

All parameters except `terrain` are optional and default to neutral values. The engine works with just terrain + battery when HR and Di2 are not connected.

---

## Checklist for Changes

- [ ] Torque NEVER jumps more than 15Nm between consecutive updates
- [ ] Smoothing factor is 0.3 for torque/support, 0.4 for launch
- [ ] Support capped at 360%, torque at 85Nm, launch at 10
- [ ] Battery < 30% applies progressive scaling (0.7-1.0)
- [ ] Battery < 15% hard caps: 35Nm torque, 120% support
- [ ] Gear 1-2 caps torque at 55Nm and launch at 4
- [ ] Update throttle: minimum 500ms between writes
- [ ] Skip writes when change < 3Nm torque AND < 10% support
- [ ] GEV payload uses big-endian uint16 for torque and support
- [ ] Torque scaled to 0-1000 range before encoding (torque/85*1000)
- [ ] Descent = zero torque, zero support, zero launch
- [ ] Global multiplier applied AFTER HR/gear/battery adjustments
- [ ] AES encryption required for production (placeholder key in dev)

---

## Anti-Patterns

```
NEVER: Jump > 15Nm between updates (causes mechanical stress, rider discomfort)
NEVER: Send torque commands when assist_mode != POWER(5)
NEVER: Set support > 360% or torque > 85Nm (protocol hard limits)
NEVER: Skip battery scaling (can drain battery mid-ride)
NEVER: Use factor > 0.5 for torque smoothing (too aggressive transitions)
NEVER: Set launch > 4 in gear 1-2 (chain protection)
NEVER: Send motor commands faster than 500ms apart (BLE congestion)
NEVER: Ignore null return from calculateOptimalTorque (means skip this update)
```

---

## Motor Tuning Protocol Reference

Full GEV motor tuning uses command `0xE3 0x0C`:

```
Byte    Field              Range         Default
────────────────────────────────────────────────
0-1     Support %          50-350%       200%
2       Torque limit       20-85Nm       55Nm
3       Launch value       0-10          5
4       Regen level        0-5           0 (not used on Trance X)
5       Flags              bitmask       0x00
```

The TorqueEngine abstracts this. Direct protocol manipulation should only happen through GEVTorqueWriter.

# Shimano STEPS Motor BLE Protocol

> Reverse-engineered from **Shimano E-TUBE RIDE APK** (jadx decompile, Session 13)
> Source: `APKRIDECONTROL/etube_src/`
> Implementation: `ShimanoMotorService.ts` + `ShimanoMotorManager.kt`

## BLE UUIDs

### SBI Service (0x18EF) — Shimano Bicycle Information
UUID base: `-5348-494D-414E-4F5F424C4500` (ASCII "SHIMANO_BLE\0")

| Characteristic | UUID | Properties |
|---------------|------|------------|
| **Feature** | `00002AC0-5348-...` | READ, INDICATE |
| **Periodic Information** | `00002AC1-5348-...` | NOTIFY |
| **Instantaneous Info** | `00002AC2-5348-...` | INDICATE |
| **D-Fly Channel Switch** | `00002AC3-5348-...` | READ, INDICATE |
| **SBI Control Point** | `00002AC4-5348-...` | INDICATE, WRITE |
| **System Serial Number** | `00002AC5-5348-...` | READ |

### Standard Services (also exposed by motor)
- Cycling Power: `0x1818` — real-time motor watts + torque
- Battery: `0x180F` — SOC
- Device Info: `0x180A` — model, firmware

## SBI Command Protocol

Commands sent to **Control Point** (0x2AC4):

```
Format: [OpCode] [SequenceNumber] [Params...]
Response: [0x80] [SeqEcho] [ResponseCode] [Data...]
```

### Operation Codes

| OpCode | Name | Parameters |
|--------|------|------------|
| `0x02` | CHANGE_ASSIST_MODE | `0x00`=OFF, `0x01`=ECO, `0x02`=TRAIL, `0x03`=BOOST, `0x05`=WALK |
| `0x03` | CHANGE_LIGHT | `0x01`=off, `0x02`=on |
| `0x04` | REQUEST_RESET | — |
| `0x05` | REQUEST_STEPS_STATUS | — (triggers 0x01 notification) |
| `0x11` | MTB_ADDITIONAL_INFO | — |
| `0x13` | ASSIST_PROFILE_NAME | — (E-TUBE PROJECT profiles) |
| `0x7E` | LEVEL_UP | — (increment assist) |
| `0x7F` | LEVEL_DOWN | — (decrement assist) |

### Response Codes
| Code | Meaning |
|------|---------|
| `0x00` | Success/ACK |
| `0x01` | Device Busy |
| `0x02` | Invalid Command |
| `0x03` | Invalid Parameter |
| `0xFF` | General Error |

## Telemetry Streams

All via **Periodic Information** (0x2AC1) notifications:

### Type 0x01: STEPS_STATUS
```
Byte 0:    Info type (0x01)
Byte 1:    Error code (0xFF=none, 0x45=error, 0x57=warning)
Byte 2-3:  Error IDs (0xFF=none)
Byte 4:    Maintenance alert (1=active)
Byte 6:    Light status (1=off, 2=on, 0xFF=no info)
Byte 7:    Forced ECO (1=active)
Byte 8:    Shift advice (0=none, 1=up, 2=down)
Byte 9-10: Nominal capacity (uint16 LE, battery indicator)
Byte 15:   Current assist profile
Byte 16:   Assist character value (bit field)
```

### Type 0x02: TRAVELING_INFORMATION1
```
Byte 0:    Info type (0x02)
Byte 1:    Assist mode
           - Bits 0-3: 0=OFF, 1=ECO, 2=TRAIL, 3=BOOST, 4=WALK_STOP, 5=WALK
           - Bit 4: fine-tune flag
Byte 2-3:  Speed (int16 LE, km/h × 100, -32768=no info)
Byte 4:    Assistance level (int8, %)
Byte 5:    Cadence (uint8 RPM, 0xFF=no info)
Byte 6-9:  Traveling time (uint32 LE, seconds)
```

### Type 0x03: TRAVELING_INFORMATION2
```
Byte 0:     Info type (0x03)
Byte 1-4:   Trip distance (uint32 LE, meters)
Byte 5-8:   Cumulative distance (uint32 LE, meters) — ODOMETER
Byte 9-10:  Average speed (int16 LE, km/h × 100)
Byte 11-12: Maximum speed (int16 LE, km/h × 100)
Byte 13-14: Range BOOST (uint16 LE, km)
Byte 15-16: Range TRAIL (uint16 LE, km)
Byte 17-18: Range ECO (uint16 LE, km)
```

> **Range per mode comes DIRECTLY from the motor** — no estimation needed!

## Cycling Power Measurement (0x1818 → 0x2A63)

```
Byte 0-1:  Flags (16-bit bitmask)
Byte 2-3:  Instantaneous Power (int16 LE, Watts)
[Optional based on flags]:
  - Pedal Power Balance (1 byte, %)
  - Accumulated Torque (uint16 LE, Nm × 32)
  - Wheel Revolution Data (6 bytes)
  - Crank Revolution Data (4 bytes)
```

## Supported Motors

| Motor | Torque | Power | Use Case |
|-------|--------|-------|----------|
| EP800 | 85Nm | 600W | e-MTB flagship |
| EP600 | 85Nm | 600W | e-MTB |
| EP8 | 85Nm | 500W | e-MTB |
| E8000 | 75Nm | 500W | e-MTB (legacy) |
| E7000 | 60Nm | 500W | e-MTB entry |
| E6100 | 60Nm | 500W | Urban/Trekking |
| E5000 | 40Nm | 250W | Urban lightweight |

## Device Detection

```
Service UUID contains: "18EF" or "5348-494D-414E"
Name patterns: "EP800", "EP600", "E8000", "E7000", "STEPS"
Manufacturer: Shimano (DIS)
```

## Authentication
- Standard BLE bonding only
- No custom PIN or encryption
- Bidirectional auth characteristics exist but only for firmware updates

## Key Source Files (decompiled)
- `com/shimano/etuberidemobile/shared/models/ble/BleService.java` — Service definitions
- `com/shimano/etuberidemobile/droid/phone/ble/models/sbicommand/SbiOperationCode.java` — Commands
- `com/shimano/etuberidemobile/droid/phone/ble/StepsStatusData.java` — Telemetry
- `com/shimano/etuberidemobile/droid/phone/ble/StepsTravelingInformation1Data.java` — Speed/cadence
- `com/shimano/etuberidemobile/droid/phone/ble/StepsTravelingInformation2Data.java` — Distance/range
- `com/shimano/etuberidemobile/droid/phone/ble/models/CPMeasurement.java` — Power

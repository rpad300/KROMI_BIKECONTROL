# Bosch eBike BLE Protocol

> Reverse-engineered from **Bosch eBike Connect APK** (jadx decompile, Session 13)
> Source: `APKRIDECONTROL/bosch_src/`
> Implementation: `BoschEBikeService.ts` + `BoschBikeManager.kt`

## BLE UUIDs

### MCSP (Motor Control Service Protocol)
UUID prefix encodes ASCII **"BOSC"** (`424F5343`).

| Role | UUID |
|------|------|
| **Service** | `424F5343-4820-4D43-5350-76012E002E00` |
| **Read** (notify/indicate) | `424F5343-4820-4D43-5350-20204D49534F` |
| **Write** (write with response) | `424F5343-4820-4D43-5350-20204D4F5349` |

### BSS (BootStrap Service)
| Role | UUID |
|------|------|
| **Service** | `424F5343-4820-4253-5376-76012E002E00` |
| **Read** | `424F5343-4820-4253-5320-20204D49534F` |
| **Write** | `424F5343-4820-4253-5320-20204D4F5349` |

### Fake DIS (fallback)
`DC435FBE-837D-42C5-A987-A9DE0087E491`

## Protocol Stack

```
Application Layer  →  CoAP + Protobuf messages
Simple Message Protocol (SMP)  →  Domain/message routing
Simple Transport Protocol (STP)  →  20-byte MTU segmentation
BLE GATT  →  Characteristic read/write/notify
```

### STP Segmentation
- Default MTU: 20 bytes
- Header: 1 byte
  - Bit 7: continuation flag (1 = more segments follow)
  - Bits 0-5: payload size (single) or sequence number (multi)
- Single segment: `[size_byte][payload...]`
- Multi segment: `[0x80|seq][payload...]` ... `[size_byte][final_payload...]`

## Assist Modes

| Value | Mode | Description |
|-------|------|-------------|
| 0 | OFF | No assist |
| 1 | ECO | Low assist, max range |
| 2 | TOUR | Balanced assist |
| 3 | SPORT | High assist |
| 4 | TURBO | Maximum assist |

## Telemetry Data

Available via protobuf messages over MCSP:

- **Battery SOC**: 0-100%
- **Power**: Current, average, max watts
- **Torque**: Current, average, max Nm
- **Speed**: Current km/h
- **Cadence**: RPM
- **Range**: Distance remaining per mode
- **Odometer**: Drive unit total distance
- **Energy Consumption**: Average Wh/km
- **Motor Temperature**: Via system status

## Supported Hardware

### Motors
- Performance Line CX (off-road, 85Nm)
- Performance Line CX Race (off-road, 85Nm, lightweight)
- Active Line Plus (urban/fitness, 50Nm)
- Cargo Line (cargo bikes, 85Nm)

### Displays
- Kiox 300/500
- Nyon (full navigation)
- Intuvia (legacy)
- SmartphoneHub
- LED Remote

## Device Detection

```
Manufacturer: "Robert Bosch GmbH" (DIS characteristic 0x2A29)
UUID pattern: prefix "424F5343" (ASCII "BOSC")
Name patterns: "Bosch", "Nyon", "Kiox", "Intuvia", "SmartphoneHub"
```

## Authentication
- Standard BLE bonding (no custom PIN)
- Nyon uses handshake protocol (C2043b constants)
- No encryption layer beyond BLE security

## Key Source Files (decompiled)
- `p330c4/C4308n.java` — BLE manager
- `com/bosch/ebike/app/common/communication/mcsp/segmentation/C4660b.java` — STP
- `com/bosch/ebike/app/common/system/CustomScreen.java` — Telemetry definitions
- `com/bosch/ebike/app/common/communication/coap/protobuf/` — Protobuf definitions

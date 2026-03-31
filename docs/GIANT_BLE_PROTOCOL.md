# Giant eBike BLE Protocol — Reverse-Engineered from RideControl APK

Source: `RideControl.apk` (Giant RideControl Android app)
Package: `tw.com.program.bluetoothcore`
Analysis date: 2026-03-31

## BLE Service UUIDs

### GEV Legacy Service (AES encrypted binary protocol)
| UUID | Role |
|------|------|
| `F0BA3012-6CAC-4C99-9089-4B0A1DF45002` | GEV Service |
| `F0BA3013-6CAC-4C99-9089-4B0A1DF45002` | GEV Notify (subscribe) + Write |

### GEV Protobuf Service (new protocol, uses `app_menuProto.proto`)
| UUID | Role |
|------|------|
| `F0BA5201-6CAC-4C99-9089-4B0A1DF45002` | Protobuf Service |
| `F0BA5202-6CAC-4C99-9089-4B0A1DF45002` | Protobuf Write |
| `F0BA5203-6CAC-4C99-9089-4B0A1DF45002` | Protobuf Notify |
| `F0BA5204-6CAC-4C99-9089-4B0A1DF45002` | Protobuf (extra, TBD) |

### Standard BLE Services
| UUID | Role |
|------|------|
| `0x180F` | Battery Service |
| `0x1816` | CSC (Speed + Cadence) |
| `0x1818` | Cycling Power |
| `0x180D` | Heart Rate (separate device) |

## AES Key Table

Encryption: **AES/ECB/NoPadding** (128-bit, 16-byte blocks)
Source: `GEVUtil.aesTable` in `tw.com.program.bluetoothcore.device.GEVUtil`

### Key Usage (from decompiled code)
- `getAesKey(0-3)` — Session establishment (`aesSe...()`)
- `getAesKey(4)` — Send commands to motor (`sendData()`)
- `getAesKey(8)` — Send commands to motor (`sendData()`)
- `getAesKey(13)` — Data packet encrypt/decrypt (`aesDa...`)
- `getAesKey(14)` — Data packet + command encrypt/decrypt

### Keys (16 x 16 bytes)
```
Key[ 0]: 39 fa d4 c3 93 42 ae 41 42 a9 a7 77 89 a1 13 af
Key[ 1]: 30 ec 00 bd 96 f7 21 45 d8 46 b0 9a 87 29 a6 37
Key[ 2]: 6e 0d e7 e3 04 ae 67 2f e4 a0 bc 3f f5 04 4d 21
Key[ 3]: b0 b9 c4 7a 62 67 67 d0 9d 40 e4 82 e2 d7 65 ee
Key[ 4]: 5d 2c b8 e0 04 b0 63 57 b0 75 92 f4 b2 61 84 c1
Key[ 5]: 0d 5e 2f 33 96 8a 63 ee 5e f1 fe 06 0e 29 ce f6
Key[ 6]: 58 ed 11 d1 f8 82 82 22 e8 86 22 63 5b c8 88 c1
Key[ 7]: 13 ef 0a 98 51 ff f3 55 21 f2 06 c0 aa d5 d6 06
Key[ 8]: 87 18 a0 ef ea 5a b7 35 ec bf 1d a1 a2 39 19 8b
Key[ 9]: a6 4c d4 19 7a e3 99 4c 19 1e cc 98 26 b9 70 8d
Key[10]: fa ac 80 64 4b f8 46 dd df 7c d0 fa 19 85 ac 0b
Key[11]: 28 98 f9 81 44 b6 c3 09 64 06 7e bf 27 15 6b 2b
Key[12]: 17 cb 16 36 14 ab 6a a3 e8 4d 26 87 4c 0f d3 47
Key[13]: 2a f5 57 69 ae 8a c8 0d 3b 45 ad af 35 ed aa 06
Key[14]: e7 c2 2e 96 b0 74 71 9c cf 19 16 1c 69 41 79 f0
Key[15]: 96 b5 f6 8a ab df e4 b8 7d 6e 65 67 51 cd f3 9e
```

## GEVManager Methods (from decompilation)

### Connection
- `connectGEV(device)` — Connect to BLE device, discover services
- `disconnectGEV()` — Disconnect
- `onServicesDiscovered()` — Gets service `RIDECONTROL_SERVICE_UUID`, sets write + notify characteristics

### Motor Control
- `intoMode(EGEVModeCommand)` — Change assist mode (ECO/TOUR/SPORT/POWER)
- `sendCommandWithoutResponse(EGEVGeneralCommand)` — Fire-and-forget command

### Data Reading
- `readBattery()` — Read battery status
- `readRidingData()` — Read current ride data (speed, power, cadence, etc.)
- `readAllBikeData()` — Reads all data categories:
  - PASSIVE_DATA_RIDE_CONTROL_1..4
  - PASSIVE_DATA_SYNC_DRIVE_1..4
  - PASSIVE_DATA_ENERGY_PAK_1..4
  - ACTIVE_DATA_RIDE_CONTROL_1
  - ACTIVE_DATA_SYNC_DRIVE_1
  - ACTIVE_DATA_ENERGY_PAK_1
- `readFactoryData()` — Factory/calibration data
- `readMCUVersion()` — Firmware version
- `readRCType()` — RideControl type identifier
- `readRemainingRange()` — Estimated remaining range
- `readTuningData()` — Motor tuning parameters
- `readUIBleVersion()` — BLE module version

### Notifications
- `enableRidingNotification()` — Subscribe to continuous ride data updates
- `disableRidingNotification()` — Unsubscribe

### Diagnostics
- `diagnosticSyncDrive()` — Motor diagnostic data
- `diagnosticEnergyPak()` — Battery diagnostic data
- `diagnosticControlButton()` — Button diagnostic
- `diagnosticRideControlDisplay()` — Display diagnostic

### Other
- `screenLayout()` — Display screen configuration
- `sendNavigationAndManeuver()` — Send navigation instructions to display
- `sendFrameNumber()` — Set frame number
- `workoutGoalSetup()` / `workoutGoalRemainNotify()` — Workout targets
- `setTuningData()` — Write motor tuning

## Protobuf Protocol (`app_menuProto.proto`)

### Communication Pattern
- Method: SET(1), GET(2), RESPONSE(3), NOTIFY(4)
- Sources: SG20, DASH2, GO2, GOMINI, EVO3, APP

### Modules
1. **ePartModule** — Component info (SG, sensor, display, remotes, drivetrain, suspension, battery, charger, IoT, radar, taillight)
2. **accessoryModule** — Heart rate, TPMS (tire pressure)
3. **bikeConfigModule** — Language, units, backlight, radar, e-lock, ANT+ broadcast, brightness
4. **bikeInfoModule** — Frame number, odometer
5. **displayConfigModule** — Screen layout with field types (speed, range, cadence, power, HR, etc.)
6. **commandModule** — E-Lock commands (lock/unlock with AES-encrypted password)
7. **accessoryScanFunc** — Scan for BLE/ANT+ accessories
8. **calibrationFunc** — Shimano e-shift calibration

### E-Lock Protocol
- Uses AES-encrypted 16-byte password with timestamp
- Commands: LOCK, UNLOCK
- Box index: 0-15

## RideControl Types
From `getGevBikeType()`:
- ONE, ONE_JPN, ONE_BLE_ANT_PLUS
- EVO, EVO_JPN, EVO_45, EVO_S5, EVO_PRO
- CHARGE, CHARGE_S5

## Drive Unit Types
From `getDUType()`:
- DU4_1RB, DU6, DU_UNKNOW
- Categories: DU1 through DU7 with full bike model lists

## Smart Gateway Models
From strings: "Smart Gateway 10B", "Smart Gateway 10S"

## Key Architecture Insight

The RideControl app uses **two separate protocols**:
1. **Legacy GEV** (F0BA3012) — AES-encrypted binary packets for motor control, sensor data
2. **Protobuf** (F0BA5201) — Modern protocol for configuration, display layout, accessories

The Trance X E+ 2 (2023) Smart Gateway likely uses the **Protobuf service** (F0BA52xx) as primary. The legacy GEV service may not be exposed to external BLE clients (only to bonded RideControl app).

### Recommended approach for BikeControl PWA:
1. Try connecting to `F0BA5201` (Protobuf service) first
2. Use `app_menuProto.proto` to build/parse protobuf messages
3. Send GET requests for bike data, NOTIFY for real-time updates
4. If protobuf service unavailable, fall back to standard BLE (Battery/CSC/Power)

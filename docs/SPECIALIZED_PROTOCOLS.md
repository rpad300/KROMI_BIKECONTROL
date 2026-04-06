# Specialized BLE Protocols

> Reverse-engineered from **Specialized Flow APK** + **Specialized APK** (jadx decompile, Session 13)
> Source: `APKRIDECONTROL/flow_src/` + `APKRIDECONTROL/specialized2_src/`
> Implementation: `SpecializedFlowService.ts` + `SpecializedTurboService.ts` + `SpecializedBikeManager.kt`

## Two Protocol Stacks

Specialized uses **two different BLE protocol stacks** depending on bike generation:

### Protocol 1: Flow / Mission Control (MCSP + BES3)
For bikes with Brose/Bosch motor integration (Turbo Levo, Creo, Vado, Como).

### Protocol 2: TurboConnect (3-Service Proprietary)
For bikes with Specialized's own motor system (Turbo, PLW, Pluto series).

---

## Protocol 1: MCSP + BES3

### BLE UUIDs

| Service | UUID | Purpose |
|---------|------|---------|
| **MCSP** | `00000010-EAA2-11E9-81B4-2A2AE2DBCCE4` | Mission Control primary |
| MCSP Receive | `00000011-EAA2-11E9-81B4-2A2AE2DBCCE4` | Notify |
| MCSP Send | `00000012-EAA2-11E9-81B4-2A2AE2DBCCE4` | Write |
| **BES3** | `0000FE02-0000-1000-8000-00805F9B34FB` | Bosch eBike System 3 |
| **COBI CUI050** | `C0B11800-FEE1-C001-FEE1-FA57FEE15AFE` | SmartphoneHub info |
| **COBI CUI100** | `C0B11802-FEE1-C001-FEE1-FA57FEE15AFE` | SmartphoneHub extended |

### BES3 Protocol
- **1100+ protobuf message types** (DashboardService)
- Standard Google Protobuf v3 serialization
- Kotlin coroutines for async messaging

### Assist Mode Information
```protobuf
AssistModeInformation {
  identifier: ApplicationIdentifier
  name_short: string       // "ECO", "TRAIL", "TURBO"
  name_long: string        // Full mode name
  color: uint32            // RGB color code
  assist_mode_position: uint32
  user_adjustable: bool
  user_adjusted: bool
}
```
- ArrayOf4ActiveAssistModeIdentifier (active modes)
- ArrayOf8AssistModeIdentifier (all available)
- ArrayOf6MotorAssistanceFactors (per-mode multipliers)

### Battery Data
```protobuf
BatteryInfo {
  serial_number: string
  state_of_charge_for_rider: uint32  // % (user-facing)
  state_of_charge: uint32            // % (actual)
  remaining_energy_for_rider: uint32 // Wh
  remaining_energy: uint32           // Wh
  cell_temperature: float32          // °C
}
```
- Dual battery support (battery + battery_2)
- Events: BatteryChargingStart/Stop, BatteryStateOfChargeChange

### Dashboard Events
- AssistanceModeChange
- BikeLightOn / BikeLightOff
- WalkAssistChange
- BatteryInfo updates
- GenericDeviceDetection

---

## Protocol 2: TurboConnect (3-Service)

### BLE UUIDs
UUID base: `-3731-3032-494D-484F42525554` (encodes "7102IMHOBRUT")

| Service | UUID |
|---------|------|
| **Service 1** (telemetry+commands) | `00000001-3731-3032-494D-484F42525554` |
| **Service 2** (data) | `00000002-3731-3032-494D-484F42525554` |
| **Service 3** (notifications) | `00000003-3731-3032-494D-484F42525554` |
| S1 Read/Notify | `00000011-3731-3032-494D-484F42525554` |
| S1 Write | `00000021-3731-3032-494D-484F42525554` |

Alternative UUIDs (older bikes): base `-0000-4B49-4E4F-525441474947`

### Bike Types (13)
| ID | Type | Tune Name |
|----|------|-----------|
| 0 | PROTOTYPE | — |
| 1 | TURBO | Turbo |
| 2 | LEVO1 | LEVO |
| 3 | VADO | Vado |
| 4 | PLW | PLW |
| 5 | LEVO2 | Levo 2 |
| 6 | COMO2 | Como 2 |
| 7 | PLW2 | PLW 2 |
| 8 | APLW2 | Active PLW 2 |
| 9 | PLUTO | Pluto |
| 10 | APLUTO | Active Pluto |
| 11 | APLUTOPLUS | Active Pluto+ |
| 12 | PLUTO2 | Pluto 2 |

### Display Types (9)
TURBO, LEVO1, TCX1, TCU2, TCDW2, T3, H3, C4, T4

### Motor Types
- Legacy motors (Turbo, Levo1, Vado, PLW)
- Secured motors with DFU (Pluto, Active Pluto)
  - G3MotorDfuState: NO_OP, START_DFU
  - SecuredMotorOtaComponent

### Battery Telemetry
- StateOfCharge, VoltageLevel, CurrentLevel
- Temperature, Health, RemainingCapacity
- OnBikeChargeCycles, TotalChargeCycles
- ChargingActive, ErrorCodes

---

## Device Detection

```
Specialized Flow:     UUID contains "EAA2-11E9" or "FE02" or "C0B1"
Specialized Turbo:    UUID contains "3731-3032-494D" or "4B49-4E4F-5254"
Name patterns:        "Turbo", "Levo", "Creo", "Vado", "Como", "Pluto", "Specialized"
```

## Key Source Files

### Flow APK
- `McspGattConfig.java` — MCSP UUID definitions
- `Bes3EbikeGattService.java` — BES3 service
- `DashboardService.java` — All telemetry/event protobuf definitions
- `AssistModeInformation.java` — Mode customization
- `BatteryInfo` — Battery structure

### Specialized APK
- `BluetoothProtocol.java` / `BluetoothProtocolImpl.java` — 3-service protocol
- `BluetoothProtocolTCX1.java` — Legacy display protocol
- `BikeType.java` — 13 bike type enum
- `DisplayType.java` — 9 display types
- `BleServiceId.java` / `BleCharacteristicType.java` — Service definitions

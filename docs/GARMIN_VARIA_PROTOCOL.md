# Garmin Varia BLE Protocol

> Reverse-engineered from **Garmin Connect APK** (jadx decompile, Session 13)
> Source: `APKRIDECONTROL/garmin_src/`
> Implementation: `GarminVariaService.ts` + `AccessoryService.kt`

## BLE UUIDs

### Varia RTL (Radar + Tail Light) — 6A4E Family
| Role | UUID |
|------|------|
| **Service** | `6A4E8022-667B-11E3-949A-0800200C9A66` |
| **Notify/Read** | `6A4ECD28-667B-11E3-949A-0800200C9A66` |
| **Write** | `6A4E4C80-667B-11E3-949A-0800200C9A66` |

### Varia HL / UT (Head Light) — 16AA Family
| Role | UUID |
|------|------|
| **Service** | `16AA8022-3769-4C74-A755-877DDE3A2930` |
| **Notify/Read** | `4ACBCD28-7425-868E-F447-915C8F00D0CB` |
| **Write** | `DF334C80-E6A7-D082-274D-78FC66F85E16` |

## Protocol: GFDI (Garmin Fitness Device Interface)

- Protobuf-based messaging over BLE GATT
- "Monkeybrains" subscriber pattern for ConnectIQ integration
- Any UUID starting with `6A4E` + ending `-667B-11E3-949A-0800200C9A66` = Garmin device

## Light Modes

| ID | Name | Use |
|----|------|-----|
| 0-4 | CUSTOM_FLASH_1-5 | User-programmable patterns |
| 100 | SOLID_HIGH | Max brightness steady |
| 101 | SOLID_MEDIUM | Medium steady |
| 102 | SOLID_LOW | Low steady |
| 103 | PELOTON | Group ride (low, constant) |
| 104 | DAY_FLASH | High visibility daytime |
| 105 | NIGHT_FLASH | Reduced intensity nighttime |
| 106 | OFF | Light off |

### Custom Flash Programming
```protobuf
CustomLightModeConfig {
  custom_light_mode_type: enum
  custom_light_mode_name: string
  steps[]: {
    brightness: uint32 (0-100%)
    duration_ms: uint32
  }
}
```

## Radar Protocol

### Configuration
```protobuf
VariaConfiguration {
  incident_detection_enable: bool
  sensitivity: OFF | LOW | NORMAL | HIGH
  orientation_setting: DYNAMIC | STANDARD | INVERTED
  enable_rear_lights: bool
  enable_audio_alerts: bool
  sku: WW | UK_FRANCE | STVZO | APAC | NA
}
```

### Radar Data
```protobuf
VariaStatus {
  incident_detected: bool  // Binary — vehicle approaching or not
  orientation: 6-axis enum
}
```

### Sensitivity Thresholds
| Level | Range | Behaviour |
|-------|-------|-----------|
| OFF | — | No detection |
| LOW | ~100m+ | Slow approach only |
| NORMAL | ~60-100m | Standard cycling speed |
| HIGH | ~30-60m | Aggressive detection |

### Light Integration
- Auto-flash on vehicle detection
- Brightness ramps with threat proximity
- Multi-light sync (up to 3 devices)

## Ambient Light Levels
```
DAY(0) → VERY_HIGH(1) → HIGH(2) → MED(3) → LOW(4) → DARK(5)
```

## Device Detection
```
Garmin Varia = any of:
  - UUID starts with "6A4E" + ends "-667B-11E3-949A-0800200C9A66"
  - UUID = "16AA8022-3769-4C74-A755-877DDE3A2930"
  - Name contains "Varia", "RTL", "HL", "UT"
```

## Key Source Files (decompiled)
- `zx1/C52034h.java` — UUID definitions (f202545a..f202562r)
- `e42/C19172h.java` — Monkeybrains subscriber (service registration)
- `com/garmin/proto/generated/GDIBikeLight.java` — Light protobuf
- `com/garmin/proto/generated/GDIRadarProto.java` — Radar protobuf
- `com/garmin/proto/generated/GDIVaria.java` — Varia configuration

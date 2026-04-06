# iGPSPORT Light & Radar BLE Protocol

> Reverse-engineered from **iGPSPORT Ride APK** (jadx decompile, Session 13)
> Source: `igpsport_src/`
> Implementation: `iGPSportLightService.ts` + `AccessoryService.kt`

## BLE UUIDs

### Nordic UART Service (NUS) — User Control Channel
| Role | UUID |
|------|------|
| **Service** | `6E400001-B5A3-F393-E0A9-E50E24DCCA8E` |
| **TX** (write TO device) | `6E400003-B5A3-F393-E0A9-E50E24DCCA8E` |
| **RX** (notify FROM device) | `6E400002-B5A3-F393-E0A9-E50E24DCCA8E` |

4 NUS channels total (CA9E, CA8E, CA7E, CA6E) — CA8E is primary.

## Protocol: 20-Byte Header + Protobuf

### Header Structure (CommonHead20Bytes)
```
Byte [0]:     0x01 (firstCommand)
Byte [1]:     Service Type (106=light, 104=radar, 109=emoji)
Byte [2]:     Sub-Service (see below)
Byte [3]:     0xFF (reserved)
Byte [4]:     Operate Type (GET=2, SET=1, ADD=3, DEL=4)
Byte [5]:     Second Operate (0xFF default)
Byte [6]:     0xFF (reserved)
Byte [7-8]:   Protobuf data size (big-endian)
Byte [9]:     CRC8 of protobuf payload
Byte [10]:    0x01 (END_TYPE_PB = protobuf)
Byte [11-18]: 0xFF (reserved)
Byte [19]:    CRC8 of bytes [0..18]
```

### CRC8 Algorithm
```
for each byte b:
  crc ^= b
  for 8 bits:
    if (crc & 0x80): crc = ((crc << 1) ^ 0x07) & 0xFF
    else: crc = (crc << 1) & 0xFF
```

## Light Sub-Services

| Value | Name | Purpose |
|-------|------|---------|
| 0 | LIGHT_CFG | Light configuration |
| 1 | MODE_SUP | Supported modes list |
| 2 | MODE_CUR | Current mode (read/write) |
| 3 | CUSTOM_MODE | Custom mode config |
| 4 | SMT_CONFIG | Smart configuration |
| 5 | LEFT_TIME | Remaining battery time |
| 6 | BAT_PCT | Battery percentage |
| 7 | MODE_ENABLE | Enable/disable mode |
| 9 | RIDE_CFG | Ride configuration |

## Light Modes (21 total)

| ID | Mode | Description |
|----|------|-------------|
| 0 | OFF | Light off |
| 1 | HIGH_STEADY | Max brightness continuous |
| 2 | MID_STEADY | Medium continuous |
| 3 | LOW_STEADY | Low continuous |
| 4 | HIGH_BLINK | Fast high blink |
| 5 | LOW_BLINK | Slow low blink |
| 6 | GRADIENT | Fade in/out |
| 13 | ROTATION | Rotating pattern |
| 14 | LEFT_TURN | Left turn signal |
| 15 | RIGHT_TURN | Right turn signal |
| 16 | SUPER_HIGH | Maximum output |
| 17 | SOS | SOS emergency |
| 18 | COMET_FLASH | Comet trail |
| 19 | WATERFALL_FLASH | Waterfall pattern |
| 20 | PINWHEEL | Pinwheel pattern |
| 32-41 | SPECIAL_1-10 | Special modes |
| 64-75 | CUSTOMIZE_1-12 | Custom patterns |

## Radar Protocol

Service type: 104 (0x68)

### Target Message Fields
| Field # | Type | Meaning |
|---------|------|---------|
| 6 | varint | Threat level (0-3) |
| 7 | varint | Range in cm |
| 8 | varint | Speed in km/h |

### Smart Light Subtypes (BLCS)
| Value | Name |
|-------|------|
| 2 | BRAKE_LIGHT |
| 3 | AUTO_LIGHT |
| 7 | RADAR (sync with radar) |
| 12 | AUTO_TURN |
| 19 | STOP_FLASH |
| 21 | RADAR_WARN |

## Command Examples

### Read Current Mode
```
Header: 01 6A 02 FF 02 FF FF 00 06 [CRC] 01 FF×8 [CRC]
Proto:  field1=106, field2=2, field3=2
```

### Switch to HIGH_BLINK (mode 4)
```
Header: 01 6A 02 FF 01 FF FF 00 08 [CRC] 01 FF×8 [CRC]
Proto:  field1=106, field2=1, field3=2, field10=4
```

## Hardware
- **VS1800S** (E0:48:7B:80:86:C3) — Front light, NUS + Battery + DeviceInfo
- **LR60** — Rear light
- **CAD70** — Cadence sensor (separate, not NUS)

## Device Detection
```
NUS service UUID contains "DCCA8E"
Name starts with: "VS" (front), "LR" (rear), "CAD" (cadence)
```

## Key Source Files (decompiled)
- `blelib/device/BleInformation.java` — UUID definitions
- `blelib/bean/PeripheralLightApp.java` — Protobuf definitions
- `blelib/bean/PeripheralRadar.java` — Radar definitions
- `blelib/pbfactory/BaseHead20Bytes.java` — Header structure
- `blelib/pbfactory/CommonHead20Bytes.java` — Light-specific header
- `blelib/devicemanager/AccessoriesLight2Delegate.java` — Command building

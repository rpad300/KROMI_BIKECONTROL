# Giant GEV BLE Protocol — Complete Reverse-Engineering

## Packet Structure

### APP → SG (Write to 4D500002):
- **Byte[0] = 0xFB** (command marker)
- **Byte[1] = 0x21** (encrypted) or **0x22** (short/unencrypted)
- Bytes[2-17] = AES_ENCRYPT(plaintext, Key[keyIndex]) — for 0x21
- Byte[18] = keyIndex
- Byte[19] = XOR CRC of bytes[0-18]

### SG → APP (Notify on 4D500003):
- **Byte[0] = 0xFC** (response marker)
- **Byte[1] = 0x21** (encrypted), **0x22** (short), **0x23** (telemetry, plaintext)

### CRC = XOR of all preceding bytes

## Connection Sequence
1. Connect GATT → discover services → enable CCCD on 0x0003
2. **CONNECT_GEV**: `[FB, 21, AES(02 00 zeros, key0), 00, CRC]` → 20 bytes
3. Wait response: decrypt bytes[2:18] with key=response[18], verify [0]==02 && [2]==01
4. **enableRidingNotification**: `[FB, 22, 01, D8]` → 4 bytes
5. Telemetry starts: FC 23 packets every ~1 second

## Telemetry (FC 23, plaintext, 20 bytes)
| Offset | Size | Scale | Field |
|--------|------|-------|-------|
| 2-3 | int16 LE | /10 | speed (km/h) |
| 4-5 | int16 LE | /10 | torque (Nm) |
| 6-7 | int16 LE | /10 | cadence (RPM) |
| 8-9 | uint16 LE | /100 | accumulative current (Ah) |
| 10-11 | int16 LE | /10 | trip distance (km) |
| 12-13 | uint16 LE | raw | trip time (seconds) |
| 14-15 | int16 LE | /10 | power (W) |
| 16 | uint8 | raw | assist ratio (%) |
| 17 | uint8 | raw | battery SOC (%) |
| 18 | int8 | raw | error code |

## General Commands (Key in parentheses)
| Command | Plaintext[0] | Plaintext[1] | Key | Payload |
|---------|-------------|-------------|-----|---------|
| CONNECT_GEV | 0x02 | 0x00 | 0 | zeros |
| DISCONNECT_GEV | 0x21 | 0x00 | 0 | zeros |
| LIGHT | 0x1C | 0x03 | 3 | [08,00,00]+zeros |
| ASSIST_UP | 0x1C | 0x03 | 3 | [02,00,00]+zeros |
| ASSIST_DOWN | 0x1C | 0x03 | 3 | [01,00,00]+zeros |
| POWER_BTN | 0x1C | 0x03 | 3 | [00,08,00]+zeros |
| READ_TUNING | 0x2C | 0x00 | 0 | zeros |
| SET_TUNING | 0x2D | 0x03 | 3 | [lv1,lv2,lv3]+zeros |
| READ_RIDING | 0x1B | 0x00 | 0 | zeros |
| READ_FACTORY | 0x03 | 0x00 | 0 | zeros |
| DIAG_MOTOR | 0x16 | 0x00 | 0 | zeros |
| DIAG_BATTERY | 0x17 | 0x00 | 0 | zeros |
| DIAG_BUTTONS | 0x15 | 0x00 | 0 | zeros |

## Mode Commands (all key 1 except NORMAL)
| Mode | Plaintext[0] | Key | Payload[2] |
|------|-------------|-----|-----------|
| TUNING | 0x1A | 1 | 0x08 |
| FITNESS | 0x1A | 1 | 0x01 |
| NAVIGATION | 0x1A | 1 | 0x02 |
| SERVICE | 0x1A | 1 | 0x04 |
| UPDATE | 0x1A | 1 | 0x10 |
| NORMAL | 0xA0 | 0 | zeros |

## Battery Data (cmd=19/0x13, key 0)
| Offset | Field |
|--------|-------|
| 0 | battery % |
| 1 | battery life % |
| 2-3 | last full charge capacity (/10 Ah) |

## Range per mode (cmd=17/0x11, key 0)
Bytes 0-11 = eco, normal, power, boostPlus, boost, powerPlus, climbPlus, climb, normalPlus, tourPlus, tour, smart (km)

## Tuning Levels (packed nibbles)
```
lvByte1 = (mode1_lv+1) | ((mode2_lv+1) << 4)
lvByte2 = (mode3_lv+1) | ((mode4_lv+1) << 4)
lvByte3 = (mode5_lv+1)
```
Each level 0-2 (3 levels per mode, 5 modes)

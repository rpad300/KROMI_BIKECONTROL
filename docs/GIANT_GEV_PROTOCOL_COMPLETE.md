# Giant GEV BLE Protocol — Complete Reverse-Engineering

> Decompiled from RideControl v1.33.0.17 (com.GiantGroup.app.RideControl2)
> Validated on Giant Trance X E+ 2 (2023), SG 2.0 (GBHA25704)
> Last updated: 2026-04-01, builds b20-b24

## BLE Service

```
RIDECONTROL_SERVICE = 4D500001-4745-5630-3031-E50E24DCCA9E
WRITE              = 4D500002 (WRITE_TYPE_NO_RESPONSE)
NOTIFY             = 4D500003
```

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
1. Connect GATT (TRANSPORT_LE) → request MTU 247 → discover services
2. Enable CCCD on NOTIFY (disable → enable → confirm, like nRF pattern)
3. **CONNECT_GEV**: `[FB, 21, AES(02 00 zeros, key0), 00, CRC]` → 20 bytes
4. Wait response: decrypt bytes[2:18] with key=response[18], verify [0]==02 && [2]==01
5. **enableRidingNotification**: `[FB, 22, 01, D8]` → 4 bytes
6. FC23 telemetry starts flowing (~8 packets/sec, 4 sub-types cycling)

## FC23 Telemetry — Multi-Command Format (CONFIRMED b22-b24)

**IMPORTANT:** The SG wraps telemetry in sub-command framing:
```
[FC][23][len][cmd][payload...][CRC]
```
This is DIFFERENT from the RideControl decompiled format which expects raw telemetry at byte[2].

### cmd 0x40 — RIDE DATA ✅ CONFIRMED
| Byte(s) | Type | Scale | Field | Status |
|---------|------|-------|-------|--------|
| [4-5] | uint16 LE | /10 | **Speed (km/h)** | ✅ Confirmed via CSC correlation |
| [6-7] | int16 LE | raw | Acceleration/slope | TBD |
| [8-9] | uint16 LE | /10 | **Motor power (W)** | ✅ Calibrated from RideControl |
| [10-11] | uint16 LE | - | Always 0x0000 | - |
| [12-13] | uint16 LE | /10 | **ODO (km)** | ✅ ~2161 km, increments |
| [14-15] | uint16 LE | - | Static (0xB0 0x21) | HW ID? |
| [16-17] | uint16 LE | raw | Motor value (RPM?) | Varies with load |
| [18] | uint8 | raw | ~~Battery SOC~~  **NOT SOC** — always 0x64=100 (motor flag) | ⚠️ Do NOT use |
| [19] | uint8 | - | CRC (XOR bytes 0-18) | ✅ |

### cmd 0x41 — MOTOR/ASSIST STATE
**NOT ride telemetry.** Mostly static bytes with slow-changing values.
- bytes[5,7] change with motor activity
- byte[14] may be current assist level
- Do NOT parse as speed/torque/cadence

### cmd 0x42 — SENSOR DATA
All zeros when stationary. May contain cadence/rider power when pedaling with force.
Needs testing with significant pedal torque (>10 Nm).

### cmd 0x43 — DUAL BATTERY SOC ✅ CONFIRMED (session 3)
| Byte | Type | Field | Status |
|------|------|-------|--------|
| [4] | uint8 | **Battery 1 SOC (%)** | ✅ 0x60=96% (main 800Wh) |
| [5] | uint8 | **Battery 2 SOC (%)** | ✅ 0x60=96% (sub 250Wh) |
| [6-7] | - | 0x00 0x00 | - |
| [8] | uint8 | ~~SOC~~ **NOT reliable** — fluctuates ±15% | ⚠️ Do NOT use as SOC |
| [9] | uint8 | 0xA0 (constant) | Internal metric |
| [10-11] | - | 0x96 0x96 (constant) | Internal metric |
| [12-18] | - | zeros | - |
| [19] | uint8 | CRC | ✅ |

**Combined SOC = (bat1_soc × 800 + bat2_soc × 250) / 1050**

### GEV Active Data Commands (AES key 0, for battery details + range)

| Cmd | Name | Response | Field |
|-----|------|----------|-------|
| 17 (0x11) | RANGE_PER_MODE | payload[0-11] uint8 each | Range in km per assist mode (uint8, ≥245=overflow) |
| 13 (0x0D) | BAT_MAIN_FW | payload[0-14] | Main battery hardware + software version |
| 14 (0x0E) | BAT_MAIN_CYCLES | payload[2-3] LE | Main battery charge cycles |
| 19 (0x13) | BAT_MAIN_LEVEL | payload[2]=capacity%, [3]=health% | Main battery state |
| 55 (0x37) | BAT_SUB_LEVEL | payload[2]=capacity%, [3]=health% | Sub battery state |
| 56 (0x38) | BAT_SUB_FW | payload[0-14] | Sub battery firmware |
| 57 (0x39) | BAT_SUB_CYCLES | payload[2-3] LE | Sub battery charge cycles |

**Send format:** `[FB, 21, AES([0x21, cmd, zeros...], key0), 0x00, CRC]`
**Polled every 2min during ride for updated ranges.**

### Cmd 17 — RANGE_PER_MODE Byte Layout (confirmed via RideControl decompilation)

Each byte is uint8 (0-254 = km, ≥245 = overflow for high-range modes like ECO/TOUR).
RideControl (ba/g4.java:380) displays `∞` for values ≥255. Protocol has NO uint16 encoding.

| Offset | Giant Internal | KROMI Display | Notes |
|--------|---------------|---------------|-------|
| [0] | eco | ECO | Often overflows (>245km) |
| [1] | normal | — | Unused in 5-mode bikes |
| [2] | power | — | Raw power (different from power+) |
| [3] | boostPlus | — | |
| [4] | boost | — | |
| [5] | powerPlus | **POWER** | Confirmed: dec[7]=0xA6=166km |
| [6] | climbPlus | **SPORT** | Confirmed: dec[8]=0xCF=207km |
| [7] | climb | **ACTIVE** | Confirmed: dec[9]=0xD9=217km |
| [8] | normalPlus | — | |
| [9] | tourPlus | — | |
| [10] | tour | **TOUR** | Often overflows (>245km) |
| [11] | smart | SMART | |

**Overflow handling:** When byte ≥245, BLE bridge sends -1. PWA computes estimated range from `totalWh / calibrated_consumption_wh_km`. UI shows `~` prefix for estimated values.

## FC21 Encrypted Poll — readRidingData (cmd 0x1B)

Alternative to FC23 notifications. Sends encrypted command, receives 2 FC21 responses.

**Send:** `[FB, 21, AES(1B 00 zeros, key0), 00, CRC]`
**Receive:** 2× FC21 with cmd=0x1B, accumulate decrypted[2:16] (14 bytes each = 28 total)

**Parse accumulated 28 bytes (RideControl format):**
| Offset | Size | Scale | Field |
|--------|------|-------|-------|
| 0-1 | int16 LE | /10 | speed (km/h) |
| 2-3 | int16 LE | /10 | torque (Nm) |
| 4-5 | int16 LE | /10 | cadence (RPM) |
| 6-7 | uint16 LE | /100 | accumulative current (Ah) |
| 8-9 | int16 LE | /10 | trip distance (km) |
| 10-11 | uint16 LE | raw | trip time (seconds) |
| 12-13 | int16 LE | /10 | power (W) |
| 14 | uint8 | raw | assist ratio (%) |
| 15 | uint8 | raw | battery SOC (%) |
| 16 | int8 | raw | error code |

## General Commands (AES Encrypted, FB 21 format)

| Command | Plaintext[0] | Plaintext[1-2] | Key | Confirmed |
|---------|-------------|----------------|-----|-----------|
| CONNECT_GEV | 0x02 | 0x00, zeros | 0 | ✅ b18 |
| DISCONNECT_GEV | 0x21 | 0x00, zeros | 0 | - |
| ASSIST_UP | 0x1C | 0x03, 0x02 | 3 | ❌ SG blocks button simulation |
| ASSIST_DOWN | 0x1C | 0x03, 0x01 | 3 | ❌ SG blocks button simulation |
| LIGHT TOGGLE | 0x1C | 0x03, 0x08 | 3 | ❌ SG blocks button simulation |
| POWER_BTN | 0x1C | 0x03, 0x00 | 3 | - |
| READ_BATTERY | 0x13 | 0x00, zeros | 0 | ✅ b20 SOC+life |
| READ_TUNING | 0x2C | 0x00, zeros | 0 | ✅ b20 levels |
| SET_TUNING | 0x2D | 0x03, levels | 3 | ✅ b27-b28 MOTOR CONTROL! |
| READ_RIDING | 0x1B | 0x00, zeros | 0 | ❌ No response from SG |
| READ_FACTORY | 0x03 | 0x00, zeros | 0 | - |
| DIAG_MOTOR | 0x16 | 0x00, zeros | 0 | - |
| DIAG_BATTERY | 0x17 | 0x00, zeros | 0 | - |

## AES Key Usage (from decompiled code)
- **Key 0**: CONNECT, DISCONNECT, READ_BATTERY, READ_TUNING, READ_RIDING, diagnostics
- **Key 1**: Mode commands (TUNING, FITNESS, NAV, SERVICE, UPDATE)
- **Key 2**: Notifications (call/sms/mail), screen layout
- **Key 3**: Button commands (ASSIST UP/DOWN, LIGHT, POWER), SET_TUNING
- **Key 4**: Used in some responses
- **Key 8**: Navigation
- **Key 13**: Workout goal setup
- **Key 14**: Workout goal notify, frame number

## Mode Commands (all key 1 except NORMAL)
| Mode | Plaintext[0] | Key | Payload[2] |
|------|-------------|-----|-----------|
| TUNING | 0x1A | 1 | 0x08 |
| FITNESS | 0x1A | 1 | 0x01 |
| NAVIGATION | 0x1A | 1 | 0x02 |
| SERVICE | 0x1A | 1 | 0x04 |
| UPDATE | 0x1A | 1 | 0x10 |
| NORMAL | 0xA0 | 0 | zeros |

## Battery Data (cmd=0x13, key 0)
Response decrypted:
| Offset | Field |
|--------|-------|
| [2] | battery SOC % |
| [3] | battery life % |
| [4-5] | last full charge capacity (/10 Ah) |

## SET_TUNING — Dynamic Motor Control ✅ CONFIRMED (b27-b28)

**This is the primary mechanism for PWA motor control.**

### Command format
```
plaintext = [0x2D, 0x03, lvByte1, lvByte2, lvByte3, zeros×11]
AES encrypt with key 3
Packet: [FB, 21, AES(16), keyIdx=3, CRC] = 20 bytes

lvByte1 = (POWER_lv+1) | ((SPORT_lv+1) << 4)
lvByte2 = (ACTIVE_lv+1) | ((TOUR_lv+1) << 4)
lvByte3 = (ECO_lv+1)

Levels: 0=max power, 1=medium, 2=min power
On wire: stored as lv+1 (so 1=max, 2=med, 3=min)
```

### Response
```
FC21 decrypted: [2D, 01, 01, zeros] = SUCCESS
Verify with READ_TUNING (0x2C): echoes new values immediately
```

### Power values per mode (DU4 SyncDrive Sport)
| Mode | ASMO# | Level 0 (max) | Level 1 (med) | Level 2 (min) |
|------|-------|-------------|-------------|-------------|
| POWER | 1 | 300W | 300W | 250W |
| SPORT | 2 | 200W | 175W | 150W |
| ACTIVE | 3 | 150W | 125W | 100W |
| TOUR | 4 | 100W | 100W | 75W |
| ECO | 5 | 75W | 75W | 50W |

### Test results (b28)
```
MAX:     write(11 11 01) → RSP 2d0101 ✅ → READ: 11 11 01 ✅
MIN:     write(33 33 03) → RSP 2d0101 ✅ → READ: 33 33 03 ✅
RESTORE: write(33 22 02) → RSP 2d0101 ✅ → READ: 33 22 02 ✅
5/5 cycles: 100% success rate
```

### Key properties
- **No session required** — works immediately after BLE connect
- **No bonding required** — NOT_BONDED works fine
- **Instant effect** — motor applies new tuning on next pedal stroke
- **Persistent** — survives power cycle (write only what you need)

### PWA strategy
```
Fix bike in POWER mode → PWA sends SET_TUNING dynamically:
- Uphill: level 0 (max watts)
- Flat: level 1 (medium)
- Downhill: level 2 (min watts)
- Low battery: reduce all levels
```

## Tuning Byte Encoding (packed nibbles)
```
lvByte1 = (mode1_lv+1) | ((mode2_lv+1) << 4)
lvByte2 = (mode3_lv+1) | ((mode4_lv+1) << 4)
lvByte3 = (mode5_lv+1)
```
Original bike values: `33 22 02` → POWER=lv2, SPORT=lv2, ACTIVE=lv1, TOUR=lv1, ECO=lv1

## Bike Details
- **Model**: Giant Trance X E+ 2 (2023)
- **Motor**: Yamaha SyncDrive Sport (250W nominal, 80Nm max)
- **Smart Gateway**: SG 2.0 (FW: SG 1.0Y, HW: 202007000, SW: 20260205000)
- **BLE Name**: GBHA25704
- **MAC**: E9:1B:61:06:EB:6D
- **ODO**: ~2161 km
- **Battery**: Dual, both at 97% health, SOC 100%

## Build History (session 2026-04-01)
- b1-b17: Connection protocol development (20 builds, 12+ hours)
- **b18**: BREAKTHROUGH — correct 0xFB header + enableRiding → telemetry flows
- b19: Parser + AES decoder + PWA integration
- b20: **MOTOR UNLOCKED** — LE byte order fix, commands confirmed working
- b21-b22: FC23 diagnostic builds — raw byte logging
- **b23**: SPEED CONFIRMED — telemetry is in cmd 0x40, not 0x41
- **b24**: Calibrated motor watts, cmd 0x42 logging, FC21 poll, ASSIST/LIGHT buttons
- b25: Assist level tracking (byte[14] not assist), FC21 framing check
- b26: Auto-bond attempt + NORMAL_MODE (discovered it turns off bike!)
- **b27**: SET_TUNING CONFIRMED — key 3 writes to motor work!
- **b28**: Dynamic presets MAX/MIN/RESTORE — full tuning write+verify cycle

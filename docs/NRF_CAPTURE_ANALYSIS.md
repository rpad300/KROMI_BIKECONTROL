# nRF Connect Capture Analysis — Giant SG 2.0

## Packet Format Discovery

### Checksum = XOR (NOT sum!)
Verified: `FC 22 00 DE` → FC ^ 22 ^ 00 = DE ✅
Verified: `FC 23 0B 42 0000...0000 96` → FC^23^0B^42^00...00 = 96 ✅

### Format: [FC][device][len][cmd][payload][XOR_checksum]
- `len` = remaining bytes from cmd to end (inclusive of checksum)

### Three device IDs:
- `0x23` = Plaintext telemetry (SG → app)
- `0x22` = Heartbeat/keepalive (4 bytes: FC 22 00 DE)
- `0x21` = AES encrypted data (20 bytes: FC 21 + 16 AES + 2? or FC + 19)

## Telemetry Packets (device 0x23, plaintext, ~1/sec cycle)

### Cmd 0x40 — Riding Data (static when stopped)
```
FC 23 11 40 0000FBFF 00000000 6654AE21 0000 6453
```
- 17 bytes remaining after len
- Always identical when bike is stationary

### Cmd 0x41 — Live Telemetry (VARIES!)
```
FC 23 11 41 0091 0005 7008 9493 1B00 02XX 00YYA1ZZ
```
Varying bytes (across captures):
- Byte[14]: 22,1F,26,25,20,23,22,24,25,21,28,26,24,23,24,1F,20,21,22,21,24,22,23,24,25,22,23,21,22,24,23 → incrementing/cycling timestamp?
- Byte[16-17]: 87A179, 86A145, 87A17C, 88A171, etc. → changing checksum due to varying data

### Cmd 0x42 — Sensor Data (all zeros = stopped)
```
FC 23 0B 42 00000000000000000000000000 0096
```
- Always zeros when stationary (speed/cadence/torque?)

### Cmd 0x43 — Motor/Battery Status (varies slightly)
```
FC 23 0A 43 6261 0000 XXXX 9596 000000000000 00YY
```
Varying bytes:
- Bytes[8-9]: 71A0, 74A0, 76A0, 6FA0, 70A0, 73A0, etc. → voltage? temperature?

## Encrypted Packets (device 0x21, AES)

### Periodic encrypted (every ~5 cycles):
```
FC 21 51 67A2207E1789F77F98EFD189DD8407 0171  (appears ~3x)
```
- len=0x51? That's 81 bytes which doesn't match 17 remaining bytes
- OR: 51 is the cmd ID, not len!

Wait, re-analyzing: `FC 21 51 67 A220 7E17 89F7 7F98 EFD1 89DD 8407 01 71`
If format is [FC][device=21][len=13][cmd=51][16_bytes_AES_data][checksum]:
No, that's 20 bytes total. FC + device(1) + remaining(18) = 20.
So len = 0x12 = 18? No, byte 3 is 0x51.

Alternative format for device 0x21: [FC][21][cmd][16_AES_bytes][2_byte_sum_checksum]
FC 21 | 51 | 67A2207E1789F77F98EFD189DD8407 | 0171
- cmd = 0x51
- AES block = 67A2207E1789F77F98EFD189DD8407 (16 bytes)
- checksum = 0171

### Other encrypted:
```
FC 21 43 13517C76E3DD8BD3120F4B71E1C14D 01FB  ← cmd 0x43
FC 21 01 BE8E14689BF121B4A5AEC196C1155204B1  ← cmd 0x01 (CONNECT!)
FC 21 1D 662EBC8009DB3E23A82FB17CF7219E 047D  ← cmd 0x1D
FC 21 31 E22CEBE2DB7267ECAF2D4D762D9E73 0B7B  ← cmd 0x31
FC 21 59 85C9ED1AA561A123F7773B5BF8BC80 015C  ← cmd 0x59 (repeated)
FC 21 8C F63A968751F153B598FD164543FB06 0B49  ← cmd 0x8C
FC 21 BD 9FEB73915E5F9B0E7C8A9AE5738CE0 0BFF ← cmd 0xBD
FC 21 C6 70E964D24845C5C044DD2B255A04A5 0B5B ← cmd 0xC6
FC 21 B5 261F7691C4571142E66720B7AB09AD 0B64 ← cmd 0xB5
```

### Device 0x22 — Heartbeat
```
FC 22 00 DE  ← appears periodically, XOR checksum
```

## Critical Insight: Why We Don't Receive Spontaneous Data

The nRF capture shows the SG sends FC23 telemetry SPONTANEOUSLY after subscribing to NOTIFY. But our APK only gets `ba0000e224` when we write.

Possible reasons:
1. The SG might need the `FC 22 00 DE` heartbeat to maintain data flow
2. Our NOTIFY subscription might have a subtle bug
3. Bonding state might affect what the SG sends
4. The nRF capture might have been from a bonded session

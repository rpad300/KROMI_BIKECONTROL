# /ble — BLE Protocol Debugging

Bluetooth Low Energy debugging helper for KROMI BikeControl.

## Usage
- `/ble services` — list all BLE service UUIDs and their parsers
- `/ble protocol <name>` — show protocol details (gev, csc, power, sram, di2, hr)
- `/ble simulate` — check simulation mode status and available mock data
- `/ble debug` — show recent debug logs from `window.__dlog` (via Supabase debug_logs)
- `/ble trace <service>` — read the service implementation and trace data flow

## Protocol Reference
| Service | UUID | Parser |
|---------|------|--------|
| Battery | 0x180F | 1 byte (0-100%) |
| CSC | 0x1816 | CSCParser (wheel 2290mm) |
| Power | 0x1818 | PowerParser (int16 LE watts) |
| GEV Giant | F0BA3012 | GEVProtocol + GEVCrypto (AES) |
| SRAM AXS | 4D500001 | SRAMAXSService |
| Heart Rate | 0x180D | Standard HRM |
| Di2 E-Tube | 6e40fec1 | Di2Service |

## Key Files
- `src/services/bluetooth/GiantBLEService.ts` — main connection manager
- `src/services/bluetooth/GEVProtocol.ts` — Giant motor commands
- `src/services/bluetooth/GEVCrypto.ts` — AES encryption
- For full protocol specs: `giant_ebike_pwa_prompt.md`

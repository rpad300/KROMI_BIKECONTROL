# KROMI BikeControl — Status Report 2026-03-31

## Overview
PWA computador de bordo para Giant Trance X E+ 2 (2023) com Smart Gateway BLE.

## Architecture
```
PWA (kromi.online) ←→ BLE Bridge (Android APK) ←→ Giant Smart Gateway
                   WebSocket ws://localhost:8765
```

## Version: v0.5.0
- **Repo**: https://github.com/rpad300/KROMI_BIKECONTROL (public)
- **PWA**: https://www.kromi.online (Vercel)
- **APK**: https://github.com/rpad300/KROMI_BIKECONTROL/releases/tag/v0.5.0

## Features Implemented
### Dashboard
- Speed (hero), Power, Battery%, Range estimation, Cadence
- Assist mode buttons (ECO/TOUR/SPORT/PWR/AUTO/WALK) — local mode
- Trip stats (distance, time, calories, elevation, avg speed)
- Elevation profile mini-chart with gradient colors
- Conditional widgets: HR, Gear (Di2), Torque

### Connections (BLE)
- Giant Smart Gateway connect/disconnect
- Gateway services status: Battery, CSC, Power, GEV
- External sensor pairing: HR, Di2, SRAM AXS, Power Meter, TPMS Front/Rear
- Phone sensors: barometer, accelerometer, light, temperature
- Connection summary with BLE mode badge

### Climb Approach
- Elevation chart with gradient colors (green/yellow/orange/red)
- Interval breakdown with recommended assist mode
- Strategy card with battery impact estimation

### Ride History
- Monthly summary (rides, km, elevation)
- Ride cards with TSS, power, distance
- GPX export per ride (Garmin TrackPointExtension)

### Settings
- Rider profile, Auto-assist config
- Komoot route import
- Bike info (firmware/hardware/software versions, TPMS)
- Account management

### Other
- OTP authentication (Supabase + Resend)
- Adaptive brightness (night/normal/high-contrast from light sensor)
- BLE Bridge auto-launch via intent://kromi-bridge
- Install prompt for BLE Bridge APK

## Reverse Engineering (RideControl APK)
- 16 AES keys extracted (AES/ECB/NoPadding)
- 6 BLE service groups: GEV, Proto, TPMS, DFU, Device Info, SRAM
- GEV commands: motor modes, light toggle, phone notifications
- Protobuf protocol (app_menuProto.proto)
- Giant API endpoints: api.giant-hpb.com
- Komoot integration discovered
- Full docs: docs/GIANT_BLE_PROTOCOL.md, docs/APK_DEEP_ANALYSIS.md

## Open Problem
GEV/Proto services NOT accessible via BLE — Smart Gateway hides proprietary services from third-party apps. Neither Web Bluetooth nor native Android bonding unlocks them. RideControl somehow does it — needs deeper investigation.

## Tech Stack
| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite + TypeScript |
| Styling | Tailwind CSS v4 (dark-first) |
| State | Zustand (6 stores) |
| BLE (web) | Web Bluetooth API |
| BLE (native) | @capacitor-community/bluetooth-le |
| BLE (bridge) | Java-WebSocket + Android BLE |
| Maps | Google Maps JS API |
| Charts | Recharts |
| PWA | Vite PWA Plugin |
| Auth | Supabase Edge Functions + Resend |
| Deploy | Vercel (PWA) + GitHub Releases (APK) |

## Session Summary (2026-03-31)
1. Stitch UI designs: 8 screens created/iterated
2. React implementation: Dashboard, Climb, Connections, History, Settings
3. BLE fixes: namePrefix scan, HR/Di2 separate devices, proper bonding
4. APK reverse engineering: AES keys, protobuf, TPMS, GEV commands
5. Capacitor Android app created
6. BLE Bridge middleware: WebSocket server, phone sensors, auto-launch
7. Phone sensors: barometer, accelerometer, light, temperature
8. Adaptive brightness service
9. TPMS, Device Info, GPX Export, Komoot Import
10. Multiple Vercel deploys + GitHub releases (v0.3.0 → v0.5.0)

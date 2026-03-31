# CLAUDE.md — Project Context for Claude Code

## Project
KROMI BikeControl — PWA computador de bordo para Giant Trance X E+ 2 (2023) com Smart Gateway. Liga via Web Bluetooth ao motor, sensores e perifericos (FC, Di2, SRAM AXS). Inclui auto-assist inteligente baseado em elevacao, FC e gear, com aprendizagem adaptativa.

## Tech Stack
- **Framework**: React 18 + Vite + TypeScript (src/)
- **Styling**: Tailwind CSS (dark-first, vertical portrait, touch-friendly 64px buttons)
- **State**: Zustand (bikeStore, mapStore, autoAssistStore, settingsStore, torqueStore, athleteStore)
- **Maps**: Google Maps JavaScript API + Elevation API + Directions API
- **BLE**: Web Bluetooth API (Chrome Android only)
- **PWA**: Vite PWA Plugin + Service Worker + Wake Lock API
- **Charts**: Recharts (elevation profile)
- **Geolocation**: Navigator.geolocation API
- **Storage**: IndexedDB (ride data, athlete profile) + optional Supabase sync
- **Deploy**: Vercel or Netlify (HTTPS required for Web Bluetooth)

## Key Commands
```bash
# Dev (HTTPS required for Web Bluetooth)
npm run dev                    # dev server with HTTPS + LAN access

# Build
npm run build                  # production build
npm run preview                # preview production build

# Test
npm run test                   # run tests
npm run lint                   # lint check
npm run type-check             # TypeScript strict check

# Deploy
npm run build && netlify deploy --prod --dir=dist
```

## Project Structure
```
src/
  main.tsx                     # React entry + PWA registration + Wake Lock
  App.tsx                      # Root with providers + router
  components/
    Dashboard/                 # 6 widgets (Speed, Battery, Power, Assist, Elevation, AutoAssist)
    Map/                       # 3 components (MapView, RouteSearch, ElevationOverlay)
    Settings/                  # 3 screens (AutoAssist, Bluetooth, RiderProfile)
    shared/                    # BigButton, MetricCard, ConnectionStatus
  services/
    bluetooth/                 # 6 files (GiantBLE, GEVProtocol, GEVCrypto, CSCParser, PowerParser, SRAMAXSService)
    maps/                      # 3 files (GoogleMaps, Elevation, Navigation)
    autoAssist/                # 4 files (Engine, ElevationPredictor, BatteryOptimizer, RiderLearning)
    heartRate/                 # 2 files (HRZoneEngine, BiometricAssistEngine)
    di2/                       # 3 files (Di2Service, ShiftMotorInhibit, GearEfficiencyEngine)
    torque/                    # 2 files (TorqueEngine, GEVTorqueWriter)
    learning/                  # 3 files (RideDataCollector, AdaptiveLearningEngine, ProfileSyncService)
    storage/                   # 2 files (RideHistory, UserPreferences)
  store/                       # 6 Zustand stores
  hooks/                       # useBluetooth, useGeolocation, useElevationProfile, useAutoAssist
  types/                       # bike.types, elevation.types, gev.types, athlete.types
```

## BLE Services (5 protocols)
```
Battery     0x180F  — READ+NOTIFY, 1 byte (0-100%)
CSC         0x1816  — NOTIFY, 11 bytes (wheel+crank revolutions, wheel 2290mm)
Power       0x1818  — NOTIFY, 14 bytes (instantaneous watts int16 LE)
GEV Giant   F0BA3012 — AES encrypted proprietary (motor control, assist modes)
SRAM AXS    4D500001 — Flight Attendant suspension control
Heart Rate  0x180D  — NOTIFY, standard HRM (any Polar/Garmin/Wahoo)
Di2 E-Tube  6e40fec1 — gear position, shift events (requires EW-WU111)
```

## Modules (10)
```
M1  BLE Service         — connect Giant GBHA25704, subscribe all services
M2  Auto-Assist Engine  — elevation lookahead, pre-activation, override detection
M3  UI/UX Dashboard     — MTB-optimized (48-72px text, 64px buttons, dark theme)
M4  PWA Configuration   — fullscreen portrait, offline cache, wake lock
M7  Heart Rate          — HR zones, biometric assist, battery efficiency tracking
M8  Shimano Di2         — gear awareness, motor inhibit during shift, pre-shift advisory
M9  Real-Time Torque    — continuous torque/support/launch control by climb type
M10 AI Adaptive Learning — athlete profile, override learning, fatigue model, TSS
M11 Bike & Athlete Config — full bike specs, cassette, wheels, rider physiology
```

## Conventions
- CSS: Tailwind dark-first, min 24px text, 64px touch targets, portrait layout
- BLE: ALL subscriptions via GiantBLEService, NEVER direct navigator.bluetooth in components
- State: Zustand stores ONLY, NEVER React Context for real-time data
- GEV: ALL motor commands via GEVProtocol.buildCommand(), AES key as config placeholder
- Elevation: Cache 30s, throttle 3s, max 15 points per lookahead
- Auto-Assist: ALWAYS respect manual override (60s pause), smoothing window of 3 samples
- Override: Both Ergo 3 physical AND app button MUST pause auto-assist
- Torque: NEVER jump > 15Nm between updates, ALWAYS smooth with factor 0.3
- Di2: Motor inhibit to ECO (NOT OFF) during shift, resume after 250ms or gear confirm
- FC: 10s smoothing window, zones based on observed FCmax (NOT theoretical)
- Battery: Reduce torque progressively < 30%, emergency mode < 15%
- PWA: MUST request Wake Lock on mount, re-request on visibilitychange
- Simulation: VITE_SIMULATION_MODE=true for development without bike
- Deploy: HTTPS required (Web Bluetooth), Vercel or Netlify

## Blueprints & Skills (auto-discovery)

Este projecto tem blueprints e skills nas pastas do workspace.
Quando recebes um pedido, segue este processo:

1. Le o README em claude-code-skills/README.md para ver o indice completo
2. Identifica qual blueprint e skill sao relevantes para o pedido
3. Le o blueprint correspondente (claude-code-blueprint/*-BLUEPRINT.md)
4. Le a skill correspondente (claude-code-skills/NN-*.md)
5. Implementa seguindo AMBOS

Paths:
- Blueprints: claude-code-blueprint/*-BLUEPRINT.md
- Skills: claude-code-skills/NN-*.md
- Indice: claude-code-skills/README.md

NUNCA implementes um sistema sem primeiro ler o blueprint e skill correspondentes.
Se nao existe blueprint para o pedido, implementa com base nas convencoes deste CLAUDE.md.

## Memory & Obsidian
- Claude memory: .claude/projects/.../memory/MEMORY.md
- Project prompt: giant_ebike_pwa_prompt.md (full BLE protocol specs + algorithm details)
- For BLE protocol details → read giant_ebike_pwa_prompt.md sections on each service
- For algorithm logic → read giant_ebike_pwa_prompt.md modules 2, 7, 8, 9, 10

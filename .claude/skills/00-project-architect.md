# 00 — KROMI BikeControl Project Architect

> **Skill type:** Claude Code Skill  
> **Role:** Project Architect — defines structure, conventions, and global standards for the KROMI BikeControl PWA.  
> **Stack:** React 18 + Vite + TypeScript + Tailwind CSS + Zustand + Web Bluetooth + Supabase Edge Functions + Google Drive

---

## Role Definition

You are the **Project Architect** for KROMI BikeControl, a PWA bike computer for Giant Trance X E+ 2 (2023). Your responsibilities:

| Responsibility | Description |
|---|---|
| **CLAUDE.md** | Maintain the single source of truth — read by Claude every session |
| **Project structure** | Enforce the `src/` directory tree with components/, services/, store/, hooks/, types/ |
| **Tech stack** | Lock exact technologies — NEVER substitute without explicit approval |
| **Conventions** | Enforce normative rules (MUST/NEVER/ALWAYS) for BLE, state, REST, files |
| **Blueprint discovery** | Route implementation requests through claude-code-blueprint/ and claude-code-skills/ |
| **Environment** | Template all required env vars and secrets |

You MUST act before any other role. No code is written until the Architect has validated conventions.

---

## Tech Stack (Exact)

| Layer | Technology | Notes |
|---|---|---|
| Framework | **React 18** | Functional components + hooks ONLY, no class components |
| Build | **Vite** | Dev server with HTTPS (required for Web Bluetooth) + production bundler |
| Language | **TypeScript** (strict) | `tsconfig.json` with `"strict": true` |
| CSS | **Tailwind CSS** | Dark-first (`dark:bg-gray-900`), min 24px text, 64px touch targets, portrait-first |
| State | **Zustand** | 6 stores: bikeStore, mapStore, autoAssistStore, settingsStore, torqueStore, athleteStore |
| Maps | **Google Maps JS API** | + Elevation API + Directions API |
| BLE | **Web Bluetooth API** | Chrome Android only, via GiantBLEService abstraction |
| PWA | **Vite PWA Plugin** | Service Worker + Wake Lock API |
| Charts | **Recharts** | Elevation profile visualization |
| Storage | **IndexedDB** | Ride data + athlete profile + optional Supabase sync |
| Backend | **Supabase Edge Functions** | Deno runtime, NOT FastAPI |
| File Storage | **Google Drive** | Via `drive-storage` edge function, metadata in `kromi_files` table |
| Auth | **Custom HS256 JWT** | NOT Supabase Auth — `kromi_uid()` not `auth.uid()` |
| Deploy | **Vercel** (PWA) | HTTPS required for Web Bluetooth |

---

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
    bluetooth/                 # GiantBLE, GEVProtocol, GEVCrypto, CSCParser, PowerParser, SRAMAXSService
    maps/                      # GoogleMaps, Elevation, Navigation
    autoAssist/                # Engine, ElevationPredictor, BatteryOptimizer, RiderLearning
    heartRate/                 # HRZoneEngine, BiometricAssistEngine
    di2/                       # Di2Service, ShiftMotorInhibit, GearEfficiencyEngine
    torque/                    # TorqueEngine, GEVTorqueWriter
    learning/                  # RideDataCollector, AdaptiveLearningEngine, ProfileSyncService
    storage/                   # KromiFileStore (Google Drive), RideHistory, UserPreferences
      googleDrive/             # driveClient (HTTP client -> drive-storage edge fn)
  store/                       # 6 Zustand stores
  hooks/                       # useBluetooth, useGeolocation, useElevationProfile, useAutoAssist
  types/                       # bike.types, elevation.types, gev.types, athlete.types
  lib/
    supaFetch.ts               # MANDATORY REST wrapper — supaFetch, supaGet, supaRpc, supaInvokeFunction
  config/                      # App configuration constants
  utils/                       # Pure utility functions

supabase/
  functions/                   # Edge functions (Deno runtime)
    drive-storage/             # Google Drive file operations
    verify-otp/                # OTP verification + JWT minting
    verify-session/            # Session validation
    login-by-device/           # Device-based login

claude-code-blueprint/         # Implementation blueprints (*-BLUEPRINT.md)
claude-code-skills/            # Skill files (NN-*.md)
```

---

## Key Conventions (Normative)

### REST & Data Access
- **MUST** use `supaFetch` from `src/lib/supaFetch.ts` for ALL Supabase REST/RPC/edge function calls
- **NEVER** write raw `fetch(`${SB_URL}/rest/v1/...`)` — supaFetch injects the KROMI JWT so RLS works
- **MUST** use `kromi_uid()` in RLS policies, NEVER `auth.uid()`

### File Storage
- **MUST** use `KromiFileStore.uploadFile()` for ALL file uploads
- **NEVER** use Supabase Storage REST or direct Google Drive API
- Backend = Google Drive (`KROMI PLATFORM` folder) via `drive-storage` edge function
- Metadata = `kromi_files` table

### BLE
- **MUST** route ALL BLE operations through `GiantBLEService`
- **NEVER** call `navigator.bluetooth` directly in components
- **MUST** use `VITE_SIMULATION_MODE=true` for development without bike

### State
- **MUST** use Zustand stores for real-time data
- **NEVER** use React Context for real-time data (BLE readings, GPS, power, etc.)

### UI
- **MUST** use dark-first Tailwind (dark:bg-gray-900 as base)
- **MUST** ensure minimum 24px text, 64px touch targets, portrait layout
- **MUST** request Wake Lock on mount + re-request on visibilitychange

---

## Blueprint & Skill Discovery Flow

When receiving an implementation request:

```
1. Read claude-code-skills/README.md for the complete index
2. Identify which blueprint and skill are relevant
3. Read the blueprint: claude-code-blueprint/*-BLUEPRINT.md
4. Read the skill: claude-code-skills/NN-*.md
5. Implement following BOTH
```

**NEVER** implement a system without first checking for a matching blueprint and skill.

---

## Environment Variables Template

```bash
# Supabase
VITE_SUPABASE_URL=https://ctsuupvmmyjlrtjnxagv.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...                # Public anon key
KROMI_JWT_SECRET=...                          # MUST equal Supabase JWT Secret

# Google Maps
VITE_GOOGLE_MAPS_KEY=AIza...                  # Maps + Elevation + Directions APIs

# Development
VITE_SIMULATION_MODE=true                     # Enable BLE simulation (no physical bike)

# Google Drive (edge function secrets only)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
GOOGLE_DRIVE_ROOT_FOLDER_ID=1fjb2tKtZ14PaofV573ScoeZDra95ubua
```

---

## CLAUDE.md Maintenance Rules

- **MUST** be located at `{PROJECT_ROOT}/CLAUDE.md`
- **MUST** contain: Project, Tech Stack, Key Commands, Project Structure, BLE Services, Modules, Conventions, Auth + JWT, RBAC, File Storage sections
- **MUST** use normative language: MUST, NEVER, ALWAYS
- **MUST** be updated after every major session (new service, new store, new table, new convention)
- **MUST** include real counts (tables, services, stores) — not approximate
- **NEVER** exceed ~300 lines — it is context, NOT documentation

---

## Checklist Before Implementing

- [ ] Verified no existing blueprint/skill covers this request
- [ ] Confirmed tech stack compliance (no unauthorized dependencies)
- [ ] Validated file placement matches project structure
- [ ] REST calls use `supaFetch`, NOT raw fetch
- [ ] File uploads use `KromiFileStore.uploadFile()`
- [ ] BLE access goes through service layer, NOT navigator.bluetooth
- [ ] State uses Zustand stores, NOT React Context
- [ ] UI follows dark-first Tailwind + 64px touch targets
- [ ] RLS policies use `kromi_uid()`, NOT `auth.uid()`
- [ ] Environment variables documented if new ones added

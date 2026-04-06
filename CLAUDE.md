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
    storage/                   # KromiFileStore (unified file uploads → Google Drive)
      googleDrive/             # driveClient (HTTP client → drive-storage edge fn)
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
- **Files: ALL uploads via `KromiFileStore.uploadFile()` (src/services/storage/KromiFileStore.ts), NEVER direct Supabase Storage REST or Drive API. Backend = Google Drive (KROMI PLATFORM folder) via `drive-storage` Supabase Edge Function. Metadata = `kromi_files` table. Folder taxonomy lives in one place (`resolveFolderPath`).**
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

## RBAC + Super Admin

**Schema:** `permissions` (catalog), `roles`, `role_permissions`, `user_roles`, `user_feature_flags` (per-user overrides), `impersonation_log`. View `effective_user_permissions` computes the final set.

**Super admin:** `app_users.is_super_admin = true` bypasses all checks. Currently only `rdias300@gmail.com`.

**Frontend:**
- `usePermission(key)` — synchronous check, super admins always return true
- `useIsSuperAdmin()` — direct flag
- `useAuthStore.user` — the *viewer* (real user normally, impersonated user during admin impersonation)
- `useAuthStore.realUser` — always the actual logged-in user

**Admin panel:** Settings → Super Admin (visible only if `is_super_admin`). Tabs: Users, Roles, Drive, System.

**Impersonation:** super admin clicks "Entrar como" in user detail → `beginImpersonation(target)`. Banner shows persistent orange bar via `ImpersonationBanner` mounted at App root. Session token stays the admin's. Logged in `impersonation_log`.

**Adding permissions to a feature:**
```typescript
const canSeeShop = usePermission('features.shop_management');
if (!canSeeShop) return null;
```

To hide menu items by permission, wrap or filter. Core perms (`core.*`) are always granted and cannot be revoked.

## File Storage (Google Drive)

**Backend:** Google Drive folder `KROMI PLATFORM` (id `1fjb2tKtZ14PaofV573ScoeZDra95ubua`).
**Auth:** OAuth refresh token (acts as `rdias300@gmail.com`) — secrets in Supabase Edge Function only.
**Edge function:** `supabase/functions/drive-storage` — actions: `ping`, `ensureFolderPath`, `upload`, `delete`, `list`, `getFile`.
**Metadata:** `kromi_files` table (Supabase) — polymorphic `entity_type` + `entity_id` + `category`.

### Folder taxonomy (under KROMI PLATFORM)
```
users/{user-slug}/                          ← {user-slug} = slugify(email)
  bikes/{bike-slug}/photos/
  bikes/{bike-slug}/components/
  bikes/{bike-slug}/services/{service-id}/{before|after|damage|receipts}/
  bikefits/{bike-slug}/{YYYY-MM-DD}/
  activities/{YYYY-MM}/{ride-id}/
  routes/
  profile/
  other/{YYYY-MM}/

shops/{shop-slug}/                          ← shared (multiple users access one shop)
```

User folders are auto-created on first login by `useDriveBootstrap` (mounted in App.tsx). Top-level (`users/`, `shops/`) can be pre-created via Settings → Google Drive → "Inicializar estrutura".

### How to use
```typescript
import { uploadFile, slugify, userFolderSlug } from '../services/storage/KromiFileStore';
import { useAuthStore } from '../store/authStore';

const user = useAuthStore.getState().user!;
const file: File = ...;
const kromiFile = await uploadFile(file, {
  ownerUserId: user.id,
  ownerUserSlug: userFolderSlug(user),  // → users/{slug}/ prefix
  category: 'bike_photo',
  entityType: 'bike',
  entityId: bikeId,
  bikeSlug: slugify(bikeName),
  caption: 'Front view',
});
// kromiFile.drive_view_link / .drive_thumbnail_link
```

`ownerUserSlug` is **mandatory for personal categories** (everything except `shop_*`). Without it, files get dumped at root level — never do this. Use `userFolderSlug(user)` always.

Sub-folders within `users/{slug}/` (per-bike, per-service-id, etc.) are created lazily on first upload via `ensureFolderPath` in the edge function.

## Memory & Obsidian
- Claude memory: .claude/projects/.../memory/MEMORY.md
- Project prompt: giant_ebike_pwa_prompt.md (full BLE protocol specs + algorithm details)
- For BLE protocol details → read giant_ebike_pwa_prompt.md sections on each service
- For algorithm logic → read giant_ebike_pwa_prompt.md modules 2, 7, 8, 9, 10

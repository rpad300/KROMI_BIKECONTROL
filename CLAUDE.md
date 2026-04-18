# CLAUDE.md — Project Context for Claude Code

## Project
KROMI BikeControl — PWA computador de bordo para Giant Trance X E+ 2 (2023) com Smart Gateway. Liga via Web Bluetooth ao motor, sensores e perifericos (FC, Di2, SRAM AXS). Inclui auto-assist inteligente baseado em elevacao, FC e gear, com aprendizagem adaptativa.

## Tech Stack
- **Framework**: React 18 + Vite + TypeScript (src/)
- **Styling**: Tailwind CSS (dark-first, vertical portrait, touch-friendly 64px buttons)
- **State**: Zustand (21 stores — see Project Structure)
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
  config/navigation.ts         # Route/nav configuration
  lib/supaFetch.ts             # Supabase REST helper (KROMI JWT injection)
  utils/platform.ts            # Platform detection utilities

  components/                  # 15 directories
    Admin/                     # 7 files — Super Admin panel (Users, Roles, Drive, System)
    Auth/                      # 1 file  — Login / OTP flow
    Climb/                     # 1 file  — Climb detection overlay
    Connections/               # 2 files — BLE device manager + pairing
    Dashboard/                 # 27 files — Widgets (Speed, Battery, Power, Assist, Elevation, etc.)
    DashboardSystem/           # 12 files — Dashboard layout engine + widget registry
    Desktop/                   # 5 files — Desktop/landscape layout
    History/                   # 1 file  — Ride history viewer
    Import/                    # 1 file  — Data import UI
    LiveRide/                  # 1 file  — Live ride HUD
    Map/                       # 4 files — MapView, RouteSearch, ElevationOverlay
    ServiceBook/               # 5 files — Bike service/maintenance log
    Settings/                  # 10 files — AutoAssist, Bluetooth, RiderProfile, etc.
    Shop/                      # 1 file  — Shop/oficina management
    shared/                    # 11 files — BigButton, MetricCard, ConnectionStatus, etc.

  services/                    # 24 directories
    accessories/               # 3 files — Lights, radar, accessories
    auth/                      # 1 file  — Auth service
    autoAssist/                # 4 files — Engine, ElevationPredictor, BatteryOptimizer, RiderLearning
    battery/                   # 3 files — Battery monitoring + prediction
    bike/                      # 1 file  — Bike configuration
    bluetooth/                 # 19 files — GiantBLE, GEV, CSC, Power, SRAM, HRM, Di2, iGPSPORT, Varia
    di2/                       # 3 files — Di2Service, ShiftMotorInhibit, GearEfficiencyEngine
    export/                    # 1 file  — Data export (GPX, CSV)
    gdpr/                      # 1 file  — GDPR soft-delete + data export
    heartRate/                 # 2 files — HRZoneEngine, BiometricAssistEngine
    import/                    # 4 files — Data import services
    intelligence/              # 6 files — KromiCore intelligence engine
    learning/                  # 4 files — RideDataCollector, AdaptiveLearning, ProfileSync
    maintenance/               # 3 files — Component wear + service scheduling
    maps/                      # 5 files — GoogleMaps, Elevation, Navigation, Routing
    motor/                     # 2 files — Motor control + tuning
    rbac/                      # 1 file  — RBAC permission service
    routes/                    # 3 files — Route planning + GPX
    sensors/                   # 2 files — Sensor fusion + calibration
    simulation/                # 1 file  — Simulation mode for dev
    storage/                   # 5 files — KromiFileStore, Drive client, RideHistory
    sync/                      # 4 files — Cloud sync + Obsidian
    torque/                    # 2 files — TorqueEngine, GEVTorqueWriter
    weather/                   # 2 files — Weather service + wind model

  store/                       # 21 Zustand stores
    athleteStore, authStore, autoAssistStore, bikeStore, dashboardStore,
    deviceStore, driveStore, glanceStore, intelligenceStore, layoutStore,
    learningStore, mapStore, nutritionStore, permissionStore, routeStore,
    serviceStore, settingsStore, torqueStore, tripStore, tuningStore,
    widgetRegistry

  hooks/                       # 12 hooks
    useAmbientLight, useAutoAssist, useBluetooth, useDriveBootstrap,
    useElevationProfile, useGeolocation, useIsEBike, useMotorControl,
    usePermission, usePlatform, useReadOnlyGuard, useRouteNavigation

  types/                       # 8 type files
    athlete.types, bike.types, bikefit.types, elevation.types,
    gev.types, service.types, tuning.types, web-bluetooth.d.ts
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

## Modules (12)
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
M12 Intelligence Engine — KromiCore 7-layer intelligence, W'/physiology, gear ratio
M13 Service Book        — component wear tracking, maintenance scheduling
M14 Shop/Oficina        — workshop management, customer bikes, service orders
```

## Conventions
- CSS: Tailwind dark-first, min 24px text, 64px touch targets, portrait layout
- BLE: ALL subscriptions via GiantBLEService, NEVER direct navigator.bluetooth in components
- **REST: ALL Supabase REST/RPC/edge function calls MUST go through `src/lib/supaFetch.ts` (supaFetch, supaGet, supaRpc, supaInvokeFunction). NEVER write raw `fetch(`${SB_URL}/rest/v1/...`)` — the helper is what injects the KROMI JWT so RLS sees the user. Session 18 lockdown depends on this.**
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

## Custom Slash Commands
```
/status    — project build status, deploy state, Supabase dashboard
/deploy    — type-check → build → verify → Vercel deploy
/db        — Supabase operations (tables, migrate, rls, sql)
/ble       — BLE protocol debugging & tracing
/ride-sim  — simulation mode on/off/scenarios
/sync      — Obsidian vault & kromi-doc sync
```

## Skill Auto-Selection (OBRIGATORIO)

**PRIORIDADE:** Skills KROMI em `.claude/skills/` tem SEMPRE prioridade sobre as skills genericas em `claude-code-skills/`.

Antes de implementar QUALQUER pedido, o Claude DEVE selecionar e ler a skill relevante automaticamente.
Usa a tabela abaixo para mapear o pedido do utilizador a skill correcta.

### Routing Table — Palavras-chave → Skill

| Quando o pedido menciona... | Ler skill | Blueprint (se existir) |
|---|---|---|
| estrutura, projecto, convencoes, CLAUDE.md, setup | `.claude/skills/00-project-architect.md` | — |
| componente, pagina, UI, React, Tailwind, Zustand, store, widget, layout | `.claude/skills/01-frontend-react-engineer.md` | — |
| tabela, schema, migration, RLS, policy, SQL, Supabase, edge function | `.claude/skills/02-database-supabase-engineer.md` | — |
| auth, JWT, login, OTP, RBAC, permissao, role, impersonation, admin, GDPR | `.claude/skills/03-auth-security-specialist.md` | — |
| BLE, bluetooth, GEV, protocolo, connect, scan, service UUID, sensor | `.claude/skills/04-ble-protocol-engineer.md` | — |
| auto-assist, elevacao, lookahead, assist mode, override, ECO/TRAIL/SPORT | `.claude/skills/05-auto-assist-engine.md` | — |
| torque, motor, support, GEV command, launch control, 0xE3 | `.claude/skills/06-motor-torque-engineer.md` | — |
| heart rate, FC, HR, zona, biometrics, fadiga, W', TSS, FTP | `.claude/skills/07-heart-rate-biometrics.md` | — |
| Di2, Shimano, SRAM, AXS, gear, shift, cassette, mudanca | `.claude/skills/08-di2-sram-integration.md` | — |
| PWA, service worker, wake lock, offline, manifest, install, HTTPS | `.claude/skills/09-pwa-configuration.md` | — |
| ficheiro, upload, foto, Drive, storage, KromiFileStore, pasta | `.claude/skills/10-drive-storage-engineer.md` | — |
| ride, pedalada, learning, adaptativo, perfil atleta, IndexedDB | `.claude/skills/11-ride-data-learning.md` | — |
| dashboard, widget, speed, battery, power, cadence, elevation chart | `.claude/skills/12-dashboard-widgets.md` | — |
| deploy, Vercel, APK, build, CI, GitHub Actions, release, tag | `.claude/skills/13-devops-deploy.md` | — |
| documentacao, Obsidian, kromi-doc, sync, vault | `.claude/skills/14-documentation-obsidian.md` | — |
| fim sessao, session, CLAUDE.md update, memory, wrap-up | `.claude/skills/15-session-documentation.md` | — |
| reverse, APK, decompile, JADX, protocolo novo, sniff, nRF | `.claude/skills/16-reverse-engineering.md` | — |
| design, UI, cor, palette, tipografia, layout, brand, STEALTH-EV, mockup | `.claude/skills/17-design-system.md` | — |

### Processo (executar SEMPRE)

1. **Match** — Identifica 1-3 skills relevantes pela tabela acima
2. **Read** — Le as skills identificadas (e o blueprint se indicado)
3. **Implement** — Segue as convencoes da skill ao implementar
4. Se NENHUMA skill aplica, implementa com base nas convencoes deste CLAUDE.md

### Blueprints & Skills Genericas (legado)

Para sistemas transversais (email, webhooks, i18n, etc.) que nao sao especificos do KROMI BikeControl:
- Blueprints genericos: `claude-code-blueprint/*-BLUEPRINT.md`
- Skills genericas: `claude-code-skills/NN-*.md`
- Indice: `claude-code-skills/README.md`

Estas skills genericas sao referencia para padroes SaaS. As skills KROMI em `.claude/skills/` tem SEMPRE prioridade.

## Auth + JWT (Session 18)

KROMI uses custom HS256 JWTs for PostgREST — NOT Supabase Auth. The edge functions `verify-otp`, `verify-session`, and `login-by-device` mint JWTs signed with `KROMI_JWT_SECRET` (which must equal the project's Supabase JWT Secret). Claims: `{sub: app_users.id, role: "authenticated", aud: "authenticated"}`. PostgREST verifies them transparently; `public.kromi_uid()` exposes `sub` for RLS policies (NOT `auth.uid()` — that hits auth.users which KROMI doesn't use).

**Adding an RLS-gated table:**
```sql
ALTER TABLE t ENABLE ROW LEVEL SECURITY;
CREATE POLICY t_sel ON t FOR SELECT USING (user_id = public.kromi_uid() OR public.is_super_admin_jwt());
CREATE POLICY t_ins ON t FOR INSERT WITH CHECK (user_id = public.kromi_uid());
CREATE POLICY t_upd ON t FOR UPDATE USING (user_id = public.kromi_uid()) WITH CHECK (user_id = public.kromi_uid());
CREATE POLICY t_del ON t FOR DELETE USING (user_id = public.kromi_uid() OR public.is_super_admin_jwt());
```

**Frontend REST must use supaFetch** (`src/lib/supaFetch.ts`) — raw `fetch` to `/rest/v1/` goes out with the anon key and hits RLS as an anonymous user.

**Impersonation tab isolation:** Any new persisted Zustand store holding user data MUST detect `?as=` and swap to sessionStorage (see settingsStore pattern). Never use `storage: cond ? x : undefined` — zustand treats explicit undefined as "broken". Use spread instead: `...(cond ? { storage: createJSONStorage(() => sessionStorage) } : {})`.

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

# KROMI BikeControl — Project Rules

## Architecture Rules

1. **Zustand only** — No React Context for real-time data. All state via Zustand stores.
2. **supaFetch mandatory** — ALL Supabase REST/RPC calls via `src/lib/supaFetch.ts`. No raw fetch.
3. **KromiFileStore mandatory** — ALL file uploads via `KromiFileStore.uploadFile()`. Backend = Google Drive.
4. **BLE via service** — ALL Bluetooth access via `GiantBLEService`. No `navigator.bluetooth` in components.
5. **kromi_uid() not auth.uid()** — Custom JWT, not Supabase Auth.
6. **SECURITY DEFINER triggers** — RLS bypass only in trigger functions with explicit security.

## BLE Protocol Rules

- GEV commands: always via `GEVProtocol.buildCommand()`, AES encrypted
- CSC wheel circumference: 2290mm (Giant 29" x 2.4")
- Subscriptions: NOTIFY-based, never polling
- Simulation: `VITE_SIMULATION_MODE=true` for dev without bike

## Auto-Assist Rules

- ALWAYS respect manual override (60s pause timer)
- Both Ergo 3 physical button AND app button must pause auto-assist
- Smoothing window: 3 samples minimum
- Elevation: cache 30s, throttle 3s, max 15 points per lookahead

## Motor/Torque Rules

- NEVER jump > 15Nm between torque updates
- Smoothing factor: 0.3
- Di2 motor inhibit: ECO (not OFF) during shift, resume after 250ms
- Battery: reduce torque < 30%, emergency mode < 15%

## Heart Rate Rules

- 10s smoothing window
- Zones based on observed FCmax (NOT theoretical 220-age)

## UI/UX Rules

- Tailwind dark-first theme
- Minimum 24px text, 64px touch targets
- Portrait-first layout (MTB handlebar mount)
- PWA: Wake Lock on mount + re-request on visibilitychange

## RLS Policy Rules

1. Never self-reference in policy predicates (infinite recursion)
2. Always smoke-test with `set role authenticated; set request.jwt.claims`
3. Audit triggers before declaring ambiguous column names
4. Default deny-all, then whitelist
5. Step-up confirmation for destructive operations

## Impersonation Rules

- `?as=` tab isolation: persisted stores MUST detect and swap to sessionStorage
- Never `storage: undefined` — use spread pattern: `...(cond ? { storage: createJSONStorage(() => sessionStorage) } : {})`
- Impersonation banner: persistent orange bar via `ImpersonationBanner`

## Deploy Rules

- HTTPS required (Web Bluetooth)
- PWA push → Vercel
- APK: tag BEFORE build (version from git tags)
- kromi-doc: auto-syncs via git hooks, NEVER manually sync

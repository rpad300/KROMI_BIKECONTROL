# GPX Navigation — Design Spec

## Summary

World-class GPX navigation for KROMI BikeControl. Replaces the basic `NavDashboard` with a fullscreen satellite map + route overlay + comprehensive KPIs. Integrates all KROMI Intelligence features (W' balance, battery pacing, elevation lookahead, gear awareness).

## Architecture Overview

### Existing Infrastructure (reuse)

| Component | Location | Status |
|-----------|----------|--------|
| GPXParser | `src/services/routes/GPXParser.ts` | Complete — parses GPX 1.0/1.1 |
| RouteService | `src/services/routes/RouteService.ts` | Complete — CRUD Supabase |
| routeStore | `src/store/routeStore.ts` | Complete — activeRoute, navigation, preRideAnalysis |
| PreRideAnalysis | `src/services/routes/PreRideAnalysis.ts` | Complete — battery/nutrition/time estimates |
| MiniMap | `src/components/Dashboard/MiniMap.tsx` | Partial — needs GPX route overlay + gradient coloring |
| NavDashboard | `src/components/DashboardSystem/NavDashboard.tsx` | Replace — current version is minimal |
| DashboardController | `src/components/DashboardSystem/DashboardController.tsx` | Modify — auto-switch to NAV when route active |
| dashboardStore | `src/store/dashboardStore.ts` | Modify — add route-active auto-context |
| KromiCore (APK) | `ble-bridge-android/.../KromiCore.kt` | Partial — already accepts `route_remaining_km` |
| Google Directions API | `src/services/maps/` | Available — for re-routing |
| ElevationService | `src/services/maps/ElevationService.ts` | Complete — for route elevation data |

### New Components

| Component | Location | Purpose |
|-----------|----------|---------|
| RouteImportPage | `src/components/Settings/RouteImportPage.tsx` | GPX file picker + import flow |
| RouteListPage | `src/components/Settings/RouteListPage.tsx` | List saved routes, activate, delete |
| PreRideSummary | `src/components/Settings/PreRideSummary.tsx` | Pre-ride analysis display + "Iniciar Navegação" |
| NavDashboard (rewrite) | `src/components/DashboardSystem/NavDashboard.tsx` | Full navigation screen |
| ElevationMiniProfile | `src/components/Dashboard/ElevationMiniProfile.tsx` | SVG elevation profile with position marker |
| RouteMapOverlay | `src/components/Dashboard/RouteMapOverlay.tsx` | GPX line on Google Map + gradient coloring + POIs |
| NavigationEngine | `src/services/routes/NavigationEngine.ts` | Position tracking, deviation, re-routing |
| RoutePacingService | `src/services/routes/RoutePacingService.ts` | Battery pacing per route segment |

## User Flows

### Flow 1: Import GPX

```
Settings → Sistema → Rotas → "Importar GPX"
  → File picker (accept .gpx)
  → GPXParser.parseGPX(fileContent)
  → PreRideAnalysis (battery, nutrition, time, feasibility)
  → PreRideSummary screen:
      - Route name, distance, elevation gain/loss
      - Elevation profile preview
      - Battery feasibility (green/amber/red)
      - Estimated time, glycogen, hydration
      - Gradient-colored route preview on mini map
      - [Iniciar Navegação] or [Guardar para Depois]
  → RouteService.saveRoute() to Supabase
```

### Flow 2: Activate Saved Route

```
Settings → Sistema → Rotas → tap saved route
  → PreRideSummary (same as above, recalculated with current battery)
  → [Iniciar Navegação]
  → routeStore.setActiveRoute(route, points)
  → routeStore.startNavigation()
  → dashboardStore auto-switches to 'nav'
  → NavDashboard renders with full navigation
```

### Flow 3: Active Navigation (during ride)

```
NAV dashboard is auto-context when route active:
  - User swipes to other dashboard → 30s timeout → back to NAV
  - NavigationEngine updates position every GPS tick:
      - Nearest route point (snap to route)
      - Distance done / remaining
      - Progress percentage
      - Bearing to next point
      - Deviation from route (off-route detection)
  - RoutePacingService feeds KromiCore:
      - route_remaining_km for battery pacing
      - Adjust assist mode if battery won't reach end
  - Route completion:
      - Within 100m of last point → "Rota Completa!" toast
      - Stop navigation → return to cruise/climb/descent auto-context
```

### Flow 4: Re-routing (off-route)

```
NavigationEngine detects deviation > 50m:
  → Visual alert on map: "FORA DA ROTA — 120m"
  → Vibration (navigator.vibrate)
  → After 5s still off-route:
      → Google Directions API: current position → nearest route point ahead
      → Draw re-route path on map (orange dashed line)
      → Update distance remaining to include detour
  → When rider returns within 30m of route:
      → Clear re-route
      → Resume normal navigation
```

## NavDashboard Layout (Portrait, 70/30)

```
┌─────────────────────────────┐
│ PersistentBar (existing)    │
│ DashboardDots (NAV active)  │
│ TripControl (REC timer)     │
├─────────────────────────────┤
│                             │
│   SATELLITE MAP (70%)       │
│                             │
│ [MODE][GEAR]     [SPEED]    │  ← floating overlays
│                             │
│   ●━━━━━━━━╌╌╌╌╌╌╌╌╌╌→    │  ← GPX line (green done, white remaining)
│        ▲ current pos        │
│                             │
│ [⚠ FORA DA ROTA]           │  ← conditional off-route alert
│                             │
├─────────────────────────────┤
│ ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░        │  ← progress bar
│ 12.3 km feito  8.7 km falta│
├─────────────────────────────┤
│ ╱╲  ╱╲╱╲   ╱╲              │  ← elevation profile SVG
│╱  ╲╱    ╲╱╱  ╲╲            │     with position marker
│  485m alt    ▲680m gain     │
├─────────────────────────────┤
│ BAT    │ RANGE  │ ETA       │  ← KPI grid 3×2
│ 75%    │ 45 km  │ 0:32      │
│ POWER  │ HR     │ CADENCE   │
│ 185 W  │ 142bpm │ 72 rpm    │
├─────────────────────────────┤
│ W'[▓▓▓▓▓▓░░░]72%  ●VIÁVEL  │  ← intelligence footer
└─────────────────────────────┘
```

## Map Features

### GPX Route Line
- **Done segment**: solid `#3fff8b` (4px) — start to current position
- **Remaining segment**: gradient-colored by slope:
  - Green (`#3fff8b`): < 3% gradient
  - Yellow (`#fbbf24`): 3-8% gradient
  - Red (`#ff716c`): > 8% gradient
- **Rendering**: Google Maps `Polyline` with `strokeColor` per segment

### Points of Interest (auto-detected)
- **Summit** (highest point): mountain icon
- **Longest descent start**: downhill icon
- **Finish**: flag icon
- Rendered as Google Maps `Marker` with custom SVG icons

### Position Marker
- Outer glow circle (pulsing, 16px) + inner dot (8px) + direction arrow
- Color: `#3fff8b`
- Map auto-follows with 15° tilt for pseudo-3D satellite view

### Re-route Path
- Orange dashed line (`#ff9f43`, dashArray `[8,6]`)
- Appears when deviation > 50m for > 5 seconds
- Calculated via Google Directions API (mode: walking/bicycling)
- Cleared when rider returns within 30m of original route

### Dark Mode Adaptive
- Map brightness adjusts via CSS filter based on ambient light sensor
- < 50 lux: `filter: brightness(0.6)` — reduces glare at night
- 50-500 lux: normal
- > 500 lux: `filter: brightness(1.2) contrast(1.1)` — readable in direct sun

## Elevation Mini Profile

- SVG component, height 60px, full width
- Shows entire route elevation profile
- Position marker: vertical dashed line + dot at current position
- Labels: current altitude, max altitude, total elevation gain
- Fill gradient: green → transparent below the line

## KPI Grid

| Cell | Source | Color |
|------|--------|-------|
| BATTERY | `bikeStore.battery_percent` | Green >30%, amber >15%, red ≤15% |
| RANGE | `bikeStore.range_km` (weighted for KROMI mode) | Green if range > remaining, amber if tight, red if insufficient |
| ETA | Calculated: remaining_km / avg_speed_last_5min | Amber |
| POWER | `bikeStore.power_watts` | Blue |
| HR | `bikeStore.heart_rate` | Red (zone-colored via athlete zones) |
| CADENCE | `bikeStore.cadence_rpm` | Purple |

## Intelligence Footer

- **W' balance**: progress bar + percentage from `intelligenceStore`
- **Route feasibility**: real-time check — battery remaining vs estimated Wh for remaining route
  - Green "ROTA VIÁVEL" — battery sufficient
  - Amber "BATERIA JUSTA" — margin < 20%
  - Red "BATERIA INSUFICIENTE" — won't make it, suggest reducing assist

## Battery Pacing (RoutePacingService)

When route is active, continuously feeds KromiCore:
- `route_remaining_km` → KromiCore adjusts assist output
- If `battery_wh_remaining < estimated_wh_needed`:
  - Calculate deficit ratio
  - Suggest assist mode reduction via toast notification
  - If KROMI Intelligence active: auto-reduce torque target proportionally
- Budget thresholds (from existing KromiCore):
  - < 0.5 ratio: 40% assist
  - < 0.7 ratio: 60% assist
  - < 0.9 ratio: 80% assist
  - ≥ 0.9: 100% assist

## NavigationEngine

Core position tracking service:

```typescript
interface NavigationUpdate {
  currentIndex: number;        // nearest route point index
  distanceFromStart_m: number;
  distanceRemaining_m: number;
  deviationM: number;          // perpendicular distance from route
  bearingToNext: number;       // degrees
  progress_pct: number;        // 0-100
  currentGradient_pct: number; // gradient at current position
  nextGradient_pct: number;    // gradient 200m ahead
  eta_min: number;             // estimated time to finish
  isOffRoute: boolean;         // deviation > 50m
  offRouteDuration_s: number;  // how long off-route
  isComplete: boolean;         // within 100m of finish
}
```

- Runs on every GPS update (from `mapStore` subscription)
- Snaps position to nearest route point using haversine distance
- Calculates bearing for direction arrow
- Feeds `routeStore.updateNavigation()` reactively

## Dashboard Auto-Switch Logic

Modify `dashboardStore.processGradient()`:

```
if (routeStore.navigation.active) {
  autoContext = 'nav'  // NAV is the default when route active
} else {
  // existing gradient-based logic (cruise/climb/descent)
}
```

Manual override still works (30s timeout), then returns to NAV.

## Settings → Rotas Page

### Route List
- Card per route: name, distance, elevation gain, last ridden date
- Swipe left to delete
- Tap to open PreRideSummary
- Favorite toggle (star)

### Import Button
- "Importar GPX" button at top
- Uses `<input type="file" accept=".gpx">` — standard HTML file picker
- On select: read file → parseGPX → if valid → navigate to PreRideSummary

## Error Handling

| Scenario | Response |
|----------|----------|
| Invalid GPX file | Toast: "Ficheiro GPX inválido" + error detail |
| GPS lost during nav | Map freezes, "SEM GPS" badge, resume when GPS returns |
| Battery critical during route | Red alert banner: "Bateria crítica — X km falta" |
| Route complete | Green toast: "Rota Completa! 21.0 km em 1:24" |
| Off-route > 500m | Suggest cancelling navigation |
| Directions API fails | Skip re-route, just show deviation distance |

## Out of Scope

- Turn-by-turn voice navigation
- Route creation/drawing on map
- Live route sharing with other riders
- Offline map tiles (requires satellite tile caching)
- Komoot live sync (existing `KomootService` import is sufficient for now)

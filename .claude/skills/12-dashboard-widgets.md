# Skill 12 -- MTB Dashboard Widgets

## Role

You are a dashboard widget specialist for KROMI BikeControl. You build and
maintain the MTB-optimized dashboard: large-digit displays, dark theme,
touch-friendly controls, real-time BLE data, and portrait-first layout for
handlebar-mounted phones.

## Design Principles

1. **Outdoor visibility**: dark background, high-contrast text, no subtle grays.
2. **Glove-friendly**: all interactive elements minimum 64px touch target.
3. **Glanceable**: primary metric in 48-72px digits, secondary info smaller.
4. **Portrait-first**: phone mounted vertically on handlebars.
5. **Real-time**: Zustand selectors for sub-component re-renders only.
6. **Connection-aware**: visual indicator when BLE data is stale or disconnected.

## Widget Inventory

### 1. SpeedDisplay

```
Location: src/components/Dashboard/SpeedDisplay.tsx
Data:     bikeStore.speed, bikeStore.avgSpeed, bikeStore.maxSpeed
```

- Primary: current speed in 72px bold digits (km/h).
- Secondary row: avg / max speed in 24px.
- Color: white text on dark background.
- Updates every CSC notification (~1s).
- Shows "--" when no BLE connection.

### 2. BatteryWidget

```
Location: src/components/Dashboard/BatteryWidget.tsx
Data:     bikeStore.battery
```

- Visual: battery icon + percentage in 48px digits.
- Progressive color:
  - > 50%: green (#22c55e)
  - 30-50%: yellow (#eab308)
  - 15-30%: orange (#f97316)
  - < 15%: red (#ef4444) + pulse animation
- Emergency mode indicator when < 15%.
- Updates on BLE battery notification.

### 3. PowerCadenceWidget

```
Location: src/components/Dashboard/PowerCadenceWidget.tsx
Data:     bikeStore.power, bikeStore.cadence
```

- Two-column layout within the widget.
- Left: power in watts (48px digits).
- Right: cadence in RPM (48px digits).
- Cadence color by zone:
  - < 60 RPM: blue (grinding)
  - 60-80 RPM: green (optimal)
  - 80-100 RPM: yellow (spinning)
  - > 100 RPM: red (too fast)
- Power bar: horizontal fill proportional to FTP (from athleteStore).

### 4. AssistModeWidget

```
Location: src/components/Dashboard/AssistModeWidget.tsx
Data:     autoAssistStore.currentMode, autoAssistStore.isAutoActive
```

- Shows current assist mode: ECO / TRAIL / BOOST / TURBO / KROMI.
- Mode selector: 5 BigButton elements in a row (64px each).
- Active mode highlighted with brand color.
- Auto-assist indicator: "AUTO" badge when active, "MANUAL" when overridden.
- Override timer: shows countdown of 60s pause after manual override.
- Tap any mode button to override (triggers 60s auto-assist pause).

### 5. ElevationProfile

```
Location: src/components/Dashboard/ElevationProfile.tsx
Data:     mapStore.elevationData, mapStore.currentPosition
Library:  Recharts (AreaChart)
```

- Recharts AreaChart showing route elevation profile.
- Current position marker (vertical line or dot).
- Gradient color fill: green (flat) -> yellow (mild) -> red (steep).
- Lookahead window: shows next 500m of elevation.
- Touch: tap to see elevation at any point.
- Height: 120-150px (compact to save dashboard space).

### 6. AutoAssistWidget

```
Location: src/components/Dashboard/AutoAssistWidget.tsx
Data:     autoAssistStore.isAutoActive, autoAssistStore.nextPrediction
```

- Status indicator: "KROMI AI" with green/gray dot.
- Shows predicted next mode change: "BOOST em 200m" (upcoming climb).
- Manual override indicator with countdown timer.
- Compact: single row, fits below the assist mode selector.
- Tap to toggle auto-assist on/off.

### 7. HRWidget

```
Location: src/components/Dashboard/HRWidget.tsx
Data:     bikeStore.heartRate, athleteStore.profile.fcMax
```

- Heart icon with pulse animation when receiving data.
- BPM in 48px digits.
- Zone color band (based on observed FCmax, NOT 220-age):
  - Z1 (< 60% FCmax): gray
  - Z2 (60-70%): blue
  - Z3 (70-80%): green
  - Z4 (80-90%): yellow/orange
  - Z5 (> 90%): red
- 10-second smoothing window for zone display.
- Shows "--" with gray heart when HR monitor disconnected.

### 8. GearWidget

```
Location: src/components/Dashboard/GearWidget.tsx
Data:     bikeStore.gear, bikeStore.di2Connected
```

- Current gear number/ratio in 36px digits.
- Cassette position indicator (visual representation).
- Di2 connection status dot (green = connected).
- Shift suggestion from GearEfficiencyEngine (arrow up/down).
- Compact: fits in a small card.

### 9. TorqueWidget

```
Location: src/components/Dashboard/TorqueWidget.tsx
Data:     bikeStore.torque, bikeStore.supportLevel
```

- Horizontal torque bar: 0 to max Nm.
- Current torque value in 36px digits.
- Support level percentage.
- Color gradient: blue (low) -> green (mid) -> red (high torque).
- Torque smoothing: visual transitions with factor 0.3.
- Never jumps > 15Nm between visual updates.

## Layout

### CSS Grid (Portrait)

```
+---------------------------+
|      SpeedDisplay         |    row 1: full width, tallest
+---------------------------+
| Battery  | Power/Cadence  |    row 2: two columns
+---------------------------+
|     AssistModeWidget      |    row 3: full width (5 buttons)
+---------------------------+
|  AutoAssist  |  HR Widget |    row 4: two columns
+---------------------------+
|   Gear   |    Torque      |    row 5: two columns
+---------------------------+
|    ElevationProfile       |    row 6: full width, chart
+---------------------------+
```

### Tailwind Grid Classes

```tsx
<div className="grid grid-cols-2 gap-2 p-2 min-h-screen bg-black text-white">
  <div className="col-span-2">  {/* SpeedDisplay */}  </div>
  <div>                         {/* Battery */}        </div>
  <div>                         {/* PowerCadence */}   </div>
  <div className="col-span-2">  {/* AssistMode */}     </div>
  <div>                         {/* AutoAssist */}     </div>
  <div>                         {/* HR */}             </div>
  <div>                         {/* Gear */}           </div>
  <div>                         {/* Torque */}         </div>
  <div className="col-span-2">  {/* Elevation */}     </div>
</div>
```

## Shared Components

Location: `src/components/shared/`

### BigButton

```tsx
// 64px minimum touch target, rounded, dark theme
<BigButton
  label="BOOST"
  active={mode === 'BOOST'}
  onPress={() => setMode('BOOST')}
  color="amber"
/>
```

### MetricCard

```tsx
// Standard card wrapper for dashboard widgets
<MetricCard
  title="Power"
  icon={<ZapIcon />}
  connected={bikeStore.powerConnected}
>
  <span className="text-5xl font-bold">{power}</span>
  <span className="text-xl text-gray-400">W</span>
</MetricCard>
```

### ConnectionStatus

```tsx
// Green/red dot indicating BLE connection state
<ConnectionStatus connected={bikeStore.isConnected} label="Giant BLE" />
```

## Real-Time Data Flow

```
BLE Notification
  |
  v
GiantBLEService.onCharacteristicChanged()
  |
  v
bikeStore.setState({ speed: newSpeed })     <-- Zustand
  |
  v
Dashboard widget re-renders (selector)      <-- React
```

### Selector Pattern (Performance)

```tsx
// GOOD: only re-renders when speed changes
const speed = useBikeStore(state => state.speed);

// BAD: re-renders on ANY store change
const { speed } = useBikeStore();
```

Always use selectors to avoid unnecessary re-renders. Dashboard widgets
update at BLE notification frequency (1-4 Hz), so efficient selectors
are critical for battery life.

## Connection State Handling

Every widget must handle the disconnected state gracefully:

```tsx
const speed = useBikeStore(s => s.speed);
const connected = useBikeStore(s => s.isConnected);

return (
  <MetricCard title="Speed" connected={connected}>
    <span className="text-6xl font-bold">
      {connected ? speed.toFixed(1) : '--'}
    </span>
  </MetricCard>
);
```

## Simulation Mode

When `VITE_SIMULATION_MODE=true`, widgets receive simulated data from
the simulation service instead of real BLE. The widget code is identical --
only the data source changes (bikeStore is populated by simulation).

## Hard Rules

1. **Minimum 64px touch targets** for all interactive elements.
2. **Dark theme always** -- never light backgrounds on dashboard.
3. **48-72px for primary metrics** -- must be readable at arm's length.
4. **24px minimum for secondary text** -- no tiny labels.
5. **Zustand selectors** -- never destructure the entire store.
6. **Handle disconnected state** -- show "--" or gray, never stale data.
7. **Portrait layout** -- 2-column grid, never horizontal-first.
8. **Recharts for charts** -- never raw canvas or SVG for elevation.
9. **10s smoothing for HR zones** -- prevents flickering zone colors.
10. **Torque max jump 15Nm** -- smooth visual transitions.
11. **Override visual feedback** -- always show countdown timer.
12. **No React Context** -- Zustand stores only for real-time data.

## Adding a New Widget

1. Create component in `src/components/Dashboard/`.
2. Use `MetricCard` wrapper for consistent styling.
3. Subscribe to Zustand store with selector (not destructure).
4. Handle disconnected state (show "--").
5. Add to the grid layout in the parent Dashboard component.
6. Ensure 64px touch targets if interactive.
7. Test with simulation mode before real BLE testing.

## Key Files

```
src/components/Dashboard/
  SpeedDisplay.tsx
  BatteryWidget.tsx
  PowerCadenceWidget.tsx
  AssistModeWidget.tsx
  ElevationProfile.tsx
  AutoAssistWidget.tsx
  HRWidget.tsx
  GearWidget.tsx
  TorqueWidget.tsx

src/components/shared/
  BigButton.tsx
  MetricCard.tsx
  ConnectionStatus.tsx

src/store/
  bikeStore.ts                   -- live sensor data
  autoAssistStore.ts             -- auto-assist state
  mapStore.ts                    -- elevation + position
  athleteStore.ts                -- rider profile (FCmax, FTP)
```

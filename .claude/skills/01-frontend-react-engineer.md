# 01 — KROMI BikeControl Frontend React Engineer

> **Skill type:** Claude Code Skill  
> **Role:** Frontend Engineer — builds all UI components, pages, hooks, and state for the KROMI BikeControl PWA.  
> **Stack:** React 18 + Vite + TypeScript + Tailwind CSS (dark-first) + Zustand

---

## Role Definition

You are a **Senior Frontend Engineer** for KROMI BikeControl. You own the entire UI surface: dashboard widgets, map views, settings screens, shared components, Zustand stores, and custom hooks. Every decision prioritizes MTB riding conditions: glanceable data, massive touch targets, dark theme for sunlight readability, and portrait-only layout.

---

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | **React 18** | Functional components + hooks ONLY, no class components |
| Language | **TypeScript 5+** | Strict mode, no `any` except BLE raw buffers |
| Bundler | **Vite** | HTTPS dev server (required for Web Bluetooth) |
| Styling | **Tailwind CSS** | Dark-first, portrait, min 24px text, 64px touch targets |
| State | **Zustand** | 6 stores — NEVER React Context for real-time data |
| Charts | **Recharts** | Elevation profile, power graphs |
| Maps | **Google Maps JS API** | MapView component with elevation overlay |
| PWA | **Vite PWA Plugin** | Service Worker + Wake Lock API |
| Icons | **Lucide React** or inline SVG | Consistent icon set |

---

## Component Structure

```
src/components/
  Dashboard/
    SpeedWidget.tsx            # Current speed (km/h), large font
    BatteryWidget.tsx          # Battery %, bar + estimated range
    PowerWidget.tsx            # Instantaneous watts, avg watts
    AssistWidget.tsx           # Current assist mode (OFF/ECO/TRAIL/ACTIVE/SPORT/POWER/KROMI)
    ElevationWidget.tsx        # Current elevation + gradient %
    AutoAssistWidget.tsx       # Auto-assist status, next prediction
  Map/
    MapView.tsx                # Google Maps with route + position
    RouteSearch.tsx            # Search/load routes
    ElevationOverlay.tsx       # Elevation profile chart overlay
  Settings/
    AutoAssistSettings.tsx     # Auto-assist configuration
    BluetoothSettings.tsx      # BLE device management
    RiderProfile.tsx           # Rider physiology + bike specs
  shared/
    BigButton.tsx              # 64px minimum touch target, dark bg
    MetricCard.tsx             # Reusable metric display (value + unit + label)
    ConnectionStatus.tsx       # BLE connection indicator
```

### Naming Conventions

| Item | Convention | Example |
|---|---|---|
| Components | `PascalCase.tsx` | `SpeedWidget.tsx`, `BigButton.tsx` |
| Hooks | `camelCase.ts` with `use` prefix | `useBluetooth.ts`, `useAutoAssist.ts` |
| Stores | `camelCase.ts` with `Store` suffix | `bikeStore.ts`, `mapStore.ts` |
| Types | `camelCase.types.ts` | `bike.types.ts`, `elevation.types.ts` |
| Utils | `camelCase.ts` | `formatSpeed.ts`, `slugify.ts` |

---

## Tailwind CSS Dark-First Theme

KROMI uses dark-first design. The default state is dark; light mode is the exception.

```tsx
// CORRECT: dark-first (dark is the base, light overrides)
<div className="bg-gray-900 text-white light:bg-white light:text-gray-900">

// ALSO CORRECT: standard Tailwind dark variant
<div className="bg-white dark:bg-gray-900 text-gray-900 dark:text-white">

// MTB-optimized sizing
<span className="text-5xl font-bold">  {/* Speed: huge, glanceable */}
<span className="text-2xl">            {/* Secondary metrics */}
<span className="text-base">           {/* Labels — minimum 24px */}

// Touch targets — ALWAYS 64px minimum
<button className="min-h-[64px] min-w-[64px] p-4 rounded-xl">
```

### Color Palette

| Purpose | Class |
|---|---|
| Background | `bg-gray-900` / `bg-gray-800` |
| Surface / card | `bg-gray-800` / `bg-gray-700` |
| Primary text | `text-white` |
| Secondary text | `text-gray-400` |
| Accent / active | `text-emerald-400` / `bg-emerald-500` |
| Warning | `text-amber-400` / `bg-amber-500` |
| Danger / error | `text-red-400` / `bg-red-500` |
| Battery low | `text-red-500` (< 15%), `text-amber-400` (< 30%) |

---

## Zustand Stores

KROMI uses 6 Zustand stores. NEVER use React Context for real-time data.

```typescript
// src/store/bikeStore.ts — BLE readings + connection state
import { create } from 'zustand';

interface BikeState {
  connected: boolean;
  speed: number;          // km/h
  cadence: number;        // RPM
  power: number;          // watts
  battery: number;        // 0-100
  assistMode: AssistMode; // OFF|ECO|TRAIL|ACTIVE|SPORT|POWER|KROMI
  heartRate: number;      // BPM
  gear: number;           // Di2 current gear
  // actions
  setSpeed: (v: number) => void;
  setBattery: (v: number) => void;
  setConnected: (v: boolean) => void;
  // ... etc
}

export const useBikeStore = create<BikeState>((set) => ({
  connected: false,
  speed: 0,
  cadence: 0,
  power: 0,
  battery: 100,
  assistMode: 'ECO',
  heartRate: 0,
  gear: 1,
  setSpeed: (speed) => set({ speed }),
  setBattery: (battery) => set({ battery }),
  setConnected: (connected) => set({ connected }),
}));
```

### Store List

| Store | Purpose | Key State |
|---|---|---|
| `bikeStore` | BLE readings + connection | speed, power, battery, assistMode, gear, HR |
| `mapStore` | GPS + route + elevation | position, route, elevation, gradient |
| `autoAssistStore` | Auto-assist engine state | active, prediction, override, lastMode |
| `settingsStore` | User preferences | units, thresholds, profiles |
| `torqueStore` | Torque engine state | currentTorque, targetTorque, smoothedTorque |
| `athleteStore` | Rider profile + learning | weight, FTP, zones, fatigueModel, TSS |

### Selector Pattern (Re-render Optimization)

```typescript
// CORRECT: subscribe to individual fields
const speed = useBikeStore((s) => s.speed);
const battery = useBikeStore((s) => s.battery);

// WRONG: subscribes to entire store — re-renders on ANY change
const store = useBikeStore();
```

---

## Component Patterns

### Dashboard Widget

```tsx
import { useBikeStore } from '../../store/bikeStore';

export function SpeedWidget() {
  const speed = useBikeStore((s) => s.speed);

  return (
    <div className="bg-gray-800 rounded-2xl p-4 flex flex-col items-center justify-center">
      <span className="text-gray-400 text-sm uppercase tracking-wider">Speed</span>
      <span className="text-6xl font-bold text-white tabular-nums">
        {speed.toFixed(1)}
      </span>
      <span className="text-gray-500 text-lg">km/h</span>
    </div>
  );
}
```

### MetricCard (Reusable)

```tsx
interface MetricCardProps {
  label: string;
  value: string | number;
  unit: string;
  color?: string; // Tailwind text color class
}

export function MetricCard({ label, value, unit, color = 'text-white' }: MetricCardProps) {
  return (
    <div className="bg-gray-800 rounded-xl p-3 flex flex-col items-center">
      <span className="text-gray-400 text-xs uppercase">{label}</span>
      <span className={`text-3xl font-bold tabular-nums ${color}`}>{value}</span>
      <span className="text-gray-500 text-sm">{unit}</span>
    </div>
  );
}
```

### BigButton

```tsx
interface BigButtonProps {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'danger' | 'ghost';
  disabled?: boolean;
}

export function BigButton({ label, onClick, variant = 'primary', disabled }: BigButtonProps) {
  const base = 'min-h-[64px] min-w-[64px] rounded-xl font-bold text-lg px-6 py-4 transition-colors';
  const variants = {
    primary: 'bg-emerald-600 text-white active:bg-emerald-700',
    danger: 'bg-red-600 text-white active:bg-red-700',
    ghost: 'bg-gray-700 text-gray-300 active:bg-gray-600',
  };

  return (
    <button
      className={`${base} ${variants[variant]} ${disabled ? 'opacity-50' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  );
}
```

---

## BLE Data in Components

NEVER call `navigator.bluetooth` in components. ALWAYS read from Zustand stores populated by services.

```typescript
// CORRECT: component reads store, service writes to store
const power = useBikeStore((s) => s.power);

// WRONG: component directly accessing BLE
const char = await device.gatt.connect(); // NEVER in a component
```

---

## Impersonation: Tab Isolation

When `?as=` query param is present (super admin impersonating a user), persisted Zustand stores MUST swap to `sessionStorage`:

```typescript
import { createJSONStorage } from 'zustand/middleware';

const isImpersonating = new URLSearchParams(window.location.search).has('as');

export const useSettingsStore = create(
  persist(
    (set) => ({ /* ... */ }),
    {
      name: 'kromi-settings',
      // Swap storage when impersonating — NEVER use `storage: undefined`
      ...(isImpersonating
        ? { storage: createJSONStorage(() => sessionStorage) }
        : {}),
    },
  ),
);
```

---

## PWA Requirements

```typescript
// Wake Lock — MUST request on mount + re-request on visibilitychange
useEffect(() => {
  let wakeLock: WakeLockSentinel | null = null;

  const requestWakeLock = async () => {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch (e) {
      console.warn('Wake Lock failed:', e);
    }
  };

  requestWakeLock();

  const onVisChange = () => {
    if (document.visibilityState === 'visible') requestWakeLock();
  };
  document.addEventListener('visibilitychange', onVisChange);

  return () => {
    wakeLock?.release();
    document.removeEventListener('visibilitychange', onVisChange);
  };
}, []);
```

---

## Checklist Before Submitting UI Code

- [ ] Dark-first Tailwind — `bg-gray-900` base, white text
- [ ] All touch targets >= 64px (`min-h-[64px]`)
- [ ] All text >= 24px for labels, >= 48px for primary metrics
- [ ] Zustand selectors for individual fields (no full-store subscriptions)
- [ ] No `navigator.bluetooth` in components
- [ ] No React Context for real-time BLE/GPS/power data
- [ ] Portrait-first layout (no landscape assumptions)
- [ ] `tabular-nums` on numeric displays for stable width
- [ ] Wake Lock requested on mount
- [ ] Impersonation storage swap handled if store is persisted

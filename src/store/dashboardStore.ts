import { create } from 'zustand';

export type DashboardId = 'cruise' | 'climb' | 'descent' | 'data' | 'map' | 'nav';
export type AutoContext = 'cruise' | 'climb' | 'descent' | 'nav';

interface DashboardState {
  /** Currently displayed dashboard */
  active: DashboardId;
  /** What auto-switch would pick based on terrain (or 'nav' when route active) */
  autoContext: AutoContext;
  /** Manual override active (user swiped) */
  manualOverride: boolean;
  manualOverrideAt: number;
  /** True while a GPX route navigation session is active */
  routeActive: boolean;

  // Debounce counters (consecutive terrain readings)
  _climbCount: number;
  _descentCount: number;
  _cruiseCount: number;

  // Actions
  manualSwitch: (d: DashboardId) => void;
  processGradient: (gradient: number) => void;
  tick: () => void;
  setRouteActive: (v: boolean) => void;
}

const CLIMB_THRESHOLD = 3;    // >= 3% = climb
const DESCENT_THRESHOLD = -4; // < -4% = descent
const ENTRY_DEBOUNCE = 3;     // 3 consecutive readings to enter
const CLIMB_EXIT_DEBOUNCE = 5; // 5 readings to exit climb (rolling terrain protection)
const MANUAL_TIMEOUT_MS = 30_000; // 30s manual override

export const useDashboardStore = create<DashboardState>()((set, get) => ({
  active: 'cruise',
  autoContext: 'cruise',
  manualOverride: false,
  manualOverrideAt: 0,
  routeActive: false,
  _climbCount: 0,
  _descentCount: 0,
  _cruiseCount: 0,

  manualSwitch: (d) => set({
    active: d,
    manualOverride: true,
    manualOverrideAt: Date.now(),
  }),

  setRouteActive: (v) => {
    if (v) {
      set({ routeActive: true, autoContext: 'nav', active: 'nav', manualOverride: false });
    } else {
      set({ routeActive: false, autoContext: 'cruise', active: 'cruise' });
    }
  },

  processGradient: (gradient) => {
    const s = get();
    // Skip gradient logic while a GPX route is active — nav context takes priority
    if (s.routeActive) return;

    let cc = s._climbCount;
    let dc = s._descentCount;
    let fc = s._cruiseCount;

    // Increment the right counter, reset others
    if (gradient >= CLIMB_THRESHOLD) {
      cc++; dc = 0; fc = 0;
    } else if (gradient < DESCENT_THRESHOLD) {
      dc++; cc = 0; fc = 0;
    } else {
      fc++; cc = 0; dc = 0;
    }

    // Determine new auto context
    let newCtx = s.autoContext;
    if (cc >= ENTRY_DEBOUNCE && s.autoContext !== 'climb') {
      newCtx = 'climb';
    } else if (dc >= ENTRY_DEBOUNCE && s.autoContext !== 'descent') {
      newCtx = 'descent';
    } else if (s.autoContext === 'climb' && fc >= CLIMB_EXIT_DEBOUNCE) {
      newCtx = 'cruise';
    } else if (s.autoContext === 'descent' && fc >= ENTRY_DEBOUNCE) {
      newCtx = 'cruise';
    }

    const update: Partial<DashboardState> = {
      _climbCount: cc,
      _descentCount: dc,
      _cruiseCount: fc,
      autoContext: newCtx,
    };

    // Auto-switch dashboard if no manual override
    if (!s.manualOverride && newCtx !== s.autoContext) {
      update.active = newCtx;
    }

    set(update);
  },

  tick: () => {
    const s = get();
    if (s.manualOverride && Date.now() - s.manualOverrideAt > MANUAL_TIMEOUT_MS) {
      // Manual override expired — return to nav if route active, otherwise terrain auto context
      const returnTo: DashboardId = s.routeActive ? 'nav' : s.autoContext as DashboardId;
      set({
        manualOverride: false,
        active: returnTo,
      });
    }
  },
}));

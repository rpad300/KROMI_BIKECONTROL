import { create } from 'zustand';

export type DashboardId = 'cruise' | 'climb' | 'descent' | 'data' | 'map';
export type AutoContext = 'cruise' | 'climb' | 'descent';

interface DashboardState {
  /** Currently displayed dashboard */
  active: DashboardId;
  /** What auto-switch would pick based on terrain */
  autoContext: AutoContext;
  /** Manual override active (user swiped) */
  manualOverride: boolean;
  manualOverrideAt: number;

  // Debounce counters (consecutive terrain readings)
  _climbCount: number;
  _descentCount: number;
  _cruiseCount: number;

  // Actions
  manualSwitch: (d: DashboardId) => void;
  processGradient: (gradient: number) => void;
  tick: () => void;
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
  _climbCount: 0,
  _descentCount: 0,
  _cruiseCount: 0,

  manualSwitch: (d) => set({
    active: d,
    manualOverride: true,
    manualOverrideAt: Date.now(),
  }),

  processGradient: (gradient) => {
    const s = get();
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
      // Manual override expired — return to auto context
      set({
        manualOverride: false,
        active: s.autoContext,
      });
    }
  },
}));

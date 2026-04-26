import { create } from 'zustand';

// Lazy import to avoid circular dependency (glanceStore ↔ tripStore)
let _tripStore: typeof import('./tripStore') | null = null;
function getTripStore() {
  if (!_tripStore) { import('./tripStore').then(m => { _tripStore = m; }); }
  return _tripStore;
}

interface GlanceState {
  enabled: boolean;
  idleTimeoutS: number;
  idleCounterS: number;
  isGlanceActive: boolean;

  tick: () => void;
  resetIdle: () => void;
  setEnabled: (v: boolean) => void;
  setIdleTimeout: (s: number) => void;
}

export const useGlanceStore = create<GlanceState>()((set, get) => ({
  enabled: true,
  idleTimeoutS: 8,
  idleCounterS: 0,
  isGlanceActive: false,

  tick: () => {
    const s = get();
    if (!s.enabled) return;

    const tripMod = getTripStore();
    const tripState = tripMod?.useTripStore.getState().state;

    // During active or paused ride: NEVER activate glance
    // Rider has hands on handlebars — glance is only for idle/parked between rides
    if (tripState === 'running' || tripState === 'paused') {
      if (s.idleCounterS !== 0 || s.isGlanceActive) {
        set({ idleCounterS: 0, isGlanceActive: false });
      }
      return;
    }

    // No active ride (idle/finished) — count idle time for glance activation
    const next = s.idleCounterS + 1;
    set({
      idleCounterS: next,
      isGlanceActive: next >= s.idleTimeoutS,
    });
  },

  resetIdle: () => set({ idleCounterS: 0, isGlanceActive: false }),
  setEnabled: (v) => set({ enabled: v }),
  setIdleTimeout: (s) => set({ idleTimeoutS: s }),
}));

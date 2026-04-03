import { create } from 'zustand';

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

    // Only tick during active ride
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useTripStore } = require('./tripStore') as typeof import('./tripStore');
    if (useTripStore.getState().state !== 'running') {
      if (s.idleCounterS !== 0 || s.isGlanceActive) {
        set({ idleCounterS: 0, isGlanceActive: false });
      }
      return;
    }

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

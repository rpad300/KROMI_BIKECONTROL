import { create } from 'zustand';
import type { AssistDecision, TerrainAnalysis, ElevationPoint } from '../types/elevation.types';

interface NextModeChange {
  position_percent: number; // 0-100, position on the elevation chart
  mode: string;
}

interface AutoAssistState {
  enabled: boolean;
  lastDecision: AssistDecision | null;
  terrain: TerrainAnalysis | null;
  elevationProfile: ElevationPoint[];
  nextModeChange: NextModeChange | null;
  overrideActive: boolean;
  overrideRemaining: number; // seconds

  setEnabled: (v: boolean) => void;
  setLastDecision: (d: AssistDecision) => void;
  setTerrain: (t: TerrainAnalysis) => void;
  setOverride: (active: boolean, remaining: number) => void;
}

export const useAutoAssistStore = create<AutoAssistState>((set) => ({
  enabled: false,
  lastDecision: null,
  terrain: null,
  elevationProfile: [],
  nextModeChange: null,
  overrideActive: false,
  overrideRemaining: 0,

  setEnabled: (v) => set({ enabled: v }),

  setLastDecision: (d) => set({ lastDecision: d }),

  setTerrain: (t) => {
    // Calculate next mode change position for the elevation chart marker
    let nextModeChange: NextModeChange | null = null;
    if (t.next_transition && t.profile.length > 0) {
      const totalDist = t.profile[t.profile.length - 1]!.distance_from_current;
      if (totalDist > 0) {
        nextModeChange = {
          position_percent: (t.next_transition.distance_m / totalDist) * 100,
          mode: ['OFF', 'ECO', 'TOUR', 'SPORT', 'PWR'][t.next_transition.target_mode] ?? '?',
        };
      }
    }

    set({
      terrain: t,
      elevationProfile: t.profile,
      nextModeChange,
    });
  },

  setOverride: (active, remaining) => set({ overrideActive: active, overrideRemaining: remaining }),
}));

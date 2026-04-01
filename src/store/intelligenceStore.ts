import { create } from 'zustand';
import type { TuningDecision, TuningFactor } from '../services/motor/TuningIntelligence';

interface IntelligenceState {
  /** Current score (0-100) */
  score: number;
  /** Current tuning level (1=MAX, 2=MID, 3=MIN) */
  level: 1 | 2 | 3;
  /** Factor breakdown for UI */
  factors: TuningFactor[];
  /** Pre-emptive alert (null if none) */
  preemptive: string | null;
  /** Whether KROMI is actively controlling */
  active: boolean;
  /** Last update timestamp */
  lastUpdateMs: number;

  setDecision: (d: TuningDecision) => void;
  setActive: (v: boolean) => void;
  reset: () => void;
}

export const useIntelligenceStore = create<IntelligenceState>((set) => ({
  score: 50,
  level: 2,
  factors: [],
  preemptive: null,
  active: false,
  lastUpdateMs: 0,

  setDecision: (d) => set({
    score: d.score,
    level: d.level,
    factors: d.factors,
    preemptive: d.preemptive,
    lastUpdateMs: Date.now(),
  }),

  setActive: (v) => set({ active: v }),

  reset: () => set({
    score: 50,
    level: 2,
    factors: [],
    preemptive: null,
    active: false,
    lastUpdateMs: 0,
  }),
}));

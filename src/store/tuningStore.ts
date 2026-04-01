import { create } from 'zustand';

/** Tuning level per assist mode (wire values 1-3, display 1-3) */
export interface TuningLevels {
  power: number;   // 1-3
  sport: number;   // 1-3
  active: number;  // 1-3
  tour: number;    // 1-3
  eco: number;     // 1-3
}

export type TuningMode = keyof TuningLevels;

export const TUNING_MODES: TuningMode[] = ['power', 'sport', 'active', 'tour', 'eco'];

export const TUNING_MODE_LABELS: Record<TuningMode, string> = {
  power: 'PWR',
  sport: 'SPORT',
  active: 'ACTIVE',
  tour: 'TOUR',
  eco: 'ECO',
};

export const TUNING_MODE_COLORS: Record<TuningMode, string> = {
  power: 'bg-red-600',
  sport: 'bg-yellow-600',
  active: 'bg-orange-500',
  tour: 'bg-blue-600',
  eco: 'bg-green-600',
};

const DEFAULT_TUNING: TuningLevels = { power: 2, sport: 2, active: 2, tour: 2, eco: 2 };

interface TuningState {
  /** Current tuning levels on the motor */
  current: TuningLevels;
  /** Original tuning read on connect — used for restore */
  original: TuningLevels | null;
  /** Whether we've read tuning from motor at least once */
  hasRead: boolean;
  /** Last tuning operation status */
  lastStatus: 'idle' | 'reading' | 'writing' | 'success' | 'error';
  /** Timestamp of last successful read/write */
  lastUpdateMs: number;

  // Actions
  setCurrent: (levels: TuningLevels) => void;
  setOriginal: (levels: TuningLevels) => void;
  setLevel: (mode: TuningMode, level: number) => void;
  setStatus: (status: TuningState['lastStatus']) => void;
  reset: () => void;
}

export const useTuningStore = create<TuningState>((set) => ({
  current: { ...DEFAULT_TUNING },
  original: null,
  hasRead: false,
  lastStatus: 'idle',
  lastUpdateMs: 0,

  setCurrent: (levels) => set({
    current: { ...levels },
    hasRead: true,
    lastStatus: 'success',
    lastUpdateMs: Date.now(),
  }),

  setOriginal: (levels) => set({ original: { ...levels } }),

  setLevel: (mode, level) => set((state) => ({
    current: { ...state.current, [mode]: Math.max(1, Math.min(3, level)) },
  })),

  setStatus: (status) => set({ lastStatus: status }),

  reset: () => set({
    current: { ...DEFAULT_TUNING },
    original: null,
    hasRead: false,
    lastStatus: 'idle',
    lastUpdateMs: 0,
  }),
}));

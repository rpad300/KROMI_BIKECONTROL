/**
 * LearningStore — persisted adaptive learning state.
 *
 * Stores context-based score adjustments learned from rider overrides.
 * Context key = gradient bucket + HR zone (e.g., "climb_steep:z2")
 * Each entry tracks how much to adjust the KROMI score for that context.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** A learned adjustment for a specific riding context */
export interface ContextAdjustment {
  /** Score adjustment to apply (-30 to +30) */
  score_delta: number;
  /** Number of override samples that informed this */
  sample_count: number;
  /** Confidence 0-1 (min 5 samples for full confidence) */
  confidence: number;
  /** Last updated ISO timestamp */
  updated_at: string;
}

/** Gradient bucket names */
export type GradientBucket = 'descent_steep' | 'descent' | 'flat' | 'climb_mild' | 'climb_moderate' | 'climb_steep';

/** Get gradient bucket from gradient percentage */
export function getGradientBucket(gradient: number): GradientBucket {
  if (gradient < -8) return 'descent_steep';
  if (gradient < -2) return 'descent';
  if (gradient <= 3) return 'flat';
  if (gradient <= 6) return 'climb_mild';
  if (gradient <= 10) return 'climb_moderate';
  return 'climb_steep';
}

/** Build context key from gradient + HR zone */
export function getContextKey(gradient: number, hrZone: number): string {
  return `${getGradientBucket(gradient)}:z${hrZone}`;
}

interface LearningState {
  /** Context-based score adjustments learned from overrides */
  adjustments: Record<string, ContextAdjustment>;

  /** Global override stats */
  total_overrides: number;
  total_rides_learned: number;

  /** Record an override: rider wanted more or less assist in this context */
  recordOverride: (gradient: number, hrZone: number, direction: 'more' | 'less') => void;

  /** Get the learned score adjustment for a context (0 if no data) */
  getAdjustment: (gradient: number, hrZone: number) => number;

  /** Process a batch of overrides from a completed ride */
  learnFromRide: (overrides: Array<{ gradient: number; hrZone: number; direction: 'more' | 'less' }>) => void;

  /** Reset all learned data */
  resetLearning: () => void;
}

const LEARNING_RATE = 0.15;     // How fast to adjust per override
const MAX_ADJUSTMENT = 30;      // Maximum score delta
const CONFIDENCE_SAMPLES = 5;   // Samples needed for full confidence

export const useLearningStore = create<LearningState>()(
  persist(
    (set, get) => ({
      adjustments: {},
      total_overrides: 0,
      total_rides_learned: 0,

      recordOverride: (gradient, hrZone, direction) => {
        const key = getContextKey(gradient, hrZone);
        const state = get();
        const existing = state.adjustments[key];
        const delta = direction === 'more' ? LEARNING_RATE * MAX_ADJUSTMENT : -LEARNING_RATE * MAX_ADJUSTMENT;

        const current = existing?.score_delta ?? 0;
        const samples = (existing?.sample_count ?? 0) + 1;
        const newDelta = Math.max(-MAX_ADJUSTMENT, Math.min(MAX_ADJUSTMENT, current + delta));

        set({
          adjustments: {
            ...state.adjustments,
            [key]: {
              score_delta: Math.round(newDelta * 10) / 10,
              sample_count: samples,
              confidence: Math.min(1.0, samples / CONFIDENCE_SAMPLES),
              updated_at: new Date().toISOString(),
            },
          },
          total_overrides: state.total_overrides + 1,
        });
      },

      getAdjustment: (gradient, hrZone) => {
        const key = getContextKey(gradient, hrZone);
        const adj = get().adjustments[key];
        if (!adj) return 0;
        // Apply adjustment weighted by confidence
        return Math.round(adj.score_delta * adj.confidence);
      },

      learnFromRide: (overrides) => {
        for (const o of overrides) {
          get().recordOverride(o.gradient, o.hrZone, o.direction);
        }
        set((s) => ({ total_rides_learned: s.total_rides_learned + 1 }));
      },

      resetLearning: () => set({
        adjustments: {},
        total_overrides: 0,
        total_rides_learned: 0,
      }),
    }),
    { name: 'bikecontrol-learning' }
  )
);

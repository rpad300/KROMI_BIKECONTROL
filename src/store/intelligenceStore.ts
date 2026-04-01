import { create } from 'zustand';
import type { TuningDecision, TuningFactor } from '../services/motor/TuningIntelligence';
import type { AsmoCalibration } from '../types/tuning.types';

interface IntelligenceState {
  intensity: number;
  supportIntensity: number;
  torqueIntensity: number;
  launchIntensity: number;
  calibration: AsmoCalibration;
  actual: { support: number; torque: number; midTorque: number; lowTorque: number; launch: number };
  factors: TuningFactor[];
  preemptive: string | null;
  active: boolean;
  lastUpdateMs: number;

  setDecision: (d: TuningDecision) => void;
  setActive: (v: boolean) => void;
  reset: () => void;
}

export const useIntelligenceStore = create<IntelligenceState>((set) => ({
  intensity: 50,
  supportIntensity: 50,
  torqueIntensity: 50,
  launchIntensity: 50,
  calibration: { support: 1, torque: 1, midTorque: 1, lowTorque: 1, launch: 1 },
  actual: { support: 350, torque: 250, midTorque: 200, lowTorque: 150, launch: 75 },
  factors: [],
  preemptive: null,
  active: false,
  lastUpdateMs: 0,

  setDecision: (d) => set({
    intensity: d.intensity,
    supportIntensity: d.supportIntensity,
    torqueIntensity: d.torqueIntensity,
    launchIntensity: d.launchIntensity,
    calibration: d.calibration,
    actual: d.actual,
    factors: d.factors,
    preemptive: d.preemptive,
    lastUpdateMs: Date.now(),
  }),

  setActive: (v) => set({ active: v }),
  reset: () => set({
    intensity: 50, supportIntensity: 50, torqueIntensity: 50, launchIntensity: 50,
    calibration: { support: 1, torque: 1, midTorque: 1, lowTorque: 1, launch: 1 },
    actual: { support: 350, torque: 250, midTorque: 200, lowTorque: 150, launch: 75 },
    factors: [], preemptive: null, active: false, lastUpdateMs: 0,
  }),
}));

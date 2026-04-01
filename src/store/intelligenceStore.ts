import { create } from 'zustand';
import type { TuningDecision, TuningFactor } from '../services/motor/TuningIntelligence';

interface IntelligenceState {
  /** Continuous intensity 0-100% */
  intensity: number;
  /** Wire value sent to motor (0=max, 1=mid, 2=min) */
  wireValue: 0 | 1 | 2;
  /** Display label */
  label: 'MAX' | 'MID' | 'MIN';
  /** Factor breakdown */
  factors: TuningFactor[];
  /** Pre-emptive alert */
  preemptive: string | null;
  /** Motor specs at current calibration */
  motorAssistPct: number;
  motorTorqueNm: number;
  motorConsumptionWhKm: number;
  /** Active state */
  active: boolean;
  lastUpdateMs: number;

  setDecision: (d: TuningDecision) => void;
  setActive: (v: boolean) => void;
  reset: () => void;
}

export const useIntelligenceStore = create<IntelligenceState>((set) => ({
  intensity: 50,
  wireValue: 1,
  label: 'MID',
  factors: [],
  preemptive: null,
  motorAssistPct: 240,
  motorTorqueNm: 65,
  motorConsumptionWhKm: 28,
  active: false,
  lastUpdateMs: 0,

  setDecision: (d) => set({
    intensity: d.intensity,
    wireValue: d.wireValue,
    label: d.label,
    factors: d.factors,
    preemptive: d.preemptive,
    motorAssistPct: d.motorAssistPct,
    motorTorqueNm: d.motorTorqueNm,
    motorConsumptionWhKm: d.motorConsumptionWhKm,
    lastUpdateMs: Date.now(),
  }),

  setActive: (v) => set({ active: v }),

  reset: () => set({
    intensity: 50, wireValue: 1, label: 'MID', factors: [], preemptive: null,
    motorAssistPct: 240, motorTorqueNm: 65, motorConsumptionWhKm: 28,
    active: false, lastUpdateMs: 0,
  }),
}));

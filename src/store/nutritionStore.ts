import { create } from 'zustand';
import type { NutritionState } from '../services/intelligence/NutritionEngine';
import type { PhysiologyOutput } from '../services/intelligence/PhysiologyEngine';

interface NutritionStoreState {
  /** Latest nutrition state from KromiEngine tick */
  state: NutritionState | null;
  /** Latest physiology state (W' balance, HR zone, drift) */
  physiology: PhysiologyOutput | null;
  /** Whether an alert is currently showing (for dismiss) */
  alertVisible: boolean;

  setState: (s: NutritionState) => void;
  setPhysiology: (p: PhysiologyOutput) => void;
  setAlertVisible: (v: boolean) => void;
  reset: () => void;
}

export const useNutritionStore = create<NutritionStoreState>((set) => ({
  state: null,
  physiology: null,
  alertVisible: false,

  setState: (s) => set({
    state: s,
    // Auto-show alert when there are new alerts
    alertVisible: s.alerts.length > 0,
  }),
  setPhysiology: (p) => set({ physiology: p }),
  setAlertVisible: (v) => set({ alertVisible: v }),
  reset: () => set({ state: null, physiology: null, alertVisible: false }),
}));

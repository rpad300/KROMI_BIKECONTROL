import { create } from 'zustand';
import { ClimbType, type TorqueCommand } from '../services/torque/TorqueEngine';
import type { GearAdvisory } from '../services/di2/GearEfficiencyEngine';

interface TorqueState {
  torque_nm: number;
  support_pct: number;
  launch_value: number;
  climb_type: ClimbType;
  reason: string;
  gearAdvisory: GearAdvisory | null;

  setLastCommand: (cmd: TorqueCommand) => void;
  setGearAdvisory: (adv: GearAdvisory | null) => void;
}

export const useTorqueStore = create<TorqueState>((set) => ({
  torque_nm: 0,
  support_pct: 0,
  launch_value: 0,
  climb_type: ClimbType.FLAT,
  reason: '',
  gearAdvisory: null,

  setLastCommand: (cmd) =>
    set({
      torque_nm: cmd.torque_nm,
      support_pct: cmd.support_pct,
      launch_value: cmd.launch_value,
      climb_type: cmd.climb_type,
      reason: cmd.reason,
    }),

  setGearAdvisory: (adv) => set({ gearAdvisory: adv }),
}));

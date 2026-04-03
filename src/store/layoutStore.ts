import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_LAYOUTS } from './widgetRegistry';
import type { DashboardId } from './dashboardStore';

interface LayoutStore {
  /** Custom layouts per dashboard: { cruise: ['speed_hero', 'metric_grid_4', ...], ... } */
  layouts: Record<string, string[]>;
  /** Whether user has customized (vs defaults) */
  isCustomized: (dashboardId: string) => boolean;
  /** Get layout for a dashboard (custom or default) */
  getLayout: (dashboardId: string) => string[];
  /** Set custom layout */
  setLayout: (dashboardId: DashboardId, widgetIds: string[]) => void;
  /** Reset a dashboard to defaults */
  resetLayout: (dashboardId: DashboardId) => void;
  /** Reset all to defaults */
  resetAll: () => void;
}

export const useLayoutStore = create<LayoutStore>()(
  persist(
    (set, get) => ({
      layouts: {},

      isCustomized: (id) => !!get().layouts[id],

      getLayout: (id) => get().layouts[id] ?? DEFAULT_LAYOUTS[id] ?? [],

      setLayout: (id, widgetIds) => set((s) => ({
        layouts: { ...s.layouts, [id]: widgetIds },
      })),

      resetLayout: (id) => set((s) => {
        const next = { ...s.layouts };
        delete next[id];
        return { layouts: next };
      }),

      resetAll: () => set({ layouts: {} }),
    }),
    { name: 'bikecontrol-layouts' }
  )
);

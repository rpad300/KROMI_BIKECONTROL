/**
 * routeStore — Zustand store for route planning and active ride route.
 *
 * State:
 *   - savedRoutes: list from Supabase (lightweight, no points)
 *   - activeRoute: the currently loaded route (with full points for navigation)
 *   - preRideAnalysis: battery/nutrition/time estimates for active route
 *   - navigationState: real-time position on route during ride
 */

import { create } from 'zustand';
import type { SavedRoute } from '../services/routes/RouteService';
import type { RoutePoint } from '../services/routes/GPXParser';

export interface PreRideAnalysis {
  feasible: boolean;             // Can battery handle this route?
  total_wh: number;              // Estimated motor Wh needed
  battery_remaining_wh: number;  // Available battery Wh
  battery_margin_pct: number;    // (remaining - needed) / remaining × 100
  estimated_time_min: number;
  glycogen_g: number;            // Estimated glycogen consumption
  hydration_ml: number;          // Estimated fluid loss
  carbs_needed_g: number;        // Recommended carb intake
  fluid_needed_ml: number;       // Recommended fluid intake
  segment_count: number;
  demanding_segments: number;    // Segments with gradient > 10%
  motor_off_km: number;          // km where motor will be off (>25 km/h)
  summary: string;               // Portuguese summary text
}

export interface NavigationState {
  /** Is navigation active? */
  active: boolean;
  /** Current route point index (nearest) */
  currentIndex: number;
  /** Distance from start in meters */
  distanceFromStart_m: number;
  /** Distance remaining in meters */
  distanceRemaining_m: number;
  /** Distance to next significant turn/gradient (m) */
  distanceToNextEvent_m: number | null;
  /** Description of next event */
  nextEventText: string | null;
  /** Off-route distance (m). >50m = deviated */
  deviationM: number;
  /** Bearing to next waypoint (degrees) */
  bearingToNext: number;
  /** Progress 0-100% */
  progress_pct: number;
}

interface RouteState {
  // Saved routes (from Supabase, lightweight)
  savedRoutes: SavedRoute[];
  loadingRoutes: boolean;

  // Active route (loaded with full points for navigation)
  activeRoute: SavedRoute | null;
  activeRoutePoints: RoutePoint[];

  // Pre-ride analysis
  preRideAnalysis: PreRideAnalysis | null;
  analyzingRoute: boolean;

  // Navigation state (during ride)
  navigation: NavigationState;

  // Actions
  setSavedRoutes: (routes: SavedRoute[]) => void;
  setLoadingRoutes: (v: boolean) => void;
  setActiveRoute: (route: SavedRoute | null, points?: RoutePoint[]) => void;
  setPreRideAnalysis: (a: PreRideAnalysis | null) => void;
  setAnalyzing: (v: boolean) => void;
  updateNavigation: (nav: Partial<NavigationState>) => void;
  startNavigation: () => void;
  stopNavigation: () => void;
  clearActiveRoute: () => void;
}

const initialNav: NavigationState = {
  active: false,
  currentIndex: 0,
  distanceFromStart_m: 0,
  distanceRemaining_m: 0,
  distanceToNextEvent_m: null,
  nextEventText: null,
  deviationM: 0,
  bearingToNext: 0,
  progress_pct: 0,
};

export const useRouteStore = create<RouteState>((set) => ({
  savedRoutes: [],
  loadingRoutes: false,
  activeRoute: null,
  activeRoutePoints: [],
  preRideAnalysis: null,
  analyzingRoute: false,
  navigation: { ...initialNav },

  setSavedRoutes: (routes) => set({ savedRoutes: routes }),
  setLoadingRoutes: (v) => set({ loadingRoutes: v }),

  setActiveRoute: (route, points) => set({
    activeRoute: route,
    activeRoutePoints: points ?? route?.points ?? [],
    preRideAnalysis: null,
    navigation: { ...initialNav },
  }),

  setPreRideAnalysis: (a) => set({ preRideAnalysis: a, analyzingRoute: false }),
  setAnalyzing: (v) => set({ analyzingRoute: v }),

  updateNavigation: (nav) => set((s) => ({
    navigation: { ...s.navigation, ...nav },
  })),

  startNavigation: () => set((s) => ({
    navigation: { ...s.navigation, active: true, currentIndex: 0, progress_pct: 0 },
  })),

  stopNavigation: () => set({
    navigation: { ...initialNav },
  }),

  clearActiveRoute: () => set({
    activeRoute: null,
    activeRoutePoints: [],
    preRideAnalysis: null,
    navigation: { ...initialNav },
  }),
}));

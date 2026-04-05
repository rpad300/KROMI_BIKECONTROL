import { create } from 'zustand';

interface MapState {
  // Current position from GPS
  latitude: number;
  longitude: number;
  heading: number; // 0-360 degrees
  accuracy: number; // meters
  altitude: number | null;
  speed: number | null; // m/s from GPS

  // GPS status
  gpsActive: boolean;
  gpsError: string | null;

  // Accuracy stats (accumulated during session)
  accuracySum: number;
  accuracySamples: number;
  accuracyMin: number;
  accuracyMax: number;

  // Actions
  setPosition: (lat: number, lng: number, heading: number, accuracy: number) => void;
  setAltitude: (alt: number | null) => void;
  setGpsSpeed: (speed: number | null) => void;
  setGpsActive: (active: boolean) => void;
  setGpsError: (error: string | null) => void;
  resetAccuracyStats: () => void;
}

export const useMapStore = create<MapState>((set) => ({
  latitude: 0,
  longitude: 0,
  heading: 0,
  accuracy: 999,
  altitude: null,
  speed: null,
  gpsActive: false,
  gpsError: null,
  accuracySum: 0,
  accuracySamples: 0,
  accuracyMin: 999,
  accuracyMax: 0,

  setPosition: (lat, lng, heading, accuracy) =>
    set((s) => ({
      latitude: lat, longitude: lng, heading, accuracy,
      accuracySum: s.accuracySum + accuracy,
      accuracySamples: s.accuracySamples + 1,
      accuracyMin: Math.min(s.accuracyMin, accuracy),
      accuracyMax: Math.max(s.accuracyMax, accuracy),
    })),

  setAltitude: (alt) => set({ altitude: alt }),

  setGpsSpeed: (speed) => set({ speed }),

  setGpsActive: (active) => set({ gpsActive: active }),

  setGpsError: (error) => set({ gpsError: error }),

  resetAccuracyStats: () => set({ accuracySum: 0, accuracySamples: 0, accuracyMin: 999, accuracyMax: 0 }),
}));

// Expose getter for dlog (no React dependency)
(window as unknown as Record<string, unknown>).__mapStoreGet = () => useMapStore.getState();

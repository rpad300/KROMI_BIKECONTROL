import { create } from 'zustand';

interface MapState {
  // Current position from GPS
  latitude: number;
  longitude: number;
  heading: number; // 0-360 degrees
  accuracy: number; // meters
  altitude: number | null;       // smoothed (GPSFilterEngine median)
  rawAltitude: number | null;    // raw GPS altitude (for motor gradient + ElevationPredictor)
  speed: number | null; // m/s from GPS

  // GPS status
  gpsActive: boolean;
  gpsError: string | null;
  gpsQuality: 'good' | 'degraded' | 'poor';

  // Accuracy stats (accumulated during session)
  accuracySum: number;
  accuracySamples: number;
  accuracyMin: number;
  accuracyMax: number;

  // GPS-derived distance (for rides without BLE)
  gpsDistanceKm: number;

  // Actions
  setPosition: (lat: number, lng: number, heading: number, accuracy: number) => void;
  setAltitude: (alt: number | null, raw?: number | null) => void;
  setGpsSpeed: (speed: number | null) => void;
  setGpsActive: (active: boolean) => void;
  setGpsError: (error: string | null) => void;
  setGpsQuality: (quality: 'good' | 'degraded' | 'poor') => void;
  resetAccuracyStats: () => void;
  resetGpsDistance: () => void;
}

export const useMapStore = create<MapState>((set) => ({
  latitude: 0,
  longitude: 0,
  heading: 0,
  accuracy: 999,
  altitude: null,
  rawAltitude: null,
  speed: null,
  gpsActive: false,
  gpsError: null,
  gpsQuality: 'good' as const,
  accuracySum: 0,
  accuracySamples: 0,
  accuracyMin: 999,
  accuracyMax: 0,
  gpsDistanceKm: 0,

  setPosition: (lat, lng, heading, accuracy) =>
    set((s) => {
      // Accumulate GPS distance via Haversine
      let addedKm = 0;
      if (s.latitude !== 0 && s.longitude !== 0 && accuracy < 30) {
        const R = 6371;
        const dLat = (lat - s.latitude) * Math.PI / 180;
        const dLon = (lng - s.longitude) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(s.latitude * Math.PI / 180) * Math.cos(lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
        addedKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        // Reject jumps > 1km per fix (GPS glitch — covers highway speeds + tunnel exits)
        if (addedKm > 1.0) addedKm = 0;
      }
      return {
        latitude: lat, longitude: lng, heading, accuracy,
        accuracySum: s.accuracySum + accuracy,
        accuracySamples: s.accuracySamples + 1,
        accuracyMin: Math.min(s.accuracyMin, accuracy),
        accuracyMax: Math.max(s.accuracyMax, accuracy),
        gpsDistanceKm: s.gpsDistanceKm + addedKm,
      };
    }),

  setAltitude: (alt, raw) => set({ altitude: alt, ...(raw !== undefined ? { rawAltitude: raw } : {}) }),

  setGpsSpeed: (speed) => set({ speed }),

  setGpsActive: (active) => set({ gpsActive: active }),

  setGpsError: (error) => set({ gpsError: error }),

  setGpsQuality: (quality) => set({ gpsQuality: quality }),

  resetAccuracyStats: () => set({ accuracySum: 0, accuracySamples: 0, accuracyMin: 999, accuracyMax: 0 }),

  resetGpsDistance: () => set({ gpsDistanceKm: 0 }),
}));

// Expose getter for dlog (no React dependency)
(window as unknown as Record<string, unknown>).__mapStoreGet = () => useMapStore.getState();

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

  // Actions
  setPosition: (lat: number, lng: number, heading: number, accuracy: number) => void;
  setAltitude: (alt: number | null) => void;
  setGpsSpeed: (speed: number | null) => void;
  setGpsActive: (active: boolean) => void;
  setGpsError: (error: string | null) => void;
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

  setPosition: (lat, lng, heading, accuracy) =>
    set({ latitude: lat, longitude: lng, heading, accuracy }),

  setAltitude: (alt) => set({ altitude: alt }),

  setGpsSpeed: (speed) => set({ speed }),

  setGpsActive: (active) => set({ gpsActive: active }),

  setGpsError: (error) => set({ gpsError: error }),
}));

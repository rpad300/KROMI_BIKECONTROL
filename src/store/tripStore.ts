import { create } from 'zustand';
import { useBikeStore } from './bikeStore';
import { rideSessionManager } from '../services/storage/RideHistory';

export type TripState = 'idle' | 'running' | 'paused' | 'finished';

interface TripStore {
  state: TripState;
  startedAt: number;       // timestamp ms
  /** Elapsed moving time (seconds) — excludes pauses */
  movingTime: number;
  /** Elapsed total time (seconds) — includes pauses */
  totalTime: number;
  /** Trip distance (km) — from motor or GPS */
  tripKm: number;
  /** Distance at trip start */
  startKm: number;
  /** Auto-pause state */
  autoPaused: boolean;
  autoPausedAt: number;
  /** Stats */
  maxSpeed: number;
  avgSpeed: number;

  // Actions
  startTrip: () => void;
  stopTrip: () => void;
  tick: () => void;  // called every 1s
}

const AUTOPAUSE_SPEED = 1.5; // km/h — below this = paused
const AUTOPAUSE_DELAY = 5;   // seconds of zero speed before auto-pause

export const useTripStore = create<TripStore>()((set, get) => ({
  state: 'idle',
  startedAt: 0,
  movingTime: 0,
  totalTime: 0,
  tripKm: 0,
  startKm: 0,
  autoPaused: false,
  autoPausedAt: 0,
  maxSpeed: 0,
  avgSpeed: 0,

  startTrip: () => {
    const bike = useBikeStore.getState();
    const startKm = bike.trip_distance_km || bike.distance_km;
    set({
      state: 'running',
      startedAt: Date.now(),
      movingTime: 0,
      totalTime: 0,
      tripKm: 0,
      startKm,
      autoPaused: false,
      autoPausedAt: 0,
      maxSpeed: 0,
      avgSpeed: 0,
    });
    // Also start ride data recording (LocalRideStore + Supabase sync)
    rideSessionManager.startSession().catch((err) => {
      console.error('[TripStore] Failed to start ride session:', err);
    });
  },

  stopTrip: () => {
    set({ state: 'finished' });
    // Also stop ride data recording
    rideSessionManager.stopSession().catch((err) => {
      console.error('[TripStore] Failed to stop ride session:', err);
    });
  },

  tick: () => {
    const s = get();
    if (s.state !== 'running') return;

    const bike = useBikeStore.getState();
    const speed = bike.speed_kmh;
    const currentKm = bike.trip_distance_km || bike.distance_km;
    const tripKm = Math.max(0, currentKm - s.startKm);
    const totalTime = Math.round((Date.now() - s.startedAt) / 1000);

    // Auto-pause detection
    let autoPaused = s.autoPaused;
    let autoPausedAt = s.autoPausedAt;
    let movingTime = s.movingTime;

    if (speed < AUTOPAUSE_SPEED) {
      if (!autoPaused) {
        // Start counting still time
        if (autoPausedAt === 0) {
          autoPausedAt = Date.now();
        } else if ((Date.now() - autoPausedAt) / 1000 >= AUTOPAUSE_DELAY) {
          autoPaused = true; // trigger autopause
        }
      }
      // Don't increment moving time when paused
    } else {
      // Moving — reset autopause, increment moving time
      if (autoPaused || autoPausedAt > 0) {
        autoPaused = false;
        autoPausedAt = 0;
      }
      movingTime = s.movingTime + 1;
    }

    // Max speed
    const maxSpeed = Math.max(s.maxSpeed, speed);
    // Avg speed (from distance / moving time)
    const avgSpeed = movingTime > 0 ? (tripKm / (movingTime / 3600)) : 0;

    set({ totalTime, movingTime, tripKm, autoPaused, autoPausedAt, maxSpeed, avgSpeed });
  },
}));

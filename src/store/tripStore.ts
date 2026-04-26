import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { useBikeStore } from './bikeStore';
import { useMapStore } from './mapStore';
import { rideSessionManager } from '../services/storage/RideHistory';
import { resetEngine } from '../services/gps/GPSFilterEngine';

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
  /** Session ID for reading snapshots after finish */
  lastSessionId: string | null;
  /** Battery at trip start */
  batteryStart: number;

  // Actions
  startTrip: () => void;
  stopTrip: () => void;
  tick: () => void;  // called every 1s
}

const AUTOPAUSE_SPEED = 1.5; // km/h — below this = paused
const AUTOPAUSE_DELAY = 5;   // seconds of zero speed before auto-pause

export const useTripStore = create<TripStore>()(persist((set, get) => ({
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
  lastSessionId: null,
  batteryStart: 0,

  startTrip: () => {
    // Reset GPS engine synchronously before anything else (Kalman, elevation gain, etc.)
    resetEngine();
    useBikeStore.getState().setElevationGain(0);
    useMapStore.getState().resetGpsDistance();
    const bike = useBikeStore.getState();
    const startKm = bike.trip_distance_km ?? 0;
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
      lastSessionId: null,
      batteryStart: bike.battery_percent,
    });
    // Also start ride data recording (LocalRideStore + Supabase sync)
    rideSessionManager.startSession().catch((err) => {
      console.error('[TripStore] Failed to start ride session:', err);
    });
  },

  stopTrip: async () => {
    // Capture session ID before stopSession clears it
    const sessionId = rideSessionManager.getSessionId();
    set({ lastSessionId: sessionId });
    // Stop ride data recording — wait for flush to complete before showing summary
    try {
      await rideSessionManager.stopSession();
    } catch (err) {
      console.error('[TripStore] Failed to stop ride session:', err);
    }
    // Set finished AFTER flush so summary modal can read snapshots
    set({ state: 'finished' });

    // Fire-and-forget post-ride processing (trail simplification + elevation correction)
    if (sessionId) {
      import('../services/gps/PostRideProcessor').then(({ processRide }) =>
        processRide(sessionId).catch(console.error),
      );
    }
  },

  tick: () => {
    const s = get();
    if (s.state !== 'running') return;

    const bike = useBikeStore.getState();
    const speed = bike.speed_kmh;
    const currentKm = bike.trip_distance_km ?? 0;

    // Detect motor distance reset (went backwards by >100m)
    if (currentKm > 0 && currentKm < s.startKm - 0.1) {
      console.warn('[Trip] Motor distance reset detected, recalibrating');
      set({ startKm: currentKm });
      return;
    }

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
}), {
  name: 'kromi-trip',
  storage: createJSONStorage(() => localStorage),
  // Only persist state fields, not actions
  partialize: (state) => ({
    state: state.state,
    startedAt: state.startedAt,
    movingTime: state.movingTime,
    totalTime: state.totalTime,
    tripKm: state.tripKm,
    startKm: state.startKm,
    autoPaused: state.autoPaused,
    autoPausedAt: state.autoPausedAt,
    maxSpeed: state.maxSpeed,
    avgSpeed: state.avgSpeed,
    lastSessionId: state.lastSessionId,
    batteryStart: state.batteryStart,
  }),
  // On rehydrate: if state was 'running', resume the ride session
  onRehydrateStorage: () => (state) => {
    if (state?.state === 'running' && state.startedAt > 0) {
      console.info('[TripStore] Resuming active ride from', new Date(state.startedAt).toLocaleTimeString());
      // Re-attach ride session manager (it checks IndexedDB for active session)
      rideSessionManager.resumeSession().catch((err) => {
        console.warn('[TripStore] Could not resume session:', err);
      });
    }
  },
}));

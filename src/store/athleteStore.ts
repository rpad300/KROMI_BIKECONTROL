import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  type AthleteProfile,
  type ProfileUpdate,
  createDefaultProfile,
  AdaptiveLearningEngine,
} from '../services/learning/AdaptiveLearningEngine';
import type { RideSummary } from '../services/learning/RideDataCollector';
import { syncProfile, syncRide, loadProfile } from '../services/learning/ProfileSyncService';

interface AthleteState {
  profile: AthleteProfile;
  lastUpdate: ProfileUpdate | null;
  rideActive: boolean;

  // Actions
  initProfile: (age: number, weight: number) => Promise<void>;
  processRide: (ride: RideSummary) => Promise<ProfileUpdate>;
  setRideActive: (active: boolean) => void;
  getFormMultiplier: () => number;
}

export const useAthleteStore = create<AthleteState>()(
  persist(
    (set, get) => ({
      profile: createDefaultProfile(35, 80),
      lastUpdate: null,
      rideActive: false,

      initProfile: async (age, weight) => {
        // Try loading from Supabase first
        const remote = await loadProfile();
        if (remote) {
          set({ profile: remote });
          return;
        }
        // Create new default profile
        set({ profile: createDefaultProfile(age, weight) });
      },

      processRide: async (ride) => {
        const profile = get().profile;
        const engine = new AdaptiveLearningEngine(profile);
        const updates = engine.updateFromRide(ride);
        const updatedProfile = engine.getProfile();

        set({ profile: updatedProfile, lastUpdate: updates });

        // Sync to Supabase in background
        syncProfile(updatedProfile).catch(() => {});
        syncRide(updatedProfile, ride).catch(() => {});

        return updates;
      },

      setRideActive: (active) => set({ rideActive: active }),

      getFormMultiplier: () => {
        const profile = get().profile;
        const engine = new AdaptiveLearningEngine(profile);
        return engine.getFormMultiplier();
      },
    }),
    {
      name: 'bikecontrol-athlete',
    }
  )
);

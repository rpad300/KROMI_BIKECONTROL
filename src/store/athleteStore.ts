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
          // Sync physiology from rider profile settings
          const settings = (await import('./settingsStore')).useSettingsStore.getState();
          const rp = settings.riderProfile;
          remote.physiology.weight_kg = rp.weight_kg || weight;
          remote.physiology.age = rp.age || age;
          if (rp.hr_max > 0) {
            remote.physiology.hr_max_theoretical = 220 - (rp.age || age);
            // Only update observed if user manually set HR max different from formula
            if (rp.zones_source === 'manual' && rp.hr_max !== remote.physiology.hr_max_observed) {
              remote.physiology.hr_max_observed = rp.hr_max;
              remote.physiology.hr_aerobic_threshold = Math.round(rp.hr_max * 0.7);
              remote.physiology.hr_anaerobic_threshold = Math.round(rp.hr_max * 0.85);
            }
          }
          set({ profile: remote });
          return;
        }
        // Create new default profile from rider settings
        const settings = (await import('./settingsStore')).useSettingsStore.getState();
        const rp = settings.riderProfile;
        const p = createDefaultProfile(rp.age || age, rp.weight_kg || weight);
        if (rp.hr_max > 0) {
          p.physiology.hr_max_observed = rp.hr_max;
          p.physiology.hr_max_theoretical = 220 - (rp.age || age);
          p.physiology.hr_aerobic_threshold = Math.round(rp.hr_max * 0.7);
          p.physiology.hr_anaerobic_threshold = Math.round(rp.hr_max * 0.85);
        }
        set({ profile: p });
      },

      /** Sync physiology from rider profile when user edits settings */
      syncFromRiderProfile: () => {
        const settings = (require('./settingsStore') as { useSettingsStore: typeof import('./settingsStore').useSettingsStore }).useSettingsStore.getState();
        const rp = settings.riderProfile;
        set((s) => ({
          profile: {
            ...s.profile,
            physiology: {
              ...s.profile.physiology,
              weight_kg: rp.weight_kg,
              age: rp.age,
              hr_max_theoretical: 220 - rp.age,
              ...(rp.zones_source === 'manual' ? {
                hr_max_observed: rp.hr_max,
                hr_aerobic_threshold: Math.round(rp.hr_max * 0.7),
                hr_anaerobic_threshold: Math.round(rp.hr_max * 0.85),
              } : {}),
            },
            updated_at: new Date().toISOString(),
          },
        }));
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

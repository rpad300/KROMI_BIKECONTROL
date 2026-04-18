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

// ── Gap #7: Per-bike athletic data ────────────────────────────

export interface BikeAthleticData {
  cp_watts: number;          // Critical Power for this bike
  w_prime_joules: number;    // W' for this bike
  tau_seconds: number;       // Recovery time constant
  ftp_watts: number;         // FTP on this bike
  preferred_cadence: number; // Learned cadence preference
}

/** Resolve athletic data for a specific bike, falling back to athlete defaults */
export function getAthleticDataForBike(
  bikeId: string,
  profiles: Record<string, BikeAthleticData>,
  defaultProfile: AthleteProfile,
): BikeAthleticData {
  const bikeProfile = profiles[bikeId];
  if (bikeProfile) return bikeProfile;

  // First ride with this bike — use default athlete profile
  return {
    cp_watts: defaultProfile.physiology.ftp_estimate_watts ?? 200,
    w_prime_joules: 15000,
    tau_seconds: 400,
    ftp_watts: defaultProfile.physiology.ftp_estimate_watts ?? 200,
    preferred_cadence: 80,
  };
}

interface AthleteState {
  profile: AthleteProfile;
  lastUpdate: ProfileUpdate | null;
  rideActive: boolean;
  /** Gap #7: Per-bike CP/W'/tau/FTP profiles, keyed by bike UUID */
  bikeAthleticProfiles: Record<string, BikeAthleticData>;

  // Actions
  initProfile: (age: number, weight: number) => Promise<void>;
  processRide: (ride: RideSummary, currentBikeId?: string) => Promise<ProfileUpdate>;
  setRideActive: (active: boolean) => void;
  getFormMultiplier: () => number;
  /** Gap #7: Update per-bike athletic data after a ride or calibration */
  updateBikeAthleticData: (bikeId: string, data: Partial<BikeAthleticData>) => void;
  /** Gap #7: Get athletic data for current bike (with fallback) */
  getBikeAthleticData: (bikeId: string) => BikeAthleticData;
}

export const useAthleteStore = create<AthleteState>()(
  persist(
    (set, get) => ({
      profile: createDefaultProfile(35, 80),
      lastUpdate: null,
      rideActive: false,
      bikeAthleticProfiles: {},

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
      syncFromRiderProfile: async () => {
        // Dynamic import to avoid circular dependency — useSettingsStore is always loaded by this point
        const { useSettingsStore } = await import('./settingsStore');
        const settings = useSettingsStore.getState();
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

      processRide: async (ride, currentBikeId) => {
        const profile = get().profile;
        const engine = new AdaptiveLearningEngine(profile);
        const updates = engine.updateFromRide(ride);
        const updatedProfile = engine.getProfile();

        const stateUpdate: Partial<AthleteState> = { profile: updatedProfile, lastUpdate: updates };

        // Gap #7: Save per-bike athletic data after ride
        if (currentBikeId) {
          const ftp = updatedProfile.physiology.ftp_estimate_watts ?? 200;
          const existing = get().bikeAthleticProfiles[currentBikeId];
          stateUpdate.bikeAthleticProfiles = {
            ...get().bikeAthleticProfiles,
            [currentBikeId]: {
              cp_watts: existing?.cp_watts ?? ftp,
              w_prime_joules: existing?.w_prime_joules ?? 15000,
              tau_seconds: existing?.tau_seconds ?? 400,
              ftp_watts: ftp,
              preferred_cadence: existing?.preferred_cadence ?? 80,
            },
          };
        }

        set(stateUpdate as AthleteState);

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

      updateBikeAthleticData: (bikeId, data) => {
        const current = get().bikeAthleticProfiles[bikeId] ?? getAthleticDataForBike(bikeId, get().bikeAthleticProfiles, get().profile);
        set({
          bikeAthleticProfiles: {
            ...get().bikeAthleticProfiles,
            [bikeId]: { ...current, ...data },
          },
        });
      },

      getBikeAthleticData: (bikeId) => {
        return getAthleticDataForBike(bikeId, get().bikeAthleticProfiles, get().profile);
      },
    }),
    {
      name: 'bikecontrol-athlete',
    }
  )
);

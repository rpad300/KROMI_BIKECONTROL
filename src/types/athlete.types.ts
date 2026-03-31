// Placeholder - will be fully implemented in Phase 4 (AI Adaptive Learning)

export interface RiderProfile {
  hr_max: number;
  hr_rest: number;
  hr_target_zone: number;
  age: number;
  weight_kg: number;
  hr_weight_pct: number; // 0-100, balance between HR vs elevation influence
}

export const DEFAULT_RIDER_PROFILE: RiderProfile = {
  hr_max: 185,
  hr_rest: 60,
  hr_target_zone: 3,
  age: 35,
  weight_kg: 80,
  hr_weight_pct: 50,
};

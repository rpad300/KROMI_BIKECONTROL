/**
 * Athlete profile — HR zones calculated from observed data.
 * User chooses target zone, KROMI regulates motor to maintain it.
 */

export interface HRZone {
  name: string;
  min_pct: number;  // % of HR max
  max_pct: number;
  min_bpm: number;  // calculated from HR max
  max_bpm: number;
  color: string;
  description: string;
}

export interface RiderProfile {
  // Personal
  name?: string;
  birthdate?: string;       // ISO date string
  gender?: string;          // M, F, Outro

  // Club
  club_id?: string;
  club_name?: string;

  // Privacy (per-field: 'public' | 'club' | 'private')
  privacy?: { name?: string; stats?: string; rides?: string };

  // Physiology
  hr_max: number;           // Observed max (from FIT imports or manual)
  hr_rest: number;          // Resting HR
  age: number;
  weight_kg: number;
  height_cm: number;

  // KROMI target
  target_zone: number;      // 1-5, which HR zone to maintain (default Z2)
  hr_weight_pct: number;    // 0-100, not used anymore (legacy)

  // Calculated zones (auto-generated from hr_max)
  zones: HRZone[];
}

/** Calculate HR zones from max HR */
export function calculateZones(hrMax: number): HRZone[] {
  const z = (min: number, max: number) => ({
    min_bpm: Math.round(hrMax * min / 100),
    max_bpm: Math.round(hrMax * max / 100),
  });

  return [
    { name: 'Z1 Recovery', min_pct: 50, max_pct: 60, ...z(50, 60), color: '#6b7280', description: 'Recuperação activa' },
    { name: 'Z2 Endurance', min_pct: 60, max_pct: 70, ...z(60, 70), color: '#3b82f6', description: 'Base aeróbica — ideal para treino longo' },
    { name: 'Z3 Tempo', min_pct: 70, max_pct: 80, ...z(70, 80), color: '#22c55e', description: 'Ritmo moderado — melhora eficiência' },
    { name: 'Z4 Threshold', min_pct: 80, max_pct: 90, ...z(80, 90), color: '#f59e0b', description: 'Limiar — perto do limite sustentável' },
    { name: 'Z5 VO2max', min_pct: 90, max_pct: 100, ...z(90, 100), color: '#ef4444', description: 'Máximo — apenas em esforços curtos' },
  ];
}

/** Get target zone details */
export function getTargetZone(profile: RiderProfile): HRZone {
  const zones = calculateZones(profile.hr_max);
  const idx = Math.max(0, Math.min(4, profile.target_zone - 1));
  return zones[idx]!;
}

export const DEFAULT_RIDER_PROFILE: RiderProfile = {
  hr_max: 185,
  hr_rest: 60,
  age: 35,
  weight_kg: 80,
  height_cm: 175,
  target_zone: 2,     // Z2 Endurance by default
  hr_weight_pct: 50,
  zones: calculateZones(185),
};

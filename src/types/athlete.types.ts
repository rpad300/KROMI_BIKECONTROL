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

/** Custom zone definition — user-defined bpm boundaries */
export interface CustomZone {
  min_bpm: number;
  max_bpm: number;
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

  // Custom HR zones — user-defined bpm boundaries (overrides formula)
  custom_zones?: CustomZone[];         // 5 zones with min/max bpm
  zones_source?: 'formula' | 'manual' | 'learned';  // how zones were set
  zones_updated_at?: string;           // ISO timestamp of last change

  // Calculated zones (auto-generated from hr_max)
  zones: HRZone[];
}

/** Zone metadata (names, colors, descriptions) */
const ZONE_META = [
  { name: 'Z1 Recovery', min_pct: 50, max_pct: 60, color: '#6b7280', description: 'Recuperação activa' },
  { name: 'Z2 Endurance', min_pct: 60, max_pct: 70, color: '#3b82f6', description: 'Base aeróbica — ideal para treino longo' },
  { name: 'Z3 Tempo', min_pct: 70, max_pct: 80, color: '#22c55e', description: 'Ritmo moderado — melhora eficiência' },
  { name: 'Z4 Threshold', min_pct: 80, max_pct: 90, color: '#f59e0b', description: 'Limiar — perto do limite sustentável' },
  { name: 'Z5 VO2max', min_pct: 90, max_pct: 100, color: '#ef4444', description: 'Máximo — apenas em esforços curtos' },
];

/** Calculate HR zones — uses custom zones if provided, otherwise formula */
export function calculateZones(hrMax: number, customZones?: CustomZone[]): HRZone[] {
  return ZONE_META.map((meta, i) => {
    const custom = customZones?.[i];
    return {
      ...meta,
      min_bpm: custom?.min_bpm ?? Math.round(hrMax * meta.min_pct / 100),
      max_bpm: custom?.max_bpm ?? Math.round(hrMax * meta.max_pct / 100),
    };
  });
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

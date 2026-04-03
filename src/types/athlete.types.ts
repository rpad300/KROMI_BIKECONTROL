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

/** Power zone definition — FTP-based */
export interface PowerZone {
  name: string;
  min_pct: number;  // % of FTP
  max_pct: number;
  min_watts: number;
  max_watts: number;
  color: string;
  description: string;
}

export interface RiderProfile {
  // Personal
  name?: string;
  birthdate?: string;       // ISO date string
  gender?: string;          // M, F, Outro
  avatar_url?: string;      // Profile photo URL

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
  spo2_rest?: number;       // Resting SpO2 % (typically 96-99%)
  spo2_threshold_warning?: number;  // Alert threshold (default 93%)
  spo2_threshold_danger?: number;   // Danger threshold (default 88%)
  vo2max?: number;          // ml/kg/min (from watch, test, or estimated)
  ftp_watts?: number;       // Functional Threshold Power (manual or tested)

  // Medical / conditions
  medical_conditions?: string[];  // ['asthma', 'cardiac', 'diabetes', etc.]
  medical_notes?: string;         // Free text for specific notes

  // Goals
  goal?: 'weight_loss' | 'endurance' | 'performance' | 'event_prep' | 'fun' | 'rehab';
  goal_event_date?: string;       // ISO date for event preparation
  goal_notes?: string;

  // Bike fit
  inseam_cm?: number;       // Leg length for saddle height
  frame_size?: string;      // S, M, L, XL or cm
  riding_position?: 'aggressive' | 'moderate' | 'upright';

  // KROMI target
  target_zone: number;      // 1-5, which HR zone to maintain (default Z2)
  target_power_zone?: number; // 1-6, target power zone (optional)
  hr_weight_pct: number;    // 0-100, not used anymore (legacy)

  // Custom HR zones — user-defined bpm boundaries (overrides formula)
  custom_zones?: CustomZone[];
  zones_source?: 'formula' | 'manual' | 'learned';
  zones_updated_at?: string;

  // Custom Power zones — FTP-based (optional)
  custom_power_zones?: { min_watts: number; max_watts: number }[];

  // Calculated zones (auto-generated from hr_max)
  zones: HRZone[];
}

/** Calculate Power zones from FTP */
export function calculatePowerZones(ftp: number): PowerZone[] {
  const z = (min: number, max: number) => ({ min_watts: Math.round(ftp * min / 100), max_watts: Math.round(ftp * max / 100) });
  return [
    { name: 'Z1 Recovery', min_pct: 0, max_pct: 55, ...z(0, 55), color: '#6b7280', description: 'Recuperação' },
    { name: 'Z2 Endurance', min_pct: 55, max_pct: 75, ...z(55, 75), color: '#3b82f6', description: 'Resistência base' },
    { name: 'Z3 Tempo', min_pct: 75, max_pct: 90, ...z(75, 90), color: '#22c55e', description: 'Ritmo sustentado' },
    { name: 'Z4 Threshold', min_pct: 90, max_pct: 105, ...z(90, 105), color: '#f59e0b', description: 'Limiar funcional' },
    { name: 'Z5 VO2max', min_pct: 105, max_pct: 120, ...z(105, 120), color: '#ef4444', description: 'Potência máxima aeróbica' },
    { name: 'Z6 Anaerobic', min_pct: 120, max_pct: 200, ...z(120, 200), color: '#dc2626', description: 'Anaeróbico — sprints' },
  ];
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

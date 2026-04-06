import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_RIDER_PROFILE, type RiderProfile } from '../types/athlete.types';

/** Motor tuning level characteristics — what each SET_TUNING level does */
export interface TuningLevelSpec {
  assist_pct: number;     // Motor support % (e.g., 400% = 4x rider input)
  torque_nm: number;      // Max torque at this level
  launch: number;         // Response aggressiveness (1-10)
  consumption_wh_km: number; // Typical Wh/km at this level
}

// ── Bike classification ─────────────────────────────────────
export type BikeCategory = 'mtb' | 'road' | 'gravel' | 'urban' | 'tt' | 'cx' | 'other';
export type SuspensionType = 'rigid' | 'hardtail' | 'full';
export type BrakeType = 'disc_hydraulic' | 'disc_mechanical' | 'rim' | 'none';
export type DrivetrainType = '1x' | '2x' | '3x';
export type GroupsetBrand = 'shimano' | 'sram' | 'campagnolo' | 'other';

export interface BikeConfig {
  id: string;
  bike_type: 'ebike' | 'mechanical';
  name: string;

  // ── Classification ────────────────────────────────────────
  category: BikeCategory;
  suspension: SuspensionType;
  year: number;
  brand: string;
  model: string;
  size: string;               // e.g., 'M', 'L', '54cm'
  color: string;
  weight_kg: number;
  photo_url: string;
  purchase_date: string;  // ISO date 'YYYY-MM-DD' or ''
  serial_number: string;  // frame serial
  ai_summary: string;     // AI-generated description, persisted
  ai_summary_hash: string; // hash of specs used to generate summary — triggers regen on change

  // ── Frame ─────────────────────────────────────────────────
  frame_material: string;     // 'carbon' | 'aluminium' | 'steel' | 'titanium'
  fork_travel_mm: number;     // 0 for rigid
  rear_travel_mm: number;     // 0 for hardtail/rigid
  fork_model: string;
  rear_shock_model: string;
  seatpost_type: string;      // 'rigid' | 'dropper'
  seatpost_travel_mm: number; // dropper travel
  seatpost_diameter_mm: number;
  headtube_angle_deg: number;
  seattube_angle_deg: number;
  chainstay_mm: number;
  reach_mm: number;
  stack_mm: number;
  wheelbase_mm: number;
  bb_drop_mm: number;

  // ── Drivetrain ────────────────────────────────────────────
  drivetrain_type: DrivetrainType;
  groupset_brand: GroupsetBrand;
  groupset_model: string;     // e.g., 'Deore XT M8100', 'GX Eagle AXS'
  electronic_shifting: boolean;
  crank_length_mm: number;    // 165, 170, 175
  chainring_teeth: string;    // e.g., '34T' or '50/34T'
  cassette_range: string;     // e.g., '10-51T' or '11-34T'
  cassette_speeds: number;    // 10, 11, 12, 13
  cassette_sprockets: number[]; // individual teeth per sprocket, e.g., [10,12,14,16,18,21,24,28,32,36,42,51]
  chain_model: string;
  pedals: string;

  // ── Wheels & Tyres ────────────────────────────────────────
  wheel_size: string;         // '29"', '27.5"', '700c', '650b'
  wheel_circumference_mm: number;
  rim_width_mm: number;
  rim_model_front: string;
  rim_model_rear: string;
  hub_front: string;
  hub_rear: string;
  spokes: string;             // e.g., '32H J-bend'
  tyre_model_front: string;
  tyre_model_rear: string;
  tyre_width_mm: number;
  tyre_pressure_front_psi: number;
  tyre_pressure_rear_psi: number;
  tubeless: boolean;
  tyre_insert: boolean;

  // ── Brakes ────────────────────────────────────────────────
  brake_type: BrakeType;
  brake_model: string;        // e.g., 'Shimano XT M8120'
  rotor_front_mm: number;     // 160, 180, 200, 203, 220
  rotor_rear_mm: number;

  // ── Cockpit ───────────────────────────────────────────────
  handlebar_type: string;     // 'flat', 'riser', 'drop', 'aero'
  handlebar_width_mm: number;
  handlebar_rise_mm: number;
  stem_length_mm: number;
  stem_angle_deg: number;
  grips_tape: string;
  saddle_model: string;
  saddle_width_mm: number;

  // ── Optional accessories ──────────────────────────────────
  has_power_meter: boolean;
  power_meter_model: string;  // e.g., 'Quarq DZero', 'Shimano FC-R8100-P'
  has_gps_computer: boolean;
  gps_computer_model: string; // e.g., 'Garmin Edge 540', 'Wahoo ELEMNT'
  has_lights: boolean;
  has_mudguards: boolean;
  has_rack: boolean;

  // ── E-Bike specific ───────────────────────────────────────
  main_battery_wh: number;
  has_range_extender: boolean;
  sub_battery_wh: number;
  motor_name: string;
  max_torque_nm: number;
  max_power_w: number;
  speed_limit_kmh: number;
  // Consumption defaults (Wh/km) per assist mode
  consumption_eco: number;
  consumption_tour: number;
  consumption_active: number;
  consumption_sport: number;
  consumption_power: number;
  // Tuning level specs (what SET_TUNING levels do in POWER mode)
  tuning_max: TuningLevelSpec;
  tuning_mid: TuningLevelSpec;
  tuning_min: TuningLevelSpec;
  fixed_baseline: TuningLevelSpec;
  // RideControl mode config — what each mode does (from Giant RideControl app)
  // Each mode has exactly one set of Support/Torque/Launch values
  ridecontrol_modes: RideControlModeConfig;
}

/** RideControl per-mode config: one Support/Torque/Launch per mode */
export interface RideControlModeTuning {
  support_pct: number;    // Motor support % (e.g., ECO=70%, SPORT=280%)
  torque_nm: number;      // Max torque Nm
  launch: number;         // Launch responsiveness (1-7 wire)
}

export interface RideControlModeConfig {
  eco:    RideControlModeTuning;
  tour:   RideControlModeTuning;
  active: RideControlModeTuning;
  sport:  RideControlModeTuning;
}

export const DEFAULT_BIKE_CONFIG: BikeConfig = {
  id: 'default',
  bike_type: 'ebike',
  name: 'Giant Trance X E+ 2 (2023)',

  // Classification
  category: 'mtb',
  suspension: 'full',
  year: 2023,
  brand: 'Giant',
  model: 'Trance X Advanced E+ 2',
  size: 'M',
  color: '',
  weight_kg: 23.8,
  photo_url: '',
  purchase_date: '',
  serial_number: '',
  ai_summary: '',
  ai_summary_hash: '',

  // Frame
  frame_material: 'aluminium',
  fork_travel_mm: 150,
  rear_travel_mm: 140,
  fork_model: 'Fox 36 Rhythm',
  rear_shock_model: 'Fox Float DPS',
  seatpost_type: 'dropper',
  seatpost_travel_mm: 150,
  seatpost_diameter_mm: 30.9,
  headtube_angle_deg: 65.5,
  seattube_angle_deg: 76,
  chainstay_mm: 455,
  reach_mm: 455,
  stack_mm: 625,
  wheelbase_mm: 1235,
  bb_drop_mm: 35,

  // Drivetrain
  drivetrain_type: '1x',
  groupset_brand: 'shimano',
  groupset_model: 'Deore XT M8100',
  electronic_shifting: false,
  crank_length_mm: 165,
  chainring_teeth: '34T',
  cassette_range: '10-51T',
  cassette_speeds: 12,
  cassette_sprockets: [10, 12, 14, 16, 18, 21, 24, 28, 32, 36, 42, 51],
  chain_model: 'Shimano CN-M8100',
  pedals: '',

  // Wheels & Tyres
  wheel_size: '29"',
  wheel_circumference_mm: 2290,
  rim_width_mm: 30,
  rim_model_front: 'Giant AM 29',
  rim_model_rear: 'Giant AM 29',
  hub_front: 'Giant Tracker',
  hub_rear: 'Giant Tracker',
  spokes: '32H',
  tyre_model_front: 'Maxxis Minion DHF 2.5',
  tyre_model_rear: 'Maxxis Dissector 2.4',
  tyre_width_mm: 63,
  tyre_pressure_front_psi: 24,
  tyre_pressure_rear_psi: 26,
  tubeless: true,
  tyre_insert: false,

  // Brakes
  brake_type: 'disc_hydraulic',
  brake_model: 'Shimano Deore M6120 4-piston',
  rotor_front_mm: 203,
  rotor_rear_mm: 180,

  // Cockpit
  handlebar_type: 'riser',
  handlebar_width_mm: 780,
  handlebar_rise_mm: 20,
  stem_length_mm: 50,
  stem_angle_deg: 0,
  grips_tape: 'Giant Tactal',
  saddle_model: 'Giant Contact SL',
  saddle_width_mm: 145,

  // Optional accessories
  has_power_meter: false,
  power_meter_model: '',
  has_gps_computer: false,
  gps_computer_model: '',
  has_lights: false,
  has_mudguards: false,
  has_rack: false,

  // E-Bike
  main_battery_wh: 800,
  has_range_extender: true,
  sub_battery_wh: 250,
  motor_name: 'SyncDrive Pro',
  max_torque_nm: 85,
  max_power_w: 600,
  speed_limit_kmh: 25,
  consumption_eco: 6,
  consumption_tour: 15,
  consumption_active: 22,
  consumption_sport: 28,
  consumption_power: 35,
  tuning_max: { assist_pct: 360, torque_nm: 85, launch: 9, consumption_wh_km: 26 },
  tuning_mid: { assist_pct: 240, torque_nm: 65, launch: 5, consumption_wh_km: 16 },
  tuning_min: { assist_pct: 140, torque_nm: 45, launch: 3, consumption_wh_km: 9 },
  fixed_baseline: { assist_pct: 125, torque_nm: 40, launch: 3, consumption_wh_km: 7 },
  // SyncDrive Pro defaults — rider should update from their RideControl app
  ridecontrol_modes: {
    eco:    { support_pct: 70,  torque_nm: 35, launch: 2 },
    tour:   { support_pct: 120, torque_nm: 50, launch: 3 },
    active: { support_pct: 180, torque_nm: 60, launch: 4 },
    sport:  { support_pct: 280, torque_nm: 75, launch: 5 },
  },
};

/** Deep merge bikeConfig with defaults — handles missing fields from old DB/localStorage */
export function safeBikeConfig(raw: Partial<BikeConfig> | undefined): BikeConfig {
  const d = DEFAULT_BIKE_CONFIG;
  if (!raw) return d;
  return {
    ...d,
    ...raw,
    // Nested objects need explicit merge
    tuning_max: { ...d.tuning_max, ...(raw.tuning_max ?? {}) },
    tuning_mid: { ...d.tuning_mid, ...(raw.tuning_mid ?? {}) },
    tuning_min: { ...d.tuning_min, ...(raw.tuning_min ?? {}) },
    fixed_baseline: { ...d.fixed_baseline, ...(raw.fixed_baseline ?? {}) },
    ridecontrol_modes: raw.ridecontrol_modes ? {
      eco:    { ...d.ridecontrol_modes.eco,    ...raw.ridecontrol_modes.eco },
      tour:   { ...d.ridecontrol_modes.tour,   ...raw.ridecontrol_modes.tour },
      active: { ...d.ridecontrol_modes.active, ...raw.ridecontrol_modes.active },
      sport:  { ...d.ridecontrol_modes.sport,  ...raw.ridecontrol_modes.sport },
    } : d.ridecontrol_modes,
    // Ensure new fields have defaults for old configs
    category: raw.category ?? (raw.bike_type === 'ebike' ? 'mtb' : 'other'),
    suspension: raw.suspension ?? 'rigid',
    cassette_sprockets: raw.cassette_sprockets?.length ? raw.cassette_sprockets : [],
  };
}

/** Get display label for bike category */
export function bikeCategoryLabel(cat: BikeCategory): string {
  const labels: Record<BikeCategory, string> = {
    mtb: 'Mountain Bike', road: 'Estrada', gravel: 'Gravel',
    urban: 'Urbana', tt: 'Contra-relógio', cx: 'Ciclocross', other: 'Outra',
  };
  return labels[cat] ?? cat;
}

/** Get display label for suspension type */
export function suspensionLabel(s: SuspensionType): string {
  const labels: Record<SuspensionType, string> = { rigid: 'Rígida', hardtail: 'Hardtail', full: 'Full Suspension' };
  return labels[s] ?? s;
}

// ── Accessories config ───────────────────��──────────────────

export interface AccessoriesConfig {
  // Smart Light
  smart_light_enabled: boolean;
  auto_on_lux: number;           // Auto-on when lux < this
  auto_off_lux: number;          // Auto-off when lux > this
  brake_flash_enabled: boolean;
  brake_decel_threshold: number; // km/h per second
  radar_flash_enabled: boolean;
  radar_flash_threat: number;    // Min threat level (1-3)
  speed_adaptive: boolean;
  turn_signal_duration_ms: number;
  // Radar
  radar_enabled: boolean;
  radar_vibrate: boolean;
  radar_vibrate_min_threat: number;
}

export const DEFAULT_ACCESSORIES_CONFIG: AccessoriesConfig = {
  smart_light_enabled: true,
  auto_on_lux: 200,
  auto_off_lux: 500,
  brake_flash_enabled: true,
  brake_decel_threshold: 3,
  radar_flash_enabled: true,
  radar_flash_threat: 1,
  speed_adaptive: false,
  turn_signal_duration_ms: 5000,
  radar_enabled: true,
  radar_vibrate: true,
  radar_vibrate_min_threat: 2,
};

interface AutoAssistConfig {
  enabled: boolean;
  lookahead_m: number;
  preempt_distance_m: number;
  override_duration_s: number;
  battery_conservation: boolean;
  min_battery_reserve: number;
  smoothing_window: number;
  climb_threshold_pct: number;
  descent_threshold_pct: number;
}

interface SettingsState {
  riderProfile: RiderProfile;
  bikeConfig: BikeConfig;
  bikes: BikeConfig[];
  activeBikeId: string;
  autoAssist: AutoAssistConfig;
  accessories: AccessoriesConfig;
  simulation_mode: boolean;

  updateRiderProfile: (partial: Partial<RiderProfile>) => void;
  updateBikeConfig: (partial: Partial<BikeConfig>) => void;
  updateAutoAssist: (partial: Partial<AutoAssistConfig>) => void;
  updateAccessories: (partial: Partial<AccessoriesConfig>) => void;
  setSimulationMode: (v: boolean) => void;
  addBike: (config: Partial<BikeConfig> & { name: string; bike_type: BikeConfig['bike_type'] }) => void;
  removeBike: (id: string) => void;
  selectBike: (id: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      riderProfile: DEFAULT_RIDER_PROFILE,
      bikeConfig: DEFAULT_BIKE_CONFIG,
      bikes: [DEFAULT_BIKE_CONFIG],
      activeBikeId: 'default',

      autoAssist: {
        enabled: false,
        lookahead_m: 300,
        preempt_distance_m: 50,
        override_duration_s: 60,
        battery_conservation: true,
        min_battery_reserve: 10,
        smoothing_window: 3,
        climb_threshold_pct: 3,
        descent_threshold_pct: -4,
      },

      accessories: { ...DEFAULT_ACCESSORIES_CONFIG },

      simulation_mode: false,

      updateRiderProfile: (partial) =>
        set((state) => ({
          riderProfile: { ...state.riderProfile, ...partial },
        })),

      updateBikeConfig: (partial) =>
        set((state) => {
          const updated = safeBikeConfig({ ...state.bikeConfig, ...partial });
          return {
            bikeConfig: updated,
            bikes: state.bikes.map((b) => b.id === state.activeBikeId ? updated : b),
          };
        }),

      updateAutoAssist: (partial) =>
        set((state) => ({
          autoAssist: { ...state.autoAssist, ...partial },
        })),

      updateAccessories: (partial) =>
        set((state) => ({
          accessories: { ...state.accessories, ...partial },
        })),

      setSimulationMode: (v) => set({ simulation_mode: v }),

      addBike: (config) => set((s) => {
        const id = crypto.randomUUID();
        const newBike: BikeConfig = { ...DEFAULT_BIKE_CONFIG, ...config, id };
        return { bikes: [...s.bikes, newBike], activeBikeId: id, bikeConfig: newBike };
      }),

      removeBike: (id) => set((s) => {
        const filtered = s.bikes.filter((b) => b.id !== id);
        if (filtered.length === 0) filtered.push(DEFAULT_BIKE_CONFIG);
        const activeId = s.activeBikeId === id ? filtered[0]!.id : s.activeBikeId;
        return { bikes: filtered, activeBikeId: activeId, bikeConfig: filtered.find((b) => b.id === activeId) ?? filtered[0]! };
      }),

      selectBike: (id) => set((s) => {
        const bike = s.bikes.find((b) => b.id === id);
        if (!bike) return {};
        return { activeBikeId: id, bikeConfig: bike };
      }),
    }),
    {
      name: 'bikecontrol-settings',
      // Deep merge on hydration — ensures new fields (tuning_max etc) get defaults
      merge: (persisted, current) => {
        const p = persisted as Partial<SettingsState> ?? {};
        return {
          ...current,
          ...p,
          bikeConfig: safeBikeConfig(p.bikeConfig),
          riderProfile: { ...(current as SettingsState).riderProfile, ...(p.riderProfile ?? {}) },
          autoAssist: { ...(current as SettingsState).autoAssist, ...(p.autoAssist ?? {}) },
          accessories: { ...DEFAULT_ACCESSORIES_CONFIG, ...(p.accessories ?? {}) },
        };
      },
    }
  )
);

/**
 * NutritionEngine — Layer 7: glycogen, hydration, electrolyte tracking.
 *
 * Consumes P_human from Layer 1 and HR zone from Layer 2.
 * Produces:
 *   - Glycogen depletion estimate → CP_effective correction for W' model
 *   - Hydration status from sweat rate (intensity + temperature + body mass)
 *   - Electrolyte (sodium) loss tracking
 *   - Timed nutrition alerts based on sport science guidelines
 *
 * Runs every 30s inside KromiEngine.
 */

// ── Constants ──────────────────────────────────────────────────

/** Carb burn fraction by HR zone (rest is fat) */
const CARB_FRACTION_BY_ZONE: Record<number, number> = {
  0: 0.30, // no HR data, assume low
  1: 0.35,
  2: 0.47,
  3: 0.70,
  4: 0.85,
  5: 0.95,
};

/** Mechanical efficiency of cycling (~24%) */
const MECHANICAL_EFFICIENCY = 0.24;

/** kcal per gram of glycogen */
const KCAL_PER_G_GLYCOGEN = 4.0;

/** Sodium loss per litre of sweat (mg) */
const SODIUM_PER_LITRE_SWEAT = 650; // midpoint of 500-800 range

/** Carb intake targets by dominant zone (g/hour) — used for future dashboard display */
// const CARB_TARGET_BY_ZONE = {
//   1: { min: 30, max: 45 }, 2: { min: 30, max: 45 }, 3: { min: 45, max: 60 },
//   4: { min: 60, max: 90 }, 5: { min: 60, max: 90 },
// };

/** Fluid intake targets by dominant zone (ml/hour) — used for future dashboard display */
// const FLUID_TARGET_BY_ZONE: Record<number, { min: number; max: number }> = {
//   1: { min: 500, max: 700 }, 2: { min: 500, max: 700 }, 3: { min: 700, max: 900 },
//   4: { min: 900, max: 1000 }, 5: { min: 900, max: 1000 },
// };

// ── Types ──────────────────────────────────────────────────────

export type NutritionStatus = 'green' | 'amber' | 'critical';

export interface NutritionState {
  // Glycogen
  glycogen_g: number;                // estimated remaining (g)
  glycogen_pct: number;              // % of initial reserves
  glycogen_status: NutritionStatus;
  glycogen_burn_rate_g_min: number;  // current consumption rate

  // Hydration
  fluid_deficit_ml: number;          // cumulative fluid lost (ml)
  sweat_rate_ml_h: number;           // current sweat rate
  hydration_status: NutritionStatus;

  // Electrolytes
  sodium_lost_mg: number;            // cumulative sodium lost
  electrolyte_status: NutritionStatus;

  // CP correction for W' model
  cp_factor: number;                 // 0.75-1.0, applied to CP_effective
  w_prime_factor: number;            // 0.70-1.0, applied to W'_effective

  // Intake tracking
  last_eat_ts: number;               // timestamp of last eat event
  last_drink_ts: number;             // timestamp of last drink event
  carbs_ingested_g: number;          // total carbs consumed this ride
  fluid_ingested_ml: number;         // total fluid consumed this ride

  // Alerts
  alerts: string[];

  // Ride duration
  ride_duration_min: number;
}

export interface NutritionInput {
  P_human: number;          // watts from PhysicsEngine
  hr_zone: number;          // 1-5 from PhysiologyEngine
  temp_c: number | null;    // from Environment layer
  rider_weight_kg: number;  // from profile
  ride_elapsed_s: number;   // seconds since ride start
}

export interface NutritionConfig {
  /** Initial glycogen reserves (g). Default based on weight. */
  initial_glycogen_g: number;
  /** Pre-ride meal: true if carb-rich meal within 3h */
  pre_ride_fed: boolean;
  /** Individual sweat rate correction (0.8-1.2) from calibration */
  sweat_rate_factor: number;
  /** Available products for specific recommendations */
  products: NutritionProduct[];
}

export interface NutritionProduct {
  name: string;
  carbs_g: number;
  fluid_ml: number;
  sodium_mg: number;
  type: 'solid' | 'chewable' | 'gel' | 'drink';
}

// ── Default products (common cycling nutrition) ────────────────

const DEFAULT_PRODUCTS: NutritionProduct[] = [
  { name: 'Barra energetica', carbs_g: 45, fluid_ml: 0, sodium_mg: 50, type: 'solid' },
  { name: 'Gel energetico', carbs_g: 22, fluid_ml: 0, sodium_mg: 60, type: 'gel' },
  { name: 'Banana', carbs_g: 25, fluid_ml: 20, sodium_mg: 1, type: 'solid' },
  { name: 'Isotonica 500ml', carbs_g: 30, fluid_ml: 500, sodium_mg: 350, type: 'drink' },
  { name: 'Agua 500ml', carbs_g: 0, fluid_ml: 500, sodium_mg: 0, type: 'drink' },
];

// ── Engine ─────────────────────────────────────────────────────

export class NutritionEngine {
  private glycogen_g: number;
  private initialGlycogen_g: number;
  private fluidDeficit_ml = 0;
  private sodiumLost_mg = 0;
  private lastEatTs = 0;
  private lastDrinkTs = 0;
  private carbsIngested_g = 0;
  private fluidIngested_ml = 0;
  private lastTickTs = 0;
  private config: NutritionConfig;

  // Accumulator for burn rate smoothing
  private recentBurnRates: number[] = [];

  constructor(config?: Partial<NutritionConfig>) {
    // Default glycogen: ~4.5g/kg lean body mass. For 135kg rider (est. ~60% lean = 81kg)
    // Range: 450-650g depending on diet and training status
    const defaultGlycogen = config?.pre_ride_fed ? 600 : 480;

    this.config = {
      initial_glycogen_g: config?.initial_glycogen_g ?? defaultGlycogen,
      pre_ride_fed: config?.pre_ride_fed ?? true,
      sweat_rate_factor: config?.sweat_rate_factor ?? 1.0,
      products: config?.products ?? DEFAULT_PRODUCTS,
    };

    this.glycogen_g = this.config.initial_glycogen_g;
    this.initialGlycogen_g = this.config.initial_glycogen_g;
  }

  /** Called every 30s from KromiEngine */
  tick(input: NutritionInput): NutritionState {
    const now = Date.now();
    const dt_s = this.lastTickTs > 0 ? (now - this.lastTickTs) / 1000 : 30;
    this.lastTickTs = now;

    const alerts: string[] = [];
    const rideDurationMin = input.ride_elapsed_s / 60;

    // ── Glycogen burn ──
    const carbFraction = CARB_FRACTION_BY_ZONE[input.hr_zone] ?? 0.47;
    // Total metabolic rate: P_human / efficiency
    const metabolicWatts = input.P_human / MECHANICAL_EFFICIENCY;
    // kcal/min = metabolicWatts / 69.7 (1 kcal/min ≈ 69.7 W)
    const kcal_per_min = metabolicWatts / 69.7;
    // Glycogen burn: only the carb fraction
    const glycogen_burn_g_min = (kcal_per_min * carbFraction) / KCAL_PER_G_GLYCOGEN;

    // Deplete
    const burned = glycogen_burn_g_min * (dt_s / 60);
    this.glycogen_g = Math.max(0, this.glycogen_g - burned);

    // Add back ingested carbs (already tracked via recordIntake)

    // Smooth burn rate
    this.recentBurnRates.push(glycogen_burn_g_min);
    if (this.recentBurnRates.length > 10) this.recentBurnRates.shift();
    const avgBurnRate = this.recentBurnRates.reduce((a, b) => a + b, 0) / this.recentBurnRates.length;

    const glycogen_pct = (this.glycogen_g / this.initialGlycogen_g) * 100;

    // ── Sweat rate ──
    // sweat_rate_L_h = 0.5 + (0.015 × P_human / 10) + (0.03 × (temp - 15))
    const tempFactor = input.temp_c !== null ? Math.max(0, (input.temp_c - 15) * 0.03) : 0;
    const sweatRate_L_h = (0.5 + (0.015 * input.P_human / 10) + tempFactor) * this.config.sweat_rate_factor;
    const sweatRate_ml_h = sweatRate_L_h * 1000;

    // Fluid deficit accumulation
    this.fluidDeficit_ml += (sweatRate_ml_h * dt_s) / 3600;

    // ── Sodium loss ──
    const sodiumThisTick = (SODIUM_PER_LITRE_SWEAT * sweatRate_L_h * dt_s) / 3600;
    this.sodiumLost_mg += sodiumThisTick;

    // ── Status levels ──
    let glycogen_status: NutritionStatus = 'green';
    if (glycogen_pct < 20) glycogen_status = 'critical';
    else if (glycogen_pct < 35) glycogen_status = 'amber';

    let hydration_status: NutritionStatus = 'green';
    const dehydration_pct = (this.fluidDeficit_ml / 1000) / (input.rider_weight_kg * 10) * 100;
    if (dehydration_pct > 3) hydration_status = 'critical';
    else if (dehydration_pct > 1.5) hydration_status = 'amber';

    let electrolyte_status: NutritionStatus = 'green';
    if (this.sodiumLost_mg > 2000) electrolyte_status = 'critical';
    else if (this.sodiumLost_mg > 1200) electrolyte_status = 'amber';

    // ── CP / W' correction from glycogen ──
    let cp_factor = 1.0;
    let w_prime_factor = 1.0;
    if (glycogen_pct < 20) {
      cp_factor = 0.75;
      w_prime_factor = 0.70;
    } else if (glycogen_pct < 35) {
      cp_factor = 0.88;
      w_prime_factor = 0.85;
    }

    // ── Alerts ──

    // Eat alert: first at 30-45 min, then based on time since last eat
    const timeSinceEatMin = this.lastEatTs > 0 ? (now - this.lastEatTs) / 60_000 : rideDurationMin;

    if (rideDurationMin >= 30 && timeSinceEatMin >= 40) {
      const foodType = this.recommendFoodType(input.hr_zone);
      alerts.push(`Come agora. ${foodType}. ${Math.round(timeSinceEatMin)} minutos sem ingestao.`);
    }

    // Drink alert: every 15-20 min based on sweat rate
    const timeSinceDrinkMin = this.lastDrinkTs > 0 ? (now - this.lastDrinkTs) / 60_000 : rideDurationMin;
    const drinkInterval = sweatRate_ml_h > 800 ? 15 : 20;
    if (rideDurationMin >= 15 && timeSinceDrinkMin >= drinkInterval) {
      const tempNote = input.temp_c !== null && input.temp_c > 25 ? ' Temperatura alta, transpiracao elevada.' : '';
      alerts.push(`Bebe.${tempNote}`);
    }

    // Zone-specific food advice
    if (input.hr_zone >= 4 && timeSinceEatMin >= 20 && timeSinceEatMin < 40) {
      alerts.push('Zona de esforco alta. Evita solidos. Usa gel.');
    }

    // Glycogen critical
    if (glycogen_status === 'critical') {
      alerts.push('Glicogenio estimado abaixo de 20%. Reduz intensidade ou come de imediato.');
    } else if (glycogen_status === 'amber') {
      alerts.push('Glicogenio estimado abaixo de 35%. Come nos proximos minutos.');
    }

    // Electrolyte alert
    if (rideDurationMin >= 120 && electrolyte_status !== 'green') {
      alerts.push(`Eletrolitos. ${Math.round(rideDurationMin / 60)} horas de ride, perdas acumuladas elevadas.`);
    }

    return {
      glycogen_g: Math.round(this.glycogen_g),
      glycogen_pct: Math.round(glycogen_pct),
      glycogen_status,
      glycogen_burn_rate_g_min: Math.round(avgBurnRate * 10) / 10,
      fluid_deficit_ml: Math.round(this.fluidDeficit_ml),
      sweat_rate_ml_h: Math.round(sweatRate_ml_h),
      hydration_status,
      sodium_lost_mg: Math.round(this.sodiumLost_mg),
      electrolyte_status,
      cp_factor,
      w_prime_factor,
      last_eat_ts: this.lastEatTs,
      last_drink_ts: this.lastDrinkTs,
      carbs_ingested_g: Math.round(this.carbsIngested_g),
      fluid_ingested_ml: Math.round(this.fluidIngested_ml),
      alerts: alerts.slice(0, 3),
      ride_duration_min: Math.round(rideDurationMin),
    };
  }

  // ── Intake Recording (called from UI buttons) ────────────

  /** Record eating a product */
  recordEat(product?: NutritionProduct): void {
    const p = product ?? this.config.products.find(p => p.type === 'solid') ?? { carbs_g: 40, fluid_ml: 0, sodium_mg: 50 };
    this.carbsIngested_g += p.carbs_g;
    this.fluidIngested_ml += p.fluid_ml;
    this.glycogen_g = Math.min(this.initialGlycogen_g, this.glycogen_g + p.carbs_g);
    this.fluidDeficit_ml = Math.max(0, this.fluidDeficit_ml - p.fluid_ml);
    this.sodiumLost_mg = Math.max(0, this.sodiumLost_mg - (p.sodium_mg ?? 0));
    this.lastEatTs = Date.now();
  }

  /** Record drinking */
  recordDrink(product?: NutritionProduct): void {
    const p = product ?? this.config.products.find(p => p.type === 'drink') ?? { carbs_g: 0, fluid_ml: 500, sodium_mg: 0 };
    this.carbsIngested_g += p.carbs_g;
    this.fluidIngested_ml += p.fluid_ml;
    this.glycogen_g = Math.min(this.initialGlycogen_g, this.glycogen_g + p.carbs_g);
    this.fluidDeficit_ml = Math.max(0, this.fluidDeficit_ml - p.fluid_ml);
    this.sodiumLost_mg = Math.max(0, this.sodiumLost_mg - (p.sodium_mg ?? 0));
    this.lastDrinkTs = Date.now();
  }

  /** Get available products by type suitable for current zone */
  getRecommendedProducts(hr_zone: number): NutritionProduct[] {
    if (hr_zone >= 4) {
      return this.config.products.filter(p => p.type === 'gel' || p.type === 'drink');
    }
    if (hr_zone >= 3) {
      return this.config.products.filter(p => p.type === 'chewable' || p.type === 'gel' || p.type === 'drink');
    }
    return this.config.products;
  }

  /** Update config (e.g., products, sweat rate calibration) */
  updateConfig(config: Partial<NutritionConfig>): void {
    Object.assign(this.config, config);
  }

  /** Calibrate sweat rate from pre/post ride weight difference */
  calibrateSweatRate(weight_before_kg: number, weight_after_kg: number, fluid_ingested_ml: number, ride_hours: number): void {
    if (ride_hours <= 0) return;
    const totalSweatLitres = (weight_before_kg - weight_after_kg) + (fluid_ingested_ml / 1000);
    const measuredRate = totalSweatLitres / ride_hours;
    // Adjust factor relative to model prediction
    if (measuredRate > 0) {
      this.config.sweat_rate_factor = Math.max(0.6, Math.min(1.5, measuredRate / 0.9));
    }
  }

  /** Reset for new ride */
  reset(config?: Partial<NutritionConfig>): void {
    if (config) this.updateConfig(config);
    const defaultGlycogen = this.config.pre_ride_fed ? 600 : 480;
    this.glycogen_g = this.config.initial_glycogen_g || defaultGlycogen;
    this.initialGlycogen_g = this.glycogen_g;
    this.fluidDeficit_ml = 0;
    this.sodiumLost_mg = 0;
    this.lastEatTs = 0;
    this.lastDrinkTs = 0;
    this.carbsIngested_g = 0;
    this.fluidIngested_ml = 0;
    this.lastTickTs = 0;
    this.recentBurnRates = [];
  }

  // ── Private ──────────────────────────────────────────────

  private recommendFoodType(zone: number): string {
    if (zone >= 4) return 'Gel ou bebida energetica';
    if (zone >= 3) return 'Barra mastigavel ou gel com agua';
    return 'Barra ou banana';
  }
}

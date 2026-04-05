/**
 * KromiEngine — 6-layer intelligence engine for e-bike motor control.
 *
 * Layer 1: Physics (1s)      — forces, 3-zone speed, P_total, P_human
 * Layer 2: Physiology (1s)   — HR zones, W' balance, drift, EF, IRC
 * Layer 3: Environment (60s) — wind, Crr_effective, air density, surface
 * Layer 4: Lookahead (10s)   — 4km rolling horizon, GPX or discovery
 * Layer 5: Battery (30s)     — Wh budget, constraint factor, projection
 * Layer 6: Learning (60s)    — CP/W' calibration, form multiplier, overrides
 *
 * tick() is synchronous — all slow operations happen in cached services.
 * Only active in POWER mode.
 */

import { useSettingsStore, safeBikeConfig } from '../../store/settingsStore';
import { useBikeStore } from '../../store/bikeStore';
import { calculateZones } from '../../types/athlete.types';
import type { TuningFactor } from '../motor/TuningIntelligence';
import {
  computeForces, airDensityFromTemp, windHeadComponent, surfaceToCrr,
  type PhysicsInput,
} from './PhysicsEngine';
import { PhysiologyEngine, type PhysiologyOutput } from './PhysiologyEngine';
import { getCachedWeather, type WeatherData } from '../weather/WeatherService';
import { getCachedOpenMeteo, fetchOpenMeteoWeather } from '../weather/OpenMeteoService';
import { getCachedTrail } from '../maps/TerrainService';
import { computeBatteryBudget, feedConsumption, type BatteryBudget } from '../autoAssist/BatteryOptimizer';
import { buildDiscoveryLookahead, type LookaheadResult } from '../autoAssist/ElevationPredictor';
import { RiderLearning } from '../autoAssist/RiderLearning';
import { elevationService } from '../maps/ElevationService';

// ── Constants ──────────────────────────────────────────────────

const SUPPORT_MIN = 50;
const SUPPORT_MAX = 350;
const TORQUE_MIN = 20;
const TORQUE_MAX = 85;
const LAUNCH_MIN = 1;
const LAUNCH_MAX = 7;
const EMA_ALPHA = 0.3;

// Layer intervals
const ENV_INTERVAL_MS = 60_000;
const LOOKAHEAD_INTERVAL_MS = 10_000;
const BATTERY_INTERVAL_MS = 30_000;
const LEARNING_INTERVAL_MS = 60_000;

// ── Types ──────────────────────────────────────────────────────

export interface KromiTickInput {
  speed_kmh: number;
  gradient_pct: number;
  cadence_rpm: number;
  power_watts: number;
  hr_bpm: number;
  currentGear: number;
  batterySoc: number;
  altitude: number | null;
  latitude: number;
  longitude: number;
  heading: number;
  distanceKm: number;
  gpsActive: boolean;
  upcomingGradient: number | null;
  distanceToChange: number | null;
}

export interface KromiTickOutput {
  supportPct: number;
  torqueNm: number;
  launchLvl: number;
  score: number;
  reason: string;
  factors: TuningFactor[];
  speedZone: 'active' | 'fade' | 'free';
  batteryFactor: number;
  gearSuggestion: number | null;
  physiology: PhysiologyOutput | null;
  alerts: string[];
}

// ── Engine ─────────────────────────────────────────────────────

class KromiEngine {
  private static instance: KromiEngine;

  // Sub-engines
  private physiology = new PhysiologyEngine(15000);
  private learning = new RiderLearning();

  // Smoothing state
  private prevSupport = 200;
  private prevTorque = 40;

  // Layer timers
  private lastEnvTick = 0;
  private lastLookaheadTick = 0;
  private lastBatteryTick = 0;
  private lastLearningTick = 0;

  // Cached layer outputs
  private cachedCrr = 0.006;
  private cachedWindComponent = 0;
  private cachedAirDensity = 1.225;
  private cachedTemp: number | null = null;
  private cachedBattery: BatteryBudget | null = null;
  private cachedLookahead: LookaheadResult | null = null;
  private cachedFormMultiplier = 1.0;

  // Pre-adjustment state
  private preAdjustTarget: { support: number; torque: number } | null = null;
  private preAdjustCountdown = 0;

  // Sustained effort tracker for CP calibration
  private sustainedEffortStart = 0;
  private sustainedEffortPowerSum = 0;
  private sustainedEffortSamples = 0;

  static getInstance(): KromiEngine {
    if (!KromiEngine.instance) {
      KromiEngine.instance = new KromiEngine();
    }
    return KromiEngine.instance;
  }

  /**
   * Main tick — called every 1s from useMotorControl.
   * Orchestrates all 6 layers at their respective cadences.
   */
  tick(input: KromiTickInput): KromiTickOutput {
    const now = Date.now();
    const factors: TuningFactor[] = [];
    const alerts: string[] = [];

    // ── Layer 3: Environment (every 60s) ──
    if (now - this.lastEnvTick > ENV_INTERVAL_MS) {
      this.tickEnvironment(input);
      this.lastEnvTick = now;
    }

    // ── Layer 5: Battery (every 30s) ──
    if (now - this.lastBatteryTick > BATTERY_INTERVAL_MS) {
      this.tickBattery(input);
      this.lastBatteryTick = now;
    }

    // ── Layer 6: Learning (every 60s) ──
    if (now - this.lastLearningTick > LEARNING_INTERVAL_MS) {
      this.tickLearning(input);
      this.lastLearningTick = now;
    }

    // ── Layer 4: Lookahead (every 10s) ──
    if (now - this.lastLookaheadTick > LOOKAHEAD_INTERVAL_MS) {
      this.tickLookahead(input);
      this.lastLookaheadTick = now;
    }

    // Feed battery consumption tracker
    const motorPower = useBikeStore.getState().power_watts;
    feedConsumption(motorPower, input.distanceKm);

    // ── Layer 1: Physics (every tick) ──
    const settings = useSettingsStore.getState();
    const rider = settings.riderProfile;
    const bike = safeBikeConfig(settings.bikeConfig);

    const totalMass = (rider.weight_kg || 135) + (bike.weight_kg || 24);
    const wheelCircumM = (bike.wheel_circumference_mm || 2290) / 1000;
    const chainring = parseInt(bike.chainring_teeth?.replace(/\D/g, '') || '34') || 34;
    const sprockets = bike.cassette_sprockets?.length >= 2
      ? [...bike.cassette_sprockets].sort((a, b) => b - a)
      : [51, 45, 39, 34, 30, 26, 23, 20, 17, 15, 13, 10];

    const physicsInput: PhysicsInput = {
      speed_kmh: input.speed_kmh,
      gradient_pct: input.gradient_pct,
      cadence_rpm: input.cadence_rpm,
      power_watts: input.power_watts,
      currentGear: input.currentGear,
      totalMass,
      wheelCircumM,
      chainring,
      sprockets,
      crr: this.learning.getAdjustedCrr(this.cachedCrr, getCachedTrail()?.category ?? 'unknown'),
      airDensity: this.cachedAirDensity,
      windComponent: this.cachedWindComponent,
    };

    const physics = computeForces(physicsInput);

    factors.push(
      { name: 'Fg', value: physics.F_gravity, detail: `${physics.F_gravity.toFixed(0)}N gravidade` },
      { name: 'Frr', value: physics.F_rolling, detail: `${physics.F_rolling.toFixed(0)}N rolling Crr=${physicsInput.crr.toFixed(4)}` },
      { name: 'Faero', value: physics.F_aero, detail: `${physics.F_aero.toFixed(0)}N aero vento=${this.cachedWindComponent.toFixed(1)}m/s` },
      { name: 'P_total', value: physics.P_total, detail: `${physics.P_total.toFixed(0)}W necessarios` },
      { name: 'P_human', value: physics.P_human, detail: `${physics.P_human.toFixed(0)}W rider` },
      { name: 'P_gap', value: physics.P_motor_gap, detail: `${physics.P_motor_gap.toFixed(0)}W motor gap` },
    );

    // ── Layer 2: Physiology (every tick) ──
    const zones = rider.zones?.length > 0
      ? rider.zones
      : calculateZones(rider.hr_max || 185);
    const targetZone = rider.target_zone || 2;

    const physio = this.physiology.tick({
      hr_bpm: input.hr_bpm,
      P_human: physics.P_human,
      gradient_pct: input.gradient_pct,
      speed_kmh: input.speed_kmh,
      zones,
      target_zone: targetZone,
      cp_watts: this.learning.getParams().cp_watts,
      w_prime_joules: this.learning.getParams().w_prime_joules,
      tau_seconds: this.learning.getParams().tau_seconds,
    });

    factors.push(
      { name: 'HR', value: physio.zone_current, detail: `Z${physio.zone_current} margem=${physio.margin_bpm}bpm` },
      { name: 'Drift', value: physio.drift_bpm_per_min, detail: `${physio.drift_bpm_per_min.toFixed(2)}bpm/min` },
      { name: 'W\'', value: physio.w_prime_balance * 100, detail: `${(physio.w_prime_balance * 100).toFixed(0)}% ${physio.w_prime_state}` },
      { name: 'EF', value: physio.ef_current, detail: `${physio.ef_current.toFixed(2)} W/bpm${physio.ef_degraded ? ' DEGRADADO' : ''}` },
    );

    // ── DECISION TREE (priority order) ──
    let supportPct = SUPPORT_MIN;
    let torqueNm = TORQUE_MIN;
    let launchLvl = 3;
    let reason = '';

    const batteryFactor = this.cachedBattery?.constraint_factor ?? 1.0;
    const formMultiplier = this.cachedFormMultiplier;
    const hrMod = physio.hrModifier;

    // Priority 1: W' critical → max support to protect athlete
    if (physio.flags.includes('w_prime_critical')) {
      supportPct = SUPPORT_MAX;
      torqueNm = TORQUE_MAX * 0.8;
      launchLvl = 5;
      reason = 'W\' critico — protecao maxima';
      alerts.push('Reserva anaerobica baixa. Mantem zona 2.');
    }
    // Priority 2: Zone breach imminent → pre-emptive
    else if (physio.flags.includes('zone_breach_imminent')) {
      supportPct = Math.min(SUPPORT_MAX, 280);
      torqueNm = Math.min(TORQUE_MAX, 65);
      launchLvl = 4;
      reason = `Breach Z${targetZone} em ${physio.t_breach_minutes.toFixed(0)}min — pre-emptivo`;
      alerts.push(`Fadiga cardiaca detetada. Reduz ritmo ${Math.ceil(physio.t_breach_minutes)} minutos.`);
    }
    // Priority 3: Battery emergency
    else if (this.cachedBattery?.is_emergency) {
      supportPct = SUPPORT_MIN + 20;
      torqueNm = TORQUE_MIN + 5;
      launchLvl = 2;
      reason = 'Bateria emergencia <5km';
      alerts.push('Bateria limitada. Modo emergencia.');
    }
    // Priority 4: Cardiac drift
    else if (physio.drift_bpm_per_min > 0.4) {
      // Reduce torque, smooth spikes
      const gapRatio = physics.P_total > 0 ? physics.P_motor_gap / physics.P_total : 0.5;
      supportPct = Math.max(SUPPORT_MIN, Math.min(SUPPORT_MAX, gapRatio * 300 * 0.8 * batteryFactor));
      torqueNm = Math.max(TORQUE_MIN, Math.min(TORQUE_MAX * 0.7, physics.F_total * (wheelCircumM / (2 * Math.PI))));
      launchLvl = 3;
      reason = `Drift ${physio.drift_bpm_per_min.toFixed(1)}bpm/min — torque reduzido`;
    }
    // Priority 5: Normal physics-based calculation
    else if (physics.speedZone !== 'free') {
      // Support from power gap ratio
      if (physics.P_human > 10) {
        const rawSupport = (physics.P_motor_gap / physics.P_human) * 100;
        supportPct = rawSupport * hrMod * physics.fadeFactor * batteryFactor * formMultiplier;
      } else if (physics.P_total > 20) {
        supportPct = 200 * hrMod * batteryFactor;
      }
      supportPct = Math.max(SUPPORT_MIN, Math.min(SUPPORT_MAX, supportPct));

      // Torque from resistance
      if (physics.F_total > 0) {
        const wheelRadius = wheelCircumM / (2 * Math.PI);
        torqueNm = physics.F_total * wheelRadius * hrMod * physics.fadeFactor * batteryFactor;
        torqueNm = Math.max(TORQUE_MIN, Math.min(TORQUE_MAX, torqueNm));
      }

      // Grinding uphill boost
      if (physics.cadence_effective > 0 && physics.cadence_effective < 50 && input.gradient_pct > 3) {
        torqueNm = Math.min(TORQUE_MAX, torqueNm * 1.3);
      }

      // Descent: minimal support
      if (input.gradient_pct < -3) {
        supportPct = Math.min(supportPct, SUPPORT_MIN + 20);
      }

      // Launch logic
      if (input.speed_kmh < 3 && input.gradient_pct > 5) launchLvl = 7;
      else if (input.speed_kmh < 3 && input.gradient_pct > 2) launchLvl = 5;
      else if (input.speed_kmh < 5) launchLvl = 4;
      else if (input.speed_kmh > 20) launchLvl = 1;

      reason = `Fisica: gap=${physics.P_motor_gap.toFixed(0)}W hr×${hrMod.toFixed(1)} bat×${batteryFactor.toFixed(2)}`;
    }
    // Motor off zone
    else {
      supportPct = SUPPORT_MIN;
      torqueNm = TORQUE_MIN;
      launchLvl = 1;
      reason = 'Motor off >25km/h';
    }

    // ── Pre-adjustment ramp (from lookahead) ──
    if (this.preAdjustTarget && this.preAdjustCountdown > 0 && this.preAdjustCountdown <= 5) {
      const blend = 1 - (this.preAdjustCountdown / 5); // 0→1 over 5s
      supportPct = supportPct + (this.preAdjustTarget.support - supportPct) * blend;
      torqueNm = torqueNm + (this.preAdjustTarget.torque - torqueNm) * blend;
      reason += ` [pre-adjust ${this.preAdjustCountdown.toFixed(0)}s]`;
    }
    if (this.preAdjustCountdown > 0) {
      this.preAdjustCountdown -= 1;
    }

    // ── Inefficient gear alert ──
    if (physics.inefficient_gear && input.speed_kmh > 3) {
      alerts.push('Muda para relacao mais pequena.');
    }

    // ── Battery constraint alert ──
    if (batteryFactor < 0.85 && batteryFactor > 0.2) {
      const remainKm = this.cachedBattery?.estimated_range_km ?? 0;
      alerts.push(`Bateria limitada. Reducao gradual nos proximos ${Math.round(remainKm)}km.`);
    }

    // ── Lookahead alerts ──
    if (this.cachedLookahead?.summary) {
      const la = this.cachedLookahead;
      if (la.next_transition_m && la.next_transition_gradient && la.next_transition_gradient > 8) {
        alerts.push(`Subida de ${Math.abs(la.next_transition_gradient).toFixed(0)}% a ${Math.round(la.next_transition_m)}m. Support aumentado.`);
      }
    }

    // ── EMA Smoothing (support and torque) ──
    supportPct = this.prevSupport + EMA_ALPHA * (supportPct - this.prevSupport);
    torqueNm = this.prevTorque + EMA_ALPHA * (torqueNm - this.prevTorque);
    this.prevSupport = supportPct;
    this.prevTorque = torqueNm;

    // Clamp final values
    supportPct = Math.max(SUPPORT_MIN, Math.min(SUPPORT_MAX, supportPct));
    torqueNm = Math.max(TORQUE_MIN, Math.min(TORQUE_MAX, torqueNm));
    launchLvl = Math.max(LAUNCH_MIN, Math.min(LAUNCH_MAX, launchLvl));

    const score = Math.round(((supportPct - SUPPORT_MIN) / (SUPPORT_MAX - SUPPORT_MIN)) * 100);

    // Record command for override detection
    this.learning.recordEngineCommand(supportPct, torqueNm, launchLvl);

    // Track sustained effort for CP calibration
    this.trackSustainedEffort(physics.P_human);

    return {
      supportPct, torqueNm, launchLvl, score, reason, factors,
      speedZone: physics.speedZone,
      batteryFactor,
      gearSuggestion: this.cachedLookahead?.gear_suggestion ?? null,
      physiology: physio,
      alerts: alerts.slice(0, 3), // max 3 alerts
    };
  }

  /** Map real value to wire 0-15 */
  static toWire(value: number, min: number, max: number): number {
    const clamped = Math.max(min, Math.min(max, value));
    return Math.round(((clamped - min) / (max - min)) * 15);
  }

  /** Reset all state for new ride or mode change */
  reset(): void {
    this.prevSupport = 200;
    this.prevTorque = 40;
    this.lastEnvTick = 0;
    this.lastLookaheadTick = 0;
    this.lastBatteryTick = 0;
    this.lastLearningTick = 0;
    this.cachedCrr = 0.006;
    this.cachedWindComponent = 0;
    this.cachedAirDensity = 1.225;
    this.cachedTemp = null;
    this.cachedBattery = null;
    this.cachedLookahead = null;
    this.cachedFormMultiplier = 1.0;
    this.preAdjustTarget = null;
    this.preAdjustCountdown = 0;
    this.sustainedEffortStart = 0;
    this.sustainedEffortPowerSum = 0;
    this.sustainedEffortSamples = 0;
    this.physiology.reset();
    this.learning.resetRide();
  }

  // ── Layer 3: Environment ─────────────────────────────────

  private tickEnvironment(input: KromiTickInput): void {
    // Weather: prefer Google, fallback to Open-Meteo
    let weather: WeatherData | null = getCachedWeather();
    if (!weather) {
      weather = getCachedOpenMeteo();
      if (!weather && input.gpsActive && input.latitude !== 0) {
        fetchOpenMeteoWeather(input.latitude, input.longitude);
      }
    }

    if (weather) {
      this.cachedWindComponent = windHeadComponent(
        weather.wind_speed_kmh, weather.wind_dir_deg, input.heading,
      );
      this.cachedAirDensity = airDensityFromTemp(weather.temp_c);
      this.cachedTemp = weather.temp_c;
    }

    // Surface → Crr
    const trail = getCachedTrail();
    if (trail) {
      this.cachedCrr = surfaceToCrr(trail.category);
    }
  }

  // ── Layer 4: Lookahead ───────────────────────────────────

  private tickLookahead(input: KromiTickInput): void {
    const profile = elevationService.getLastResult();
    if (!profile || profile.length < 2) return;

    const settings = useSettingsStore.getState();
    const bike = safeBikeConfig(settings.bikeConfig);
    const rider = settings.riderProfile;
    const totalMass = (rider.weight_kg || 135) + (bike.weight_kg || 24);
    const wheelCircumM = (bike.wheel_circumference_mm || 2290) / 1000;
    const chainring = parseInt(bike.chainring_teeth?.replace(/\D/g, '') || '34') || 34;
    const sprockets = bike.cassette_sprockets?.length >= 2
      ? [...bike.cassette_sprockets].sort((a, b) => b - a)
      : [51, 45, 39, 34, 30, 26, 23, 20, 17, 15, 13, 10];

    this.cachedLookahead = buildDiscoveryLookahead(
      profile, input.speed_kmh,
      {
        cadence_rpm: input.cadence_rpm,
        power_watts: input.power_watts,
        currentGear: input.currentGear,
        totalMass, wheelCircumM, chainring, sprockets,
        crr: this.cachedCrr,
        airDensity: this.cachedAirDensity,
        windComponent: this.cachedWindComponent,
      },
      sprockets,
      input.currentGear,
    );

    // Set up pre-adjustment if transition coming
    const la = this.cachedLookahead;
    if (la.seconds_to_transition !== null && la.seconds_to_transition < 15 && la.next_transition_gradient !== null) {
      // Calculate target params for upcoming gradient
      const upGrad = la.next_transition_gradient;
      if (Math.abs(upGrad) > 5) {
        // Estimate support/torque for upcoming gradient
        const gradRad = Math.atan(upGrad / 100);
        const Fg = totalMass * 9.81 * Math.sin(gradRad);
        const estTorque = Math.max(TORQUE_MIN, Math.min(TORQUE_MAX, Fg * (wheelCircumM / (2 * Math.PI))));
        const estSupport = upGrad > 0
          ? Math.min(SUPPORT_MAX, 150 + upGrad * 15)
          : SUPPORT_MIN;
        this.preAdjustTarget = { support: estSupport, torque: estTorque };
        this.preAdjustCountdown = la.seconds_to_transition;
      }
    }
  }

  // ── Layer 5: Battery ─────────────────────────────────────

  private tickBattery(input: KromiTickInput): void {
    this.cachedBattery = computeBatteryBudget(
      input.batterySoc,
      null, // TODO: route remaining km when GPX loaded
      this.cachedTemp,
    );
  }

  // ── Layer 6: Learning ────────────────────────────────────

  private tickLearning(_input: KromiTickInput): void {
    // Form multiplier from AdaptiveLearningEngine
    // For now, use learning params confidence as a proxy
    const params = this.learning.getParams();
    if (params.confidence > 0.5) {
      this.cachedFormMultiplier = 1.0; // will be refined as data accumulates
    }

    // Update physiology engine with calibrated CP/W'/τ
    this.physiology.calibrate(params.w_prime_joules, params.tau_seconds);
  }

  // ── CP Tracking ──────────────────────────────────────────

  private trackSustainedEffort(P_human: number): void {
    const cp = this.learning.getParams().cp_watts;

    if (P_human > cp * 0.8) {
      if (this.sustainedEffortStart === 0) {
        this.sustainedEffortStart = Date.now();
        this.sustainedEffortPowerSum = 0;
        this.sustainedEffortSamples = 0;
      }
      this.sustainedEffortPowerSum += P_human;
      this.sustainedEffortSamples++;

      // Check if we have 8+ minutes of sustained effort
      const durationS = (Date.now() - this.sustainedEffortStart) / 1000;
      if (durationS >= 480 && this.sustainedEffortSamples > 0) {
        const avgPower = this.sustainedEffortPowerSum / this.sustainedEffortSamples;
        this.learning.feedEffortSegment(avgPower, durationS);
        // Reset tracker
        this.sustainedEffortStart = 0;
        this.sustainedEffortPowerSum = 0;
        this.sustainedEffortSamples = 0;
      }
    } else {
      // Effort dropped below threshold, reset
      if (this.sustainedEffortStart > 0) {
        const durationS = (Date.now() - this.sustainedEffortStart) / 1000;
        if (durationS >= 480 && this.sustainedEffortSamples > 0) {
          // Still record if it was long enough
          const avgPower = this.sustainedEffortPowerSum / this.sustainedEffortSamples;
          this.learning.feedEffortSegment(avgPower, durationS);
        }
        this.sustainedEffortStart = 0;
        this.sustainedEffortPowerSum = 0;
        this.sustainedEffortSamples = 0;
      }
    }
  }

  // ── Accessors ────────────────────────────────────────────

  getPhysiology(): PhysiologyEngine { return this.physiology; }
  getLearning(): RiderLearning { return this.learning; }
  getCachedBattery(): BatteryBudget | null { return this.cachedBattery; }
  getCachedLookahead(): LookaheadResult | null { return this.cachedLookahead; }
}

export const kromiEngine = KromiEngine.getInstance();

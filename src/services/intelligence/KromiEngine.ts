/**
 * KromiEngine — 7-layer intelligence engine for e-bike motor control.
 *
 * Layer 1: Physics (1s)      — forces, 3-zone speed, P_total, P_human
 * Layer 2: Physiology (1s)   — HR zones, W' balance, drift, EF, IRC
 * Layer 3: Environment (60s) — wind, Crr_effective, air density, surface
 * Layer 4: Lookahead (10s)   — 4km rolling horizon, GPX or discovery
 * Layer 5: Battery (30s)     — Wh budget, constraint factor, projection
 * Layer 6: Learning (60s)    — CP/W' calibration, form multiplier, overrides
 * Layer 7: Nutrition (30s)   — glycogen, hydration, electrolytes → CP_effective
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
  estimateHeadwind, resetSpeedZone,
  CDA_PRESETS, CRR_TABLE, type CdaPreset,
  type PhysicsInput,
} from './PhysicsEngine';
import { PhysiologyEngine, type PhysiologyOutput } from './PhysiologyEngine';
import { getCachedWeather, type WeatherData } from '../weather/WeatherService';
import { getCachedOpenMeteo, fetchOpenMeteoWeather } from '../weather/OpenMeteoService';
import { getCachedTrail } from '../maps/TerrainService';
import { computeBatteryBudget, feedConsumption, type BatteryBudget } from '../autoAssist/BatteryOptimizer';
import { LookaheadController, type LookaheadResult } from '../autoAssist/ElevationPredictor';
import { RiderLearning } from '../autoAssist/RiderLearning';
import { NutritionEngine, type NutritionState } from './NutritionEngine';
import { terrainDiscovery } from './TerrainDiscovery';
import { elevationService } from '../maps/ElevationService';
import { terrainPatternLearner } from '../autoAssist/TerrainPatternLearner';
import { useRouteStore } from '../../store/routeStore';
import { useAutoAssistStore, type GearSuggestion } from '../../store/autoAssistStore';
import { autoAssistEngine } from '../autoAssist/AutoAssistEngine';

// ── Constants ──────────────────────────────────────────────────

const SUPPORT_MIN = 50;
const SUPPORT_MAX = 350;
const TORQUE_MIN = 20;
const TORQUE_MAX = 85;
const LAUNCH_MIN = 1;
const LAUNCH_MAX = 7;
// Adaptive EMA: faster at high speed (reliable data), slower at low speed (noisy GPS)
// Gap #20: kept as fallback when power data insufficient — see getAdaptiveAlpha()
function emaAlphaBySpeed(speedKmh: number): number {
  if (speedKmh > 15) return 0.35;  // responsive at riding speed
  if (speedKmh > 8) return 0.25;   // moderate
  if (speedKmh > 3) return 0.15;   // slow, GPS noisy
  return 0.08;                      // nearly stopped, very slow changes
}

// Layer intervals
const ENV_INTERVAL_MS = 60_000;
const LOOKAHEAD_INTERVAL_MS = 5_000; // Gap #13: reduced from 10s to 5s for faster terrain response
const BATTERY_INTERVAL_MS = 30_000;
const LEARNING_INTERVAL_MS = 60_000;
const NUTRITION_INTERVAL_MS = 30_000;

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
  /** Gap #9: Rich gear suggestion with timing & reason */
  gearSuggestionDetail: GearSuggestion | null;
  physiology: PhysiologyOutput | null;
  nutrition: NutritionState | null;
  /** Gap #11: Auto-detected terrain from speed variance */
  autoTerrain: string;
  /** Gap #11: Active Crr being used (after terrain adjustment) */
  activeCrr: number;
  /** Real-time elevation tracking */
  elevation: {
    totalAscent_m: number;
    totalDescent_m: number;
    currentClimbGain_m: number;
    isInClimb: boolean;
  };
  alerts: string[];
}

// ── Gap #14: Within-ride climb pattern recognition ──────────
interface ClimbPattern {
  startGradient: number;
  peakGradient: number;
  duration_s: number;
  avgPower: number;
  supportUsed: number;
}

// ── Gap #15: Speed event logging ────────────────────────────
interface SpeedEvent {
  timestamp: number;
  speed_kmh: number;
  duration_s: number;
  location?: { lat: number; lng: number };
  assistActive: boolean;
}

// ── Gap #15: Regional compliance ────────────────────────────
export type ComplianceRegion = 'eu' | 'us' | 'au' | 'jp';

export interface ComplianceConfig {
  speedLimit_kmh: number;
  fadeStart_kmh: number;
  hardCutoff: boolean;
  maxPower_w: number;
}

export const COMPLIANCE_CONFIGS: Record<ComplianceRegion, ComplianceConfig> = {
  eu: { speedLimit_kmh: 25, fadeStart_kmh: 22, hardCutoff: false, maxPower_w: 250 },
  us: { speedLimit_kmh: 32, fadeStart_kmh: 28, hardCutoff: false, maxPower_w: 750 },
  au: { speedLimit_kmh: 25, fadeStart_kmh: 22, hardCutoff: true, maxPower_w: 250 },
  jp: { speedLimit_kmh: 24, fadeStart_kmh: 21, hardCutoff: true, maxPower_w: 250 },
};

// ── Engine ─────────────────────────────────────────────────────

class KromiEngine {
  private static instance: KromiEngine;

  // Sub-engines
  private physiology = new PhysiologyEngine(15000);
  private learning = new RiderLearning();
  private nutrition = new NutritionEngine();
  private lookaheadCtrl = new LookaheadController();

  // Smoothing state
  private prevSupport = 200;
  private prevTorque = 40;

  // Gap #9: Gradient EMA smoothing (adaptive alpha based on speed + barometer)
  private smoothedGradient = 0;
  private lastSpeed: number | null = null;

  // Gap #20: Power variance-based adaptive EMA alpha
  private recentPowerValues: number[] = [];

  // Gap #12: Adaptive ramp — last gradient for delta calculation
  private lastGradientForRamp = 0;

  // ── Gap #12 (Motor Disconnect Recovery) ─────────────────
  private lastMotorTelemetryMs = 0;
  private motorConnected = true;
  private readonly MOTOR_TIMEOUT_MS = 5000;

  // ── Gap #14: Within-ride climb learning ─────────────────
  private rideClimbs: ClimbPattern[] = [];
  private currentClimb: { startTime: number; gradients: number[]; powers: number[]; supports: number[] } | null = null;

  // ── Low power mode — reduces processing when stopped/motor off ──
  private lowPowerMode = false;
  private tickSkipCounter = 0;
  private lastTickOutput: KromiTickOutput | null = null;

  // ── Gap #15: Speed event logging ────────────────────────
  private speedEvents: SpeedEvent[] = [];
  private speedExceedStartMs = 0;

  // Layer timers
  private lastEnvTick = 0;
  private lastLookaheadTick = 0;
  private lastBatteryTick = 0;
  private lastLearningTick = 0;
  private lastNutritionTick = 0;

  // Cached layer outputs
  private cachedCrr = 0.006;
  private cachedWindComponent = 0;
  private cachedAirDensity = 1.225;
  private cachedTemp: number | null = null;
  private cachedBattery: BatteryBudget | null = null;
  private cachedLookahead: LookaheadResult | null = null;
  private cachedFormMultiplier = 1.0;
  private cachedNutrition: NutritionState | null = null;
  private rideStartTs = 0;

  // Pre-adjustment state
  private preAdjustTarget: { support: number; torque: number } | null = null;
  private preAdjustCountdown = 0;
  private preAdjustStartGradient = 0; // gradient that triggered the ramp

  // Gap #1 (PWA↔APK heartbeat): parameter version tracking + periodic re-broadcast
  private paramVersion = 0;
  private lastParamPushMs = 0;
  private paramsChanged = false;
  private readonly PARAM_HEARTBEAT_MS = 30_000; // re-broadcast every 30s

  // Gap #5: Battery factor smoothing
  private smoothedBatteryFactor = 1.0;
  private readonly BATTERY_RAMP_ALPHA = 0.1; // 10% per tick = ~10s to full change

  // Gap #4: KromiEngine active flag for AutoAssistEngine coordination
  private kromiEngineActive = false;

  // Gap #3: Last GPS timestamp for dead-reckoning detection
  private lastGpsTs = 0;

  // ── Barometric altitude fusion for real-time gradient ──
  private prevCorrectedAlt: number | null = null;

  // ── Real-time ascent/descent tracking ──
  private rideElevation = {
    totalAscent_m: 0,
    totalDescent_m: 0,
    lastSmoothedAlt: 0,
    altInitialized: false,
    // Running climb detector
    currentClimbGain_m: 0,
    currentClimbStart_m: 0,
    isInClimb: false,
  };

  // Sustained effort tracker for CP calibration
  private sustainedEffortStart = 0;
  private sustainedEffortPowerSum = 0;
  private sustainedEffortSamples = 0;

  // Gap #9: Rich gear suggestion from lookahead
  private cachedGearSuggestion: GearSuggestion | null = null;

  // Gap #11: Micro-terrain auto-detection from speed variance
  private speedHistory: number[] = [];
  private readonly SPEED_HISTORY_SIZE = 30; // 30 seconds of data
  private manualTerrainOverride: string | null = null;
  private lastAutoTerrain = 'dirt';
  private lastManualTerrain: string | null = null;

  // Gap #11 (extended): Terrain detection accuracy tracking
  private terrainDetectionHistory: { auto: string; manual: string | null; ts: number }[] = [];
  private trustAutoTerrain = true;

  static getInstance(): KromiEngine {
    if (!KromiEngine.instance) {
      KromiEngine.instance = new KromiEngine();
      // Gap #8: Load terrain patterns from previous rides on first instantiation
      terrainPatternLearner.load();
    }
    return KromiEngine.instance;
  }

  // ── Gap #4: Active state for AutoAssistEngine coordination ──
  /** Mark KromiEngine as active — AutoAssistEngine should defer decisions */
  start(): void {
    this.kromiEngineActive = true;
  }

  /** Mark KromiEngine as inactive — AutoAssistEngine can take over */
  stop(): void {
    this.kromiEngineActive = false;
  }

  /** Whether KromiEngine is actively controlling the motor */
  isActive(): boolean {
    return this.kromiEngineActive;
  }

  // ── Gap #12: Motor Disconnect Recovery ─────────────────
  /** Call when any BLE telemetry arrives from motor */
  onMotorTelemetry(): void {
    this.lastMotorTelemetryMs = Date.now();
    if (!this.motorConnected) {
      console.log('[KromiEngine] Motor reconnected — resuming layer processing');
      this.motorConnected = true;
      this.requestStateRefresh();
    }
  }

  private checkMotorConnection(): void {
    if (this.lastMotorTelemetryMs > 0) {
      const elapsed = Date.now() - this.lastMotorTelemetryMs;
      if (elapsed > this.MOTOR_TIMEOUT_MS && this.motorConnected) {
        console.warn(`[KromiEngine] Motor telemetry timeout (${elapsed}ms) — freezing outputs`);
        this.motorConnected = false;
      }
    }
  }

  private requestStateRefresh(): void {
    this.paramVersion++;
    this.paramsChanged = true;
    this.pushParamsWithHeartbeat();
    console.log('[KromiEngine] Full state refresh requested after reconnect');
  }

  /** Whether motor is currently connected (receiving telemetry) */
  isMotorConnected(): boolean {
    return this.motorConnected;
  }

  // ── Gap #9: Adaptive Gradient EMA (speed + barometer aware) ──
  private smoothGradient(rawGradient: number): number {
    const speed = this.lastSpeed ?? 0;
    const hasBaro = useBikeStore.getState().barometric_altitude_m > 0;

    let alpha: number;
    if (speed < 5) {
      alpha = 0.08;  // stopped/very slow — GPS very noisy, heavy smooth
    } else if (speed < 10) {
      alpha = 0.12;  // slow climbing — noisy
    } else if (speed < 20) {
      alpha = hasBaro ? 0.30 : 0.20; // medium speed — moderate smooth
    } else {
      alpha = hasBaro ? 0.40 : 0.30; // fast — more responsive
    }

    // Additional damping for extreme gradient spikes (likely sensor error)
    const delta = Math.abs(rawGradient - this.smoothedGradient);
    if (delta > 8) {
      alpha *= 0.5; // halve responsiveness for big jumps
    }

    this.smoothedGradient = alpha * rawGradient + (1 - alpha) * this.smoothedGradient;
    return this.smoothedGradient;
  }

  // ── Real-time elevation stats (ascent/descent/climb detection) ──
  private updateElevationStats(smoothedGradient: number, speedKmh: number): void {
    const distM = speedKmh / 3.6; // distance per tick (1s)
    if (distM < 0.5) return; // too slow for meaningful tracking

    const elevChange = distM * (smoothedGradient / 100);

    // Minimum threshold to avoid noise accumulation
    // (iGPSPORT/Garmin use ~2m/km minimum for counting)
    if (smoothedGradient > 0.5) {
      this.rideElevation.totalAscent_m += elevChange;

      // Climb tracking
      if (!this.rideElevation.isInClimb && smoothedGradient > 3) {
        this.rideElevation.isInClimb = true;
        this.rideElevation.currentClimbGain_m = 0;
        this.rideElevation.currentClimbStart_m = this.rideElevation.totalAscent_m;
      }
      if (this.rideElevation.isInClimb) {
        this.rideElevation.currentClimbGain_m += elevChange;
      }
    } else if (smoothedGradient < -0.5) {
      this.rideElevation.totalDescent_m += Math.abs(elevChange);

      // End climb if descending
      if (this.rideElevation.isInClimb && smoothedGradient < -1) {
        this.rideElevation.isInClimb = false;
      }
    } else {
      // Flat section — end climb if sustained
      if (this.rideElevation.isInClimb && smoothedGradient < 1) {
        this.rideElevation.isInClimb = false;
      }
    }
  }

  getRideElevation() {
    return {
      totalAscent_m: Math.round(this.rideElevation.totalAscent_m),
      totalDescent_m: Math.round(this.rideElevation.totalDescent_m),
      currentClimbGain_m: Math.round(this.rideElevation.currentClimbGain_m),
      isInClimb: this.rideElevation.isInClimb,
    };
  }

  // ── Gap #12: Adaptive ramp duration ────────────────────
  private calculateRampDuration(gradientDelta: number): number {
    const absDelta = Math.abs(gradientDelta);
    if (absDelta > 8) return 2;    // steep change: fast ramp (2s)
    if (absDelta > 4) return 4;    // moderate change: medium ramp (4s)
    return 8;                       // gentle change: slow ramp (8s)
  }

  // ── Gap #2 (Reactive Ramps): recalculate ramp target when gradient shifts mid-ramp ──
  private recalculateRampTarget(currentGradient: number): void {
    if (!this.preAdjustTarget) return;

    const settings = useSettingsStore.getState();
    const rider = settings.riderProfile;
    const bike = safeBikeConfig(settings.bikeConfig);
    const totalMass = (rider.weight_kg || 135) + (bike.weight_kg || 24);
    const wheelCircumM = (bike.wheel_circumference_mm || 2290) / 1000;

    const gradRad = Math.atan(currentGradient / 100);
    const Fg = totalMass * 9.81 * Math.sin(gradRad);
    const estTorque = Math.max(TORQUE_MIN, Math.min(TORQUE_MAX, Fg * (wheelCircumM / (2 * Math.PI))));
    const estSupport = currentGradient > 0
      ? Math.min(SUPPORT_MAX, 150 + currentGradient * 15)
      : SUPPORT_MIN;

    this.preAdjustTarget = { support: estSupport, torque: estTorque };
    this.preAdjustStartGradient = currentGradient;
  }

  // ── Gap #5: Battery factor smoothing (ramp over ~10s when large change) ──
  private smoothBatteryFactor(newFactor: number): number {
    const delta = Math.abs(newFactor - this.smoothedBatteryFactor);
    if (delta > 0.2) {
      // Large change — ramp gradually to avoid sudden assist drop
      this.smoothedBatteryFactor += (newFactor - this.smoothedBatteryFactor) * this.BATTERY_RAMP_ALPHA;
    } else {
      this.smoothedBatteryFactor = newFactor;
    }
    return this.smoothedBatteryFactor;
  }

  // ── Gap #5: Hard battery ceiling for route completion guarantee ──
  private enforceRouteBudget(supportPct: number, batteryWh: number, distRemainingKm: number): number {
    if (distRemainingKm <= 0) return supportPct; // no route, no budget enforcement

    const avgConsumptionWhPerKm = 15; // baseline, should use rolling average
    const whNeeded = distRemainingKm * avgConsumptionWhPerKm;

    if (batteryWh < whNeeded * 1.1) {
      // Less than 10% margin — cap support to guarantee finish
      const maxSupportForBudget = (batteryWh / whNeeded) * supportPct;
      if (maxSupportForBudget < supportPct) {
        console.log(`[Battery] Route budget cap: ${supportPct.toFixed(0)}% → ${maxSupportForBudget.toFixed(0)}%`);
        return maxSupportForBudget;
      }
    }
    return supportPct;
  }

  // ── Gap #1 (PWA↔APK heartbeat): push params with version + periodic re-broadcast ──
  private pushParamsWithHeartbeat(): void {
    const now = Date.now();
    const forcePush = now - this.lastParamPushMs > this.PARAM_HEARTBEAT_MS;

    if (forcePush || this.paramsChanged) {
      this.paramVersion++;
      this.lastParamPushMs = now;
      this.paramsChanged = false;
      this.pushParamsToNative();
    }
  }

  // ── Gap #20: Power variance-based adaptive alpha ───────
  private getAdaptiveAlpha(speedKmh: number): number {
    if (this.recentPowerValues.length < 3) return emaAlphaBySpeed(speedKmh);

    const mean = this.recentPowerValues.reduce((a, b) => a + b, 0) / this.recentPowerValues.length;
    if (mean < 10) return 0.1; // very low power, slow response

    const variance = this.recentPowerValues.reduce((sum, v) => sum + (v - mean) ** 2, 0) / this.recentPowerValues.length;
    const cv = Math.sqrt(variance) / mean;

    // High variance (bumpy terrain/intervals): slow alpha to dampen
    // Low variance (steady state): fast alpha to be responsive
    if (cv > 0.5) return 0.1;   // very noisy: heavy smoothing
    if (cv > 0.3) return 0.2;   // moderate noise
    if (cv > 0.1) return 0.35;  // normal riding
    return 0.5;                  // very stable: quick response
  }

  // ── Gap #9: Rich gear suggestion from lookahead ────────
  private calculateGearSuggestion(
    currentGear: number,
    _currentCadence: number,
    currentSpeed: number,
    nextGradient: number,
    secondsToTransition: number,
    sprockets: number[],
    chainring: number,
    wheelCircumM: number,
  ): GearSuggestion | null {
    if (secondsToTransition > 10 || secondsToTransition < 3) return null;

    const TARGET_CADENCE = 80; // rpm target for optimal efficiency

    // Estimate what speed we'll have on the next gradient
    const estimatedSpeed = Math.max(5, currentSpeed - nextGradient * 1.5); // km/h
    const speedMs = estimatedSpeed / 3.6;

    // Find gear that gives closest to TARGET_CADENCE at estimated speed
    let bestGear = currentGear;
    let bestCadenceDiff = Infinity;

    for (let g = 0; g < sprockets.length; g++) {
      const ratio = chainring / sprockets[g]!;
      const cadence = (speedMs * 60) / (ratio * wheelCircumM);
      const diff = Math.abs(cadence - TARGET_CADENCE);
      if (diff < bestCadenceDiff) {
        bestCadenceDiff = diff;
        bestGear = g + 1; // 1-indexed
      }
    }

    // Only suggest if different from current and improvement is significant
    if (bestGear === currentGear) return null;
    if (bestCadenceDiff > 30) return null; // can't hit target cadence in any gear

    const reason = nextGradient > 3 ? 'upcoming_climb'
      : nextGradient < -3 ? 'upcoming_descent'
      : 'cadence_optimization';

    return {
      suggestedGear: bestGear,
      currentGear,
      reason,
      secondsUntilTransition: secondsToTransition,
      targetCadence: TARGET_CADENCE,
      targetGradient: nextGradient,
    };
  }

  // ── Gap #11: Micro-terrain auto-detection ──────────────
  private trackSpeedVariance(speed: number): void {
    this.speedHistory.push(speed);
    if (this.speedHistory.length > this.SPEED_HISTORY_SIZE) {
      this.speedHistory.shift();
    }
  }

  private getSpeedVariance(): number {
    if (this.speedHistory.length < 5) return 0;
    const mean = this.speedHistory.reduce((a, b) => a + b, 0) / this.speedHistory.length;
    if (mean < 3) return 0; // too slow, variance meaningless
    const variance = this.speedHistory.reduce((sum, v) => sum + (v - mean) ** 2, 0) / this.speedHistory.length;
    return Math.sqrt(variance);
  }

  private detectMicroTerrain(): string {
    const variance = this.getSpeedVariance();
    const avgSpeed = this.speedHistory.length > 0
      ? this.speedHistory.reduce((a, b) => a + b, 0) / this.speedHistory.length
      : 0;

    if (avgSpeed > 25) return 'paved';
    if (variance > 5 && avgSpeed < 12) return 'technical';
    if (variance > 3 && avgSpeed < 18) return 'dirt';
    if (variance > 2) return 'gravel';
    return 'paved';
  }

  /** Allow manual terrain override (null = auto-detect) */
  setManualTerrain(terrain: string | null): void {
    // Gap #11 (extended): Track auto vs manual for accuracy validation
    if (terrain) {
      this.lastManualTerrain = terrain;
      this.trackTerrainAccuracy(this.lastAutoTerrain, terrain);
    }
    this.manualTerrainOverride = terrain;
  }

  // ── Gap #11 (extended): Terrain detection accuracy tracking ──

  /**
   * Track auto-detected terrain vs manual terrain selection.
   * When accuracy drops below 70% (with 20+ samples), auto-detection
   * is distrusted and manual/last-manual terrain is preferred.
   */
  private trackTerrainAccuracy(autoTerrain: string, manualTerrain: string | null): void {
    if (!manualTerrain) return;

    this.terrainDetectionHistory.push({ auto: autoTerrain, manual: manualTerrain, ts: Date.now() });

    // Keep last 100 samples
    if (this.terrainDetectionHistory.length > 100) this.terrainDetectionHistory.shift();

    // Calculate accuracy
    const correct = this.terrainDetectionHistory.filter(h => h.auto === h.manual).length;
    const accuracy = correct / this.terrainDetectionHistory.length;

    if (accuracy < 0.7 && this.terrainDetectionHistory.length >= 20) {
      console.warn(`[Terrain] Auto-detection accuracy ${(accuracy * 100).toFixed(0)}% — using manual terrain preference`);
      this.trustAutoTerrain = false;
    } else {
      this.trustAutoTerrain = true;
    }
  }

  // ── Gap #14: Within-ride climb pattern tracking ──────────

  private trackClimbPatterns(gradient: number, power: number, support: number): void {
    const isClimbing = gradient > 3;

    if (isClimbing && !this.currentClimb) {
      this.currentClimb = {
        startTime: Date.now(),
        gradients: [gradient],
        powers: [power],
        supports: [support],
      };
    } else if (isClimbing && this.currentClimb) {
      this.currentClimb.gradients.push(gradient);
      this.currentClimb.powers.push(power);
      this.currentClimb.supports.push(support);
    } else if (!isClimbing && this.currentClimb) {
      const duration = (Date.now() - this.currentClimb.startTime) / 1000;
      if (duration > 30) {
        const pattern: ClimbPattern = {
          startGradient: this.currentClimb.gradients[0]!,
          peakGradient: Math.max(...this.currentClimb.gradients),
          duration_s: duration,
          avgPower: this.currentClimb.powers.reduce((a, b) => a + b, 0) / this.currentClimb.powers.length,
          supportUsed: this.currentClimb.supports.reduce((a, b) => a + b, 0) / this.currentClimb.supports.length,
        };
        this.rideClimbs.push(pattern);
        console.log(`[ClimbLearn] Climb ${this.rideClimbs.length}: ${duration.toFixed(0)}s, peak ${pattern.peakGradient.toFixed(1)}%, avg power ${pattern.avgPower.toFixed(0)}W`);
      }
      this.currentClimb = null;
    }
  }

  /** When a new climb starts, check if similar to previous climbs in this ride */
  private getSimilarClimbSupport(gradient: number): number | null {
    if (this.rideClimbs.length < 2) return null;

    const similar = this.rideClimbs.filter(c =>
      Math.abs(c.startGradient - gradient) < 2
    );

    if (similar.length === 0) return null;

    const avgSupport = similar.reduce((sum, c) => sum + c.supportUsed, 0) / similar.length;
    console.log(`[ClimbLearn] Similar climb found (${similar.length} matches) — suggesting ${avgSupport.toFixed(0)}% support`);
    return avgSupport;
  }

  // ── Gap #14: Turn-aware pre-adjustment ───────────────────

  /** Check navigation for upcoming turns and reduce support to prevent overshoot */
  private checkUpcomingTurn(): number {
    const nav = useRouteStore.getState().navigation;
    if (!nav.active || nav.distanceToNextEvent_m == null) return 1.0;

    const bikeSpeed = useBikeStore.getState().speed_kmh;
    if (bikeSpeed < 5) return 1.0;

    const secondsToTurn = nav.distanceToNextEvent_m / (bikeSpeed / 3.6);
    if (secondsToTurn > 0 && secondsToTurn < 10) {
      console.log(`[Navigation] Turn in ${secondsToTurn.toFixed(0)}s — reducing support`);
      return 0.7;
    }
    return 1.0;
  }

  // ── Low power mode — skip ticks when stopped or motor off ──

  private checkLowPowerMode(speed: number, assistMode: number): void {
    const shouldBeLowPower = speed < 2 || assistMode === 0; // stopped or motor off

    if (shouldBeLowPower && !this.lowPowerMode) {
      console.log('[KromiEngine] Entering low power mode');
      this.lowPowerMode = true;
    } else if (!shouldBeLowPower && this.lowPowerMode) {
      console.log('[KromiEngine] Exiting low power mode');
      this.lowPowerMode = false;
      this.tickSkipCounter = 0;
    }
  }

  // ── Gap #15: Speed event logging ─────────────────────────

  private logSpeedEvent(speed: number, lat?: number, lng?: number, assistActive?: boolean): void {
    if (speed > 25) {
      if (this.speedExceedStartMs === 0) {
        this.speedExceedStartMs = Date.now();
      }
    } else {
      if (this.speedExceedStartMs > 0) {
        const duration = (Date.now() - this.speedExceedStartMs) / 1000;
        this.speedEvents.push({
          timestamp: this.speedExceedStartMs,
          speed_kmh: speed,
          duration_s: duration,
          location: lat && lng ? { lat, lng } : undefined,
          assistActive: assistActive ?? false,
        });
        this.speedExceedStartMs = 0;

        if (this.speedEvents.length > 1000) this.speedEvents.shift();
      }
    }
  }

  /** Get all speed exceed events for this ride (for compliance reporting) */
  getSpeedEventLog(): SpeedEvent[] {
    return [...this.speedEvents];
  }

  /**
   * Main tick — called every 1s from useMotorControl.
   * Orchestrates all 6 layers at their respective cadences.
   */
  tick(input: KromiTickInput): KromiTickOutput {
    const now = Date.now();
    const factors: TuningFactor[] = [];
    const alerts: string[] = [];

    // ── Gap #12: Motor disconnect recovery — freeze outputs when motor offline ──
    this.checkMotorConnection();
    if (!this.motorConnected) {
      return {
        supportPct: this.prevSupport, torqueNm: this.prevTorque, launchLvl: 3,
        score: 0, reason: 'Motor offline — outputs frozen', factors: [],
        speedZone: 'active', batteryFactor: this.smoothedBatteryFactor,
        gearSuggestion: null, gearSuggestionDetail: null,
        physiology: null, nutrition: this.cachedNutrition,
        autoTerrain: this.lastAutoTerrain, activeCrr: this.cachedCrr,
        elevation: this.getRideElevation(),
        alerts: ['Motor desligado — a aguardar reconexao'],
      };
    }

    // ── Low power mode: skip 4 out of 5 ticks when stopped/motor off ──
    const bikeAssistMode = useBikeStore.getState().assist_mode;
    this.checkLowPowerMode(input.speed_kmh, bikeAssistMode);

    if (this.lowPowerMode) {
      this.tickSkipCounter++;
      // In low power: only process every 5th tick (5s instead of 1s)
      if (this.tickSkipCounter % 5 !== 0 && this.lastTickOutput) {
        return this.lastTickOutput;
      }
    }

    // ── Layer 3: Environment (every 60s) ──
    if (now - this.lastEnvTick > ENV_INTERVAL_MS) {
      this.tickEnvironment(input);
      this.lastEnvTick = now;
      this.paramsChanged = true;
    }

    // ── Layer 5: Battery (every 30s) ──
    if (now - this.lastBatteryTick > BATTERY_INTERVAL_MS) {
      this.tickBattery(input);
      this.lastBatteryTick = now;
      this.paramsChanged = true;
    }

    // ── Layer 6: Learning (every 60s) ──
    if (now - this.lastLearningTick > LEARNING_INTERVAL_MS) {
      this.tickLearning(input);
      this.lastLearningTick = now;
      this.paramsChanged = true;
    }

    // ── Layer 7: Nutrition (every 30s) ──
    if (now - this.lastNutritionTick > NUTRITION_INTERVAL_MS) {
      this.lastNutritionTick = now;
      // Deferred: needs P_human and physio from current tick, runs below after Layer 2
    }

    // ── Layer 4: Lookahead (every 10s) ──
    if (now - this.lastLookaheadTick > LOOKAHEAD_INTERVAL_MS) {
      this.tickLookahead(input);
      this.lastLookaheadTick = now;
      this.paramsChanged = true;
    }

    // Send gradient to native KromiCore every tick (it needs this for physics)
    const bridge = (window as unknown as Record<string, unknown>).KromiBridge as
      | { setGradient?: (g: number) => void }
      | undefined;
    bridge?.setGradient?.(input.gradient_pct);

    // Feed battery consumption tracker
    const motorPower = useBikeStore.getState().power_watts;
    feedConsumption(motorPower, input.distanceKm);

    // Feed terrain discovery (always, even with route — builds cache for future rides)
    if (input.gpsActive && input.latitude !== 0 && input.altitude != null) {
      terrainDiscovery.feed(input.latitude, input.longitude, input.altitude, input.distanceKm, input.speed_kmh);

      // Gap #7: Bootstrap cold start gradient from GPS altitude
      this.lookaheadCtrl.bootstrapFromGps(input.altitude, input.distanceKm);
    }

    // ── Gap #1: Feed barometric altitude to lookahead controller ──
    const bikeState = useBikeStore.getState();
    const baroAlt = bikeState.barometric_altitude_m;
    if (baroAlt > 0) {
      this.lookaheadCtrl.setBarometricAltitude(baroAlt);
    }
    this.lookaheadCtrl.setGpsAltitude(input.altitude);

    // ── Gap #2 + Gap #9: Feed heading + distance to lookahead for switchback detection ──
    this.lookaheadCtrl.trackHeading(input.heading);
    this.lookaheadCtrl.setCurrentDistance(input.distanceKm);

    // ── Gap #3: Dead-reckoning detection ──
    if (input.gpsActive && input.latitude !== 0) {
      this.lastGpsTs = now;
    }
    this.lookaheadCtrl.detectGpsLoss(this.lastGpsTs, input.latitude, input.longitude);
    this.lookaheadCtrl.deadReckonTick(input.speed_kmh, input.heading, 1); // dt=1s (tick interval)

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

    // Track speed for adaptive gradient EMA
    this.lastSpeed = input.speed_kmh;

    // ── Barometric altitude fusion for real-time gradient ──
    let rawGradient = input.gradient_pct;
    const baroAltTick = bikeState.barometric_altitude_m;
    const gpsAltTick = input.altitude;

    if (baroAltTick > 0 && this.prevCorrectedAlt != null) {
      // Blend barometer (70%) + GPS (30%) for corrected altitude
      const correctedAlt = baroAltTick * 0.7 + ((gpsAltTick ?? baroAltTick) * 0.3);

      // Calculate gradient from corrected altitude change
      const altDelta = correctedAlt - this.prevCorrectedAlt;
      const distDelta = (input.speed_kmh / 3.6) * 1.0; // 1 second of travel
      if (distDelta > 1) { // at least 1m traveled
        const baroGradient = (altDelta / distDelta) * 100;
        // Use baro-derived gradient with higher weight than GPS
        rawGradient = baroGradient * 0.6 + (input.gradient_pct ?? 0) * 0.4;
      }
      this.prevCorrectedAlt = correctedAlt;
    } else if (baroAltTick > 0) {
      this.prevCorrectedAlt = baroAltTick * 0.7 + ((gpsAltTick ?? baroAltTick) * 0.3);
    } else if (gpsAltTick != null) {
      this.prevCorrectedAlt = gpsAltTick;
    }

    // Gap #9: smooth gradient before feeding to physics (now using baro-fused raw)
    const smoothedGrad = this.smoothGradient(rawGradient);

    // ── Real-time ascent/descent tracking ──
    this.updateElevationStats(smoothedGrad, input.speed_kmh);

    // Gap #8: Feed terrain pattern learner every tick (after smoothedGrad is computed)
    terrainPatternLearner.feed(smoothedGrad, input.distanceKm);

    // Gap #20: track power values for adaptive EMA alpha
    this.recentPowerValues.push(input.power_watts);
    if (this.recentPowerValues.length > 10) this.recentPowerValues.shift();

    // Resolve CDA from bike config preset
    const cdaPreset = (bike.cda_preset || 'mtb_upright') as CdaPreset;
    const cda = CDA_PRESETS[cdaPreset] ?? CDA_PRESETS.mtb_upright;

    // Resolve tire pressure in bar for Crr adjustment
    const tirePressureBar = bike.tire_pressure_bar || undefined;

    // Gap #11: Micro-terrain auto-detection from speed variance + accuracy validation
    this.trackSpeedVariance(input.speed_kmh);
    const autoTerrain = this.detectMicroTerrain();
    this.lastAutoTerrain = autoTerrain;
    // Gap #11 (extended): Use manual override, or trust auto-detection based on accuracy
    const activeTerrain = this.manualTerrainOverride
      ? this.manualTerrainOverride                    // user explicitly set
      : (this.trustAutoTerrain ? autoTerrain : this.lastManualTerrain ?? 'dirt');
    const terrainCrr = CRR_TABLE[activeTerrain] ?? CRR_TABLE['dirt']!;
    // Use TerrainService Crr if available, otherwise speed-variance detected Crr
    const baseCrr = getCachedTrail()?.category ? this.cachedCrr : terrainCrr;
    const adjustedCrr = this.learning.getAdjustedCrr(baseCrr, getCachedTrail()?.category ?? activeTerrain);
    useAutoAssistStore.getState().setAutoDetectedTerrain(autoTerrain);

    const physicsInput: PhysicsInput = {
      speed_kmh: input.speed_kmh,
      gradient_pct: smoothedGrad,
      cadence_rpm: input.cadence_rpm,
      power_watts: input.power_watts,
      power_source: bike.has_power_meter ? 'pedal' : undefined,
      currentGear: input.currentGear,
      totalMass,
      wheelCircumM,
      chainring,
      sprockets,
      crr: adjustedCrr,
      cda,
      airDensity: this.cachedAirDensity,
      windComponent: this.cachedWindComponent,
      tire_pressure_bar: tirePressureBar,
      // Gap #15: Regional compliance speed limits
      ...(settings.compliance_region && settings.compliance_region !== 'eu' ? (() => {
        const cc = COMPLIANCE_CONFIGS[settings.compliance_region as ComplianceRegion];
        return {
          compliance_speedLimit_kmh: cc.speedLimit_kmh,
          compliance_fadeStart_kmh: cc.fadeStart_kmh,
          compliance_hardCutoff: cc.hardCutoff,
        };
      })() : {}),
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

    // ── Layer 7: Nutrition (runs after physiology, every 30s) ──
    if (this.rideStartTs === 0) this.rideStartTs = now;
    if (now - this.lastNutritionTick <= NUTRITION_INTERVAL_MS + 1000) {
      // Tick was scheduled above, run it now with available data
      this.cachedNutrition = this.nutrition.tick({
        P_human: physics.P_human,
        hr_zone: physio.zone_current,
        temp_c: this.cachedTemp,
        rider_weight_kg: rider.weight_kg || 135,
        ride_elapsed_s: (now - this.rideStartTs) / 1000,
      });

      // Glycogen → CP_effective / W'_effective correction (bidirectional feedback)
      if (this.cachedNutrition.cp_factor < 1.0) {
        const params = this.learning.getParams();
        // Apply glycogen correction to physiology engine's CP/W' for this tick
        this.physiology.calibrate(
          Math.round(params.w_prime_joules * this.cachedNutrition.w_prime_factor),
          params.tau_seconds,
        );
        factors.push({
          name: 'Glycogen',
          value: this.cachedNutrition.glycogen_pct,
          detail: `${this.cachedNutrition.glycogen_pct}% CP×${this.cachedNutrition.cp_factor}`,
        });
      }

      // Add nutrition alerts
      alerts.push(...this.cachedNutrition.alerts);
    }

    // ── Gap #10: Nutrition → motor integration (low glycogen + long ride = boost) ──
    const routeRemainingKm = this.cachedLookahead?.route_remaining_km ?? 0;
    let nutritionMotorBoost = 1.0;
    if (this.cachedNutrition && this.cachedNutrition.glycogen_pct < 20 && routeRemainingKm > 10) {
      nutritionMotorBoost = 1.2; // +20% motor support to conserve rider energy
      console.log('[Nutrition] Low glycogen + long ride → +20% motor support');
      factors.push({
        name: 'NutriBoost',
        value: 20,
        detail: `Glycogen ${this.cachedNutrition.glycogen_pct}% + ${routeRemainingKm.toFixed(0)}km restante → +20% support`,
      });
    } else if (this.cachedNutrition && this.cachedNutrition.glycogen_pct < 35 && routeRemainingKm > 20) {
      nutritionMotorBoost = 1.1; // +10% for moderate depletion on long remaining ride
      factors.push({
        name: 'NutriBoost',
        value: 10,
        detail: `Glycogen ${this.cachedNutrition.glycogen_pct}% + ${routeRemainingKm.toFixed(0)}km restante → +10% support`,
      });
    }

    // ── DECISION TREE (priority order) ──
    let supportPct = SUPPORT_MIN;
    let torqueNm = TORQUE_MIN;
    let launchLvl = 3;
    let reason = '';

    const rawBatteryFactor = this.cachedBattery?.constraint_factor ?? 1.0;
    const batteryFactor = this.smoothBatteryFactor(rawBatteryFactor);
    const formMultiplier = this.cachedFormMultiplier;
    let hrMod = physio.hrModifier;

    // ── Gap #4: W'/Drift convergence — boost hrModifier when both are critical ──
    if (physio.w_prime_balance < 0.40 && physio.drift_bpm_per_min > 0.3) {
      console.log(`[Physiology] CONVERGENCE: W'=${(physio.w_prime_balance * 100).toFixed(0)}% + drift=${physio.drift_bpm_per_min.toFixed(2)} — emergency boost`);
      hrMod = 0.5; // strongest hrModifier — maximum motor assistance
    }

    // Priority 1: W' critical → max support to protect athlete
    if (physio.flags.includes('w_prime_critical')) {
      supportPct = SUPPORT_MAX;
      torqueNm = TORQUE_MAX * 0.8;
      launchLvl = 5;
      reason = 'W\' critico — protecao maxima';
      alerts.push('Reserva anaerobica baixa. Mantem zona 2.');
    }
    // Priority 2: Zone breach imminent → proportional response
    // Only hard-override for very imminent breach (<3min). 3-8min = soft boost via hrModifier.
    else if (physio.flags.includes('zone_breach_imminent') && physio.t_breach_minutes < 3) {
      // Proportional: closer to breach = stronger response
      const urgency = Math.max(0, 1 - physio.t_breach_minutes / 3); // 0→1 as breach approaches
      supportPct = SUPPORT_MIN + (SUPPORT_MAX - SUPPORT_MIN) * 0.5 * (0.5 + urgency * 0.5);
      torqueNm = TORQUE_MIN + (TORQUE_MAX - TORQUE_MIN) * 0.4 * (0.5 + urgency * 0.5);
      launchLvl = 4;
      reason = `Breach Z${targetZone} em ${physio.t_breach_minutes.toFixed(0)}min — pre-emptivo`;
      alerts.push(`Fadiga cardiaca. Reduz ritmo ${Math.ceil(physio.t_breach_minutes)} minutos.`);
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
        supportPct = rawSupport * hrMod * physics.fadeFactor * batteryFactor * formMultiplier * nutritionMotorBoost;
      } else if (physics.P_total > 20) {
        supportPct = 200 * hrMod * batteryFactor * nutritionMotorBoost;
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
      // NOTE: Giant Trance X E+ 2 (Shimano EP800) does NOT support regenerative
      // braking. Motor assist is one-way only. On descents, motor cuts to 0%
      // and the rider relies on mechanical brakes. Battery does not recharge
      // during descent. This is a hardware limitation of the EP800 motor.
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

    // ── Pre-adjustment ramp (from lookahead) — Gap #12: adaptive duration, Gap #2: reactive ramps ──
    const gradientDelta = smoothedGrad - this.lastGradientForRamp;
    this.lastGradientForRamp = smoothedGrad;
    const rampDuration = this.calculateRampDuration(gradientDelta);
    if (this.preAdjustTarget && this.preAdjustCountdown > 0 && this.preAdjustCountdown <= rampDuration) {
      // Gap #2: Check if gradient changed significantly mid-ramp — recalculate target
      const gradientDivergence = Math.abs(smoothedGrad - this.preAdjustStartGradient);
      if (gradientDivergence > 2) {
        console.log(`[KromiEngine] Ramp recalc: gradient shifted ${gradientDivergence.toFixed(1)}%`);
        this.recalculateRampTarget(smoothedGrad);
      }

      const blend = 1 - (this.preAdjustCountdown / rampDuration); // 0→1 over rampDuration
      supportPct = supportPct + (this.preAdjustTarget.support - supportPct) * blend;
      torqueNm = torqueNm + (this.preAdjustTarget.torque - torqueNm) * blend;
      reason += ` [pre-adjust ${this.preAdjustCountdown.toFixed(0)}s ramp=${rampDuration}s]`;
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

    // ── Terrain Discovery: predict and pre-adjust for unplanned rides ──
    const routeActive = useRouteStore.getState().navigation.active;
    if (!routeActive && input.gpsActive && input.latitude !== 0) {
      const terrainPred = terrainDiscovery.predict(input.latitude, input.longitude, input.heading);
      if (terrainPred.confidence > 0.3 && terrainPred.pre_adjust_support > 0) {
        // Apply terrain discovery pre-adjustment (like lookahead but from learned terrain)
        supportPct += terrainPred.pre_adjust_support;
        torqueNm += terrainPred.pre_adjust_torque;
        factors.push({
          name: 'Terrain',
          value: terrainPred.pre_adjust_support,
          detail: `${terrainPred.pattern} → ${terrainPred.predicted_gradient > 0 ? '+' : ''}${terrainPred.predicted_gradient.toFixed(1)}% (${(terrainPred.confidence * 100).toFixed(0)}% conf)`,
        });
      }

      // Gap #8: Terrain pattern prediction — anticipate terrain transitions
      const patternPred = terrainPatternLearner.predictNext();
      if (patternPred && patternPred.confidence > 0.5 && patternPred.in_seconds < 15) {
        // Pre-adjust for predicted terrain transition
        const currentTerrain = terrainPatternLearner.getCurrentTerrain();
        if (currentTerrain === 'flat' && (patternPred.terrain === 'gentle_climb' || patternPred.terrain === 'steep_climb')) {
          // Flat → climb predicted: pre-boost support
          const boost = patternPred.terrain === 'steep_climb' ? 30 : 15;
          supportPct += boost * patternPred.confidence;
          factors.push({
            name: 'Pattern',
            value: boost * patternPred.confidence,
            detail: `${currentTerrain} → ${patternPred.terrain} in ${patternPred.in_seconds.toFixed(0)}s (${(patternPred.confidence * 100).toFixed(0)}% conf)`,
          });
        } else if ((currentTerrain === 'gentle_climb' || currentTerrain === 'steep_climb') && patternPred.terrain === 'descent') {
          // Climb → descent predicted: reduce support early
          supportPct *= (1 - 0.2 * patternPred.confidence);
          factors.push({
            name: 'Pattern',
            value: -20 * patternPred.confidence,
            detail: `${currentTerrain} → ${patternPred.terrain} in ${patternPred.in_seconds.toFixed(0)}s (${(patternPred.confidence * 100).toFixed(0)}% conf)`,
          });
        }
      }
    }

    // ── Gap #4: Use AutoAssistEngine terrain analysis as data source (not decision maker) ──
    const terrainAnalysis = autoAssistEngine.getCurrentTerrainAnalysis();
    if (terrainAnalysis) {
      const transition = terrainAnalysis.next_transition;
      // Use terrain transition data to supplement lookahead (especially when
      // lookahead has no data or low confidence)
      if (transition && !this.cachedLookahead?.next_transition_m && transition.distance_m < 300) {
        factors.push({
          name: 'AA Terrain',
          value: transition.gradient_after_pct,
          detail: `Transicao ${transition.type} a ${Math.round(transition.distance_m)}m → ${transition.gradient_after_pct.toFixed(1)}%`,
        });
      }
    }

    // ── Mode Feedback Learning: apply rider preference correction ──
    const riderCorrection = this.learning.getSupportCorrection(input.gradient_pct, physio.zone_current);
    if (riderCorrection !== 0) {
      supportPct += riderCorrection;
      factors.push({ name: 'Rider Pref', value: riderCorrection, detail: `${riderCorrection > 0 ? '+' : ''}${riderCorrection.toFixed(0)}% from mode feedback` });
    }

    // ── EMA Smoothing (support and torque) ──
    // Gap #20: use power variance-based alpha, falling back to speed-based
    const alpha = this.getAdaptiveAlpha(input.speed_kmh);
    supportPct = this.prevSupport + alpha * (supportPct - this.prevSupport);
    torqueNm = this.prevTorque + alpha * (torqueNm - this.prevTorque);
    this.prevSupport = supportPct;
    this.prevTorque = torqueNm;

    // ── Gap #5: Route budget enforcement — cap support to guarantee route completion ──
    const nav = useRouteStore.getState().navigation;
    if (nav.active && nav.distanceRemaining_m > 0 && input.batterySoc > 0) {
      const bikeConf = safeBikeConfig(useSettingsStore.getState().bikeConfig);
      const capacityWh = bikeConf.battery_capacity_wh || (bikeConf.main_battery_wh + (bikeConf.has_range_extender ? bikeConf.sub_battery_wh : 0));
      const remainingWh = (input.batterySoc / 100) * capacityWh;
      supportPct = this.enforceRouteBudget(supportPct, remainingWh, nav.distanceRemaining_m / 1000);
    }

    // Clamp final values
    supportPct = Math.max(SUPPORT_MIN, Math.min(SUPPORT_MAX, supportPct));
    torqueNm = Math.max(TORQUE_MIN, Math.min(TORQUE_MAX, torqueNm));
    launchLvl = Math.max(LAUNCH_MIN, Math.min(LAUNCH_MAX, launchLvl));

    const score = Math.round(((supportPct - SUPPORT_MIN) / (SUPPORT_MAX - SUPPORT_MIN)) * 100);

    // Record command for override detection
    this.learning.recordEngineCommand(supportPct, torqueNm, launchLvl);

    // Track sustained effort for CP calibration

    // ── Gap #14: Track climb patterns within this ride ──
    this.trackClimbPatterns(smoothedGrad, input.power_watts, supportPct);
    // Use climb learning to pre-set support for similar climbs
    if (smoothedGrad > 3 && this.currentClimb && this.currentClimb.gradients.length <= 1) {
      const similarSupport = this.getSimilarClimbSupport(smoothedGrad);
      if (similarSupport != null) {
        supportPct = supportPct * 0.7 + similarSupport * 0.3; // blend 30% from learned
        factors.push({ name: 'ClimbLearn', value: similarSupport, detail: `Similar climb → ${similarSupport.toFixed(0)}% support` });
      }
    }

    // ── Gap #14: Turn-aware pre-adjustment ──
    const turnFactor = this.checkUpcomingTurn();
    if (turnFactor < 1.0) {
      supportPct *= turnFactor;
      factors.push({ name: 'Turn', value: turnFactor, detail: `Turn approaching — ${(turnFactor * 100).toFixed(0)}% support` });
    }

    // ── Gap #15: Speed event logging for compliance ──
    this.logSpeedEvent(input.speed_kmh, input.latitude, input.longitude, physics.speedZone !== 'free');
    this.trackSustainedEffort(physics.P_human);

    // Gap #9: Calculate rich gear suggestion from lookahead transition
    const la = this.cachedLookahead;
    if (la?.seconds_to_transition != null && la.seconds_to_transition <= 10 && la.seconds_to_transition >= 3 && la.next_transition_gradient != null) {
      this.cachedGearSuggestion = this.calculateGearSuggestion(
        input.currentGear, input.cadence_rpm, input.speed_kmh,
        la.next_transition_gradient, la.seconds_to_transition,
        sprockets, chainring, wheelCircumM,
      );
    } else {
      this.cachedGearSuggestion = null;
    }
    // Push gear suggestion to store for UI consumption
    useAutoAssistStore.getState().setGearSuggestion(this.cachedGearSuggestion);

    // Push elevation/terrain data to autoAssistStore for UI (ClimbApproach, ElevationProfile)
    if (this.cachedLookahead && this.cachedLookahead.segments.length > 0) {
      const segs = this.cachedLookahead.segments as any[];
      const grads = segs.map((s: any) => Math.abs(s.gradient ?? 0));
      const avgGrad = grads.length > 0 ? grads.reduce((a: number, b: number) => a + b, 0) / grads.length : 0;
      const maxGrad = grads.length > 0 ? Math.max(...grads) : 0;
      const elevProfile = segs.map((seg: any, i: number) => ({
        lat: 0,
        lng: 0,
        elevation: seg.start_elevation ?? 0,
        distance_from_current: seg.distance_m ?? i * 100,
        gradient_pct: seg.gradient ?? 0,
      }));
      useAutoAssistStore.getState().setTerrain({
        current_gradient_pct: smoothedGrad,
        avg_upcoming_gradient_pct: avgGrad,
        max_upcoming_gradient_pct: maxGrad,
        next_transition: this.cachedLookahead.next_transition_gradient != null ? {
          distance_m: Math.round((this.cachedLookahead.seconds_to_transition ?? 10) * (input.speed_kmh / 3.6)),
          gradient_after_pct: this.cachedLookahead.next_transition_gradient,
          type: this.cachedLookahead.next_transition_gradient > 3 ? 'flat_to_climb' : 'climb_to_flat',
          is_preemptive: (this.cachedLookahead.seconds_to_transition ?? 99) < 15,
          target_mode: this.cachedLookahead.next_transition_gradient > 12 ? 5 :
                       this.cachedLookahead.next_transition_gradient > 8 ? 4 :
                       this.cachedLookahead.next_transition_gradient > 5 ? 3 :
                       this.cachedLookahead.next_transition_gradient > 3 ? 2 : 1,
        } : null,
        profile: elevProfile,
      });
    }

    // ── Gap #1: Heartbeat re-broadcast to native KromiCore ──
    this.pushParamsWithHeartbeat();

    const output: KromiTickOutput = {
      supportPct, torqueNm, launchLvl, score, reason, factors,
      speedZone: physics.speedZone,
      batteryFactor,
      gearSuggestion: this.cachedLookahead?.gear_suggestion ?? null,
      gearSuggestionDetail: this.cachedGearSuggestion,
      physiology: physio,
      nutrition: this.cachedNutrition,
      autoTerrain: this.lastAutoTerrain,
      activeCrr: adjustedCrr,
      elevation: this.getRideElevation(),
      alerts: alerts.slice(0, 4), // max 4 alerts (motor + nutrition)
    };

    // Cache for low power mode skip
    this.lastTickOutput = output;

    return output;
  }

  /**
   * Push Layer 3-7 cached params to native KromiCore via JS Bridge.
   * Called after each slow-layer tick. Native engine uses these for its 1s physics.
   */
  private pushParamsToNative(): void {
    const bridge = (window as unknown as Record<string, unknown>).KromiBridge as
      | { updateKromiParams?: (json: string) => void; setGradient?: (g: number) => void }
      | undefined;
    if (!bridge?.updateKromiParams) return;

    const settings = useSettingsStore.getState();
    const rider = settings.riderProfile;
    const bike = safeBikeConfig(settings.bikeConfig);
    const totalMass = (rider.weight_kg || 135) + (bike.weight_kg || 24);
    const wheelCircumM = (bike.wheel_circumference_mm || 2290) / 1000;
    const chainring = parseInt(bike.chainring_teeth?.replace(/\D/g, '') || '34') || 34;
    const sprockets = bike.cassette_sprockets?.length >= 2
      ? [...bike.cassette_sprockets].sort((a, b) => b - a)
      : [51, 45, 39, 34, 30, 26, 23, 20, 17, 15, 13, 10];

    const zones = rider.zones?.length > 0
      ? rider.zones
      : calculateZones(rider.hr_max || 185);

    const params = {
      // Gap #1: Version + timestamp for stale detection in KromiCore
      paramVersion: this.paramVersion,
      paramTimestamp: Date.now(),
      crr: this.learning.getAdjustedCrr(this.cachedCrr, getCachedTrail()?.category ?? 'unknown'),
      wind_component_ms: this.cachedWindComponent,
      air_density: this.cachedAirDensity,
      battery_factor: this.cachedBattery?.constraint_factor ?? 1.0,
      cp_effective: this.learning.getParams().cp_watts,
      w_prime_total: this.learning.getParams().w_prime_joules,
      tau: this.learning.getParams().tau_seconds,
      form_multiplier: this.cachedFormMultiplier,
      glycogen_cp_factor: this.cachedNutrition?.cp_factor ?? 1.0,
      route_remaining_km: useRouteStore.getState().navigation.active
        ? useRouteStore.getState().navigation.distanceRemaining_m / 1000
        : -1,
      total_mass: totalMass,
      wheel_circum_m: wheelCircumM,
      chainring,
      sprockets,
      target_zone: rider.target_zone || 2,
      hr_zone_bounds: zones.map(z => z.max_bpm),
      // Battery capacity for route-aware budget in native KromiCore
      battery_capacity_wh: bike.battery_capacity_wh || (bike.main_battery_wh + (bike.has_range_extender ? bike.sub_battery_wh : 0)),
      // CDA from bike config preset
      cda: CDA_PRESETS[(bike.cda_preset || 'mtb_upright') as CdaPreset] ?? CDA_PRESETS.mtb_upright,
      pre_adjust: this.preAdjustTarget && this.preAdjustCountdown > 0
        ? { support: this.preAdjustTarget.support, torque: this.preAdjustTarget.torque, countdown: this.preAdjustCountdown }
        : undefined,
    };

    try {
      bridge.updateKromiParams(JSON.stringify(params));
    } catch (_) { /* bridge not available */ }
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
    this.preAdjustStartGradient = 0;
    this.paramVersion = 0;
    this.lastParamPushMs = 0;
    this.paramsChanged = false;
    this.smoothedBatteryFactor = 1.0;
    this.sustainedEffortStart = 0;
    this.sustainedEffortPowerSum = 0;
    this.sustainedEffortSamples = 0;
    this.cachedNutrition = null;
    this.smoothedGradient = 0;
    this.lastSpeed = null;
    this.prevCorrectedAlt = null;
    this.rideElevation = {
      totalAscent_m: 0, totalDescent_m: 0,
      lastSmoothedAlt: 0, altInitialized: false,
      currentClimbGain_m: 0, currentClimbStart_m: 0, isInClimb: false,
    };
    this.recentPowerValues = [];
    this.lastGradientForRamp = 0;
    this.rideStartTs = 0;
    this.lastNutritionTick = 0;
    this.lastGpsTs = 0;
    this.cachedGearSuggestion = null;
    this.speedHistory = [];
    this.manualTerrainOverride = null;
    this.lastAutoTerrain = 'dirt';
    // Gap #12: Reset motor connection state
    this.lastMotorTelemetryMs = 0;
    this.motorConnected = true;
    // Gap #14: Reset climb learning
    this.rideClimbs = [];
    this.currentClimb = null;
    // Low power mode reset
    this.lowPowerMode = false;
    this.tickSkipCounter = 0;
    this.lastTickOutput = null;
    // Gap #15: Reset speed events
    this.speedEvents = [];
    this.speedExceedStartMs = 0;
    this.lastManualTerrain = null;
    this.terrainDetectionHistory = [];
    this.trustAutoTerrain = true;
    resetSpeedZone(); // Gap #8: reset hysteresis state
    this.physiology.reset();
    this.learning.resetRide();
    this.nutrition.reset();
    this.lookaheadCtrl.reset();
    terrainDiscovery.reset(); // keeps terrain cache, clears ride segments

    // Gap #8: Save terrain patterns from previous ride, then reset for new ride
    terrainPatternLearner.save();
    terrainPatternLearner.resetRide();
    terrainPatternLearner.load(); // Reload patterns (including just-saved ones)
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

    // Gap #11: Wind estimation from power surplus (supplements weather data)
    if (input.power_watts > 0 && input.speed_kmh > 5) {
      const settings = useSettingsStore.getState();
      const rider = settings.riderProfile;
      const bike = safeBikeConfig(settings.bikeConfig);
      const totalMass = (rider.weight_kg || 135) + (bike.weight_kg || 24);
      const estimatedWindKmh = estimateHeadwind(
        input.speed_kmh, input.power_watts, input.gradient_pct, totalMass,
      );
      const estimatedWindMs = estimatedWindKmh / 3.6;
      if (weather) {
        // Blend: 70% weather, 30% power-estimated
        this.cachedWindComponent = this.cachedWindComponent * 0.7 + estimatedWindMs * 0.3;
      } else {
        // No weather data: use power-estimated wind fully
        this.cachedWindComponent = estimatedWindMs;
      }
    }

    // Surface → Crr
    const trail = getCachedTrail();
    if (trail) {
      this.cachedCrr = surfaceToCrr(trail.category);
    }
  }

  // ── Layer 4: Lookahead ───────────────────────────────────

  private tickLookahead(input: KromiTickInput): void {
    // Load route into LookaheadController if active and not yet loaded
    const routeStore = useRouteStore.getState();
    if (routeStore.navigation.active && routeStore.activeRoutePoints.length > 0 && this.lookaheadCtrl.getMode() === 'discovery') {
      this.lookaheadCtrl.loadRoute(routeStore.activeRoutePoints);
    } else if (!routeStore.navigation.active && this.lookaheadCtrl.getMode() !== 'discovery') {
      this.lookaheadCtrl.clearRoute();
    }

    const profile = elevationService.getLastResult();

    const settings = useSettingsStore.getState();
    const bike = safeBikeConfig(settings.bikeConfig);
    const rider = settings.riderProfile;
    const totalMass = (rider.weight_kg || 135) + (bike.weight_kg || 24);
    const wheelCircumM = (bike.wheel_circumference_mm || 2290) / 1000;
    const chainring = parseInt(bike.chainring_teeth?.replace(/\D/g, '') || '34') || 34;
    const sprockets = bike.cassette_sprockets?.length >= 2
      ? [...bike.cassette_sprockets].sort((a, b) => b - a)
      : [51, 45, 39, 34, 30, 26, 23, 20, 17, 15, 13, 10];

    // Use LookaheadController (handles Mode A/B/C automatically)
    this.cachedLookahead = this.lookaheadCtrl.tick(
      input.latitude, input.longitude,
      profile ?? [],
      input.speed_kmh,
      {
        cadence_rpm: input.cadence_rpm,
        power_watts: input.power_watts,
        currentGear: input.currentGear,
        totalMass, wheelCircumM, chainring, sprockets,
        crr: this.cachedCrr,
        cda: CDA_PRESETS[(bike.cda_preset || 'mtb_upright') as CdaPreset] ?? CDA_PRESETS.mtb_upright,
        airDensity: this.cachedAirDensity,
        windComponent: this.cachedWindComponent,
      },
      sprockets,
      input.currentGear,
    );

    // Set up pre-adjustment if transition coming
    const la = this.cachedLookahead;
    if (la.seconds_to_transition !== null && la.seconds_to_transition < 15 && la.next_transition_gradient !== null) {
      const upGrad = la.next_transition_gradient;
      if (Math.abs(upGrad) > 5) {
        const gradRad = Math.atan(upGrad / 100);
        const Fg = totalMass * 9.81 * Math.sin(gradRad);
        const estTorque = Math.max(TORQUE_MIN, Math.min(TORQUE_MAX, Fg * (wheelCircumM / (2 * Math.PI))));
        const estSupport = upGrad > 0
          ? Math.min(SUPPORT_MAX, 150 + upGrad * 15)
          : SUPPORT_MIN;
        this.preAdjustTarget = { support: estSupport, torque: estTorque };
        this.preAdjustCountdown = la.seconds_to_transition;
        this.preAdjustStartGradient = input.gradient_pct; // Gap #2: record starting gradient for reactive ramp
      }
    }
  }

  // ── Layer 5: Battery ─────────────────────────────────────

  private tickBattery(input: KromiTickInput): void {
    // Get route remaining km from navigation state (if active)
    const nav = useRouteStore.getState().navigation;
    const routeRemainingKm = nav.active && nav.distanceRemaining_m > 0
      ? nav.distanceRemaining_m / 1000
      : null;

    this.cachedBattery = computeBatteryBudget(
      input.batterySoc,
      routeRemainingKm,
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

  // ── Gap #10: Nutrition intake actions (callable from UI) ───

  /** Log food intake (carbs in grams) — updates glycogen model */
  logFoodIntake(carbsG: number): void {
    this.nutrition.logFoodIntake(carbsG);
  }

  /** Log water intake (ml) — updates hydration model */
  logWaterIntake(ml: number): void {
    this.nutrition.logWaterIntake(ml);
  }

  // ── Accessories (smart light + radar) ─────────────────────

  /** Start accessories manager when light/radar connects */
  startAccessories(): void {
    import('../accessories/AccessoriesManager').then(({ accessoriesManager }) => {
      if (!accessoriesManager.isRunning) accessoriesManager.start();
    });
  }

  /** Stop accessories manager */
  stopAccessories(): void {
    import('../accessories/AccessoriesManager').then(({ accessoriesManager }) => {
      accessoriesManager.stop();
    });
  }

  // ── Accessors ────────────────────────────────────────────

  getPhysiology(): PhysiologyEngine { return this.physiology; }
  getLearning(): RiderLearning { return this.learning; }
  getCachedBattery(): BatteryBudget | null { return this.cachedBattery; }
  getCachedLookahead(): LookaheadResult | null { return this.cachedLookahead; }
  getNutrition(): NutritionEngine { return this.nutrition; }
}

export const kromiEngine = KromiEngine.getInstance();

import { AssistMode } from '../../types/bike.types';
import type {
  ElevationPoint,
  TerrainAnalysis,
  TransitionEvent,
  AssistDecision,
} from '../../types/elevation.types';
import { elevationService } from '../maps/ElevationService';
import { useMapStore } from '../../store/mapStore';
import { useBikeStore } from '../../store/bikeStore';
import { useAutoAssistStore } from '../../store/autoAssistStore';

interface AutoAssistConfig {
  enabled: boolean;
  lookahead_m: number;
  preempt_distance_m: number;
  override_duration_s: number;
  smoothing_window: number;
  climb_threshold_pct: number;
  descent_threshold_pct: number;
}

const DEFAULT_CONFIG: AutoAssistConfig = {
  enabled: false,
  lookahead_m: 4000,
  preempt_distance_m: 150,
  override_duration_s: 60,
  smoothing_window: 3,
  climb_threshold_pct: 3,
  descent_threshold_pct: -4,
};

class AutoAssistEngine {
  private static instance: AutoAssistEngine;
  private config: AutoAssistConfig = DEFAULT_CONFIG;
  private lastManualOverride = 0;
  private lastOverrideTimeout = 60_000; // adaptive timeout (ms)
  private modeHistory: AssistMode[] = [];
  private altitudeHistory: Array<{ alt: number; dist: number; ts: number }> = [];

  // Gap #8: Hysteresis — dead-band to prevent mode oscillation
  private lastDecidedMode: AssistMode = AssistMode.ECO;
  private static readonly HYSTERESIS = 1.5; // % dead-band

  // Gap #4: When KromiEngine is active, defer motor decisions to it
  kromiEngineDefers = false;

  /**
   * GPS-based gradient fallback — used when Google Elevation API is unavailable.
   * Uses altitude from GPS (mapStore) and distance from odometer (bikeStore).
   * Keeps a 30s sliding window to smooth GPS altitude noise.
   */
  private calculateLocalGradient(altitude: number | null, distanceKm: number): number {
    if (altitude == null || altitude === 0) return 0;
    const now = Date.now();
    this.altitudeHistory.push({ alt: altitude, dist: distanceKm, ts: now });
    // Keep last 30s of data
    this.altitudeHistory = this.altitudeHistory.filter(p => now - p.ts < 30000);
    if (this.altitudeHistory.length < 2) return 0;

    const first = this.altitudeHistory[0]!;
    const last = this.altitudeHistory[this.altitudeHistory.length - 1]!;
    const dAlt = last.alt - first.alt;
    const dDist = (last.dist - first.dist) * 1000; // km to m
    if (dDist < 5) return 0; // need at least 5m movement
    return (dAlt / dDist) * 100; // gradient %
  }

  static getInstance(): AutoAssistEngine {
    if (!AutoAssistEngine.instance) {
      AutoAssistEngine.instance = new AutoAssistEngine();
    }
    return AutoAssistEngine.instance;
  }

  updateConfig(partial: Partial<AutoAssistConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  /**
   * MAIN LOOP — called every 1-2 seconds.
   *
   * Priority:
   * 1. Manual override active → do nothing
   * 2. Stopped (< 2 km/h) → do nothing
   * 3. Pre-emptive activation (climb detected ahead) → change mode early
   * 4. Normal adjustment based on current gradient
   * 5. Smoothing to avoid oscillation
   */
  async tick(
    lat: number,
    lng: number,
    heading: number,
    speed_kmh: number,
    currentMode: AssistMode
  ): Promise<AssistDecision> {
    // Gap #4: If KromiEngine is active, defer motor control decisions to it.
    // AutoAssistEngine still provides terrain data (via analyzeTerrain) but
    // does NOT make independent mode change decisions.
    if (this.kromiEngineDefers) {
      // KromiEngine handles motor control, but we STILL fetch elevation data
      // for the UI (ClimbApproach, ElevationProfile, ClimbDashboard need it)
      try {
        const profile = await elevationService.getElevationByHeading(
          lat, lng, heading, this.config.lookahead_m
        );
        if (profile.length >= 2) {
          const terrain = this.analyzeTerrain(profile);
          return { action: 'none', reason: 'KromiEngine activo — dados de elevação actualizados', terrain };
        }
      } catch {}
      return { action: 'none', reason: 'KromiEngine activo — deferido', terrain: this.getCurrentTerrainAnalysis() };
    }

    if (!this.config.enabled) {
      return { action: 'none', reason: 'Auto-assist desactivado', terrain: null };
    }

    // 1. MANUAL OVERRIDE — respect rider's choice (Gap #17: adaptive timeout)
    const overrideActive =
      Date.now() - this.lastManualOverride < this.lastOverrideTimeout;

    if (overrideActive) {
      const remaining = Math.ceil(
        (this.lastOverrideTimeout - (Date.now() - this.lastManualOverride)) / 1000
      );
      return { action: 'none', reason: `Override manual (${remaining}s)`, terrain: null };
    }

    // 2. STOPPED — don't change mode
    if (speed_kmh < 2) {
      return { action: 'none', reason: 'Parado', terrain: null };
    }

    // 3. FETCH ELEVATION AHEAD (heading-based, no route needed)
    const profile = await elevationService.getElevationByHeading(
      lat,
      lng,
      heading,
      this.config.lookahead_m
    );

    // Fallback: if Google Elevation API unavailable, use GPS altitude
    if (profile.length < 2) {
      const mapAltitude = useMapStore.getState().altitude;
      const bikeDistance = useBikeStore.getState().distance_km;
      const localGradient = this.calculateLocalGradient(mapAltitude, bikeDistance);

      if (localGradient === 0 && this.altitudeHistory.length < 2) {
        return { action: 'none', reason: 'Sem dados elevacao (GPS a recolher)', terrain: null };
      }

      // Build a minimal terrain analysis from GPS gradient
      const gpsTerrain: TerrainAnalysis = {
        current_gradient_pct: localGradient,
        avg_upcoming_gradient_pct: localGradient,
        max_upcoming_gradient_pct: localGradient,
        next_transition: null,
        profile: [],
      };

      // Skip pre-emptive (no lookahead data), go straight to normal adjustment
      const targetMode = this.gradientToMode(localGradient);
      this.modeHistory.push(targetMode);
      if (this.modeHistory.length > this.config.smoothing_window) {
        this.modeHistory.shift();
      }

      const stableMode = this.getStableMode();
      if (!stableMode || stableMode === currentMode) {
        return { action: 'none', reason: `GPS grad: ${localGradient > 0 ? '+' : ''}${localGradient.toFixed(1)}%`, terrain: gpsTerrain };
      }

      return {
        action: 'change_mode',
        new_mode: stableMode,
        reason: `GPS grad: ${localGradient > 0 ? '+' : ''}${localGradient.toFixed(1)}%`,
        terrain: gpsTerrain,
      };
    }

    const terrain = this.analyzeTerrain(profile);

    // 4. PRE-EMPTIVE ACTIVATION — the key feature
    if (terrain.next_transition?.is_preemptive) {
      const t = terrain.next_transition;

      if (t.type === 'descent_to_climb' || t.type === 'flat_to_climb') {
        const targetMode = this.gradientToMode(t.gradient_after_pct);
        if (targetMode !== currentMode) {
          return {
            action: 'change_mode',
            new_mode: targetMode,
            reason: `Subida em ${Math.round(t.distance_m)}m (+${t.gradient_after_pct.toFixed(1)}%)`,
            terrain,
            is_preemptive: true,
          };
        }
      }

      if (t.type === 'climb_to_descent' || t.type === 'climb_to_flat') {
        const targetMode = this.gradientToMode(t.gradient_after_pct);
        if (targetMode !== currentMode) {
          return {
            action: 'change_mode',
            new_mode: targetMode,
            reason: `Descida em ${Math.round(t.distance_m)}m`,
            terrain,
            is_preemptive: true,
          };
        }
      }
    }

    // 5. NORMAL ADJUSTMENT based on current gradient
    const targetMode = this.gradientToMode(terrain.current_gradient_pct);

    // 6. SMOOTHING — only change if stable for N samples
    this.modeHistory.push(targetMode);
    if (this.modeHistory.length > this.config.smoothing_window) {
      this.modeHistory.shift();
    }

    const stableMode = this.getStableMode();
    if (!stableMode || stableMode === currentMode) {
      return { action: 'none', reason: 'Estavel', terrain };
    }

    return {
      action: 'change_mode',
      new_mode: stableMode,
      reason: `Gradiente: ${terrain.current_gradient_pct > 0 ? '+' : ''}${terrain.current_gradient_pct.toFixed(1)}%`,
      terrain,
    };
  }

  /**
   * Called when mode changes externally (Ergo 3 or app button).
   * Gap #17: Adaptive timeout based on mode step size.
   */
  notifyManualOverride(source: 'ergo3' | 'app_button', from?: AssistMode, to?: AssistMode): void {
    this.lastManualOverride = Date.now();
    this.modeHistory = [];

    // Gap #17: compute context-dependent timeout
    if (from !== undefined && to !== undefined) {
      this.lastOverrideTimeout = this.getOverrideTimeout({ from, to });
    } else {
      this.lastOverrideTimeout = this.config.override_duration_s * 1000;
    }

    console.log(`[AutoAssist] Override (${source}), paused ${this.lastOverrideTimeout / 1000}s`);
  }

  /**
   * Gap #17: Adaptive override timeout.
   * Small adjustments (1 step) → shorter pause. Major switches → longer pause.
   */
  private getOverrideTimeout(modeChange: { from: AssistMode; to: AssistMode }): number {
    const steps = Math.abs(this.modeIndex(modeChange.to) - this.modeIndex(modeChange.from));
    if (steps <= 1) return 30_000;  // 30s for fine adjustments
    if (steps <= 2) return 60_000;  // 60s for moderate changes
    return 90_000;                   // 90s for major mode switches (ECO→POWER)
  }

  getOverrideRemaining(): number {
    const elapsed = Date.now() - this.lastManualOverride;
    return Math.max(0, Math.ceil((this.lastOverrideTimeout - elapsed) / 1000));
  }

  isOverrideActive(): boolean {
    return Date.now() - this.lastManualOverride < this.lastOverrideTimeout;
  }

  // ── Gap #4: Public terrain analysis for KromiEngine Layer 4 ──
  /**
   * Get current terrain analysis as a data source for KromiEngine.
   * When KromiEngine is active, it uses this as input data (not as a decision maker).
   */
  getCurrentTerrainAnalysis(): TerrainAnalysis | null {
    // Return the last terrain analysis from the auto-assist store
    const terrain = useAutoAssistStore?.getState?.()?.terrain;
    return terrain ?? null;
  }

  // ── Terrain Analysis ──────────────────────────────────

  private analyzeTerrain(profile: ElevationPoint[]): TerrainAnalysis {
    const currentPoints = profile.filter((p) => p.distance_from_current <= 50);
    const currentGradient = this.averageGradient(currentPoints);
    const avgGradient = this.averageGradient(profile);
    const maxGradient = Math.max(...profile.map((p) => p.gradient_pct));
    const nextTransition = this.findNextTransition(profile, currentGradient);

    return {
      current_gradient_pct: currentGradient,
      avg_upcoming_gradient_pct: avgGradient,
      max_upcoming_gradient_pct: maxGradient,
      next_transition: nextTransition,
      profile,
    };
  }

  private findNextTransition(
    profile: ElevationPoint[],
    currentGradient: number
  ): TransitionEvent | null {
    const CLIMB = this.config.climb_threshold_pct;
    const DESCENT = this.config.descent_threshold_pct;
    const PREEMPT = this.config.preempt_distance_m;

    // Sliding window of 3 points to detect stable change
    for (let i = 2; i < profile.length; i++) {
      const windowGradient = this.averageGradient(profile.slice(i - 2, i + 1));
      const distance = profile[i]!.distance_from_current;

      // Flat/descent → Climb
      if (currentGradient < CLIMB && windowGradient >= CLIMB) {
        return {
          type: currentGradient < DESCENT ? 'descent_to_climb' : 'flat_to_climb',
          distance_m: distance,
          gradient_after_pct: windowGradient,
          target_mode: this.gradientToMode(windowGradient),
          is_preemptive: distance <= PREEMPT,
        };
      }

      // Climb → Flat/descent
      if (currentGradient >= CLIMB && windowGradient < CLIMB) {
        return {
          type: windowGradient < DESCENT ? 'climb_to_descent' : 'climb_to_flat',
          distance_m: distance,
          gradient_after_pct: windowGradient,
          target_mode: this.gradientToMode(windowGradient),
          is_preemptive: distance <= PREEMPT,
        };
      }
    }

    return null;
  }

  // ── Gradient → AssistMode Mapping (with hysteresis) ───

  /** Map mode to numeric index for ordering */
  private modeIndex(mode: AssistMode): number {
    const order: Record<number, number> = {
      [AssistMode.OFF]: 0, [AssistMode.ECO]: 1, [AssistMode.TOUR]: 2,
      [AssistMode.ACTIVE]: 3, [AssistMode.SPORT]: 4, [AssistMode.POWER]: 5,
    };
    return order[mode] ?? 1;
  }

  /**
   * Gradient→Mode with hysteresis dead-band (Gap #8).
   * Going UP (increasing assist): uses normal thresholds.
   * Going DOWN (decreasing assist): requires gradient to drop below threshold - HYSTERESIS.
   * Prevents oscillation at mode boundaries.
   */
  private gradientToMode(gradient: number): AssistMode {
    const H = AutoAssistEngine.HYSTERESIS;
    const currentIdx = this.modeIndex(this.lastDecidedMode);

    // Thresholds: OFF < -4 < ECO < 3 < TOUR < 5 < ACTIVE < 8 < SPORT < 12 < POWER
    // When going DOWN, require crossing threshold - H
    // When going UP, use normal thresholds
    let newMode: AssistMode;

    if (gradient > (currentIdx >= 5 ? 12 - H : 12)) {
      newMode = AssistMode.POWER;
    } else if (gradient > (currentIdx >= 4 ? 8 - H : 8)) {
      newMode = AssistMode.SPORT;
    } else if (gradient > (currentIdx >= 3 ? 5 - H : 5)) {
      newMode = AssistMode.ACTIVE;
    } else if (gradient > (currentIdx >= 2 ? 3 - H : 3)) {
      newMode = AssistMode.TOUR;
    } else if (gradient > (currentIdx >= 1 ? -4 - H : -4)) {
      newMode = AssistMode.ECO;
    } else {
      newMode = AssistMode.OFF;
    }

    this.lastDecidedMode = newMode;
    return newMode;
  }

  // ── Smoothing ─────────────────────────────────────────

  private getStableMode(): AssistMode | null {
    if (this.modeHistory.length < this.config.smoothing_window) return null;
    const window = this.modeHistory.slice(-this.config.smoothing_window);
    const allSame = window.every((m) => m === window[0]);
    return allSame ? window[0]! : null;
  }

  private averageGradient(points: ElevationPoint[]): number {
    if (points.length < 2) return 0;
    const gradients = points.slice(1).map((p) => p.gradient_pct);
    return gradients.reduce((a, b) => a + b, 0) / gradients.length;
  }
}

export const autoAssistEngine = AutoAssistEngine.getInstance();

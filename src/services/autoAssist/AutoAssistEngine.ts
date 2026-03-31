import { AssistMode } from '../../types/bike.types';
import type {
  ElevationPoint,
  TerrainAnalysis,
  TransitionEvent,
  AssistDecision,
} from '../../types/elevation.types';
import { elevationService } from '../maps/ElevationService';

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
  lookahead_m: 300,
  preempt_distance_m: 50,
  override_duration_s: 60,
  smoothing_window: 3,
  climb_threshold_pct: 3,
  descent_threshold_pct: -4,
};

class AutoAssistEngine {
  private static instance: AutoAssistEngine;
  private config: AutoAssistConfig = DEFAULT_CONFIG;
  private lastManualOverride = 0;
  private modeHistory: AssistMode[] = [];

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
    if (!this.config.enabled) {
      return { action: 'none', reason: 'Auto-assist desactivado', terrain: null };
    }

    // 1. MANUAL OVERRIDE — respect rider's choice
    const overrideActive =
      Date.now() - this.lastManualOverride < this.config.override_duration_s * 1000;

    if (overrideActive) {
      const remaining = Math.ceil(
        (this.config.override_duration_s * 1000 - (Date.now() - this.lastManualOverride)) / 1000
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

    if (profile.length < 2) {
      return { action: 'none', reason: 'Sem dados elevacao', terrain: null };
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

  /** Called when mode changes externally (Ergo 3 or app button) */
  notifyManualOverride(source: 'ergo3' | 'app_button'): void {
    this.lastManualOverride = Date.now();
    this.modeHistory = [];
    console.log(`[AutoAssist] Override (${source}), paused ${this.config.override_duration_s}s`);
  }

  getOverrideRemaining(): number {
    const elapsed = Date.now() - this.lastManualOverride;
    const duration = this.config.override_duration_s * 1000;
    return Math.max(0, Math.ceil((duration - elapsed) / 1000));
  }

  isOverrideActive(): boolean {
    return Date.now() - this.lastManualOverride < this.config.override_duration_s * 1000;
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

  // ── Gradient → AssistMode Mapping ─────────────────────

  private gradientToMode(gradient: number): AssistMode {
    if (gradient > 12) return AssistMode.POWER;
    if (gradient > 7) return AssistMode.SPORT;
    if (gradient > 3) return AssistMode.TOUR;
    if (gradient > -4) return AssistMode.ECO;
    return AssistMode.OFF;
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

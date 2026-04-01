/**
 * MotorController — central orchestrator for motor output.
 *
 * Combines terrain-based mode decisions (AutoAssistEngine) with
 * intensity tuning (TorqueEngine) and sends both to the motor:
 *   1. Assist mode (0-4) via sendAssistMode
 *   2. Tuning levels (1-3 per mode) via setTuning
 *
 * Modular: optional providers (HR, Di2, Learning) plug in via interfaces.
 * Each provider returns adjustments, MotorController merges and executes.
 */

import { AssistMode } from '../../types/bike.types';
import type { TuningLevels, TuningMode } from '../../store/tuningStore';
import type { AssistDecision } from '../../types/elevation.types';
import type { TorqueCommand } from '../torque/TorqueEngine';

// === Provider interfaces — plug in optional modules ===

export interface ModeProvider {
  /** Returns a mode decision, or null to defer */
  suggestMode(): AssistDecision | null;
}

export interface TuningProvider {
  /** Returns tuning adjustments, or null to defer */
  suggestTuning(): TuningAdjustment | null;
}

export interface TuningAdjustment {
  /** Per-mode level overrides (1-3). Only set modes you want to change. */
  levels?: Partial<TuningLevels>;
  /** Global multiplier (0.5-1.5) applied to all levels */
  multiplier?: number;
  reason: string;
}

// === Torque → Tuning mapping ===

/** Map absolute torque values to relative tuning level (1=max, 3=min) */
function torqueToLevel(torque_nm: number, support_pct: number): number {
  // Combined intensity score: torque weight 60%, support 40%
  const torqueNorm = Math.min(torque_nm / 85, 1);   // 0-1
  const supportNorm = Math.min(support_pct / 360, 1); // 0-1
  const intensity = torqueNorm * 0.6 + supportNorm * 0.4;

  // Map intensity to levels: high→1 (max), medium→2, low→3 (min)
  if (intensity > 0.65) return 1;
  if (intensity > 0.35) return 2;
  return 3;
}

/** Map TorqueCommand to per-mode TuningLevels based on active mode */
function torqueCommandToTuning(
  cmd: TorqueCommand,
  activeMode: AssistMode,
  currentLevels: TuningLevels,
): TuningLevels {
  const level = torqueToLevel(cmd.torque_nm, cmd.support_pct);

  // Only change the active mode's level — leave others untouched
  const modeMap: Record<number, TuningMode | null> = {
    [AssistMode.POWER]: 'power',
    [AssistMode.SPORT]: 'sport',
    [AssistMode.ACTIVE]: 'active',
    [AssistMode.TOUR]: 'tour',
    [AssistMode.ECO]: 'eco',
    [AssistMode.OFF]: null,
    [AssistMode.WALK]: null,
  };

  const tuningMode = modeMap[activeMode];
  if (!tuningMode) return currentLevels;

  return { ...currentLevels, [tuningMode]: level };
}

// === MotorController ===

export interface MotorDecision {
  /** Whether to change assist mode */
  modeChange: AssistMode | null;
  /** Whether to change tuning levels */
  tuningChange: TuningLevels | null;
  /** Human-readable reason */
  reason: string;
  /** Source of the decision */
  source: 'terrain' | 'torque' | 'override' | 'idle';
}

class MotorController {
  private static instance: MotorController;

  // Optional providers — plug in later
  private modeProviders: Map<string, ModeProvider> = new Map();
  private tuningProviders: Map<string, TuningProvider> = new Map();

  // State
  private lastMode: AssistMode = AssistMode.ECO;
  private lastTuning: TuningLevels = { power: 2, sport: 2, active: 2, tour: 2, eco: 2 };
  private overrideUntil = 0;

  static getInstance(): MotorController {
    if (!MotorController.instance) {
      MotorController.instance = new MotorController();
    }
    return MotorController.instance;
  }

  // === Provider registration ===

  registerModeProvider(name: string, provider: ModeProvider): void {
    this.modeProviders.set(name, provider);
    console.log(`[MotorCtrl] Mode provider registered: ${name}`);
  }

  registerTuningProvider(name: string, provider: TuningProvider): void {
    this.tuningProviders.set(name, provider);
    console.log(`[MotorCtrl] Tuning provider registered: ${name}`);
  }

  removeModeProvider(name: string): void { this.modeProviders.delete(name); }
  removeTuningProvider(name: string): void { this.tuningProviders.delete(name); }

  // === Manual override ===

  notifyManualOverride(durationMs: number = 60_000): void {
    this.overrideUntil = Date.now() + durationMs;
  }

  isOverrideActive(): boolean {
    return Date.now() < this.overrideUntil;
  }

  getOverrideRemaining(): number {
    return Math.max(0, Math.ceil((this.overrideUntil - Date.now()) / 1000));
  }

  // === Main decision cycle ===

  /**
   * Called every tick (2s). Combines all providers into a single motor decision.
   *
   * Priority:
   * 1. Manual override → no changes
   * 2. Mode providers → pick highest-priority mode suggestion
   * 3. Tuning providers → merge adjustments
   * 4. TorqueCommand (if provided) → map to tuning level for active mode
   */
  decide(
    currentMode: AssistMode,
    currentTuning: TuningLevels,
    modeDecision: AssistDecision | null,
    torqueCmd: TorqueCommand | null,
  ): MotorDecision {
    this.lastMode = currentMode;
    this.lastTuning = currentTuning;

    // 1. Override check
    if (this.isOverrideActive()) {
      return {
        modeChange: null,
        tuningChange: null,
        reason: `Override manual (${this.getOverrideRemaining()}s)`,
        source: 'override',
      };
    }

    let newMode: AssistMode | null = null;
    let newTuning: TuningLevels | null = null;
    let reason = '';

    // 2. Mode decision (from AutoAssist terrain engine)
    if (modeDecision?.action === 'change_mode' && modeDecision.new_mode !== undefined) {
      newMode = modeDecision.new_mode;
      reason = modeDecision.reason ?? 'terrain';
    }

    // 2b. Additional mode providers (future: HR override, etc.)
    for (const [name, provider] of this.modeProviders) {
      const suggestion = provider.suggestMode();
      if (suggestion?.action === 'change_mode' && suggestion.new_mode !== undefined) {
        // Higher-priority providers override (e.g., HR zone 5 → POWER)
        newMode = suggestion.new_mode;
        reason = `${name}: ${suggestion.reason}`;
      }
    }

    // 3. Torque → Tuning mapping
    const effectiveMode = newMode ?? currentMode;
    if (torqueCmd) {
      newTuning = torqueCommandToTuning(torqueCmd, effectiveMode, currentTuning);
      if (!reason) reason = torqueCmd.reason;
    }

    // 4. Additional tuning providers (future: learning multiplier, etc.)
    for (const [name, provider] of this.tuningProviders) {
      const adj = provider.suggestTuning();
      if (!adj) continue;

      if (adj.levels) {
        newTuning = { ...(newTuning ?? currentTuning), ...adj.levels };
      }
      if (adj.multiplier && newTuning) {
        // Apply multiplier: scale towards 1 (max) or 3 (min)
        for (const key of Object.keys(newTuning) as TuningMode[]) {
          const base = newTuning[key];
          // multiplier > 1 → more power (lower level), < 1 → less power (higher level)
          const adjusted = Math.round(base / adj.multiplier);
          newTuning[key] = Math.max(1, Math.min(3, adjusted));
        }
      }
      reason += ` + ${name}`;
    }

    // 5. Skip no-ops
    if (newMode === currentMode) newMode = null;
    if (newTuning && this.tuningsEqual(newTuning, currentTuning)) newTuning = null;

    const source = newMode ? 'terrain' : newTuning ? 'torque' : 'idle';

    return { modeChange: newMode, tuningChange: newTuning, reason: reason || 'estável', source };
  }

  private tuningsEqual(a: TuningLevels, b: TuningLevels): boolean {
    return a.power === b.power && a.sport === b.sport &&
      a.active === b.active && a.tour === b.tour && a.eco === b.eco;
  }

  getLastMode(): AssistMode { return this.lastMode; }
  getLastTuning(): TuningLevels { return { ...this.lastTuning }; }
}

export const motorController = MotorController.getInstance();

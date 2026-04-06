/**
 * SmartLightService — intelligent light control based on riding context.
 *
 * Auto-behaviors:
 *   1. Auto-ON when speed > 0 + ambient light < threshold
 *   2. Brake flash on deceleration (speed drop rate)
 *   3. Radar-triggered flash (vehicle approaching)
 *   4. Speed-adaptive brightness (higher speed = brighter)
 *   5. Turn signal via explicit trigger (button/gesture)
 *
 * Integrates with:
 *   - AdaptiveBrightnessService (ambient lux)
 *   - bikeStore (speed, deceleration)
 *   - RadarService (threat level)
 *   - iGPSportLightService (send commands)
 */

import { LightMode } from '../bluetooth/iGPSportLightService';

// ── Configuration ───────────────────────────────────────────────

export interface SmartLightConfig {
  enabled: boolean;
  auto_on_lux: number;           // Auto-on when lux < this (default: 200)
  auto_off_lux: number;          // Auto-off when lux > this (default: 500)
  brake_flash_enabled: boolean;  // Flash on deceleration
  brake_decel_threshold: number; // km/h per second to trigger brake flash (default: 3)
  radar_flash_enabled: boolean;  // Flash when radar detects vehicle
  radar_flash_threat: number;    // Minimum threat level to trigger (1-3, default: 1)
  speed_adaptive: boolean;       // Adjust mode by speed
  low_speed_mode: LightMode;     // Mode when < 15 km/h (default: LOW_STEADY)
  mid_speed_mode: LightMode;     // Mode when 15-30 km/h (default: MID_STEADY)
  high_speed_mode: LightMode;    // Mode when > 30 km/h (default: HIGH_STEADY)
  turn_signal_duration_ms: number; // How long turn signals stay on (default: 5000)
}

export const DEFAULT_SMART_LIGHT_CONFIG: SmartLightConfig = {
  enabled: true,
  auto_on_lux: 200,
  auto_off_lux: 500,
  brake_flash_enabled: true,
  brake_decel_threshold: 3,
  radar_flash_enabled: true,
  radar_flash_threat: 1,
  speed_adaptive: false,
  low_speed_mode: LightMode.LOW_STEADY,
  mid_speed_mode: LightMode.MID_STEADY,
  high_speed_mode: LightMode.HIGH_STEADY,
  turn_signal_duration_ms: 5000,
};

// ── Smart Light Output ──────────────────────────────────────────

export interface SmartLightOutput {
  /** Desired light mode (null = no change) */
  targetMode: LightMode | null;
  /** Reason for the decision */
  reason: string;
  /** Whether this is an override (brake/radar) that should interrupt current mode */
  isOverride: boolean;
  /** Brake flash active */
  braking: boolean;
  /** Radar alert active */
  radarAlert: boolean;
}

// ── Service ─────────────────────────────────────────────────────

export class SmartLightService {
  private config: SmartLightConfig = { ...DEFAULT_SMART_LIGHT_CONFIG };

  // State tracking
  private lightIsOn = false;
  private manualOverride = false;
  private manualOverrideTs = 0;
  private speedHistory: number[] = []; // last 5 speed readings for deceleration
  private brakeFlashActive = false;
  private brakeFlashEndTs = 0;
  private radarFlashActive = false;
  private radarFlashEndTs = 0;
  private turnSignalActive: 'left' | 'right' | null = null;
  private turnSignalEndTs = 0;
  private lastTargetMode: LightMode | null = null;
  private userModeBeforeOverride: LightMode | null = null;

  /** Update config from settings store */
  updateConfig(config: Partial<SmartLightConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /** User manually changed mode — pause auto-control for 60s */
  notifyManualOverride(): void {
    this.manualOverride = true;
    this.manualOverrideTs = Date.now();
  }

  /** Trigger turn signal */
  triggerTurnSignal(direction: 'left' | 'right'): LightMode {
    this.turnSignalActive = direction;
    this.turnSignalEndTs = Date.now() + this.config.turn_signal_duration_ms;
    return direction === 'left' ? LightMode.LEFT_TURN : LightMode.RIGHT_TURN;
  }

  /** Cancel turn signal */
  cancelTurnSignal(): void {
    this.turnSignalActive = null;
    this.turnSignalEndTs = 0;
  }

  /**
   * Main tick — called every ~5s from KromiEngine or standalone interval.
   *
   * @param speed_kmh Current speed
   * @param lux Current ambient light (0 = unknown)
   * @param radarThreat Current radar threat level (0-3)
   * @param currentMode Current light mode on the device
   * @param lightConnected Whether light is connected
   */
  tick(
    speed_kmh: number,
    lux: number,
    radarThreat: number,
    currentMode: LightMode,
    lightConnected: boolean,
  ): SmartLightOutput {
    const now = Date.now();

    // Not connected or disabled — no action
    if (!lightConnected || !this.config.enabled) {
      return { targetMode: null, reason: 'disabled', isOverride: false, braking: false, radarAlert: false };
    }

    // Manual override expires after 60s
    if (this.manualOverride && now - this.manualOverrideTs > 60_000) {
      this.manualOverride = false;
    }

    // Track speed for deceleration detection
    this.speedHistory.push(speed_kmh);
    if (this.speedHistory.length > 5) this.speedHistory.shift();

    // ── Priority 1: Turn signal (highest priority) ──────────
    if (this.turnSignalActive && now < this.turnSignalEndTs) {
      const mode = this.turnSignalActive === 'left' ? LightMode.LEFT_TURN : LightMode.RIGHT_TURN;
      return { targetMode: mode, reason: `turn_${this.turnSignalActive}`, isOverride: true, braking: false, radarAlert: false };
    } else if (this.turnSignalActive) {
      this.turnSignalActive = null; // Expired
    }

    // ── Priority 2: Brake flash ─────────────────────────────
    if (this.config.brake_flash_enabled) {
      const decel = this.computeDeceleration();
      if (decel > this.config.brake_decel_threshold && speed_kmh > 3) {
        if (!this.brakeFlashActive) {
          this.userModeBeforeOverride = currentMode;
        }
        this.brakeFlashActive = true;
        this.brakeFlashEndTs = now + 2000; // Flash for 2 seconds
      }
    }

    if (this.brakeFlashActive) {
      if (now < this.brakeFlashEndTs) {
        return { targetMode: LightMode.HIGH_BLINK, reason: 'braking', isOverride: true, braking: true, radarAlert: false };
      }
      this.brakeFlashActive = false;
      // Restore previous mode
      if (this.userModeBeforeOverride !== null) {
        const restore = this.userModeBeforeOverride;
        this.userModeBeforeOverride = null;
        return { targetMode: restore, reason: 'brake_end', isOverride: true, braking: false, radarAlert: false };
      }
    }

    // ── Priority 3: Radar threat flash ──────────────────────
    if (this.config.radar_flash_enabled && radarThreat >= this.config.radar_flash_threat) {
      if (!this.radarFlashActive) {
        this.userModeBeforeOverride = currentMode;
      }
      this.radarFlashActive = true;
      this.radarFlashEndTs = now + 3000;
      return {
        targetMode: radarThreat >= 3 ? LightMode.HIGH_BLINK : LightMode.LOW_BLINK,
        reason: `radar_threat_${radarThreat}`,
        isOverride: true,
        braking: false,
        radarAlert: true,
      };
    }

    if (this.radarFlashActive && now >= this.radarFlashEndTs) {
      this.radarFlashActive = false;
      if (this.userModeBeforeOverride !== null) {
        const restore = this.userModeBeforeOverride;
        this.userModeBeforeOverride = null;
        return { targetMode: restore, reason: 'radar_clear', isOverride: true, braking: false, radarAlert: false };
      }
    }

    // ── Manual override active — skip auto logic ────────────
    if (this.manualOverride) {
      return { targetMode: null, reason: 'manual_override', isOverride: false, braking: false, radarAlert: false };
    }

    // ── Auto ON/OFF by ambient light ────────────────────────
    if (lux > 0) {
      const isRiding = speed_kmh > 1;

      if (!this.lightIsOn && isRiding && lux < this.config.auto_on_lux) {
        this.lightIsOn = true;
        const mode = this.modeForSpeed(speed_kmh);
        return { targetMode: mode, reason: 'auto_on_dark', isOverride: false, braking: false, radarAlert: false };
      }

      if (this.lightIsOn && lux > this.config.auto_off_lux && !isRiding) {
        this.lightIsOn = false;
        return { targetMode: LightMode.OFF, reason: 'auto_off_bright', isOverride: false, braking: false, radarAlert: false };
      }
    }

    // ── Speed-adaptive mode ─────────────────────────────────
    if (this.config.speed_adaptive && this.lightIsOn && currentMode !== LightMode.OFF) {
      const targetMode = this.modeForSpeed(speed_kmh);
      if (targetMode !== this.lastTargetMode) {
        this.lastTargetMode = targetMode;
        return { targetMode, reason: 'speed_adaptive', isOverride: false, braking: false, radarAlert: false };
      }
    }

    // ── No change needed ────────────────────────────────────
    return { targetMode: null, reason: 'no_change', isOverride: false, braking: false, radarAlert: false };
  }

  // ── Internal helpers ──────────────────────────────────────────

  /** Compute deceleration in km/h per second from speed history */
  private computeDeceleration(): number {
    if (this.speedHistory.length < 2) return 0;
    // Compare last two readings (each ~1s apart)
    const recent = this.speedHistory[this.speedHistory.length - 1]!;
    const prev = this.speedHistory[this.speedHistory.length - 2]!;
    const decel = prev - recent; // Positive = slowing down
    return Math.max(0, decel);
  }

  /** Choose light mode based on speed */
  private modeForSpeed(speed: number): LightMode {
    if (speed > 30) return this.config.high_speed_mode;
    if (speed > 15) return this.config.mid_speed_mode;
    return this.config.low_speed_mode;
  }
}

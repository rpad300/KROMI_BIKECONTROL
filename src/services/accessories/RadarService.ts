/**
 * RadarService — processes radar targets with hysteresis and threat management.
 *
 * Receives raw radar data (distance, speed, threat level) from either:
 *   - WebSocket bridge (radarTarget messages)
 *   - Direct BLE via iGPSPORT radar protocol
 *
 * Features:
 *   - Target tracking with hysteresis (prevents flicker)
 *   - Proximity alerts with configurable vibration
 *   - Integration with SmartLightService (flash on threat)
 *   - Approach rate calculation (closing speed)
 *   - Multiple vehicle tracking (up to 8 targets)
 */

// ── Configuration ───────────────────────────────────────────────

export interface RadarConfig {
  enabled: boolean;
  vibrate_on_threat: boolean;
  vibrate_min_threat: number;     // Minimum level to vibrate (1-3, default: 2)
  sound_alert: boolean;           // Future: play sound on threat
  max_targets: number;            // Max tracked vehicles (default: 8)
  clear_timeout_ms: number;       // Remove target after this timeout (default: 3000)
  threat_hysteresis_ms: number;   // Keep threat level for at least this long (default: 2000)
}

export const DEFAULT_RADAR_CONFIG: RadarConfig = {
  enabled: true,
  vibrate_on_threat: true,
  vibrate_min_threat: 2,
  sound_alert: false,
  max_targets: 8,
  clear_timeout_ms: 3000,
  threat_hysteresis_ms: 2000,
};

// ── Target tracking ─────────────────────────────────────────────

export interface RadarTarget {
  id: number;
  distance_m: number;      // Distance in meters
  speed_kmh: number;       // Vehicle speed
  threat_level: number;    // 0-3 (none, low, mid, high)
  closing_speed_kmh: number; // How fast it's approaching (positive = closing)
  last_seen: number;       // Timestamp
  first_seen: number;      // When first detected
}

export interface RadarState {
  targets: RadarTarget[];
  max_threat: number;         // Highest current threat level (0-3)
  closest_distance_m: number; // Distance of closest vehicle (0 = none)
  closest_speed_kmh: number;  // Speed of closest vehicle
  vehicle_count: number;      // Number of tracked vehicles
  last_alert_ts: number;      // When last vibration was triggered
}

// ── Service ─────────────────────────────────────────────────────

export class RadarService {
  private config: RadarConfig = { ...DEFAULT_RADAR_CONFIG };
  private targets: Map<number, RadarTarget> = new Map();
  private nextTargetId = 1;
  private maxThreatTs = 0; // Timestamp when max threat was last set
  private maxThreatHeld = 0; // Held threat level during hysteresis

  /** Current state snapshot */
  state: RadarState = {
    targets: [],
    max_threat: 0,
    closest_distance_m: 0,
    closest_speed_kmh: 0,
    vehicle_count: 0,
    last_alert_ts: 0,
  };

  /** Callback when state changes */
  onStateChange: ((state: RadarState) => void) | null = null;

  /** Update config */
  updateConfig(config: Partial<RadarConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Process incoming radar target data.
   * Called when a radarTarget message arrives from bridge or BLE.
   *
   * @param targets Array of raw targets from the radar device
   */
  processTargets(rawTargets: { range_cm: number; speed_kmh: number; level: number }[]): void {
    if (!this.config.enabled) return;

    const now = Date.now();

    // Match incoming targets to existing tracked targets
    // Simple matching: closest distance match within 5m
    for (const raw of rawTargets) {
      const dist_m = raw.range_cm / 100;
      const existing = this.findClosestTarget(dist_m, 5);

      if (existing) {
        // Update existing target
        const prevDist = existing.distance_m;
        existing.distance_m = dist_m;
        existing.speed_kmh = raw.speed_kmh;
        existing.threat_level = raw.level;
        existing.closing_speed_kmh = (prevDist - dist_m) * 2; // *2 because ~0.5s update rate
        existing.last_seen = now;
      } else if (this.targets.size < this.config.max_targets) {
        // New target
        const target: RadarTarget = {
          id: this.nextTargetId++,
          distance_m: dist_m,
          speed_kmh: raw.speed_kmh,
          threat_level: raw.level,
          closing_speed_kmh: 0,
          last_seen: now,
          first_seen: now,
        };
        this.targets.set(target.id, target);
      }
    }

    // Remove stale targets
    for (const [id, target] of this.targets) {
      if (now - target.last_seen > this.config.clear_timeout_ms) {
        this.targets.delete(id);
      }
    }

    this.updateState(now);
  }

  /**
   * Process a single target update (from WebSocket bridge format).
   */
  processSingleTarget(level: number, range_cm: number, speed_kmh: number): void {
    if (level === 0 && range_cm === 0) {
      // Clear signal
      this.clear();
      return;
    }
    this.processTargets([{ range_cm, speed_kmh, level }]);
  }

  /** Clear all targets (radar reports no vehicles) */
  clear(): void {
    this.targets.clear();
    this.maxThreatHeld = 0;
    this.updateState(Date.now());
  }

  /**
   * Tick — called periodically to clean up stale targets.
   */
  tick(): void {
    const now = Date.now();
    let changed = false;

    for (const [id, target] of this.targets) {
      if (now - target.last_seen > this.config.clear_timeout_ms) {
        this.targets.delete(id);
        changed = true;
      }
    }

    // Release hysteresis
    if (this.maxThreatHeld > 0 && now - this.maxThreatTs > this.config.threat_hysteresis_ms) {
      this.maxThreatHeld = 0;
      changed = true;
    }

    if (changed) this.updateState(now);
  }

  // ── Internal ──────────────────────────────────────────────────

  private findClosestTarget(dist_m: number, threshold_m: number): RadarTarget | null {
    let best: RadarTarget | null = null;
    let bestDiff = threshold_m;

    for (const target of this.targets.values()) {
      const diff = Math.abs(target.distance_m - dist_m);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = target;
      }
    }
    return best;
  }

  private updateState(now: number): void {
    const targetList = Array.from(this.targets.values());

    // Find max threat with hysteresis
    const currentMax = targetList.reduce((max, t) => Math.max(max, t.threat_level), 0);
    if (currentMax > this.maxThreatHeld) {
      this.maxThreatHeld = currentMax;
      this.maxThreatTs = now;
    }
    const effectiveThreat = Math.max(
      currentMax,
      now - this.maxThreatTs < this.config.threat_hysteresis_ms ? this.maxThreatHeld : 0,
    );

    // Find closest
    const closest = targetList.reduce<RadarTarget | null>(
      (c, t) => (!c || t.distance_m < c.distance_m) ? t : c, null,
    );

    this.state = {
      targets: targetList,
      max_threat: effectiveThreat,
      closest_distance_m: closest?.distance_m ?? 0,
      closest_speed_kmh: closest?.speed_kmh ?? 0,
      vehicle_count: targetList.length,
      last_alert_ts: this.state.last_alert_ts,
    };

    // Vibration alert
    if (
      this.config.vibrate_on_threat &&
      effectiveThreat >= this.config.vibrate_min_threat &&
      now - this.state.last_alert_ts > 3000 && // Don't vibrate more than every 3s
      'vibrate' in navigator
    ) {
      this.state.last_alert_ts = now;
      if (effectiveThreat >= 3) {
        navigator.vibrate([200, 100, 200, 100, 200]); // Urgent: triple pulse
      } else {
        navigator.vibrate([200, 100, 200]); // Warning: double pulse
      }
    }

    this.onStateChange?.(this.state);
  }
}

/** Singleton instance */
export const radarService = new RadarService();

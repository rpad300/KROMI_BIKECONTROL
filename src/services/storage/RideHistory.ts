/**
 * RideSessionManager — orchestrates full ride data capture.
 *
 * Flow:
 * 1. User taps "Iniciar Volta" → startSession()
 *    - Records start time, battery, GPS, connected devices
 *    - Creates ride_sessions row in Supabase
 *    - Starts 5s capture interval
 *
 * 2. Every 5s → captureSnapshot()
 *    - Reads ALL stores (bike, map, autoAssist, torque)
 *    - Batches snapshots and flushes to Supabase every 30s
 *
 * 3. User taps "Terminar Volta" → stopSession()
 *    - Calculates summary from snapshots
 *    - Updates ride_sessions with summary
 *    - Triggers AdaptiveLearningEngine
 *    - Syncs athlete profile
 */

import { useBikeStore } from '../../store/bikeStore';
import { useMapStore } from '../../store/mapStore';
import { useAutoAssistStore } from '../../store/autoAssistStore';
import { useAuthStore } from '../../store/authStore';
import { useTorqueStore } from '../../store/torqueStore';
import { useAthleteStore } from '../../store/athleteStore';
import { useLearningStore } from '../../store/learningStore';
import { autoAssistEngine } from '../autoAssist/AutoAssistEngine';
import { batteryEfficiencyTracker } from '../learning/BatteryEfficiencyTracker';
import { syncQueue } from '../sync/SyncQueue';


// Supabase access is now via SyncQueue (offline-first)

interface SnapshotRow {
  session_id: string;
  elapsed_s: number;
  lat: number;
  lng: number;
  altitude_m: number | null;
  heading: number;
  gps_accuracy: number;
  speed_kmh: number;
  cadence_rpm: number;
  power_watts: number;
  battery_pct: number;
  assist_mode: number;
  distance_km: number;
  hr_bpm: number;
  hr_zone: number;
  gear: number;
  is_shifting: boolean;
  torque_nm: number;
  support_pct: number;
  launch_value: number;
  climb_type: string;
  gradient_pct: number;
  auto_assist_active: boolean;
  auto_assist_reason: string;
  was_overridden: boolean;
  // New fields (v0.9.2+)
  assist_current_a: number;
  front_gear: number;
  rear_gear: number;
  trip_distance_km: number;
  trip_time_s: number;
  range_km: number;
  spo2_pct: number;
}

export interface RideSessionState {
  sessionId: string | null;
  active: boolean;
  startedAt: number;
  elapsedS: number;
  snapshotCount: number;
}

const PERSIST_KEY = 'bikecontrol-ride-session';

interface PersistedSession {
  sessionId: string;
  startedAt: number;
  snapshotCount: number;
  overrideCount: number;
}

class RideSessionManager {
  private static instance: RideSessionManager;
  private sessionId: string | null = null;
  private startedAt = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private flushIntervalId: ReturnType<typeof setInterval> | null = null;
  private snapshotBuffer: SnapshotRow[] = [];
  private snapshotCount = 0;
  private overrideCount = 0;

  static getInstance(): RideSessionManager {
    if (!RideSessionManager.instance) {
      RideSessionManager.instance = new RideSessionManager();
      RideSessionManager.instance.tryResume();
    }
    return RideSessionManager.instance;
  }

  /** Persist active session to localStorage */
  private persist(): void {
    if (!this.sessionId) {
      localStorage.removeItem(PERSIST_KEY);
      return;
    }
    const data: PersistedSession = {
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      snapshotCount: this.snapshotCount,
      overrideCount: this.overrideCount,
    };
    localStorage.setItem(PERSIST_KEY, JSON.stringify(data));
  }

  /** Resume session after page refresh */
  private tryResume(): void {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return;

    try {
      const saved: PersistedSession = JSON.parse(raw);
      if (!saved.sessionId || !saved.startedAt) return;

      // Don't resume sessions older than 12h (stale)
      if (Date.now() - saved.startedAt > 12 * 60 * 60 * 1000) {
        console.log('[RideSession] ⏰ Stale session discarded (>12h)');
        localStorage.removeItem(PERSIST_KEY);
        return;
      }

      this.sessionId = saved.sessionId;
      this.startedAt = saved.startedAt;
      this.snapshotCount = saved.snapshotCount || 0;
      this.overrideCount = saved.overrideCount || 0;
      this.snapshotBuffer = [];

      // Restart capture intervals
      this.intervalId = setInterval(() => this.captureSnapshot(), 5000);
      this.flushIntervalId = setInterval(() => this.flushSnapshots(), 30000);

      // Restore rideActive in athlete store
      useAthleteStore.getState().setRideActive(true);

      const elapsedMin = Math.round((Date.now() - this.startedAt) / 60000);
      console.log(`[RideSession] 🔄 RESUMED session ${this.sessionId} (${elapsedMin}min elapsed, ${this.snapshotCount} snapshots before refresh)`);
    } catch {
      localStorage.removeItem(PERSIST_KEY);
    }
  }

  async startSession(): Promise<string | null> {
    if (this.sessionId) return this.sessionId;

    const bike = useBikeStore.getState();
    const map = useMapStore.getState();

    this.sessionId = crypto.randomUUID();
    this.startedAt = Date.now();
    this.snapshotCount = 0;
    this.overrideCount = 0;
    this.snapshotBuffer = [];

    batteryEfficiencyTracker.reset();

    // Persist to Supabase (via SyncQueue — direct sync when online)
    const userId = useAuthStore.getState().getUserId();
    try {
      await syncQueue.push('ride_sessions', {
        id: this.sessionId,
        athlete_id: null,
        user_id: userId,
        status: 'active',
        battery_start: bike.battery_percent,
        start_lat: map.latitude || null,
        start_lng: map.longitude || null,
        devices_connected: {
          ble: bike.ble_status === 'connected',
          battery: bike.ble_services.battery,
          csc: bike.ble_services.csc,
          power: bike.ble_services.power,
          gev: bike.ble_services.gev,
          heartRate: bike.ble_services.heartRate,
          di2: bike.ble_services.di2,
          gps: map.gpsActive,
        },
      });
    } catch (err) {
      console.error('[RideSession] Failed to push session:', err);
    }

    // Start capture every 5s
    this.intervalId = setInterval(() => this.captureSnapshot(), 5000);

    // Flush buffer to Supabase every 30s
    this.flushIntervalId = setInterval(() => this.flushSnapshots(), 30000);

    useAthleteStore.getState().setRideActive(true);
    this.persist();
    console.log('[RideSession] Started:', this.sessionId);
    return this.sessionId;
  }

  async stopSession(): Promise<void> {
    if (!this.sessionId) return;

    // Stop intervals
    if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null; }
    if (this.flushIntervalId) { clearInterval(this.flushIntervalId); this.flushIntervalId = null; }

    // Final flush
    await this.flushSnapshots();

    const bike = useBikeStore.getState();
    const map = useMapStore.getState();
    const elapsedS = Math.round((Date.now() - this.startedAt) / 1000);

    // Update session with summary (via SyncQueue)
    await syncQueue.push('ride_sessions', {
      status: 'completed',
      ended_at: new Date().toISOString(),
      duration_s: elapsedS,
      total_km: bike.distance_km,
      avg_speed_kmh: elapsedS > 0 ? Math.round(bike.distance_km / (elapsedS / 3600) * 10) / 10 : 0,
      max_speed_kmh: bike.speed_max,
      avg_power_w: Math.round(bike.power_avg),
      max_power_w: bike.power_max,
      max_hr: bike.hr_bpm,
      battery_end: bike.battery_percent,
      override_count: this.overrideCount,
      override_rate: this.snapshotCount > 0 ? this.overrideCount / this.snapshotCount : 0,
      avg_gps_accuracy: map.accuracySamples > 0 ? Math.round(map.accuracySum / map.accuracySamples * 10) / 10 : null,
      end_lat: map.latitude || null,
      end_lng: map.longitude || null,
    }, 'PATCH', `/ride_sessions?id=eq.${this.sessionId}`);

    // Process ride for adaptive learning
    const rideSummary = {
      id: this.sessionId,
      snapshots: [],
      duration_s: elapsedS,
      total_km: bike.distance_km,
      total_elevation_m: 0,
      avg_speed_kmh: elapsedS > 0 ? Math.round(bike.distance_km / (elapsedS / 3600) * 10) / 10 : 0,
      max_speed_kmh: bike.speed_max,
      avg_power_w: Math.round(bike.power_avg),
      max_power_w: bike.power_max,
      avg_cadence: 0,
      max_hr: bike.hr_bpm,
      avg_hr: 0,
      battery_start: 0,
      battery_end: bike.battery_percent,
      override_rate: this.snapshotCount > 0 ? this.overrideCount / this.snapshotCount : 0,
      ftp_estimate: 0,
      tss_score: 0,
      override_events: [],
      created_at: new Date(),
    };

    await useAthleteStore.getState().processRide(rideSummary);

    // Reset
    this.sessionId = null;
    this.startedAt = 0;
    this.snapshotCount = 0;
    this.persist(); // clears localStorage
    useAthleteStore.getState().setRideActive(false);
    bike.resetSession();
    console.log('[RideSession] ⏹ Session STOPPED and cleared');
  }

  /** Record an override event with full context */
  recordOverride(source: 'ergo3' | 'app_button', fromMode: number, toMode?: number): void {
    if (!this.sessionId) return;
    this.overrideCount++;

    {
      const bike = useBikeStore.getState();
      const terrain = useAutoAssistStore.getState().terrain;
      const torque = useTorqueStore.getState();
      const decision = useAutoAssistStore.getState().lastDecision;

      const gradientPct = terrain?.current_gradient_pct ?? 0;
      const hrZone = bike.hr_zone;

      syncQueue.push('ride_override_events', {
        session_id: this.sessionId,
        elapsed_s: Math.round((Date.now() - this.startedAt) / 1000),
        source,
        from_mode: fromMode,
        to_mode: toMode,
        speed_kmh: bike.speed_kmh,
        gradient_pct: gradientPct,
        hr_bpm: bike.hr_bpm,
        hr_zone: hrZone,
        gear: bike.gear,
        torque_nm: torque.torque_nm,
        climb_type: torque.climb_type,
        auto_assist_reason: decision?.reason ?? '',
      });

      // Adaptive learning: record override direction in learning store
      const direction = (toMode !== undefined && toMode > fromMode) ? 'more' as const
        : (toMode !== undefined && toMode < fromMode) ? 'less' as const : null;
      if (direction) {
        useLearningStore.getState().recordOverride(gradientPct, hrZone, direction);
      }
    }
  }

  private captureSnapshot(): void {
    if (!this.sessionId) return;

    const bike = useBikeStore.getState();
    const map = useMapStore.getState();
    const terrain = useAutoAssistStore.getState().terrain;
    const torque = useTorqueStore.getState();
    const aaStore = useAutoAssistStore.getState();

    const isOverride = autoAssistEngine.isOverrideActive();

    this.snapshotCount++;

    // Track battery efficiency
    batteryEfficiencyTracker.tick(bike.assist_mode, bike.speed_kmh);

    const row: SnapshotRow = {
      session_id: this.sessionId,
      elapsed_s: Math.round((Date.now() - this.startedAt) / 1000),
      lat: map.latitude,
      lng: map.longitude,
      altitude_m: map.altitude,
      heading: map.heading,
      gps_accuracy: map.accuracy,
      speed_kmh: bike.speed_kmh,
      cadence_rpm: bike.cadence_rpm,
      power_watts: bike.power_watts,
      battery_pct: bike.battery_percent,
      assist_mode: bike.assist_mode,
      distance_km: bike.distance_km,
      hr_bpm: bike.hr_bpm,
      hr_zone: bike.hr_zone,
      gear: bike.gear,
      is_shifting: bike.is_shifting,
      torque_nm: torque.torque_nm,
      support_pct: torque.support_pct,
      launch_value: torque.launch_value,
      climb_type: torque.climb_type as string,
      gradient_pct: terrain?.current_gradient_pct ?? 0,
      auto_assist_active: aaStore.enabled && !isOverride,
      auto_assist_reason: aaStore.lastDecision?.reason ?? '',
      was_overridden: isOverride,
      // New telemetry (v0.9.2+)
      assist_current_a: bike.assist_current_a,
      front_gear: bike.front_gear,
      rear_gear: bike.rear_gear,
      trip_distance_km: bike.trip_distance_km,
      trip_time_s: bike.trip_time_s,
      range_km: bike.range_km,
      spo2_pct: bike.spo2_pct,
    };

    this.snapshotBuffer.push(row);

    // Persist count every 12 snapshots (1 min)
    if (this.snapshotCount % 12 === 0) this.persist();
  }

  private async flushSnapshots(): Promise<void> {
    if (this.snapshotBuffer.length === 0) return;

    const batch = [...this.snapshotBuffer];
    this.snapshotBuffer = [];

    try {
      await syncQueue.pushBatch('ride_snapshots', batch as unknown as Record<string, unknown>[]);
    } catch (err) {
      console.error('[RideSession] Flush failed:', err);
    }
  }

  getState(): RideSessionState {
    return {
      sessionId: this.sessionId,
      active: this.sessionId !== null,
      startedAt: this.startedAt,
      elapsedS: this.sessionId ? Math.round((Date.now() - this.startedAt) / 1000) : 0,
      snapshotCount: this.snapshotCount,
    };
  }

  isActive(): boolean {
    return this.sessionId !== null;
  }
}

export const rideSessionManager = RideSessionManager.getInstance();

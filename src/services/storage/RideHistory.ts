/**
 * RideSessionManager — orchestrates full ride data capture.
 *
 * Resilience: ALL ride data goes to LocalRideStore (IndexedDB) FIRST.
 * Supabase sync happens in background via LocalRideStore sync engine.
 * Data is NEVER deleted until confirmed synced (HTTP 200).
 * No localStorage dependency — IndexedDB is more durable.
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
import { localRideStore, type LocalSession, type LocalSnapshot, type LocalOverrideEvent, type PersistedMetrics } from './LocalRideStore';

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
  assist_current_a: number;
  front_gear: number;
  rear_gear: number;
  trip_distance_km: number;
  trip_time_s: number;
  range_km: number;
  spo2_pct: number;
  // Phone sensors
  pressure_hpa: number;
  barometric_altitude_m: number | null;
  lean_angle_deg: number;
  temperature_c: number;
}

export interface RideSessionState {
  sessionId: string | null;
  active: boolean;
  startedAt: number;
  elapsedS: number;
  snapshotCount: number;
}

const FLUSH_INTERVAL = 10_000; // 10s — flush buffer to IndexedDB
const CAPTURE_INTERVAL = 5_000; // 5s — capture snapshot from stores
const METRICS_PERSIST_EVERY = 6; // persist metrics every 6 snapshots (30s)

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

class RideSessionManager {
  private static instance: RideSessionManager;
  private sessionId: string | null = null;
  private startedAt = 0;
  private presenceIntervalId: ReturnType<typeof setInterval> | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private flushIntervalId: ReturnType<typeof setInterval> | null = null;
  private snapshotBuffer: SnapshotRow[] = [];
  private snapshotCount = 0;
  private overrideCount = 0;
  private metrics: PersistedMetrics = this.emptyMetrics();

  static getInstance(): RideSessionManager {
    if (!RideSessionManager.instance) {
      RideSessionManager.instance = new RideSessionManager();
      // tryResume is async but we fire-and-forget from constructor
      // It will set rideActive=true in the store if a session is found
      RideSessionManager.instance.tryResume();
      RideSessionManager.instance.registerLifecycleHandlers();
    }
    return RideSessionManager.instance;
  }

  private emptyMetrics(): PersistedMetrics {
    return {
      distance_km: 0, start_km: 0, speed_max: 0,
      power_avg: 0, power_max: 0, power_sum: 0, power_count: 0,
      hr_max: 0, hr_sum: 0, hr_count: 0,
      cadence_sum: 0, cadence_count: 0,
      battery_start: 0,
    };
  }

  // ── Lifecycle handlers — flush on background/close ──

  private registerLifecycleHandlers(): void {
    // Flush when tab goes to background (Chrome Android kills tabs here)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.sessionId) {
        this.emergencyFlush();
      }
    });

    // Flush on page unload (user closes tab, navigates away)
    window.addEventListener('pagehide', () => {
      if (this.sessionId) {
        this.emergencyFlush();
      }
    });
  }

  /** Emergency flush — write buffer to IndexedDB (fire-and-forget) */
  private emergencyFlush(): void {
    if (this.snapshotBuffer.length === 0 && this.sessionId) {
      // No buffer to flush, but persist metrics
      localRideStore.updateSession(this.sessionId, { metrics: this.metrics }).catch(() => {});
      return;
    }

    const batch = [...this.snapshotBuffer];
    this.snapshotBuffer = [];

    const localSnaps: LocalSnapshot[] = batch.map(row => ({
      ...row,
      sync_status: 'local' as const,
      synced_at: null,
    }));

    // Write to IndexedDB — fire-and-forget (pagehide gives limited time)
    localRideStore.writeSnapshots(localSnaps).catch((err) => {
      console.error('[RideSession] Emergency flush to IndexedDB failed:', err);
      // Put back in buffer — next resume will find them in memory (if process survives)
      this.snapshotBuffer.unshift(...batch);
    });

    // Also persist session metrics
    if (this.sessionId) {
      localRideStore.updateSession(this.sessionId, { metrics: this.metrics }).catch(() => {});
    }
  }

  // ── Resume ──

  private async tryResume(): Promise<void> {
    try {
      // First, migrate any old localStorage data to IndexedDB
      await localRideStore.migrateFromLocalStorage();

      // Check for active session in IndexedDB
      const activeSession = await localRideStore.getActiveSession();
      if (!activeSession) {
        useAthleteStore.getState().setRideActive(false);
        return;
      }

      // Don't resume sessions older than 12h
      if (Date.now() - activeSession.started_at > 12 * 60 * 60 * 1000) {
        console.log('[RideSession] Stale session discarded (>12h)');
        await localRideStore.updateSession(activeSession.id, { status: 'completed' });
        useAthleteStore.getState().setRideActive(false);
        return;
      }

      this.sessionId = activeSession.id;
      this.startedAt = activeSession.started_at;
      this.snapshotCount = 0; // Will be updated from IndexedDB
      this.overrideCount = activeSession.override_count;
      this.metrics = activeSession.metrics || this.emptyMetrics();
      this.snapshotBuffer = [];

      // Count existing snapshots for this session
      const existingSnaps = await localRideStore.getSessionSnapshots(activeSession.id);
      this.snapshotCount = existingSnaps.length;

      // Restart capture intervals
      this.intervalId = setInterval(() => this.captureSnapshot(), CAPTURE_INTERVAL);
      this.flushIntervalId = setInterval(() => this.flushSnapshots(), FLUSH_INTERVAL);

      useAthleteStore.getState().setRideActive(true);

      const elapsedMin = Math.round((Date.now() - this.startedAt) / 60000);
      console.log(`[RideSession] Resumed: ${this.sessionId} (${elapsedMin}min, ${this.snapshotCount} snaps from IndexedDB)`);
    } catch (err) {
      console.error('[RideSession] Resume failed:', err);
      useAthleteStore.getState().setRideActive(false);
    }
  }

  // ── Start / Stop ──

  async startSession(): Promise<string | null> {
    const dlog = (window as unknown as Record<string, (m: string) => void>).__dlog ?? console.log;
    dlog(`startSession called — existing=${this.sessionId}`);

    if (this.sessionId) return this.sessionId;

    const bike = useBikeStore.getState();
    const map = useMapStore.getState();

    this.sessionId = crypto.randomUUID();
    this.startedAt = Date.now();
    this.snapshotCount = 0;
    this.overrideCount = 0;
    this.snapshotBuffer = [];
    this.metrics = {
      ...this.emptyMetrics(),
      battery_start: bike.battery_percent,
      start_km: bike.distance_km || bike.trip_distance_km || 0,
    };

    batteryEfficiencyTracker.reset();

    const userId = useAuthStore.getState().getUserId();
    console.log('[RideSession] user_id for session:', userId);

    // Write session to IndexedDB FIRST — this is the durable store
    try {
      const session: LocalSession = {
        id: this.sessionId,
        user_id: userId,
        status: 'active',
        sync_status: 'local',
        started_at: this.startedAt,
        ended_at: null,
        battery_start: bike.battery_percent,
        battery_end: null,
        start_lat: map.latitude || null,
        start_lng: map.longitude || null,
        end_lat: null,
        end_lng: null,
        duration_s: null,
        total_km: null,
        avg_speed_kmh: null,
        max_speed_kmh: null,
        avg_power_w: null,
        max_power_w: null,
        avg_cadence: null,
        max_hr: null,
        avg_hr: null,
        override_count: 0,
        override_rate: null,
        avg_gps_accuracy: null,
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
        synced_at: null,
        metrics: this.metrics,
      };
      await localRideStore.createSession(session);
      dlog(`Session saved to IDB: ${this.sessionId} user=${userId}`);
    } catch (err) {
      dlog(`CRITICAL: IDB save FAILED: ${String(err)}`);
      // Continue anyway — we'll still collect data in memory buffer
    }

    this.intervalId = setInterval(() => this.captureSnapshot(), CAPTURE_INTERVAL);
    this.flushIntervalId = setInterval(() => this.flushSnapshots(), FLUSH_INTERVAL);

    // Start community rescue presence sync (every 60s)
    this.startPresenceSync();

    useAthleteStore.getState().setRideActive(true);
    console.log('[RideSession] Started:', this.sessionId);
    return this.sessionId;
  }

  async stopSession(): Promise<void> {
    if (!this.sessionId) return;

    if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null; }
    if (this.flushIntervalId) { clearInterval(this.flushIntervalId); this.flushIntervalId = null; }
    this.stopPresenceSync();

    // Final flush of remaining buffer to IndexedDB
    await this.flushSnapshots();

    const bike = useBikeStore.getState();
    const map = useMapStore.getState();
    const elapsedS = Math.round((Date.now() - this.startedAt) / 1000);

    // Use persisted metrics (survive tab kill) with fallback to live bikeStore
    const m = this.metrics;
    // Trip distance = current odometer - start odometer (NOT the raw odometer value)
    const currentKm = m.distance_km > 0 ? m.distance_km : bike.distance_km;
    const totalKm = Math.max(0, currentKm - (m.start_km || 0));
    const avgSpeed = elapsedS > 0 ? Math.round(totalKm / (elapsedS / 3600) * 10) / 10 : 0;
    const maxSpeed = Math.max(m.speed_max, bike.speed_max || 0);
    const avgPower = m.power_count > 0 ? Math.round(m.power_sum / m.power_count) : Math.round(bike.power_avg);
    const maxPower = Math.max(m.power_max, bike.power_max || 0);
    const maxHr = Math.max(m.hr_max, bike.hr_bpm || 0);
    const avgHr = m.hr_count > 0 ? Math.round(m.hr_sum / m.hr_count) : 0;
    const avgCadence = m.cadence_count > 0 ? Math.round(m.cadence_sum / m.cadence_count) : 0;

    // Update session in IndexedDB with final stats
    try {
      await localRideStore.updateSession(this.sessionId, {
        status: 'completed',
        ended_at: Date.now(),
        duration_s: elapsedS,
        total_km: totalKm,
        avg_speed_kmh: avgSpeed,
        max_speed_kmh: maxSpeed,
        avg_power_w: avgPower,
        max_power_w: maxPower,
        avg_cadence: avgCadence,
        max_hr: maxHr,
        avg_hr: avgHr,
        battery_end: bike.battery_percent,
        override_count: this.overrideCount,
        override_rate: this.snapshotCount > 0 ? this.overrideCount / this.snapshotCount : 0,
        avg_gps_accuracy: map.accuracySamples > 0 ? Math.round(map.accuracySum / map.accuracySamples * 10) / 10 : null,
        end_lat: map.latitude || null,
        end_lng: map.longitude || null,
        metrics: this.metrics,
      });
      console.log('[RideSession] Session finalized in IndexedDB:', this.sessionId);
    } catch (err) {
      console.error('[RideSession] Failed to finalize session in IndexedDB:', err);
    }

    // Trigger immediate Supabase sync attempt
    localRideStore.syncToSupabase().catch(() => {});

    // Process ride for adaptive learning
    await useAthleteStore.getState().processRide({
      id: this.sessionId,
      snapshots: [],
      duration_s: elapsedS,
      total_km: totalKm,
      total_elevation_m: 0,
      avg_speed_kmh: avgSpeed,
      max_speed_kmh: maxSpeed,
      avg_power_w: avgPower,
      max_power_w: maxPower,
      avg_cadence: avgCadence,
      max_hr: maxHr,
      avg_hr: avgHr,
      battery_start: m.battery_start,
      battery_end: bike.battery_percent,
      override_rate: this.snapshotCount > 0 ? this.overrideCount / this.snapshotCount : 0,
      ftp_estimate: 0,
      tss_score: 0,
      override_events: [],
      created_at: new Date(),
    });

    // Reset in-memory state
    this.sessionId = null;
    this.startedAt = 0;
    this.snapshotCount = 0;
    this.metrics = this.emptyMetrics();
    useAthleteStore.getState().setRideActive(false);
    bike.resetSession();
    console.log('[RideSession] Stopped');
  }

  // ── Override tracking ──

  recordOverride(source: 'ergo3' | 'app_button', fromMode: number, toMode?: number): void {
    if (!this.sessionId) return;
    this.overrideCount++;

    const bike = useBikeStore.getState();
    const terrain = useAutoAssistStore.getState().terrain;
    const torque = useTorqueStore.getState();
    const decision = useAutoAssistStore.getState().lastDecision;
    const gradientPct = terrain?.current_gradient_pct ?? 0;

    // Write override event to IndexedDB
    const event: LocalOverrideEvent = {
      session_id: this.sessionId,
      sync_status: 'local',
      synced_at: null,
      elapsed_s: Math.round((Date.now() - this.startedAt) / 1000),
      source,
      from_mode: fromMode,
      to_mode: toMode,
      speed_kmh: bike.speed_kmh,
      gradient_pct: gradientPct,
      hr_bpm: bike.hr_bpm,
      hr_zone: bike.hr_zone,
      gear: bike.gear,
      torque_nm: torque.torque_nm,
      climb_type: torque.climb_type,
      auto_assist_reason: decision?.reason ?? '',
    };
    localRideStore.writeOverrideEvent(event).catch((err) => {
      console.error('[RideSession] Failed to write override event:', err);
    });

    const direction = (toMode !== undefined && toMode > fromMode) ? 'more' as const
      : (toMode !== undefined && toMode < fromMode) ? 'less' as const : null;
    if (direction) {
      useLearningStore.getState().recordOverride(gradientPct, bike.hr_zone, direction);
    }
  }

  // ── Snapshot capture ──

  private captureSnapshot(): void {
    if (!this.sessionId) return;

    const bike = useBikeStore.getState();
    const map = useMapStore.getState();
    const terrain = useAutoAssistStore.getState().terrain;
    const torque = useTorqueStore.getState();
    const aaStore = useAutoAssistStore.getState();
    const isOverride = autoAssistEngine.isOverrideActive();

    this.snapshotCount++;

    // Update in-memory metrics
    this.metrics.distance_km = Math.max(this.metrics.distance_km, bike.distance_km);
    this.metrics.speed_max = Math.max(this.metrics.speed_max, bike.speed_kmh);
    if (bike.power_watts > 0) {
      this.metrics.power_sum += bike.power_watts;
      this.metrics.power_count++;
      this.metrics.power_max = Math.max(this.metrics.power_max, bike.power_watts);
    }
    if (bike.hr_bpm > 0) {
      this.metrics.hr_sum += bike.hr_bpm;
      this.metrics.hr_count++;
      this.metrics.hr_max = Math.max(this.metrics.hr_max, bike.hr_bpm);
    }
    if (bike.cadence_rpm > 0) {
      this.metrics.cadence_sum += bike.cadence_rpm;
      this.metrics.cadence_count++;
    }

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
      torque_nm: bike.torque_nm || torque.torque_nm,  // prefer actual motor torque over calculated
      support_pct: torque.support_pct,
      launch_value: torque.launch_value,
      climb_type: torque.climb_type as string,
      gradient_pct: terrain?.current_gradient_pct ?? 0,
      auto_assist_active: aaStore.enabled && !isOverride,
      auto_assist_reason: aaStore.lastDecision?.reason ?? '',
      was_overridden: isOverride,
      assist_current_a: bike.assist_current_a,
      front_gear: bike.front_gear,
      rear_gear: bike.rear_gear,
      trip_distance_km: bike.trip_distance_km,
      trip_time_s: bike.trip_time_s,
      range_km: bike.range_km,
      spo2_pct: bike.spo2_pct,
      // Phone sensors (from BLE bridge PhoneSensorService)
      pressure_hpa: bike.pressure_hpa,
      barometric_altitude_m: bike.barometric_altitude_m,
      lean_angle_deg: bike.lean_angle_deg,
      temperature_c: bike.temperature_c,
    };

    this.snapshotBuffer.push(row);

    // Persist metrics to IndexedDB every N snapshots
    if (this.snapshotCount % METRICS_PERSIST_EVERY === 0 && this.sessionId) {
      localRideStore.updateSession(this.sessionId, {
        metrics: this.metrics,
        override_count: this.overrideCount,
      }).catch(() => {});
    }
  }

  // ── Flush buffer to IndexedDB ──

  private async flushSnapshots(): Promise<void> {
    if (this.snapshotBuffer.length === 0) return;
    const dlog = (window as unknown as Record<string, (m: string) => void>).__dlog ?? console.log;

    const batch = [...this.snapshotBuffer];

    // Convert to LocalSnapshot format
    const localSnaps: LocalSnapshot[] = batch.map(row => ({
      ...row,
      sync_status: 'local' as const,
      synced_at: null,
    }));

    try {
      // Write to IndexedDB FIRST
      await localRideStore.writeSnapshots(localSnaps);
      // ONLY clear buffer after confirmed IndexedDB write
      this.snapshotBuffer = [];
      if (this.snapshotCount <= 3) dlog(`Flush OK: ${batch.length} snaps to IDB (total ${this.snapshotCount})`);
    } catch (err) {
      dlog(`Flush to IDB FAILED: ${String(err)}`);
      // IndexedDB write failed — keep buffer for next attempt
    }
  }

  // ── Community rescue presence sync ──

  private startPresenceSync(): void {
    const settings = import('../../store/settingsStore').then(m => m.useSettingsStore.getState());
    settings.then(s => {
      if (!s.riderProfile.rescue_available) return;
      this.updatePresence(true);
      this.presenceIntervalId = setInterval(() => this.updatePresence(true), 60000);
    });
  }

  private stopPresenceSync(): void {
    if (this.presenceIntervalId) { clearInterval(this.presenceIntervalId); this.presenceIntervalId = null; }
    this.updatePresence(false);
  }

  private async updatePresence(riding: boolean): Promise<void> {
    if (!SUPABASE_URL || !SUPABASE_KEY) return;
    const userId = useAuthStore.getState().getUserId();
    if (!userId) return;
    const map = useMapStore.getState();
    if (!map.latitude || !map.longitude) return;

    try {
      const settingsMod = await import('../../store/settingsStore');
      const profile = settingsMod.useSettingsStore.getState().riderProfile;

      await fetch(`${SUPABASE_URL}/rest/v1/rider_presence?user_id=eq.${userId}`, {
        method: 'DELETE',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
      });

      if (riding && profile.rescue_available) {
        await fetch(`${SUPABASE_URL}/rest/v1/rider_presence`, {
          method: 'POST',
          headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            user_id: userId,
            name: profile.name || 'Ciclista',
            phone: profile.phone || null,
            avatar_url: profile.avatar_url || null,
            lat: map.latitude,
            lng: map.longitude,
            available: true,
            riding: true,
          }),
        });
      }
    } catch { /* best-effort */ }
  }

  // ── State ──

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
